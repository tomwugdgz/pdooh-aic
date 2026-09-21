-- ============================================================
-- pDOOH AI 经营决策中心 · 数据库结构 (SQLite 3)
-- 覆盖原页面 16 个模块的全部数据模型
-- 执行方式: sqlite3 data/pdooh.db < sql/schema.sql
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------- 01 今日工作台 ----------
CREATE TABLE IF NOT EXISTS dashboard_stats (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT    NOT NULL,
    value       TEXT    NOT NULL,
    icon        TEXT    NOT NULL,
    color       TEXT    NOT NULL,          -- warning|success|info|primary
    trend       TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schedule_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    time        TEXT    NOT NULL,          -- HH:MM
    title       TEXT    NOT NULL,
    type        TEXT    NOT NULL,          -- 会议|客户|合同|巡检|内部
    icon        TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reminders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    icon        TEXT    NOT NULL,
    text        TEXT    NOT NULL,
    color       TEXT    NOT NULL,          -- warning|danger|info
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS team_members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    avatar      TEXT    NOT NULL,
    status      TEXT    NOT NULL,          -- online|busy|offline
    task        TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ---------- 02 待确认 (点位/合同/素材 审批流) ----------
CREATE TABLE IF NOT EXISTS pending_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL UNIQUE,   -- SP-2026-0624-01 / HT-... / CR-...
    category    TEXT    NOT NULL,          -- spot|contract|creative
    name        TEXT    NOT NULL,
    client      TEXT    NOT NULL,
    amount      TEXT    NOT NULL,
    amount_num  REAL    NOT NULL DEFAULT 0, -- 数值化金额(万) 便于聚合
    days        INTEGER NOT NULL DEFAULT 0,
    badge       TEXT    NOT NULL,          -- danger|warning|info
    badge_text  TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pending',  -- pending|approved|rejected
    decided_at  TEXT,
    decide_note TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pending_status   ON pending_items(status);
CREATE INDEX IF NOT EXISTS idx_pending_category ON pending_items(category);

-- ---------- 03 经营决策 KPI ----------
CREATE TABLE IF NOT EXISTS kpi_metrics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT    NOT NULL UNIQUE,   -- revenue|risk|points|roi
    icon        TEXT    NOT NULL,
    value       TEXT    NOT NULL,
    label       TEXT    NOT NULL,
    detail      TEXT    NOT NULL,
    trend       TEXT    NOT NULL,
    trend_dir   TEXT    NOT NULL DEFAULT 'positive', -- positive|negative
    color       TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ---------- 04 投放作战地图 ----------
CREATE TABLE IF NOT EXISTS cities (
    id          TEXT    PRIMARY KEY,       -- gz|sz|fs|dg|zh
    name        TEXT    NOT NULL,
    smart_screen INTEGER NOT NULL DEFAULT 0,
    door        INTEGER NOT NULL DEFAULT 0,
    gate        INTEGER NOT NULL DEFAULT 0,
    elevator    INTEGER NOT NULL DEFAULT 0,
    hot         INTEGER NOT NULL DEFAULT 0,
    x           REAL    NOT NULL DEFAULT 50,
    y           REAL    NOT NULL DEFAULT 50,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- 点位明细：由 seed 通过递归 CTE 按城市配额生成，总计 2368 个点位
CREATE TABLE IF NOT EXISTS points (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT    NOT NULL UNIQUE,
    city_id      TEXT    NOT NULL REFERENCES cities(id),
    community    TEXT    NOT NULL,
    point_type   TEXT    NOT NULL,          -- 智能屏|门禁|道闸|电梯框架
    status       TEXT    NOT NULL,          -- online|hot|medium|abnormal
    screens      INTEGER NOT NULL DEFAULT 1,
    monthly_reach INTEGER NOT NULL DEFAULT 0,
    revenue      REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_points_city   ON points(city_id);
CREATE INDEX IF NOT EXISTS idx_points_type   ON points(point_type);
CREATE INDEX IF NOT EXISTS idx_points_status ON points(status);

CREATE TABLE IF NOT EXISTS map_dots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    city_id     TEXT    NOT NULL REFERENCES cities(id),
    x           REAL    NOT NULL,
    y           REAL    NOT NULL,
    count       INTEGER NOT NULL,
    type        TEXT    NOT NULL             -- success|primary|warning|danger
);

CREATE TABLE IF NOT EXISTS map_legend (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT    NOT NULL,
    color       TEXT    NOT NULL,
    count       INTEGER NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ---------- 05 客户待跟进 / 获客 CRM ----------
-- 完整字段：既支持内部录入，也承接公开留资页（免登录）提交的线索
CREATE TABLE IF NOT EXISTS customers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,   -- 客户/公司名
    contact     TEXT    NOT NULL,          -- 联系人
    avatar      TEXT    NOT NULL,
    last_touch  TEXT    NOT NULL,
    task        TEXT    NOT NULL,          -- 当前待办
    priority    TEXT    NOT NULL,          -- high|medium|low|urgent
    status      TEXT    NOT NULL,          -- urgent|follow|pending|review|new
    follow_count INTEGER NOT NULL DEFAULT 0,
    last_follow_at TEXT,
    -- 以下为 CRM / 获客扩展字段
    phone       TEXT    NOT NULL DEFAULT '',   -- 联系电话
    company     TEXT    NOT NULL DEFAULT '',   -- 公司全称
    industry    TEXT    NOT NULL DEFAULT '',   -- 行业
    email       TEXT    NOT NULL DEFAULT '',
    source      TEXT    NOT NULL DEFAULT '手动录入', -- 获客来源渠道
    stage       TEXT    NOT NULL DEFAULT 'lead',     -- lead|interest|proposal|signed
    budget_wan  REAL    NOT NULL DEFAULT 0,          -- 意向预算(万元)
    owner       TEXT    NOT NULL DEFAULT '',         -- 负责人
    note        TEXT    NOT NULL DEFAULT '',         -- 备注
    is_public   INTEGER NOT NULL DEFAULT 0,          -- 1=来自公开留资页
    client_ip   TEXT    NOT NULL DEFAULT '',         -- 留资来源 IP（防刷审计）
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_stage  ON customers(stage);
CREATE INDEX IF NOT EXISTS idx_customers_source ON customers(source);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);

CREATE TABLE IF NOT EXISTS follow_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL DEFAULT 'follow',  -- create|follow|stage|edit
    note        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_follow_customer ON follow_logs(customer_id);

-- ---------- 06 销售作战卡 ----------
CREATE TABLE IF NOT EXISTS sales_funnel (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    value       INTEGER NOT NULL,
    percent     TEXT    NOT NULL,
    detail      TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales_ranking (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    avatar      TEXT    NOT NULL,
    deals       INTEGER NOT NULL,
    amount      TEXT    NOT NULL,
    amount_num  REAL    NOT NULL,
    rate        TEXT    NOT NULL,
    rate_num    REAL    NOT NULL,
    color       TEXT    NOT NULL
);

-- ---------- 07 全面投放进度 ----------
CREATE TABLE IF NOT EXISTS campaigns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    client      TEXT    NOT NULL,
    start_date  TEXT    NOT NULL,
    end_date    TEXT    NOT NULL,
    percent     INTEGER NOT NULL,
    status      TEXT    NOT NULL,          -- success|warning|danger
    status_text TEXT    NOT NULL,
    budget      REAL    NOT NULL DEFAULT 0,
    spend       REAL    NOT NULL DEFAULT 0
);

-- ---------- 08 社区看板 ----------
CREATE TABLE IF NOT EXISTS communities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    address     TEXT    NOT NULL,
    point_type  TEXT    NOT NULL,
    people      TEXT    NOT NULL,
    people_num  INTEGER NOT NULL,
    orders      INTEGER NOT NULL,
    status      TEXT    NOT NULL,          -- success|warning|danger
    status_text TEXT    NOT NULL
);

-- ---------- 09 合同兑现 ----------
CREATE TABLE IF NOT EXISTS contracts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL UNIQUE,
    client      TEXT    NOT NULL,
    amount      TEXT    NOT NULL,
    amount_num  REAL    NOT NULL,
    start_date  TEXT    NOT NULL,
    end_date    TEXT    NOT NULL,
    execution   INTEGER NOT NULL,
    status      TEXT    NOT NULL,
    status_text TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts(client);

-- ---------- 10 AI 素材生产中心 ----------
CREATE TABLE IF NOT EXISTS creatives (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL,          -- KV|视频|海报|GIF
    placement   TEXT    NOT NULL,
    produce_date TEXT   NOT NULL,
    gradient    TEXT    NOT NULL DEFAULT '',
    icon        TEXT    NOT NULL,
    client      TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'done'
);

-- ---------- 11 智能体交付中心 ----------
CREATE TABLE IF NOT EXISTS agents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    endpoint    TEXT    NOT NULL,
    calls       INTEGER NOT NULL,
    qps         INTEGER NOT NULL,
    status      TEXT    NOT NULL,          -- online|busy|offline
    doc         TEXT    NOT NULL
);

-- ---------- 12 客服服务中心 ----------
CREATE TABLE IF NOT EXISTS tickets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL UNIQUE,
    client      TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    urgency     TEXT    NOT NULL,          -- high|medium|low
    status      TEXT    NOT NULL,          -- pending|processing|done
    status_text TEXT    NOT NULL,
    handler     TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

-- ---------- 13 公司知识库 ----------
CREATE TABLE IF NOT EXISTS knowledge_docs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    views       INTEGER NOT NULL,
    doc_date    TEXT    NOT NULL,
    content     TEXT    NOT NULL DEFAULT '',
    tags        TEXT    NOT NULL DEFAULT ''  -- 逗号分隔
);

-- ---------- 14 产品研发 ----------
CREATE TABLE IF NOT EXISTS rd_requirements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    priority    TEXT    NOT NULL,          -- high|medium|low
    status      TEXT    NOT NULL,          -- in_progress|review|planned|completed
    status_text TEXT    NOT NULL,
    author      TEXT    NOT NULL,
    votes       INTEGER NOT NULL DEFAULT 0,
    comments    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roadmap (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    quarter     TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL,
    status      TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ---------- 15 每日日报 ----------
CREATE TABLE IF NOT EXISTS daily_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    author      TEXT    NOT NULL,
    dept        TEXT    NOT NULL,
    mood        TEXT    NOT NULL,
    mood_text   TEXT    NOT NULL,
    report_date TEXT    NOT NULL DEFAULT (date('now','localtime')),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS daily_report_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id   INTEGER NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL,          -- done|plan
    content     TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ---------- 16 数据连接中心 ----------
CREATE TABLE IF NOT EXISTS data_sources (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    status      TEXT    NOT NULL,          -- online|busy|offline
    status_text TEXT    NOT NULL,
    last_sync   TEXT    NOT NULL,
    latency     TEXT    NOT NULL,
    latency_ms  INTEGER NOT NULL,
    qps         INTEGER NOT NULL,
    sync_count  INTEGER NOT NULL DEFAULT 0
);

-- ---------- 收入明细（罗姐 AI 分析 & 报表导出的数据底座） ----------
CREATE TABLE IF NOT EXISTS revenue_daily (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    stat_date   TEXT    NOT NULL,          -- YYYY-MM-DD
    channel     TEXT    NOT NULL,          -- 智能屏|门禁|道闸|电梯框架
    city_id     TEXT    NOT NULL REFERENCES cities(id),
    orders      INTEGER NOT NULL DEFAULT 0,
    amount      REAL    NOT NULL,          -- 单位: 元
    UNIQUE(stat_date, channel, city_id)
);
CREATE INDEX IF NOT EXISTS idx_revenue_date ON revenue_daily(stat_date);

-- ---------- AI 对话（罗姐） ----------
CREATE TABLE IF NOT EXISTS ai_conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ai_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role            TEXT    NOT NULL,      -- user|assistant
    content         TEXT    NOT NULL,      -- 富文本 HTML
    category        TEXT    NOT NULL DEFAULT '',  -- 收入分析|风险预警|点位分析|ROI评估|通用
    priority_tag    TEXT    NOT NULL DEFAULT '',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id);

-- ---------- 操作审计日志 ----------
CREATE TABLE IF NOT EXISTS activity_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    action      TEXT    NOT NULL,
    target      TEXT    NOT NULL,
    detail      TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
