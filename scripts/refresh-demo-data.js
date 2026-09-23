#!/usr/bin/env node
/**
 * 刷新演示数据中【与日期相关】的部分，让系统「永远显示今天的数据」。
 *
 * 背景：seed.sql 里的收入数据是按灌库当天生成最近 30 天的，
 *       过了几天再打开，date('now') 对应的那行就是空的 →「今日投放收入 ¥0.0万」。
 *
 * 本脚本只重算 revenue_daily（收入明细），
 * **不会触碰** customers / contracts / tickets / ai_messages 等业务数据。
 *
 * 用法:
 *   node scripts/refresh-demo-data.js            # 刷新收入（近 30 天）
 *   node scripts/refresh-demo-data.js --days 60  # 指定天数
 *   node scripts/refresh-demo-data.js --status   # 只看当前状态
 */
'use strict';
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'pdooh.db');
const args = process.argv.slice(2);
const daysIdx = args.indexOf('--days');
const DAYS = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 30 : 30;

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 10000;');

const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p),
  all: (sql, ...p) => db.prepare(sql).all(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p)
};

function status() {
  const s = q.get(`SELECT
      ROUND(COALESCE(SUM(CASE WHEN stat_date=date('now','localtime') THEN amount END),0),2) AS today,
      ROUND(COALESCE(SUM(CASE WHEN stat_date=date('now','localtime','-1 day') THEN amount END),0),2) AS yesterday,
      COUNT(DISTINCT stat_date) AS days, COUNT(*) AS rows
    FROM revenue_daily`);
  console.log('  当前收入表状态:');
  console.log(`    覆盖天数 : ${s.days} 天（${s.rows} 行）`);
  console.log(`    今日收入 : ¥${Number(s.today).toLocaleString('zh-CN')}`);
  console.log(`    昨日收入 : ¥${Number(s.yesterday).toLocaleString('zh-CN')}`);
  if (!s.today) console.log('    ⚠️  今日收入为 0 —— 演示数据已过期，运行本脚本刷新');
  return s;
}

function refresh() {
  console.log(`▶ 重新生成最近 ${DAYS} 天收入明细（今日 ¥126,000）...`);
  // 与 sql/seed.sql 中同一套算法，保证数据特征一致
  const sql = `
    DELETE FROM revenue_daily;
    WITH RECURSIVE d(n) AS (
        SELECT 0 UNION ALL SELECT n + 1 FROM d WHERE n < ${DAYS - 1}
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
  `;
  db.exec(sql);
  q.run("INSERT INTO activity_log (action, target, detail) VALUES (?,?,?)",
    'DEMO_DATA_REFRESH', 'revenue_daily', `重新生成最近 ${DAYS} 天收入明细`);
  console.log('  ✅ 完成');
}

// ── 顺带让待确认项的「剩余天数」也随之更新（保持"即将到期"的演示效果）
function refreshDueDays() {
  const rows = q.all("SELECT id, days FROM pending_items WHERE status='pending'");
  if (!rows.length) return;
  const maxDays = Math.max(...rows.map(r => r.days));
  // 把剩余天数按原顺序重新铺开在 1..maxDays 之间，保证最小的仍然是"最紧急"
  const sorted = [...rows].sort((a, b) => a.days - b.days);
  sorted.forEach((r, i) => {
    const nd = i + 1;
    q.run('UPDATE pending_items SET days = ? WHERE id = ?', nd, r.id);
  });
  console.log(`  ✅ 已重排 ${rows.length} 个待确认项的剩余天数（1~${maxDays} 天内到期）`);
}

console.log('═══ 演示数据刷新 ═══');
console.log('  数据库:', DB);
if (args.includes('--status')) { status(); db.close(); process.exit(0); }

status();
refresh();
if (!args.includes('--revenue-only')) refreshDueDays();
console.log();
status();
db.close();
