# pDOOH AI 经营决策中心 · 本地前后端系统

把 `https://duckwolf.cn/aic.html`（单文件纯前端演示页）完整重建为一套**真实可部署的前后端系统**：
后端提供 REST API + SQLite 数据库 + SQL 数据调取，前端保留原页面 100% 的视觉与 16 个模块功能，
所有数字不再写死在 HTML 里，而是从数据库实时查询得到。

```
浏览器 (public/index.html + app.js)
        │  fetch  /api/*        ← 同源，无跨域
        ▼
Node.js HTTP 服务 (server.js，零第三方依赖)
        │  node:sqlite 预处理语句
        ▼
SQLite 数据库 (data/pdooh.db) ← sql/schema.sql + sql/seed.sql
```

> **关于本 README 中的占位符**
> 为了让仓库可以公开分享，文中所有内网/网络信息（`<LAN_IP>`、`<GATEWAY_IP>`、`<ISP_EGRESS_IP>`、`<LAN_CIDR>`、`<USER>`）
> 均已替换为占位符。本机实际值请用 `ip -4 addr show`、`ip route` 查看，
> 或见本机未入库的 `DEPLOY-NOTES.local.md`。

## 一、目录结构

```
pdooh-aic/
├── server.js                     # 后端服务（Node 原生 http + node:sqlite）
├── public/
│   ├── index.html                # 后台主页面（原页面样式/布局 1:1 保留）
│   ├── app.js                    # 前端逻辑（16 模块渲染 + API 数据层 + 交互）
│   └── lead.html                 # 【对外获客落地页】免登录，客户留资入口
├── sql/
│   ├── schema.sql                # 数据库结构（29 张表）
│   ├── seed.sql                  # 种子数据（对齐原页面全部数值）
│   └── queries.sql               # 25 组 SQL 数据调取示例
├── tunnel-proxy.js               # 公网入口鉴权代理（含获客页免登录放行）
├── scripts/
│   ├── start.sh                  # 启动 / 停止 / 重启 / 状态 / 重建数据库
│   ├── tunnel.sh                 # 隧道地址与口令管理
│   ├── verify.js                 # 全栈端到端验证（116 项断言）
│   ├── browser-submit-test.js    # CDP 驱动真实浏览器走完整留资流程
│   ├── refresh-demo-data.js      # 演示数据保鲜（收入日期对齐到今天）
│   ├── pdooh-aic.service         # systemd 服务单元
│   ├── pdooh-proxy.service       # 隧道鉴权代理服务单元
│   └── pdooh-tunnel.service      # Cloudflare 隧道服务单元
└── data/                         # 运行时数据（已 gitignore，含数据库与凭证）
    ├── pdooh.db                  # SQLite 数据库文件
    └── pdooh.log                 # 运行日志
```

## 二、快速开始

```bash
cd /home/tom/deepseek/pdooh-aic

./scripts/start.sh start      # 启动服务（后台守护 + PID 文件）
./scripts/start.sh status     # 查看状态
./scripts/start.sh stop       # 停止
./scripts/start.sh restart    # 重启
./scripts/start.sh init-db    # 重建数据库（结构 + 种子数据）
```

启动后访问：

| 地址 | 说明 |
| --- | --- |
| http://127.0.0.1:5003/ | 前端主页（AI 经营决策中心） |
| http://<LAN_IP>:5003/ | 局域网访问（服务监听 0.0.0.0） |
| http://127.0.0.1:5003/api/bootstrap | 16 个模块的全量数据 |
| http://127.0.0.1:5003/api/health | 健康检查 |

端口可用环境变量覆盖：`PORT=8080 ./scripts/start.sh start`

## 三、数据库设计（29 张表）

| 模块 | 表 | 说明 |
| --- | --- | --- |
| 01 今日工作台 | `dashboard_stats` `schedule_items` `reminders` `team_members` | 指标卡 / 日程 / 提醒 / 团队 |
| 02 待确认 | `pending_items` | 点位·合同·素材三类审批，含审批状态与决定时间 |
| 03 经营决策 | `kpi_metrics` + `revenue_daily` | KPI 卡 + 收入明细（30 天 × 4 渠道 × 5 城市 = 600 行） |
| 04 作战地图 | `cities` `points` `map_dots` `map_legend` | **2368 条点位明细**（由递归 CTE 按城市配额生成） |
| 05 客户待跟进 | `customers` `follow_logs` | **获客 CRM**：录入/编辑/阶段推进/跟进历史，含电话·公司·行业·来源·预算·负责人 |
| 05+ 获客中心 | 复用 `customers` 聚合 | 公开留资入口、来源分析、转化漏斗、负责人分配 |
| 06 销售作战卡 | `sales_funnel` `sales_ranking` | 漏斗 + TOP5 英雄榜 |
| 07 投放进度 | `campaigns` | 含预算/已执行额，可算预算执行率 |
| 08 社区看板 | `communities` | 社区人流与产出 |
| 09 合同兑现 | `contracts` | 履约进度、已兑现金额 |
| 10 素材生产 | `creatives` | AI 素材库 |
| 11 智能体交付 | `agents` | Agent 接口 / 调用量 / QPS |
| 12 客服服务 | `tickets` | 工单状态流转 |
| 13 公司知识库 | `knowledge_docs` | 文档 + 标签 + 正文 |
| 14 产品研发 | `rd_requirements` `roadmap` | 需求池（可投票）+ 路线图 |
| 15 每日日报 | `daily_reports` `daily_report_items` | 主表 + 完成/计划子表 |
| 16 数据连接 | `data_sources` | 数据源健康度与同步次数 |
| AI 对话 | `ai_conversations` `ai_messages` | 罗姐对话持久化 |
| 审计 | `activity_log` | 所有写操作留痕 |

外键、索引、WAL 模式均已启用；`points` 表上建有 `city_id / point_type / status` 索引。

## 四、API 接口（共 38 个）

**读接口**

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `GET /api/bootstrap` | 16 模块 + KPI + 对话 + 指标（前端一次拉取） |
| `GET /api/kpi` | 经营决策 4 项 KPI（实时计算） |
| `GET /api/overview` | **今日工作台实时数据**：问候语（按时段）+ 日期/星期 + 真实天气 + 三项 KPI |
| `GET /api/dashboard` `GET /api/pending` `GET /api/map` `GET /api/customers` | 模块 01/02/04/05 |
| `GET /api/sales` `GET /api/campaigns` `GET /api/communities` `GET /api/contracts` | 模块 06/07/08/09 |
| `GET /api/creatives` `GET /api/agents` `GET /api/tickets` `GET /api/knowledge?kw=` | 模块 10/11/12/13（知识库支持关键词检索） |
| `GET /api/rd` `GET /api/daily` `GET /api/datasources` | 模块 14/15/16 |
| `GET /api/map/city?id=gz` | 城市点位下钻（类型/状态/TOP10 点位/30 天收入） |
| `GET /api/analytics/revenue?days=30` | 收入分析：日趋势 + 渠道结构 + 城市贡献 + 环比 |
| `GET /api/analytics/risk` | 风险分析：到期项 / 低履约合同 / 告警计划 / 异常点位 |
| `GET /api/analytics/points` | 点位分析：类型 / 状态 / 城市 / 均收入 |
| `GET /api/analytics/roi` | ROI = 30 天收入 ÷ 投放成本 |
| `GET /api/customers?stage=&source=&owner=&kw=` | 获客 CRM 列表（阶段/来源/负责人/关键词筛选）+ 统计 |
| `GET /api/customers/detail?id=` | 客户详情 + 完整跟进历史 |
| `GET /api/analytics/acquisition` | 获客分析：来源、阶段漏斗、14 天趋势、转化率 |
| `GET /api/ai/history?conversationId=1` | 罗姐对话历史 |
| `GET /api/activity` | 操作审计日志 |
| `GET /api/export/report.csv` | 报表导出（真实 CSV，带 BOM，Excel 可直接打开） |

**写接口**（均落库并写审计日志）

| 接口 | 请求体 | 说明 |
| --- | --- | --- |
| `POST /api/pending/decision` | `{code, action:'approve'\|'reject', note}` | 审批点位/合同/素材 |
| `POST /api/ai/chat` | `{question, conversationId}` | 罗姐 AI 问答（SQL 实时计算 + 落库） |
| `POST /api/customers/contact` | `{id, note}` | 记录客户跟进 |
| `POST /api/customers/create` | `{name, contact, phone, industry, source, stage, budgetWan, owner, ...}` | **新增客户/线索**（重名拦截） |
| `POST /api/customers/update` | `{id, ...任意字段}` | 编辑客户信息 |
| `POST /api/customers/delete` | `{id}` | 删除客户（连带跟进记录） |
| `POST /api/customers/stage` | `{id, stage}` | 推进获客阶段（线索→意向→方案→签约） |
| `POST /api/public/lead` | `{name, contact, phone, industry, budgetWan, message}` | **公开留资入口**（免登录，带 IP 频控） |
| `POST /api/tickets/update` | `{code, status, handler}` | 工单流转 |
| `POST /api/rd/vote` | `{id}` | 需求投票 |
| `POST /api/creatives/generate` | `{client, type}` | AI 生成素材并入库 |
| `POST /api/daily/submit` | `{title, author, dept, done[], plan[]}` | 提交日报（主表+子表） |
| `POST /api/datasources/sync` | `{id}` | 数据源同步（更新延迟/次数） |
| `POST /api/sql/query` | `{sql}` | **只读 SQL 控制台**：仅放行单条 `SELECT`/`WITH`，拒绝写操作与多语句，最多 200 行 |

## 五、SQL 数据调取

三种方式，任选：

```bash
# 1) 命令行执行示例集（25 组查询，输出带表头）
sqlite3 -header -column data/pdooh.db < sql/queries.sql

# 2) 单条 SQL 直接查询
sqlite3 -header -column data/pdooh.db \
  "SELECT c.name AS 城市, COUNT(p.id) AS 点位数 FROM cities c JOIN points p ON p.city_id=c.id GROUP BY c.id;"

# 3) 浏览器内的 SQL 查询控制台
#    打开页面 → 16 数据连接 → 🔎 SQL 查询控制台 → 输入 SQL → 执行查询
```

`sql/queries.sql` 覆盖 16 个模块 + 收入/风险/点位/ROI 四类分析，例如：

```sql
-- 今日 vs 昨日收入与环比
SELECT ROUND(SUM(CASE WHEN stat_date=date('now','localtime') THEN amount END),2) AS 今日收入,
       ROUND(SUM(CASE WHEN stat_date=date('now','localtime','-1 day') THEN amount END),2) AS 昨日收入
FROM revenue_daily;

-- 城市点位分布（聚合 2368 条点位明细）
SELECT c.name AS 城市, COUNT(p.id) AS 点位数
FROM cities c JOIN points p ON p.city_id=c.id GROUP BY c.id ORDER BY 点位数 DESC;

-- ROI = 30 天收入 ÷ 投放成本
SELECT ROUND((SELECT SUM(amount) FROM revenue_daily WHERE stat_date >= date('now','localtime','-29 day')) /
             NULLIF((SELECT SUM(SUM(spend)*10000) FROM campaigns),0), 2) AS ROI指数;
```

## 五之二、获客闭环（客户录入 + 对外留资）

这是平台的获客能力，分两条入口，最终都汇入同一张 `customers` 表：

```
① 内部录入                           ② 对外获客
   后台「客户待跟进/获客CRM」           分享 /lead.html 给潜在客户
   ➕ 新增客户（表单）                  客户免登录填写表单
              │                                  │
              ▼                                  ▼
        POST /api/customers/create      POST /api/public/lead（带 IP 频控）
              └──────────────┬───────────────────┘
                             ▼
                    customers 表（stage=线索，owner=未分配）
                             ▼
             推进阶段：线索 → 意向 → 方案 → 签约（每步写 follow_logs）
                             ▼
              「获客中心」看来源分析 / 转化漏斗 / 负责人分配
```

### 1. 客户录入（后台）

「客户待跟进 / 获客 CRM」页支持：**新增、编辑、删除、阶段推进、详情（含跟进历史）、关键词搜索、按阶段筛选**。

可录入字段：客户/公司名称、联系人、联系电话、邮箱、公司全称、行业、**获客来源**、**阶段**、优先级、意向预算、负责人、当前待办、备注。

### 2. 对外留资页（获客落地页）

| 项 | 说明 |
| --- | --- |
| 地址 | `https://<隧道域名>/lead.html`（后台「获客中心」有一键复制按钮） |
| 鉴权 | **免登录**（隧道代理对 `/lead.html` 与 `/api/public/*` 单独放行，后台接口仍需口令） |
| 防刷 | 同一 IP 每小时最多 5 条，超限返回 `RATE_LIMITED` |
| 去重 | 同名客户重复提交不新建，而是追加一条跟进记录 |
| 校验 | 公司名称、联系人、联系电话必填；手机号格式校验 |
| 落库 | `is_public=1`、`stage=lead`、`owner=未分配`，并记录来源 IP 供审计 |

落地页本身是完整的营销页：首屏卖点 + 数据背书（2368 点位 / 5 城 / ROI 3.8）、场景优势、四步合作流程、信任背书，移动端已做响应式适配。

### 3. 获客分析

「获客中心」页面提供：客户总数 / 公开留资数 / 整体转化率 / 意向总额四项 KPI，
来源渠道分析（各渠道线索数、已签约数、转化率、意向金额）、
四阶段转化漏斗、近 14 天新增线索柱状图、负责人线索分配表。

### 4. 用 SQL 直接取获客数据

```sql
-- 各渠道获客与转化
SELECT source AS 来源, COUNT(*) AS 线索数,
       SUM(CASE WHEN stage='signed' THEN 1 ELSE 0 END) AS 已签约,
       ROUND(SUM(budget_wan),1) AS 意向金额万
FROM customers GROUP BY source ORDER BY 线索数 DESC;

-- 公开留资进来的线索
SELECT name, contact, phone, created_at FROM customers WHERE is_public=1 ORDER BY id DESC;
```

### 5. 留资页打不开 / 提示"网络异常"怎么排查

留资页有 5 种访问入口，全部已实测可用：

| 入口 | 地址 | 可用性 |
| --- | --- | --- |
| 本机 | `http://127.0.0.1:5003/lead.html` | ✅ |
| 局域网 | `http://<LAN_IP>:5003/lead.html` | ✅ |
| 公网隧道 | `https://<隧道域名>/lead.html` | ✅ |
| 公网 + token | `https://<隧道域名>/lead.html?token=<AUTH_TOKEN>` | ✅ |
| **本地文件** | `file:///.../public/lead.html` | ✅ 已做自动兜底 |

**最常见的坑：直接双击本地文件打开。** 地址栏显示 `file:///...` 时，
页面里的相对路径 `/api/public/lead` 会被解析成 `file:///api/public/lead`，
浏览器根本无法发送，于是报"网络异常"。

现在该页面已能**自愈与自证**：

1. 检测到 `file://` 时，自动依次探测 `127.0.0.1:5003` / `<LAN_IP>:5003` / `localhost:5003`，
   找到可用服务就自动接上并提示"已自动连接后台服务"
2. 都探测不到时，明确告诉你该改用哪个地址访问
3. 提交失败时**显示真实原因**（HTTP 状态码、接口地址、返回内容片段），不再只给一句"网络异常"
4. 支持 `?api=http://主机:5003` 手动指定接口地址

**正确的分享方式**：在后台「获客中心」点「🔗 复制留资链接」，
得到的就是可对外分发的正式地址（而非本地文件路径）。

> 排查命令：
> `node scripts/browser-submit-test.js <留资页地址>`
> 会驱动真实浏览器走完整提交，并打印接口响应状态、网络失败原因、控制台报错。

### 6. 跨域（CORS）策略

| 接口 | CORS | 原因 |
| --- | --- | --- |
| `/api/public/lead`、`/api/health` | 允许 `*` | 留资页可能以 `file://` 打开，需要跨域回连 |
| 其余所有后台接口 | **不下发 CORS 头** | 防止局域网内任意网页读取经营数据；前端是同源请求，不依赖 CORS |

`/api/health` 对带 `Origin` 头的浏览器来源会隐藏数据库文件路径，避免通过任意网页探测服务器目录结构。

## 五之三、今日工作台的"实时化"

工作台头部不再是写死的文案，**问候语、日期、天气、KPI 全部与后端实时同步**。

### 1. 动态问候语

按服务器小时数自动切换，称呼可配置：

| 时段 | 问候语 |
| --- | --- |
| 05:00–11:00 | 早上好 |
| 11:00–13:00 | 中午好 |
| 13:00–18:00 | 下午好 |
| 18:00–23:00 | 晚上好 |
| 23:00–05:00 | 夜深了 |

称呼默认 `Tom`，可用环境变量覆盖：

```bash
OWNER_NAME=张总 node server.js
```

### 2. 动态日期与时钟

- 日期/星期取服务器当天（不再写死 `2026 年 6 月 24 日`）
- 头部时钟**每秒走字**（纯前端，不请求后端）

### 3. 真实天气

后端每 10 分钟拉取一次真实天气（带缓存）：

| 优先级 | 数据源 | 说明 |
| --- | --- | --- |
| 主源 | Open-Meteo | 免 key，返回温度/湿度/风速/最高最低温 |
| 兜底 | wttr.in | 主源失败时自动切换 |
| 降级 | 上次成功值 | 两源都不可用时返回缓存并标记 `stale` |

WMO 天气代码已映射为中文描述 + emoji（晴 ☀️ / 多云 ⛅ / 雷阵雨 ⛈️ 等）。

城市可配置：

```bash
WEATHER_CITY=深圳 WEATHER_LAT=22.5431 WEATHER_LON=114.0579 node server.js
```

### 4. KPI 与数据库实时一致

| 卡片 | 数据来源 |
| --- | --- |
| 今日投放收入 | `revenue_daily` 今日合计，附环比涨跌 |
| 待签约风险(万) | `pending_items` 中待处理合同/点位金额合计 + 项数 |
| 点位覆盖数 | `points` 表实时计数 + 社区单元数 |

### 5. 页面"动起来"的机制

| 机制 | 说明 |
| --- | --- |
| 时钟 | 每 1 秒走字 |
| 数据轮询 | 每 30 秒拉一次 `/api/overview`，问候语/天气/KPI 自动刷新，**无需手动刷新页面** |
| 变化提示 | KPI 数字变化时闪烁一次，配合绿色呼吸灯 |
| 智能启停 | 仅在「今日工作台」页可见时运行，切到其他页面自动停止，不做无谓请求 |

### 6. 演示数据保鲜

演示数据的收入是按灌库当天生成的，**过几天再打开，「今日收入」会变成 ¥0**。
用刷新脚本把日期相关的数据重新对齐到今天：

```bash
node scripts/refresh-demo-data.js            # 刷新近 30 天收入 + 重排到期天数
node scripts/refresh-demo-data.js --status   # 只看状态
node scripts/refresh-demo-data.js --days 60  # 指定天数
```

该脚本**只动 `revenue_daily` 与待确认项的剩余天数**，
不会触碰客户、合同、工单、AI 对话等业务数据。

## 六、罗姐 AI 引擎

`POST /api/ai/chat` 不是关键词拼文案：后端按问题意图路由到 4 个分析函数，
每个结论都由 SQL 聚合实时算出，回答再写入 `ai_messages` 表（刷新页面后对话仍在）。

| 意图 | 触发词 | 数据来源 |
| --- | --- | --- |
| 收入分析 | 收入 / 营收 / 投放金额 | `revenue_daily`（今日 vs 昨日、渠道结构、城市贡献、日均） |
| 风险预警 | 风险 / 预警 / 到期 | `pending_items` + `contracts` + `campaigns` + `points` |
| 点位分析 | 点位 / 覆盖 / 社区 | `points`（2368 条明细的类型/状态/城市分布） |
| ROI 评估 | ROI / 回报率 | `revenue_daily` ÷ `campaigns.spend` |
| 经营总览 | 其它任意问题 | 上述四者汇总 |

问答记录会同时累加 `agents` 表中罗姐 Agent 的调用量。

## 七、部署

### 当前状态：已用 systemd 部署（开机自启 + 崩溃自愈）

```bash
systemctl status pdooh-aic      # 查看状态（active running）
systemctl restart pdooh-aic     # 重启
systemctl stop pdooh-aic        # 停止
journalctl -u pdooh-aic -f      # 实时日志（日志同时写入 data/pdooh.log）
```

服务单元：`/etc/systemd/system/pdooh-aic.service`（仓库内副本 `scripts/pdooh-aic.service`）

- `ExecStart=/home/tom/.local/bin/node /home/tom/deepseek/pdooh-aic/server.js`
  （注意：本机 node 由用户级安装提供，路径是 `/home/tom/.local/bin/node`，**不是** `/usr/bin/node`）
- `Restart=always` + `RestartSec=3`：进程崩溃 3 秒内自动拉起（已实测通过）
- `enabled`：开机自启

### 防火墙（ufw 默认 deny incoming）

```bash
sudo ufw allow from <LAN_CIDR> to any port 5003 proto tcp   # 仅放行局域网
```

### 存在的两种启动方式（不要同时用）

| 方式 | 命令 | 适用场景 |
| --- | --- | --- |
| **systemd（推荐，当前使用）** | `sudo systemctl start pdooh-aic` | 生产常驻、开机自启、崩溃自愈 |
| nohup 脚本 | `./scripts/start.sh start` | 免 root 的临时调试 |

`scripts/start.sh start` 现在会检测 systemd 托管状态并拒绝重复启动，避免端口冲突。

### 网络可达性（重要）

本机是 **WiFi 接入的私网主机**，不是公网服务器：

```
wlan0  <LAN_IP>/24   →  网关 <GATEWAY_IP>  →  ISP NAT（出口 <ISP_EGRESS_IP>）
```

| 访问范围 | 地址 | 状态 |
| --- | --- | --- |
| 本机 | http://127.0.0.1:5003/ | ✅ 可用 |
| 同一局域网（手机/其他电脑） | http://<LAN_IP>:5003/ | ✅ 可用（已放行 ufw） |
| 公网 / 外网 | — | ❌ 需额外一步，见下 |

要外网访问，二选一（都无法在本机单独完成）：

1. **路由器端口映射**：在 <GATEWAY_IP> 路由器后台把外网端口 → `<LAN_IP>:5003`，
   同时确认宽带是公网 IP（若 ISP 大内网则无效）。
2. **内网穿透隧道（免公网 IP，推荐）**：Cloudflare Tunnel / Tailscale / frp，
   只需本机出站连接，无需改路由器。例如 Tailscale：
   `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`，
   之后同账号设备可用 `http://<设备名>:5003/` 直接访问。

### Nginx 反向代理（可选）

仓库外已有 Nginx 占用 8080/8443，如需把本系统挂到 80/443：

```nginx
location / {
    proxy_pass http://127.0.0.1:5003;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

前端为同源请求，反代后无需任何前端改动。

## 七之二、SSH 访问（已启用）

原 `openssh-server` 已安装但处于 `disabled`、22 端口无监听，现已启用并加固：

```bash
systemctl status ssh          # enabled + active
```

加固配置：`/etc/ssh/sshd_config.d/99-pdooh-hardening.conf`

| 项 | 值 | 说明 |
| --- | --- | --- |
| `Port` | 22 | 仅 ufw 放行 `<LAN_CIDR>` 与 `tailscale0` |
| `PasswordAuthentication` | **no** | 密码登录已关闭（实测返回 `Permission denied (publickey)`） |
| `PubkeyAuthentication` | yes | 仅密钥登录 |
| `PermitRootLogin` | no | 禁止 root 直连 |
| `AllowUsers` | tom | 仅允许 tom |

**访问密钥**：私钥在服务端 `/home/tom/.ssh/pdooh_lan_access`（600），
客户端保存同一份私钥后：

```bash
chmod 600 ~/.ssh/pdooh_key
ssh -i ~/.ssh/pdooh_key <USER>@<LAN_IP>          # 局域网
ssh -i ~/.ssh/pdooh_key tom@pdooh-aic           # 经 Tailscale
```

**找回密码登录方式**（万一私钥丢失，本机控制台执行）：

```bash
sudo sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' \
  /etc/ssh/sshd_config.d/99-pdooh-hardening.conf && sudo systemctl restart ssh
```

## 七之三、外网访问：Tailscale 隧道 + Cloudflare 隧道（已部署）

本机在路由器 NAT 之后（`wlan0 <LAN_IP>` → 网关 `<GATEWAY_IP>`，出口 `<ISP_EGRESS_IP>`），无公网 IP。
已部署**两条**外网通道，任选：

### A. Cloudflare 隧道（免账号，已开箱可用）✅ 当前启用

```bash
./scripts/tunnel.sh url        # 打印当前公网地址
./scripts/tunnel.sh creds      # 打印访问账号口令
./scripts/tunnel.sh status     # 查看隧道/代理状态
./scripts/tunnel.sh test       # 公网连通性 + 鉴权自测
./scripts/tunnel.sh restart    # 重启（会换新域名）
```

当前公网地址：**https://<你的隧道域名>.trycloudflare.com**（用 `./scripts/tunnel.sh url` 查询）
（quick tunnel 免账号，**每次重启会换域名**；要固定域名需 Cloudflare 账号 + 自有域名改用 named tunnel，
写法见 `scripts/pdooh-tunnel.service` 底部注释）

访问凭证保存在 `data/tunnel.env`（600 权限）：

| 方式 | 用法 |
| --- | --- |
| 浏览器 | 打开公网地址，弹出登录框输入用户名 `pdooh` + 口令 |
| 免登录链接 | `https://<域名>/?token=<AUTH_TOKEN>`（首次访问会下发 12 小时 Cookie 会话） |
| curl | `curl -u pdooh:<口令> https://<域名>/api/health` |

### 公网入口鉴权架构（重要设计）

```
公网访客 ──HTTPS──▶ Cloudflare 边缘 ──隧道──▶ cloudflared(本机)
                                                   │
                                                   ▼
                                        [tunnel-proxy :5004] ← 强制 Basic Auth / token
                                                   │  校验通过才转发
                                                   ▼
                                        [pdooh-aic :5003] ← 业务应用（无鉴权）
                                                   ▲
局域网/本机/Tailscale ────────────────────────────┘  直接访问，免口令
```

为什么需要这一层：隧道回源连接来自 `127.0.0.1`，应用**无法**据此区分公网访客与局域网访客；
而 ufw 已阻断公网直连 5003。因此把"公网入口鉴权"独立成 `tunnel-proxy.js`，边界最清晰：

- ufw `deny incoming` 仍然生效 → 公网**只能**走隧道进来，无法直连 5003/22
- 局域网与 Tailscale 访问**完全不受影响**，无需口令
- `?token=` 首次访问会下发 `HttpOnly` Cookie —— 因为 `<script src="/app.js">` 这类子资源
  不携带 query string，仅靠 URL token 会导致子资源 401、浏览器弹出登录框卡住页面

### B. Tailscale 组网（私密，需你在浏览器授权一次）

```bash
tailscale status              # 查看组网状态（当前: Logged out）
tailscale up --hostname=pdooh-aic   # 输出授权链接，浏览器点一次即可
```

授权后，同账号设备可直接访问 `http://pdooh-aic:5003/`，且不经公网。
服务已 `enabled`、ufw 已放行 `tailscale0` 网卡，只差浏览器授权这一步。

> 遗留问题：apt 有个无关的坏包 `baidunetdisk`（状态为需重装），会让 `apt install` 整体报错。
> Tailscale 与 cloudflared 均用 `apt-get download` + `dpkg -i` 绕过。
> 清理命令：`sudo dpkg --remove --force-remove-reinstreq baidunetdisk`

## 七之四、四个服务的 systemd 管理

| 服务 | 作用 | 状态 |
| --- | --- | --- |
| `pdooh-aic` | 业务应用（前端 + API + SQLite） | enabled / active |
| `pdooh-proxy` | 公网入口鉴权代理 (:5004) | enabled / active |
| `pdooh-tunnel` | Cloudflare 隧道 | enabled / active |
| `ssh` | SSH 服务（仅密钥） | enabled / active |

```bash
sudo systemctl status  pdooh-aic pdooh-proxy pdooh-tunnel
sudo systemctl restart pdooh-proxy pdooh-tunnel    # 换了 token 或要换域名时
sudo journalctl -u pdooh-aic -f
```

## 八、验证

```bash
node scripts/verify.js --reset            # 116 项断言（推荐：先重灌种子数据，完全确定性）
node scripts/verify.js                    # 不重置，直接打当前数据
node scripts/verify.js http://ip:5003     # 指定地址
```

验证内容（14 组共 116 项）：16 模块数据结构、**在 Node 沙箱中真实执行前端 15 个页面渲染函数**、
5 类 AI 问答、7 项写操作落库、SQL 控制台只读校验（拒绝 `DELETE` 与多语句，且自带 `LIMIT`
的语句不被破坏）、分析接口、CSV 导出、静态资源可达性、**公网鉴权代理的 401/200/Cookie 会话**。

`--reset` 会直接用 `node:sqlite` 重灌 `sql/seed.sql`，因此脚本可反复运行且结果一致
（已验证连续运行结果一致）。想要干净数据但不跑测试：

```bash
# systemd 托管下重建数据库
sudo systemctl stop pdooh-aic
./scripts/start.sh init-db          # 或用 node 直接执行 sql/seed.sql
sudo systemctl start pdooh-aic
```

> 注意：`./scripts/start.sh stop` 只管理 nohup 方式启动的实例；systemd 托管时请用 `systemctl`。

## 八之二、开发过程中修复的真实缺陷

| # | 缺陷 | 影响 | 修复 |
| --- | --- | --- | --- |
| 1 | SQL 控制台对自带 `LIMIT` 的语句拼接 `LIMIT 3 LIMIT 200` | 语法错误，查询失败 | 改为外层包查询 `SELECT * FROM (...) LIMIT 200` |
| 2 | `seed.sql` 的 DELETE 清单漏了 `cities` 表 | 任何重灌都撞 `UNIQUE constraint failed`，事务回滚并**留下悬挂锁**，导致后续写入全部 `database is locked` | 补齐 `DELETE FROM cities` |
| 3 | 表用 `AUTOINCREMENT`，重灌后自增游标不回退 | 客户等主键 id 漂移成 11 起，按 id 引用的接口失效 | 重灌时 `DELETE FROM sqlite_sequence` 重置游标 |
| 4 | `node:sqlite` 默认 `busy_timeout = 0` | 任何外部连接持写锁时，服务写入立即 `SQLITE_BUSY` | 连接建立时 `PRAGMA busy_timeout = 5000` |
| 5 | 隧道 `?token=` 只作用于首页 | `<script src="/app.js">` 不带 query → 401 → 浏览器弹登录框，页面卡死 | token 命中后下发 `HttpOnly` Cookie 维持会话 |
| 6 | 鉴权代理 `WWW-Authenticate` 头写了中文 realm | HTTP 头仅允许 latin-1，抛 `ERR_INVALID_CHAR`，401 响应直接崩 | realm 改为 ASCII |
| 7 | systemd unit 写死 `/usr/bin/node` | 本机 node 在 `/home/tom/.local/bin/`，服务 `status=203/EXEC` 起不来 | 改为绝对路径 `/home/tom/.local/bin/node` |
| 8 | `migrate()` 在 `const q` 声明前被调用 | TDZ 报错 `Cannot access 'q' before initialization`，服务完全起不来 | 把调用移到查询封装之后 |
| 9 | SQLite `ALTER TABLE ADD COLUMN` 不接受非常量默认值 | `DEFAULT (datetime('now'))` 会导致迁移失败 | 时间戳列先 `DEFAULT ''` 建列，再 `UPDATE` 回填 |
| 10 | 留资频控把校验失败/重复提交也计入额度 | 用户填错两次就被自己的额度挡住；连续运行测试必失败 | 改为"只统计成功入库"，校验失败不消耗额度 |
| 11 | 隧道代理直接透传 `x-forwarded-for` | 访客可伪造该头轮换 IP，绕过留资防刷 | 用 Cloudflare 边缘注入的 `cf-connecting-ip` 覆盖之 |
| 12 | 留资页被 `file://` 方式打开时无法提交 | 相对路径解析成 `file:///api/...`，fetch 直接失败，只报笼统的"网络异常" | 自动探测可用服务地址 + 显示真实错误原因 + 支持 `?api=` 覆盖 |
| 13 | 所有接口一律下发 `Access-Control-Allow-Origin: *` | 局域网内任意网页都能读取经营数据；`/api/health` 还会泄露服务器文件路径 | 仅公开接口允许跨域，后台接口不下发 CORS 头，health 对浏览器来源隐藏路径 |

## 八之三、克隆到其他机器的注意事项

仓库已排除运行时数据（`data/` 下有数据库、日志、**公网访问凭证**），克隆后需要：

```bash
git clone <repo> && cd pdooh-aic

# 1. 数据库会自动初始化（首次启动时执行 sql/schema.sql + sql/seed.sql）
#    也可手动重建：./scripts/start.sh init-db

# 2. 隧道凭证需重新生成（仓库里没有）
cp .env.example data/tunnel.env
chmod 600 data/tunnel.env
#    然后修改 AUTH_PASS / AUTH_TOKEN 为自己的强口令

# 3. 启动（免 root，nohup 方式）
./scripts/start.sh start
```

需要改成本机路径的地方（本仓库按当前部署机器硬编码）：

| 文件 | 需要修改 |
| --- | --- |
| `scripts/pdooh-aic.service` | `ExecStart` 的 node 路径与项目路径 |
| `scripts/pdooh-proxy.service` | 同上 + `EnvironmentFile` 路径 |
| `scripts/pdooh-tunnel.service` | `ExecStart` 的 cloudflared 路径 |

或直接跳过 systemd，用 `./scripts/start.sh` 启动。

## 九、技术选型说明

- **零第三方依赖**：只用 Node 内置 `node:http` + `node:sqlite`（Node 22.5+ 内置），无需 `npm install`，离线可跑。
- **SQLite 而非 MySQL/PG**：本机 MySQL、PostgreSQL 服务均未启动且无 root 权限；SQLite 单文件、WAL 模式，
  支持完整 SQL（含窗口函数、递归 CTE），种子数据里的 2368 条点位就是用递归 CTE 生成的，随时可平滑迁移到 MySQL。
- **同源部署**：前端不再硬编码 `http://47.253.159.62:5002`，改为同源 `/api/*`，避免跨域与后端地址漂移。
