-- ============================================================
-- pDOOH AI 经营决策中心 · 种子数据
-- 数据来源: https://duckwolf.cn/aic.html 全站 16 模块
-- 执行方式: sqlite3 data/pdooh.db < sql/seed.sql
-- ============================================================

BEGIN;

DELETE FROM dashboard_stats; DELETE FROM schedule_items; DELETE FROM reminders; DELETE FROM team_members;
DELETE FROM pending_items; DELETE FROM kpi_metrics; DELETE FROM points; DELETE FROM map_dots; DELETE FROM map_legend;
DELETE FROM customers; DELETE FROM follow_logs; DELETE FROM sales_funnel; DELETE FROM sales_ranking;
DELETE FROM campaigns; DELETE FROM communities; DELETE FROM contracts; DELETE FROM creatives;
DELETE FROM agents; DELETE FROM tickets; DELETE FROM knowledge_docs; DELETE FROM rd_requirements;
DELETE FROM roadmap; DELETE FROM daily_report_items; DELETE FROM daily_reports;
DELETE FROM data_sources; DELETE FROM revenue_daily; DELETE FROM activity_log;
-- AI 对话表必须先清后插（否则固定 id=1 会主键冲突导致整个事务回滚）
DELETE FROM ai_messages; DELETE FROM ai_conversations;
-- cities 必须一并清空，且放在 points / revenue_daily / map_dots 之后（存在外键引用）
DELETE FROM cities;
-- 重置 AUTOINCREMENT 游标：否则重灌后自增主键会从上次的最大值继续（客户 id 变成 11 起），
-- 导致任何按 id 引用的数据/接口失效。清空后 id 始终稳定为 1..N。
DELETE FROM sqlite_sequence;

-- ---------- 01 今日工作台 ----------
INSERT INTO dashboard_stats (label, value, icon, color, trend, sort_order) VALUES
 ('待办任务', '14', '📋', 'warning', '+3 今日新增', 1),
 ('已完成',   '8',  '✅', 'success', '完成率 64%',  2),
 ('今日会议', '5',  '🎯', 'info',    '下一场 15:00', 3),
 ('未读邮件', '23', '📧', 'primary', '8 封加急',    4);

INSERT INTO schedule_items (time, title, type, icon, sort_order) VALUES
 ('09:30', '团队晨会',                '会议', '🎯', 1),
 ('10:30', '可口可乐 Q3 投放方案评审', '客户', '🤝', 2),
 ('12:00', '湾仔码头合同续签',         '合同', '📝', 3),
 ('14:00', '王老吉点位巡检',           '巡检', '📍', 4),
 ('15:00', '罗姐 AI 周会',             '内部', '🤖', 5),
 ('16:30', '宝马华南区提案',           '客户', '🤝', 6),
 ('18:00', '日报提交',                 '内部', '📝', 7);

INSERT INTO reminders (icon, text, color, sort_order) VALUES
 ('⚠️', '万达智能屏合同 7 天后到期，金额 ¥15万', 'warning', 1),
 ('🔥', '农夫山泉紧急加投需求已到，待回复',       'danger',  2),
 ('💡', '罗姐建议：广州珠江新城 ROI 提升 18%',    'info',    3);

INSERT INTO team_members (name, avatar, status, task, sort_order) VALUES
 ('小李', '李', 'online',  '客户拜访', 1),
 ('小王', '王', 'online',  '点位巡检', 2),
 ('小张', '张', 'busy',    '方案撰写', 3),
 ('小赵', '赵', 'online',  '客户回访', 4),
 ('小陈', '陈', 'offline', '休',       5),
 ('小刘', '刘', 'online',  '素材制作', 6);

-- ---------- 02 待确认 ----------
INSERT INTO pending_items (code, category, name, client, amount, amount_num, days, badge, badge_text) VALUES
 ('SP-2026-0624-01', 'spot',     '广州珠江新城·高德置地智能屏',   '宝马',     '¥8.5万', 8.5,  3,  'danger',  '紧急'),
 ('SP-2026-0624-02', 'spot',     '深圳南山·腾讯大厦电梯框架',     '可口可乐', '¥3.2万', 3.2,  5,  'warning', '待审'),
 ('SP-2026-0624-03', 'spot',     '佛山顺德·碧桂园门禁',           '海天',     '¥2.8万', 2.8,  7,  'warning', '待审'),
 ('SP-2026-0624-04', 'spot',     '东莞松山湖·华为欧洲小镇道闸',   '立白',     '¥4.5万', 4.5,  10, 'info',    '正常'),
 ('HT-2026-Q2-015',  'contract', '王老吉 6 月份广州线下投放合同', '王老吉',   '¥28万',  28.0, 2,  'danger',  '即将到期'),
 ('HT-2026-Q2-022',  'contract', '农夫山泉华南区年度框架协议',     '农夫山泉', '¥120万', 120.0, 4, 'warning', '待签字'),
 ('HT-2026-Q2-028',  'contract', '宝马 Q3 品牌曝光补充协议',       '宝马',     '¥45万',  45.0, 6,  'info',    '法务中'),
 ('HT-2026-Q2-031',  'contract', '湾仔码头冷冻食品季度合作',       '湾仔码头', '¥18万',  18.0, 8,  'info',    '待审批'),
 ('CR-AI-0624-01',   'creative', '奔驰 GLE 新车上市 30秒视频',     '奔驰',     '¥1.2万', 1.2,  1,  'danger',  '紧急'),
 ('CR-AI-0624-02',   'creative', '立白天然洗衣液夏季海报',         '立白',     '¥0.8万', 0.8,  3,  'warning', '待审'),
 ('CR-AI-0624-03',   'creative', '黑人牙膏薄荷新品 KV',            '黑人牙膏', '¥0.6万', 0.6,  5,  'info',    '待审');

-- ---------- 03 经营决策 KPI ----------
INSERT INTO kpi_metrics (key, icon, value, label, detail, trend, trend_dir, color, sort_order) VALUES
 ('revenue', '💰', '¥12.6万', '今日投放收入', '较昨日增长 ¥1.4万', '↑ 12.5%', 'positive', 'success', 1),
 ('risk',    '⚠️', '¥38.4万', '待签约风险',   '3个合同即将到期',   '↑ 8.3%',  'negative', 'warning', 2),
 ('points',  '📍', '2,368',   '点位覆盖数',   '覆盖 126 个社区',   '↑ 156',   'positive', 'info',    3),
 ('roi',     '📊', '3.8',     'ROI指数',      '行业平均 2.9',      '↑ 0.3',   'positive', 'primary', 4);

-- ---------- 04 投放作战地图 ----------
INSERT INTO cities (id, name, smart_screen, door, gate, elevator, hot, x, y, sort_order) VALUES
 ('gz', '广州', 312, 268, 156, 120, 8,  32, 45, 1),
 ('sz', '深圳', 286, 224, 132, 100, 12, 66, 62, 2),
 ('fs', '佛山', 124, 98,  64,  40,  3,  34, 28, 3),
 ('dg', '东莞', 98,  86,  52,  32,  2,  52, 46, 4),
 ('zh', '珠海', 56,  66,  22,  32,  1,  74, 82, 5);

-- 点位明细：按各城市 4 类点位配额递归生成，总计 2368 条
WITH RECURSIVE seq(n) AS (
    SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 400
),
city_types AS (
    SELECT id AS city_id, '智能屏'   AS point_type, smart_screen AS cnt FROM cities
    UNION ALL SELECT id, '门禁',     door     FROM cities
    UNION ALL SELECT id, '道闸',     gate     FROM cities
    UNION ALL SELECT id, '电梯框架', elevator FROM cities
)
INSERT INTO points (code, city_id, community, point_type, status, screens, monthly_reach, revenue)
SELECT
    printf('PT-%s-%s-%04d', ct.city_id, substr(ct.point_type, 1, 2), seq.n),
    ct.city_id,
    (SELECT c.name FROM cities c WHERE c.id = ct.city_id) || '·' ||
        (CASE ((seq.n * 7 + length(ct.point_type)) % 12)
            WHEN 0 THEN '珠江新城花园' WHEN 1 THEN '万科城市花园' WHEN 2 THEN '碧桂园凤凰城'
            WHEN 3 THEN '恒大御景湾'   WHEN 4 THEN '保利香槟国际' WHEN 5 THEN '万达广场社区'
            WHEN 6 THEN '中海寰宇天下' WHEN 7 THEN '招商雍景湾'   WHEN 8 THEN '华润幸福里'
            WHEN 9 THEN '龙湖春江天境' WHEN 10 THEN '金地格林小城' ELSE '雅居乐花园' END) ||
        '-' || printf('%02d', (seq.n % 30) + 1) || '栋',
    ct.point_type,
    CASE WHEN seq.n % 19 = 0 THEN 'abnormal'
         WHEN seq.n % 5  = 0 THEN 'hot'
         WHEN seq.n % 3  = 0 THEN 'medium'
         ELSE 'online' END,
    CASE ct.point_type WHEN '智能屏' THEN 2 WHEN '电梯框架' THEN 3 ELSE 1 END,
    6000 + ((seq.n * 137) % 14000),
    ROUND(1200 + ((seq.n * 313) % 4800) / 10.0, 2)
FROM city_types ct
JOIN seq ON seq.n <= ct.cnt;

INSERT INTO map_dots (city_id, x, y, count, type) VALUES
 ('gz', 28, 38, 28, 'success'), ('gz', 35, 45, 42, 'primary'), ('gz', 22, 52, 18, 'warning'),
 ('sz', 65, 60, 56, 'primary'), ('sz', 72, 65, 34, 'success'), ('sz', 60, 70, 22, 'warning'),
 ('fs', 30, 25, 24, 'success'), ('fs', 38, 30, 16, 'primary'),
 ('dg', 50, 50, 28, 'primary'), ('dg', 55, 42, 18, 'warning'),
 ('zh', 70, 85, 12, 'danger'),  ('zh', 78, 80, 8,  'success');

INSERT INTO map_legend (label, color, count, sort_order) VALUES
 ('在线',   'primary', 2184, 1),
 ('高活跃', 'success', 1062, 2),
 ('中等',   'warning', 988,  3),
 ('异常',   'danger',  134,  4);

-- ---------- 05 客户待跟进 / 获客 CRM ----------
INSERT INTO customers (name, contact, avatar, last_touch, task, priority, status,
                       phone, company, industry, email, source, stage, budget_wan, owner, note, created_at) VALUES
 ('王老吉',   '李经理', '王', '2小时前',    '询问 Q3 投放续签方案',     'high',   'urgent',
  '138-0011-2233', '广州王老吉大健康产业有限公司', '快消饮料', 'li@gz-wlj.com',   '转介绍',   'proposal', 28,  '小李', '历史履约良好，续签概率高', datetime('now','localtime','-46 day')),
 ('宝马',     '张总监', '宝', '4小时前',    '希望增加珠江新城点位曝光', 'high',   'follow',
  '139-2233-4455', '宝马（中国）汽车贸易有限公司', '汽车',     'zhang@bmw.cn',    '展会获客', 'interest', 86,  '小李', '华南区品牌曝光主力客户', datetime('now','localtime','-38 day')),
 ('可口可乐', '王经理', '可', '昨天',       '夏季活动方案确认',         'medium', 'pending',
  '137-3344-5566', '中粮可口可乐饮料（广东）有限公司', '快消饮料', 'wang@cocacola.cn', '官网留资', 'proposal', 45, '小王', '夏季促销组合投放', datetime('now','localtime','-31 day')),
 ('奔驰',     '陈主管', '奔', '昨天',       '新车上市素材反馈',         'medium', 'review',
  '136-4455-6677', '北京奔驰汽车有限公司', '汽车',     'chen@benz.cn',    '展会获客', 'interest', 52,  '小张', 'GLE 上市推广', datetime('now','localtime','-24 day')),
 ('农夫山泉', '刘总',   '农', '今天 09:12', '紧急加投需求',             'urgent', 'urgent',
  '135-5566-7788', '农夫山泉股份有限公司', '快消饮料', 'liu@nfsq.com',    '电话开发', 'interest', 120, '小李', '年度框架协议谈判中', datetime('now','localtime','-18 day')),
 ('立白',     '赵经理', '立', '今天 10:30', '夏季新品发布合作',         'medium', 'follow',
  '134-6677-8899', '广州立白企业集团有限公司', '日化',  'zhao@liby.com.cn', '地推拜访', 'proposal', 32, '小赵', '夏季新品发布', datetime('now','localtime','-15 day')),
 ('湾仔码头', '黄经理', '湾', '今天 11:45', 'Q3 合同续签确认',          'high',   'pending',
  '133-7788-9900', '通用磨坊（中国）投资有限公司', '冷冻食品', 'huang@wanchai.com', '转介绍', 'signed', 18, '小李', 'Q3 已续签', datetime('now','localtime','-12 day')),
 ('海天',     '钱总',   '海', '今天 13:20', '酱油新品推广点位咨询',     'medium', 'follow',
  '132-8899-0011', '佛山市海天调味食品股份有限公司', '调味品', 'qian@haitian.com', '官网留资', 'lead',   24, '小王', '新线索，待首访', datetime('now','localtime','-9 day')),
 ('黑人牙膏', '孙经理', '黑', '今天 14:08', 'KV 素材审批反馈',          'low',    'review',
  '131-9900-1122', '好来化工（中山）有限公司', '日化',  'sun@darlie.com',  '官网留资', 'lead',   6,  '小刘', '素材已交付待反馈', datetime('now','localtime','-6 day')),
 ('蒙牛',     '周主管', '蒙', '今天 14:30', '华南区夏季推广意向',       'high',   'new',
  '130-1122-3344', '蒙牛乳业（集团）股份有限公司', '乳制品', 'zhou@mengniu.com', '官网留资', 'lead',   60, '未分配', '今日新线索，尚未分配负责人', datetime('now','localtime','-1 day'));

-- 跟进记录（含阶段推进历史，供客户详情与获客转化分析）
INSERT INTO follow_logs (customer_id, kind, note, created_at) VALUES
 (1, 'create', '转介绍线索录入：王老吉 Q3 续签意向', datetime('now','localtime','-46 day')),
 (1, 'follow', '已联系 李经理，沟通事项：询问 Q3 投放续签方案', datetime('now','localtime','-20 day')),
 (1, 'stage',  '阶段推进：线索 → 方案（已提交 Q3 续签方案）',   datetime('now','localtime','-8 day')),
 (2, 'create', '展会获客：宝马华南区沟通会留下名片', datetime('now','localtime','-38 day')),
 (2, 'stage',  '阶段推进：线索 → 意向（张总监明确增加珠江新城点位）', datetime('now','localtime','-11 day')),
 (3, 'create', '官网留资：夏季活动方案咨询', datetime('now','localtime','-31 day')),
 (5, 'create', '电话开发：刘总咨询华南区加投', datetime('now','localtime','-18 day')),
 (7, 'stage',  '阶段推进：方案 → 签约（Q3 合同已签署）', datetime('now','localtime','-5 day')),
 (8, 'create', '官网留资：酱油新品点位咨询', datetime('now','localtime','-9 day')),
 (10,'create', '官网留资：华南区夏季推广意向（待分配）', datetime('now','localtime','-1 day'));

-- ---------- 06 销售作战卡 ----------
INSERT INTO sales_funnel (name, value, percent, detail, sort_order) VALUES
 ('线索', 186, '100%',  '本周新增 47 条',   1),
 ('意向', 92,  '49.5%', '已触达 124 家客户', 2),
 ('方案', 48,  '25.8%', 'POC 进行中',       3),
 ('签约', 23,  '12.4%', '本月目标 30 单',   4);

INSERT INTO sales_ranking (name, avatar, deals, amount, amount_num, rate, rate_num, color) VALUES
 ('小李', '李', 18, '¥86.5万', 86.5, '120%', 120, 'success'),
 ('小王', '王', 15, '¥72.3万', 72.3, '108%', 108, 'success'),
 ('小张', '张', 13, '¥64.8万', 64.8, '96%',  96,  'warning'),
 ('小赵', '赵', 11, '¥58.2万', 58.2, '89%',  89,  'warning'),
 ('小陈', '陈', 9,  '¥42.1万', 42.1, '72%',  72,  'danger');

-- ---------- 07 全面投放进度 ----------
INSERT INTO campaigns (name, client, start_date, end_date, percent, status, status_text, budget, spend) VALUES
 ('宝马 Q3 品牌曝光计划',   '宝马',     '06-10', '07-10', 68, 'success', '进展顺利', 86, 58.5),
 ('可口可乐夏季促销活动',   '可口可乐', '06-15', '07-15', 52, 'success', '正常',     45, 23.4),
 ('王老吉 Q2 线下投放',     '王老吉',   '05-20', '07-20', 82, 'success', '接近完成', 28, 23.0),
 ('农夫山泉华南区加投',     '农夫山泉', '06-20', '07-05', 35, 'warning', '需加速',   120, 42.0),
 ('奔驰新车上市推广',       '奔驰',     '06-22', '07-22', 18, 'warning', '启动阶段', 52, 9.4),
 ('立白夏季新品发布',       '立白',     '06-01', '06-30', 95, 'danger',  '本周收尾', 32, 30.4);

-- ---------- 08 社区看板 ----------
INSERT INTO communities (name, address, point_type, people, people_num, orders, status, status_text) VALUES
 ('万达·广州番禺广场',   '广州番禺区番禺大道北383号', '智能屏 + 电梯框架', '28,500人/月', 28500, 42, 'success', '运营良好'),
 ('万科·深圳前海国际',   '深圳南山区前海路88号',      '门禁 + 道闸',       '32,000人/月', 32000, 38, 'success', '运营良好'),
 ('碧桂园·佛山顺德花园', '佛山顺德区大良街道',        '智能屏 + 门禁',     '24,600人/月', 24600, 28, 'warning', '点位到期'),
 ('恒大·东莞御景湾',     '东莞松山湖高新区',          '电梯框架 + 道闸',   '18,200人/月', 18200, 16, 'danger',  '续签中');

-- ---------- 09 合同兑现 ----------
INSERT INTO contracts (code, client, amount, amount_num, start_date, end_date, execution, status, status_text) VALUES
 ('HT-2026-Q2-015', '王老吉',   '¥28万',  28.0,  '04-01', '06-30', 82, 'success', '履约良好'),
 ('HT-2026-Q2-018', '可口可乐', '¥45万',  45.0,  '04-15', '07-15', 52, 'success', '正常'),
 ('HT-2026-Q2-022', '农夫山泉', '¥120万', 120.0, '05-01', '12-31', 35, 'primary', '执行中'),
 ('HT-2026-Q2-025', '宝马',     '¥86万',  86.0,  '05-10', '08-10', 68, 'success', '进展顺利'),
 ('HT-2026-Q2-028', '奔驰',     '¥52万',  52.0,  '06-01', '09-01', 18, 'primary', '启动阶段'),
 ('HT-2026-Q2-031', '湾仔码头', '¥18万',  18.0,  '06-01', '08-31', 42, 'success', '正常'),
 ('HT-2026-Q2-035', '立白',     '¥32万',  32.0,  '06-01', '06-30', 95, 'warning', '本周收尾'),
 ('HT-2026-Q2-038', '海天',     '¥24万',  24.0,  '06-15', '09-15', 25, 'primary', '执行中');

-- ---------- 10 AI 素材生产中心 ----------
INSERT INTO creatives (name, type, placement, produce_date, gradient, icon, client, status) VALUES
 ('宝马 X5 夏季试驾活动主视觉',   'KV',   '智能屏 · 30秒', '06-24', '',          '🚗', '宝马',     'done'),
 ('可口可乐夏日促销 15秒短视频',  '视频', '智能屏 · 15秒', '06-24', 'gradient-2', '🥤', '可口可乐', 'done'),
 ('王老吉夏季海报',               '海报', '电梯框架',      '06-23', 'gradient-3', '🍵', '王老吉',   'done'),
 ('农夫山泉天然水系列 KV',        'KV',   '门禁屏',        '06-23', 'gradient-4', '💧', '农夫山泉', 'done'),
 ('奔驰 GLE 新车上市 30秒视频',   '视频', '智能屏 · 30秒', '06-22', 'gradient-2', '🚙', '奔驰',     'done'),
 ('立白天然洗衣液 KV 套图',       'KV',   '电梯框架',      '06-22', '',          '🧴', '立白',     'done'),
 ('湾仔码头冷冻食品 GIF 海报',    'GIF',  '门禁屏',        '06-21', 'gradient-3', '🥟', '湾仔码头', 'done'),
 ('黑人牙膏薄荷新品 KV',          'KV',   '智能屏 · 15秒', '06-21', 'gradient-4', '🦷', '黑人牙膏', 'done');

-- ---------- 11 智能体交付中心 ----------
INSERT INTO agents (name, endpoint, calls, qps, status, doc) VALUES
 ('Tom Agent · 投放策略大脑', '/api/v1/agent/tom/strategy',       18642, 128, 'online', 'Tom-Strategy-v3.2.md'),
 ('ROI 计算智能体',           '/api/v1/agent/roi/calc',           9284,  56,  'online', 'ROI-Calc-v2.1.md'),
 ('竞品监控智能体',           '/api/v1/agent/competitor/monitor', 4218,  24,  'busy',   'Competitor-v1.8.md'),
 ('罗姐 · 户外广告AI顾问',    '/api/v1/agent/luojie/chat',        28456, 186, 'online', 'Luojie-v4.0.md');

-- ---------- 12 客服服务中心 ----------
INSERT INTO tickets (code, client, type, urgency, status, status_text, handler, created_at) VALUES
 ('TK-2026-0624-01', '宝马 · 张总监',     '点位故障', 'high',   'pending',    '处理中',   '小王',   '今天 13:48'),
 ('TK-2026-0624-02', '农夫山泉 · 刘总',   '加急需求', 'high',   'pending',    '待处理',   '未分配', '今天 14:08'),
 ('TK-2026-0624-03', '可口可乐 · 王经理', '素材反馈', 'medium', 'processing', '方案制定', '小刘',   '今天 11:25'),
 ('TK-2026-0624-04', '王老吉 · 李经理',   '合同咨询', 'medium', 'processing', '沟通中',   '小李',   '今天 10:42'),
 ('TK-2026-0624-05', '立白 · 赵经理',     '点位推荐', 'low',    'done',       '已回复',   '小赵',   '昨天 16:30'),
 ('TK-2026-0624-06', '湾仔码头 · 黄经理', '发票申请', 'low',    'done',       '已完成',   '小陈',   '昨天 14:15'),
 ('TK-2026-0624-07', '黑人牙膏 · 孙经理', '素材审批', 'medium', 'processing', '等待客户', '小张',   '昨天 11:20');

-- ---------- 13 公司知识库 ----------
INSERT INTO knowledge_docs (title, category, views, doc_date, tags, content) VALUES
 ('2026 pDOOH 户外广告投放策略白皮书', '投放策略', 2845, '06-20', '策略,年度报告', '覆盖粤港澳大湾区 5 城 2368 个点位的投放策略、预算分配与效果评估方法论。'),
 ('可口可乐夏季促销案例复盘',         '客户案例', 1856, '06-18', '快消,夏季',     '夏季促销期智能屏 + 门禁组合投放，触达 3200 万人次，ROI 达 4.1。'),
 ('粤港澳大湾区户外广告点位分布报告 2026Q2', '行业报告', 1642, '06-15', '湾区,点位', '广州 856、深圳 742、佛山 326、东莞 268、珠海 176 个点位的结构性分析。'),
 ('广告法合规检查操作手册',           '操作手册', 1428, '06-12', '合规,法规',     '户外广告内容合规 12 条红线自检清单与法务送审流程。'),
 ('宝马华南区品牌曝光 ROI 分析报告',  '客户案例', 1264, '06-10', '汽车,ROI',      '宝马 Q3 品牌曝光计划中期 ROI 3.9，高于行业均值 2.9。'),
 ('智能屏投放技术规范 v3.0',          '操作手册', 985,  '06-08', '智能屏,技术',   '智能屏素材分辨率、亮度、播放频次与故障响应 SLA 规范。'),
 ('户外广告数据合规与隐私保护指引',   '法规',     762,  '06-05', '合规,隐私',     '人流统计数据的脱敏、存储期限与第三方共享的合规要求。'),
 ('罗姐 AI 提问技巧大全',             '操作手册', 1586, '06-02', 'AI,效率',       '用自然语言向罗姐提问收入、风险、点位、ROI 四类问题的最佳实践。');

-- ---------- 14 产品研发 ----------
INSERT INTO rd_requirements (title, priority, status, status_text, author, votes, comments) VALUES
 ('Tom Agent 接入 DeepSeek 大模型', 'high',   'in_progress', '开发中',   'Tom',  42, 18),
 ('ROI 计算器增加小程序版',          'high',   'review',      '需求评审', '小王', 38, 12),
 ('点位库支持 3D 地图展示',          'medium', 'planned',     '排期 Q3',  '小李', 26, 8),
 ('AI 素材生成增加视频能力',         'high',   'in_progress', 'POC 中',   '小张', 56, 22),
 ('销售作战卡移动端适配',            'medium', 'planned',     '排期 Q3',  '小赵', 18, 5),
 ('工单系统增加微信通知',            'low',    'completed',   '已上线',   '小陈', 12, 3),
 ('合同电子签集成 e签宝',            'high',   'in_progress', '开发中',   '小刘', 32, 11),
 ('日报增加 AI 一键生成',            'medium', 'planned',     '排期 Q4',  '罗姐', 28, 9),
 ('点位价格动态调整模型',            'high',   'review',      '需求评审', '小王', 24, 7),
 ('多语言支持（英文 / 粤语）',       'low',    'planned',     '调研中',   '小李', 8,  2);

INSERT INTO roadmap (quarter, title, description, status, sort_order) VALUES
 ('Q1', 'AI 经营决策中心 v1.0',    '罗姐 / Tom / ROI 三大 Agent 上线',              'success', 1),
 ('Q2', '点位库 + 素材库打通',      'AI 素材生成 · ROI 计算器小程序',                'success', 2),
 ('Q3', '3D 地图 + 多 Agent 协同',  '点位 3D 化 · 销售作战卡移动版',                 'warning', 3),
 ('Q4', 'AI 驱动全自动化',          '合同自动续签 · 日报 AI 生成 · 国际化',          'primary', 4);

-- ---------- 15 每日日报 ----------
INSERT INTO daily_reports (id, title, author, dept, mood, mood_text) VALUES
 (1, '今日拜访 5 客户，宝马珠江新城点位敲定', '小李', '销售部', '🔥', '高效'),
 (2, '广州 / 深圳点位巡检完成',               '小王', '运维部', '😊', '顺利'),
 (3, 'AI 素材生成上线 8 个新素材',            '小张', '设计部', '🎨', '灵感爆发'),
 (4, '合同审 6 份，紧急 2 单已批',            '小赵', '商务部', '💪', '充实'),
 (5, '工单处理 12 单，紧急 2 单关闭',         '小陈', '客服部', '😌', '轻松'),
 (6, 'Tom Agent 接入 DeepSeek 进展 70%',      '小刘', '产品部', '🚀', '突破');

INSERT INTO daily_report_items (report_id, kind, content, sort_order) VALUES
 (1, 'done', '宝马签约 ¥8.5万',        1), (1, 'done', '可口可乐方案反馈', 2), (1, 'done', '王老吉续签沟通', 3),
 (1, 'plan', '宝马珠江新城物料上线',   1), (1, 'plan', '奔驰 GLE 方案沟通', 2), (1, 'plan', '罗姐 AI 周会', 3),
 (2, 'done', '广州万达智能屏巡检',     1), (2, 'done', '深圳腾讯大厦电梯框架', 2), (2, 'done', '点位 12 个异常已修复', 3),
 (2, 'plan', '佛山碧桂园巡检',         1), (2, 'plan', '智能屏素材更新', 2), (2, 'plan', '巡检报告整理', 3),
 (3, 'done', '宝马 X5 主视觉',         1), (3, 'done', '可口可乐夏季视频', 2), (3, 'done', '王老吉海报 3 套', 3),
 (3, 'plan', '奔驰 GLE 30 秒视频',     1), (3, 'plan', '立白新品 KV', 2), (3, 'plan', '素材库分类优化', 3),
 (4, 'done', '王老吉续签通过',         1), (4, 'done', '可口可乐方案修订', 2), (4, 'done', '宝马补充协议', 3),
 (4, 'plan', '农夫山泉年度框架',       1), (4, 'plan', '湾仔码头 Q3 合同', 2), (4, 'plan', '财务对账', 3),
 (5, 'done', '宝马点位故障排查',       1), (5, 'done', '农夫山泉紧急加投对接', 2), (5, 'done', '湾仔码头发票申请', 3),
 (5, 'plan', '素材审批回复',           1), (5, 'plan', '客户回访', 2), (5, 'plan', '满意度调研', 3),
 (6, 'done', 'DeepSeek API 接入',      1), (6, 'done', '提示词工程优化', 2), (6, 'done', '压力测试 QPS 200', 3),
 (6, 'plan', '灰度发布 10%',           1), (6, 'plan', '性能调优', 2), (6, 'plan', '文档更新', 3);

-- ---------- 16 数据连接中心 ----------
INSERT INTO data_sources (name, type, status, status_text, last_sync, latency, latency_ms, qps) VALUES
 ('点位库 (MySQL)',        'MySQL 8.0',   'online', '正常',   '3秒前',  '12ms',  12,  86),
 ('合同库 (PostgreSQL)',   'PG 15',       'online', '正常',   '8秒前',  '18ms',  18,  42),
 ('客户库 (MongoDB)',      'Mongo 7.0',   'online', '正常',   '5秒前',  '24ms',  24,  56),
 ('支付系统 (Stripe)',     'Stripe API',  'online', '正常',   '12秒前', '186ms', 186, 18),
 ('地图 API (腾讯地图)',   '腾讯 LBS',    'online', '正常',   '6秒前',  '68ms',  68,  124),
 ('腾讯云 COS',            '对象存储',    'busy',   '高负载', '2秒前',  '128ms', 128, 286),
 ('AI 服务 (DeepSeek)',    'DeepSeek-V3', 'online', '正常',   '4秒前',  '486ms', 486, 32);

-- ---------- 收入明细：近 30 天 × 4 渠道 × 5 城市 ----------
-- 今日合计 = ¥126,000（对齐页面「今日投放收入 ¥12.6万」，昨日 ¥112,000 → 增长 12.5%）
WITH RECURSIVE d(n) AS (
    SELECT 0 UNION ALL SELECT n + 1 FROM d WHERE n < 29
),
ch(channel, base) AS (
    VALUES ('智能屏', 78000.0), ('门禁', 32000.0), ('道闸', 10000.0), ('电梯框架', 6000.0)
),
ct(city_id, w) AS (
    VALUES ('gz', 0.32), ('sz', 0.28), ('fs', 0.14), ('dg', 0.13), ('zh', 0.13)
)
INSERT INTO revenue_daily (stat_date, channel, city_id, orders, amount)
SELECT
    date('now', 'localtime', '-' || d.n || ' day'),
    ch.channel,
    ct.city_id,
    20 + ((d.n * 7 + CAST(ch.base / 1000 AS INTEGER)) % 40),
    ROUND(ch.base * ct.w * (
        CASE WHEN d.n = 0 THEN 1.0
             ELSE 0.889 - 0.004 * d.n + ((((d.n * 7) % 5) - 2) * 0.01)
        END
    ), 2)
FROM d CROSS JOIN ch CROSS JOIN ct;

-- ---------- 初始化 AI 对话（罗姐） ----------
INSERT INTO ai_conversations (id, title) VALUES (1, '经营决策日常问答');
INSERT INTO ai_messages (conversation_id, role, content, category, priority_tag, created_at) VALUES
 (1, 'user', '今日投放收入情况如何？有哪些需要重点关注的风险？', '', '', datetime('now','localtime','-7 minutes')),
 (1, 'assistant',
  '<p style="margin-bottom: 12px;">您好！我是罗姐，您的户外广告AI顾问。根据今日数据分析：</p><p style="margin-bottom: 8px;"><strong>📈 收入情况</strong></p><p style="margin-bottom: 12px; color: var(--success);">今日投放收入 <strong>¥12.6万</strong>，较昨日增长12.5%，表现良好。主要收入来源：智能屏广告（¥7.8万）、门禁广告（¥3.2万）。</p><p style="margin-bottom: 8px;"><strong>⚠️ 风险预警</strong></p><p style="margin-bottom: 12px; color: var(--warning);">待签约风险 <strong>¥38.4万</strong>，涉及3个即将到期的合同：<br>1. 万达社区智能屏（¥15万）- 7天后到期<br>2. 万科门禁广告（¥12.4万）- 10天后到期<br>3. 碧桂园道闸（¥11万）- 12天后到期</p><p style="margin-bottom: 8px;"><strong>💡 建议</strong></p><p style="color: var(--accent);">建议优先跟进万达和万科的合同续签，这两个客户历史履约记录良好，续签成功率较高。</p>',
  '收入分析', '急低', datetime('now','localtime','-5 minutes')),
 (1, 'user', '点位覆盖情况怎么样？有没有拓展建议？', '', '', datetime('now','localtime','-3 minutes')),
 (1, 'assistant',
  '<p style="margin-bottom: 12px;">好的，我来为您分析点位覆盖情况：</p><p style="margin-bottom: 8px;"><strong>📍 当前覆盖</strong></p><p style="margin-bottom: 12px;">总计 <strong>2,368</strong> 个点位，覆盖 <strong>126</strong> 个社区。其中：<br>• 智能屏：876个（37%）<br>• 门禁：742个（31%）<br>• 道闸：426个（18%）<br>• 电梯框架：324个（14%）</p><p style="margin-bottom: 8px;"><strong>🎯 拓展建议</strong></p><p style="margin-bottom: 12px; color: var(--accent);">1. <strong>高端社区</strong>：建议增加核心 CBD 区域的智能屏覆盖<br>2. <strong>写字楼</strong>：电梯框架广告仍有较大空间<br>3. <strong>新兴区域</strong>：外围新区值得布局</p><p style="margin-bottom: 8px;"><strong>📊 ROI预测</strong></p><p style="color: var(--success);">如按建议拓展，预计3个月内ROI可提升至 <strong>4.2</strong></p>',
  '点位分析', '', datetime('now','localtime','-1 minutes'));

INSERT INTO activity_log (action, target, detail) VALUES
 ('SYSTEM_INIT', 'database', '数据库结构与种子数据初始化完成');

COMMIT;
