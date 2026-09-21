-- ============================================================
-- pDOOH AI 经营决策中心 · SQL 数据调取示例集
-- 数据库: SQLite  data/pdooh.db
-- 用法:   sqlite3 -header -column data/pdooh.db < sql/queries.sql
-- 说明:   后端 server.js 中的每个接口都对应这里的同类查询，
--         也可在前端「数据连接中心 → 🔎 SQL 查询控制台」中直接执行。
-- ============================================================

.print '\n=== 01 今日工作台：待办统计 ==='
SELECT label AS 指标, value AS 数值, trend AS 趋势 FROM dashboard_stats ORDER BY sort_order;

.print '\n=== 02 待确认：审批清单与金额汇总 ==='
SELECT category AS 类别, COUNT(*) AS 条数, ROUND(SUM(amount_num),1) AS 金额万元
FROM pending_items WHERE status='pending' GROUP BY category;

.print '\n=== 03 经营决策 KPI：今日 vs 昨日收入 ==='
SELECT
    ROUND(SUM(CASE WHEN stat_date = date('now','localtime') THEN amount END), 2)             AS 今日收入,
    ROUND(SUM(CASE WHEN stat_date = date('now','localtime','-1 day') THEN amount END), 2)   AS 昨日收入,
    ROUND(100.0 * (SUM(CASE WHEN stat_date = date('now','localtime') THEN amount END) -
                   SUM(CASE WHEN stat_date = date('now','localtime','-1 day') THEN amount END)) /
          NULLIF(SUM(CASE WHEN stat_date = date('now','localtime','-1 day') THEN amount END), 0), 2) AS 环比增幅百分比
FROM revenue_daily;

.print '\n=== 04 投放作战地图：城市点位分布（2368 个点位明细聚合） ==='
SELECT c.name AS 城市,
       COUNT(p.id) AS 点位数,
       SUM(CASE WHEN p.point_type='智能屏'   THEN 1 ELSE 0 END) AS 智能屏,
       SUM(CASE WHEN p.point_type='门禁'     THEN 1 ELSE 0 END) AS 门禁,
       SUM(CASE WHEN p.point_type='道闸'     THEN 1 ELSE 0 END) AS 道闸,
       SUM(CASE WHEN p.point_type='电梯框架' THEN 1 ELSE 0 END) AS 电梯框架
FROM cities c JOIN points p ON p.city_id = c.id
GROUP BY c.id ORDER BY 点位数 DESC;

.print '\n=== 05 客户待跟进：按紧急度排序 ==='
SELECT name AS 客户, contact AS 联系人, task AS 待办, priority AS 优先级, follow_count AS 已跟进次数
FROM customers ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END;

.print '\n=== 06 销售作战卡：漏斗转化率 ==='
SELECT name AS 阶段, value AS 数量, percent AS 占比, detail AS 备注 FROM sales_funnel ORDER BY sort_order;

.print '\n=== 07 投放进度：预算执行率 ==='
SELECT name AS 计划, client AS 客户, percent AS 进度, budget AS 预算万, spend AS 已执行万,
       ROUND(spend / NULLIF(budget,0) * 100, 1) AS 预算执行率
FROM campaigns ORDER BY 进度 DESC;

.print '\n=== 08 社区看板：单社区产出 ==='
SELECT name AS 社区, people AS 月人流, orders AS 订单数, status_text AS 状态 FROM communities ORDER BY orders DESC;

.print '\n=== 09 合同兑现：履约进度与已兑现金额 ==='
SELECT code AS 合同号, client AS 客户, amount AS 金额, execution AS 履约进度,
       ROUND(amount_num * execution / 100.0, 1) AS 已兑现万元, status_text AS 状态
FROM contracts ORDER BY execution DESC;

.print '\n=== 10 素材库：按类型统计 ==='
SELECT type AS 类型, COUNT(*) AS 数量, GROUP_CONCAT(name, ' | ') AS 素材列表 FROM creatives GROUP BY type;

.print '\n=== 11 智能体：调用量排名 ==='
SELECT name AS 智能体, endpoint AS 接口, calls AS 累计调用, qps AS 当前QPS, status AS 状态 FROM agents ORDER BY calls DESC;

.print '\n=== 12 客服：工单看板 ==='
SELECT status AS 状态, urgency AS 紧急度, COUNT(*) AS 数量 FROM tickets GROUP BY status, urgency ORDER BY 数量 DESC;

.print '\n=== 13 知识库：浏览量 TOP5 ==='
SELECT title AS 标题, category AS 分类, views AS 浏览量, tags AS 标签 FROM knowledge_docs ORDER BY views DESC LIMIT 5;

.print '\n=== 14 产品研发：按优先级投票排序 ==='
SELECT title AS 需求, priority AS 优先级, votes AS 票数, status_text AS 状态 FROM rd_requirements ORDER BY votes DESC LIMIT 5;

.print '\n=== 15 每日日报：完成项统计 ==='
SELECT d.author AS 作者, d.dept AS 部门, d.title AS 标题,
       SUM(CASE WHEN i.kind='done' THEN 1 ELSE 0 END) AS 完成条数,
       SUM(CASE WHEN i.kind='plan' THEN 1 ELSE 0 END) AS 计划条数
FROM daily_reports d JOIN daily_report_items i ON i.report_id = d.id GROUP BY d.id ORDER BY d.id;

.print '\n=== 16 数据连接：数据源健康度 ==='
SELECT name AS 数据源, type AS 类型, last_sync AS 最后同步, latency AS 延迟, qps AS QPS, sync_count AS 同步次数
FROM data_sources ORDER BY latency_ms DESC;

.print '\n=== 收入分析：近 7 天趋势 ==='
SELECT stat_date AS 日期, ROUND(SUM(amount),2) AS 收入, SUM(orders) AS 订单数
FROM revenue_daily WHERE stat_date >= date('now','localtime','-6 day')
GROUP BY stat_date ORDER BY stat_date;

.print '\n=== 收入分析：渠道结构（近 30 天） ==='
SELECT channel AS 渠道, ROUND(SUM(amount),2) AS 收入,
       ROUND(SUM(amount) * 100.0 / (SELECT SUM(amount) FROM revenue_daily WHERE stat_date >= date('now','localtime','-29 day')), 2) AS 占比
FROM revenue_daily WHERE stat_date >= date('now','localtime','-29 day')
GROUP BY channel ORDER BY 收入 DESC;

.print '\n=== ROI 计算：30 天收入 / 投放成本 ==='
SELECT (SELECT ROUND(SUM(amount),2) FROM revenue_daily WHERE stat_date >= date('now','localtime','-29 day')) AS 收入,
       (SELECT ROUND(SUM(spend) * 10000, 2) FROM campaigns) AS 成本,
       ROUND(
         (SELECT SUM(amount) FROM revenue_daily WHERE stat_date >= date('now','localtime','-29 day')) /
         NULLIF((SELECT SUM(spend) * 10000 FROM campaigns), 0), 2) AS ROI指数;

.print '\n=== 风险分析：待确认项按剩余天数升序 ==='
SELECT code AS 编号, name AS 事项, client AS 客户, amount AS 金额, days AS 剩余天数
FROM pending_items WHERE status='pending' ORDER BY days LIMIT 8;

.print '\n=== 点位分析：状态分布与平均收入 ==='
SELECT status AS 状态, COUNT(*) AS 数量, ROUND(AVG(revenue),2) AS 平均收入, SUM(monthly_reach) AS 月触达
FROM points GROUP BY status ORDER BY 数量 DESC;

.print '\n=== 运营审计：最近操作日志 ==='
SELECT action AS 动作, target AS 对象, detail AS 详情, created_at AS 时间
FROM activity_log ORDER BY id DESC LIMIT 10;
