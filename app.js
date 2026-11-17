/* Status Report de Homologação — app estático (sem backend).
   Dados ficam no localStorage; backup via JSON. */
(function () {
  'use strict';

  const STORAGE_KEY = 'statusReport.v1';

  const TEST_STATUSES = [
    { key: 'passed', label: 'Passou', color: '#1f8a4c' },
    { key: 'failed', label: 'Falhou', color: '#c53030' },
    { key: 'blocked', label: 'Bloqueado', color: '#d97706' },
    { key: 'inprogress', label: 'Em andamento', color: '#2f5bd3' },
    { key: 'pending', label: 'Não executado', color: '#a0aec0' },
    { key: 'na', label: 'N/A', color: '#cbd5e0' },
  ];
  const STATUS_BY_KEY = Object.fromEntries(TEST_STATUSES.map(s => [s.key, s]));

  const SEVERITIES = ['Crítica', 'Alta', 'Média', 'Baixa'];
  const SEV_COLORS = { 'Crítica': '#9b1c1c', 'Alta': '#c05621', 'Média': '#b7791f', 'Baixa': '#718096' };
  const OPEN_BUG_STATUSES = ['Aberto', 'Em correção', 'Aguardando reteste'];
  const NOTE_TYPES = {
    resumo: 'Resumo do dia',
    destaque: 'Destaques',
    risco: 'Riscos',
    impedimento: 'Impedimentos',
    proximos: 'Próximos passos',
  };
  const HEALTH = {
    green: { label: 'No prazo', color: '#1f8a4c', bg: '#e6f4ea' },
    yellow: { label: 'Atenção', color: '#b7791f', bg: '#fdf6e3' },
    red: { label: 'Crítico', color: '#c53030', bg: '#fdecec' },
  };

  // Field definitions for test plan column detection
  const FIELDS = [
    { key: 'id', label: 'ID', patterns: [/^id$/, /^#$/, /^(cod|codigo|cód)/, /^ct\b/, /^(test ?id|tc ?id|caso id|id do caso|id caso|id cenario|id do cenario)/, /\bid\b/] },
    { key: 'title', label: 'Cenário / Caso', patterns: [/cenario/, /caso de teste/, /^caso/, /titulo/, /test ?case/, /scenario/, /summary/, /resumo/, /descricao/, /nome/] },
    { key: 'module', label: 'Módulo', patterns: [/modulo/, /funcionalidade/, /feature/, /^area/, /componente/, /suite/, /epico/, /epic/, /jornada/, /fluxo/] },
    { key: 'owner', label: 'Responsável', patterns: [/responsavel/, /executor/, /tester/, /owner/, /analista/, /assignee/, /executado por/] },
    { key: 'status', label: 'Status / Resultado', patterns: [/^status/, /resultado/, /situacao/, /result/, /execucao/, /state/] },
  ];

  // ---------- State ----------
  const emptyState = () => ({
    project: { name: '', release: '', environment: '', owner: '', startDate: '', endDate: '', scope: '', statusOverride: '', audience: '' },
    tests: [],
    planFile: '',
    bugs: [],
    notes: [],
  });

  let state = load();
  let pendingImport = null; // { workbook|rows, headers, sheet }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      return Object.assign(emptyState(), parsed, { project: Object.assign(emptyState().project, parsed.project || {}) });
    } catch (e) {
      return emptyState();
    }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { toast('Não foi possível salvar no navegador.'); }
  }

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const today = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
  };
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const fmtPct = (n) => `${String(n).replace('.', ',')}%`;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function normalizeStatus(v) {
    const s = norm(v);
    if (!s) return 'pending';
    if (/^(n\/a\b|na$|nao aplicavel|cancelad|descartad|fora de escopo|skip)/.test(s)) return 'na';
    if (/(bloquead|blocked|impedid)/.test(s)) return 'blocked';
    if (/(falh|fail|reprovad|erro|error|nok|defeito|bug)/.test(s)) return 'failed';
    if (/(andamento|em execucao|executando|in progress|progress|wip|reteste)/.test(s)) return 'inprogress';
    if (/(nao execut|pendente|pending|not run|no run|to do|todo|a executar|nao iniciad)/.test(s)) return 'pending';
    if (/(passou|passed|^pass|^ok$|aprovad|sucesso|success|conclu|done|execut)/.test(s)) return 'passed';
    return 'pending';
  }

  function detectMapping(headers) {
    const used = new Set();
    const mapping = {};
    const normHeaders = headers.map(norm);
    FIELDS.forEach(f => {
      for (const p of f.patterns) {
        const idx = normHeaders.findIndex((h, i) => !used.has(i) && p.test(h));
        if (idx >= 0) { mapping[f.key] = headers[idx]; used.add(idx); return; }
      }
      mapping[f.key] = '';
    });
    return mapping;
  }

  // ---------- Metrics ----------
  function testMetrics() {
    const counts = Object.fromEntries(TEST_STATUSES.map(s => [s.key, 0]));
    state.tests.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
    const total = state.tests.length - counts.na;
    const executed = counts.passed + counts.failed;
    const byModule = {};
    state.tests.forEach(t => {
      const m = t.module || 'Sem módulo';
      byModule[m] = byModule[m] || Object.fromEntries(TEST_STATUSES.map(s => [s.key, 0]));
      byModule[m][t.status]++;
    });
    return {
      counts, total, executed,
      execPct: pct(executed, total),
      passPct: pct(counts.passed, executed),
      blockedPct: pct(counts.blocked, total),
      byModule,
    };
  }

  function bugMetrics() {
    const open = state.bugs.filter(b => OPEN_BUG_STATUSES.includes(b.status));
    const bySev = Object.fromEntries(SEVERITIES.map(s => [s, { open: 0, closed: 0 }]));
    state.bugs.forEach(b => {
      const k = bySev[b.severity] ? b.severity : 'Média';
      bySev[k][OPEN_BUG_STATUSES.includes(b.status) ? 'open' : 'closed']++;
    });
    return { total: state.bugs.length, open, openCount: open.length, closedCount: state.bugs.length - open.length, bySev };
  }

  function computeHealth(tm, bm) {
    if (state.project.statusOverride) return { key: state.project.statusOverride, reasons: ['Definido manualmente'] };
    const reasons = [];
    let key = 'green';
    const bump = (k, why) => { reasons.push(why); if (k === 'red' || (k === 'yellow' && key === 'green')) key = k; };
    if (bm.bySev['Crítica'].open) bump('red', `${bm.bySev['Crítica'].open} bug(s) crítico(s) em aberto`);
    if (tm.total && tm.executed && tm.passPct < 70) bump('red', `Taxa de sucesso de ${fmtPct(tm.passPct)}`);
    if (tm.blockedPct >= 15) bump('red', `${fmtPct(tm.blockedPct)} dos cenários bloqueados`);
    if (bm.bySev['Alta'].open) bump('yellow', `${bm.bySev['Alta'].open} bug(s) de severidade alta em aberto`);
    if (tm.total && tm.executed && tm.passPct < 90 && tm.passPct >= 70) bump('yellow', `Taxa de sucesso de ${fmtPct(tm.passPct)}`);
    if (tm.counts.blocked && tm.blockedPct < 15) bump('yellow', `${tm.counts.blocked} cenário(s) bloqueado(s)`);
    if (state.notes.some(n => n.type === 'impedimento' && n.date === reportDate())) bump('yellow', 'Impedimento registrado no dia');
    // Schedule: execution behind elapsed time
    const { startDate, endDate } = state.project;
    if (startDate && endDate && tm.total) {
      const s = new Date(startDate), e = new Date(endDate), r = new Date(reportDate());
      const span = (e - s) / 864e5 + 1;
      if (span > 0) {
        const elapsed = Math.min(Math.max(((r - s) / 864e5 + 1) / span, 0), 1) * 100;
        if (r > e && tm.execPct < 100) bump('red', 'Prazo da homologação vencido com execução incompleta');
        else if (elapsed - tm.execPct > 20) bump('yellow', `Execução (${fmtPct(tm.execPct)}) abaixo do tempo decorrido (${Math.round(elapsed)}%)`);
      }
    }
    if (!reasons.length) reasons.push('Sem bloqueios relevantes');
    return { key, reasons };
  }

  // ---------- Tabs ----------
  function showTab(name) {
    $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
    if (name === 'report') renderReport();
    try { sessionStorage.setItem('statusReport.tab', name); } catch (e) { /* ignore */ }
  }

  // ---------- Project ----------
  function renderProject() {
    const f = $('#projectForm');
    Object.entries(state.project).forEach(([k, v]) => { if (f.elements[k]) f.elements[k].value = v || ''; });
    $('#brandProject').textContent = state.project.name || 'Status Report';
    $('#brandSub').textContent = [state.project.release, state.project.environment].filter(Boolean).join(' · ') || 'Homologação';
  }

  // ---------- Test plan ----------
  async function handlePlanFile(file) {
    if (!file) return;
    $('#planFileName').textContent = file.name;
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'json') {
        const data = JSON.parse(await file.text());
        const rows = Array.isArray(data) ? data : (data.tests || data.rows || data.data || []);
        prepareImport({ sheets: { JSON: rows }, fileName: file.name });
      } else if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const text = await file.text();
        prepareImport({ sheets: { CSV: parseDelimited(text) }, fileName: file.name });
      } else {
        if (!window.XLSX) { toast('Leitor de Excel ainda carregando, tente novamente.'); return; }
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        const sheets = {};
        wb.SheetNames.forEach(n => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: false }); });
        prepareImport({ sheets, fileName: file.name });
      }
    } catch (err) {
      console.error(err);
      toast('Não consegui ler o arquivo. Verifique o formato.');
    }
  }

  function parseDelimited(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/)[0] || '';
    const delim = ['\t', ';', ','].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const nonEmpty = rows.filter(r => r.some(c => String(c).trim()));
    if (!nonEmpty.length) return [];
    const headers = nonEmpty[0].map((h, i) => String(h).trim() || `Coluna ${i + 1}`);
    return nonEmpty.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] == null ? '' : r[i]])));
  }

  // Pick the sheet that most looks like a test plan
  function bestSheet(sheets) {
    let best = null, bestScore = -1;
    Object.entries(sheets).forEach(([name, rows]) => {
      if (!rows.length) return;
      const m = detectMapping(Object.keys(rows[0]));
      const score = Object.values(m).filter(Boolean).length * 1000 + rows.length;
      if (score > bestScore) { best = name; bestScore = score; }
    });
    return best || Object.keys(sheets)[0];
  }

  function prepareImport({ sheets, fileName }) {
    const names = Object.keys(sheets);
    const sheet = bestSheet(sheets);
    pendingImport = { sheets, fileName, sheet };
    const picker = $('#sheetPicker');
    picker.innerHTML = names.map(n => `<option ${n === sheet ? 'selected' : ''}>${esc(n)}</option>`).join('');
    $('#sheetPickerWrap').hidden = names.length < 2;
    renderMapping();
    const rows = sheets[sheet] || [];
    const mapping = detectMapping(rows.length ? Object.keys(rows[0]) : []);
    if (mapping.title && mapping.status) {
      applyImport(mapping);
      toast(`${state.tests.length} cenários importados de "${fileName}".`);
    } else {
      toast('Confira o mapeamento das colunas e clique em aplicar.');
    }
  }

  function renderMapping() {
    if (!pendingImport) { $('#mappingCard').hidden = true; return; }
    const rows = pendingImport.sheets[pendingImport.sheet] || [];
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const mapping = pendingImport.mapping && pendingImport.mappingSheet === pendingImport.sheet ? pendingImport.mapping : detectMapping(headers);
    $('#mappingFields').innerHTML = FIELDS.map(f => `
      <label>${esc(f.label)}
        <select data-field="${f.key}">
          <option value="">— não usar —</option>
          ${headers.map(h => `<option ${h === mapping[f.key] ? 'selected' : ''}>${esc(h)}</option>`).join('')}
        </select>
      </label>`).join('');
    $('#mappingCard').hidden = false;
  }

  function currentMappingFromUI() {
    const m = {};
    $$('#mappingFields select').forEach(s => { m[s.dataset.field] = s.value; });
    return m;
  }

  function applyImport(mapping) {
    const rows = pendingImport.sheets[pendingImport.sheet] || [];
    pendingImport.mapping = mapping;
    pendingImport.mappingSheet = pendingImport.sheet;
    const get = (r, k) => (mapping[k] ? String(r[mapping[k]] == null ? '' : r[mapping[k]]).trim() : '');
    const tests = rows
      .filter(r => get(r, 'title') || get(r, 'id'))
      .map((r, i) => ({
        uid: uid(),
        id: get(r, 'id') || `CT-${String(i + 1).padStart(3, '0')}`,
        title: get(r, 'title'),
        module: get(r, 'module'),
        owner: get(r, 'owner'),
        status: normalizeStatus(get(r, 'status')),
      }));
    state.tests = tests;
    state.planFile = pendingImport.fileName;
    save();
    renderPlan();
    renderMapping();
  }

  function renderPlan() {
    const tm = testMetrics();
    $('#planKpis').innerHTML = state.tests.length ? [
      ['Cenários', tm.total],
      ['Executados', `${tm.executed} <small>(${fmtPct(tm.execPct)})</small>`],
      ['Passou', tm.counts.passed],
      ['Falhou', tm.counts.failed],
      ['Bloqueados', tm.counts.blocked],
      ['Não executados', tm.counts.pending + tm.counts.inprogress],
      ['Taxa de sucesso', fmtPct(tm.passPct)],
    ].map(([l, v]) => `<div class="kpi"><span>${l}</span><strong>${v}</strong></div>`).join('') : '';

    const q = norm($('#testSearch').value);
    const f = $('#testFilter').value;
    const list = state.tests.filter(t => (!f || t.status === f) && (!q || norm(`${t.id} ${t.title} ${t.module} ${t.owner}`).includes(q)));
    $('#testTable tbody').innerHTML = list.map(t => `
      <tr data-uid="${t.uid}">
        <td>${esc(t.id)}</td>
        <td>${esc(t.title)}</td>
        <td>${esc(t.module)}</td>
        <td>${esc(t.owner)}</td>
        <td><select class="test-status">${TEST_STATUSES.map(s => `<option value="${s.key}" ${s.key === t.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select></td>
        <td class="actions"><button class="btn small ghost" data-act="bug" title="Abrir bug para este cenário">+ Bug</button> <button class="btn small ghost" data-act="del" title="Remover">✕</button></td>
      </tr>`).join('');
    $('#testEmpty').hidden = state.tests.length > 0;
    $('#testEmpty').textContent = state.tests.length ? '' : 'Nenhum plano carregado ainda.';
    $('#planFileName').textContent = state.planFile ? `Plano atual: ${state.planFile}` : '';

    $('#moduleList').innerHTML = [...new Set(state.tests.map(t => t.module).filter(Boolean))].map(m => `<option value="${esc(m)}">`).join('');
    $('#testIdList').innerHTML = state.tests.map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('');
  }

  // ---------- Bugs ----------
  function renderBugs() {
    const q = norm($('#bugSearch').value);
    const f = $('#bugFilter').value;
    const sevOrder = (b) => SEVERITIES.indexOf(b.severity);
    const list = state.bugs
      .filter(b => (f !== 'open' || OPEN_BUG_STATUSES.includes(b.status)) && (!q || norm(`${b.key} ${b.title} ${b.module} ${b.owner}`).includes(q)))
      .sort((a, b) => sevOrder(a) - sevOrder(b) || (b.createdAt || '').localeCompare(a.createdAt || ''));
    $('#bugTable tbody').innerHTML = list.map(b => `
      <tr data-uid="${b.uid}">
        <td>${b.link ? `<a href="${esc(b.link)}" target="_blank" rel="noopener">${esc(b.key || '—')}</a>` : esc(b.key || '—')}</td>
        <td>${esc(b.title)}${b.notes ? `<br><small style="color:var(--muted)">${esc(b.notes)}</small>` : ''}</td>
        <td><span class="pill sev-${esc(b.severity)}">${esc(b.severity)}</span></td>
        <td><select class="bug-status">${['Aberto', 'Em correção', 'Aguardando reteste', 'Corrigido', 'Fechado', 'Rejeitado'].map(s => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td>${esc(b.module)}</td>
        <td>${esc(b.owner)}</td>
        <td>${fmtDate(b.createdAt)}</td>
        <td class="actions"><button class="btn small ghost" data-act="edit">Editar</button> <button class="btn small ghost" data-act="del">✕</button></td>
      </tr>`).join('');
    $('#bugEmpty').hidden = list.length > 0;
    $('#bugEmpty').textContent = state.bugs.length ? 'Nenhum bug com esse filtro.' : 'Nenhum bug cadastrado.';
    const open = state.bugs.filter(b => OPEN_BUG_STATUSES.includes(b.status)).length;
    $('#bugCount').textContent = open;
    $('#bugCount').hidden = !open;
  }

  function resetBugForm() {
    const f = $('#bugForm');
    f.reset();
    f.elements.uid.value = '';
    $('#bugSubmit').textContent = 'Cadastrar bug';
    $('#bugCancel').hidden = true;
  }

  // ---------- Notes ----------
  function renderNotes() {
    const byDate = {};
    state.notes.forEach(n => { (byDate[n.date] = byDate[n.date] || []).push(n); });
    const dates = Object.keys(byDate).sort().reverse();
    $('#noteList').innerHTML = dates.map(d => `
      <div class="note-day">
        <h3>${fmtDate(d)}${d === today() ? ' — hoje' : ''}</h3>
        ${byDate[d].map(n => `
          <div class="note ${esc(n.type)}" data-uid="${n.uid}">
            <span class="tag">${esc(NOTE_TYPES[n.type] || n.type)}</span>
            <p>${esc(n.text)}</p>
            <button class="btn small ghost" data-act="del" title="Remover">✕</button>
          </div>`).join('')}
      </div>`).join('');
    $('#noteEmpty').hidden = state.notes.length > 0;
  }

  // ---------- Report ----------
  function reportDate() { return $('#reportDate').value || today(); }

  function buildReportHtml() {
    const p = state.project;
    const tm = testMetrics();
    const bm = bugMetrics();
    const health = computeHealth(tm, bm);
    const h = HEALTH[health.key] || HEALTH.green;
    const date = reportDate();
    const dayNotes = state.notes.filter(n => n.date === date);
    const font = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;";
    const sectionTitle = (t) => `<h2 style="${font}font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:#2f5bd3;margin:28px 0 10px;border-bottom:2px solid #e8eefc;padding-bottom:6px;">${t}</h2>`;
    const cell = 'padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top;font-size:13px;';
    const th = cell + 'background:#f5f6f8;color:#5d6676;font-size:11px;text-transform:uppercase;letter-spacing:.03em;';

    // KPI tiles (table-based for e-mail clients)
    const kpis = [
      ['Cenários', tm.total],
      ['Execução', fmtPct(tm.execPct)],
      ['Sucesso', tm.executed ? fmtPct(tm.passPct) : '—'],
      ['Bloqueados', tm.counts.blocked],
      ['Bugs abertos', bm.openCount],
      ['Bugs fechados', bm.closedCount],
    ];
    const kpiHtml = `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px;"><tr>${kpis.map(([l, v]) => `
      <td style="${font}background:#f5f6f8;border-radius:8px;padding:12px;text-align:center;width:${100 / kpis.length}%;">
        <div style="font-size:24px;font-weight:700;color:#1d2330;">${esc(v)}</div>
        <div style="font-size:11px;color:#5d6676;text-transform:uppercase;letter-spacing:.03em;">${l}</div>
      </td>`).join('')}</tr></table>`;

    // Execution bar
    const barSegs = TEST_STATUSES.filter(s => tm.counts[s.key] && s.key !== 'na').map(s => {
      const w = pct(tm.counts[s.key], tm.total);
      return `<td style="background:${s.color};width:${w}%;height:14px;padding:0;" title="${s.label}: ${tm.counts[s.key]}"></td>`;
    }).join('');
    const legend = TEST_STATUSES.filter(s => s.key !== 'na' || tm.counts.na).map(s => `
      <span style="display:inline-block;margin:6px 14px 0 0;font-size:12px;color:#1d2330;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${s.color};margin-right:5px;vertical-align:middle;"></span>${s.label}: <b>${tm.counts[s.key]}</b> (${fmtPct(pct(tm.counts[s.key], s.key === 'na' ? state.tests.length : tm.total))})</span>`).join('');

    const moduleRows = Object.entries(tm.byModule).sort((a, b) => a[0].localeCompare(b[0])).map(([m, c]) => {
      const tot = TEST_STATUSES.reduce((a, s) => a + (s.key === 'na' ? 0 : c[s.key]), 0);
      const exe = c.passed + c.failed;
      const openBugs = bm.open.filter(b => (b.module || '') === m).length;
      return `<tr>
        <td style="${cell}">${esc(m)}</td>
        <td style="${cell}text-align:center;">${tot}</td>
        <td style="${cell}text-align:center;color:#1f8a4c;font-weight:600;">${c.passed}</td>
        <td style="${cell}text-align:center;color:#c53030;font-weight:600;">${c.failed}</td>
        <td style="${cell}text-align:center;color:#d97706;font-weight:600;">${c.blocked}</td>
        <td style="${cell}text-align:center;">${c.pending + c.inprogress}</td>
        <td style="${cell}min-width:120px;">
          <div style="background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden;"><div style="background:#2f5bd3;height:8px;width:${pct(exe, tot)}%;"></div></div>
          <span style="font-size:11px;color:#5d6676;">${fmtPct(pct(exe, tot))}</span>
        </td>
        <td style="${cell}text-align:center;">${openBugs}</td>
      </tr>`;
    }).join('');

    const sevRows = SEVERITIES.map(s => `
      <tr>
        <td style="${cell}"><span style="color:${SEV_COLORS[s]};font-weight:700;">●</span> ${s}</td>
        <td style="${cell}text-align:center;font-weight:600;">${bm.bySev[s].open}</td>
        <td style="${cell}text-align:center;">${bm.bySev[s].closed}</td>
      </tr>`).join('');

    const openBugsRows = bm.open
      .slice()
      .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
      .map(b => `<tr>
        <td style="${cell}white-space:nowrap;">${b.link ? `<a href="${esc(b.link)}" style="color:#2f5bd3;">${esc(b.key || '—')}</a>` : esc(b.key || '—')}</td>
        <td style="${cell}">${esc(b.title)}${b.notes ? `<div style="color:#5d6676;font-size:12px;">${esc(b.notes)}</div>` : ''}</td>
        <td style="${cell}color:${SEV_COLORS[b.severity] || '#1d2330'};font-weight:600;">${esc(b.severity)}</td>
        <td style="${cell}">${esc(b.status)}</td>
        <td style="${cell}">${esc(b.module)}</td>
        <td style="${cell}">${esc(b.owner)}</td>
      </tr>`).join('');

    const blockedTests = state.tests.filter(t => t.status === 'blocked' || t.status === 'failed');
    const blockedRows = blockedTests.map(t => `<tr>
      <td style="${cell}white-space:nowrap;">${esc(t.id)}</td>
      <td style="${cell}">${esc(t.title)}</td>
      <td style="${cell}">${esc(t.module)}</td>
      <td style="${cell}color:${STATUS_BY_KEY[t.status].color};font-weight:600;">${STATUS_BY_KEY[t.status].label}</td>
    </tr>`).join('');

    const notesHtml = Object.keys(NOTE_TYPES).map(type => {
      const items = dayNotes.filter(n => n.type === type);
      if (!items.length) return '';
      return `<h3 style="${font}font-size:13px;margin:14px 0 6px;color:#1d2330;">${NOTE_TYPES[type]}</h3>
        <ul style="${font}margin:0;padding-left:20px;font-size:13px;color:#1d2330;">${items.map(n => `<li style="margin-bottom:4px;white-space:pre-wrap;">${esc(n.text)}</li>`).join('')}</ul>`;
    }).join('');

    const meta = [
      p.release && ['Release', p.release],
      p.environment && ['Ambiente', p.environment],
      (p.startDate || p.endDate) && ['Período', `${fmtDate(p.startDate) || '?'} a ${fmtDate(p.endDate) || '?'}`],
      p.owner && ['Responsável QA', p.owner],
      p.audience && ['Para', p.audience],
    ].filter(Boolean);

    return `
<div style="${font}color:#1d2330;max-width:900px;margin:0 auto;background:#ffffff;">
  <div style="background:#1d2330;color:#ffffff;padding:22px 26px;">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.7;">Status report de homologação · ${fmtDate(date)}</div>
    <div style="font-size:24px;font-weight:700;margin-top:4px;">${esc(p.name || 'Projeto sem nome')}</div>
    ${meta.length ? `<div style="font-size:13px;margin-top:8px;opacity:.85;">${meta.map(([k, v]) => `<span style="margin-right:18px;">${k}: <b>${esc(v)}</b></span>`).join('')}</div>` : ''}
  </div>
  <div style="padding:6px 26px 28px;">
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:20px;"><tr>
      <td style="${font}background:${h.bg};border-left:6px solid ${h.color};padding:14px 16px;border-radius:6px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#5d6676;">Status geral</div>
        <div style="font-size:20px;font-weight:700;color:${h.color};">● ${h.label}</div>
        <div style="font-size:13px;color:#1d2330;margin-top:4px;">${health.reasons.map(esc).join(' · ')}</div>
      </td>
    </tr></table>
    ${p.scope ? `<p style="${font}font-size:13px;color:#5d6676;margin:14px 0 0;white-space:pre-wrap;"><b style="color:#1d2330;">Escopo:</b> ${esc(p.scope)}</p>` : ''}

    ${sectionTitle('Indicadores')}
    ${kpiHtml}

    ${state.tests.length ? `
    ${sectionTitle('Execução do plano de teste')}
    <table role="presentation" style="width:100%;border-collapse:collapse;border-radius:4px;overflow:hidden;"><tr>${barSegs}</tr></table>
    <div>${legend}</div>
    ${state.planFile ? `<div style="font-size:11px;color:#8a93a3;margin-top:6px;">Fonte: ${esc(state.planFile)}</div>` : ''}
    <table style="width:100%;border-collapse:collapse;margin-top:14px;">
      <thead><tr><th style="${th}">Módulo</th><th style="${th}text-align:center;">Total</th><th style="${th}text-align:center;">Passou</th><th style="${th}text-align:center;">Falhou</th><th style="${th}text-align:center;">Bloq.</th><th style="${th}text-align:center;">Pend.</th><th style="${th}">Execução</th><th style="${th}text-align:center;">Bugs abertos</th></tr></thead>
      <tbody>${moduleRows}</tbody>
    </table>` : ''}

    ${sectionTitle('Comentários do dia')}
    ${notesHtml || `<p style="${font}font-size:13px;color:#8a93a3;">Nenhum comentário registrado para ${fmtDate(date)}.</p>`}

    ${sectionTitle('Bugs')}
    <table style="width:100%;border-collapse:collapse;max-width:360px;">
      <thead><tr><th style="${th}">Severidade</th><th style="${th}text-align:center;">Abertos</th><th style="${th}text-align:center;">Fechados</th></tr></thead>
      <tbody>${sevRows}</tbody>
    </table>
    ${bm.openCount ? `
    <h3 style="${font}font-size:13px;margin:16px 0 6px;">Bugs em aberto (${bm.openCount})</h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr><th style="${th}">ID</th><th style="${th}">Título</th><th style="${th}">Sev.</th><th style="${th}">Status</th><th style="${th}">Módulo</th><th style="${th}">Resp.</th></tr></thead>
      <tbody>${openBugsRows}</tbody>
    </table>` : `<p style="${font}font-size:13px;color:#1f8a4c;">Nenhum bug em aberto.</p>`}

    ${blockedTests.length ? `
    ${sectionTitle(`Cenários com falha ou bloqueados (${blockedTests.length})`)}
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr><th style="${th}">ID</th><th style="${th}">Cenário</th><th style="${th}">Módulo</th><th style="${th}">Status</th></tr></thead>
      <tbody>${blockedRows}</tbody>
    </table>` : ''}

    <p style="${font}font-size:11px;color:#8a93a3;margin-top:28px;border-top:1px solid #e2e8f0;padding-top:10px;">Gerado em ${new Date().toLocaleString('pt-BR')}${p.owner ? ` por ${esc(p.owner)}` : ''}.</p>
  </div>
</div>`;
  }

  function buildReportText() {
    const p = state.project;
    const tm = testMetrics();
    const bm = bugMetrics();
    const health = computeHealth(tm, bm);
    const date = reportDate();
    const dot = { green: '🟢', yellow: '🟡', red: '🔴' }[health.key];
    const lines = [];
    lines.push(`*Status Report — ${p.name || 'Projeto'}* (${fmtDate(date)})`);
    const meta = [p.release, p.environment].filter(Boolean).join(' · ');
    if (meta) lines.push(meta);
    lines.push('');
    lines.push(`${dot} Status geral: *${HEALTH[health.key].label}* — ${health.reasons.join('; ')}`);
    lines.push('');
    if (state.tests.length) {
      lines.push('*Execução*');
      lines.push(`• ${tm.executed}/${tm.total} cenários executados (${fmtPct(tm.execPct)})`);
      lines.push(`• Passou: ${tm.counts.passed} | Falhou: ${tm.counts.failed} | Bloqueado: ${tm.counts.blocked} | Pendente: ${tm.counts.pending + tm.counts.inprogress}`);
      if (tm.executed) lines.push(`• Taxa de sucesso: ${fmtPct(tm.passPct)}`);
      lines.push('');
    }
    lines.push('*Bugs*');
    lines.push(`• Abertos: ${bm.openCount} (${SEVERITIES.map(s => `${s}: ${bm.bySev[s].open}`).join(', ')}) | Fechados: ${bm.closedCount}`);
    bm.open.slice().sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)).forEach(b => {
      lines.push(`   - [${b.severity}] ${b.key ? b.key + ' — ' : ''}${b.title} (${b.status})`);
    });
    const dayNotes = state.notes.filter(n => n.date === date);
    Object.keys(NOTE_TYPES).forEach(type => {
      const items = dayNotes.filter(n => n.type === type);
      if (!items.length) return;
      lines.push('');
      lines.push(`*${NOTE_TYPES[type]}*`);
      items.forEach(n => lines.push(`• ${n.text}`));
    });
    return lines.join('\n');
  }

  function renderReport() { $('#report').innerHTML = buildReportHtml(); }

  function standaloneHtml() {
    const name = state.project.name || 'Status Report';
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(name)} — ${fmtDate(reportDate())}</title></head><body style="margin:0;background:#f5f6f8;padding:20px 0;">${buildReportHtml()}</body></html>`;
  }

  async function copyRich(html, text) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
        return true;
      }
    } catch (e) { /* fallback below */ }
    const div = document.createElement('div');
    div.innerHTML = html;
    div.style.position = 'fixed'; div.style.left = '-9999px';
    document.body.appendChild(div);
    const range = document.createRange(); range.selectNodeContents(div);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    const ok = document.execCommand('copy');
    sel.removeAllRanges(); div.remove();
    return ok;
  }

  async function copyPlain(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    }
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const slug = (s) => norm(s || 'status-report').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'status-report';

  // ---------- Demo data ----------
  function demoState() {
    const t = today();
    const d = (offset) => { const x = new Date(t); x.setDate(x.getDate() + offset); return x.toISOString().slice(0, 10); };
    const mods = ['Cotação', 'Emissão', 'Pagamento', 'Portal do Corretor'];
    const st = ['passed', 'passed', 'passed', 'failed', 'blocked', 'pending', 'passed', 'inprogress', 'passed', 'pending'];
    const tests = Array.from({ length: 32 }, (_, i) => ({
      uid: uid(), id: `CT-${String(i + 1).padStart(3, '0')}`,
      title: [`Validar cálculo de prêmio`, `Gerar proposta em PDF`, `Pagamento via boleto`, `Login do corretor`, `Endosso de inclusão`, `Validação de CEP`, `Cancelamento de apólice`, `Reenvio de e-mail`][i % 8] + ` — cenário ${i + 1}`,
      module: mods[i % mods.length], owner: ['Ana', 'Bruno', 'Carla'][i % 3], status: st[i % st.length],
    }));
    return {
      project: { name: 'Portal de Cotação (exemplo)', release: 'R2.4', environment: 'HML', owner: 'Equipe QA', startDate: d(-4), endDate: d(5), scope: 'Homologação do novo fluxo de cotação e emissão para corretores.', statusOverride: '', audience: 'PO, Dev, Negócio' },
      tests, planFile: 'exemplo.xlsx',
      bugs: [
        { uid: uid(), key: 'BUG-101', title: 'Prêmio calculado com desconto duplicado', severity: 'Alta', status: 'Em correção', module: 'Cotação', owner: 'Squad Cotação', testId: 'CT-004', link: '', notes: 'Afeta cotações com mais de 2 coberturas.', createdAt: d(-2) },
        { uid: uid(), key: 'BUG-102', title: 'Boleto não é gerado para PJ', severity: 'Crítica', status: 'Aberto', module: 'Pagamento', owner: 'Squad Pagamentos', testId: 'CT-003', link: '', notes: '', createdAt: d(-1) },
        { uid: uid(), key: 'BUG-097', title: 'Texto cortado no PDF da proposta', severity: 'Baixa', status: 'Fechado', module: 'Emissão', owner: 'Squad Emissão', testId: '', link: '', notes: '', createdAt: d(-4) },
      ],
      notes: [
        { uid: uid(), date: t, type: 'resumo', text: 'Execução seguiu conforme planejado no módulo de Cotação; Pagamento parcialmente bloqueado.' },
        { uid: uid(), date: t, type: 'impedimento', text: 'Ambiente de HML do gateway de pagamento instável desde 14h.' },
        { uid: uid(), date: t, type: 'proximos', text: 'Retestar BUG-101 após deploy previsto para amanhã 10h.' },
      ],
    };
  }

  // ---------- Events ----------
  function bind() {
    $$('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

    $('#projectForm').addEventListener('input', (e) => {
      const el = e.target; if (!el.name) return;
      state.project[el.name] = el.value; save(); renderProject();
    });

    // Backup
    $('#exportJson').addEventListener('click', () => {
      download(`${slug(state.project.name)}-backup-${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
    });
    $('#importJson').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data || typeof data !== 'object' || !('tests' in data || 'bugs' in data || 'project' in data)) throw new Error('formato');
        state = Object.assign(emptyState(), data, { project: Object.assign(emptyState().project, data.project || {}) });
        save(); renderAll(); toast('Backup importado.');
      } catch (err) { toast('Arquivo de backup inválido.'); }
      e.target.value = '';
    });
    $('#loadDemo').addEventListener('click', () => {
      if ((state.tests.length || state.bugs.length || state.notes.length) && !confirm('Substituir os dados atuais pelos dados de exemplo?')) return;
      state = demoState(); save(); renderAll(); toast('Dados de exemplo carregados.');
    });
    $('#resetAll').addEventListener('click', () => {
      if (!confirm('Apagar todos os dados (projeto, plano, bugs e comentários)? Exporte um backup antes se precisar.')) return;
      state = emptyState(); pendingImport = null; save(); renderAll(); toast('Dados apagados.');
    });

    // Plan upload
    const dz = $('#dropzone');
    $('#planFile').addEventListener('change', (e) => { handlePlanFile(e.target.files[0]); e.target.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', (e) => handlePlanFile(e.dataTransfer.files[0]));
    $('#applyMapping').addEventListener('click', () => {
      const m = currentMappingFromUI();
      if (!m.title && !m.id) { toast('Escolha ao menos a coluna de cenário ou de ID.'); return; }
      applyImport(m); toast(`${state.tests.length} cenários importados.`);
    });
    $('#sheetPicker').addEventListener('change', (e) => {
      if (!pendingImport) return;
      pendingImport.sheet = e.target.value; renderMapping();
    });

    $('#testFilter').innerHTML += TEST_STATUSES.map(s => `<option value="${s.key}">${s.label}</option>`).join('');
    $('#testSearch').addEventListener('input', renderPlan);
    $('#testFilter').addEventListener('change', renderPlan);
    $('#addTest').addEventListener('click', () => {
      const title = prompt('Descrição do cenário:'); if (!title) return;
      const module = prompt('Módulo (opcional):') || '';
      state.tests.push({ uid: uid(), id: `CT-${String(state.tests.length + 1).padStart(3, '0')}`, title, module, owner: state.project.owner || '', status: 'pending' });
      save(); renderPlan();
    });
    $('#testTable').addEventListener('change', (e) => {
      if (!e.target.classList.contains('test-status')) return;
      const t = state.tests.find(x => x.uid === e.target.closest('tr').dataset.uid);
      if (t) { t.status = e.target.value; save(); renderPlan(); }
    });
    $('#testTable').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]'); if (!btn) return;
      const t = state.tests.find(x => x.uid === btn.closest('tr').dataset.uid); if (!t) return;
      if (btn.dataset.act === 'del') {
        if (!confirm(`Remover o cenário ${t.id}?`)) return;
        state.tests = state.tests.filter(x => x !== t); save(); renderPlan();
      } else if (btn.dataset.act === 'bug') {
        resetBugForm();
        const f = $('#bugForm');
        f.elements.testId.value = t.id; f.elements.module.value = t.module; f.elements.title.value = t.title;
        showTab('bugs'); f.elements.title.focus();
      }
    });

    // Bugs
    $('#bugForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const data = Object.fromEntries(new FormData(f).entries());
      if (data.uid) {
        const b = state.bugs.find(x => x.uid === data.uid);
        if (b) Object.assign(b, data);
        toast('Bug atualizado.');
      } else {
        data.uid = uid(); data.createdAt = today();
        if (!data.key) data.key = `BUG-${String(state.bugs.length + 1).padStart(3, '0')}`;
        state.bugs.push(data);
        // Link failing test automatically
        const t = data.testId && state.tests.find(x => x.id === data.testId);
        if (t && (t.status === 'pending' || t.status === 'inprogress' || t.status === 'passed')) t.status = 'failed';
        toast('Bug cadastrado.');
      }
      save(); resetBugForm(); renderBugs(); renderPlan();
    });
    $('#bugCancel').addEventListener('click', resetBugForm);
    $('#bugSearch').addEventListener('input', renderBugs);
    $('#bugFilter').addEventListener('change', renderBugs);
    $('#bugTable').addEventListener('change', (e) => {
      if (!e.target.classList.contains('bug-status')) return;
      const b = state.bugs.find(x => x.uid === e.target.closest('tr').dataset.uid);
      if (b) { b.status = e.target.value; save(); renderBugs(); }
    });
    $('#bugTable').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]'); if (!btn) return;
      const b = state.bugs.find(x => x.uid === btn.closest('tr').dataset.uid); if (!b) return;
      if (btn.dataset.act === 'del') {
        if (!confirm(`Remover o bug ${b.key}?`)) return;
        state.bugs = state.bugs.filter(x => x !== b); save(); renderBugs();
      } else {
        const f = $('#bugForm');
        ['uid', 'key', 'title', 'severity', 'status', 'module', 'owner', 'testId', 'link', 'notes'].forEach(k => { f.elements[k].value = b[k] || ''; });
        $('#bugSubmit').textContent = 'Salvar alterações';
        $('#bugCancel').hidden = false;
        f.scrollIntoView({ behavior: 'smooth' });
      }
    });

    // Notes
    $('#noteForm').elements.date.value = today();
    $('#noteForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      state.notes.push({ uid: uid(), date: data.date, type: data.type, text: data.text.trim() });
      save(); e.target.elements.text.value = ''; renderNotes(); toast('Comentário adicionado.');
    });
    $('#noteList').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act="del"]'); if (!btn) return;
      const id = btn.closest('.note').dataset.uid;
      state.notes = state.notes.filter(n => n.uid !== id); save(); renderNotes();
    });

    // Report
    $('#reportDate').value = today();
    $('#reportDate').addEventListener('change', renderReport);
    $('#copyText').addEventListener('click', async () => toast(await copyPlain(buildReportText()) ? 'Texto copiado. Cole no Teams/Slack.' : 'Não foi possível copiar.'));
    $('#copyHtml').addEventListener('click', async () => toast(await copyRich(buildReportHtml(), buildReportText()) ? 'Report copiado. Cole no corpo do e-mail.' : 'Não foi possível copiar.'));
    $('#downloadHtml').addEventListener('click', () => download(`${slug(state.project.name)}-status-${reportDate()}.html`, standaloneHtml(), 'text/html'));
    $('#printReport').addEventListener('click', () => { renderReport(); window.print(); });
  }

  function renderAll() {
    renderProject(); renderPlan(); renderBugs(); renderNotes();
    if ($('#tab-report').classList.contains('active')) renderReport();
  }

  bind();
  renderAll();
  let initialTab = 'projeto';
  try { initialTab = sessionStorage.getItem('statusReport.tab') || initialTab; } catch (e) { /* ignore */ }
  if (!state.project.name && !state.tests.length && !state.bugs.length) initialTab = 'projeto';
  showTab(initialTab);
})();
