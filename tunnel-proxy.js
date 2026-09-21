#!/usr/bin/env node
/**
 * ============================================================
 * 公网隧道鉴权代理 (tunnel-proxy)
 * ------------------------------------------------------------
 * 作用：Cloudflare 隧道把公网请求打到本代理（127.0.0.1:5004），
 *       代理强制校验 Basic Auth 后才转发给应用（127.0.0.1:5003）。
 *
 * 为什么需要：
 *   Cloudflare 隧道的回源连接来自本机 127.0.0.1，应用无法据此区分
 *   公网访客与局域网访客；而 ufw 本身已阻断公网直连 5003。
 *   因此把"公网入口鉴权"放在隧道与应用之间这一层，最清晰可靠：
 *     公网 → cloudflared → [本代理: 校验口令] → 应用
 *     局域网/本机 → 直接访问 5003（不受影响，无需口令）
 *
 * 环境变量：
 *   PROXY_PORT  监听端口，默认 5004
 *   UPSTREAM    上游应用地址，默认 http://127.0.0.1:5003
 *   AUTH_USER   访问用户名，默认 pdooh
 *   AUTH_PASS   访问口令（必填，未设置则拒绝启动）
 *   AUTH_TOKEN  可选，允许用 ?token=xxx 免交互访问（便于 curl / iframe）
 *
 * 用法：AUTH_PASS='xxx' node tunnel-proxy.js
 * ============================================================
 */
'use strict';

const http = require('node:http');
const { URL } = require('node:url');

const PORT = Number(process.env.PROXY_PORT || 5004);
const UPSTREAM = new URL(process.env.UPSTREAM || 'http://127.0.0.1:5003');
const AUTH_USER = process.env.AUTH_USER || 'pdooh';
const AUTH_PASS = process.env.AUTH_PASS || '';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

if (!AUTH_PASS) {
  console.error('[tunnel-proxy] 拒绝启动：必须设置 AUTH_PASS 环境变量（公网入口口令）');
  process.exit(1);
}

const unauthorized = res => {
  // 注意：HTTP 头只能是 latin-1，realm 不能写中文，否则 ERR_INVALID_CHAR
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="pDOOH AI Decision Center", charset="UTF-8"',
    'Content-Type': 'text/html; charset=utf-8'
  });
  res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>需要登录</title>
<style>body{background:#0f172a;color:#f1f5f9;font-family:-apple-system,"PingFang SC",sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;padding:40px 48px;background:#1e293b;border:1px solid #334155;border-radius:12px}
h1{font-size:20px;margin:0 0 10px}p{color:#94a3b8;font-size:13px;margin:6px 0}</style></head>
<body><div class="box"><h1>🔒 401 需要登录</h1>
<p>pDOOH AI 经营决策中心 · 公网入口已启用访问口令</p>
<p>请输入 Basic Auth 用户名与口令后重试</p></div></body></html>`);
};

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

/**
 * 鉴权判定
 * 返回 { ok, setCookie }
 *  - ?token=xxx 命中：ok，并要求下发 Cookie
 *    （关键：<script src="/app.js"> 等子资源不会带 query，只靠 query token 会 401，
 *      浏览器随即弹出 Basic 登录框卡住页面，因此必须用 Cookie 维持会话）
 *  - Cookie 命中：ok
 *  - Basic Auth 命中：ok
 */
function authState(req, url) {
  const safeEqual = (a, b) => {
    const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    let diff = 0;
    for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
    return diff === 0;
  };

  if (AUTH_TOKEN && safeEqual(url.searchParams.get('token') || '', AUTH_TOKEN)) {
    return { ok: true, setCookie: true };
  }
  if (AUTH_TOKEN && safeEqual(parseCookies(req.headers.cookie).pdooh_token || '', AUTH_TOKEN)) {
    return { ok: true };
  }
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    let decoded;
    try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return { ok: false }; }
    const idx = decoded.indexOf(':');
    if (idx < 0) return { ok: false };
    if (safeEqual(decoded.slice(0, idx), AUTH_USER) && safeEqual(decoded.slice(idx + 1), AUTH_PASS)) {
      return { ok: true };
    }
  }
  return { ok: false };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 健康探针不鉴权，便于隧道存活检查
  if (url.pathname === '/proxy-health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, service: 'tunnel-proxy', upstream: UPSTREAM.origin, authRequired: true }));
  }

  const auth = authState(req, url);
  if (!auth.ok) {
    // 公开获客落地页：客户必须能免登录打开并提交留资
    // （应用侧已带 IP 频控：同 IP 每小时 5 条；日志会记录真实来源 IP）
    const PUBLIC_PATHS = ['/lead.html', '/lead.js', '/lead.css', '/favicon.ico', '/api/public/'];
    const isPublic = PUBLIC_PATHS.some(p => url.pathname === p || url.pathname.startsWith(p));
    if (!isPublic) {
      console.warn(`[tunnel-proxy] 401 拒绝 ${req.method} ${url.pathname} from ${req.socket.remoteAddress}`);
      return unauthorized(res);
    }
    console.log(`[tunnel-proxy] 公开放行 ${req.method} ${url.pathname} from ${req.socket.remoteAddress}`);
  }

  // 已鉴权：原样转发到应用
  const headers = { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-by': 'pdooh-tunnel-proxy' };
  delete headers.authorization;                    // 不把口令透传给应用
  headers.host = UPSTREAM.host;
  // 用 Cloudflare 边缘写入的真实客户端 IP 覆盖 x-forwarded-for，
  // 否则访客可伪造该头绕过留资频控（cf-connecting-ip 由边缘注入，不可伪造）
  if (req.headers['cf-connecting-ip']) headers['x-forwarded-for'] = req.headers['cf-connecting-ip'];

  const proxyReq = http.request({
    protocol: UPSTREAM.protocol,
    hostname: UPSTREAM.hostname,
    port: UPSTREAM.port,
    method: req.method,
    path: req.url.replace(/([?&])token=[^&]*(&|$)/, (m, p1, p2) => (p2 === '&' ? p1 : '')).replace(/[?&]$/, ''),
    headers
  }, proxyRes => {
    const outHeaders = { ...proxyRes.headers };
    if (auth.setCookie) {
      // 下发会话 Cookie，后续子资源与 fetch 无需再带 token
      const cookie = `pdooh_token=${encodeURIComponent(AUTH_TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`;
      outHeaders['set-cookie'] = outHeaders['set-cookie'] ? [...outHeaders['set-cookie'], cookie] : [cookie];
    }
    res.writeHead(proxyRes.statusCode || 502, outHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', e => {
    console.error('[tunnel-proxy] 上游转发失败:', e.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'BAD_GATEWAY', message: '上游应用不可达: ' + e.message }));
    } else res.end();
  });

  req.pipe(proxyReq);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('==========================================================');
  console.log(' 公网隧道鉴权代理已启动');
  console.log('   监听   : 127.0.0.1:' + PORT + ' (仅本机，由隧道回源)');
  console.log('   上游   : ' + UPSTREAM.origin);
  console.log('   用户名 : ' + AUTH_USER);
  console.log('   口令   : ' + (AUTH_PASS ? '已设置(' + AUTH_PASS.length + '位)' : '未设置'));
  console.log('   免登录token: ' + (AUTH_TOKEN ? '已启用' : '未启用'));
  console.log('==========================================================');
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
