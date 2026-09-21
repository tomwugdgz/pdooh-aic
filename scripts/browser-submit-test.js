#!/usr/bin/env node
/**
 * 用真实浏览器（CDP 驱动 headless Chromium）完整走一遍留资提交，
 * 把控制台报错、网络失败、响应状态全部打出来，用于定位"网络异常"。
 *
 * 用法: node scripts/browser-submit-test.js [url]
 *   默认 url = http://127.0.0.1:5003/lead.html
 */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const TARGET = process.argv[2] || 'http://127.0.0.1:5003/lead.html';
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cdp = async (path, method = 'GET') => {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
  return res.json();
};

(async () => {
  console.log('▶ 目标页面: ' + TARGET);
  fs.rmSync('/tmp/cdp-profile', { recursive: true, force: true });
  const chrome = spawn('chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-profile', 'about:blank'
  ], { stdio: 'ignore' });

  // 等调试端口就绪
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { await cdp('/json/version'); ready = true; break; } catch { await sleep(300); }
  }
  if (!ready) { console.error('❌ Chromium 调试端口未就绪'); chrome.kill(); process.exit(2); }

  const tab = await cdp('/json/new?about:blank', 'PUT');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = { console: [], failed: [], responses: [], exceptions: [] };

  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg.error); pending.delete(msg.id); return; }
    const p = msg.params || {};
    if (msg.method === 'Runtime.consoleAPICalled') events.console.push(p.args.map(a => a.value ?? a.description).join(' '));
    if (msg.method === 'Runtime.exceptionThrown') events.exceptions.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
    if (msg.method === 'Network.loadingFailed') events.failed.push(`${p.type} ${p.errorText}`);
    if (msg.method === 'Network.responseReceived' && /public\/lead/.test(p.response?.url || '')) {
      events.responses.push({ url: p.response.url, status: p.response.status, mime: p.response.mimeType });
    }
  });

  const send = (method, params = {}) => new Promise(res => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await new Promise(r => ws.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');

  console.log('▶ 打开页面...');
  await send('Page.navigate', { url: TARGET });
  await sleep(3000);

  const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  console.log('  页面标题:', title.result?.value);
  const hasForm = await send('Runtime.evaluate', { expression: '!!document.getElementById("lead-form")', returnByValue: true });
  console.log('  表单存在:', hasForm.result?.value);

  console.log('▶ 填写并提交表单...');
  await send('Runtime.evaluate', {
    expression: `
      document.getElementById('lf-name').value = '浏览器测试公司';
      document.getElementById('lf-contact').value = '浏览器测试';
      document.getElementById('lf-phone').value = '13800007777';
      document.getElementById('lf-industry').value = '汽车';
      document.getElementById('lf-budget').value = '55';
      document.getElementById('lf-message').value = 'CDP 自动化提交测试';
      document.getElementById('lead-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      'submitted';
    `, returnByValue: true
  });
  await sleep(4000);

  const msg = await send('Runtime.evaluate', {
    expression: `(function(){var m=document.getElementById('lf-msg');return JSON.stringify({cls:m.className,text:m.textContent,btn:document.getElementById('lf-submit').textContent});})()`,
    returnByValue: true
  });
  console.log('\n═══ 结果 ═══');
  console.log('  页面提示:', msg.result?.value);
  console.log('  留资接口响应:', JSON.stringify(events.responses));
  console.log('  网络失败:', events.failed.length ? events.failed.join(' | ') : '无');
  console.log('  控制台:', events.console.length ? events.console.join(' | ') : '无');
  console.log('  页面异常:', events.exceptions.length ? events.exceptions.join(' | ') : '无');

  ws.close();
  chrome.kill();
  await sleep(500);
  process.exit(0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
