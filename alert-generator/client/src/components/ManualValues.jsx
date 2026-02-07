import React from 'react';

export default function ManualValues({ pattern, values, onChange }) {
  const update = (field, v) => onChange({ ...values, [field]: v });

  if (pattern === 'ocp') {
    return (
      <div className="manual-values">
        <p className="manual-hint">ว่าง = random · กรอก = ใช้ค่าที่ระบุ (เช็คได้ว่าถึงปลายทางจริง)</p>
        <div className="manual-grid">
          <label>
            <span>alertname</span>
            <input placeholder="TargetDown" value={values.alertname || ''} onChange={(e) => update('alertname', e.target.value)} />
          </label>
          <label>
            <span>severity</span>
            <input placeholder="critical" value={values.severity || ''} onChange={(e) => update('severity', e.target.value)} />
          </label>
          <label>
            <span>namespace</span>
            <input placeholder="openshift-monitoring" value={values.namespace || ''} onChange={(e) => update('namespace', e.target.value)} />
          </label>
          <label>
            <span>pod</span>
            <input placeholder="prometheus-k8s-0" value={values.pod || ''} onChange={(e) => update('pod', e.target.value)} />
          </label>
          <label>
            <span>instance</span>
            <input placeholder="pod-01:8080" value={values.instance || ''} onChange={(e) => update('instance', e.target.value)} />
          </label>
          <label>
            <span>job</span>
            <input placeholder="prometheus" value={values.job || ''} onChange={(e) => update('job', e.target.value)} />
          </label>
          <label className="full-width">
            <span>summary</span>
            <input placeholder="Target is down" value={values.summary || ''} onChange={(e) => update('summary', e.target.value)} />
          </label>
          <label className="full-width">
            <span>description</span>
            <input placeholder="Description of the alert" value={values.description || ''} onChange={(e) => update('description', e.target.value)} />
          </label>
          <label className="full-width">
            <span>generatorURL</span>
            <input placeholder="http://prometheus:9090/graph?g0.expr=..." value={values.generatorURL || ''} onChange={(e) => update('generatorURL', e.target.value)} />
          </label>
        </div>
      </div>
    );
  }

  if (pattern === 'confluent') {
    return (
      <div className="manual-values">
        <p className="manual-hint">ว่าง = random · กรอก = ใช้ค่าที่ระบุ</p>
        <div className="manual-grid">
          <label className="full-width">
            <span>id</span>
            <input placeholder="evt-test-123" value={values.id || ''} onChange={(e) => update('id', e.target.value)} />
          </label>
          <label className="full-width">
            <span>title</span>
            <input placeholder="Test alert" value={values.title || ''} onChange={(e) => update('title', e.target.value)} />
          </label>
          <label className="full-width">
            <span>message</span>
            <input placeholder="Test message for verification" value={values.message || ''} onChange={(e) => update('message', e.target.value)} />
          </label>
        </div>
      </div>
    );
  }

  return null;
}
