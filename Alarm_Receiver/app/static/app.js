(function () {
  const base = window.location.origin;

  function api(url, opts = {}) {
    return fetch(base + url, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    }).then(r => r.json());
  }

  // Tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const id = 'panel-' + btn.dataset.tab;
      document.getElementById(id).classList.add('active');
      if (btn.dataset.tab === 'alarms') loadAlarms();
      if (btn.dataset.tab === 'keys') loadKeys();
      if (btn.dataset.tab === 'patterns') loadPatterns();
    });
  });

  // Alarms
  function loadAlarms() {
    const source = document.getElementById('filterSource').value;
    let url = '/api/alarms?limit=100';
    if (source) url += '&source=' + encodeURIComponent(source);
    api(url).then(data => {
      const tbody = document.getElementById('alarmsBody');
      const empty = document.getElementById('alarmsEmpty');
      tbody.innerHTML = '';
      if (!Array.isArray(data) || data.length === 0) {
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      data.forEach(a => {
        const tr = document.createElement('tr');
        const ts = a._received_at ? new Date(a._received_at).toLocaleString() : '-';
        tr.innerHTML = '<td>' + escapeHtml(ts) + '</td><td>' + escapeHtml(a._source || '-') + '</td><td>' + escapeHtml(a.severity || '-') + '</td><td>' + escapeHtml(a.message || '-') + '</td>';
        tbody.appendChild(tr);
      });
    }).catch(err => { document.getElementById('alarmsBody').innerHTML = '<tr><td colspan="4">โหลดไม่ได้: ' + err.message + '</td></tr>'; });
  }

  document.getElementById('btnRefreshAlarms').addEventListener('click', loadAlarms);
  document.getElementById('filterSource').addEventListener('change', loadAlarms);

  // API Keys
  function loadKeys() {
    api('/api/keys').then(data => {
      const tbody = document.getElementById('keysBody');
      tbody.innerHTML = '';
      (data || []).forEach(k => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + escapeHtml(k.name || '-') + '</td><td><code>' + escapeHtml(k.prefix || '-') + '</code></td><td>' + escapeHtml(k.created_at || '-') + '</td><td><button class="btn btn-danger btn-sm revoke" data-id="' + escapeHtml(k.id) + '">Revoke</button></td>';
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('.revoke').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!confirm('Revoke key นี้?')) return;
          fetch(base + '/api/keys/' + btn.dataset.id, { method: 'DELETE' })
            .then(r => r.json())
            .then(() => loadKeys())
            .catch(console.error);
        });
      });
    });
  }

  document.getElementById('btnGenerateKey').addEventListener('click', () => {
    const name = document.getElementById('keyName').value.trim() || 'default';
    api('/api/keys/generate', { method: 'POST', body: JSON.stringify({ name }) })
      .then(r => {
        const box = document.getElementById('keyResult');
        document.getElementById('keyValue').textContent = r.api_key || '';
        box.style.display = 'block';
        loadKeys();
      })
      .catch(err => alert('Generate ไม่ได้: ' + err.message));
  });

  // Patterns
  function loadPatterns() {
    api('/api/patterns').then(data => {
      const tbody = document.getElementById('patternsBody');
      tbody.innerHTML = '';
      (data || []).forEach(p => {
        const maps = (p.mappings || []).map(m => m.source_path + ' → ' + m.target_field).join(', ');
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + escapeHtml(p.name || '-') + '</td><td><code>' + escapeHtml(p.source_id || '-') + '</code></td><td>' + escapeHtml(maps || '-') + '</td>';
        tbody.appendChild(tr);
      });
    });
  }

  // Populate source filter from patterns
  api('/api/patterns').then(data => {
    const sel = document.getElementById('filterSource');
    (data || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.source_id;
      opt.textContent = p.source_id;
      sel.appendChild(opt);
    });
  });

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  // Initial load
  loadAlarms();
})();
