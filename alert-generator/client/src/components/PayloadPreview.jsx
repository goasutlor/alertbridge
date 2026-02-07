import React, { useState, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');
const API_PREVIEW = `${API.replace(/\/api\/?$/, '')}/api/payload/preview`;

export default function PayloadPreview({ pattern, overrides }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const hasOverrides = overrides && Object.keys(overrides).length > 0;

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API_PREVIEW, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern, overrides: overrides || {} }),
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        if (text.startsWith('<!') || text.startsWith('<')) {
          setError('Server คืน HTML แทน JSON — กรุณารัน backend (npm run dev หรือ npm run server) ที่ port 5001');
        } else {
          setError(`Server คืนข้อมูลไม่ใช่ JSON: ${text.substring(0, 80)}...`);
        }
        setPayload(null);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(data?.error || 'Failed');
      setPayload(data);
    } catch (err) {
      setError(err.message || 'ไม่สามารถโหลด Preview ได้');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [pattern, overrides]);

  if (!hasOverrides) return null;

  return (
    <div className="payload-preview-box">
      <div className="payload-preview-header">
        <strong>📤 Payload ที่จะส่งไปที่ Target</strong>
        <button
          type="button"
          className="btn-preview"
          onClick={fetchPreview}
          disabled={loading}
        >
          {loading ? 'โหลด...' : 'ดู Preview'}
        </button>
      </div>
      {error && <p className="payload-preview-error">{error}</p>}
      {payload && (
        <div className="payload-preview-body">
          <p className="payload-preview-custom">
            <strong>ค่าที่ Manual:</strong>{' '}
            <code>{JSON.stringify(overrides)}</code>
          </p>
          <details open>
            <summary>Payload เต็ม</summary>
            <pre>{JSON.stringify(payload, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
