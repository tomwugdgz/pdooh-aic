#!/usr/bin/env bash
# ============================================================
# pDOOH AI 经营决策中心 · 服务管理脚本
#   ./scripts/start.sh    启动服务（后台守护 + PID 文件）
#   ./scripts/start.sh stop   停止服务
#   ./scripts/start.sh status 查看状态
#   ./scripts/start.sh restart 重启
#   ./scripts/start.sh init-db 重建数据库（结构 + 种子数据）
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$APP_DIR/data/pdooh.pid"
LOG_FILE="$APP_DIR/data/pdooh.log"
DB_FILE="$APP_DIR/data/pdooh.db"
PORT="${PORT:-5003}"
HOST="${HOST:-0.0.0.0}"

is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

case "${1:-start}" in
  init-db)
    echo "▶ 重建数据库: $DB_FILE"
    rm -f "$DB_FILE" "$DB_FILE-wal" "$DB_FILE-shm"
    sqlite3 "$DB_FILE" < "$APP_DIR/sql/schema.sql"
    sqlite3 "$DB_FILE" < "$APP_DIR/sql/seed.sql"
    echo "✅ 数据库已重建"
    sqlite3 -header -column "$DB_FILE" "SELECT
        (SELECT COUNT(*) FROM points)  AS 点位数,
        (SELECT COUNT(*) FROM contracts) AS 合同数,
        (SELECT COUNT(*) FROM customers) AS 客户数,
        (SELECT COUNT(*) FROM revenue_daily) AS 收入记录;"
    ;;

  start)
    if is_running; then
      echo "⚠️  服务已在运行 (PID $(cat "$PID_FILE")) → http://127.0.0.1:$PORT/"
      exit 0
    fi
    # systemd 托管检测：避免与 systemctl 管理的实例抢占端口
    if systemctl is-active --quiet pdooh-aic 2>/dev/null; then
      echo "⚠️  服务由 systemd 托管（pdooh-aic.service），请改用:"
      echo "     sudo systemctl {status|restart|stop} pdooh-aic"
      echo "   如需退回本脚本管理，先执行: sudo systemctl disable --now pdooh-aic"
      exit 1
    fi
    cd "$APP_DIR"
    nohup env PORT="$PORT" HOST="$HOST" node server.js >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 1.5
    if is_running; then
      echo "✅ 服务已启动 (PID $(cat "$PID_FILE"))"
      echo "   前端: http://127.0.0.1:$PORT/"
      echo "   接口: http://127.0.0.1:$PORT/api/bootstrap"
      echo "   日志: $LOG_FILE"
    else
      echo "❌ 启动失败，日志如下:"; tail -20 "$LOG_FILE"; exit 1
    fi
    ;;

  stop)
    if is_running; then
      kill "$(cat "$PID_FILE")" && echo "✅ 已停止 (PID $(cat "$PID_FILE"))"
      rm -f "$PID_FILE"
    else
      echo "ℹ️  服务未运行"
    fi
    ;;

  restart)
    "$0" stop || true
    sleep 1
    "$0" start
    ;;

  status)
    if is_running; then
      echo "✅ 运行中 (PID $(cat "$PID_FILE"))"
      curl -s "http://127.0.0.1:$PORT/api/health" || true
    else
      echo "❌ 未运行"
    fi
    ;;

  *)
    echo "用法: $0 {start|stop|restart|status|init-db}"; exit 1;;
esac
