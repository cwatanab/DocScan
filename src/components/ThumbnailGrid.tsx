import React from 'react';
import { Share2, Download, Plus } from 'lucide-react';

interface ThumbnailGridProps {
  pages: string[];
  onPageClick: (page: string) => void;
  onBackToScanner: () => void;
  onShareSingleJpeg: (page: string, idx: number) => void;
  onDownloadJpeg: (page: string, idx: number) => void;
  onShareSinglePng: (page: string, idx: number) => void;
  onDownloadPng: (page: string, idx: number) => void;
}

export const ThumbnailGrid: React.FC<ThumbnailGridProps> = ({
  pages,
  onPageClick,
  onBackToScanner,
  onShareSingleJpeg,
  onDownloadJpeg,
  onShareSinglePng,
  onDownloadPng,
}) => {
  return (
    <div className="thumbnail-grid">
      {pages.map((page, idx) => (
        <div 
          key={idx} 
          className="thumbnail-card"
          onClick={() => onPageClick(page)}
          style={{ cursor: 'pointer' }}
        >
          <img
            src={page}
            alt={`Page ${idx + 1}`}
            className="thumbnail-card-img"
          />
          <div className="thumbnail-card-bar">
            <span className="thumbnail-card-title">
              P {idx + 1}
            </span>
            <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              {/* JPEG 共有/保存 */}
              <button
                onClick={(e) => { e.stopPropagation(); onShareSingleJpeg(page, idx); }}
                className="thumbnail-card-download"
                style={{ backgroundColor: '#4f46e5', width: '22px', height: '22px', padding: '0' }}
                title="JPEGを共有"
              >
                <Share2 style={{ width: '10px', height: '10px' }} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDownloadJpeg(page, idx); }}
                className="thumbnail-card-download"
                style={{ backgroundColor: '#334155', width: '22px', height: '22px', padding: '0' }}
                title="JPEG保存"
              >
                <Download style={{ width: '10px', height: '10px' }} />
              </button>
              {/* PNG 共有/保存 */}
              <button
                onClick={(e) => { e.stopPropagation(); onShareSinglePng(page, idx); }}
                className="thumbnail-card-download"
                style={{ backgroundColor: '#10b981', width: '22px', height: '22px', padding: '0' }}
                title="PNGを共有"
              >
                <Share2 style={{ width: '10px', height: '10px', color: '#fff' }} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDownloadPng(page, idx); }}
                className="thumbnail-card-download"
                style={{ backgroundColor: '#0f172a', width: '22px', height: '22px', padding: '0', border: '1px solid #334155' }}
                title="PNG保存"
              >
                <Download style={{ width: '10px', height: '10px', color: '#fff' }} />
              </button>
            </div>
          </div>
        </div>
      ))}
      
      {/* ページ追加用のカード */}
      <div 
        onClick={onBackToScanner} 
        className="thumbnail-card add-page-card"
      >
        <Plus style={{ width: '22px', height: '22px', color: '#6366f1', marginBottom: '8px' }} />
        <span style={{ fontSize: '11px', fontWeight: '700', color: '#cbd5e1' }}>ページ追加</span>
      </div>
    </div>
  );
};
