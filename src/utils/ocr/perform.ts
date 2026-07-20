/**
 * OCR 解析パイプライン本体
 */

import * as ort from 'onnxruntime-web';
import { initOcrEngine } from './engine';
import { dbPostProcess } from './detection';
import {
  decodeCtc,
  getCropImage,
  preprocessImageForOcr,
  preprocessRecImage,
  rotateCanvas90
} from './recognition';
import type { OcrResult, OcrWord } from './types';

const yieldToUi = (ms = 45) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadImageToCanvas(
  imageSource: string | HTMLCanvasElement
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  if (typeof imageSource !== 'string') {
    return {
      canvas: preprocessImageForOcr(imageSource),
      width: imageSource.width,
      height: imageSource.height
    };
  }

  const img = new Image();
  img.src = imageSource;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image for OCR'));
  });

  const width = img.width;
  const height = img.height;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tCtx = tempCanvas.getContext('2d');
  if (tCtx) {
    tCtx.drawImage(img, 0, 0);
    return { canvas: preprocessImageForOcr(tempCanvas), width, height };
  }
  return { canvas: tempCanvas, width, height };
}

function buildDetTensor(processedCanvas: HTMLCanvasElement): {
  tensor: ort.Tensor;
  detWidth: number;
  detHeight: number;
} {
  const detLimitSideLen = 2240;
  const detScale =
    processedCanvas.width > processedCanvas.height
      ? detLimitSideLen / processedCanvas.width
      : detLimitSideLen / processedCanvas.height;

  const detWidth = Math.round((processedCanvas.width * detScale) / 32) * 32;
  const detHeight = Math.round((processedCanvas.height * detScale) / 32) * 32;

  const detResizeCanvas = document.createElement('canvas');
  detResizeCanvas.width = detWidth;
  detResizeCanvas.height = detHeight;
  const detCtx = detResizeCanvas.getContext('2d')!;
  detCtx.drawImage(
    processedCanvas,
    0,
    0,
    processedCanvas.width,
    processedCanvas.height,
    0,
    0,
    detWidth,
    detHeight
  );

  const detImgData = detCtx.getImageData(0, 0, detWidth, detHeight);
  const detData = detImgData.data;
  const detNumPixels = detWidth * detHeight;
  const detInputBuffer = new Float32Array(detNumPixels * 3);

  const rScale = 1.0 / (255.0 * 0.229);
  const rOffset = 0.485 / 0.229;
  const gScale = 1.0 / (255.0 * 0.224);
  const gOffset = 0.456 / 0.224;
  const bScale = 1.0 / (255.0 * 0.225);
  const bOffset = 0.406 / 0.225;

  let srcIdx = 0;
  for (let i = 0; i < detNumPixels; i++) {
    detInputBuffer[i] = detData[srcIdx++] * rScale - rOffset;
    detInputBuffer[detNumPixels + i] = detData[srcIdx++] * gScale - gOffset;
    detInputBuffer[detNumPixels * 2 + i] = detData[srcIdx++] * bScale - bOffset;
    srcIdx++;
  }

  return {
    tensor: new ort.Tensor('float32', detInputBuffer, [1, 3, detHeight, detWidth]),
    detWidth,
    detHeight
  };
}

/**
 * 画像データ(DataURLまたはCanvas)から OCR 解析を実行する
 */
export async function performOcr(
  imageSource: string | HTMLCanvasElement,
  onProgress?: (progress: number) => void
): Promise<OcrResult> {
  try {
    const { detSession, recSession, dict } = await initOcrEngine(onProgress);
    const { canvas: processedCanvas, width, height } = await loadImageToCanvas(imageSource);

    if (onProgress) onProgress(0.9);
    await yieldToUi();

    const { tensor: detTensor, detWidth, detHeight } = buildDetTensor(processedCanvas);
    const detFeeds = { [detSession.inputNames[0]]: detTensor };
    const detResults = await detSession.run(detFeeds);
    const detOutputTensor = detResults[detSession.outputNames[0]];
    const detOutputData = detOutputTensor.data as Float32Array;

    const boxes = dbPostProcess(
      detOutputData,
      detHeight,
      detWidth,
      processedCanvas.width,
      processedCanvas.height,
      1.8
    );

    const words: OcrWord[] = [];
    const textLines: string[] = [];

    for (let i = 0; i < boxes.length; i++) {
      await yieldToUi();

      if (onProgress) {
        onProgress(0.9 + (i / boxes.length) * 0.09);
      }

      const box = boxes[i];
      let cropCanvas = getCropImage(processedCanvas, box);

      if (cropCanvas.height > cropCanvas.width) {
        cropCanvas = rotateCanvas90(cropCanvas);
      }

      const recTensor = preprocessRecImage(cropCanvas);
      const recFeeds = { [recSession.inputNames[0]]: recTensor };
      const recResults = await recSession.run(recFeeds);
      const recOutputTensor = recResults[recSession.outputNames[0]];
      const recOutputData = recOutputTensor.data as Float32Array;

      const dims = recOutputTensor.dims;
      const decoded = decodeCtc(recOutputData, dims[1], dims[2], dict);

      if (decoded.text.trim().length > 0) {
        textLines.push(decoded.text);

        const scaleX = width / processedCanvas.width;
        const scaleY = height / processedCanvas.height;
        const finalBox = box.map((p) => [p[0] * scaleX, p[1] * scaleY]);

        words.push({
          text: decoded.text,
          confidence: decoded.confidence,
          bbox: {
            x0: finalBox[0][0],
            y0: finalBox[0][1],
            x1: finalBox[2][0],
            y1: finalBox[2][1]
          }
        });
      }
    }

    if (onProgress) onProgress(1.0);
    await yieldToUi();

    return {
      text: textLines.join('\n'),
      words,
      width,
      height
    };
  } catch (error) {
    console.error('OCR analysis failed via ONNX Runtime Web:', error);
    throw error;
  }
}
