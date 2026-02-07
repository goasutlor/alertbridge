import React, { useState, useCallback } from 'react';
import PatternMenu from './components/PatternMenu';
import TargetList from './components/TargetList';
import ManualValues from './components/ManualValues';
import PayloadPreview from './components/PayloadPreview';
import SendPanel from './components/SendPanel';
import ResultPanel from './components/ResultPanel';
import './App.css';

// ในโหมด dev เรียก backend ที่ port 5000 โดยตรง (ไม่พึ่ง proxy) เพื่อไม่ให้เกิด 404
const API = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5001/api' : '/api');
const API_SEND = `${API.replace(/\/api\/?$/, '')}/api/send`;

export default function App() {
  const [pattern, setPattern] = useState('ocp');
  const [targets, setTargets] = useState([]);
  const [count, setCount] = useState(1);
  const [eps, setEps] = useState(0);
  const [manualValues, setManualValues] = useState({});
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const addTarget = useCallback((item) => {
    setTargets((prev) => [...prev, { id: Date.now().toString(), name: item.name || '', url: item.url || '', apiKey: item.apiKey || '', authType: item.authType || 'bearer' }]);
  }, []);

  const removeTarget = useCallback((id) => {
    setTargets((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const updateTarget = useCallback((id, field, value) => {
    setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  }, []);

  const sendAlerts = useCallback(async () => {
    const list = targets.filter((t) => t.url.trim());
    if (!list.length) {
      setLastResult({ error: 'กรุณาเพิ่ม Target อย่างน้อย 1 รายการและกรอก URL' });
      return;
    }
    // ตรวจสอบว่า URL ถูกต้อง (ต้องมี http:// หรือ https://)
    const invalidUrls = list.filter((t) => {
      const url = t.url.trim();
      return !url.startsWith('http://') && !url.startsWith('https://');
    });
    if (invalidUrls.length > 0) {
      const invalidNames = invalidUrls.map((t) => t.name || t.url).join(', ');
      setLastResult({ 
        error: `URL ไม่ถูกต้อง: ${invalidNames}\nกรุณากรอก URL ที่มี http:// หรือ https:// เช่น: http://127.0.0.1:8081/webhook/ocp` 
      });
      return;
    }
    setSending(true);
    setLastResult(null);
    try {
      const requestBody = {
        pattern,
        targets: list.map((t) => {
          let url = t.url.trim();
          // Normalize URL: แก้ double slash (//) แต่ไม่เปลี่ยน http://
          url = url.replace(/([^:]\/)\/+/g, '$1');
          if (url.endsWith('/') && url.length > 1) {
            url = url.slice(0, -1);
          }
          const apiKeyValue = (t.apiKey || '').trim();
          return {
            name: t.name.trim() || url,
            url,
            apiKey: apiKeyValue || null, // ส่ง null แทน undefined เพื่อให้ server รู้ว่า field มีอยู่
            authType: t.authType || 'bearer',
          };
        }),
        count,
        eps,
        overrides: Object.fromEntries(
          Object.entries(manualValues).filter(([, v]) => v != null && String(v).trim() !== '')
        ),
      };
      
      // Debug: log request ที่จะส่ง (ไม่ log API Key เต็ม)
      const debugBody = {
        ...requestBody,
        targets: requestBody.targets.map((t) => ({
          ...t,
          apiKey: t.apiKey ? t.apiKey.substring(0, 8) + '...' : null,
        })),
      };
      console.log('[Client] Sending request:', JSON.stringify(debugBody, null, 2));
      
      const res = await fetch(API_SEND, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        setLastResult({ error: `Server returned invalid JSON: ${text.slice(0, 200)}` });
        setSending(false);
        return;
      }
      if (!res.ok) {
        const backHint = res.status === 404 && import.meta.env.DEV
          ? ' (รัน backend ที่ port 5001: npm run server หรือ npm run dev)'
          : '';
        setLastResult({ error: (data.error || res.statusText) + backHint });
        setSending(false);
        return;
      }
      setLastResult(data);
    } catch (err) {
      const msg = err.message || '';
      const hint = (msg.includes('404') || msg.includes('Failed to fetch')) && import.meta.env.DEV
        ? ' — ให้รัน backend ด้วย: จากโฟลเดอร์โปรเจกต์รัน npm run dev (หรือเปิดเทอร์มินัลแยกรัน npm run server ที่ port 5001)'
        : '';
      setLastResult({ error: msg + hint });
    } finally {
      setSending(false);
    }
  }, [pattern, targets, count, eps, manualValues]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Alert Generator</h1>
        <p className="tagline">OCP & Confluent standard patterns · จำนวน · EPS · Random info</p>
      </header>

      <section className="section pattern-section">
        <h2>1. เลือก Alert Pattern</h2>
        <PatternMenu value={pattern} onChange={setPattern} />
      </section>

      <section className="section target-section">
        <h2>2. กำหนด Target (ที่อยู่ปลายทาง)</h2>
        <TargetList
          targets={targets}
          onAdd={addTarget}
          onRemove={removeTarget}
          onUpdate={updateTarget}
        />
      </section>

      <section className="section manual-section">
        <h2>3. Manual Values (ระบุค่าเอง)</h2>
        <ManualValues pattern={pattern} values={manualValues} onChange={setManualValues} />
        <PayloadPreview
          pattern={pattern}
          overrides={Object.fromEntries(
            Object.entries(manualValues).filter(([, v]) => v != null && String(v).trim() !== '')
          )}
        />
      </section>

      <section className="section send-section">
        <h2>4. จำนวน · EPS · ยิง Alert</h2>
        <SendPanel
          pattern={pattern}
          targetCount={targets.filter((t) => t.url.trim()).length}
          count={count}
          eps={eps}
          onCountChange={setCount}
          onEpsChange={setEps}
          sending={sending}
          onSend={sendAlerts}
        />
      </section>

      {lastResult && (
        <section className="section result-section">
          <ResultPanel result={lastResult} />
        </section>
      )}
    </div>
  );
}
