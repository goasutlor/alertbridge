import React from 'react';

export default function SendPanel({
  pattern,
  targetCount,
  count,
  eps,
  onCountChange,
  onEpsChange,
  sending,
  onSend,
}) {
  return (
    <div className="send-section-inner">
      <div className="send-controls">
        <label className="control-group">
          <span>จำนวน (ครั้ง)</span>
          <input
            type="number"
            min={1}
            max={10000}
            value={count}
            onChange={(e) => onCountChange(Number(e.target.value) || 1)}
            disabled={sending}
          />
        </label>
        <label className="control-group">
          <span>EPS (events/sec)</span>
          <input
            type="number"
            min={0}
            max={1000}
            step={0.5}
            value={eps}
            onChange={(e) => onEpsChange(Number(e.target.value) >= 0 ? Number(e.target.value) : 0)}
            disabled={sending}
            placeholder="0 = เร็วสุด"
          />
        </label>
      </div>
      <div className="send-bar">
        <button
          type="button"
          className="btn-send"
          disabled={sending || targetCount === 0}
          onClick={onSend}
        >
          {sending ? 'กำลังยิง...' : 'ยิง Alert'}
        </button>
        <span className="hint">
          ส่ง {count} ครั้ง → {targetCount} Target · Pattern: {pattern === 'ocp' ? 'OCP' : 'Confluent'}
          {eps > 0 ? ` · ${eps} EPS` : ''} · Information สุ่มทุกครั้ง
          {targetCount === 0 && <span className="hint-warn"> · ⚠️ กรุณาเพิ่ม Target ที่ส่วน 2</span>}
        </span>
      </div>
    </div>
  );
}
