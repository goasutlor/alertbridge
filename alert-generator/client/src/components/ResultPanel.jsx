import React, { useMemo } from 'react';

export default function ResultPanel({ result }) {
  if (result.error) {
    return (
      <div className="result-section">
        <h3>ผลลัพธ์</h3>
        <p className="error">{result.error}</p>
      </div>
    );
  }

  const { results = [], payload, count, totalSent, usedOverrides, overrides } = result;
  const summary = useMemo(() => {
    const ok = results.filter((r) => r.success).length;
    const fail = results.length - ok;
    return { ok, fail };
  }, [results]);

  const showAll = results.length <= 20;
  const displayResults = showAll ? results : results.slice(0, 15);

  return (
    <div className="result-section">
      <h3>ผลลัพธ์การยิง</h3>
      {(totalSent != null || count != null) && (
        <p className="result-summary">
          ส่งทั้งหมด {totalSent ?? results.length} ครั้ง
          {count != null && count > 1 && ` (${count} batch × ${results.length / count} target)`}
          {' · '}
          <span className="success-text">สำเร็จ {summary.ok}</span>
          {' · '}
          <span className="fail-text">ล้มเหลว {summary.fail}</span>
        </p>
      )}
      <ul className="result-list">
        {displayResults.map((r, i) => (
          <li key={i}>
            <span className={`badge ${r.success ? 'success' : 'fail'}`}>
              {r.success ? 'สำเร็จ' : 'ล้มเหลว'}
            </span>
            {r.batch != null && r.batch > 1 && <span className="batch">#{r.batch}</span>}
            <span>{r.name || r.url}</span>
            {r.status != null && (
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                {r.status} {r.statusText}
                {r.status === 404 && (
                  <span className="error-hint" title="ตรวจสอบ: URL ถูกต้องหรือไม่, Path ครบหรือไม่ (เช่น /webhook/ocp), Server รันอยู่หรือไม่">
                    {' '}⚠️ ตรวจสอบ URL และ Path
                  </span>
                )}
                {r.status === 401 && (
                  <span className="error-hint" title="API Key อาจไม่ถูกต้องหรือ Server ไม่ยอมรับ">
                    {' '}⚠️ ตรวจสอบ API Key
                  </span>
                )}
                {r.status === 403 && (
                  <span className="error-hint" title="API Key อาจไม่มีสิทธิ์เข้าถึง endpoint นี้">
                    {' '}⚠️ ตรวจสอบสิทธิ์ API Key
                  </span>
                )}
                {!r.success && r.hasApiKey === false && (
                  <span className="error-hint" title="⚠️ ไม่พบ API Key ใน request - Server อาจต้องการ API Key">
                    {' '}⚠️ ไม่มี API Key
                  </span>
                )}
              </span>
            )}
            {r.error && <span className="error">{r.error}</span>}
            {r.hasApiKey === false && (
              <span className="error-hint" style={{ fontSize: '0.75rem', display: 'block', marginTop: '0.25rem' }}>
                ⚠️ ไม่พบ API Key ใน request - กรุณากรอก API Key และเลือก Auth Type
              </span>
            )}
            {r.hasApiKey && r.authType && (
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginTop: '0.25rem' }}>
                ✓ ส่ง API Key แล้ว (Type: {r.authType === 'x-api-key' ? 'X-API-Key' : 'Bearer'})
              </span>
            )}
            {r.sentHeaders && (
              <details style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Headers ที่ส่งไป (Debug)</summary>
                <pre style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: 'var(--muted)' }}>{JSON.stringify(r.sentHeaders, null, 2)}</pre>
              </details>
            )}
            {r.responseBody && !r.success && (
              <details style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Response Body จาก Server</summary>
                <pre style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: 'var(--danger)' }}>{r.responseBody}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      {!showAll && (
        <p className="result-more">… และอีก {results.length - displayResults.length} รายการ</p>
      )}
      {payload && (
        <details className={usedOverrides ? 'payload-manual' : ''} open={!!usedOverrides}>
          <summary style={{ cursor: 'pointer', marginTop: '0.5rem', color: usedOverrides ? 'var(--accent)' : 'var(--muted)' }}>
            {usedOverrides ? (
              <>📤 Payload ที่ส่งไป (Manual/Custom)</>
            ) : (
              <>ดู Payload ตัวอย่าง (random)</>
            )}
          </summary>
          {usedOverrides && overrides && Object.keys(overrides).length > 0 && (
            <div className="payload-overrides">
              <p className="payload-overrides-label">ค่าที่ Custom:</p>
              <pre className="payload-overrides-pre">{JSON.stringify(overrides, null, 2)}</pre>
            </div>
          )}
          <pre>{JSON.stringify(payload, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
