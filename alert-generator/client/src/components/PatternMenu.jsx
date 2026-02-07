import React from 'react';

const PATTERNS = [
  {
    id: 'ocp',
    title: 'OCP / Prometheus (Alertmanager)',
    description: 'Webhook format ตาม OpenShift & Prometheus Alertmanager',
  },
  {
    id: 'confluent',
    title: 'Confluent Cloud',
    description: 'Webhook format ตาม Confluent Cloud notifications',
  },
];

export default function PatternMenu({ value, onChange }) {
  return (
    <div className="cards">
      {PATTERNS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`card ${value === p.id ? 'active' : ''}`}
          onClick={() => onChange(p.id)}
        >
          <h3>{p.title}</h3>
          <p>{p.description}</p>
        </button>
      ))}
    </div>
  );
}
