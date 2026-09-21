#!/usr/bin/env bash
# ============================================================
# pDOOH 公网隧道管理
#   ./scripts/tunnel.sh url        打印当前公网地址
#   ./scripts/tunnel.sh creds      打印访问账号口令
#   ./scripts/tunnel.sh status     查看隧道/代理状态
#   ./scripts/tunnel.sh test       公网连通性与鉴权自测
#   ./scripts/tunnel.sh restart    重启代理与隧道（会换新域名）
# ============================================================
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$APP_DIR/data/tunnel.log"
ENV_FILE="$APP_DIR/data/tunnel.env"

get_url() { grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1; }
get_env() { grep "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-; }

case "${1:-url}" in
  url)
    U="$(get_url)"
    [[ -n "$U" ]] && echo "$U" || { echo "未找到公网地址，查看日志: $LOG"; exit 1; }
    ;;

  creds)
    echo "用户名 : $(get_env AUTH_USER)"
    echo "口令   : $(get_env AUTH_PASS)"
    echo "token  : $(get_env AUTH_TOKEN)"
    echo
    echo "浏览器 : $(get_url)  （弹出登录框输入上面账号口令）"
    echo "免登录 : $(get_url)/?token=$(get_env AUTH_TOKEN)"
    ;;

  status)
    for s in pdooh-aic pdooh-proxy pdooh-tunnel; do
      printf '  %-14s %s / %s\n' "$s" "$(systemctl is-active $s 2>/dev/null)" "$(systemctl is-enabled $s 2>/dev/null)"
    done
    echo "  公网地址: $(get_url || echo 无)"
    ;;

  test)
    U="$(get_url)"; P="$(get_env AUTH_PASS)"; UU="$(get_env AUTH_USER)"
    echo "▶ 测试 $U"
    printf '  无凭证    : HTTP %s (期望 401)\n' "$(curl -s -o /dev/null -w '%{http_code}' "$U/api/health")"
    printf '  错口令    : HTTP %s (期望 401)\n' "$(curl -s -o /dev/null -w '%{http_code}' -u "$UU:wrong" "$U/api/health")"
    printf '  正确口令  : HTTP %s (期望 200)\n' "$(curl -s -o /dev/null -w '%{http_code}' -u "$UU:$P" "$U/api/health")"
    printf '  首页      : HTTP %s\n' "$(curl -s -o /dev/null -w '%{http_code}' -u "$UU:$P" "$U/")"
    ;;

  restart)
    sudo systemctl restart pdooh-proxy pdooh-tunnel
    sleep 8
    echo "新公网地址: $(get_url)"
    ;;

  *)
    echo "用法: $0 {url|creds|status|test|restart}"; exit 1;;
esac
