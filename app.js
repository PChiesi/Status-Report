/* Status Report de Homologação — app estático (sem backend).
   Dados ficam no localStorage; backup via JSON. */
(function () {
  'use strict';

  const STORAGE_KEY = 'statusReport.v1';

  // ---------- Domínio ----------
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
  const SEV_COLORS = { 'Crítica': '#9b1c1c', 'Alta': '#dd6b20', 'Média': '#d69e2e', 'Baixa': '#718096' };
  const BUG_STATUSES = ['Aberto', 'Em correção', 'Aguardando reteste', 'Corrigido', 'Fechado', 'Rejeitado'];
  const OPEN_BUG_STATUSES = ['Aberto', 'Em correção', 'Aguardando reteste'];
  const PRIORITY_ORDER = ['critica', 'urgente', 'alta', 'high', 'media', 'medium', 'baixa', 'low'];
  const PALETTE = ['#2f5bd3', '#1f8a4c', '#d97706', '#9f3fbf', '#0f8b8d', '#c53030', '#5a67d8', '#b7791f', '#718096', '#d53f8c'];

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

  // Campos do plano de teste que o report entende. A ordem importa na detecção automática.
  const FIELDS = [
    { key: 'id', label: 'ID do cenário', patterns: [/^id$/, /^#$/, /^(cod|codigo)\b/, /^ct\b/, /^(test ?id|tc ?id|id (do )?(caso|cenario|teste))/, /^(n|no|num|numero)\.?$/, /^n\s?[º°o]\.?$/] },
    { key: 'title', label: 'Cenário / caso de teste', required: true, patterns: [/^cenario/, /caso de teste/, /^caso/, /^titulo/, /test ?case/, /scenario/, /summary/, /^nome/, /^descricao/, /cenario/, /descricao/] },
    { key: 'module', label: 'Módulo / funcionalidade', patterns: [/modulo/, /funcionalidade/, /feature/, /^area/, /componente/, /suite/, /epico/, /epic/, /jornada/, /^fluxo/, /^sistema/] },
    { key: 'owner', label: 'Responsável', patterns: [/responsavel/, /executor/, /testador/, /tester/, /owner/, /analista/, /assignee/, /executado por/] },
    { key: 'priority', label: 'Prioridade', patterns: [/prioridade/, /priority/, /criticidade/] },
    { key: 'plannedDate', label: 'Data planejada', patterns: [/data planejad/, /planejad/, /data previst/, /previsao/, /planned/, /due date/, /prazo/] },
    { key: 'executedAt', label: 'Data de execução', patterns: [/data (de |da )?execu/, /executado em/, /dt\.? exec/, /execution date/, /^data$/] },
    { key: 'bugRef', label: 'Bug relacionado', patterns: [/bug/, /defeito/, /^issue/, /jira/, /incidente/] },
    { key: 'status', label: 'Status / resultado', required: true, patterns: [/^status/, /situacao/, /resultado obtido/, /^resultado$/, /^result$/, /resultado(?! esperado)/, /^execucao$/, /^state/] },
  ];
  const FIELD_BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f]));

  // Caderno padrão disponibilizado pela ferramenta
  const STANDARD_HEADERS = ['ID', 'Cenário', 'Pré-condição', 'Passos', 'Resultado esperado', 'Módulo', 'Prioridade', 'Responsável', 'Data planejada', 'Status', 'Data de execução', 'Bug relacionado', 'Observações'];
  const STANDARD_MODEL = {
    id: 'padrao', name: 'Caderno padrão', builtin: true, sheet: 'Casos de teste',
    mapping: { id: 'ID', title: 'Cenário', module: 'Módulo', owner: 'Responsável', priority: 'Prioridade', plannedDate: 'Data planejada', executedAt: 'Data de execução', bugRef: 'Bug relacionado', status: 'Status' },
    optional: ['plannedDate'], extras: [], statusMap: {},
  };

  // ---------- Report: indicadores, seções e gráficos ----------
  const KPI_DEFS = [
    { key: 'total', label: 'Cenários', get: (t) => t.total },
    { key: 'executed', label: 'Executados', get: (t) => t.executed },
    { key: 'execPct', label: 'Execução', get: (t) => fmtPct(t.execPct) },
    { key: 'passPct', label: 'Sucesso', get: (t) => (t.executed ? fmtPct(t.passPct) : '—') },
    { key: 'passed', label: 'Passou', get: (t) => t.counts.passed },
    { key: 'failed', label: 'Falhou', get: (t) => t.counts.failed },
    { key: 'blocked', label: 'Bloqueados', get: (t) => t.counts.blocked },
    { key: 'pending', label: 'Pendentes', get: (t) => t.counts.pending + t.counts.inprogress },
    { key: 'bugsOpen', label: 'Bugs abertos', get: (t, b) => b.openCount },
    { key: 'bugsCritical', label: 'Críticos/altos abertos', get: (t, b) => b.bySev['Crítica'].open + b.bySev['Alta'].open },
    { key: 'bugsClosed', label: 'Bugs fechados', get: (t, b) => b.closedCount },
    { key: 'bugsTotal', label: 'Bugs no total', get: (t, b) => b.total },
  ];
  const SECTION_DEFS = [
    { key: 'health', label: 'Status geral (farol)' },
    { key: 'scope', label: 'Escopo do projeto' },
    { key: 'kpis', label: 'Indicadores' },
    { key: 'charts', label: 'Gráficos' },
    { key: 'notes', label: 'Comentários do dia' },
    { key: 'openBugs', label: 'Lista de bugs em aberto' },
    { key: 'failedTests', label: 'Cenários com falha/bloqueados' },
  ];
  const CHART_TYPES = [
    { key: 'bar', label: 'Barras horizontais' },
    { key: 'column', label: 'Colunas' },
    { key: 'donut', label: 'Rosca' },
    { key: 'table', label: 'Tabela' },
    { key: 'daily', label: 'Execução diária (planejado x realizado)' },
  ];
  const defaultCharts = () => [
    { id: uid(), title: 'Execução geral', type: 'donut', source: 'tests', groupBy: 'status', splitBy: '', percent: false, limit: 0 },
    { id: uid(), title: 'Execução por módulo', type: 'bar', source: 'tests', groupBy: 'module', splitBy: 'status', percent: true, limit: 0 },
    { id: uid(), title: 'Execução diária — planejado x realizado', type: 'daily', source: 'tests', groupBy: 'status', splitBy: '', mode: 'daily', plan: 'auto', skipWeekends: true, showTable: false, limit: 0 },
    { id: uid(), title: 'Bugs por severidade', type: 'column', source: 'bugs', groupBy: 'severity', splitBy: 'state', percent: false, limit: 0 },
    { id: uid(), title: 'Resumo por módulo', type: 'table', source: 'tests', groupBy: 'module', splitBy: 'status', percent: false, limit: 0 },
  ];
  const defaultReport = () => ({
    v: 2,
    sections: Object.fromEntries(SECTION_DEFS.map(s => [s.key, true])),
    kpis: ['total', 'execPct', 'passPct', 'blocked', 'bugsOpen', 'bugsClosed'],
    charts: defaultCharts(),
  });

  // ---------- Estado ----------
  const emptyState = () => ({
    project: { name: '', release: '', environment: '', owner: '', startDate: '', endDate: '', scope: '', statusOverride: '', audience: '' },
    tests: [],
    planFile: '',
    planModel: '',
    extraFields: [],
    bugs: [],
    notes: [],
    models: [],
    report: defaultReport(),
  });

  function hydrate(data) {
    const base = emptyState();
    const s = Object.assign(base, data || {});
    s.project = Object.assign(emptyState().project, (data && data.project) || {});
    s.report = Object.assign(defaultReport(), (data && data.report) || {});
    s.report.sections = Object.assign(defaultReport().sections, s.report.sections || {});
    if (!Array.isArray(s.report.charts)) s.report.charts = defaultCharts();
    if (!s.report.v || s.report.v < 2) {
      s.report.charts.splice(Math.min(1, s.report.charts.length), 0, defaultCharts().find(c => c.type === 'daily'));
      s.report.v = 2;
    }
    if (!Array.isArray(s.models)) s.models = [];
    if (!Array.isArray(s.extraFields)) s.extraFields = [];
    s.tests.forEach(t => { t.extra = t.extra || {}; });
    return s;
  }

  let state = load();
  let imp = null; // importação em andamento

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? hydrate(JSON.parse(raw)) : emptyState();
    } catch (e) {
      return emptyState();
    }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { toast('Não foi possível salvar no navegador.'); }
  }

  // ---------- Utilitários ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const today = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const fmtDate = (iso) => {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  function fmtPct(n) { return `${String(n).replace('.', ',')}%`; }
  const slug = (s) => norm(s || 'status-report').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'status-report';

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function normalizeStatus(v) {
    const s = norm(v);
    if (!s) return 'pending';
    if (/^(n\/a\b|na$|nao aplicavel|cancelad|descartad|fora de escopo|skip)/.test(s)) return 'na';
    if (/(bloquead|blocked|impedid)/.test(s)) return 'blocked';
    if (/(falh|fail|reprovad|erro|error|nok|defeito|bug)/.test(s)) return 'failed';
    if (/(andamento|em execucao|executando|in progress|progress|wip|retest)/.test(s)) return 'inprogress';
    if (/(nao execut|pendente|pending|not run|no run|to do|todo|a executar|nao iniciad)/.test(s)) return 'pending';
    if (/(passou|passed|^pass|^ok$|aprovad|sucesso|success|conclu|done|execut)/.test(s)) return 'passed';
    return 'pending';
  }

  function toIsoDate(v) {
    if (!v) return '';
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    return s;
  }

  // ---------- Métricas ----------
  function testMetrics() {
    const counts = Object.fromEntries(TEST_STATUSES.map(s => [s.key, 0]));
    state.tests.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
    const total = state.tests.length - counts.na;
    const executed = counts.passed + counts.failed;
    return { counts, total, executed, execPct: pct(executed, total), passPct: pct(counts.passed, executed), blockedPct: pct(counts.blocked, total) };
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
    const plan = dailySeries({ plan: 'auto', skipWeekends: true });
    const { startDate, endDate } = state.project;
    if (plan.hasPlan && plan.plannedToDate && tm.total) {
      const gap = plan.plannedToDate - plan.realizedToDate;
      if (endDate && new Date(reportDate()) > new Date(endDate) && tm.execPct < 100) bump('red', 'Prazo da homologação vencido com execução incompleta');
      else if (gap > 0 && plan.realizedToDate < plan.plannedToDate * 0.6) bump('red', `Execução atrasada: ${plan.realizedToDate} de ${plan.plannedToDate} cenários planejados até a data`);
      else if (gap > 0 && plan.realizedToDate < plan.plannedToDate * 0.85) bump('yellow', `Execução abaixo do planejado: ${plan.realizedToDate} de ${plan.plannedToDate} até a data`);
    } else if (startDate && endDate && tm.total) {
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

  // ---------- Abas ----------
  function showTab(name) {
    $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
    if (name === 'report') { renderReportConfig(); renderReport(); }
    try { sessionStorage.setItem('statusReport.tab', name); } catch (e) { /* ignore */ }
  }

  // ---------- Projeto ----------
  function renderProject() {
    const f = $('#projectForm');
    Object.entries(state.project).forEach(([k, v]) => { if (f.elements[k]) f.elements[k].value = v || ''; });
    $('#brandProject').textContent = state.project.name || 'Status Report';
    $('#brandSub').textContent = [state.project.release, state.project.environment].filter(Boolean).join(' · ') || 'Homologação';
  }

  // =====================================================================
  //  IMPORTAÇÃO DO PLANO DE TESTE
  // =====================================================================

  // Lê o arquivo e devolve { nomeDaAba: [[célula, ...], ...] }
  async function readWorkbook(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'json') {
      const data = JSON.parse(await file.text());
      const rows = Array.isArray(data) ? data : (data.tests || data.rows || data.data || []);
      const headers = [...new Set(rows.flatMap(r => Object.keys(r || {})))];
      return { JSON: [headers, ...rows.map(r => headers.map(h => (r[h] == null ? '' : String(r[h]))))] };
    }
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
      return { CSV: parseDelimited(await file.text()) };
    }
    if (!window.XLSX) throw new Error('Leitor de Excel não carregou.');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const out = {};
    wb.SheetNames.forEach(n => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true, blankrows: true });
      out[n] = rows.map(r => r.map(c => {
        if (c instanceof Date) { const d = new Date(c.getTime() + 60000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
        return c == null ? '' : String(c);
      }));
    });
    return out;
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
    return rows;
  }

  const cellStr = (v) => String(v == null ? '' : v).trim();

  function headerScore(row) {
    const cells = row.map(cellStr).filter(Boolean);
    if (cells.length < 2) return -1;
    const n = cells.map(norm);
    const hits = FIELDS.filter(f => n.some(h => f.patterns.some(p => p.test(h)))).length;
    return hits * 10 + Math.min(cells.length, 10);
  }

  function detectHeaderRow(aoa) {
    let best = 0, bestScore = -1;
    for (let i = 0; i < Math.min(aoa.length, 30); i++) {
      const s = headerScore(aoa[i] || []);
      if (s > bestScore) { best = i; bestScore = s; }
    }
    return best;
  }

  function headersAt(aoa, rowIdx) {
    const row = aoa[rowIdx] || [];
    const seen = {};
    const width = Math.max(row.length, ...aoa.slice(rowIdx + 1, rowIdx + 50).map(r => r.length), 0);
    const out = [];
    for (let i = 0; i < width; i++) {
      let h = cellStr(row[i]) || `Coluna ${i + 1}`;
      if (seen[h]) { seen[h]++; h = `${h} (${seen[h]})`; } else seen[h] = 1;
      out.push(h);
    }
    return out;
  }

  function detectMapping(headers) {
    const used = new Set();
    const mapping = {};
    const nh = headers.map(norm);
    FIELDS.forEach(f => {
      mapping[f.key] = '';
      for (const p of f.patterns) {
        const idx = nh.findIndex((h, i) => !used.has(i) && !/^coluna \d+$/.test(h) && p.test(h));
        if (idx >= 0) { mapping[f.key] = headers[idx]; used.add(idx); return; }
      }
    });
    return mapping;
  }

  // Procura um modelo (padrão ou salvo) cujas colunas existam na planilha
  function findModel(sheets) {
    const models = [...state.models, STANDARD_MODEL];
    for (const model of models) {
      const needed = Object.entries(model.mapping).filter(([k, v]) => v && !(model.optional || []).includes(k)).map(([, v]) => norm(v));
      if (!needed.length) continue;
      const sheetNames = Object.keys(sheets).sort((a, b) => (b === model.sheet) - (a === model.sheet));
      for (const sheet of sheetNames) {
        const aoa = sheets[sheet];
        for (let r = 0; r < Math.min(aoa.length, 30); r++) {
          const hs = new Set(headersAt(aoa, r).map(norm));
          if (needed.every(n => hs.has(n))) return { model, sheet, headerRow: r };
        }
      }
    }
    return null;
  }

  function bestSheet(sheets) {
    let best = Object.keys(sheets)[0], bestScore = -1;
    Object.entries(sheets).forEach(([name, aoa]) => {
      const hr = detectHeaderRow(aoa);
      const score = headerScore(aoa[hr] || []) * 1000 + Math.min(aoa.length, 999);
      if (score > bestScore) { best = name; bestScore = score; }
    });
    return best;
  }

  const impAoa = () => imp.sheets[imp.sheet] || [];
  const impHeaders = () => headersAt(impAoa(), imp.headerRow);
  function impRows() {
    const headers = impHeaders();
    return impAoa().slice(imp.headerRow + 1)
      .filter(r => r.some(c => cellStr(c)))
      .map(r => Object.fromEntries(headers.map((h, i) => [h, cellStr(r[i])])));
  }

  function useModel(model, sheet, headerRow) {
    imp.modelId = model ? model.id : '';
    if (sheet) imp.sheet = sheet;
    imp.headerRow = headerRow != null ? headerRow : detectHeaderRow(impAoa());
    const headers = impHeaders();
    if (model) {
      imp.mapping = Object.fromEntries(FIELDS.map(f => [f.key, headers.includes(model.mapping[f.key]) ? model.mapping[f.key] : '']));
      imp.extras = (model.extras || []).filter(h => headers.includes(h));
      imp.statusMap = Object.assign({}, model.statusMap || {});
      imp.modelName = model.builtin ? '' : model.name;
    } else {
      imp.mapping = detectMapping(headers);
      imp.extras = [];
      imp.statusMap = {};
    }
  }

  async function handlePlanFile(file) {
    if (!file) return;
    let sheets;
    try {
      sheets = await readWorkbook(file);
    } catch (err) {
      console.error(err);
      toast('Não consegui ler o arquivo. Verifique o formato.');
      return;
    }
    imp = { fileName: file.name, sheets, sheet: bestSheet(sheets), headerRow: 0, mapping: {}, extras: [], statusMap: {}, modelId: '', modelName: '' };
    const found = findModel(sheets);
    if (found) {
      useModel(found.model, found.sheet, found.headerRow);
      applyImport();
      imp.info = `Modelo "${found.model.name}" reconhecido automaticamente — ${state.tests.length} cenários importados. Ajuste abaixo se precisar.`;
      toast(`${state.tests.length} cenários importados (${found.model.name}).`);
    } else {
      useModel(null, imp.sheet, null);
      if (imp.mapping.title && imp.mapping.status) {
        applyImport();
        imp.info = `Planilha em formato próprio: colunas identificadas automaticamente e ${state.tests.length} cenários importados. Confira abaixo, ajuste se precisar e salve como modelo para não configurar de novo.`;
        toast(`${state.tests.length} cenários importados. Confira a configuração.`);
      } else {
        imp.info = 'Planilha em formato próprio. Indique as colunas, ajuste o que for preciso e clique em importar. Salve como modelo para não configurar de novo.';
        toast('Confira a configuração da importação.');
      }
    }
    renderImport();
    $('#importCard').hidden = false;
    $('#importCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function statusValuesOf(rows) {
    const col = imp.mapping.status;
    const counts = new Map();
    if (!col) return [];
    rows.forEach(r => {
      const raw = r[col] || '';
      const k = norm(raw);
      const cur = counts.get(k) || { raw: raw || '(vazio)', key: k, count: 0 };
      cur.count++;
      counts.set(k, cur);
    });
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }
  const mapStatus = (raw) => {
    const k = norm(raw);
    return imp && imp.statusMap[k] ? imp.statusMap[k] : normalizeStatus(raw);
  };

  function renderImport() {
    if (!imp) { $('#importCard').hidden = true; return; }
    const headers = impHeaders();
    const rows = impRows();
    $('#importInfo').textContent = `${imp.fileName} — ${imp.info || ''}`;

    // Modelo / aba / cabeçalho
    const models = [STANDARD_MODEL, ...state.models];
    $('#impModel').innerHTML = `<option value="">Detecção automática</option>` +
      models.map(m => `<option value="${esc(m.id)}" ${m.id === imp.modelId ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    const sheetNames = Object.keys(imp.sheets);
    $('#impSheet').innerHTML = sheetNames.map(n => `<option ${n === imp.sheet ? 'selected' : ''}>${esc(n)}</option>`).join('');
    $('#impSheet').disabled = sheetNames.length < 2;
    $('#impHeaderRow').value = imp.headerRow + 1;
    $('#impHeaderRow').max = impAoa().length || 1;

    // Pré-visualização (colunas mapeadas destacadas)
    const mappedTo = {};
    FIELDS.forEach(f => { if (imp.mapping[f.key]) mappedTo[imp.mapping[f.key]] = f.label; });
    imp.extras.forEach(h => { mappedTo[h] = mappedTo[h] || 'Campo extra'; });
    $('#impPreview').innerHTML = `<thead><tr>${headers.map(h => `<th title="${esc(h)}">${esc(h)}${mappedTo[h] ? `<br><span class="tag-builtin">${esc(mappedTo[h])}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, 5).map(r => `<tr>${headers.map(h => `<td title="${esc(r[h])}">${esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody>`;

    // Mapeamento
    $('#impMapping').innerHTML = FIELDS.map(f => `
      <label class="${f.required ? 'req' : ''}">${esc(f.label)}
        <select data-field="${f.key}" class="${imp.mapping[f.key] ? '' : 'unset'}">
          <option value="">— não tenho —</option>
          ${headers.map(h => `<option ${h === imp.mapping[f.key] ? 'selected' : ''}>${esc(h)}</option>`).join('')}
        </select>
      </label>`).join('');

    // Extras
    const mappedCols = new Set(Object.values(imp.mapping).filter(Boolean));
    const free = headers.filter(h => !mappedCols.has(h) && !/^Coluna \d+/.test(h));
    $('#impExtras').innerHTML = free.length
      ? free.map(h => `<label class="chip"><input type="checkbox" value="${esc(h)}" ${imp.extras.includes(h) ? 'checked' : ''}> ${esc(h)}</label>`).join('')
      : '<span class="hint">Todas as colunas já estão mapeadas.</span>';

    // Status
    const values = statusValuesOf(rows);
    $('#impStatus').innerHTML = !imp.mapping.status
      ? '<p class="hint">Sem coluna de status, todos os cenários entram como "Não executado". Você pode atualizar o status na tabela depois.</p>'
      : `<div class="status-map">${values.map(v => `
          <div class="item">
            <span class="raw" title="${esc(v.raw)}">${esc(v.raw)} <small>(${v.count})</small></span>
            <span aria-hidden="true">→</span>
            <select data-raw="${esc(v.key)}">${TEST_STATUSES.map(s => `<option value="${s.key}" ${s.key === mapStatus(v.key === '' ? '' : v.raw) ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
          </div>`).join('')}</div>`;

    $('#impModelName').value = imp.modelName || '';
    $('#impSaveModel').textContent = state.models.some(m => m.id === imp.modelId) ? 'Atualizar modelo e importar' : 'Salvar como modelo e importar';
  }

  function applyImport() {
    const rows = impRows();
    const m = imp.mapping;
    const get = (r, k) => (m[k] ? r[m[k]] || '' : '');
    state.tests = rows
      .filter(r => get(r, 'title') || get(r, 'id'))
      .map((r, i) => ({
        uid: uid(),
        id: get(r, 'id') || `CT-${String(i + 1).padStart(3, '0')}`,
        title: get(r, 'title') || get(r, 'id'),
        module: get(r, 'module'),
        owner: get(r, 'owner'),
        priority: get(r, 'priority'),
        plannedDate: toIsoDate(get(r, 'plannedDate')),
        executedAt: toIsoDate(get(r, 'executedAt')),
        bugRef: get(r, 'bugRef'),
        status: m.status ? mapStatus(get(r, 'status')) : 'pending',
        extra: Object.fromEntries(imp.extras.map(h => [h, r[h] || ''])),
      }));
    state.extraFields = imp.extras.slice();
    state.planFile = imp.fileName;
    const model = [STANDARD_MODEL, ...state.models].find(x => x.id === imp.modelId);
    state.planModel = model ? model.name : 'Configuração manual';
    save();
    renderPlan();
  }

  function saveModelFromImport() {
    const name = $('#impModelName').value.trim();
    if (!name) { toast('Dê um nome para o modelo.'); $('#impModelName').focus(); return false; }
    let model = state.models.find(x => x.id === imp.modelId) || state.models.find(x => norm(x.name) === norm(name));
    if (!model) { model = { id: uid() }; state.models.push(model); }
    Object.assign(model, {
      name, sheet: imp.sheet, mapping: Object.assign({}, imp.mapping), extras: imp.extras.slice(),
      statusMap: Object.assign({}, imp.statusMap), updatedAt: today(),
    });
    imp.modelId = model.id;
    imp.modelName = name;
    save();
    return true;
  }

  function renderModels() {
    const models = [STANDARD_MODEL, ...state.models];
    $('#modelList').innerHTML = models.map(m => {
      const cols = FIELDS.filter(f => m.mapping[f.key]).map(f => `${f.label}: ${m.mapping[f.key]}`).join(' · ');
      const extras = (m.extras || []).length ? ` · Extras: ${m.extras.join(', ')}` : '';
      return `<div class="model-row" data-id="${esc(m.id)}">
        <div><strong>${esc(m.name)}</strong>${m.builtin ? '<span class="tag-builtin">PADRÃO</span>' : ''}<small>${esc(cols + extras)}</small></div>
        ${m.builtin
          ? '<button class="btn small" data-act="template">Baixar modelo</button>'
          : '<button class="btn small" data-act="export">Exportar</button> <button class="btn small ghost" data-act="del">Excluir</button>'}
      </div>`;
    }).join('');
  }

  function downloadTemplate() {
    if (!window.XLSX) { toast('Leitor de Excel ainda carregando, tente novamente.'); return; }
    const wb = XLSX.utils.book_new();
    const ex = [
      ['CT-001', 'Login com usuário válido', 'Usuário ativo cadastrado', '1. Acessar a tela de login\n2. Informar usuário e senha\n3. Clicar em Entrar', 'Usuário acessa a página inicial', 'Acesso', 'Alta', 'Ana', '2026-11-16', 'Passou', '2026-11-16', '', ''],
      ['CT-002', 'Login com senha inválida', 'Usuário ativo cadastrado', '1. Informar senha incorreta\n2. Clicar em Entrar', 'Mensagem "Usuário ou senha inválidos"', 'Acesso', 'Média', 'Ana', '2026-11-16', 'Falhou', '2026-11-17', 'BUG-001', 'Mensagem genérica exibida'],
      ['CT-003', 'Cotação com 2 coberturas', 'Produto Auto ativo', '1. Iniciar cotação\n2. Selecionar 2 coberturas\n3. Calcular', 'Prêmio calculado conforme tabela', 'Cotação', 'Alta', 'Bruno', '2026-11-18', 'Não executado', '', '', ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet([STANDARD_HEADERS, ...ex]);
    ws['!cols'] = [10, 36, 26, 40, 34, 16, 11, 16, 15, 15, 16, 15, 30].map(w => ({ wch: w }));
    ws['!autofilter'] = { ref: `A1:M${ex.length + 1}` };
    XLSX.utils.book_append_sheet(wb, ws, 'Casos de teste');

    const help = [
      ['Caderno de testes — modelo padrão do Status Report'],
      [''],
      ['Como usar'],
      ['1. Preencha uma linha por cenário na aba "Casos de teste". Não renomeie as colunas.'],
      ['2. Preencha a Data planejada de cada cenário para acompanhar planejado x realizado por dia.'],
      ['3. Durante a execução, atualize Status e Data de execução (formato AAAA-MM-DD ou DD/MM/AAAA).'],
      ['4. Suba o arquivo na aba "Plano de teste" do Status Report. As colunas são reconhecidas automaticamente.'],
      [''],
      ['Valores aceitos em Status'],
      ...TEST_STATUSES.map(s => [s.label]),
      [''],
      ['Prioridade sugerida'],
      ['Alta'], ['Média'], ['Baixa'],
      [''],
      ['Obrigatórios: Cenário (ou ID). Recomendados: Status e Módulo. As demais colunas são opcionais.'],
    ];
    const wsHelp = XLSX.utils.aoa_to_sheet(help);
    wsHelp['!cols'] = [{ wch: 100 }];
    XLSX.utils.book_append_sheet(wb, wsHelp, 'Instruções');
    XLSX.writeFile(wb, 'caderno-de-testes-padrao.xlsx');
  }

  // ---------- Tabela do plano ----------
  function renderPlan() {
    const tm = testMetrics();
    $('#planKpis').innerHTML = state.tests.length ? [
      ['Cenários', tm.total],
      ['Executados', `${tm.executed} <small>(${fmtPct(tm.execPct)})</small>`],
      ['Passou', tm.counts.passed],
      ['Falhou', tm.counts.failed],
      ['Bloqueados', tm.counts.blocked],
      ['Pendentes', tm.counts.pending + tm.counts.inprogress],
      ['Taxa de sucesso', fmtPct(tm.passPct)],
    ].map(([l, v]) => `<div class="kpi"><span>${l}</span><strong>${v}</strong></div>`).join('') : '';

    const extras = state.extraFields;
    const hasPriority = state.tests.some(t => t.priority);
    const hasPlanned = state.tests.some(t => t.plannedDate);
    $('#testTable thead').innerHTML = `<tr><th>ID</th><th>Cenário</th><th>Módulo</th>${hasPriority ? '<th>Prioridade</th>' : ''}<th>Responsável</th>${extras.map(h => `<th>${esc(h)}</th>`).join('')}${hasPlanned ? '<th>Planejado</th>' : ''}<th>Executado em</th><th>Status</th><th></th></tr>`;

    const q = norm($('#testSearch').value);
    const f = $('#testFilter').value;
    const list = state.tests.filter(t => (!f || t.status === f) &&
      (!q || norm(`${t.id} ${t.title} ${t.module} ${t.owner} ${t.priority || ''} ${Object.values(t.extra || {}).join(' ')}`).includes(q)));
    $('#testTable tbody').innerHTML = list.map(t => `
      <tr data-uid="${t.uid}">
        <td>${esc(t.id)}</td>
        <td>${esc(t.title)}</td>
        <td>${esc(t.module)}</td>
        ${hasPriority ? `<td>${esc(t.priority)}</td>` : ''}
        <td>${esc(t.owner)}</td>
        ${extras.map(h => `<td>${esc((t.extra || {})[h])}</td>`).join('')}
        ${hasPlanned ? `<td>${esc(fmtDate(t.plannedDate))}</td>` : ''}
        <td><input type="date" class="test-exec" value="${esc(isIso(t.executedAt) ? t.executedAt : '')}" aria-label="Data de execução"></td>
        <td><select class="test-status">${TEST_STATUSES.map(s => `<option value="${s.key}" ${s.key === t.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select></td>
        <td class="actions"><button class="btn small ghost" data-act="bug" title="Abrir bug para este cenário">+ Bug</button> <button class="btn small ghost" data-act="del" title="Remover">✕</button></td>
      </tr>`).join('');
    $('#testEmpty').hidden = state.tests.length > 0;
    $('#planFileName').textContent = state.planFile ? `Plano atual: ${state.planFile}${state.planModel ? ` (${state.planModel})` : ''}` : '';

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
        <td><select class="bug-status">${BUG_STATUSES.map(s => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
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

  // ---------- Comentários ----------
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

  // =====================================================================
  //  GRÁFICOS CONFIGURÁVEIS
  // =====================================================================

  // Dimensões disponíveis para agrupar/dividir cada fonte de dados
  function dimensions(source) {
    if (source === 'bugs') {
      return [
        { key: 'severity', label: 'Severidade', get: b => b.severity || 'Média', order: SEVERITIES, color: v => SEV_COLORS[v] },
        { key: 'state', label: 'Aberto / fechado', get: b => (OPEN_BUG_STATUSES.includes(b.status) ? 'Abertos' : 'Fechados'), order: ['Abertos', 'Fechados'], color: v => (v === 'Abertos' ? '#c53030' : '#1f8a4c') },
        { key: 'status', label: 'Status do bug', get: b => b.status || 'Aberto', order: BUG_STATUSES },
        { key: 'module', label: 'Módulo', get: b => b.module || 'Sem módulo' },
        { key: 'owner', label: 'Responsável', get: b => b.owner || 'Sem responsável' },
        { key: 'createdAt', label: 'Data de abertura', get: b => fmtDate(b.createdAt) || 'Sem data', sortKey: v => v.split('/').reverse().join('') },
      ];
    }
    return [
      { key: 'status', label: 'Status', get: t => STATUS_BY_KEY[t.status].label, order: TEST_STATUSES.map(s => s.label), color: v => (TEST_STATUSES.find(s => s.label === v) || {}).color },
      { key: 'executed', label: 'Executado / pendente', get: t => (t.status === 'passed' || t.status === 'failed' ? 'Executados' : t.status === 'na' ? 'N/A' : 'Pendentes'), order: ['Executados', 'Pendentes', 'N/A'], color: v => ({ Executados: '#2f5bd3', Pendentes: '#a0aec0', 'N/A': '#cbd5e0' }[v]) },
      { key: 'module', label: 'Módulo', get: t => t.module || 'Sem módulo' },
      { key: 'owner', label: 'Responsável', get: t => t.owner || 'Sem responsável' },
      { key: 'priority', label: 'Prioridade', get: t => t.priority || 'Sem prioridade', sortKey: v => { const i = PRIORITY_ORDER.indexOf(norm(v)); return i < 0 ? 99 : i; } },
      { key: 'executedAt', label: 'Data de execução', get: t => fmtDate(t.executedAt) || 'Sem data', sortKey: v => v.split('/').reverse().join('') },
      { key: 'plannedDate', label: 'Data planejada', get: t => fmtDate(t.plannedDate) || 'Sem data', sortKey: v => v.split('/').reverse().join('') },
      ...state.extraFields.map(h => ({ key: `x:${h}`, label: `${h} (extra)`, get: t => ((t.extra || {})[h]) || 'Não informado' })),
    ];
  }
  const findDim = (source, key) => dimensions(source).find(d => d.key === key);

  function chartData(cfg) {
    const items = cfg.source === 'bugs' ? state.bugs : state.tests;
    const g = findDim(cfg.source, cfg.groupBy) || dimensions(cfg.source)[0];
    const s = cfg.splitBy ? findDim(cfg.source, cfg.splitBy) : null;
    const groups = new Map();
    const splitVals = new Set();
    items.forEach(it => {
      const gv = g.get(it);
      const sv = s ? s.get(it) : '__total';
      splitVals.add(sv);
      const grp = groups.get(gv) || { label: gv, total: 0, parts: {} };
      grp.total++;
      grp.parts[sv] = (grp.parts[sv] || 0) + 1;
      groups.set(gv, grp);
    });
    const sortBy = (dim) => (a, b) => {
      if (dim.order) { const ia = dim.order.indexOf(a), ib = dim.order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); }
      if (dim.sortKey) { const ka = dim.sortKey(a), kb = dim.sortKey(b); return ka < kb ? -1 : ka > kb ? 1 : 0; }
      return 0;
    };
    let list = [...groups.values()];
    if (g.order || g.sortKey) list.sort((a, b) => sortBy(g)(a.label, b.label));
    else list.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    if (cfg.limit > 0 && list.length > cfg.limit) {
      const rest = list.slice(cfg.limit);
      const other = { label: 'Outros', total: 0, parts: {} };
      rest.forEach(r => { other.total += r.total; Object.entries(r.parts).forEach(([k, v]) => { other.parts[k] = (other.parts[k] || 0) + v; }); });
      list = [...list.slice(0, cfg.limit), other];
    }
    let splits = [...splitVals];
    if (s) {
      if (s.order || s.sortKey) splits.sort(sortBy(s));
      else splits.sort((a, b) => list.reduce((n, gr) => n + (gr.parts[b] || 0), 0) - list.reduce((n, gr) => n + (gr.parts[a] || 0), 0));
    }
    const colorOf = (dim, v, i) => (dim && dim.color && dim.color(v)) || PALETTE[i % PALETTE.length];
    return {
      groups: list,
      splits: splits.map((v, i) => ({ key: v, label: v === '__total' ? 'Total' : v, color: s ? colorOf(s, v, i) : '#2f5bd3' })),
      groupColor: (v, i) => colorOf(g, v, i),
      groupDim: g, splitDim: s,
    };
  }

  const FONT = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;";
  const CELL = 'padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top;font-size:13px;';
  const TH = CELL + 'background:#f5f6f8;color:#5d6676;font-size:11px;text-transform:uppercase;letter-spacing:.03em;';

  function legendHtml(entries) {
    return `<div style="margin-top:8px;">${entries.map(e => `<span style="${FONT}display:inline-block;margin:4px 14px 0 0;font-size:12px;color:#1d2330;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${e.color};margin-right:5px;vertical-align:middle;"></span>${esc(e.label)}${e.value != null ? `: <b>${e.value}</b>` : ''}</span>`).join('')}</div>`;
  }

  function renderChart(cfg) {
    if (cfg.type === 'daily') return renderDaily(cfg);
    const d = chartData(cfg);
    const title = `<h3 style="${FONT}font-size:14px;margin:18px 0 8px;color:#1d2330;">${esc(cfg.title || 'Gráfico')}</h3>`;
    if (!d.groups.length) return title + `<p style="${FONT}font-size:13px;color:#8a93a3;">Sem dados para este gráfico.</p>`;
    const grand = d.groups.reduce((n, g) => n + g.total, 0);
    const split = !!d.splitDim;

    if (cfg.type === 'donut') {
      const slices = split
        ? d.splits.map(s => ({ label: s.label, color: s.color, value: d.groups.reduce((n, g) => n + (g.parts[s.key] || 0), 0) }))
        : d.groups.map((g, i) => ({ label: g.label, color: d.groupColor(g.label, i), value: g.total }));
      const r = 54, c = 2 * Math.PI * r;
      let off = 0;
      const arcs = slices.filter(s => s.value).map(s => {
        const len = (s.value / grand) * c;
        const el = `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${s.color}" stroke-width="24" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"/>`;
        off += len;
        return el;
      }).join('');
      return title + `<table role="presentation" style="border-collapse:collapse;"><tr>
        <td style="padding:0 18px 0 0;vertical-align:middle;"><svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="${esc(cfg.title)}">${arcs}<text x="70" y="68" text-anchor="middle" font-size="22" font-weight="700" fill="#1d2330" font-family="Segoe UI, Arial">${grand}</text><text x="70" y="86" text-anchor="middle" font-size="10" fill="#5d6676" font-family="Segoe UI, Arial">TOTAL</text></svg></td>
        <td style="vertical-align:middle;">${slices.map(s => `<div style="${FONT}font-size:13px;margin:3px 0;color:#1d2330;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${s.color};margin-right:6px;"></span>${esc(s.label)}: <b>${s.value}</b> <span style="color:#5d6676;">(${fmtPct(pct(s.value, grand))})</span></div>`).join('')}</td>
      </tr></table>`;
    }

    if (cfg.type === 'table') {
      const isTestStatus = cfg.source === 'tests' && cfg.splitBy === 'status';
      const cols = split ? d.splits : [];
      return title + `<table style="width:100%;border-collapse:collapse;">
        <thead><tr><th style="${TH}">${esc(d.groupDim.label)}</th>${cols.map(s => `<th style="${TH}text-align:center;">${esc(s.label)}</th>`).join('')}<th style="${TH}text-align:center;">Total</th>${isTestStatus ? `<th style="${TH}">Execução</th>` : ''}<th style="${TH}text-align:center;">%</th></tr></thead>
        <tbody>${d.groups.map(g => {
          let exec = '';
          if (isTestStatus) {
            const na = g.parts['N/A'] || 0, tot = g.total - na, done = (g.parts.Passou || 0) + (g.parts.Falhou || 0), p = pct(done, tot);
            exec = `<td style="${CELL}min-width:110px;"><div style="background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden;"><div style="background:#2f5bd3;height:8px;width:${p}%;"></div></div><span style="font-size:11px;color:#5d6676;">${fmtPct(p)}</span></td>`;
          }
          return `<tr><td style="${CELL}">${esc(g.label)}</td>${cols.map(s => `<td style="${CELL}text-align:center;${g.parts[s.key] ? `color:${s.color};font-weight:600;` : 'color:#a0aec0;'}">${g.parts[s.key] || 0}</td>`).join('')}<td style="${CELL}text-align:center;font-weight:700;">${g.total}</td>${exec}<td style="${CELL}text-align:center;color:#5d6676;">${fmtPct(pct(g.total, grand))}</td></tr>`;
        }).join('')}</tbody>
      </table>`;
    }

    const max = Math.max(...d.groups.map(g => g.total));
    const segs = (g) => (split ? d.splits : [{ key: '__total' }]).map((s, i) => ({ v: g.parts[s.key] || 0, color: split ? s.color : d.groupColor(g.label, d.groups.indexOf(g)), label: s.label })).filter(x => x.v);

    if (cfg.type === 'column') {
      const H = 150;
      const full = cfg.percent && split;
      const cols = d.groups.map(g => {
        const px = segs(g).map(x => ({ ...x, h: Math.max(Math.round((x.v / (full ? g.total : max)) * H), 1) }));
        const hTot = px.reduce((n, x) => n + x.h, 0);
        const parts = px.reverse().map(x => `<div title="${esc(x.label || g.label)}: ${x.v}" style="background:${x.color};height:${x.h}px;"></div>`).join('');
        return `<td style="vertical-align:bottom;text-align:center;padding:0 6px;">
          <div style="${FONT}font-size:12px;font-weight:700;color:#1d2330;margin-bottom:3px;">${g.total}</div>
          <div style="width:38px;margin:0 auto;height:${hTot}px;display:flex;flex-direction:column;justify-content:flex-end;">${parts}</div></td>`;
      }).join('');
      const labels = d.groups.map(g => `<td style="${FONT}font-size:11px;color:#5d6676;text-align:center;padding:6px 4px 0;border-top:1px solid #cbd5e0;vertical-align:top;">${esc(g.label)}</td>`).join('');
      return title + `<table role="presentation" style="border-collapse:collapse;"><tr style="height:${H + 20}px;">${cols}</tr><tr>${labels}</tr></table>` +
        (split ? legendHtml(d.splits.map(s => ({ label: s.label, color: s.color, value: d.groups.reduce((n, g) => n + (g.parts[s.key] || 0), 0) }))) : '');
    }

    // bar (horizontal)
    const rows = d.groups.map(g => {
      const width = cfg.percent && split ? 100 : pct(g.total, max);
      const parts = segs(g).map(x => `<td title="${esc(x.label || g.label)}: ${x.v}" style="background:${x.color};height:16px;padding:0;width:${pct(x.v, g.total)}%;"></td>`).join('');
      const value = cfg.percent && split
        ? segs(g).map(x => fmtPct(pct(x.v, g.total))).join(' / ')
        : `${g.total} <span style="color:#8a93a3;">(${fmtPct(pct(g.total, grand))})</span>`;
      return `<tr>
        <td style="${FONT}font-size:13px;color:#1d2330;padding:4px 10px 4px 0;white-space:nowrap;width:28%;">${esc(g.label)}</td>
        <td style="padding:4px 0;"><table role="presentation" style="width:${Math.max(width, 1)}%;border-collapse:collapse;border-radius:3px;overflow:hidden;"><tr>${parts}</tr></table></td>
        <td style="${FONT}font-size:12px;color:#1d2330;padding:4px 0 4px 10px;white-space:nowrap;width:1%;">${value}</td>
      </tr>`;
    }).join('');
    return title + `<table role="presentation" style="width:100%;border-collapse:collapse;">${rows}</table>` +
      (split ? legendHtml(d.splits.map(s => ({ label: s.label, color: s.color, value: d.groups.reduce((n, g) => n + (g.parts[s.key] || 0), 0) }))) : '');
  }

  // ---------- Execução diária: planejado x realizado ----------
  const isIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  function addDays(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  const isWeekend = (iso) => { const g = new Date(`${iso}T12:00:00Z`).getUTCDay(); return g === 0 || g === 6; };
  const shortDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  function dailySeries(cfg) {
    const rDate = reportDate();
    const valid = state.tests.filter(t => t.status !== 'na');
    const realized = {};
    let undated = 0;
    valid.filter(t => t.status === 'passed' || t.status === 'failed').forEach(t => {
      if (!isIso(t.executedAt)) undated++;
      else if (t.executedAt <= rDate) realized[t.executedAt] = (realized[t.executedAt] || 0) + 1;
    });
    const { startDate, endDate } = state.project;
    const hasColumn = valid.some(t => isIso(t.plannedDate));
    const hasPeriod = isIso(startDate) && isIso(endDate) && startDate <= endDate;
    let planMode = cfg.plan || 'auto';
    if (planMode === 'auto') planMode = hasColumn ? 'column' : hasPeriod ? 'linear' : 'none';
    if (planMode === 'column' && !hasColumn) planMode = 'none';
    if (planMode === 'linear' && !hasPeriod) planMode = 'none';

    const planned = {};
    let unplanned = 0;
    if (planMode === 'column') {
      valid.forEach(t => { if (isIso(t.plannedDate)) planned[t.plannedDate] = (planned[t.plannedDate] || 0) + 1; else unplanned++; });
    } else if (planMode === 'linear') {
      const days = [];
      for (let d = startDate; d <= endDate && days.length < 400; d = addDays(d, 1)) if (!isWeekend(d)) days.push(d);
      if (!days.length) days.push(startDate);
      days.forEach((d, i) => { planned[d] = Math.round(valid.length * (i + 1) / days.length) - Math.round(valid.length * i / days.length); });
    }

    const keys = [...Object.keys(realized), ...Object.keys(planned)];
    if (hasPeriod) keys.push(startDate, endDate);
    const base = { rows: [], hasPlan: planMode !== 'none', planMode, undated, unplanned, plannedToDate: 0, realizedToDate: 0, totalPlanned: 0, total: valid.length, rDate };
    if (!keys.length) return base;
    const first = keys.reduce((a, b) => (a < b ? a : b));
    let last = keys.reduce((a, b) => (a > b ? a : b));
    if (rDate > last && rDate <= addDays(last, 14)) last = rDate;

    const rows = [];
    let cp = 0, cr = 0;
    for (let d = first; d <= last && rows.length < 370; d = addDays(d, 1)) {
      const p = planned[d] || 0, r = realized[d] || 0;
      if (cfg.skipWeekends !== false && isWeekend(d) && !p && !r) continue;
      cp += p; cr += r;
      const future = d > rDate;
      rows.push({ date: d, planned: p, realized: future ? null : r, cumPlanned: cp, cumRealized: future ? null : cr, future });
      if (!future) { base.plannedToDate = cp; base.realizedToDate = cr; }
    }
    base.rows = rows;
    base.totalPlanned = cp;
    return base;
  }

  function renderDaily(cfg) {
    const title = `<h3 style="${FONT}font-size:14px;margin:18px 0 8px;color:#1d2330;">${esc(cfg.title || 'Execução diária')}</h3>`;
    const s = dailySeries(cfg);
    if (!s.rows.length) {
      return title + `<p style="${FONT}font-size:13px;color:#8a93a3;">Sem datas para montar o gráfico. Preencha a Data de execução (e a Data planejada) no caderno, informe início e fim na aba Projeto, ou atualize o status na tabela do plano: a data de execução é registrada automaticamente.</p>`;
    }
    const cum = cfg.mode === 'cumulative';
    const n = s.rows.length;
    const W = 860, H = 260, ml = 40, mr = 12, mt = 16, mb = 44;
    const pw = W - ml - mr, ph = H - mt - mb, band = pw / n;
    const maxY = Math.max(1, ...s.rows.map(r => (cum ? Math.max(r.cumPlanned, r.cumRealized || 0) : Math.max(s.hasPlan ? r.planned : 0, r.realized || 0))));
    const step = Math.max(1, Math.ceil(maxY / 4));
    const top = step * Math.ceil(maxY / step);
    const y = (v) => mt + ph - (v / top) * ph;
    const xc = (i) => ml + band * i + band / 2;
    const C_PLAN = '#a3b5e8', C_REAL = '#2f5bd3';
    const parts = [];

    for (let v = 0; v <= top; v += step) {
      parts.push(`<line x1="${ml}" x2="${W - mr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e2e8f0"/>`);
      parts.push(`<text x="${ml - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#5d6676">${v}</text>`);
    }
    const every = Math.ceil(n / 16);
    s.rows.forEach((r, i) => {
      if (i % every === 0 || i === n - 1) parts.push(`<text x="${xc(i).toFixed(1)}" y="${H - mb + 16}" text-anchor="middle" font-size="10.5" fill="${r.future ? '#a0aec0' : '#5d6676'}">${shortDate(r.date)}</text>`);
    });

    if (!cum) {
      const bw = Math.min(band * (s.hasPlan ? 0.38 : 0.6), 26);
      s.rows.forEach((r, i) => {
        const cx = xc(i);
        if (s.hasPlan && r.planned) parts.push(`<rect x="${(s.hasPlan ? cx - bw : cx - bw / 2).toFixed(1)}" y="${y(r.planned).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(0) - y(r.planned)).toFixed(1)}" fill="${C_PLAN}" rx="2"><title>${shortDate(r.date)} — planejado: ${r.planned}</title></rect>`);
        if (r.realized) {
          const rx = s.hasPlan ? cx : cx - bw / 2;
          const color = s.hasPlan && r.realized < r.planned ? '#d97706' : C_REAL;
          parts.push(`<rect x="${rx.toFixed(1)}" y="${y(r.realized).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(0) - y(r.realized)).toFixed(1)}" fill="${color}" rx="2"><title>${shortDate(r.date)} — realizado: ${r.realized}${s.hasPlan ? ` de ${r.planned} planejados` : ''}</title></rect>`);
          if (n <= 31) parts.push(`<text x="${(rx + bw / 2).toFixed(1)}" y="${(y(r.realized) - 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#1d2330">${r.realized}</text>`);
        }
      });
    } else {
      if (s.hasPlan) {
        const pts = s.rows.map((r, i) => `${xc(i).toFixed(1)},${y(r.cumPlanned).toFixed(1)}`).join(' ');
        parts.push(`<polyline points="${pts}" fill="none" stroke="#8a93a3" stroke-width="2" stroke-dasharray="6 4"/>`);
      }
      const real = s.rows.map((r, i) => ({ r, i })).filter(o => o.r.cumRealized != null);
      if (real.length) {
        const pts = real.map(o => `${xc(o.i).toFixed(1)},${y(o.r.cumRealized).toFixed(1)}`).join(' ');
        const area = `${xc(real[0].i).toFixed(1)},${y(0).toFixed(1)} ${pts} ${xc(real[real.length - 1].i).toFixed(1)},${y(0).toFixed(1)}`;
        parts.push(`<polygon points="${area}" fill="${C_REAL}" fill-opacity="0.10"/>`);
        parts.push(`<polyline points="${pts}" fill="none" stroke="${C_REAL}" stroke-width="2.5"/>`);
        real.forEach(o => parts.push(`<circle cx="${xc(o.i).toFixed(1)}" cy="${y(o.r.cumRealized).toFixed(1)}" r="${n > 40 ? 2 : 3}" fill="${C_REAL}"><title>${shortDate(o.r.date)} — realizado acumulado: ${o.r.cumRealized}${s.hasPlan ? ` · planejado: ${o.r.cumPlanned}` : ''}</title></circle>`));
        const lastR = real[real.length - 1];
        parts.push(`<text x="${(xc(lastR.i) + 6).toFixed(1)}" y="${(y(lastR.r.cumRealized) - 6).toFixed(1)}" font-size="11" font-weight="700" fill="${C_REAL}">${lastR.r.cumRealized}</text>`);
      }
    }

    const ri = s.rows.findIndex(r => r.date >= s.rDate);
    if (ri >= 0 && s.rows.some(r => r.future)) {
      const xr = s.rows[ri].date === s.rDate ? xc(ri) + band / 2 : ml + band * ri;
      parts.push(`<line x1="${xr.toFixed(1)}" x2="${xr.toFixed(1)}" y1="${mt}" y2="${mt + ph}" stroke="#c53030" stroke-dasharray="3 3"/>`);
      parts.push(`<text x="${(xr - 4).toFixed(1)}" y="${mt + 10}" text-anchor="end" font-size="10" fill="#c53030">${fmtDate(s.rDate)}</text>`);
    }
    parts.push(`<line x1="${ml}" x2="${W - mr}" y1="${y(0)}" y2="${y(0)}" stroke="#cbd5e0"/>`);

    const svg = `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.title)}" style="max-width:${W}px;font-family:Segoe UI, Arial, sans-serif;">${parts.join('')}</svg>`;
    const legend = cum
      ? legendHtml([...(s.hasPlan ? [{ label: 'Planejado acumulado (tracejado)', color: '#8a93a3' }] : []), { label: 'Realizado acumulado', color: C_REAL }])
      : legendHtml([...(s.hasPlan ? [{ label: 'Planejado no dia', color: C_PLAN }] : []), { label: 'Realizado no dia', color: C_REAL }, ...(s.hasPlan ? [{ label: 'Realizado abaixo do planejado', color: '#d97706' }] : [])]);

    const dev = s.realizedToDate - s.plannedToDate;
    const devColor = dev < 0 ? '#c53030' : '#1f8a4c';
    const basis = s.planMode === 'column' ? 'planejado pela coluna Data planejada'
      : s.planMode === 'linear' ? `planejado distribuído nos dias úteis de ${fmtDate(state.project.startDate)} a ${fmtDate(state.project.endDate)}`
        : 'sem planejado (informe a Data planejada no caderno ou o período na aba Projeto)';
    const notes = [basis];
    if (s.undated) notes.push(`${s.undated} cenário(s) executado(s) sem data de execução não aparecem no gráfico`);
    if (s.unplanned) notes.push(`${s.unplanned} cenário(s) sem data planejada`);
    const summary = `<div style="${FONT}font-size:13px;color:#1d2330;margin-top:8px;">Até ${fmtDate(s.rDate)}: ${s.hasPlan ? `planejado <b>${s.plannedToDate}</b> · ` : ''}realizado <b>${s.realizedToDate}</b>${s.hasPlan ? ` (${fmtPct(pct(s.realizedToDate, s.plannedToDate))} do planejado) · desvio <b style="color:${devColor};">${dev > 0 ? '+' : ''}${dev}</b>` : ''} · total do plano: ${s.total}</div>
      <div style="${FONT}font-size:11px;color:#8a93a3;margin-top:3px;">${notes.map(esc).join(' · ')}</div>`;

    let table = '';
    if (cfg.showTable) {
      const tr = s.rows.filter(r => r.planned || r.realized).map(r => {
        const dd = r.realized == null ? '' : r.realized - r.planned;
        return `<tr><td style="${CELL}">${fmtDate(r.date)}</td>${s.hasPlan ? `<td style="${CELL}text-align:center;">${r.planned}</td>` : ''}<td style="${CELL}text-align:center;font-weight:600;">${r.realized == null ? '—' : r.realized}</td>${s.hasPlan ? `<td style="${CELL}text-align:center;color:${dd === '' ? '#a0aec0' : dd < 0 ? '#c53030' : '#1f8a4c'};">${dd === '' ? '—' : (dd > 0 ? '+' : '') + dd}</td><td style="${CELL}text-align:center;">${r.cumPlanned}</td>` : ''}<td style="${CELL}text-align:center;">${r.cumRealized == null ? '—' : r.cumRealized}</td></tr>`;
      }).join('');
      table = `<table style="width:100%;border-collapse:collapse;margin-top:10px;"><thead><tr><th style="${TH}">Data</th>${s.hasPlan ? `<th style="${TH}text-align:center;">Planejado</th>` : ''}<th style="${TH}text-align:center;">Realizado</th>${s.hasPlan ? `<th style="${TH}text-align:center;">Desvio</th><th style="${TH}text-align:center;">Acum. planejado</th>` : ''}<th style="${TH}text-align:center;">Acum. realizado</th></tr></thead><tbody>${tr}</tbody></table>`;
    }
    return title + svg + legend + summary + table;
  }

  // ---------- Configuração do report ----------
  function renderReportConfig() {
    const r = state.report;
    $('#cfgSections').innerHTML = SECTION_DEFS.map(s => `<label><input type="checkbox" data-section="${s.key}" ${r.sections[s.key] ? 'checked' : ''}> ${s.label}</label>`).join('');
    $('#cfgKpis').innerHTML = KPI_DEFS.map(k => `<label><input type="checkbox" data-kpi="${k.key}" ${r.kpis.includes(k.key) ? 'checked' : ''}> ${k.label}</label>`).join('');
    $('#cfgCharts').innerHTML = r.charts.map((c, i) => {
      const dims = dimensions(c.source);
      const ctrl = `<div class="ctrl">
          <button class="btn small ghost" data-act="up" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button>
          <button class="btn small ghost" data-act="down" ${i === r.charts.length - 1 ? 'disabled' : ''} title="Descer">↓</button>
          <button class="btn small ghost" data-act="dup" title="Duplicar">Duplicar</button>
          <button class="btn small danger" data-act="del" title="Remover">Remover</button>
        </div>`;
      if (c.type === 'daily') {
        const hasPlanned = state.tests.some(t => t.plannedDate);
        return `<div class="chart-cfg" data-id="${esc(c.id)}">
          <label class="full">Título<input data-k="title" value="${esc(c.title)}"></label>
          <label class="full">Tipo<select data-k="type">${CHART_TYPES.map(t => `<option value="${t.key}" ${t.key === c.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
          <label>Visão<select data-k="mode"><option value="daily" ${c.mode !== 'cumulative' ? 'selected' : ''}>Por dia</option><option value="cumulative" ${c.mode === 'cumulative' ? 'selected' : ''}>Acumulado (curva S)</option></select></label>
          <label>Planejado<select data-k="plan">
            <option value="auto" ${(c.plan || 'auto') === 'auto' ? 'selected' : ''}>Automático</option>
            <option value="column" ${c.plan === 'column' ? 'selected' : ''}>Data planejada</option>
            <option value="linear" ${c.plan === 'linear' ? 'selected' : ''}>Distribuir no período</option>
            <option value="none" ${c.plan === 'none' ? 'selected' : ''}>Não mostrar</option>
          </select></label>
          <label class="inline full"><input type="checkbox" data-k="skipWeekends" ${c.skipWeekends !== false ? 'checked' : ''}> Ignorar fins de semana sem execução</label>
          <label class="inline full"><input type="checkbox" data-k="showTable" ${c.showTable ? 'checked' : ''}> Incluir tabela dia a dia</label>
          <p class="hint full" style="margin:0;font-size:.75rem;">${hasPlanned ? 'O plano tem Data planejada: o planejado vem dela.' : 'Sem Data planejada no plano: o automático distribui os cenários pelos dias úteis entre início e fim do projeto.'}</p>
          ${ctrl}
        </div>`;
      }
      return `<div class="chart-cfg" data-id="${esc(c.id)}">
        <label class="full">Título<input data-k="title" value="${esc(c.title)}"></label>
        <label>Tipo<select data-k="type">${CHART_TYPES.map(t => `<option value="${t.key}" ${t.key === c.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
        <label>Dados<select data-k="source"><option value="tests" ${c.source === 'tests' ? 'selected' : ''}>Cenários de teste</option><option value="bugs" ${c.source === 'bugs' ? 'selected' : ''}>Bugs</option></select></label>
        <label>${c.type === 'donut' ? 'Fatias por' : 'Agrupar por'}<select data-k="groupBy">${dims.map(d => `<option value="${esc(d.key)}" ${d.key === c.groupBy ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select></label>
        ${c.type === 'donut' ? '<span></span>' : `<label>Dividir por<select data-k="splitBy"><option value="">— nenhum —</option>${dims.filter(d => d.key !== c.groupBy).map(d => `<option value="${esc(d.key)}" ${d.key === c.splitBy ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select></label>`}
        <label>Máx. de itens<input type="number" min="0" data-k="limit" value="${c.limit || 0}" title="0 = todos"></label>
        ${(c.type === 'bar' || c.type === 'column') && c.splitBy ? `<label class="inline"><input type="checkbox" data-k="percent" ${c.percent ? 'checked' : ''}> Mostrar em 100%</label>` : '<span></span>'}
        <div class="ctrl">
          <button class="btn small ghost" data-act="up" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button>
          <button class="btn small ghost" data-act="down" ${i === r.charts.length - 1 ? 'disabled' : ''} title="Descer">↓</button>
          <button class="btn small ghost" data-act="dup" title="Duplicar">Duplicar</button>
          <button class="btn small danger" data-act="del" title="Remover">Remover</button>
        </div>
      </div>`;
    }).join('') || '<p class="hint">Nenhum gráfico. Adicione um abaixo.</p>';
  }

  // ---------- Report ----------
  function reportDate() { return $('#reportDate').value || today(); }

  function buildReportHtml() {
    const p = state.project;
    const cfg = state.report;
    const on = (k) => cfg.sections[k] !== false;
    const tm = testMetrics();
    const bm = bugMetrics();
    const health = computeHealth(tm, bm);
    const h = HEALTH[health.key] || HEALTH.green;
    const date = reportDate();
    const dayNotes = state.notes.filter(n => n.date === date);
    const sectionTitle = (t) => `<h2 style="${FONT}font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:#2f5bd3;margin:28px 0 10px;border-bottom:2px solid #e8eefc;padding-bottom:6px;">${t}</h2>`;

    const kpis = cfg.kpis.map(k => KPI_DEFS.find(d => d.key === k)).filter(Boolean);
    const perRow = kpis.length <= 6 ? kpis.length : Math.ceil(kpis.length / Math.ceil(kpis.length / 6));
    const kpiRows = [];
    for (let i = 0; i < kpis.length; i += perRow) kpiRows.push(kpis.slice(i, i + perRow));
    const kpiHtml = kpiRows.map(row => `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px 8px;margin:0 -8px;"><tr>${row.map(k => `
      <td style="${FONT}background:#f5f6f8;border-radius:8px;padding:12px;text-align:center;width:${100 / perRow}%;">
        <div style="font-size:24px;font-weight:700;color:#1d2330;">${esc(k.get(tm, bm))}</div>
        <div style="font-size:11px;color:#5d6676;text-transform:uppercase;letter-spacing:.03em;">${k.label}</div>
      </td>`).join('')}</tr></table>`).join('');

    const openBugsRows = bm.open.slice()
      .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
      .map(b => `<tr>
        <td style="${CELL}white-space:nowrap;">${b.link ? `<a href="${esc(b.link)}" style="color:#2f5bd3;">${esc(b.key || '—')}</a>` : esc(b.key || '—')}</td>
        <td style="${CELL}">${esc(b.title)}${b.notes ? `<div style="color:#5d6676;font-size:12px;">${esc(b.notes)}</div>` : ''}</td>
        <td style="${CELL}color:${SEV_COLORS[b.severity] || '#1d2330'};font-weight:600;">${esc(b.severity)}</td>
        <td style="${CELL}">${esc(b.status)}</td>
        <td style="${CELL}">${esc(b.module)}</td>
        <td style="${CELL}">${esc(b.owner)}</td>
      </tr>`).join('');

    const failed = state.tests.filter(t => t.status === 'blocked' || t.status === 'failed');
    const failedRows = failed.map(t => `<tr>
      <td style="${CELL}white-space:nowrap;">${esc(t.id)}</td>
      <td style="${CELL}">${esc(t.title)}</td>
      <td style="${CELL}">${esc(t.module)}</td>
      <td style="${CELL}">${esc(t.bugRef || '')}</td>
      <td style="${CELL}color:${STATUS_BY_KEY[t.status].color};font-weight:600;">${STATUS_BY_KEY[t.status].label}</td>
    </tr>`).join('');

    const notesHtml = Object.keys(NOTE_TYPES).map(type => {
      const items = dayNotes.filter(n => n.type === type);
      if (!items.length) return '';
      return `<h3 style="${FONT}font-size:13px;margin:14px 0 6px;color:#1d2330;">${NOTE_TYPES[type]}</h3>
        <ul style="${FONT}margin:0;padding-left:20px;font-size:13px;color:#1d2330;">${items.map(n => `<li style="margin-bottom:4px;white-space:pre-wrap;">${esc(n.text)}</li>`).join('')}</ul>`;
    }).join('');

    const meta = [
      p.release && ['Release', p.release],
      p.environment && ['Ambiente', p.environment],
      (p.startDate || p.endDate) && ['Período', `${fmtDate(p.startDate) || '?'} a ${fmtDate(p.endDate) || '?'}`],
      p.owner && ['Responsável QA', p.owner],
      p.audience && ['Para', p.audience],
    ].filter(Boolean);

    const charts = cfg.charts.filter(c => (c.source === 'bugs' ? state.bugs.length : state.tests.length));

    return `
<div style="${FONT}color:#1d2330;max-width:900px;margin:0 auto;background:#ffffff;">
  <div style="background:#1d2330;color:#ffffff;padding:22px 26px;">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.7;">Status report de homologação · ${fmtDate(date)}</div>
    <div style="font-size:24px;font-weight:700;margin-top:4px;">${esc(p.name || 'Projeto sem nome')}</div>
    ${meta.length ? `<div style="font-size:13px;margin-top:8px;opacity:.85;">${meta.map(([k, v]) => `<span style="margin-right:18px;">${k}: <b>${esc(v)}</b></span>`).join('')}</div>` : ''}
  </div>
  <div style="padding:6px 26px 28px;">
    ${on('health') ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:20px;"><tr>
      <td style="${FONT}background:${h.bg};border-left:6px solid ${h.color};padding:14px 16px;border-radius:6px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#5d6676;">Status geral</div>
        <div style="font-size:20px;font-weight:700;color:${h.color};">● ${h.label}</div>
        <div style="font-size:13px;color:#1d2330;margin-top:4px;">${health.reasons.map(esc).join(' · ')}</div>
      </td>
    </tr></table>` : ''}
    ${on('scope') && p.scope ? `<p style="${FONT}font-size:13px;color:#5d6676;margin:14px 0 0;white-space:pre-wrap;"><b style="color:#1d2330;">Escopo:</b> ${esc(p.scope)}</p>` : ''}

    ${on('kpis') && kpis.length ? sectionTitle('Indicadores') + kpiHtml : ''}

    ${on('charts') && charts.length ? sectionTitle('Gráficos') + charts.map(renderChart).join('') +
      (state.planFile ? `<div style="${FONT}font-size:11px;color:#8a93a3;margin-top:10px;">Fonte do plano: ${esc(state.planFile)}</div>` : '') : ''}

    ${on('notes') ? sectionTitle('Comentários do dia') + (notesHtml || `<p style="${FONT}font-size:13px;color:#8a93a3;">Nenhum comentário registrado para ${fmtDate(date)}.</p>`) : ''}

    ${on('openBugs') ? sectionTitle(`Bugs em aberto (${bm.openCount})`) + (bm.openCount ? `
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr><th style="${TH}">ID</th><th style="${TH}">Título</th><th style="${TH}">Sev.</th><th style="${TH}">Status</th><th style="${TH}">Módulo</th><th style="${TH}">Resp.</th></tr></thead>
      <tbody>${openBugsRows}</tbody>
    </table>` : `<p style="${FONT}font-size:13px;color:#1f8a4c;">Nenhum bug em aberto.</p>`) : ''}

    ${on('failedTests') && failed.length ? sectionTitle(`Cenários com falha ou bloqueados (${failed.length})`) + `
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr><th style="${TH}">ID</th><th style="${TH}">Cenário</th><th style="${TH}">Módulo</th><th style="${TH}">Bug</th><th style="${TH}">Status</th></tr></thead>
      <tbody>${failedRows}</tbody>
    </table>` : ''}

    <p style="${FONT}font-size:11px;color:#8a93a3;margin-top:28px;border-top:1px solid #e2e8f0;padding-top:10px;">Gerado em ${new Date().toLocaleString('pt-BR')}${p.owner ? ` por ${esc(p.owner)}` : ''}.</p>
  </div>
</div>`;
  }

  function buildReportText() {
    const p = state.project;
    const on = (k) => state.report.sections[k] !== false;
    const tm = testMetrics();
    const bm = bugMetrics();
    const health = computeHealth(tm, bm);
    const date = reportDate();
    const dot = { green: '🟢', yellow: '🟡', red: '🔴' }[health.key];
    const lines = [];
    lines.push(`*Status Report — ${p.name || 'Projeto'}* (${fmtDate(date)})`);
    const meta = [p.release, p.environment].filter(Boolean).join(' · ');
    if (meta) lines.push(meta);
    if (on('health')) { lines.push(''); lines.push(`${dot} Status geral: *${HEALTH[health.key].label}* — ${health.reasons.join('; ')}`); }
    if (on('kpis') && state.report.kpis.length) {
      lines.push('');
      lines.push('*Indicadores*');
      state.report.kpis.map(k => KPI_DEFS.find(d => d.key === k)).filter(Boolean).forEach(k => lines.push(`• ${k.label}: ${k.get(tm, bm)}`));
    }
    if (on('openBugs') && bm.openCount) {
      lines.push('');
      lines.push(`*Bugs em aberto (${bm.openCount})*`);
      bm.open.slice().sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)).forEach(b => {
        lines.push(`• [${b.severity}] ${b.key ? b.key + ' — ' : ''}${b.title} (${b.status})`);
      });
    }
    if (on('notes')) {
      const dayNotes = state.notes.filter(n => n.date === date);
      Object.keys(NOTE_TYPES).forEach(type => {
        const items = dayNotes.filter(n => n.type === type);
        if (!items.length) return;
        lines.push('');
        lines.push(`*${NOTE_TYPES[type]}*`);
        items.forEach(n => lines.push(`• ${n.text}`));
      });
    }
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
    } catch (e) { /* fallback abaixo */ }
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

  // ---------- Dados de exemplo ----------
  function demoState() {
    const t = today();
    const d = (offset) => { const x = new Date(t); x.setDate(x.getDate() + offset); return x.toISOString().slice(0, 10); };
    const mods = ['Cotação', 'Emissão', 'Pagamento', 'Portal do Corretor'];
    const st = ['passed', 'passed', 'passed', 'failed', 'blocked', 'pending', 'passed', 'inprogress', 'passed', 'pending'];
    const tests = Array.from({ length: 32 }, (_, i) => { const off = -4 + Math.floor(i / 4); const stt = off <= 0 ? st[i % st.length] : 'pending'; return {
      uid: uid(), id: `CT-${String(i + 1).padStart(3, '0')}`,
      title: ['Validar cálculo de prêmio', 'Gerar proposta em PDF', 'Pagamento via boleto', 'Login do corretor', 'Endosso de inclusão', 'Validação de CEP', 'Cancelamento de apólice', 'Reenvio de e-mail'][i % 8] + ` — cenário ${i + 1}`,
      module: mods[i % mods.length], owner: ['Ana', 'Bruno', 'Carla'][i % 3], priority: ['Alta', 'Média', 'Baixa'][i % 3],
      status: stt, plannedDate: d(off), executedAt: stt === 'passed' || stt === 'failed' ? d(Math.min(off + (i % 5 === 0 ? 1 : 0), 0)) : '', bugRef: '',
      extra: { Ciclo: i < 20 ? 'Ciclo 1' : 'Ciclo 2' },
    }; });
    const s = emptyState();
    return Object.assign(s, {
      project: { name: 'Portal de Cotação (exemplo)', release: 'R2.4', environment: 'HML', owner: 'Equipe QA', startDate: d(-4), endDate: d(5), scope: 'Homologação do novo fluxo de cotação e emissão para corretores.', statusOverride: '', audience: 'PO, Dev, Negócio' },
      tests, planFile: 'exemplo.xlsx', planModel: 'Caderno padrão', extraFields: ['Ciclo'],
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
      models: state.models,
      report: state.report,
    });
  }

  // ---------- Eventos ----------
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
        state = hydrate(data);
        save(); renderAll(); toast('Backup importado.');
      } catch (err) { toast('Arquivo de backup inválido.'); }
      e.target.value = '';
    });
    $('#loadDemo').addEventListener('click', () => {
      if ((state.tests.length || state.bugs.length || state.notes.length) && !confirm('Substituir os dados atuais pelos dados de exemplo?')) return;
      state = demoState(); save(); renderAll(); toast('Dados de exemplo carregados.');
    });
    $('#resetAll').addEventListener('click', () => {
      if (!confirm('Apagar todos os dados (projeto, plano, bugs, comentários, modelos e configuração do report)? Exporte um backup antes se precisar.')) return;
      state = emptyState(); imp = null; save(); renderAll(); toast('Dados apagados.');
    });

    // Plano: modelo padrão e upload
    $('#downloadTemplate').addEventListener('click', downloadTemplate);
    const dz = $('#dropzone');
    $('#planFile').addEventListener('change', (e) => { handlePlanFile(e.target.files[0]); e.target.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', (e) => handlePlanFile(e.dataTransfer.files[0]));

    // Configuração da importação
    $('#closeImport').addEventListener('click', () => { $('#importCard').hidden = true; });
    $('#impModel').addEventListener('change', (e) => {
      const model = [STANDARD_MODEL, ...state.models].find(m => m.id === e.target.value);
      if (model) {
        const found = findModel({ [imp.sheet]: impAoa() });
        useModel(model, null, found && found.model.id === model.id ? found.headerRow : imp.headerRow);
      } else useModel(null, null, null);
      renderImport();
    });
    $('#impSheet').addEventListener('change', (e) => { imp.sheet = e.target.value; imp.headerRow = detectHeaderRow(impAoa()); imp.mapping = detectMapping(impHeaders()); imp.extras = []; renderImport(); });
    $('#impHeaderRow').addEventListener('change', (e) => {
      const n = Math.max(1, Math.min(parseInt(e.target.value, 10) || 1, impAoa().length || 1));
      imp.headerRow = n - 1; imp.mapping = detectMapping(impHeaders()); imp.extras = []; renderImport();
    });
    $('#impMapping').addEventListener('change', (e) => {
      const f = e.target.dataset.field; if (!f) return;
      // uma coluna só pode estar em um campo
      if (e.target.value) FIELDS.forEach(x => { if (x.key !== f && imp.mapping[x.key] === e.target.value) imp.mapping[x.key] = ''; });
      imp.mapping[f] = e.target.value;
      imp.extras = imp.extras.filter(h => h !== e.target.value);
      renderImport();
    });
    $('#impExtras').addEventListener('change', (e) => {
      imp.extras = $$('#impExtras input:checked').map(i => i.value);
      renderImport();
    });
    $('#impStatus').addEventListener('change', (e) => {
      const raw = e.target.dataset.raw; if (raw == null) return;
      imp.statusMap[raw] = e.target.value;
    });
    $('#impApply').addEventListener('click', () => {
      if (!imp.mapping.title && !imp.mapping.id) { toast('Indique ao menos a coluna de cenário ou de ID.'); return; }
      applyImport(); renderImport();
      toast(`${state.tests.length} cenários importados.`);
    });
    $('#impSaveModel').addEventListener('click', () => {
      if (!imp.mapping.title && !imp.mapping.id) { toast('Indique ao menos a coluna de cenário ou de ID.'); return; }
      if (!saveModelFromImport()) return;
      applyImport(); renderImport(); renderModels();
      toast(`Modelo "${imp.modelName}" salvo e ${state.tests.length} cenários importados.`);
    });

    // Modelos salvos
    $('#modelList').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]'); if (!btn) return;
      const id = btn.closest('.model-row').dataset.id;
      const model = state.models.find(m => m.id === id);
      if (btn.dataset.act === 'template') downloadTemplate();
      else if (btn.dataset.act === 'export' && model) download(`modelo-${slug(model.name)}.json`, JSON.stringify({ statusReportModel: 1, ...model }, null, 2), 'application/json');
      else if (btn.dataset.act === 'del' && model && confirm(`Excluir o modelo "${model.name}"?`)) {
        state.models = state.models.filter(m => m !== model); save(); renderModels(); if (imp) renderImport();
      }
    });
    $('#importModel').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data.mapping || !data.name) throw new Error('formato');
        const model = { id: uid(), name: data.name, sheet: data.sheet || '', mapping: data.mapping, extras: data.extras || [], statusMap: data.statusMap || {}, updatedAt: today() };
        state.models = state.models.filter(m => norm(m.name) !== norm(model.name)).concat(model);
        save(); renderModels(); toast(`Modelo "${model.name}" importado.`);
      } catch (err) { toast('Arquivo de modelo inválido.'); }
      e.target.value = '';
    });

    // Tabela do plano
    $('#testFilter').innerHTML += TEST_STATUSES.map(s => `<option value="${s.key}">${s.label}</option>`).join('');
    $('#testSearch').addEventListener('input', renderPlan);
    $('#testFilter').addEventListener('change', renderPlan);
    $('#addTest').addEventListener('click', () => {
      const title = prompt('Descrição do cenário:'); if (!title) return;
      const module = prompt('Módulo (opcional):') || '';
      state.tests.push({ uid: uid(), id: `CT-${String(state.tests.length + 1).padStart(3, '0')}`, title, module, owner: state.project.owner || '', priority: '', status: 'pending', extra: {} });
      save(); renderPlan();
    });
    $('#testTable').addEventListener('change', (e) => {
      if (e.target.classList.contains('test-exec')) {
        const t = state.tests.find(x => x.uid === e.target.closest('tr').dataset.uid);
        if (t) { t.executedAt = e.target.value; save(); }
        return;
      }
      if (!e.target.classList.contains('test-status')) return;
      const t = state.tests.find(x => x.uid === e.target.closest('tr').dataset.uid);
      if (t) {
        t.status = e.target.value;
        if ((t.status === 'passed' || t.status === 'failed') && !t.executedAt) t.executedAt = today();
        save(); renderPlan();
      }
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
      const data = Object.fromEntries(new FormData(e.target).entries());
      if (data.uid) {
        const b = state.bugs.find(x => x.uid === data.uid);
        if (b) Object.assign(b, data);
        toast('Bug atualizado.');
      } else {
        data.uid = uid(); data.createdAt = today();
        if (!data.key) data.key = `BUG-${String(state.bugs.length + 1).padStart(3, '0')}`;
        state.bugs.push(data);
        const t = data.testId && state.tests.find(x => x.id === data.testId);
        if (t) {
          if (t.status === 'pending' || t.status === 'inprogress' || t.status === 'passed') { t.status = 'failed'; t.executedAt = t.executedAt || today(); }
          if (!t.bugRef) t.bugRef = data.key;
        }
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

    // Comentários
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

    // Report: configuração
    const refresh = (rebuildConfig) => { save(); if (rebuildConfig) renderReportConfig(); renderReport(); };
    $('#toggleConfig').addEventListener('click', (e) => {
      const hidden = $('#reportLayout').classList.toggle('hide-config');
      e.currentTarget.setAttribute('aria-expanded', String(!hidden));
      e.currentTarget.textContent = hidden ? 'Configurar report' : 'Ocultar configuração';
    });
    $('#cfgSections').addEventListener('change', (e) => {
      const k = e.target.dataset.section; if (!k) return;
      state.report.sections[k] = e.target.checked; refresh();
    });
    $('#cfgKpis').addEventListener('change', () => {
      state.report.kpis = KPI_DEFS.filter(k => $(`#cfgKpis input[data-kpi="${k.key}"]`).checked).map(k => k.key);
      refresh();
    });
    const chartOf = (el) => { const box = el.closest('.chart-cfg'); return box && state.report.charts.find(c => c.id === box.dataset.id); };
    $('#cfgCharts').addEventListener('input', (e) => {
      if (e.target.dataset.k !== 'title') return;
      const c = chartOf(e.target); if (c) { c.title = e.target.value; refresh(); }
    });
    $('#cfgCharts').addEventListener('change', (e) => {
      const k = e.target.dataset.k; const c = chartOf(e.target); if (!k || !c || k === 'title') return;
      if (k === 'percent' || k === 'skipWeekends' || k === 'showTable') c[k] = e.target.checked;
      else if (k === 'limit') c.limit = Math.max(0, parseInt(e.target.value, 10) || 0);
      else c[k] = e.target.value;
      if (k === 'source') { c.groupBy = dimensions(c.source)[0].key; c.splitBy = ''; }
      if (k === 'groupBy' && c.splitBy === c.groupBy) c.splitBy = '';
      if (k === 'type' && c.type === 'donut') c.splitBy = '';
      if (k === 'type' && c.type === 'daily') { c.source = 'tests'; c.mode = c.mode || 'daily'; c.plan = c.plan || 'auto'; if (c.skipWeekends == null) c.skipWeekends = true; }
      if (k === 'type' && c.type !== 'daily' && !findDim(c.source, c.groupBy)) c.groupBy = dimensions(c.source)[0].key;
      refresh(true);
    });
    $('#cfgCharts').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]'); if (!btn) return;
      const c = chartOf(btn); if (!c) return;
      const arr = state.report.charts; const i = arr.indexOf(c);
      if (btn.dataset.act === 'del') arr.splice(i, 1);
      else if (btn.dataset.act === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      else if (btn.dataset.act === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      else if (btn.dataset.act === 'dup') arr.splice(i + 1, 0, Object.assign({}, c, { id: uid(), title: `${c.title} (cópia)` }));
      refresh(true);
    });
    $('#addChart').addEventListener('click', () => {
      state.report.charts.push({ id: uid(), title: 'Novo gráfico', type: 'bar', source: 'tests', groupBy: 'owner', splitBy: 'status', percent: false, limit: 0 });
      refresh(true);
      const boxes = $$('#cfgCharts .chart-cfg'); const last = boxes[boxes.length - 1];
      if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); $('input[data-k="title"]', last).select(); }
    });
    $('#resetCharts').addEventListener('click', () => {
      if (!confirm('Restaurar seções, indicadores e gráficos para o padrão?')) return;
      state.report = defaultReport(); refresh(true);
    });

    // Report: exportação
    $('#reportDate').value = today();
    $('#reportDate').addEventListener('change', renderReport);
    $('#copyText').addEventListener('click', async () => toast(await copyPlain(buildReportText()) ? 'Texto copiado. Cole no Teams/Slack.' : 'Não foi possível copiar.'));
    $('#copyHtml').addEventListener('click', async () => toast(await copyRich(buildReportHtml(), buildReportText()) ? 'Report copiado. Cole no corpo do e-mail.' : 'Não foi possível copiar.'));
    $('#downloadHtml').addEventListener('click', () => download(`${slug(state.project.name)}-status-${reportDate()}.html`, standaloneHtml(), 'text/html'));
    $('#printReport').addEventListener('click', () => { renderReport(); window.print(); });
  }

  function renderAll() {
    renderProject(); renderPlan(); renderBugs(); renderNotes(); renderModels();
    if (imp) renderImport();
    if ($('#tab-report').classList.contains('active')) { renderReportConfig(); renderReport(); }
  }

  bind();
  renderAll();
  let initialTab = 'projeto';
  try { initialTab = sessionStorage.getItem('statusReport.tab') || initialTab; } catch (e) { /* ignore */ }
  showTab(initialTab);
})();
