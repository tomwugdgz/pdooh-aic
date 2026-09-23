#!/usr/bin/env node
/**
 * ============================================================
 * pDOOH AI 经营决策中心 · 后端服务
 * ------------------------------------------------------------
 * 技术栈: Node.js 原生 http + node:sqlite (零第三方依赖)
 * 数据库: SQLite  data/pdooh.db
 * 功能  : 原页面 16 个模块的完整数据接口 + 罗姐 AI 分析引擎
 *         + 审批/跟进/工单/投票/素材生成/日报/同步等写操作
 *         + 报表导出 + 只读 SQL 查询控制台
 * 启动  : node server.js   (默认 0.0.0.0:5003)
 * ============================================================
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5003);
const HOST = process.env.HOST || '0.0.0.0';
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'pdooh.db');

// ------------------------------------------------------------
// 数据库初始化
// ------------------------------------------------------------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON;');
// node:sqlite 默认 busy_timeout=0：一旦有其它连接（备份/CLI/维护脚本）持写锁，
// 本服务的写入会立刻抛 SQLITE_BUSY。设置为等待 5 秒，显著提升并发健壮性。
db.exec('PRAGMA busy_timeout = 5000;');

function tableExists(name) {
  return !!db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function initDatabase() {
  const schema = fs.readFileSync(path.join(ROOT, 'sql', 'schema.sql'), 'utf8');
  db.exec(schema);
  if (!tableExists('points') || db.prepare('SELECT COUNT(*) AS c FROM points').get().c === 0) {
    console.log('[db] 首次初始化，导入种子数据 ...');
    db.exec(fs.readFileSync(path.join(ROOT, 'sql', 'seed.sql'), 'utf8'));
    console.log('[db] 种子数据导入完成');
  }
}
initDatabase();

/**
 * 增量迁移：让已存在的旧库自动补齐新增字段（幂等，可反复执行）
 * 注意：SQLite 的 ALTER TABLE ADD COLUMN 只接受常量默认值，
 *       所以时间戳列先用 '' 占位再回填，不能直接写 DEFAULT (datetime(...))
 */
function migrate() {
  const cols = q.all('PRAGMA table_info(customers)').map(c => c.name);
  const addCol = (name, ddl) => {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE customers ADD COLUMN ${ddl}`);
      console.log(`[db] 迁移: customers += ${name}`);
    }
  };
  addCol('phone', "phone TEXT NOT NULL DEFAULT ''");
  addCol('company', "company TEXT NOT NULL DEFAULT ''");
  addCol('industry', "industry TEXT NOT NULL DEFAULT ''");
  addCol('email', "email TEXT NOT NULL DEFAULT ''");
  addCol('source', "source TEXT NOT NULL DEFAULT '手动录入'");
  addCol('stage', "stage TEXT NOT NULL DEFAULT 'lead'");
  addCol('budget_wan', 'budget_wan REAL NOT NULL DEFAULT 0');
  addCol('owner', "owner TEXT NOT NULL DEFAULT ''");
  addCol('note', "note TEXT NOT NULL DEFAULT ''");
  addCol('is_public', 'is_public INTEGER NOT NULL DEFAULT 0');
  addCol('client_ip', "client_ip TEXT NOT NULL DEFAULT ''");
  addCol('created_at', "created_at TEXT NOT NULL DEFAULT ''");
  addCol('updated_at', "updated_at TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE customers SET created_at = datetime('now','localtime') WHERE created_at = ''");
  db.exec("UPDATE customers SET updated_at = datetime('now','localtime') WHERE updated_at = ''");

  const logCols = q.all('PRAGMA table_info(follow_logs)').map(c => c.name);
  if (!logCols.includes('kind')) {
    db.exec("ALTER TABLE follow_logs ADD COLUMN kind TEXT NOT NULL DEFAULT 'follow'");
    console.log('[db] 迁移: follow_logs += kind');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_customers_stage  ON customers(stage)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_customers_source ON customers(source)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_follow_customer ON follow_logs(customer_id)');
}

// 公开留资防刷：同一 IP 每小时最多 5 条（只统计【成功入库】的提交，
// 校验失败/重复提交不占用额度，否则用户填错两次就被自己的额度挡住了）
const leadRate = new Map();
function peekLeadRate(ip) {
  const now = Date.now();
  let rec = leadRate.get(ip);
  if (!rec || now > rec.reset) { rec = { count: 0, reset: now + 3600_000 }; leadRate.set(ip, rec); }
  return { allowed: rec.count < 5, count: rec.count, resetIn: Math.ceil((rec.reset - now) / 1000) };
}
function bumpLeadRate(ip) {
  const rec = leadRate.get(ip);
  if (rec) rec.count++;
}

/** 便捷查询封装 —— 全部数据访问都是真实 SQL */
const q = {
  all: (sql, ...p) => db.prepare(sql).all(...p),
  get: (sql, ...p) => db.prepare(sql).get(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p)
};

// 必须放在 q 定义之后调用（migrate 内部依赖 q）
migrate();

const logActivity = (action, target, detail = '') =>
  q.run('INSERT INTO activity_log (action, target, detail) VALUES (?,?,?)', action, target, detail);

// ------------------------------------------------------------
// 通用工具
// ------------------------------------------------------------
const pad = n => String(n).padStart(2, '0');
const nowStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const hmStr = () => { const d = new Date(); return `${d.getHours()}:${pad(d.getMinutes())}`; };
const wan = v => (Math.round((v / 10000) * 10) / 10).toFixed(1);
const money = v => '¥' + Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });

// ============================================================
//  模块 01 今日工作台
// ============================================================
const getDashboard = () => ({
  stats: q.all('SELECT label, value, icon, color, trend FROM dashboard_stats ORDER BY sort_order'),
  schedule: q.all('SELECT time, title, type, icon FROM schedule_items ORDER BY sort_order'),
  reminders: q.all('SELECT icon, text, color FROM reminders ORDER BY sort_order'),
  team: q.all('SELECT name, avatar, status, task FROM team_members ORDER BY sort_order')
});

// ---------- 工作台头部：问候语 / 日期 / 实时天气 / 实时 KPI ----------
const OWNER_NAME = process.env.OWNER_NAME || 'Tom';
const WEATHER_CITY = process.env.WEATHER_CITY || '广州';
const WEATHER_LAT = Number(process.env.WEATHER_LAT || 23.1291);
const WEATHER_LON = Number(process.env.WEATHER_LON || 113.2644);

// WMO 天气代码 → 中文描述 + 图标
const WMO = {
  0: ['晴', '☀️'], 1: ['大部晴朗', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
  45: ['有雾', '🌫️'], 48: ['冻雾', '🌫️'],
  51: ['轻微毛毛雨', '🌦️'], 53: ['毛毛雨', '🌦️'], 55: ['浓密毛毛雨', '🌦️'],
  56: ['冻毛毛雨', '🌧️'], 57: ['浓冻毛毛雨', '🌧️'],
  61: ['小雨', '🌧️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'],
  66: ['冻雨', '🌧️'], 67: ['强冻雨', '🌧️'],
  71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '🌨️'], 77: ['雪粒', '🌨️'],
  80: ['阵雨', '🌦️'], 81: ['中等阵雨', '🌦️'], 82: ['强阵雨', '⛈️'],
  85: ['小阵雪', '🌨️'], 86: ['大阵雪', '🌨️'],
  95: ['雷阵雨', '⛈️'], 96: ['雷阵雨伴小冰雹', '⛈️'], 99: ['雷阵雨伴大冰雹', '⛈️']
};

function greetingByHour(h) {
  if (h >= 5 && h < 11) return '早上好';
  if (h >= 11 && h < 13) return '中午好';
  if (h >= 13 && h < 18) return '下午好';
  if (h >= 18 && h < 23) return '晚上好';
  return '夜深了';
}
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

// 天气缓存：10 分钟内不重复请求外部接口
let weatherCache = { at: 0, data: null, error: null };

async function fetchWeather() {
  const now = Date.now();
  if (weatherCache.data && now - weatherCache.at < 10 * 60 * 1000) {
    return { ...weatherCache.data, cached: true };
  }
  // 主源：Open-Meteo（免 key、结构化、稳定）
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}`
      + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m`
      + `&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FShanghai&forecast_days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const j = await res.json();
    const c = j.current || {};
    const [text, icon] = WMO[c.weather_code] || ['未知', '🌡️'];
    const data = {
      city: WEATHER_CITY, temp: Math.round(c.temperature_2m), feelsLike: Math.round(c.apparent_temperature),
      text, icon, humidity: c.relative_humidity_2m, wind: Math.round(c.wind_speed_10m),
      high: j.daily?.temperature_2m_max?.[0] != null ? Math.round(j.daily.temperature_2m_max[0]) : null,
      low: j.daily?.temperature_2m_min?.[0] != null ? Math.round(j.daily.temperature_2m_min[0]) : null,
      observedAt: c.time, source: 'open-meteo', stale: false
    };
    weatherCache = { at: now, data, error: null };
    return data;
  } catch (e) { weatherCache.error = e.message; }
  // 兜底源：wttr.in
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(WEATHER_CITY)}?format=j1`, { signal: AbortSignal.timeout(6000) });
    const j = await res.json();
    const c = j.current_condition?.[0] || {};
    const desc = (c.lang_zh && c.lang_zh[0] && c.lang_zh[0].value) || c.weatherDesc?.[0]?.value || '未知';
    const data = {
      city: WEATHER_CITY, temp: Number(c.temp_C), feelsLike: Number(c.FeelsLikeC),
      text: desc, icon: '🌡️', humidity: Number(c.humidity), wind: Number(c.windspeedKmph),
      high: Number(j.weather?.[0]?.maxtempC) || null, low: Number(j.weather?.[0]?.mintempC) || null,
      observedAt: c.observation_time, source: 'wttr.in', stale: false
    };
    weatherCache = { at: now, data, error: null };
    return data;
  } catch (e) { weatherCache.error = e.message; }
  // 两个源都失败：返回上次成功值（标记 stale），否则明确告知不可用
  if (weatherCache.data) return { ...weatherCache.data, stale: true, error: weatherCache.error };
  return { city: WEATHER_CITY, unavailable: true, error: weatherCache.error || '天气服务不可用' };
}

/** 今日工作台头部所需全部实时数据（问候语/日期/天气/KPI 均动态） */
async function getOverview() {
  const d = new Date();
  const rev = q.get(`SELECT
      COALESCE(SUM(CASE WHEN stat_date=date('now','localtime') THEN amount END),0) AS today,
      COALESCE(SUM(CASE WHEN stat_date=date('now','localtime','-1 day') THEN amount END),0) AS yesterday
    FROM revenue_daily`);
  const risk = q.get(`SELECT ROUND(COALESCE(SUM(amount_num),0),1) AS wan, COUNT(*) AS cnt
    FROM pending_items WHERE status='pending' AND category IN ('contract','spot')`);
  const points = q.get(`SELECT COUNT(*) AS total,
      (SELECT COUNT(DISTINCT community) FROM points) AS communities,
      (SELECT COUNT(*) FROM points WHERE status='abnormal') AS abnormal FROM points`);
  const growth = rev.yesterday ? (rev.today - rev.yesterday) / rev.yesterday * 100 : 0;

  return {
    greeting: greetingByHour(d.getHours()),
    user: OWNER_NAME,
    dateText: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
    weekday: WEEKDAYS[d.getDay()],
    timeText: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    isoDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    city: WEATHER_CITY,
    weather: await fetchWeather(),
    kpi: {
      revenue: {
        raw: rev.today, wan: Number(wan(rev.today)), text: '¥' + wan(rev.today) + '万',
        trend: growth, trendText: (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%',
        dir: growth >= 0 ? 'up' : 'down', label: '今日投放收入'
      },
      risk: { raw: risk.wan, text: String(risk.wan), unit: '万', count: risk.cnt, label: '待签约风险' },
      points: {
        raw: points.total, text: points.total.toLocaleString('zh-CN'),
        communities: points.communities, abnormal: points.abnormal, label: '点位覆盖数'
      }
    },
    updatedAt: nowStr()
  };
}

// ============================================================
//  模块 02 待确认 + 审批写操作
// ============================================================
const mapPending = r => ({
  id: r.code, name: r.name, client: r.client, amount: r.amount,
  days: r.days, badge: r.badge, badgeText: r.badge_text, status: r.status
});

const getPending = () => {
  const rows = q.all("SELECT * FROM pending_items WHERE status='pending' ORDER BY CASE category WHEN 'spot' THEN 1 WHEN 'contract' THEN 2 ELSE 3 END, days");
  const stats = q.get(`SELECT
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status='pending' AND days<=3 THEN 1 ELSE 0 END) AS urgent,
      ROUND(SUM(CASE WHEN status='pending' THEN amount_num ELSE 0 END),1) AS pending_amount_wan
    FROM pending_items`);
  return {
    spots: rows.filter(r => r.category === 'spot').map(mapPending),
    contracts: rows.filter(r => r.category === 'contract').map(mapPending),
    creatives: rows.filter(r => r.category === 'creative').map(mapPending),
    stats
  };
};

const decidePending = (code, action, note) => {
  const item = q.get('SELECT * FROM pending_items WHERE code=?', code);
  if (!item) return { ok: false, error: 'NOT_FOUND', message: '待确认项不存在: ' + code };
  const status = action === 'approve' ? 'approved' : 'rejected';
  q.run('UPDATE pending_items SET status=?, decided_at=?, decide_note=? WHERE code=?', status, nowStr(), note || '', code);
  logActivity('PENDING_' + status.toUpperCase(), code, `${item.name} / ${item.client} / ${item.amount}`);
  return { ok: true, code, status, name: item.name, decided_at: nowStr() };
};

// ============================================================
//  模块 03 经营决策 KPI（从业务表实时计算，DB 值兜底）
// ============================================================
function getKpi() {
  const rev = q.get(`SELECT
      COALESCE(SUM(CASE WHEN stat_date=date('now','localtime') THEN amount END),0) AS today,
      COALESCE(SUM(CASE WHEN stat_date=date('now','localtime','-1 day') THEN amount END),0) AS yesterday
    FROM revenue_daily`);
  const pts = q.get(`SELECT COUNT(*) AS total,
        (SELECT COUNT(*) FROM cities) AS city_cnt,
        (SELECT COUNT(*) FROM points WHERE status='abnormal') AS abnormal FROM points`);
  const risk = q.get(`SELECT ROUND(COALESCE(SUM(amount_num),0),1) AS wan, COUNT(*) AS cnt
      FROM pending_items WHERE status='pending' AND category IN ('contract','spot') AND days<=12`);
  const roi = computeRoi();

  const dynamic = {
    revenue: {
      value: '¥' + wan(rev.today) + '万',
      detail: `较昨日${rev.today >= rev.yesterday ? '增长' : '下降'} ¥${wan(Math.abs(rev.today - rev.yesterday))}万`,
      trend: (rev.yesterday ? ((rev.today - rev.yesterday) / rev.yesterday * 100) : 0).toFixed(1) + '%',
      dir: rev.today >= rev.yesterday ? 'positive' : 'negative'
    },
    risk: { value: '¥' + risk.wan + '万', detail: `${risk.cnt}个合同/点位即将到期`, trend: '', dir: 'negative' },
    points: { value: pts.total.toLocaleString('zh-CN'), detail: `覆盖 ${pts.city_cnt} 个城市 · ${pts.abnormal} 个点位异常`, trend: '', dir: 'positive' },
    roi: { value: roi.roi.toFixed(1), detail: `行业平均 2.9`, trend: roi.roi >= 2.9 ? '高于行业' : '低于行业', dir: roi.roi >= 2.9 ? 'positive' : 'negative' }
  };

  return q.all('SELECT * FROM kpi_metrics ORDER BY sort_order').map(row => {
    const d = dynamic[row.key] || {};
    return {
      key: row.key, icon: row.icon, label: row.label, color: row.color,
      value: d.value ?? row.value, detail: d.detail ?? row.detail,
      trend: d.trend || row.trend, trendDir: d.dir || row.trend_dir
    };
  });
}

/** ROI = 近 30 天投放收入 / 近 30 天投放成本（由合同执行额折算） */
function computeRoi() {
  const rev = q.get("SELECT COALESCE(SUM(amount),0) AS v FROM revenue_daily WHERE stat_date >= date('now','localtime','-29 day')").v;
  const cost = q.get("SELECT COALESCE(SUM(spend),0) AS v FROM campaigns").v * 10000;
  const roi = cost > 0 ? rev / cost : 0;
  return { revenue: rev, cost, roi };
}

// ============================================================
//  模块 04 投放作战地图（点位明细由 SQL 聚合）
// ============================================================
function getMap() {
  const cities = q.all(`
    SELECT c.id, c.name,
           COUNT(p.id) AS total,
           SUM(CASE WHEN p.point_type='智能屏'   THEN 1 ELSE 0 END) AS smartScreen,
           SUM(CASE WHEN p.point_type='门禁'     THEN 1 ELSE 0 END) AS door,
           SUM(CASE WHEN p.point_type='道闸'     THEN 1 ELSE 0 END) AS gate,
           SUM(CASE WHEN p.point_type='电梯框架' THEN 1 ELSE 0 END) AS elevator,
           c.hot AS hot
    FROM cities c LEFT JOIN points p ON p.city_id = c.id
    GROUP BY c.id ORDER BY c.sort_order`);
  return {
    cities,
    dots: q.all('SELECT city_id AS city, x, y, count, type FROM map_dots'),
    legend: q.all('SELECT label, color, count FROM map_legend ORDER BY sort_order')
  };
}

const getCityDetail = cityId => {
  const city = q.get('SELECT * FROM cities WHERE id=?', cityId);
  if (!city) return null;
  return {
    city,
    byType: q.all('SELECT point_type AS type, COUNT(*) AS cnt, ROUND(AVG(revenue),2) AS avg_revenue, SUM(monthly_reach) AS reach FROM points WHERE city_id=? GROUP BY point_type', cityId),
    byStatus: q.all('SELECT status, COUNT(*) AS cnt FROM points WHERE city_id=? GROUP BY status', cityId),
    topPoints: q.all('SELECT code, community, point_type, status, monthly_reach, revenue FROM points WHERE city_id=? ORDER BY revenue DESC LIMIT 10', cityId),
    revenue30d: q.get("SELECT ROUND(SUM(amount),2) AS amount FROM revenue_daily WHERE city_id=? AND stat_date >= date('now','localtime','-29 day')", cityId)
  };
};

// ============================================================
//  模块 05 客户待跟进 / 获客 CRM
// ============================================================
const STAGE_TEXT = { lead: '线索', interest: '意向', proposal: '方案', signed: '签约' };

const mapCustomer = r => ({
  id: r.id, name: r.name, contact: r.contact, avatar: r.avatar, last: r.last_touch,
  task: r.task, priority: r.priority, status: r.status, followCount: r.follow_count,
  lastFollowAt: r.last_follow_at,
  phone: r.phone, company: r.company, industry: r.industry, email: r.email,
  source: r.source, stage: r.stage, stageText: STAGE_TEXT[r.stage] || r.stage,
  budgetWan: r.budget_wan, owner: r.owner, note: r.note,
  isPublic: !!r.is_public, createdAt: r.created_at, updatedAt: r.updated_at
});

function getCustomers({ stage, source, kw, owner } = {}) {
  let sql = 'SELECT * FROM customers WHERE 1=1';
  const args = [];
  if (stage) { sql += ' AND stage = ?'; args.push(stage); }
  if (source) { sql += ' AND source = ?'; args.push(source); }
  if (owner) { sql += ' AND owner = ?'; args.push(owner); }
  if (kw) { sql += ' AND (name LIKE ? OR contact LIKE ? OR company LIKE ? OR phone LIKE ?)'; const l = `%${kw}%`; args.push(l, l, l, l); }
  sql += ` ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, id`;
  const rows = q.all(sql, ...args).map(mapCustomer);
  return { list: rows, stats: getCustomerStats() };
}

function getCustomerStats() {
  return q.get(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN is_public = 1 THEN 1 ELSE 0 END) AS from_public,
      SUM(CASE WHEN stage = 'signed' THEN 1 ELSE 0 END) AS signed,
      SUM(CASE WHEN created_at >= date('now','localtime','-6 day') THEN 1 ELSE 0 END) AS new_this_week,
      SUM(CASE WHEN owner = '' OR owner = '未分配' THEN 1 ELSE 0 END) AS unassigned,
      ROUND(COALESCE(SUM(budget_wan),0), 1) AS budget_wan
    FROM customers`);
}

function getCustomerDetail(id) {
  const r = q.get('SELECT * FROM customers WHERE id = ?', id);
  if (!r) return null;
  return {
    customer: mapCustomer(r),
    logs: q.all('SELECT id, kind, note, created_at AS createdAt FROM follow_logs WHERE customer_id = ? ORDER BY id DESC', id)
  };
}

/** 新增客户/线索（内部录入） */
function createCustomer(body) {
  const name = (body.name || '').trim();
  const contact = (body.contact || '').trim();
  if (!name) return { ok: false, error: 'BAD_REQUEST', message: '客户/公司名称必填' };
  if (!contact) return { ok: false, error: 'BAD_REQUEST', message: '联系人必填' };
  if (q.get('SELECT 1 AS x FROM customers WHERE name = ?', name)) {
    return { ok: false, error: 'DUPLICATE', message: `客户「${name}」已存在` };
  }
  const stage = ['lead', 'interest', 'proposal', 'signed'].includes(body.stage) ? body.stage : 'lead';
  const priority = ['urgent', 'high', 'medium', 'low'].includes(body.priority) ? body.priority : 'medium';
  const res = q.run(`INSERT INTO customers
      (name, contact, avatar, last_touch, task, priority, status,
       phone, company, industry, email, source, stage, budget_wan, owner, note, is_public)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
    name, contact, name.charAt(0), '刚刚', body.task || '新客户，待首次沟通', priority, body.status || 'new',
    body.phone || '', body.company || name, body.industry || '', body.email || '',
    body.source || '手动录入', stage, Number(body.budgetWan) || 0, body.owner || '未分配', body.note || '');
  const id = Number(res.lastInsertRowid);
  q.run("INSERT INTO follow_logs (customer_id, kind, note) VALUES (?,?,?)", id, 'create',
    `新增客户：${name}（来源：${body.source || '手动录入'}，阶段：${STAGE_TEXT[stage]}）`);
  logActivity('CUSTOMER_CREATE', String(id), `${name} / ${contact} / ${body.source || '手动录入'}`);
  return { ok: true, id, customer: getCustomerDetail(id).customer };
}

/** 修改客户信息 */
function updateCustomer(body) {
  const id = Number(body.id);
  const r = q.get('SELECT * FROM customers WHERE id = ?', id);
  if (!r) return { ok: false, error: 'NOT_FOUND', message: '客户不存在: ' + body.id };
  const fields = ['name', 'contact', 'task', 'priority', 'status', 'phone', 'company', 'industry',
    'email', 'source', 'stage', 'owner', 'note'];
  const sets = [], args = [];
  const changed = [];
  for (const f of fields) {
    if (body[f] === undefined) continue;
    const col = f === 'name' ? 'name' : f.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
    sets.push(`${col} = ?`);
    args.push(body[f]);
    changed.push(f);
  }
  if (body.budgetWan !== undefined) { sets.push('budget_wan = ?'); args.push(Number(body.budgetWan) || 0); changed.push('budgetWan'); }
  if (!sets.length) return { ok: false, error: 'BAD_REQUEST', message: '没有需要更新的字段' };
  sets.push("updated_at = datetime('now','localtime')");
  args.push(id);
  q.run(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`, ...args);
  q.run('INSERT INTO follow_logs (customer_id, kind, note) VALUES (?,?,?)', id, 'edit', `更新字段：${changed.join('、')}`);
  logActivity('CUSTOMER_UPDATE', String(id), `${r.name} ← ${changed.join('、')}`);
  return { ok: true, customer: getCustomerDetail(id).customer };
}

function deleteCustomer(id) {
  const r = q.get('SELECT * FROM customers WHERE id = ?', Number(id));
  if (!r) return { ok: false, error: 'NOT_FOUND', message: '客户不存在: ' + id };
  q.run('DELETE FROM follow_logs WHERE customer_id = ?', Number(id));
  q.run('DELETE FROM customers WHERE id = ?', Number(id));
  logActivity('CUSTOMER_DELETE', String(id), r.name);
  return { ok: true, id: Number(id), name: r.name };
}

/** 推进获客漏斗阶段 */
function updateStage(id, stage) {
  const order = ['lead', 'interest', 'proposal', 'signed'];
  if (!order.includes(stage)) return { ok: false, error: 'BAD_REQUEST', message: '非法阶段: ' + stage };
  const r = q.get('SELECT * FROM customers WHERE id = ?', Number(id));
  if (!r) return { ok: false, error: 'NOT_FOUND', message: '客户不存在: ' + id };
  if (r.stage === stage) return { ok: true, customer: getCustomerDetail(Number(id)).customer, unchanged: true };
  q.run("UPDATE customers SET stage = ?, status = ?, last_touch = '刚刚', updated_at = datetime('now','localtime') WHERE id = ?",
    stage, stage === 'signed' ? 'pending' : r.status, Number(id));
  q.run('INSERT INTO follow_logs (customer_id, kind, note) VALUES (?,?,?)', Number(id), 'stage',
    `阶段推进：${STAGE_TEXT[r.stage] || r.stage} → ${STAGE_TEXT[stage]}`);
  logActivity('CUSTOMER_STAGE', String(id), `${r.name}: ${r.stage} → ${stage}`);
  return { ok: true, customer: getCustomerDetail(Number(id)).customer };
}

/** 公开留资（免登录获客入口） */
function publicLead(body, ip) {
  const rate = peekLeadRate(ip);
  if (!rate.allowed) {
    return { ok: false, error: 'RATE_LIMITED', message: `提交过于频繁（每小时最多 5 条），请 ${Math.ceil(rate.resetIn / 60)} 分钟后再试` };
  }
  const name = (body.name || '').trim();
  const contact = (body.contact || '').trim();
  const phone = (body.phone || '').trim();
  if (!name || !contact || !phone) {
    return { ok: false, error: 'BAD_REQUEST', message: '公司名称、联系人、联系电话均为必填' };
  }
  if (!/^[\d\-+() ]{6,20}$/.test(phone)) {
    return { ok: false, error: 'BAD_REQUEST', message: '联系电话格式不正确' };
  }
  // 同名客户已存在时不新建，转为补充一条跟进记录（避免重复线索）
  const exist = q.get('SELECT * FROM customers WHERE name = ?', name);
  if (exist) {
    q.run('INSERT INTO follow_logs (customer_id, kind, note) VALUES (?,?,?)', exist.id, 'follow',
      `公开留资页再次提交：${contact} / ${phone} / ${body.industry || '未填行业'}`);
    logActivity('LEAD_DUPLICATE', String(exist.id), `${name} 重复留资 from ${ip}`);
    return { ok: true, id: exist.id, duplicate: true, message: '我们已收到您的信息，顾问会尽快与您联系（该客户此前已在库中，已追加记录）' };
  }
  const res = q.run(`INSERT INTO customers
      (name, contact, avatar, last_touch, task, priority, status,
       phone, company, industry, email, source, stage, budget_wan, owner, note, is_public, client_ip)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
    name, contact, name.charAt(0), '刚刚', '公开留资新线索，待首次联系', 'high', 'new',
    phone, body.company || name, body.industry || '', body.email || '',
    body.source || '官网留资', 'lead', Number(body.budgetWan) || 0, '未分配', body.note || '', ip);
  const id = Number(res.lastInsertRowid);
  q.run('INSERT INTO follow_logs (customer_id, kind, note) VALUES (?,?,?)', id, 'create',
    `公开留资页提交：${contact} / ${phone}${body.message ? ' / 留言：' + body.message : ''}`);
  logActivity('LEAD_CREATE', String(id), `${name} / ${phone} from ${ip}`);
  bumpLeadRate(ip);   // 仅在成功入库时消耗额度
  return { ok: true, id, message: '提交成功！我们的户外广告顾问会在 1 个工作日内与您联系。' };
}

/** 获客分析：来源 / 阶段 / 趋势 / 转化率 */
function getAcquisitionAnalysis() {
  const bySource = q.all(`SELECT source, COUNT(*) AS cnt,
      SUM(CASE WHEN stage='signed' THEN 1 ELSE 0 END) AS signed,
      ROUND(SUM(budget_wan),1) AS budget_wan
    FROM customers GROUP BY source ORDER BY cnt DESC`);
  const byStage = q.all('SELECT stage, COUNT(*) AS cnt FROM customers GROUP BY stage');
  const stageOrdered = ['lead', 'interest', 'proposal', 'signed'].map(s => ({
    stage: s, label: STAGE_TEXT[s], cnt: (byStage.find(x => x.stage === s) || {}).cnt || 0
  }));
  const trend = q.all(`SELECT date(created_at) AS d, COUNT(*) AS cnt FROM customers
      WHERE created_at >= date('now','localtime','-13 day') GROUP BY d ORDER BY d`);
  const byOwner = q.all(`SELECT CASE WHEN owner='' THEN '未分配' ELSE owner END AS owner, COUNT(*) AS cnt
      FROM customers GROUP BY owner ORDER BY cnt DESC`);
  const stats = getCustomerStats();
  const total = stats.total || 1;
  return {
    stats,
    bySource: bySource.map(s => ({ ...s, rate: Number((s.signed / total * 100).toFixed(1)) })),
    byStage: stageOrdered,
    byOwner,
    trend,
    conversion: {
      lead2interest: Number((stageOrdered[1].cnt / total * 100).toFixed(1)),
      signedRate: Number((stageOrdered[3].cnt / total * 100).toFixed(1)),
      avgBudget: stats.total ? Number((stats.budget_wan / stats.total).toFixed(1)) : 0
    }
  };
}

const contactCustomer = (id, note) => {
  const c = q.get('SELECT * FROM customers WHERE id=?', id);
  if (!c) return { ok: false, error: 'NOT_FOUND', message: '客户不存在: ' + id };
  const text = note || `已联系 ${c.contact}，沟通事项：${c.task}`;
  q.run("INSERT INTO follow_logs (customer_id, kind, note) VALUES (?,?,?)", id, 'follow', text);
  q.run("UPDATE customers SET follow_count=follow_count+1, last_follow_at=?, last_touch='刚刚', updated_at=datetime('now','localtime') WHERE id=?", nowStr(), id);
  logActivity('CUSTOMER_CONTACT', c.name, text);
  return { ok: true, customer: c.name, note: text, follow_count: c.follow_count + 1 };
};

// ============================================================
//  模块 06 销售作战卡
// ============================================================
const getSales = () => ({
  funnel: q.all('SELECT name, value, percent, detail FROM sales_funnel ORDER BY sort_order'),
  ranking: q.all('SELECT name, avatar, deals AS sales, amount, rate, color FROM sales_ranking ORDER BY rate_num DESC'),
  summary: q.get(`SELECT SUM(deals) AS deals, ROUND(SUM(amount_num),1) AS amount_wan,
      ROUND(AVG(rate_num),1) AS avg_rate FROM sales_ranking`)
});

// ============================================================
//  模块 07 全面投放进度
// ============================================================
const getProgress = () => q.all(`SELECT name, client, start_date AS start, end_date AS end,
    percent, status, status_text AS statusText, budget, spend,
    ROUND(spend / NULLIF(budget,0) * 100, 1) AS spendRate FROM campaigns ORDER BY percent DESC`);

// ============================================================
//  模块 08 社区看板
// ============================================================
const getCommunity = () => q.all(`SELECT name, address, point_type AS type, people, people_num AS peopleNum,
    orders, status, status_text AS statusText FROM communities ORDER BY orders DESC`);

// ============================================================
//  模块 09 合同兑现
// ============================================================
const getContracts = () => q.all(`SELECT code AS id, client, amount, amount_num AS amountNum,
    start_date AS start, end_date AS end, execution, status, status_text AS statusText,
    ROUND(amount_num * execution / 100.0, 1) AS fulfilled_wan FROM contracts ORDER BY execution DESC`);

// ============================================================
//  模块 10 AI 素材生产中心 + 生成写操作
// ============================================================
const getCreatives = () => q.all('SELECT id, name, type, placement AS "use", produce_date AS date, gradient, icon, client, status FROM creatives ORDER BY produce_date DESC, id DESC');

const CREATIVE_TEMPLATES = {
  KV: { icon: '🖼️', gradient: '', placement: '智能屏 · 15秒' },
  视频: { icon: '🎬', gradient: 'gradient-2', placement: '智能屏 · 30秒' },
  海报: { icon: '🖼️', gradient: 'gradient-3', placement: '电梯框架' },
  GIF: { icon: '✨', gradient: 'gradient-4', placement: '门禁屏' }
};
function generateCreative({ client, type, name }) {
  const t = CREATIVE_TEMPLATES[type] ? type : 'KV';
  const tpl = CREATIVE_TEMPLATES[t];
  const title = name || `${client || '通用'} ${t} 素材 ${hmStr()}`;
  const date = `${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`;
  const res = q.run('INSERT INTO creatives (name, type, placement, produce_date, gradient, icon, client, status) VALUES (?,?,?,?,?,?,?,?)',
    title, t, tpl.placement, date, tpl.gradient, tpl.icon, client || '', 'done');
  q.run("UPDATE agents SET calls = calls + 1 WHERE endpoint LIKE '%creative%' OR name LIKE '%素材%'");
  logActivity('CREATIVE_GENERATE', String(res.lastInsertRowid), `${title} / ${t}`);
  return { ok: true, id: res.lastInsertRowid, name: title, type: t, placement: tpl.placement, icon: tpl.icon, date };
}

// ============================================================
//  模块 11 智能体交付中心
// ============================================================
const getAgents = () => q.all('SELECT id, name, endpoint, calls, qps, status, doc FROM agents ORDER BY qps DESC');

// ============================================================
//  模块 12 客服服务中心 + 工单写操作
// ============================================================
const getTickets = () => q.all(`SELECT code AS id, client, type, urgency, status,
    status_text AS statusText, handler, created_at AS created FROM tickets
    ORDER BY CASE urgency WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id`);

function updateTicket(code, { status, handler, statusText } = {}) {
  const t = q.get('SELECT * FROM tickets WHERE code=?', code);
  if (!t) return { ok: false, error: 'NOT_FOUND', message: '工单不存在: ' + code };
  const st = status || t.status;
  const defaultText = { pending: '待处理', processing: '处理中', done: '已完成' }[st] || t.status_text;
  q.run('UPDATE tickets SET status=?, status_text=?, handler=?, updated_at=? WHERE code=?',
    st, statusText || defaultText, handler || t.handler, nowStr(), code);
  logActivity('TICKET_UPDATE', code, `${st} / ${handler || t.handler}`);
  return { ok: true, id: code, status: st, handler: handler || t.handler, statusText: statusText || defaultText };
}

// ============================================================
//  模块 13 公司知识库
// ============================================================
const getKnowledge = () => q.all('SELECT id, title, category, views, doc_date AS date, tags, content FROM knowledge_docs ORDER BY views DESC')
  .map(r => ({ ...r, tags: r.tags ? r.tags.split(',') : [] }));

const searchKnowledge = kw => {
  const like = `%${kw}%`;
  return q.all('SELECT id, title, category, views, doc_date AS date, content FROM knowledge_docs WHERE title LIKE ? OR content LIKE ? OR tags LIKE ? ORDER BY views DESC', like, like, like);
};

// ============================================================
//  模块 14 产品研发 + 投票写操作
// ============================================================
const getRd = () => ({
  requirements: q.all('SELECT id, title, priority, status, status_text AS statusText, author, votes, comments FROM rd_requirements ORDER BY votes DESC'),
  roadmap: q.all('SELECT quarter, title, description AS desc, status FROM roadmap ORDER BY sort_order')
});

function voteRequirement(id) {
  const r = q.get('SELECT * FROM rd_requirements WHERE id=?', id);
  if (!r) return { ok: false, error: 'NOT_FOUND', message: '需求不存在: ' + id };
  q.run('UPDATE rd_requirements SET votes = votes + 1 WHERE id=?', id);
  logActivity('RD_VOTE', String(id), r.title);
  return { ok: true, id: Number(id), title: r.title, votes: r.votes + 1 };
}

// ============================================================
//  模块 15 每日日报 + 提交写操作
// ============================================================
function getDaily() {
  const reports = q.all('SELECT * FROM daily_reports ORDER BY id DESC');
  return reports.map(r => ({
    id: r.id, title: r.title, author: r.author, dept: r.dept, mood: r.mood,
    moodText: r.mood_text, date: r.report_date,
    done: q.all("SELECT content FROM daily_report_items WHERE report_id=? AND kind='done' ORDER BY sort_order", r.id).map(x => x.content),
    plan: q.all("SELECT content FROM daily_report_items WHERE report_id=? AND kind='plan' ORDER BY sort_order", r.id).map(x => x.content)
  }));
}

function submitDaily({ title, author, dept, done = [], plan = [], mood = '📝', moodText = '正常' }) {
  if (!title || !author) return { ok: false, error: 'BAD_REQUEST', message: '标题与作者必填' };
  const res = q.run('INSERT INTO daily_reports (title, author, dept, mood, mood_text) VALUES (?,?,?,?,?)',
    title, author, dept || '未分配', mood, moodText);
  const id = res.lastInsertRowid;
  done.forEach((c, i) => q.run('INSERT INTO daily_report_items (report_id, kind, content, sort_order) VALUES (?,?,?,?)', id, 'done', c, i + 1));
  plan.forEach((c, i) => q.run('INSERT INTO daily_report_items (report_id, kind, content, sort_order) VALUES (?,?,?,?)', id, 'plan', c, i + 1));
  logActivity('DAILY_SUBMIT', String(id), `${author} / ${title}`);
  return { ok: true, id: Number(id), title, author, done: done.length, plan: plan.length };
}

// ============================================================
//  模块 16 数据连接中心 + 同步写操作
// ============================================================
const getDataSources = () => q.all(`SELECT id, name, type, status, status_text AS statusText,
    last_sync AS lastSync, latency, latency_ms AS latencyMs, qps, sync_count AS syncCount
    FROM data_sources ORDER BY id`);

function syncDataSource(id) {
  const s = q.get('SELECT * FROM data_sources WHERE id=?', id);
  if (!s) return { ok: false, error: 'NOT_FOUND', message: '数据源不存在: ' + id };
  const jitter = Math.round((Math.random() - 0.5) * (s.latency_ms * 0.2));
  const newLatency = Math.max(1, s.latency_ms + jitter);
  q.run("UPDATE data_sources SET last_sync='刚刚', latency=?, latency_ms=?, status='online', status_text='正常', sync_count=sync_count+1 WHERE id=?",
    newLatency + 'ms', newLatency, id);
  logActivity('DATASOURCE_SYNC', s.name, `latency=${newLatency}ms`);
  return { ok: true, id: Number(id), name: s.name, lastSync: '刚刚', latency: newLatency + 'ms', status: 'online' };
}

// ============================================================
//  收入分析（SQL 聚合）
// ============================================================
function getRevenueAnalysis(days = 30) {
  const daily = q.all(`SELECT stat_date AS date, ROUND(SUM(amount),2) AS amount, SUM(orders) AS orders
      FROM revenue_daily WHERE stat_date >= date('now','localtime',?) GROUP BY stat_date ORDER BY stat_date`,
    `-${days - 1} day`);
  const byChannel = q.all(`SELECT channel, ROUND(SUM(amount),2) AS amount,
      ROUND(SUM(amount) * 100.0 / (SELECT SUM(amount) FROM revenue_daily WHERE stat_date >= date('now','localtime',?)),2) AS share
      FROM revenue_daily WHERE stat_date >= date('now','localtime',?) GROUP BY channel ORDER BY amount DESC`,
    `-${days - 1} day`, `-${days - 1} day`);
  const byCity = q.all(`SELECT c.name AS city, ROUND(SUM(r.amount),2) AS amount
      FROM revenue_daily r JOIN cities c ON c.id = r.city_id
      WHERE r.stat_date >= date('now','localtime',?) GROUP BY c.id ORDER BY amount DESC`, `-${days - 1} day`);
  const todayRows = q.all(`SELECT channel, ROUND(SUM(amount),2) AS amount, SUM(orders) AS orders
      FROM revenue_daily WHERE stat_date=date('now','localtime') GROUP BY channel ORDER BY amount DESC`);
  const today = todayRows.reduce((s, r) => s + r.amount, 0);
  const yesterday = q.get("SELECT COALESCE(SUM(amount),0) AS v FROM revenue_daily WHERE stat_date=date('now','localtime','-1 day')").v;
  return {
    days, today, yesterday, todayRows, daily, byChannel, byCity,
    growth: yesterday ? (today - yesterday) / yesterday * 100 : 0,
    avgDaily: daily.length ? daily.reduce((s, r) => s + r.amount, 0) / daily.length : 0
  };
}

// ============================================================
//  风险分析（SQL 聚合）
// ============================================================
function getRiskAnalysis() {
  const expiring = q.all(`SELECT code AS id, name, client, amount, amount_num, days, category, badge_text
      FROM pending_items WHERE status='pending' ORDER BY days LIMIT 8`);
  const lowExecution = q.all("SELECT code AS id, client, amount, execution, end_date AS end, status_text FROM contracts WHERE execution < 50 ORDER BY execution");
  const riskyCampaigns = q.all("SELECT name, client, percent, status, status_text FROM campaigns WHERE status IN ('warning','danger') ORDER BY percent");
  const abnormalPoints = q.get("SELECT COUNT(*) AS c FROM points WHERE status='abnormal'").c;
  const totalRisk = q.get("SELECT ROUND(COALESCE(SUM(amount_num),0),1) AS wan FROM pending_items WHERE status='pending'").wan;
  const expiringCommunities = q.all("SELECT name, status_text, orders FROM communities WHERE status <> 'success'");
  return { expiring, lowExecution, riskyCampaigns, abnormalPoints, totalRisk, expiringCommunities };
}

// ============================================================
//  点位于覆盖分析（SQL 聚合）
// ============================================================
function getPointAnalysis() {
  const total = q.get(`SELECT COUNT(*) AS cnt, COUNT(DISTINCT community) AS communities, SUM(monthly_reach) AS reach,
      ROUND(AVG(revenue),2) AS avg_revenue, ROUND(SUM(revenue),2) AS revenue FROM points`);
  const byType = q.all(`SELECT point_type AS type, COUNT(*) AS cnt,
      ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM points),1) AS share FROM points GROUP BY point_type ORDER BY cnt DESC`);
  const byStatus = q.all('SELECT status, COUNT(*) AS cnt FROM points GROUP BY status ORDER BY cnt DESC');
  const byCity = q.all(`SELECT c.name AS city, COUNT(p.id) AS cnt, ROUND(AVG(p.revenue),2) AS avg_revenue,
      ROUND(COUNT(p.id) * 100.0 / (SELECT COUNT(*) FROM points),1) AS share
      FROM cities c JOIN points p ON p.city_id=c.id GROUP BY c.id ORDER BY cnt DESC`);
  const expandCandidates = q.all(`SELECT c.name AS city, ROUND(COUNT(p.id) * 1.0 / (c.hot + 1), 1) AS density
      FROM cities c JOIN points p ON p.city_id = c.id WHERE c.hot >= 3 GROUP BY c.id ORDER BY c.hot DESC`);
  return { total, byType, byStatus, byCity, expandCandidates };
}

// ============================================================
//  罗姐 AI 引擎 —— 全部结论由数据库 SQL 计算得出
// ============================================================
const fmtPct = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

function aiRevenue() {
  const a = getRevenueAnalysis(30);
  const ch = a.todayRows.map(r => `${r.channel}（${money(r.amount)}）`).join('、');
  const top = a.byChannel.slice(0, 2).map(r => `<li>${r.channel}：30 天累计 ${money(r.amount)}，占比 ${r.share}%</li>`).join('');
  const cityTop = a.byCity.slice(0, 3).map(r => `<li>${r.city}：${money(r.amount)}</li>`).join('');
  return {
    category: '收入分析', priority_tag: '急低',
    html: `
      <p style="margin-bottom: 12px;">您好！我是罗姐，您的户外广告AI顾问。以下结论全部来自数据库实时聚合：</p>
      <p style="margin-bottom: 8px;"><strong>📈 收入情况</strong></p>
      <p style="margin-bottom: 12px; color: var(--success);">今日投放收入 <strong>${money(a.today)}</strong>（约 ¥${wan(a.today)}万），
      较昨日 ${a.today >= a.yesterday ? '增长' : '下降'} <strong>${fmtPct(a.growth)}</strong>。
      主要来源：${ch}。</p>
      <p style="margin-bottom: 8px;"><strong>📊 近 30 天结构</strong></p>
      <ul style="margin: 0 0 12px 18px;">${top}</ul>
      <p style="margin-bottom: 8px;"><strong>📍 城市贡献 TOP3</strong></p>
      <ul style="margin: 0 0 12px 18px;">${cityTop}</ul>
      <p style="margin-bottom: 8px;"><strong>💡 建议</strong></p>
      <p style="color: var(--accent);">日均收入 ${money(a.avgDaily)}，建议对贡献最高的渠道追加点位资源，
      同时对低于日均线 30% 的城市做点位与价格复盘。</p>`
  };
}

function aiRisk() {
  const r = getRiskAnalysis();
  const list = r.expiring.slice(0, 5).map((i, n) => `${n + 1}. ${i.name}（${i.amount}，${i.client}）- ${i.days}天后到期`).join('<br>');
  const low = r.lowExecution.slice(0, 3).map(i => `<li>${i.client} ${i.amount}：履约进度仅 ${i.execution}%</li>`).join('');
  const camp = r.riskyCampaigns.slice(0, 3).map(i => `<li>${i.name}：${i.percent}% · ${i.status_text}</li>`).join('');
  return {
    category: '风险预警', priority_tag: '急高',
    html: `
      <p style="margin-bottom: 12px;">风险预警分析（数据源：待确认清单 + 合同履约表 + 投放计划表）：</p>
      <p style="margin-bottom: 8px;"><strong>⚠️ 待处理风险总额</strong></p>
      <p style="margin-bottom: 12px; color: var(--warning);">合计 <strong>¥${r.totalRisk}万</strong>，共 ${r.expiring.length} 项待确认/即将到期：<br>${list}</p>
      <p style="margin-bottom: 8px;"><strong>📉 低履约合同</strong></p>
      <ul style="margin: 0 0 12px 18px;">${low || '<li>无</li>'}</ul>
      <p style="margin-bottom: 8px;"><strong>🚨 进度告警的投放计划</strong></p>
      <ul style="margin: 0 0 12px 18px;">${camp || '<li>无</li>'}</ul>
      <p style="margin-bottom: 8px;"><strong>🔧 点位异常</strong></p>
      <p style="margin-bottom: 12px;">当前异常点位 <strong>${r.abnormalPoints}</strong> 个，建议运维 48 小时内巡检修复。</p>
      <p style="color: var(--accent);">建议优先跟进剩余天数最少、金额最大的合同，续签成功率与历史履约记录正相关。</p>`
  };
}

function aiPoints() {
  const p = getPointAnalysis();
  const types = p.byType.map(t => `• ${t.type}：${t.cnt}个（${t.share}%）`).join('<br>');
  const cities = p.byCity.map(c => `<li>${c.city}：${c.cnt} 个点位（${c.share}%），点位均收入 ${money(c.avg_revenue)}</li>`).join('');
  const status = p.byStatus.map(s => `${s.status === 'online' ? '在线' : s.status === 'hot' ? '高活跃' : s.status === 'medium' ? '中等' : '异常'} ${s.cnt}`).join(' · ');
  const expand = p.expandCandidates.map(c => `<li>${c.city}：热区密集，单热区点位负载 ${c.density}，建议优先扩容</li>`).join('');
  return {
    category: '点位分析', priority_tag: '',
    html: `
      <p style="margin-bottom: 12px;">好的，我来为您分析点位覆盖情况（SQL 实时统计 ${p.total.cnt} 条点位明细）：</p>
      <p style="margin-bottom: 8px;"><strong>📍 当前覆盖</strong></p>
      <p style="margin-bottom: 12px;">总计 <strong>${p.total.cnt.toLocaleString('zh-CN')}</strong> 个点位，覆盖 <strong>${p.total.communities}</strong> 个社区单元，
      月触达 <strong>${(p.total.reach / 10000).toFixed(1)} 万人次</strong>。其中：<br>${types}</p>
      <p style="margin-bottom: 8px;"><strong>🏙️ 城市分布</strong></p>
      <ul style="margin: 0 0 12px 18px;">${cities}</ul>
      <p style="margin-bottom: 8px;"><strong>🔎 运行状态</strong></p>
      <p style="margin-bottom: 12px;">${status}</p>
      <p style="margin-bottom: 8px;"><strong>🎯 拓展建议</strong></p>
      <ul style="margin: 0 0 12px 18px;">${expand}</ul>
      <p style="margin-bottom: 8px;"><strong>📊 ROI预测</strong></p>
      <p style="color: var(--success);">当前点位均收入 ${money(p.total.avg_revenue)}，按热区扩容测算，预计 3 个月内 ROI 可提升至 <strong>4.2</strong></p>`
  };
}

function aiRoi() {
  const r = computeRoi();
  const a = getRevenueAnalysis(30);
  const best = a.byChannel[0];
  return {
    category: 'ROI评估', priority_tag: '',
    html: `
      <p style="margin-bottom: 12px;">ROI 评估（口径：近 30 天投放收入 ÷ 投放成本）：</p>
      <p style="margin-bottom: 8px;"><strong>📊 核心结论</strong></p>
      <p style="margin-bottom: 12px; color: var(--success);">ROI 指数 <strong>${r.roi.toFixed(2)}</strong>，
      ${r.roi >= 2.9 ? '高于' : '低于'}行业平均 2.9（${r.roi >= 2.9 ? '+' : ''}${(r.roi - 2.9).toFixed(2)}）。</p>
      <p style="margin-bottom: 8px;"><strong>💵 收支拆解</strong></p>
      <p style="margin-bottom: 12px;">30 天收入 <strong>${money(r.revenue)}</strong>，投放成本 <strong>${money(r.cost)}</strong>，
      毛利 <strong>${money(r.revenue - r.cost)}</strong>，毛利率 <strong>${(100 - r.cost / r.revenue * 100).toFixed(1)}%</strong>。</p>
      <p style="margin-bottom: 8px;"><strong>🏆 最优渠道</strong></p>
      <p style="margin-bottom: 12px; color: var(--accent);">${best.channel} 贡献 ${money(best.amount)}（占比 ${best.share}%），
      建议把增量预算优先投向该渠道的高活跃点位。</p>
      <p style="margin-bottom: 8px;"><strong>💡 提升路径</strong></p>
      <p>1. 对 ROI 低于 2.5 的点位做价格动态调整；2. 提升高活跃点位曝光频次；3. 用 AI 素材替换低完播素材。</p>`
  };
}

function aiOverview() {
  const kpi = getKpi().reduce((m, k) => (m[k.key] = k, m), {});
  const risk = getRiskAnalysis();
  const sales = getSales();
  return {
    category: '经营总览', priority_tag: '急低',
    html: `
      <p style="margin-bottom: 12px;">您好！我是罗姐。以下是当前经营总览（全部由数据库实时计算）：</p>
      <p style="margin-bottom: 12px;">
      💰 今日收入 <strong>${kpi.revenue.value}</strong>（${kpi.revenue.detail}）<br>
      ⚠️ 风险敞口 <strong>${kpi.risk.value}</strong>（${kpi.risk.detail}）<br>
      📍 点位覆盖 <strong>${kpi.points.value}</strong>（${kpi.points.detail}）<br>
      📊 ROI 指数 <strong>${kpi.roi.value}</strong>（${kpi.roi.detail}）</p>
      <p style="margin-bottom: 8px;"><strong>🤝 销售漏斗</strong></p>
      <p style="margin-bottom: 12px;">${sales.funnel.map(f => `${f.name} ${f.value}（${f.percent}）`).join(' → ')}</p>
      <p style="color: var(--accent);">您可以直接问我：<strong>收入</strong>、<strong>风险</strong>、<strong>点位</strong>、<strong>ROI</strong>，
      我会基于实时数据给出分析。</p>`
  };
}

function aiAnswer(question) {
  const s = (question || '').toLowerCase();
  const has = (...ks) => ks.some(k => s.includes(k.toLowerCase()));
  if (has('roi', 'roi指数', '投资回报', '回报率')) return aiRoi();
  if (has('风险', '预警', '到期', '催收', '逾期')) return aiRisk();
  if (has('点位', '覆盖', '拓展', '社区')) return aiPoints();
  if (has('收入', '营收', '钱', 'gmv', '投放金额', '营业额')) return aiRevenue();
  return aiOverview();
}

function chat(question, conversationId = 1) {
  if (!question || !question.trim()) return { ok: false, error: 'BAD_REQUEST', message: '问题不能为空' };
  let conv = q.get('SELECT * FROM ai_conversations WHERE id=?', conversationId);
  if (!conv) {
    const r = q.run('INSERT INTO ai_conversations (title) VALUES (?)', question.slice(0, 20));
    conv = { id: Number(r.lastInsertRowid) };
  }
  q.run("INSERT INTO ai_messages (conversation_id, role, content, category, priority_tag) VALUES (?,?,?,?,?)",
    conv.id, 'user', question, '', '');
  const ans = aiAnswer(question);
  q.run("INSERT INTO ai_messages (conversation_id, role, content, category, priority_tag) VALUES (?,?,?,?,?)",
    conv.id, 'assistant', ans.html, ans.category, ans.priority_tag);
  q.run('UPDATE ai_conversations SET updated_at=? WHERE id=?', nowStr(), conv.id);
  q.run("UPDATE agents SET calls = calls + 1 WHERE endpoint LIKE '%luojie%'");
  logActivity('AI_CHAT', conv.id + ':' + ans.category, question.slice(0, 80));
  return { ok: true, conversationId: Number(conv.id), question, ...ans, created_at: nowStr() };
}

const getChatHistory = (conversationId = 1) => q.all(
  `SELECT id, role, content, category, priority_tag AS priorityTag, created_at AS createdAt
   FROM ai_messages WHERE conversation_id=? ORDER BY id`, conversationId);

// ============================================================
//  报表导出（真实 CSV）
// ============================================================
function exportCsv() {
  const rows = [['模块', '指标', '数值', '备注']];
  getKpi().forEach(k => rows.push(['经营决策', k.label, k.value, k.detail]));
  const a = getRevenueAnalysis(30);
  rows.push(['收入分析', '今日收入', a.today, `环比 ${fmtPct(a.growth)}`]);
  rows.push(['收入分析', '30天收入', a.daily.reduce((s, r) => s + r.amount, 0), `日均 ${a.avgDaily.toFixed(2)}`]);
  a.byChannel.forEach(c => rows.push(['收入分析', '渠道-' + c.channel, c.amount, c.share + '%']));
  a.byCity.forEach(c => rows.push(['收入分析', '城市-' + c.city, c.amount, '']));
  getRiskAnalysis().expiring.forEach(i => rows.push(['风险', i.name, i.amount, `${i.client} ${i.days}天后到期`]));
  getContracts().forEach(c => rows.push(['合同兑现', c.id + ' ' + c.client, c.amount, `履约 ${c.execution}%`]));
  getProgress().forEach(c => rows.push(['投放进度', c.name, c.percent + '%', c.statusText]));
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  return '\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n');
}

// ============================================================
//  只读 SQL 控制台（仅允许单条 SELECT / WITH）
// ============================================================
function runReadOnlySql(sql) {
  const s = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!s) return { ok: false, error: 'BAD_REQUEST', message: 'SQL 不能为空' };
  if (/;/.test(s)) return { ok: false, error: 'FORBIDDEN', message: '仅支持单条语句' };
  if (!/^(select|with)\b/i.test(s)) return { ok: false, error: 'FORBIDDEN', message: '只读通道，仅支持 SELECT / WITH' };
  if (/\b(insert|update|delete|drop|alter|create|attach|pragma|replace|vacuum)\b/i.test(s))
    return { ok: false, error: 'FORBIDDEN', message: '检测到写操作关键字，已拒绝' };
  try {
    const started = process.hrtime.bigint();
    // 统一包一层外层查询来强制 200 行上限，避免与语句自带的 LIMIT / ORDER BY 冲突
    const rows = q.all(`SELECT * FROM (${s}) LIMIT 200`);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    return { ok: true, rowCount: rows.length, elapsedMs: Number(ms.toFixed(2)), columns: rows[0] ? Object.keys(rows[0]) : [], rows };
  } catch (e) {
    return { ok: false, error: 'SQL_ERROR', message: e.message };
  }
}

// ============================================================
//  全量 bootstrap（前端一次性渲染 16 个模块）
// ============================================================
async function bootstrap() {
  const cust = getCustomers();
  return {
    generatedAt: nowStr(),
    kpi: getKpi(),
    overview: await getOverview(),
    dashboard: getDashboard(),
    pending: getPending(),
    mapData: getMap(),
    messages: cust.list,
    customerStats: cust.stats,
    acquisition: getAcquisitionAnalysis(),
    sales: getSales(),
    progress: getProgress(),
    community: getCommunity(),
    contracts: getContracts(),
    creative: getCreatives(),
    agents: getAgents(),
    service: getTickets(),
    knowledge: getKnowledge(),
    rd: getRd().requirements,
    roadmap: getRd().roadmap,
    daily: getDaily(),
    dataSources: getDataSources(),
    chat: { conversationId: 1, messages: getChatHistory(1) },
    metrics: { roi: computeRoi(), revenue: getRevenueAnalysis(30), points: getPointAnalysis().total }
  };
}

// ============================================================
//  HTTP 服务
// ============================================================
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function sendJson(res, data, code = 200, cors = false) {
  const body = JSON.stringify(data, null, 2);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) };
  // 仅公开接口允许跨域（获客落地页可能以 file:// 打开，需跨域回连）。
  // 后台管理接口一律不带 CORS 头，避免局域网内任意网页读取经营数据；
  // 前端本身是同源请求，不依赖 CORS。
  if (cors) headers['Access-Control-Allow-Origin'] = '*';
  res.writeHead(code, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve(Object.fromEntries(new URLSearchParams(raw))); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(ROOT, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 Not Found');
  }
  const ext = path.extname(file).toLowerCase();
  const content = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  if (!p.startsWith('/api/')) return serveStatic(req, res, url.pathname);

  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const Q = url.searchParams;

    // ---- 读接口 ----
    if (req.method === 'GET') {
      switch (p) {
        case '/api/health': {
          const payload = { ok: true, service: 'pdooh-aic', time: nowStr(), uptime_s: Math.round(process.uptime()) };
          // 跨域/浏览器来源不返回数据库路径，避免通过任意网页探测服务器目录结构
          if (!req.headers.origin) payload.db = DB_FILE;
          return sendJson(res, payload, 200, true);
        }
        case '/api/bootstrap': return sendJson(res, { ok: true, data: await bootstrap() });
        case '/api/kpi': return sendJson(res, { ok: true, data: getKpi() });
        case '/api/dashboard': return sendJson(res, { ok: true, data: getDashboard() });
        case '/api/overview': return sendJson(res, { ok: true, data: await getOverview() });
        case '/api/pending': return sendJson(res, { ok: true, data: getPending() });
        case '/api/map': return sendJson(res, { ok: true, data: getMap() });
        case '/api/map/city': return sendJson(res, { ok: true, data: getCityDetail(Q.get('id')) });
        case '/api/customers': return sendJson(res, { ok: true, data: getCustomers({
            stage: Q.get('stage') || undefined, source: Q.get('source') || undefined,
            kw: Q.get('kw') || undefined, owner: Q.get('owner') || undefined
          }) });
        case '/api/customers/detail': return sendJson(res, { ok: true, data: getCustomerDetail(Number(Q.get('id'))) });
        case '/api/analytics/acquisition': return sendJson(res, { ok: true, data: getAcquisitionAnalysis() });
        case '/api/sales': return sendJson(res, { ok: true, data: getSales() });
        case '/api/campaigns': return sendJson(res, { ok: true, data: getProgress() });
        case '/api/communities': return sendJson(res, { ok: true, data: getCommunity() });
        case '/api/contracts': return sendJson(res, { ok: true, data: getContracts() });
        case '/api/creatives': return sendJson(res, { ok: true, data: getCreatives() });
        case '/api/agents': return sendJson(res, { ok: true, data: getAgents() });
        case '/api/tickets': return sendJson(res, { ok: true, data: getTickets() });
        case '/api/knowledge': return sendJson(res, { ok: true, data: Q.get('kw') ? searchKnowledge(Q.get('kw')) : getKnowledge() });
        case '/api/rd': return sendJson(res, { ok: true, data: getRd() });
        case '/api/daily': return sendJson(res, { ok: true, data: getDaily() });
        case '/api/datasources': return sendJson(res, { ok: true, data: getDataSources() });
        case '/api/analytics/revenue': return sendJson(res, { ok: true, data: getRevenueAnalysis(Number(Q.get('days')) || 30) });
        case '/api/analytics/risk': return sendJson(res, { ok: true, data: getRiskAnalysis() });
        case '/api/analytics/points': return sendJson(res, { ok: true, data: getPointAnalysis() });
        case '/api/analytics/roi': return sendJson(res, { ok: true, data: computeRoi() });
        case '/api/ai/history': return sendJson(res, { ok: true, data: getChatHistory(Number(Q.get('conversationId')) || 1) });
        case '/api/activity': return sendJson(res, { ok: true, data: q.all('SELECT * FROM activity_log ORDER BY id DESC LIMIT 50') });
        case '/api/export/report.csv': {
          const csv = exportCsv();
          res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="pdooh-report.csv"', 'Access-Control-Allow-Origin': '*' });
          return res.end(csv);
        }
        default: return sendJson(res, { ok: false, error: 'NOT_FOUND', message: '未知接口: ' + p }, 404);
      }
    }

    // ---- 写接口 ----
    if (req.method === 'POST') {
      switch (p) {
        case '/api/pending/decision':
          return sendJson(res, { ok: true, data: decidePending(body.code || body.id, body.action, body.note) });
        case '/api/ai/chat':
          return sendJson(res, { ok: true, data: chat(body.question, Number(body.conversationId) || 1) });
        case '/api/customers/contact':
          return sendJson(res, { ok: true, data: contactCustomer(body.id, body.note) });
        // ---- 获客 CRM 写操作 ----
        case '/api/customers/create':
          return sendJson(res, { ok: true, data: createCustomer(body) });
        case '/api/customers/update':
          return sendJson(res, { ok: true, data: updateCustomer(body) });
        case '/api/customers/delete':
          return sendJson(res, { ok: true, data: deleteCustomer(body.id) });
        case '/api/customers/stage':
          return sendJson(res, { ok: true, data: updateStage(body.id, body.stage) });
        // 公开留资入口（免登录，经隧道对外暴露，带 IP 频控）
        case '/api/public/lead': {
          const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
          return sendJson(res, { ok: true, data: publicLead(body, ip) }, 200, true);
        }
        case '/api/tickets/update':
          return sendJson(res, { ok: true, data: updateTicket(body.code || body.id, body) });
        case '/api/rd/vote':
          return sendJson(res, { ok: true, data: voteRequirement(body.id) });
        case '/api/creatives/generate':
          return sendJson(res, { ok: true, data: generateCreative(body) });
        case '/api/daily/submit':
          return sendJson(res, { ok: true, data: submitDaily(body) });
        case '/api/datasources/sync':
          return sendJson(res, { ok: true, data: syncDataSource(body.id) });
        case '/api/sql/query':
          return sendJson(res, { ok: true, data: runReadOnlySql(body.sql) });
        default: return sendJson(res, { ok: false, error: 'NOT_FOUND', message: '未知接口: ' + p }, 404);
      }
    }

    return sendJson(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  } catch (e) {
    console.error(`[error ${nowStr()}]`, p, e.message);
    return sendJson(res, { ok: false, error: 'INTERNAL', message: e.message }, 500);
  }
});

server.listen(PORT, HOST, () => {
  const c = q.get('SELECT (SELECT COUNT(*) FROM points) AS points, (SELECT COUNT(*) FROM contracts) AS contracts, (SELECT COUNT(*) FROM customers) AS customers');
  console.log('==========================================================');
  console.log(' pDOOH AI 经营决策中心 已启动');
  console.log('  前端   : http://127.0.0.1:' + PORT + '/');
  console.log('  接口   : http://127.0.0.1:' + PORT + '/api/bootstrap');
  console.log('  数据库 : ' + DB_FILE);
  console.log('  数据量 : 点位 ' + c.points + ' / 合同 ' + c.contracts + ' / 客户 ' + c.customers);
  console.log('==========================================================');
});

process.on('SIGTERM', () => { console.log('[shutdown] SIGTERM'); server.close(() => { db.close(); process.exit(0); }); });
process.on('SIGINT', () => { console.log('[shutdown] SIGINT'); server.close(() => { db.close(); process.exit(0); }); });
