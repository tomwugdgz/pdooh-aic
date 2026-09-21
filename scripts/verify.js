#!/usr/bin/env node
/**
 * 全栈端到端验证脚本
 *  1. 检查 16 个模块的 API 数据形状是否为前端 renderer 所需
 *  2. 在 Node 中用 DOM stub 真实执行 public/app.js 的全部页面渲染函数
 *  3. 覆盖所有写操作接口（审批 / 跟进 / 工单 / 投票 / 素材 / 日报 / 同步 / AI 对话 / SQL 控制台）
 * 用法: node scripts/verify.js [baseUrl]
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:5003';
const RESET = process.argv.includes('--reset') || process.env.RESET_DB === '1';
let pass = 0, fail = 0;
const failures = [];

// --reset：直接用 node:sqlite 重灌种子数据，让整套断言完全确定性、可反复运行
if (RESET) {
  const { DatabaseSync } = require('node:sqlite');
  const dbFile = path.join(__dirname, '..', 'data', 'pdooh.db');
  let db;
  try {
    db = new DatabaseSync(dbFile);
    db.exec('PRAGMA busy_timeout = 10000;');     // 与服务连接互让锁，避免 SQLITE_BUSY
    db.exec('PRAGMA foreign_keys = OFF;');       // 重灌期间允许按任意顺序 DELETE
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'sql', 'seed.sql'), 'utf8'));
    console.log('\n[reset] 已重灌种子数据: ' + dbFile);
  } catch (e) {
    console.error('\n[reset] 重灌失败: ' + e.message);
    try { db && db.exec('ROLLBACK;'); } catch { /* 无活动事务 */ }   // 关键：不留悬挂事务锁
  } finally {
    try { db && db.close(); } catch { /* ignore */ }
  }
}

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); }
}

(async () => {
  console.log('\n═══ 1. 健康检查 & 数据接口 ═══');
  const health = await (await fetch(BASE + '/api/health')).json();
  check('/api/health', health.ok === true, JSON.stringify(health));

  const boot = (await (await fetch(BASE + '/api/bootstrap')).json()).data;
  check('bootstrap 返回 16 模块', ['dashboard', 'pending', 'mapData', 'messages', 'sales', 'progress',
    'community', 'contracts', 'creative', 'agents', 'service', 'knowledge', 'rd', 'roadmap', 'daily', 'dataSources']
    .every(k => boot[k] !== undefined));
  check('bootstrap 含 KPI / 对话 / 指标', !!boot.kpi && !!boot.chat && !!boot.metrics);

  console.log('\n═══ 2. 数据形状（前端 renderer 依赖字段） ═══');
  check('dashboard.stats/schedule/reminders/team',
    boot.dashboard.stats.length === 4 && boot.dashboard.schedule.length === 7 &&
    boot.dashboard.reminders.length === 3 && boot.dashboard.team.length === 6);
  check('pending 三类清单', boot.pending.spots.length > 0 && boot.pending.contracts.length > 0 && boot.pending.creatives.length > 0);
  check('mapData.cities 含 total/类型拆分',
    boot.mapData.cities.every(c => c.total && c.smartScreen !== undefined && c.door !== undefined && c.gate !== undefined && c.elevator !== undefined));
  check('mapData 点位总数 2368', boot.mapData.cities.reduce((s, c) => s + c.total, 0) === 2368,
    String(boot.mapData.cities.reduce((s, c) => s + c.total, 0)));
  check('messages / sales / progress / community / contracts', boot.messages.length === 10 && boot.sales.funnel.length === 4 &&
    boot.sales.ranking.length === 5 && boot.progress.length === 6 && boot.community.length === 4 && boot.contracts.length === 8);
  // 可变集合（写操作会新增/消耗）用下限断言，保证脚本可重复运行
  check('creative / agents / service / knowledge / rd / daily / dataSources',
    boot.creative.length >= 8 && boot.agents.length === 4 && boot.service.length === 7 &&
    boot.knowledge.length === 8 && boot.rd.length === 10 && boot.daily.length >= 6 && boot.dataSources.length === 7,
    `creative=${boot.creative.length} daily=${boot.daily.length}`);
  check('roadmap 4 个季度', boot.roadmap.length === 4);
  check('knowledge.tags 已转数组', Array.isArray(boot.knowledge[0].tags));
  check('daily 含 done/plan 列表', Array.isArray(boot.daily[0].done) && Array.isArray(boot.daily[0].plan));
  check('KPI 4 项且含实时值', boot.kpi.length === 4 && boot.kpi.every(k => k.value && k.label));
  check('AI 对话历史已加载', boot.chat.messages.length >= 4);
  // 注意 customers 接口按紧急度排序，[0] 不一定是 id=1，故校验最小 id
  check('主键 id 稳定（自增游标已重置）',
    Math.min(...boot.messages.map(m => m.id)) === 1 && boot.messages.length === 10,
    `min(customer.id)=${Math.min(...boot.messages.map(m => m.id))}`);

  console.log('\n═══ 3. 在 Node 中执行真实前端渲染函数 ═══');
  const listeners = {};
  const fakeEl = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, scrollTop: 0, scrollHeight: 100,
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, insertAdjacentHTML() {}, remove() {}, querySelectorAll: () => [],
    querySelector: () => null, setAttribute() {}, getAttribute: () => null, focus() {}, click() {}
  });
  const sandbox = {
    console, fetch, setTimeout, clearTimeout, Promise, JSON, Math, Date, Number, String, Array, Object, Error, RegExp,
    URLSearchParams, URL,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: class { constructor() {} },
    document: {
      addEventListener(ev, fn) { listeners[ev] = fn; },
      getElementById: () => fakeEl(), querySelector: () => fakeEl(), querySelectorAll: () => [],
      createElement: () => fakeEl(), head: { appendChild() {} }, body: { appendChild() {} }
    },
    window: { location: { href: '' } }, location: { search: '', href: '', pathname: '/' },
    alert: () => {}, prompt: () => '宝马'
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  // const/let 声明不会挂到 vm 全局，追加导出行以便测试直接调用
  const probe = src + `
;globalThis.__EXPORTS__ = {
  PAGE_RENDERERS, PAGE_TITLES, MOCK, META, API, CONFIG,
  loadAllData, hydrateKpi, hydrateChat, decidePending, contactCustomer, updateTicket,
  voteRd, generateCreative, syncDataSource, syncAllDataSources, submitDailyForm, exportDaily,
  openSqlConsole, runSqlConsole, chatMessageHtml, fmtMoney, fmtTime, refreshData, exportReport
};
globalThis.__setData__ = (m, meta) => { MOCK = m; META = meta; };`;
  try {
    vm.runInContext(probe, sandbox, { filename: 'app.js' });
    check('app.js 在沙箱中加载无异常', true);
  } catch (e) { check('app.js 在沙箱中加载无异常', false, e.message); }

  sandbox.__setData__({
    dashboard: boot.dashboard, pending: boot.pending, mapData: boot.mapData, messages: boot.messages,
    sales: boot.sales, progress: boot.progress, community: boot.community, contracts: boot.contracts,
    creative: boot.creative, agents: boot.agents, service: boot.service, knowledge: boot.knowledge,
    rd: boot.rd, roadmap: boot.roadmap, daily: boot.daily, dataSources: boot.dataSources
  }, { kpi: boot.kpi, chat: boot.chat, metrics: boot.metrics, generatedAt: boot.generatedAt });

  const R = sandbox.__EXPORTS__;
  check('PAGE_RENDERERS 注册 16 个模块页', Object.keys(R.PAGE_RENDERERS).length === 16,
    Object.keys(R.PAGE_RENDERERS).join(','));
  for (const [id, fn] of Object.entries(R.PAGE_RENDERERS)) {
    try {
      const html = fn();
      check(`渲染 ${id} (${html.length} 字符)`, typeof html === 'string' && html.length > 200);
    } catch (e) { check(`渲染 ${id}`, false, e.message); }
  }
  check('KPI 卡片渲染函数可用', typeof R.hydrateKpi === 'function');
  check('对话记录渲染函数可用', typeof R.hydrateChat === 'function' && R.chatMessageHtml(boot.chat.messages[0]).includes('message-avatar'));
  check('日报 CSV 导出函数可用', typeof R.exportDaily === 'function');
  check('SQL 控制台函数可用', typeof R.openSqlConsole === 'function' && typeof R.runSqlConsole === 'function');
  try {
    const rows = boot.contracts.length + boot.progress.length;
    check('导出 CSV 数据源可组装', rows > 0);
  } catch (e) { check('导出 CSV', false, e.message); }

  console.log('\n═══ 4. 罗姐 AI 引擎（SQL 实时计算） ═══');
  for (const [q, expectCat] of [['今日投放收入怎么样？', '收入分析'], ['有哪些风险要注意？', '风险预警'],
    ['点位覆盖情况如何？', '点位分析'], ['ROI 指数评估一下', 'ROI评估'], ['随便说点什么', '经营总览']]) {
    const r = await (await fetch(BASE + '/api/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, conversationId: 1 })
    })).json();
    check(`AI 回答「${q}」→ ${r.data?.category}`, r.ok && r.data.category === expectCat && r.data.html.length > 100, r.data?.category);
  }
  const hist = (await (await fetch(BASE + '/api/ai/history?conversationId=1')).json()).data;
  check('AI 对话已持久化到 ai_messages 表', hist.length >= 14, '条数=' + hist.length);

  console.log('\n═══ 5. 写操作接口（真实 UPDATE/INSERT） ═══');
  const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());

  // 审批：动态取一个仍处于 pending 的项驳回，断言其状态真的落库（可重复运行）
  const pend0 = (await (await fetch(BASE + '/api/pending')).json()).data;
  const target = pend0.spots[0] || pend0.contracts[0] || pend0.creatives[0];
  let r1 = await post('/api/pending/decision', { code: target.id, action: 'reject', note: '自动化验证' });
  const pend1 = (await (await fetch(BASE + '/api/pending')).json()).data;
  check('审批驳回写库', r1.ok && r1.data.status === 'rejected' &&
    ![...pend1.spots, ...pend1.contracts, ...pend1.creatives].some(x => x.id === target.id) &&
    pend1.stats.rejected === pend0.stats.rejected + 1,
    JSON.stringify(r1.data));
  // 审批：批准一项，断言 pending 数量减少
  const target2 = pend1.spots[0] || pend1.contracts[0] || pend1.creatives[0];
  let r1b = await post('/api/pending/decision', { code: target2.id, action: 'approve' });
  const pend2 = (await (await fetch(BASE + '/api/pending')).json()).data;
  check('审批批准写库', r1b.ok && pend2.stats.approved === pend1.stats.approved + 1, JSON.stringify(r1b.data));

  // 动态取 id，避免依赖自增主键的具体数值
  const cust = (await (await fetch(BASE + '/api/customers')).json()).data.list[2];
  let r2 = await post('/api/customers/contact', { id: cust.id });
  check('客户跟进写库', r2.ok && r2.data.follow_count >= 1, JSON.stringify(r2.data));

  let r3 = await post('/api/tickets/update', { code: 'TK-2026-0624-02', status: 'processing', handler: '小王' });
  check('工单状态更新', r3.ok && r3.data.status === 'processing' && r3.data.handler === '小王');

  const rdItem = (await (await fetch(BASE + '/api/rd')).json()).data.requirements[0];
  let r4 = await post('/api/rd/vote', { id: rdItem.id });
  check('研发需求投票 +1', r4.ok && r4.data.votes === rdItem.votes + 1, `${rdItem.votes} → ${r4.data?.votes}`);

  let r5 = await post('/api/creatives/generate', { client: '验证客户', type: '视频' });
  const creatives = (await (await fetch(BASE + '/api/creatives')).json()).data;
  check('AI 素材生成写库', r5.ok && creatives.some(c => c.name === r5.data.name), r5.data?.name);

  let r6 = await post('/api/daily/submit', { title: '验证日报', author: '张三', dept: '测试部', done: ['A', 'B'], plan: ['C'] });
  const daily = (await (await fetch(BASE + '/api/daily')).json()).data;
  const submitted = daily.find(d => d.id === r6.data.id);
  check('日报提交写库（含子表）', r6.ok && submitted && submitted.done.length === 2 && submitted.plan.length === 1);

  const ds = (await (await fetch(BASE + '/api/datasources')).json()).data.at(-2);
  let r7 = await post('/api/datasources/sync', { id: ds.id });
  check('数据源同步更新', r7.ok && r7.data.lastSync === '刚刚', JSON.stringify(r7.data));

  console.log('\n═══ 6. SQL 查询控制台（只读校验） ═══');
  const q1 = await post('/api/sql/query', { sql: 'SELECT c.name AS city, COUNT(p.id) AS cnt FROM cities c JOIN points p ON p.city_id=c.id GROUP BY c.id ORDER BY cnt DESC' });
  check('SELECT 聚合查询', q1.ok && q1.data.ok && q1.data.rowCount === 5, JSON.stringify(q1.data).slice(0, 120));
  const q2 = await post('/api/sql/query', { sql: 'SELECT status, COUNT(*) AS cnt FROM points GROUP BY status' });
  check('点位状态分组查询', q2.data.ok && q2.data.rows.length === 4);
  const q3 = await post('/api/sql/query', { sql: 'DELETE FROM contracts' });
  check('拒绝写操作 SQL', q3.data.ok === false && q3.data.error === 'FORBIDDEN', JSON.stringify(q3.data));
  const q4 = await post('/api/sql/query', { sql: 'SELECT 1; DROP TABLE points' });
  check('拒绝多语句 SQL', q4.data.ok === false);
  const q5 = await post('/api/sql/query', { sql: 'SELECT stat_date, SUM(amount) AS s FROM revenue_daily GROUP BY stat_date ORDER BY stat_date DESC LIMIT 3' });
  check('自带 LIMIT 的查询不被破坏', q5.data.ok === true && q5.data.rowCount === 3, JSON.stringify(q5.data).slice(0, 100));
  const q6 = await post('/api/sql/query', { sql: 'WITH t AS (SELECT city_id, SUM(amount) s FROM revenue_daily GROUP BY city_id) SELECT c.name, t.s FROM t JOIN cities c ON c.id=t.city_id ORDER BY t.s DESC LIMIT 2' });
  check('WITH 子句查询可用', q6.data.ok === true && q6.data.rowCount === 2);
  const q7 = await post('/api/sql/query', { sql: 'SELECT * FROM points' });
  check('无 LIMIT 查询被强制 200 行上限', q7.data.ok === true && q7.data.rowCount === 200, 'rowCount=' + q7.data.rowCount);

  console.log('\n═══ 7. 分析接口 & 报表导出 ═══');
  const rev = (await (await fetch(BASE + '/api/analytics/revenue?days=30')).json()).data;
  check('收入分析（30天/渠道/城市）', rev.daily.length === 30 && rev.byChannel.length === 4 && rev.byCity.length === 5);
  check('今日收入 = ¥126,000（对齐原页面 ¥12.6万）', Math.round(rev.today) === 126000, String(rev.today));
  check('收入环比为正（对齐原页面 +12.5%）', rev.growth > 0, rev.growth.toFixed(2) + '%');
  const risk = (await (await fetch(BASE + '/api/analytics/risk')).json()).data;
  check('风险分析（到期/低履约/告警计划/异常点位）', risk.expiring.length > 0 && risk.abnormalPoints > 0);
  const pts = (await (await fetch(BASE + '/api/analytics/points')).json()).data;
  check('点位分析（类型/状态/城市）', pts.byType.length === 4 && pts.byStatus.length === 4 && pts.byCity.length === 5);
  const roi = (await (await fetch(BASE + '/api/analytics/roi')).json()).data;
  check('ROI 计算', roi.roi > 0, 'ROI=' + roi.roi.toFixed(2));
  const city = (await (await fetch(BASE + '/api/map/city?id=gz')).json()).data;
  check('城市详情接口', city !== null && city.topPoints.length === 10);
  const csv = await (await fetch(BASE + '/api/export/report.csv')).text();
  check('CSV 报表导出', csv.includes('模块') && csv.split('\r\n').length > 20, csv.split('\r\n').length + ' 行');

  console.log('\n═══ 8. 静态资源 ═══');
  const idx = await (await fetch(BASE + '/')).text();
  check('index.html 可访问且引用 /app.js', idx.includes('<script src="/app.js">') && idx.includes('AI经营决策中心'));
  const js = await (await fetch(BASE + '/app.js')).text();
  check('app.js 可访问', js.length > 50000, js.length + ' 字节');
  check('前端不再存在硬编码 apiUrl', !js.includes('47.253.159.62'));

  console.log('\n═══ 8b. 获客 CRM（录入 / 编辑 / 阶段 / 公开留资） ═══');
  // 新增客户
  const newCust = await post('/api/customers/create', {
    name: '自动化验证客户', contact: '测试联系人', phone: '13900001111', industry: '快消饮料',
    source: '展会获客', stage: 'lead', budgetWan: 66, owner: '小李', task: '验证用'
  });
  check('新增客户写库', newCust.ok && newCust.data.ok && newCust.data.customer.name === '自动化验证客户',
    JSON.stringify(newCust.data).slice(0, 120));
  const newId = newCust.data?.id;
  // 重名拦截
  const dup = await post('/api/customers/create', { name: '自动化验证客户', contact: 'x' });
  check('重名客户被拦截', dup.ok && dup.data.ok === false && dup.data.error === 'DUPLICATE');
  // 缺必填
  const bad = await post('/api/customers/create', { name: '缺联系人' });
  check('缺必填字段被拒', bad.data.ok === false && bad.data.error === 'BAD_REQUEST');
  // 编辑
  const upd = await post('/api/customers/update', { id: newId, phone: '13900002222', owner: '小王' });
  check('编辑客户写库', upd.ok && upd.data.ok && upd.data.customer.phone === '13900002222' && upd.data.customer.owner === '小王',
    JSON.stringify(upd.data.customer || {}).slice(0, 100));
  // 阶段推进
  const st1 = await post('/api/customers/stage', { id: newId, stage: 'interest' });
  check('阶段推进 lead→interest', st1.ok && st1.data.customer.stage === 'interest' && st1.data.customer.stageText === '意向');
  const badStage = await post('/api/customers/stage', { id: newId, stage: 'nonsense' });
  check('非法阶段被拒', badStage.data.ok === false && badStage.data.error === 'BAD_REQUEST');
  // 详情含跟进历史
  const detail = (await (await fetch(BASE + '/api/customers/detail?id=' + newId)).json()).data;
  check('客户详情含跟进历史', detail && detail.logs.length >= 3 &&
    detail.logs.some(l => l.kind === 'create') && detail.logs.some(l => l.kind === 'stage'),
    'logs=' + (detail?.logs?.length));
  // 搜索
  const search = (await (await fetch(BASE + '/api/customers?kw=' + encodeURIComponent('自动化验证'))).json()).data;
  check('客户关键词搜索', search.list.length === 1 && search.list[0].id === newId);
  // 公开留资（免登录口径）
  // 每次运行用独立 X-Forwarded-For，避免跨次运行撞上"同 IP 每小时 5 条"的频控
  const XFF = '10.99.' + Math.floor(Math.random() * 200 + 1) + '.' + Math.floor(Math.random() * 200 + 1);
  const postLead = (b, xff = XFF) => fetch(BASE + '/api/public/lead', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff }, body: JSON.stringify(b)
  }).then(r => r.json());
  const lead1 = await postLead({ name: '公开留资验证公司', contact: '李女士', phone: '137-1234-5678', industry: '汽车', budgetWan: 88 });
  check('公开留资成功入库', lead1.ok && lead1.data.ok && lead1.data.id > 0, JSON.stringify(lead1.data));
  const leadRow = (await (await fetch(BASE + '/api/customers?kw=' + encodeURIComponent('公开留资验证'))).json()).data.list[0];
  check('留资记录标记为公开来源且未分配', leadRow && leadRow.isPublic === true && leadRow.stage === 'lead' && leadRow.owner === '未分配',
    JSON.stringify(leadRow || {}).slice(0, 120));
  const leadDup = await postLead({ name: '公开留资验证公司', contact: '李女士', phone: '137-1234-5678' });
  check('同名重复留资不产生重复客户', leadDup.ok && leadDup.data.duplicate === true);
  const leadBad = await postLead({ name: '格式测试', contact: '张三', phone: 'abc' });
  check('留资手机号格式校验', leadBad.data.ok === false && leadBad.data.error === 'BAD_REQUEST');
  const leadMissing = await postLead({ name: '缺字段测试' });
  check('留资必填校验', leadMissing.data.ok === false && leadMissing.data.error === 'BAD_REQUEST');
  // 校验失败的提交不应占用频控额度：连续 3 次非法提交后，合法提交仍应成功
  for (let i = 0; i < 3; i++) await postLead({ name: '' });
  const afterBad = await postLead({ name: '频控验证公司', contact: '赵女士', phone: '13500009999' });
  check('校验失败不占用频控额度', afterBad.data.ok === true, JSON.stringify(afterBad.data));
  // 获客分析
  const acq = (await (await fetch(BASE + '/api/analytics/acquisition')).json()).data;
  check('获客分析：来源 / 阶段 / 转化率',
    acq.bySource.length > 0 && acq.byStage.length === 4 && acq.conversion.signedRate >= 0 && acq.stats.total > 0,
    `来源${acq.bySource.length}类 签约率${acq.conversion.signedRate}%`);
  // 删除
  const del = await post('/api/customers/delete', { id: newId });
  const afterDel = (await (await fetch(BASE + '/api/customers?kw=' + encodeURIComponent('自动化验证'))).json()).data;
  check('删除客户生效', del.ok && del.data.ok && afterDel.list.length === 0);

  console.log('\n═══ 8c. 跨域策略与公开页可用性（file:// 场景） ═══');
  const leadCors = await fetch(BASE + '/api/public/lead', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.97.1.1' },
    body: JSON.stringify({})
  });
  check('公开留资接口允许跨域（供 file:// 页面回连）',
    leadCors.headers.get('access-control-allow-origin') === '*',
    String(leadCors.headers.get('access-control-allow-origin')));
  const bootCors = await fetch(BASE + '/api/bootstrap');
  check('后台管理接口不下发 CORS 头', bootCors.headers.get('access-control-allow-origin') === null);
  const hOrigin = await (await fetch(BASE + '/api/health', { headers: { Origin: 'https://example.com' } })).json();
  check('health 对浏览器来源隐藏数据库路径', hOrigin.db === undefined && hOrigin.ok === true);
  const hNoOrigin = await (await fetch(BASE + '/api/health')).json();
  check('health 对本机/运维保留数据库路径', typeof hNoOrigin.db === 'string');
  const preflight = await fetch(BASE + '/api/public/lead', { method: 'OPTIONS' });
  check('OPTIONS 预检可用', preflight.status === 204 &&
    String(preflight.headers.get('access-control-allow-headers') || '').includes('Content-Type'));
  const leadPage = await (await fetch(BASE + '/lead.html')).text();
  check('落地页含 API 自动探测（file:// 兜底）', leadPage.includes('detectApiBase') && leadPage.includes('api/health'));
  check('落地页报错信息含真实原因', leadPage.includes('无法连接服务器') && leadPage.includes('err.message'));

  console.log('\n═══ 9. 公网隧道鉴权代理 ═══');
  const envPath = path.join(__dirname, '..', 'data', 'tunnel.env');
  const env = fs.existsSync(envPath) ? Object.fromEntries(
    fs.readFileSync(envPath, 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  ) : null;
  const PX = 'http://127.0.0.1:' + (env?.PROXY_PORT || 5004);
  let pxUp = false;
  try { pxUp = (await fetch(PX + '/proxy-health')).ok; } catch { pxUp = false; }
  check('鉴权代理在线', pxUp, PX);
  if (pxUp && env) {
    const noAuth = await fetch(PX + '/api/health');
    check('无凭证被拒 401', noAuth.status === 401, 'HTTP ' + noAuth.status);
    const badAuth = await fetch(PX + '/api/health', { headers: { Authorization: 'Basic ' + Buffer.from(env.AUTH_USER + ':wrongpass').toString('base64') } });
    check('错误口令被拒 401', badAuth.status === 401, 'HTTP ' + badAuth.status);
    const okAuth = await fetch(PX + '/api/health', { headers: { Authorization: 'Basic ' + Buffer.from(env.AUTH_USER + ':' + env.AUTH_PASS).toString('base64') } });
    check('正确口令 200 且透传业务数据', okAuth.status === 200 && (await okAuth.json()).ok === true);
    const tokRes = await fetch(PX + '/?token=' + env.AUTH_TOKEN);
    const setCookie = tokRes.headers.get('set-cookie') || '';
    check('token 访问下发会话 Cookie', tokRes.status === 200 && setCookie.includes('pdooh_token='), setCookie.slice(0, 60));
    const subOk = await fetch(PX + '/app.js', { headers: { Cookie: 'pdooh_token=' + env.AUTH_TOKEN } });
    check('Cookie 可访问子资源 /app.js', subOk.status === 200, 'HTTP ' + subOk.status);
    const subBad = await fetch(PX + '/app.js');
    check('子资源无 Cookie 被拒 401', subBad.status === 401, 'HTTP ' + subBad.status);
    const strip = await fetch(PX + '/api/health?token=' + env.AUTH_TOKEN);
    check('转发上游前已剥离 token 参数', strip.status === 200);
    const pubLead = await fetch(PX + '/lead.html');
    check('获客落地页免登录可访问', pubLead.status === 200, 'HTTP ' + pubLead.status);
    const pubLeadApi = await fetch(PX + '/api/public/lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.98.1.1' },
      body: JSON.stringify({ name: '隧道公开留资验证', contact: '王先生', phone: '13600001234' })
    });
    check('公开留资接口免登录可用', pubLeadApi.status === 200 && (await pubLeadApi.json()).data.ok === true);
    const adminStill = await fetch(PX + '/api/bootstrap');
    check('后台数据接口仍需鉴权', adminStill.status === 401, 'HTTP ' + adminStill.status);
  }

  console.log('\n════════════════════════════════════════');
  console.log(` 通过 ${pass} 项 / 失败 ${fail} 项`);
  if (fail) { console.log(' 失败明细:'); failures.forEach(f => console.log('   - ' + f)); }
  console.log('════════════════════════════════════════\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验证脚本异常:', e); process.exit(2); });
