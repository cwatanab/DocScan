import { describe, it, expect } from 'bun:test';
import { refineDocumentCorners } from './cornerRefinement';
import type { Point } from './geometry';

/**
 * テスト用ImageDataを生成するヘルパー
 * 幅 width, 高さ height の黒背景（輝度 30）の中央に、
 * rect (x, y, w, h) の白い紙（輝度 220）を描画した ImageData を返す
 */
function createSyntheticDocImage(
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number }
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const isInside =
        x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const val = isInside ? 220 : 30;
      data[idx] = val;     // R
      data[idx + 1] = val; // G
      data[idx + 2] = val; // B
      data[idx + 3] = 255; // A
    }
  }

  return {
    width,
    height,
    data,
    colorSpace: 'srgb'
  } as ImageData;
}

describe('refineDocumentCorners', () => {
  it('わずかにズレた初期座標を、矩形ドキュメントの真の境界エッジに正確に吸着させる', () => {
    const W = 400;
    const H = 400;
    // 真のドキュメント位置: (50, 50) から 幅 300, 高さ 300
    // 正確な四隅: TL=(50, 50), TR=(350, 50), BR=(350, 350), BL=(50, 350)
    const img = createSyntheticDocImage(W, H, { x: 50, y: 50, w: 300, h: 300 });

    // AIの粗検出によるズレ（内側や外側に 5〜10px ズレている）
    const coarseCorners: Point[] = [
      { x: 58, y: 55 },   // TL: 内側にズレ
      { x: 342, y: 45 },  // TR: Xは内側、Yは外側にズレ
      { x: 355, y: 343 }, // BR: Xは外側、Yは内側にズレ
      { x: 45, y: 356 }   // BL: Xは外側、Yは外側にズレ
    ];

    const refined = refineDocumentCorners(img, coarseCorners, {
      searchRadius: 25,
      minGradient: 15
    });

    // 各頂点が真の境界 (50, 50), (350, 50), (350, 350), (50, 350) の近傍（誤差 1.5px 以内）に吸着していること
    expect(Math.abs(refined[0].x - 50)).toBeLessThan(1.5);
    expect(Math.abs(refined[0].y - 50)).toBeLessThan(1.5);

    expect(Math.abs(refined[1].x - 350)).toBeLessThan(1.5);
    expect(Math.abs(refined[1].y - 50)).toBeLessThan(1.5);

    expect(Math.abs(refined[2].x - 350)).toBeLessThan(1.5);
    expect(Math.abs(refined[2].y - 350)).toBeLessThan(1.5);

    expect(Math.abs(refined[3].x - 50)).toBeLessThan(1.5);
    expect(Math.abs(refined[3].y - 350)).toBeLessThan(1.5);
  });

  it('コントラストのない画像では元の座標をそのまま維持して破綻しない', () => {
    const W = 200;
    const H = 200;
    const data = new Uint8ClampedArray(W * H * 4).fill(128);
    const flatImg = { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;

    const originalCorners: Point[] = [
      { x: 30, y: 30 },
      { x: 170, y: 30 },
      { x: 170, y: 170 },
      { x: 30, y: 170 }
    ];

    const result = refineDocumentCorners(flatImg, originalCorners, {
      searchRadius: 20
    });

    expect(result).toEqual(originalCorners);
  });

  it('不正な入力（頂点数不足など）でも例外を出さずに入力を返す', () => {
    const W = 100;
    const H = 100;
    const data = new Uint8ClampedArray(W * H * 4);
    const img = { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;

    expect(refineDocumentCorners(img, [])).toEqual([]);
  });
});
