import React from 'react';

export default function TargetList({ targets, onAdd, onRemove, onUpdate }) {
  return (
    <div className="target-list">
      {targets.map((t) => (
        <div key={t.id} className="target-row">
          <input
            className="name-input"
            placeholder="ชื่อ (ถ้ามี)"
            value={t.name}
            onChange={(e) => onUpdate(t.id, 'name', e.target.value)}
          />
          <input
            className="url-input"
            placeholder="http://127.0.0.1:8081/webhook/ocp"
            value={t.url}
            onChange={(e) => onUpdate(t.id, 'url', e.target.value)}
            title="⚠️ ต้องมี http:// หรือ https:// เช่น: http://127.0.0.1:8081/webhook/ocp"
            style={{
              borderColor: t.url && !t.url.startsWith('http://') && !t.url.startsWith('https://') 
                ? 'var(--danger)' 
                : undefined
            }}
          />
          <select
            className="auth-type-select"
            value={t.authType || 'bearer'}
            onChange={(e) => onUpdate(t.id, 'authType', e.target.value)}
          >
            <option value="bearer">Bearer</option>
            <option value="x-api-key">X-API-Key</option>
          </select>
          <input
            className="apikey-input"
            type="password"
            placeholder="API Key"
            value={t.apiKey || ''}
            onChange={(e) => onUpdate(t.id, 'apiKey', e.target.value)}
          />
          <button type="button" className="btn-remove" onClick={() => onRemove(t.id)}>
            ลบ
          </button>
        </div>
      ))}
      <button type="button" className="btn-add" onClick={() => onAdd({ name: '', url: '', apiKey: '', authType: 'bearer' })}>
        + เพิ่ม Target
      </button>
    </div>
  );
}
