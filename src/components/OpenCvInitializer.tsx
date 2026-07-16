import React from 'react';
import { Loader2 } from 'lucide-react';

interface OpenCvInitializerProps {
  cvError: string | null;
}

export const OpenCvInitializer: React.FC<OpenCvInitializerProps> = ({ cvError }) => {
  return (
    <div className="loading-screen">
      {cvError ? (
        <div style={{ textAlign: 'center', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <svg
            className="spinner"
            style={{ color: '#ef4444', animation: 'none', width: '48px', height: '48px', marginBottom: '16px' }}
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
          <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>読み込みエラー</h3>
          <p style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '260px', lineHeight: '1.5', marginBottom: '20px' }}>
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
        </div>
      ) : (
        <>
          <Loader2 className="spinner spinner-large" style={{ color: '#6366f1', marginBottom: '16px' }} />
          <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>OpenCV.js 初期化中</h3>
          <p style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '90%', lineHeight: '1.5', textAlign: 'center' }}>
            画像処理エンジン（約10MB）をロードしています。初回起動には数秒かかる場合があります。
          </p>
        </>
      )}
    </div>
  );
};
