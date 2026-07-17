import React from 'react';
import { Loader2 } from 'lucide-react';
import { clearAppCacheAndReload, isLocalExecution } from '../utils/imageExportHelper';

interface OpenCvInitializerProps {
  cvError: string | null;
}

export const OpenCvInitializer: React.FC<OpenCvInitializerProps> = ({ cvError }) => {
  return (
    <div className="loading-screen">
      {cvError ? (
        <>
          <svg
            style={{ color: '#ef4444', width: '48px', height: '48px', marginBottom: '16px' }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <h3>読み込みエラー</h3>
          <p style={{ marginBottom: '20px' }}>
            {cvError}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px 20px',
              backgroundColor: '#6366f1',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
            }}
          >
            ページを再読み込み
          </button>
          {isLocalExecution() && (
            <button
              onClick={clearAppCacheAndReload}
              style={{
                marginTop: '12px',
                padding: '8px 16px',
                backgroundColor: 'transparent',
                color: '#ef4444',
                border: '1px solid #ef4444',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'opacity 0.2s'
              }}
            >
              キャッシュを削除して再起動
            </button>
          )}
        </>
      ) : (
        <>
          <Loader2 className="spinner spinner-large" style={{ color: '#6366f1', marginBottom: '16px' }} />
          <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>初期化中</h3>
          <p>
            画像処理エンジンを初期化しています。これには数秒かかる場合があります。
          </p>
          {isLocalExecution() && (
            <button
              onClick={clearAppCacheAndReload}
              style={{
                marginTop: '32px',
                padding: '6px 12px',
                backgroundColor: 'transparent',
                color: '#64748b',
                border: '1px solid #334155',
                borderRadius: '6px',
                fontSize: '11px',
                cursor: 'pointer',
                opacity: 0.8
              }}
            >
              終わらない場合はキャッシュを削除
            </button>
          )}
        </>
      )}
    </div>
  );
};
