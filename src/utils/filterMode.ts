/**
 * ドキュメントフィルターモードの型と派生ヘルパー
 */

export type FilterMode =
  | 'color_enhanced'
  | 'color_original'
  | 'document_enhanced'
  | 'document_original'
  | 'mono';

export type ColorMode = 'color' | 'document';
export type EnhancementMode = 'enhanced' | 'original';

export function getColorMode(mode: FilterMode): ColorMode {
  return mode === 'color_enhanced' || mode === 'color_original' ? 'color' : 'document';
}

export function getEnhancementMode(mode: FilterMode): EnhancementMode {
  return mode === 'color_enhanced' || mode === 'document_enhanced' ? 'enhanced' : 'original';
}

export function combineFilterMode(
  colorMode: ColorMode,
  enhancementMode: EnhancementMode
): FilterMode {
  if (colorMode === 'color') {
    return enhancementMode === 'enhanced' ? 'color_enhanced' : 'color_original';
  }
  return enhancementMode === 'enhanced' ? 'document_enhanced' : 'document_original';
}
