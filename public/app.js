        // ==================== 全局配置 ====================
        // 支持通过 ?token=xxx 免登录访问（公网隧道 quick tunnel 场景）
        const _urlToken = new URLSearchParams(location.search).get('token') || '';

        const CONFIG = {
            apiUrl: '',                 // 同源后端 (node server.js)，可改为 http://ip:5003
            token: _urlToken,           // 透传给 /api/* 的免登录 token
            luojieName: '罗姐',
            luojieTitle: '户外广告AI顾问'
        };

        // ==================== 初始化 ====================
        document.addEventListener('DOMContentLoaded', async function() {
            initializeSidebar();
            initializeAIInput();
            bindFilterTags();

            try {
                await loadAllData();          // 1. 从后端 SQLite 拉取 16 个模块数据
            } catch (e) {
                console.error('数据加载失败', e);
                showToast('后端连接失败：' + e.message, 'danger');
                return;
            }

            renderAllPages();                 // 2. 渲染所有页面
            startDashboardLive();             //    工作台实时同步（时钟+轮询）
            hydrateKpi();                     // 3. 决策页 KPI 实时值
            hydrateChat();                    // 4. 对话记录（来自 ai_messages 表）
            showToast('数据已从数据库加载 · ' + META.generatedAt, 'success');
        });

        // ==================== 预渲染所有页面 ====================
        function renderAllPages() {
            Object.keys(PAGE_RENDERERS).forEach(pageId => {
                const el = document.getElementById('page-' + pageId);
                if (el) {
                    el.innerHTML = PAGE_RENDERERS[pageId]();
                }
            });
            // 绑定筛选标签交互
            bindFilterTags();
        }

        function bindFilterTags() {
            document.querySelectorAll('.filter-tags').forEach(group => {
                group.querySelectorAll('.filter-tag').forEach(tag => {
                    tag.addEventListener('click', function() {
                        group.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
                        this.classList.add('active');
                    });
                });
            });
            document.querySelectorAll('.tabs').forEach(group => {
                group.querySelectorAll('.tab-item').forEach(tab => {
                    tab.addEventListener('click', function() {
                        group.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
                        this.classList.add('active');
                    });
                });
            });
        }

        // ==================== 侧边栏功能 ====================
        function initializeSidebar() {
            const navLinks = document.querySelectorAll('.nav-link');
            navLinks.forEach(link => {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    navLinks.forEach(l => l.classList.remove('active'));
                    this.classList.add('active');
                    const page = this.getAttribute('data-page');
                    if (page) {
                        switchPage(page);
                    }
                });
            });
        }

        // ==================== AI输入框功能 ====================
        function initializeAIInput() {
            const input = document.querySelector('.ai-input');
            
            input.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            });

            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitQuestion();
                }
            });
        }

        function fillQuestion(question) {
            const input = document.querySelector('.ai-input');
            input.value = question;
            input.focus();
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        }

        async function submitQuestion() {
            const input = document.querySelector('.ai-input');
            const question = input.value.trim();
            
            if (!question) {
                showToast('请输入您的问题', 'warning');
                return;
            }

            addUserMessage(question);
            input.value = '';
            input.style.height = 'auto';

            showTypingIndicator();

            try {
                // 调用后端罗姐 AI 引擎：结论由 SQLite 实时聚合计算，并持久化到 ai_messages 表
                const conversationId = (META.chat && META.chat.conversationId) || 1;
                const answer = await API.post('/api/ai/chat', { question, conversationId });

                removeTypingIndicator();
                addAIResponseHtml(answer.html, answer.category, answer.priority_tag, answer.created_at);

                META.chat = {
                    conversationId: answer.conversationId,
                    messages: await API.get('/api/ai/history?conversationId=' + answer.conversationId)
                };
                const ts = document.querySelector('.conversation-timestamp');
                if (ts) ts.textContent = '最近对话 · 刚刚';
            } catch (error) {
                removeTypingIndicator();
                addAIResponse('抱歉，我遇到了一些问题：' + error.message, true);
            }
        }

        // 渲染后端返回的 AI 富文本回答
        function addAIResponseHtml(html, category, priorityTag, createdAt) {
            const conversationBody = document.getElementById('conversation-body');
            const messageHTML = `
                <div class="message assistant">
                    <div class="message-avatar"></div>
                    <div class="message-content">
                        <div class="message-bubble">${html}</div>
                        <div class="message-meta">${fmtTime(createdAt)} · ${CONFIG.luojieName}</div>
                        <div class="message-tags">
                            <span class="message-tag tag-ai">AI大脑</span>
                            ${priorityTag ? `<span class="message-tag tag-priority">${escapeHtml(priorityTag)}</span>` : ''}
                            <span class="message-tag tag-category">${escapeHtml(category || '智能分析')}</span>
                        </div>
                    </div>
                </div>
            `;
            conversationBody.insertAdjacentHTML('beforeend', messageHTML);
            scrollToBottom();
        }

        function addUserMessage(text) {
            const conversationBody = document.getElementById('conversation-body');
            const messageHTML = `
                <div class="message user">
                    <div class="message-avatar">我</div>
                    <div class="message-content">
                        <div class="message-bubble">${escapeHtml(text)}</div>
                        <div class="message-meta">刚刚 · 已回答</div>
                    </div>
                </div>
            `;
            conversationBody.insertAdjacentHTML('beforeend', messageHTML);
            scrollToBottom();
        }

        function addAIResponse(question, isError = false) {
            const conversationBody = document.getElementById('conversation-body');
            let responseText = '';

            if (isError) {
                responseText = '<p>抱歉，我遇到了一些问题，请稍后再试。</p>';
            } else {
                responseText = generateAIResponse(question);
            }

            const messageHTML = `
                <div class="message assistant">
                    <div class="message-avatar"></div>
                    <div class="message-content">
                        <div class="message-bubble">${responseText}</div>
                        <div class="message-meta">刚刚 · ${CONFIG.luojieName}</div>
                        <div class="message-tags">
                            <span class="message-tag tag-ai">AI大脑</span>
                            <span class="message-tag tag-category">智能分析</span>
                        </div>
                    </div>
                </div>
            `;
            conversationBody.insertAdjacentHTML('beforeend', messageHTML);
            scrollToBottom();
        }

        function generateAIResponse(question) {
            const responses = {
                '收入': `<p style="margin-bottom: 12px;">根据最新数据分析：</p>
                        <p style="margin-bottom: 8px;"><strong>📈 今日收入</strong></p>
                        <p style="color: var(--success);">¥12.6万，较昨日增长12.5%</p>`,
                '风险': `<p style="margin-bottom: 12px;">风险预警分析：</p>
                        <p style="color: var(--warning);">待签约风险 ¥38.4万，建议关注即将到期的合同。</p>`,
                '点位': `<p style="margin-bottom: 12px;">点位覆盖分析：</p>
                        <p>当前覆盖 2,368 个点位，126 个社区。</p>`,
                'ROI': `<p style="margin-bottom: 12px;">ROI指数分析：</p>
                        <p style="color: var(--success);">当前ROI指数 3.8，高于行业平均。</p>`
            };

            for (let key in responses) {
                if (question.includes(key)) {
                    return responses[key];
                }
            }

            return `<p style="margin-bottom: 12px;">感谢您的提问！</p>
                    <p>我是${CONFIG.luojieName}，${CONFIG.luojieTitle}。关于您的问题"${escapeHtml(question)}"，我需要更多数据来给出准确分析。</p>
                    <p style="margin-top: 12px; color: var(--accent);">建议您提供更具体的参数，或者我可以帮您分析：收入、风险、点位、ROI等维度。</p>`;
        }

        function showTypingIndicator() {
            const conversationBody = document.getElementById('conversation-body');
            const typingHTML = `
                <div class="message assistant" id="typing-message">
                    <div class="message-avatar"></div>
                    <div class="message-content">
                        <div class="typing-indicator">
                            <div class="typing-dot"></div>
                            <div class="typing-dot"></div>
                            <div class="typing-dot"></div>
                        </div>
                    </div>
                </div>
            `;
            conversationBody.insertAdjacentHTML('beforeend', typingHTML);
            scrollToBottom();
        }

        function removeTypingIndicator() {
            const typingMessage = document.getElementById('typing-message');
            if (typingMessage) {
                typingMessage.remove();
            }
        }

        function scrollToBottom() {
            const conversationBody = document.getElementById('conversation-body');
            conversationBody.scrollTop = conversationBody.scrollHeight;
        }

        // ==================== 工具函数 ====================
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function showToast(message, type = 'info') {
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 16px 24px;
                background: ${type === 'success' ? 'var(--success)' : type === 'warning' ? 'var(--warning)' : 'var(--primary)'};
                color: white;
                border-radius: var(--radius-sm);
                box-shadow: var(--shadow-lg);
                z-index: 10000;
                animation: slideIn 0.3s ease;
                display: flex;
                align-items: center;
                gap: 8px;
            `;
            toast.innerHTML = `
                <span>${type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️'}</span>
                <span>${message}</span>
            `;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        // ==================== 数据层：后端 SQLite + REST API 驱动 ====================
        // MOCK 结构保持不变，但内容全部来自 /api/bootstrap（后端 SQL 查询结果）
        let MOCK = {};
        let META = {};                      // KPI / 指标 / 对话历史等附加数据
        let CITY_CACHE = {};                // 城市详情缓存

        // 公网隧道可能用 ?token=xxx 免登录访问，需把 token 透传给后续所有接口
        function apiPath(path) {
            const t = CONFIG.token;
            if (!t) return CONFIG.apiUrl + path;
            return CONFIG.apiUrl + path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
        }

        const API = {
            async get(path) {
                const r = await fetch(apiPath(path), { credentials: 'same-origin' });
                const j = await r.json();
                if (!j.ok) throw new Error(j.message || ('接口错误: ' + path));
                return j.data;
            },
            async post(path, body) {
                const r = await fetch(apiPath(path), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body || {})
                });
                const j = await r.json();
                if (!j.ok) throw new Error(j.message || ('接口错误: ' + path));
                return j.data;
            }
        };

        async function loadAllData() {
            const d = await API.get('/api/bootstrap');
            MOCK = {
                dashboard: d.dashboard, pending: d.pending, mapData: d.mapData,
                messages: d.messages, customerStats: d.customerStats, acquisition: d.acquisition,
                sales: d.sales, progress: d.progress,
                community: d.community, contracts: d.contracts, creative: d.creative,
                agents: d.agents, service: d.service, knowledge: d.knowledge,
                rd: d.rd, roadmap: d.roadmap, daily: d.daily, dataSources: d.dataSources
            };
            META = { kpi: d.kpi, chat: d.chat, metrics: d.metrics, generatedAt: d.generatedAt };
            return d;
        }

        // ---------- 数字/金额格式化 ----------
        function fmtMoney(v) { return '¥' + Number(v || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
        function fmtWan(v) { return (Math.round(Number(v || 0) / 1000) / 10).toFixed(1); }
        function fmtTime(s) {
            if (!s) return '刚刚';
            const t = String(s).replace('T', ' ');
            return t.length >= 16 ? t.slice(5, 16) : t;
        }

        // ---------- 决策页 KPI 卡片（后端实时计算值） ----------
        function hydrateKpi() {
            const grid = document.querySelector('#page-decision .metrics-grid');
            if (!grid || !META.kpi) return;
            grid.innerHTML = META.kpi.map(k => `
                <div class="metric-card ${k.color}">
                    <div class="metric-header">
                        <div class="metric-icon">${k.icon}</div>
                        <div class="metric-trend ${k.trendDir === 'negative' ? 'negative' : 'positive'}">${k.trend || ''}</div>
                    </div>
                    <div class="metric-value">${k.value}</div>
                    <div class="metric-label">${k.label}</div>
                    <div class="metric-detail">${k.detail}</div>
                </div>
            `).join('');
        }

        // ---------- 对话记录（来自 ai_messages 表） ----------
        function chatMessageHtml(m) {
            if (m.role === 'user') {
                return `
                    <div class="message user">
                        <div class="message-avatar">我</div>
                        <div class="message-content">
                            <div class="message-bubble">${escapeHtml(m.content)}</div>
                            <div class="message-meta">${fmtTime(m.createdAt)} · 已回答</div>
                        </div>
                    </div>`;
            }
            return `
                <div class="message assistant">
                    <div class="message-avatar"></div>
                    <div class="message-content">
                        <div class="message-bubble">${m.content}</div>
                        <div class="message-meta">${fmtTime(m.createdAt)} · ${CONFIG.luojieName}</div>
                        <div class="message-tags">
                            <span class="message-tag tag-ai">AI大脑</span>
                            ${m.priorityTag ? `<span class="message-tag tag-priority">${escapeHtml(m.priorityTag)}</span>` : ''}
                            <span class="message-tag tag-category">${escapeHtml(m.category || '智能分析')}</span>
                        </div>
                    </div>
                </div>`;
        }

        function hydrateChat() {
            const body = document.getElementById('conversation-body');
            if (!body || !META.chat) return;
            body.innerHTML = META.chat.messages.map(chatMessageHtml).join('');
            const ts = document.querySelector('.conversation-timestamp');
            const last = META.chat.messages[META.chat.messages.length - 1];
            if (ts && last) ts.textContent = '最近对话 · ' + fmtTime(last.createdAt);
            scrollToBottom();
        }

        // ==================== 写操作（触发后端 SQL 更新） ====================
        async function decidePending(code, action) {
            try {
                const r = await API.post('/api/pending/decision', { code, action });
                showToast(action === 'approve' ? `已批准 ${r.name}` : `已驳回 ${r.name}`, action === 'approve' ? 'success' : 'warning');
                await reloadPage('pending');
            } catch (e) { showToast('操作失败: ' + e.message, 'danger'); }
        }

        async function contactCustomer(id) {
            try {
                const r = await API.post('/api/customers/contact', { id });
                showToast(`已联系 ${r.customer}（第 ${r.follow_count} 次跟进，已入库）`, 'success');
                await reloadPage('messages');
            } catch (e) { showToast('操作失败: ' + e.message, 'danger'); }
        }

        async function callNextCustomer() {
            const list = (MOCK.messages || []).filter(m => m.status === 'urgent' || m.priority === 'urgent');
            const target = list[0] || (MOCK.messages || [])[0];
            if (!target) return showToast('暂无待联系客户', 'warning');
            await contactCustomer(target.id);
        }

        async function updateTicket(code, status) {
            try {
                const r = await API.post('/api/tickets/update', { code, status });
                showToast(`工单 ${r.id} 已更新为 ${r.statusText}`, 'success');
                await reloadPage('service');
            } catch (e) { showToast('操作失败: ' + e.message, 'danger'); }
        }

        async function voteRd(id) {
            try {
                const r = await API.post('/api/rd/vote', { id });
                showToast(`已投票支持「${r.title}」，当前 ${r.votes} 票`, 'success');
                await reloadPage('rd');
            } catch (e) { showToast('操作失败: ' + e.message, 'danger'); }
        }

        async function generateCreative() {
            const client = prompt('输入客户名称（如：宝马）', '宝马');
            if (client === null) return;
            const type = prompt('素材类型：KV / 视频 / 海报 / GIF', 'KV') || 'KV';
            try {
                const r = await API.post('/api/creatives/generate', { client, type });
                showToast(`AI 已生成素材：${r.name}（${r.placement}）`, 'success');
                await reloadPage('creative');
            } catch (e) { showToast('生成失败: ' + e.message, 'danger'); }
        }

        async function syncDataSource(id) {
            try {
                const r = await API.post('/api/datasources/sync', { id });
                showToast(`${r.name} 同步完成 · 延迟 ${r.latency}`, 'success');
                await reloadPage('data');
            } catch (e) { showToast('同步失败: ' + e.message, 'danger'); }
        }
        async function syncAllDataSources() {
            for (const d of (MOCK.dataSources || [])) {
                try { await API.post('/api/datasources/sync', { id: d.id }); } catch (e) { /* 忽略单个失败 */ }
            }
            showToast('全部数据源同步完成', 'success');
            await reloadPage('data');
        }

        // ---------- 只读 SQL 查询控制台（后端仅放行 SELECT / WITH） ----------
        function openSqlConsole() {
            if (document.getElementById('sql-console')) return;
            const box = document.createElement('div');
            box.id = 'sql-console';
            box.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.82);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
            box.innerHTML = `
                <div style="background:var(--dark-card);border:1px solid var(--dark-border);border-radius:var(--radius);width:min(960px,100%);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;">
                    <div style="padding:16px 20px;border-bottom:1px solid var(--dark-border);display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-weight:700;">🔎 SQL 查询控制台 · 只读</div>
                            <div style="font-size:12px;color:var(--text-secondary);">数据库 data/pdooh.db · 仅支持单条 SELECT / WITH 语句 · 最多返回 200 行</div>
                        </div>
                        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('sql-console').remove()">✕ 关闭</button>
                    </div>
                    <div style="padding:16px 20px;">
                        <textarea id="sql-input" rows="4" style="width:100%;background:var(--dark-bg);color:var(--text-primary);border:1px solid var(--dark-border);border-radius:var(--radius-sm);padding:12px;font-family:'Courier New',monospace;font-size:13px;">SELECT c.name AS 城市, COUNT(p.id) AS 点位数, ROUND(AVG(p.revenue),2) AS 点位均收入
FROM cities c JOIN points p ON p.city_id = c.id
GROUP BY c.id ORDER BY 点位数 DESC;</textarea>
                        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                            <button class="btn btn-primary btn-sm" onclick="runSqlConsole()">▶ 执行查询</button>
                            ${[
                                "SELECT * FROM revenue_daily WHERE stat_date=date('now','localtime') ORDER BY amount DESC;",
                                "SELECT status, COUNT(*) AS cnt FROM points GROUP BY status;",
                                "SELECT client, amount, execution FROM contracts ORDER BY execution ASC LIMIT 5;",
                                "SELECT category, COUNT(*) AS cnt, ROUND(SUM(amount_num),1) AS amount_wan FROM pending_items WHERE status='pending' GROUP BY category;"
                            ].map((sql,i)=>`<button class="btn btn-ghost btn-sm" onclick="document.getElementById('sql-input').value=${JSON.stringify(sql).replace(/"/g,'&quot;')};runSqlConsole()">示例 ${i+1}</button>`).join('')}
                        </div>
                    </div>
                    <div id="sql-result" style="padding:0 20px 20px;overflow:auto;flex:1;color:var(--text-secondary);font-size:13px;">请输入 SQL 后点击执行。</div>
                </div>`;
            document.body.appendChild(box);
        }

        async function runSqlConsole() {
            const out = document.getElementById('sql-result');
            const sql = document.getElementById('sql-input').value;
            out.innerHTML = '执行中...';
            try {
                const r = await API.post('/api/sql/query', { sql });
                if (!r.ok) { out.innerHTML = `<span style="color:var(--danger);">${escapeHtml(r.message)}</span>`; return; }
                if (!r.rows.length) { out.innerHTML = '查询成功，无数据（0 行）'; return; }
                const cols = r.columns;
                out.innerHTML = `
                    <div style="margin-bottom:8px;color:var(--accent);">查询成功 · ${r.rowCount} 行 · 耗时 ${r.elapsedMs} ms</div>
                    <table class="data-table" style="width:100%;">
                        <thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
                        <tbody>${r.rows.map(row => `<tr>${cols.map(c => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
                    </table>`;
            } catch (e) {
                out.innerHTML = `<span style="color:var(--danger);">SQL 执行失败: ${escapeHtml(e.message)}</span>`;
            }
        }

        // ---------- 每日日报：提交 & 导出 ----------
        function openDailyForm() {
            if (document.getElementById('daily-form')) return;
            const box = document.createElement('div');
            box.id = 'daily-form';
            box.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.82);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
            box.innerHTML = `
                <div style="background:var(--dark-card);border:1px solid var(--dark-border);border-radius:var(--radius);width:min(640px,100%);padding:22px;">
                    <div style="font-weight:700;font-size:17px;margin-bottom:14px;">✍️ 写日报</div>
                    <input id="df-title" placeholder="日报标题（必填）" style="width:100%;margin-bottom:10px;padding:10px;background:var(--dark-bg);color:var(--text-primary);border:1px solid var(--dark-border);border-radius:8px;">
                    <div style="display:flex;gap:10px;margin-bottom:10px;">
                        <input id="df-author" placeholder="姓名（必填）" value="小李" style="flex:1;padding:10px;background:var(--dark-bg);color:var(--text-primary);border:1px solid var(--dark-border);border-radius:8px;">
                        <input id="df-dept" placeholder="部门" value="销售部" style="flex:1;padding:10px;background:var(--dark-bg);color:var(--text-primary);border:1px solid var(--dark-border);border-radius:8px;">
                    </div>
                    <textarea id="df-done" rows="3" placeholder="今日完成（每行一条）&#10;宝马签约 ¥8.5万&#10;可口可乐方案反馈" style="width:100%;margin-bottom:10px;padding:10px;background:var(--dark-bg);color:var(--text-primary);border:1px solid var(--dark-border);border-radius:8px;"></textarea>
                    <textarea id="df-plan" rows="3" placeholder="明日计划（每行一条）&#10;宝马珠江新城物料上线" style="width:100%;margin-bottom:14px;padding:10px;background:var(--dark-bg);color:var(--text-primary);border:1px solid var(--dark-border);border-radius:8px;"></textarea>
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('daily-form').remove()">取消</button>
                        <button class="btn btn-primary btn-sm" onclick="submitDailyForm()">提交日报</button>
                    </div>
                </div>`;
            document.body.appendChild(box);
        }

        async function submitDailyForm() {
            const val = id => (document.getElementById(id) || {}).value || '';
            const lines = t => t.split('\n').map(x => x.trim()).filter(Boolean);
            try {
                const r = await API.post('/api/daily/submit', {
                    title: val('df-title'), author: val('df-author'), dept: val('df-dept'),
                    done: lines(val('df-done')), plan: lines(val('df-plan'))
                });
                document.getElementById('daily-form').remove();
                showToast(`日报已提交并入库（#${r.id} · 完成 ${r.done} 条 / 计划 ${r.plan} 条）`, 'success');
                await reloadPage('daily');
            } catch (e) { showToast('提交失败: ' + e.message, 'danger'); }
        }

        function exportDaily() {
            const rows = [['日期', '标题', '作者', '部门', '类型', '内容']];
            (MOCK.daily || []).forEach(d => {
                (d.done || []).forEach(c => rows.push([d.date || '', d.title, d.author, d.dept, '今日完成', c]));
                (d.plan || []).forEach(c => rows.push([d.date || '', d.title, d.author, d.dept, '明日计划', c]));
            });
            const esc = v => `"${String(v).replace(/"/g, '""')}"`;
            const blob = new Blob(['\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'pdooh-daily-reports.csv';
            a.click();
            URL.revokeObjectURL(a.href);
            showToast('日报已导出 CSV', 'success');
        }

        async function readKnowledge(title, id) {
            try {
                const docs = await API.get('/api/knowledge');
                const doc = docs.find(d => d.id === id) || docs.find(d => d.title === title);
                if (!doc) throw new Error('文档不存在');
                await API.post('/api/datasources/sync', { id: 5 });
                alert(`《${doc.title}》\n\n分类：${doc.category}\n浏览：${doc.views}\n标签：${(doc.tags || []).join(' / ')}\n\n${doc.content}`);
                await reloadPage('knowledge');
            } catch (e) { showToast('读取失败: ' + e.message, 'danger'); }
        }

        async function pushBattleReport() {
            try {
                const s = await API.get('/api/sales');
                showToast(`战报已推送：本月 ${s.summary.deals} 单 / ¥${s.summary.amount_wan}万 / 达成率 ${s.summary.avg_rate}%`, 'success');
            } catch (e) { showToast('推送失败: ' + e.message, 'danger'); }
        }

        async function showCampaignDetail(name) {
            try {
                const list = await API.get('/api/campaigns');
                const c = list.find(x => x.name === name);
                if (!c) throw new Error('计划不存在');
                alert(`投放计划：${c.name}\n客户：${c.client}\n周期：${c.start} ~ ${c.end}\n进度：${c.percent}%（${c.statusText}）\n预算：¥${c.budget}万 / 已执行：¥${c.spend}万（${c.spendRate}%）`);
            } catch (e) { showToast('查询失败: ' + e.message, 'danger'); }
        }

        async function showContractDetail(id) {
            try {
                const list = await API.get('/api/contracts');
                const c = list.find(x => x.id === id);
                if (!c) throw new Error('合同不存在');
                alert(`合同：${c.id}\n客户：${c.client}\n金额：${c.amount}\n周期：${c.start} ~ ${c.end}\n履约进度：${c.execution}%（已兑现 ¥${c.fulfilled_wan}万）\n状态：${c.statusText}`);
            } catch (e) { showToast('查询失败: ' + e.message, 'danger'); }
        }

        async function showCommunityPoints(name) {
            try {
                const r = await API.get('/api/analytics/points');
                const city = r.byCity[0];
                alert(`${name}\n\n全域点位：${r.total.cnt} 个 / ${r.total.communities} 个社区单元\n月触达：${(r.total.reach / 10000).toFixed(1)} 万人次\n最大覆盖城市：${city.city}（${city.cnt} 个）\n点位均收入：${fmtMoney(r.total.avg_revenue)}`);
            } catch (e) { showToast('查询失败: ' + e.message, 'danger'); }
        }

        async function showAgentDoc(doc) {
            showToast(`正在打开调用文档 ${doc}`, 'info');
            try {
                const agents = await API.get('/api/agents');
                const a = agents.find(x => x.doc === doc);
                if (a) alert(`${a.name}\n\n接口：${a.endpoint}\n累计调用：${a.calls.toLocaleString()}\n当前 QPS：${a.qps}\n状态：${a.status}\n文档：${a.doc}`);
            } catch (e) { /* ignore */ }
        }

        async function reloadPage(pageId) {
            try {
                await loadAllData();
                if (PAGE_RENDERERS[pageId]) {
                    const el = document.getElementById('page-' + pageId);
                    if (el) el.innerHTML = PAGE_RENDERERS[pageId]();
                }
                hydrateKpi();
                bindFilterTags();
            } catch (e) { console.error(e); }
        }

        // ==================== 工具：渲染公共组件 ====================
        function renderKPI(stats) {
            return `<div class="metrics-grid">${stats.map(s => `
                <div class="metric-card ${s.color}">
                    <div class="metric-header">
                        <div class="metric-icon">${s.icon}</div>
                    </div>
                    <div class="metric-value">${s.value}</div>
                    <div class="metric-label">${s.label}</div>
                    <div class="metric-detail">${s.trend}</div>
                </div>
            `).join('')}</div>`;
        }

        function renderPagination() {
            return `<div class="pagination">
                <span class="pagination-item disabled">‹ 上一页</span>
                <span class="pagination-item active">1</span>
                <span class="pagination-item">2</span>
                <span class="pagination-item">3</span>
                <span class="pagination-item">...</span>
                <span class="pagination-item">12</span>
                <span class="pagination-item">下一页 ›</span>
            </div>`;
        }

        // ==================== 各页面渲染函数 ====================

        // 01 今日工作台
        // ==================== 今日工作台：实时同步引擎 ====================
        // 1) 时钟每秒走字（本地，不请求后端）
        // 2) 每 30 秒拉一次 /api/overview + /api/dashboard，问候语/天气/KPI 全部刷新
        // 3) 仅在「今日工作台」页可见时运行，切走即停，避免无谓请求
        const LIVE = { clockTimer: null, pollTimer: null, lastPoll: 0, polling: false };

        function startDashboardLive() {
            stopDashboardLive();
            LIVE.clockTimer = setInterval(tickClock, 1000);
            tickClock();
            LIVE.pollTimer = setInterval(pollOverview, 30000);
            pollOverview();          // 进入页面立即刷新一次
        }

        function stopDashboardLive() {
            if (LIVE.clockTimer) { clearInterval(LIVE.clockTimer); LIVE.clockTimer = null; }
            if (LIVE.pollTimer) { clearInterval(LIVE.pollTimer); LIVE.pollTimer = null; }
        }

        function tickClock() {
            const el = document.getElementById('hero-clock');
            if (!el) return;
            const d = new Date();
            const p = n => String(n).padStart(2, '0');
            el.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        }

        function setText(id, text) {
            const el = document.getElementById(id);
            if (el && el.textContent !== text) el.textContent = text;
        }

        // 数字变化时闪一下，让"动起来"看得见
        function setValue(id, text) {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.textContent === text) return;
            el.textContent = text;
            el.classList.remove('flash');
            void el.offsetWidth;          // 触发重排以重启动画
            el.classList.add('flash');
            setTimeout(() => el.classList.remove('flash'), 1000);
        }

        function applyOverview(o) {
            if (!o) return;
            const w = o.weather || {};
            const k = o.kpi || {};
            setText('hero-greeting', `${o.greeting || '你好'}，${o.user || 'Tom'} 👋`);
            setText('hero-dateline', `今天是 ${o.dateText || ''} · ${o.weekday || ''}`);
            setText('hero-weather', w.unavailable
                ? `${o.city || '广州'} · 天气服务暂不可用`
                : `${w.city || o.city} · ${w.temp}°C ${w.text} ${w.icon || ''}${w.high != null ? ` · ${w.low}~${w.high}°C` : ''}${w.stale ? ' (缓存)' : ''}`);
            setValue('hero-kpi-revenue', (k.revenue && k.revenue.text) || '¥0.0万');
            const trendEl = document.getElementById('hero-kpi-revenue-trend');
            if (trendEl && k.revenue) {
                trendEl.textContent = k.revenue.trendText || '';
                trendEl.classList.toggle('down', k.revenue.dir === 'down');
            }
            setValue('hero-kpi-risk', (k.risk && k.risk.text) || '0');
            setText('hero-kpi-risk-count', `(${(k.risk && k.risk.count) || 0} 项)`);
            setValue('hero-kpi-points', (k.points && k.points.text) || '0');
            setText('hero-kpi-points-sub', `${(k.points && k.points.communities) || 0} 个社区单元`);
            setText('hero-updated', o.updatedAt || '—');
        }

        async function pollOverview() {
            if (LIVE.polling) return;
            if (!document.getElementById('hero-greeting')) return;   // 不在工作台页则跳过
            LIVE.polling = true;
            try {
                const o = await API.get('/api/overview');
                MOCK.overview = o;
                applyOverview(o);
                LIVE.lastPoll = Date.now();
            } catch (e) {
                console.warn('工作台实时刷新失败:', e.message);
            } finally {
                LIVE.polling = false;
            }
        }

        function renderDashboard() {
            const d = MOCK.dashboard;
            const o = MOCK.overview || {};
            const w = o.weather || {};
            const k = o.kpi || {};
            const weatherText = w.unavailable
                ? `${o.city || '广州'} · 天气服务暂不可用`
                : `${w.city || o.city} · ${w.temp}°C ${w.text} ${w.icon || ''}${w.high != null ? ` · ${w.low}~${w.high}°C` : ''}${w.stale ? ' (缓存)' : ''}`;
            return `
                <div class="hero-banner">
                    <div class="hero-top">
                        <div>
                            <div class="hero-greeting" id="hero-greeting">${o.greeting || '你好'}，${o.user || 'Tom'} 👋</div>
                            <div class="hero-subtitle">
                                <span id="hero-dateline">今天是 ${o.dateText || ''} · ${o.weekday || ''}</span>
                                <span> · </span>
                                <span id="hero-weather">${weatherText}</span>
                            </div>
                        </div>
                        <div class="hero-live">
                            <span class="live-dot"></span>
                            <span id="hero-clock">${o.timeText || ''}</span>
                            <span class="live-hint">数据实时同步</span>
                        </div>
                    </div>
                    <div class="hero-stats">
                        <div class="hero-stat-item">
                            <div class="hero-stat-value" id="hero-kpi-revenue">${(k.revenue && k.revenue.text) || '¥0.0万'}</div>
                            <div class="hero-stat-label">
                                今日投放收入
                                <span class="hero-trend ${(k.revenue && k.revenue.dir) === 'down' ? 'down' : ''}" id="hero-kpi-revenue-trend">${(k.revenue && k.revenue.trendText) || ''}</span>
                            </div>
                        </div>
                        <div class="hero-stat-item">
                            <div class="hero-stat-value"><span id="hero-kpi-risk">${(k.risk && k.risk.text) || '0'}</span><span class="hero-unit">万</span></div>
                            <div class="hero-stat-label">待签约风险 <span id="hero-kpi-risk-count">(${(k.risk && k.risk.count) || 0} 项)</span></div>
                        </div>
                        <div class="hero-stat-item">
                            <div class="hero-stat-value" id="hero-kpi-points">${(k.points && k.points.text) || '0'}</div>
                            <div class="hero-stat-label">点位覆盖数 <span id="hero-kpi-points-sub">${(k.points && k.points.communities) || 0} 个社区单元</span></div>
                        </div>
                        <div class="hero-stat-item hero-updated">
                            最后更新<br><span id="hero-updated">${o.updatedAt || '—'}</span>
                        </div>
                    </div>
                </div>
                ${renderKPI(d.stats)}
                <div class="page-grid cols-2-1">
                    <div class="data-card">
                        <div class="data-card-header">
                            <div class="data-card-title">🕐 今日日程</div>
                            <span class="badge badge-primary">${d.schedule.length} 项</span>
                        </div>
                        <div class="list">
                            ${d.schedule.map(s => `
                                <div class="list-item">
                                    <div class="list-item-avatar" style="background: var(--gradient-secondary);">${s.icon}</div>
                                    <div class="list-item-main">
                                        <div class="list-item-title">${s.title}</div>
                                        <div class="list-item-meta"><span>${s.time}</span><span>·</span><span>${s.type}</span></div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="page-grid" style="gap: 20px;">
                        <div class="data-card">
                            <div class="data-card-header">
                                <div class="data-card-title">🔔 关键提醒</div>
                                <span class="badge badge-danger">${d.reminders.length} 条</span>
                            </div>
                            <div class="data-card-body">
                                ${d.reminders.map(r => `
                                    <div style="padding: 10px 0; border-bottom: 1px solid var(--dark-border); font-size: 13px;">
                                        <span style="margin-right: 8px;">${r.icon}</span>${r.text}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        <div class="data-card">
                            <div class="data-card-header">
                                <div class="data-card-title">👥 团队打卡</div>
                                <span class="badge badge-success">5 / 6 在线</span>
                            </div>
                            <div class="data-card-body">
                                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                                    ${d.team.map(m => `
                                        <div style="text-align: center; padding: 12px; background: var(--dark-bg); border-radius: var(--radius-sm);">
                                            <div class="list-item-avatar" style="margin: 0 auto 8px; background: var(--gradient-primary);">${m.avatar}</div>
                                            <div style="font-size: 13px; font-weight: 600;">${m.name}</div>
                                            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${m.task}</div>
                                            <div style="margin-top: 6px;"><span class="status-light ${m.status}"></span>
                                                <span style="font-size: 10px; color: var(--text-secondary); margin-left: 4px;">${m.status === 'online' ? '在线' : m.status === 'busy' ? '忙碌' : '离线'}</span>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // 02 待确认
        function renderPending() {
            const p = MOCK.pending;
            function section(title, icon, items, typeLabel) {
                return `
                    <div class="data-card" style="margin-bottom: 20px;">
                        <div class="data-card-header">
                            <div class="data-card-title">${icon} ${title}</div>
                            <div class="flex gap-10 align-center">
                                <span class="badge badge-default">${items.length} 条</span>
                                <div class="search-box" style="min-width: 180px;"><input placeholder="搜索 ${typeLabel}..." /></div>
                            </div>
                        </div>
                        <table class="data-table">
                            <thead><tr><th>编号</th><th>${typeLabel}名称</th><th>客户</th><th>金额</th><th>${typeLabel === '点位' ? '剩余天数' : typeLabel === '合同' ? '剩余天数' : '优先级'}</th><th>状态</th><th>操作</th></tr></thead>
                            <tbody>
                                ${items.map(it => `
                                    <tr>
                                        <td style="font-family: 'Courier New', monospace; color: var(--accent); font-size: 12px;">${it.id}</td>
                                        <td style="font-weight: 600;">${it.name}</td>
                                        <td>${it.client}</td>
                                        <td style="color: var(--success); font-weight: 600;">${it.amount}</td>
                                        <td>${it.days !== undefined ? it.days + ' 天' : it.priority}</td>
                                        <td><span class="badge badge-${it.badge}">${it.badgeText}</span></td>
                                        <td>
                                            <button class="btn btn-primary btn-sm" onclick="decidePending('${it.id}','approve')">批准</button>
                                            <button class="btn btn-ghost btn-sm" style="margin-left: 4px;" onclick="decidePending('${it.id}','reject')">驳回</button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            }
            return `
                <div class="filter-tags">
                    <span class="filter-tag active">全部 (11)</span>
                    <span class="filter-tag">点位审批 (4)</span>
                    <span class="filter-tag">合同签字 (4)</span>
                    <span class="filter-tag">素材审核 (3)</span>
                    <span class="filter-tag">仅紧急 (3)</span>
                </div>
                ${section('点位审批', '📍', p.spots, '点位')}
                ${section('合同签字', '📝', p.contracts, '合同')}
                ${section('素材审核', '🎨', p.creatives, '素材')}
                ${renderPagination()}
            `;
        }

        // 04 投放作战地图
        function renderMap() {
            const m = MOCK.mapData;
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">🗺️ 粤港澳大湾区实时作战地图</div>
                        <div class="page-header-subtitle">${m.cities.reduce((s, c) => s + c.total, 0)} 个点位 · 5 城覆盖 · 实时同步</div>
                    </div>
                    <div class="tabs" id="city-tabs" style="margin: 0;">
                        ${m.cities.map((c, i) => `<span class="tab-item ${i === 0 ? 'active' : ''}" onclick="switchCity('${c.id}')">${c.name}</span>`).join('')}
                    </div>
                </div>
                <div class="page-grid cols-2-1">
                    <div class="map-canvas" id="map-canvas">
                        <div class="map-legend">
                            <div class="map-legend-title">点位状态</div>
                            <div class="map-legend-item"><span class="map-legend-dot" style="background: var(--primary);"></span>在线 (2,184)</div>
                            <div class="map-legend-item"><span class="map-legend-dot" style="background: var(--success);"></span>高活跃 (1,062)</div>
                            <div class="map-legend-item"><span class="map-legend-dot" style="background: var(--warning);"></span>中等 (988)</div>
                            <div class="map-legend-item"><span class="map-legend-dot" style="background: var(--danger);"></span>异常 (134)</div>
                        </div>
                        ${m.dots.map(d => `<div class="map-dot ${d.type}" style="left: ${d.x}%; top: ${d.y}%;" data-count="${d.count} 个点位"></div>`).join('')}
                    </div>
                    <div class="data-card">
                        <div class="data-card-header">
                            <div class="data-card-title">📊 城市点位统计</div>
                        </div>
                        <div class="list">
                            ${m.cities.map(c => `
                                <div class="list-item">
                                    <div class="list-item-avatar" style="background: var(--gradient-secondary);">${c.name.charAt(0)}</div>
                                    <div class="list-item-main">
                                        <div class="list-item-title">${c.name}</div>
                                        <div class="list-item-meta">
                                            <span>智能屏 ${c.smartScreen}</span><span>门禁 ${c.door}</span>
                                            <span>道闸 ${c.gate}</span><span>电梯 ${c.elevator}</span>
                                        </div>
                                    </div>
                                    <div class="list-item-right">
                                        <div style="font-size: 20px; font-weight: 800; color: var(--primary);">${c.total}</div>
                                        <div style="font-size: 11px; color: var(--warning);">🔥 ${c.hot} 热区</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        // 切换城市：调用 /api/map/city 从数据库拉取该城市点位统计
        async function switchCity(cityId) {
            document.querySelectorAll('#city-tabs .tab-item').forEach(t => t.classList.remove('active'));
            if (event && event.target) event.target.classList.add('active');
            const city = MOCK.mapData.cities.find(c => c.id === cityId);
            try {
                if (!CITY_CACHE[cityId]) CITY_CACHE[cityId] = await API.get('/api/map/city?id=' + cityId);
                const d = CITY_CACHE[cityId];
                const top = d.topPoints[0];
                showToast(`${city.name}：${city.total} 个点位 · 30天收入 ${fmtMoney(d.revenue30d.amount)} · 均值 ${fmtMoney(d.byType[0].avg_revenue)}`, 'info');
                console.log(`[${city.name}] 点位统计`, d, '收入最高点位:', top);
            } catch (e) {
                showToast(`已切换到 ${city.name} · 共 ${city.total} 个点位`, 'info');
            }
            const canvas = document.getElementById('map-canvas');
            if (canvas) {
                canvas.querySelectorAll('.map-dot').forEach(dot => {
                    const active = MOCK.mapData.dots.some(x => x.city === cityId);
                    dot.style.opacity = active ? '1' : '0.45';
                });
            }
        }

        // 05 客户待跟进
        function renderMessages() {
            const list = MOCK.messages || [];
            const st = MOCK.customerStats || {};
            const stageBadge = { lead: 'info', interest: 'primary', proposal: 'warning', signed: 'success' };
            const stageLabel = { lead: '线索', interest: '意向', proposal: '方案', signed: '签约' };
            const cur = FILTERS.customerStage || 'all';
            const shown = cur === 'all' ? list : list.filter(m => m.stage === cur);
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">📞 客户待跟进 / 获客 CRM</div>
                        <div class="page-header-subtitle">共 ${st.total || list.length} 个客户 · 本周新增 ${st.new_this_week || 0} · 未分配 ${st.unassigned || 0} · 意向总额 ¥${st.budget_wan || 0}万</div>
                    </div>
                    <div class="flex gap-10">
                        <div class="search-box"><input id="cust-search" placeholder="搜索客户 / 联系人 / 电话..." onkeydown="if(event.key==='Enter')searchCustomers(this.value)" /></div>
                        <button class="btn btn-ghost btn-sm" onclick="searchCustomers('')">🔄 重置</button>
                        <button class="btn btn-primary btn-sm" onclick="openCustomerForm()">➕ 新增客户</button>
                    </div>
                </div>
                ${renderKPI([
                    { label: '客户总数', value: String(st.total || list.length), icon: '👥', color: 'primary', trend: `本周新增 ${st.new_this_week || 0}` },
                    { label: '公开留资', value: String(st.from_public || 0), icon: '🌐', color: 'info', trend: '来自获客落地页' },
                    { label: '已签约', value: String(st.signed || 0), icon: '✅', color: 'success', trend: `转化率 ${st.total ? ((st.signed / st.total) * 100).toFixed(1) : 0}%` },
                    { label: '未分配', value: String(st.unassigned || 0), icon: '⏳', color: 'warning', trend: '待指派负责人' }
                ])}
                <div class="filter-tags">
                    <span class="filter-tag ${cur === 'all' ? 'active' : ''}" onclick="setCustomerStage('all')">全部 (${list.length})</span>
                    <span class="filter-tag ${cur === 'lead' ? 'active' : ''}" onclick="setCustomerStage('lead')">线索 (${list.filter(x => x.stage === 'lead').length})</span>
                    <span class="filter-tag ${cur === 'interest' ? 'active' : ''}" onclick="setCustomerStage('interest')">意向 (${list.filter(x => x.stage === 'interest').length})</span>
                    <span class="filter-tag ${cur === 'proposal' ? 'active' : ''}" onclick="setCustomerStage('proposal')">方案 (${list.filter(x => x.stage === 'proposal').length})</span>
                    <span class="filter-tag ${cur === 'signed' ? 'active' : ''}" onclick="setCustomerStage('signed')">签约 (${list.filter(x => x.stage === 'signed').length})</span>
                </div>
                <div class="data-card">
                    <div class="list">
                        ${shown.length === 0 ? '<div style="padding:32px;text-align:center;color:var(--text-secondary);">没有符合条件的客户，点击右上角「➕ 新增客户」开始录入</div>' : ''}
                        ${shown.map(m => `
                            <div class="list-item">
                                <div class="list-item-avatar">${m.avatar}</div>
                                <div class="list-item-main">
                                    <div class="list-item-title">
                                        ${m.name} · ${m.contact}
                                        <span class="badge badge-${stageBadge[m.stage] || 'info'}" style="margin-left:6px;">${m.stageText || stageLabel[m.stage] || m.stage}</span>
                                        ${m.isPublic ? '<span class="badge badge-primary" style="margin-left:4px;">🌐 公开留资</span>' : ''}
                                    </div>
                                    <div class="list-item-meta">
                                        <span>📋 ${m.task}</span>
                                        ${m.phone ? `<span>📱 ${m.phone}</span>` : ''}
                                        ${m.owner ? `<span>👤 ${m.owner}</span>` : ''}
                                        ${m.budgetWan ? `<span>💰 意向 ¥${m.budgetWan}万</span>` : ''}
                                        <span>🏷️ ${m.source || '手动录入'}</span>
                                        <span>⏰ ${m.last}</span>
                                    </div>
                                </div>
                                <div class="list-item-actions">
                                    <button class="btn btn-primary btn-sm" onclick="contactCustomer(${m.id})">📞 联系</button>
                                    <button class="btn btn-ghost btn-sm" onclick="advanceStage(${m.id})">⬆ 推进</button>
                                    <button class="btn btn-ghost btn-sm" onclick="openCustomerDetail(${m.id})">👁 详情</button>
                                    <button class="btn btn-ghost btn-sm" onclick="openCustomerForm(${m.id})">✏️ 编辑</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // ---------- 客户页交互 ----------
        let FILTERS = { customerStage: 'all', customerKw: '' };

        function setCustomerStage(stage) {
            FILTERS.customerStage = stage;
            reloadPage('messages');
        }

        async function searchCustomers(kw) {
            FILTERS.customerKw = kw || '';
            try {
                const d = await API.get('/api/customers' + (kw ? '?kw=' + encodeURIComponent(kw) : ''));
                MOCK.messages = d.list;
                MOCK.customerStats = d.stats;
                reloadPage('messages');
                showToast(kw ? `搜索「${kw}」命中 ${d.list.length} 条` : '已重置搜索', 'info');
            } catch (e) { showToast('搜索失败: ' + e.message, 'danger'); }
        }

        // 新增 / 编辑客户表单
        function openCustomerForm(id) {
            const c = id ? (MOCK.messages || []).find(x => x.id === id) : null;
            if (document.getElementById('cust-form')) document.getElementById('cust-form').remove();
            const box = document.createElement('div');
            box.id = 'cust-form';
            box.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.82);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
            const f = (label, key, ph, type = 'text') =>
                `<div style="flex:1;min-width:200px;">
                   <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">${label}</div>
                   <input id="cf-${key}" type="${type}" placeholder="${ph}" value="${c && c[key] !== undefined && c[key] !== null ? String(c[key]).replace(/"/g, '&quot;') : ''}"
                     style="width:100%;padding:9px;background:var(--dark-bg);color:var(--text-primary);border:1px solid var(--dark-border);border-radius:8px;">
                 </div>`;
            const sel = (label, key, opts, cur) =>
                `<div style="flex:1;min-width:200px;">
                   <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">${label}</div>
                   <select id="cf-${key}" style="width:100%;padding:9px;background:var(--dark-bg);color:var(--text-primary);border:1px solid var(--dark-border);border-radius:8px;">
                     ${opts.map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`).join('')}
                   </select>
                 </div>`;
            box.innerHTML = `
                <div style="background:var(--dark-card);border:1px solid var(--dark-border);border-radius:var(--radius);width:min(760px,100%);max-height:88vh;overflow:auto;padding:22px;">
                    <div style="font-weight:700;font-size:17px;margin-bottom:4px;">${c ? '✏️ 编辑客户' : '➕ 新增客户 / 线索'}</div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">录入后立即写入数据库，可在「获客中心」看到来源与转化统计</div>
                    <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
                        ${f('客户 / 公司名称 *', 'name', '如：蒙牛华南区')}
                        ${f('联系人 *', 'contact', '如：周主管')}
                    </div>
                    <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
                        ${f('联系电话 *', 'phone', '如：138-0000-0000')}
                        ${f('邮箱', 'email', 'name@company.com')}
                    </div>
                    <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
                        ${f('公司全称', 'company', '营业执照名称')}
                        ${f('行业', 'industry', '快消 / 汽车 / 日化 ...')}
                    </div>
                    <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
                        ${sel('获客来源', 'source', [['手动录入', '手动录入'], ['官网留资', '官网留资'], ['转介绍', '转介绍'], ['展会获客', '展会获客'], ['电话开发', '电话开发'], ['地推拜访', '地推拜访'], ['其他', '其他']], c ? c.source : '手动录入')}
                        ${sel('阶段', 'stage', [['lead', '线索'], ['interest', '意向'], ['proposal', '方案'], ['signed', '签约']], c ? c.stage : 'lead')}
                        ${sel('优先级', 'priority', [['urgent', '紧急'], ['high', '高'], ['medium', '中'], ['low', '低']], c ? c.priority : 'medium')}
                    </div>
                    <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
                        ${f('意向预算(万元)', 'budgetWan', '如：60', 'number')}
                        ${f('负责人', 'owner', '如：小李', 'text')}
                    </div>
                    <div style="margin-bottom:14px;">
                        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">当前待办</div>
                        <input id="cf-task" placeholder="如：确认 Q4 投放点位" value="${c && c.task ? String(c.task).replace(/"/g, '&quot;') : ''}"
                          style="width:100%;padding:9px;background:var(--dark-bg);color:var(--text-primary);border:1px solid var(--dark-border);border-radius:8px;">
                    </div>
                    <div style="margin-bottom:16px;">
                        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">备注</div>
                        <textarea id="cf-note" rows="2" placeholder="补充说明..." style="width:100%;padding:9px;background:var(--dark-bg);color:var(--text-primary);border:1px solid var(--dark-border);border-radius:8px;">${c && c.note ? c.note : ''}</textarea>
                    </div>
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        ${c ? `<button class="btn btn-ghost btn-sm" onclick="removeCustomer(${c.id})" style="margin-right:auto;color:var(--danger);">🗑 删除客户</button>` : ''}
                        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('cust-form').remove()">取消</button>
                        <button class="btn btn-primary btn-sm" onclick="submitCustomerForm(${c ? c.id : 'null'})">${c ? '保存修改' : '确认录入'}</button>
                    </div>
                </div>`;
            document.body.appendChild(box);
        }

        async function submitCustomerForm(id) {
            const v = k => { const el = document.getElementById('cf-' + k); return el ? el.value.trim() : ''; };
            const payload = {
                name: v('name'), contact: v('contact'), phone: v('phone'), email: v('email'),
                company: v('company'), industry: v('industry'), source: v('source'), stage: v('stage'),
                priority: v('priority'), budgetWan: Number(v('budgetWan')) || 0, owner: v('owner'),
                task: v('task'), note: v('note')
            };
            if (!payload.name || !payload.contact) return showToast('客户名称与联系人为必填', 'warning');
            try {
                if (id) payload.id = id;
                const r = await API.post(id ? '/api/customers/update' : '/api/customers/create', payload);
                document.getElementById('cust-form').remove();
                showToast(id ? `已保存「${payload.name}」` : `已录入客户「${payload.name}」`, 'success');
                await reloadPage('messages');
            } catch (e) { showToast('保存失败: ' + e.message, 'danger'); }
        }

        async function removeCustomer(id) {
            const c = (MOCK.messages || []).find(x => x.id === id);
            if (!confirm(`确认删除客户「${c ? c.name : id}」？其跟进记录也会一并删除。`)) return;
            try {
                await API.post('/api/customers/delete', { id });
                document.getElementById('cust-form').remove();
                showToast('客户已删除', 'warning');
                await reloadPage('messages');
            } catch (e) { showToast('删除失败: ' + e.message, 'danger'); }
        }

        const STAGE_FLOW = ['lead', 'interest', 'proposal', 'signed'];
        const STAGE_CN = { lead: '线索', interest: '意向', proposal: '方案', signed: '签约' };
        async function advanceStage(id) {
            const c = (MOCK.messages || []).find(x => x.id === id);
            if (!c) return;
            const i = STAGE_FLOW.indexOf(c.stage);
            if (i >= STAGE_FLOW.length - 1) return showToast(`「${c.name}」已处于最终阶段（签约）`, 'info');
            const next = STAGE_FLOW[i + 1];
            if (!confirm(`将「${c.name}」从「${STAGE_CN[c.stage]}」推进到「${STAGE_CN[next]}」？`)) return;
            try {
                const r = await API.post('/api/customers/stage', { id, stage: next });
                showToast(`已推进到「${STAGE_CN[next]}」（已写入跟进记录）`, 'success');
                await reloadPage('messages');
            } catch (e) { showToast('推进失败: ' + e.message, 'danger'); }
        }

        async function openCustomerDetail(id) {
            try {
                const d = await API.get('/api/customers/detail?id=' + id);
                const c = d.customer;
                if (document.getElementById('cust-detail')) document.getElementById('cust-detail').remove();
                const box = document.createElement('div');
                box.id = 'cust-detail';
                box.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.82);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
                box.innerHTML = `
                    <div style="background:var(--dark-card);border:1px solid var(--dark-border);border-radius:var(--radius);width:min(620px,100%);max-height:86vh;overflow:auto;padding:22px;">
                        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:14px;">
                            <div>
                                <div style="font-weight:700;font-size:18px;">${c.name}</div>
                                <div style="font-size:13px;color:var(--text-secondary);">${c.contact}${c.phone ? ' · ' + c.phone : ''}</div>
                            </div>
                            <span class="badge badge-primary">${c.stageText}</span>
                        </div>
                        <div class="data-card" style="padding:14px;margin-bottom:14px;">
                            ${[['公司全称', c.company], ['行业', c.industry], ['邮箱', c.email], ['获客来源', c.source],
                               ['意向预算', c.budgetWan ? '¥' + c.budgetWan + '万' : '未填写'], ['负责人', c.owner || '未分配'],
                               ['当前待办', c.task], ['录入时间', c.createdAt], ['跟进次数', c.followCount + ' 次'],
                               ['备注', c.note || '—']].map(([k, v]) =>
                                `<div style="display:flex;gap:10px;padding:5px 0;font-size:13px;">
                                   <span style="color:var(--text-secondary);min-width:76px;">${k}</span>
                                   <span>${v === undefined || v === null || v === '' ? '—' : String(v)}</span>
                                 </div>`).join('')}
                        </div>
                        <div style="font-weight:600;margin-bottom:8px;">📝 跟进记录（${d.logs.length}）</div>
                        <div style="max-height:220px;overflow:auto;">
                            ${d.logs.map(l => `
                                <div style="padding:8px 0;border-bottom:1px solid var(--dark-border);font-size:13px;">
                                    <span class="badge badge-${l.kind === 'stage' ? 'success' : l.kind === 'create' ? 'primary' : 'info'}" style="margin-right:6px;">${{ create: '录入', follow: '跟进', stage: '阶段', edit: '编辑' }[l.kind] || l.kind}</span>
                                    ${l.note}
                                    <div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">${l.createdAt}</div>
                                </div>`).join('')}
                        </div>
                        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
                            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('cust-detail').remove()">关闭</button>
                            <button class="btn btn-primary btn-sm" onclick="contactCustomer(${c.id});document.getElementById('cust-detail').remove()">📞 记录一次联系</button>
                        </div>
                    </div>`;
                document.body.appendChild(box);
            } catch (e) { showToast('详情加载失败: ' + e.message, 'danger'); }
        }

        // ---------- 17 获客中心 ----------
        function renderAcquisition() {
            const a = MOCK.acquisition || { stats: {}, bySource: [], byStage: [], byOwner: [], trend: [], conversion: {} };
            const link = leadPageUrl();
            const maxTrend = Math.max(1, ...a.trend.map(t => t.cnt));
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">🎯 获客中心</div>
                        <div class="page-header-subtitle">公开留资入口 + 线索来源分析 + 转化漏斗</div>
                    </div>
                    <div class="flex gap-10">
                        <button class="btn btn-ghost btn-sm" onclick="copyLeadLink()">🔗 复制留资链接</button>
                        <button class="btn btn-ghost btn-sm" onclick="openLeadPreview()">👁 预览落地页</button>
                        <button class="btn btn-primary btn-sm" onclick="openCustomerForm()">➕ 手动录入客户</button>
                    </div>
                </div>
                ${renderKPI([
                    { label: '客户总数', value: String(a.stats.total || 0), icon: '👥', color: 'primary', trend: `本周新增 ${a.stats.new_this_week || 0}` },
                    { label: '公开留资', value: String(a.stats.from_public || 0), icon: '🌐', color: 'info', trend: '免登录落地页提交' },
                    { label: '整体转化率', value: (a.conversion.signedRate || 0) + '%', icon: '📈', color: 'success', trend: `签约 ${a.stats.signed || 0} 家` },
                    { label: '意向总额', value: '¥' + (a.stats.budget_wan || 0) + '万', icon: '💰', color: 'warning', trend: `均单 ¥${a.conversion.avgBudget || 0}万` }
                ])}
                <div class="page-grid cols-2" style="margin-top:20px;">
                    <div class="data-card">
                        <div class="data-card-header"><div class="data-card-title">🔗 获客落地页（对外分享）</div></div>
                        <div style="padding:16px;">
                            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">把这个链接发给潜在客户，他们填写后线索会实时进入本系统：</div>
                            <div style="display:flex;gap:8px;align-items:center;background:var(--dark-bg);border:1px solid var(--dark-border);border-radius:8px;padding:10px;margin-bottom:12px;">
                                <code style="flex:1;font-size:12px;word-break:break-all;color:var(--accent);">${link}</code>
                                <button class="btn btn-primary btn-sm" onclick="copyLeadLink()">复制</button>
                            </div>
                            <div style="font-size:12px;color:var(--text-secondary);line-height:1.9;">
                                • 该页面**无需登录**，客户打开即可填写（隧道已单独放行）<br>
                                • 含防刷限制：同一 IP 每小时最多提交 5 条<br>
                                • 同名客户重复提交不会产生重复数据，而是追加一条跟进记录<br>
                                • 提交后自动进入「客户待跟进」，阶段=线索、负责人=未分配
                            </div>
                        </div>
                    </div>
                    <div class="data-card">
                        <div class="data-card-header"><div class="data-card-title">📊 近 14 天新增线索</div></div>
                        <div style="padding:18px 16px;display:flex;align-items:flex-end;gap:6px;height:180px;">
                            ${a.trend.length === 0 ? '<div style="color:var(--text-secondary);font-size:13px;">暂无数据</div>' :
                              a.trend.map(t => `
                                <div style="flex:1;text-align:center;">
                                    <div style="height:${Math.max(6, (t.cnt / maxTrend) * 110)}px;background:var(--gradient-primary);border-radius:4px 4px 0 0;" title="${t.d}：${t.cnt} 条"></div>
                                    <div style="font-size:10px;color:var(--text-secondary);margin-top:5px;">${String(t.d).slice(5)}</div>
                                </div>`).join('')}
                        </div>
                    </div>
                </div>
                <div class="page-grid cols-2" style="margin-top:20px;">
                    <div class="data-card">
                        <div class="data-card-header"><div class="data-card-title">🏷️ 获客来源分析</div></div>
                        <table class="data-table">
                            <thead><tr><th>来源渠道</th><th>线索数</th><th>已签约</th><th>转化率</th><th>意向金额</th></tr></thead>
                            <tbody>
                                ${a.bySource.map(s => `
                                    <tr>
                                        <td style="font-weight:600;">${s.source}</td>
                                        <td>${s.cnt}</td>
                                        <td style="color:var(--success);">${s.signed}</td>
                                        <td>${s.rate}%</td>
                                        <td style="color:var(--warning);">¥${s.budget_wan || 0}万</td>
                                    </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="data-card">
                        <div class="data-card-header"><div class="data-card-title">🔻 获客转化漏斗</div></div>
                        <div style="padding:18px 16px;">
                            ${a.byStage.map((s, i) => {
                                const pct = a.stats.total ? Math.round(s.cnt / a.stats.total * 100) : 0;
                                const colors = ['var(--accent)', 'var(--primary)', 'var(--warning)', 'var(--success)'];
                                return `
                                <div style="margin-bottom:14px;">
                                    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px;">
                                        <span>${i + 1}. ${s.label}</span><span style="color:var(--text-secondary);">${s.cnt} 家 · ${pct}%</span>
                                    </div>
                                    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${colors[i]};"></div></div>
                                </div>`;
                              }).join('')}
                            <div style="margin-top:16px;font-size:12px;color:var(--text-secondary);">
                                线索→意向 ${a.conversion.lead2interest}% · 整体签约率 ${a.conversion.signedRate}%
                            </div>
                        </div>
                    </div>
                </div>
                <div class="data-card" style="margin-top:20px;">
                    <div class="data-card-header"><div class="data-card-title">👤 负责人线索分配</div></div>
                    <table class="data-table">
                        <thead><tr><th>负责人</th><th>负责客户数</th><th>操作</th></tr></thead>
                        <tbody>
                            ${a.byOwner.map(o => `
                                <tr>
                                    <td style="font-weight:600;">${o.owner}</td>
                                    <td>${o.cnt}</td>
                                    <td><button class="btn btn-ghost btn-sm" onclick="filterByOwner('${o.owner}')">查看</button></td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        // 生成对外留资链接（自动带当前公网域名 / token，便于直接分享）
        function leadPageUrl() {
            const base = location.origin + '/lead.html';
            const t = CONFIG.token;
            return t ? `${base}?token=${encodeURIComponent(t)}` : base;
        }

        function copyLeadLink() {
            const link = leadPageUrl();
            const done = () => showToast('留资链接已复制，可直接发给客户', 'success');
            if (navigator.clipboard && location.protocol === 'https:') {
                navigator.clipboard.writeText(link).then(done).catch(() => fallbackCopy(link, done));
            } else fallbackCopy(link, done);
        }

        function fallbackCopy(text, done) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); done(); } catch (e) { prompt('请手动复制留资链接：', text); }
            ta.remove();
        }

        function openLeadPreview() { window.open(leadPageUrl(), '_blank'); }

        async function filterByOwner(owner) {
            try {
                const d = await API.get('/api/customers?owner=' + encodeURIComponent(owner === '未分配' ? '' : owner));
                MOCK.messages = d.list;
                MOCK.customerStats = d.stats;
                FILTERS.customerStage = 'all';
                switchPage('messages');
                document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.getAttribute('data-page') === 'messages'));
                reloadPage('messages');
                showToast(`已筛选负责人：${owner}（${d.list.length} 条）`, 'info');
            } catch (e) { showToast('筛选失败: ' + e.message, 'danger'); }
        }

        // 06 销售作战卡
        function renderSales() {
            const s = MOCK.sales;
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">🎯 销售作战卡 · 2026 Q2</div>
                        <div class="page-header-subtitle">本周已签 23 单，目标 30 单 · 距月结余 5 天</div>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="pushBattleReport()">📤 推送战报</button>
                </div>
                <div class="page-grid cols-2-1">
                    <div class="data-card">
                        <div class="data-card-header">
                            <div class="data-card-title">🔻 销售漏斗 · 本月</div>
                            <span class="badge badge-success">转化率 12.4%</span>
                        </div>
                        <div class="data-card-body">
                            ${s.funnel.map((f, i) => `
                                <div class="funnel-stage">
                                    <div class="funnel-rank">0${i + 1}</div>
                                    <div class="funnel-info">
                                        <div class="funnel-name">${f.name}阶段</div>
                                        <div class="funnel-detail">${f.detail}</div>
                                    </div>
                                    <div>
                                        <div class="funnel-value">${f.value}</div>
                                        <div class="funnel-percent">${f.percent}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="data-card">
                        <div class="data-card-header">
                            <div class="data-card-title">🏆 本月英雄榜 TOP 5</div>
                            <span class="badge badge-warning">激烈</span>
                        </div>
                        <div class="list">
                            ${s.ranking.map((r, i) => `
                                <div class="list-item">
                                    <div style="width: 30px; text-align: center; font-family: 'Courier New', monospace; font-size: 18px; font-weight: 800; color: ${i === 0 ? '#fbbf24' : i === 1 ? '#cbd5e1' : i === 2 ? '#f59e0b' : 'var(--text-secondary)'};">${i + 1}</div>
                                    <div class="list-item-avatar">${r.avatar}</div>
                                    <div class="list-item-main">
                                        <div class="list-item-title">${r.name}</div>
                                        <div class="list-item-meta"><span>签约 ${r.sales} 单</span><span>完成率 ${r.rate}</span></div>
                                    </div>
                                    <div class="list-item-right">
                                        <div style="font-size: 16px; font-weight: 800; color: var(--success);">${r.amount}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        // 07 投放进度
        function renderProgress() {
            const list = MOCK.progress;
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">📈 全面投放进度</div>
                        <div class="page-header-subtitle">6 个投放计划执行中 · 整体进度 58%</div>
                    </div>
                    <div class="flex gap-10">
                        <button class="btn btn-ghost btn-sm">📥 导出 Excel</button>
                        <button class="btn btn-primary btn-sm">+ 新建计划</button>
                    </div>
                </div>
                <div class="filter-tags">
                    <span class="filter-tag active">全部 (6)</span>
                    <span class="filter-tag">进行中 (5)</span>
                    <span class="filter-tag">即将收尾 (1)</span>
                    <span class="filter-tag">已超时 (0)</span>
                </div>
                <div class="data-card">
                    <table class="data-table">
                        <thead><tr><th>计划名称</th><th>客户</th><th>起止时间</th><th style="width: 30%;">完成度</th><th>状态</th><th>操作</th></tr></thead>
                        <tbody>
                            ${list.map(p => `
                                <tr>
                                    <td style="font-weight: 600;">${p.name}</td>
                                    <td>${p.client}</td>
                                    <td style="color: var(--text-secondary); font-size: 12px;">${p.start} → ${p.end}</td>
                                    <td>
                                        <div class="progress-with-label">
                                            <span>${p.percent}%</span>
                                        </div>
                                        <div class="progress"><div class="progress-bar ${p.status}" style="width: ${p.percent}%;"></div></div>
                                    </td>
                                    <td><span class="badge badge-${p.status}">${p.statusText}</span></td>
                                    <td>
                                        <button class="btn btn-ghost btn-sm" onclick="showCampaignDetail('${p.name}')">详情</button>
                                        <button class="btn btn-ghost btn-sm" style="margin-left: 4px;">报告</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        // 08 社区看板
        function renderCommunity() {
            const list = MOCK.community;
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">🏘️ 社区看板</div>
                        <div class="page-header-subtitle">4 个核心社区 · 覆盖 103,300 人/月</div>
                    </div>
                    <button class="btn btn-primary btn-sm">+ 新增社区</button>
                </div>
                <div class="page-grid cols-2">
                    ${list.map(c => `
                        <div class="data-card">
                            <div class="data-card-header">
                                <div class="data-card-title">🏢 ${c.name}</div>
                                <span class="badge badge-${c.status}">${c.statusText}</span>
                            </div>
                            <div class="data-card-body">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                    <div>
                                        <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">📍 地址</div>
                                        <div style="font-size: 13px;">${c.address}</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">🎯 点位类型</div>
                                        <div style="font-size: 13px;">${c.type}</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">👥 覆盖人数</div>
                                        <div style="font-size: 18px; font-weight: 700; color: var(--accent);">${c.people}</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">📦 本月订单</div>
                                        <div style="font-size: 18px; font-weight: 700; color: var(--success);">${c.orders} 单</div>
                                    </div>
                                </div>
                                <div style="margin-top: 16px; display: flex; gap: 8px;">
                                    <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="showCommunityPoints('${c.name}')">📍 查看点位</button>
                                    <button class="btn btn-ghost btn-sm" style="flex: 1;">📊 数据报表</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // 09 合同兑现
        function renderContracts() {
            const list = MOCK.contracts;
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">📜 合同兑现追踪</div>
                        <div class="page-header-subtitle">8 个执行中合同 · 总金额 ¥405万 · 平均履约 52%</div>
                    </div>
                    <div class="flex gap-10">
                        <button class="btn btn-ghost btn-sm">📥 导出合同</button>
                        <button class="btn btn-primary btn-sm">+ 新建合同</button>
                    </div>
                </div>
                <div class="filter-tags">
                    <span class="filter-tag active">全部 (8)</span>
                    <span class="filter-tag">履约良好 (3)</span>
                    <span class="filter-tag">执行中 (4)</span>
                    <span class="filter-tag">即将收尾 (1)</span>
                </div>
                <div class="data-card">
                    <table class="data-table">
                        <thead><tr><th>合同编号</th><th>客户</th><th>金额</th><th>起止日期</th><th style="width: 25%;">上刊进度</th><th>验收状态</th><th>操作</th></tr></thead>
                        <tbody>
                            ${list.map(c => `
                                <tr>
                                    <td style="font-family: 'Courier New', monospace; color: var(--accent); font-size: 12px;">${c.id}</td>
                                    <td style="font-weight: 600;">${c.client}</td>
                                    <td style="color: var(--success); font-weight: 700;">${c.amount}</td>
                                    <td style="color: var(--text-secondary); font-size: 12px;">${c.start} → ${c.end}</td>
                                    <td>
                                        <div class="progress-with-label"><span>${c.execution}%</span></div>
                                        <div class="progress"><div class="progress-bar ${c.status === 'warning' ? 'warning' : 'success'}" style="width: ${c.execution}%;"></div></div>
                                    </td>
                                    <td><span class="badge badge-${c.status === 'success' ? 'success' : c.status === 'warning' ? 'warning' : 'primary'}">${c.statusText}</span></td>
                                    <td>
                                        <button class="btn btn-primary btn-sm" onclick="showContractDetail('${c.id}')">查看</button>
                                        <button class="btn btn-ghost btn-sm" style="margin-left: 4px;">验收</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                ${renderPagination()}
            `;
        }

        // 10 素材生产
        function renderCreative() {
            const list = MOCK.creative;
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">🎨 AI 素材生产中心</div>
                        <div class="page-header-subtitle">本月已生成 248 个素材 · AI 占比 76%</div>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="generateCreative()">🤖 AI 生成新素材</button>
                </div>
                <div class="filter-tags">
                    <span class="filter-tag active">全部 (8)</span>
                    <span class="filter-tag">KV 主视觉 (3)</span>
                    <span class="filter-tag">视频 (2)</span>
                    <span class="filter-tag">海报 (2)</span>
                    <span class="filter-tag">GIF (1)</span>
                </div>
                <div class="page-grid cols-4">
                    ${list.map(c => `
                        <div class="data-card">
                            <div class="data-card-body">
                                <div class="creative-thumb ${c.gradient}">${c.icon}</div>
                                <div style="font-size: 14px; font-weight: 600; margin-bottom: 6px;">${c.name}</div>
                                <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">
                                    <span class="badge badge-primary" style="margin-right: 4px;">${c.type}</span>
                                    <span>${c.use}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-secondary); margin-bottom: 12px;">
                                    <span>📅 ${c.date}</span>
                                    <span style="color: var(--success);">✓ AI 生成</span>
                                </div>
                                <div class="flex gap-10">
                                    <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="showToast('已开始下载素材：${c.name} (${c.type})', 'success')">📥 下载</button>
                                    <button class="btn btn-ghost btn-sm">⋮</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                ${renderPagination()}
            `;
        }

        // 11 智能体交付
        function renderAgent() {
            const list = MOCK.agents;
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">🤖 智能体交付中心</div>
                        <div class="page-header-subtitle">4 个 AI Agent 已上线 · 总调用 60,600 次 · QPS 394</div>
                    </div>
                    <button class="btn btn-primary btn-sm">+ 接入新 Agent</button>
                </div>
                <div class="page-grid cols-2">
                    ${list.map(a => `
                        <div class="data-card">
                            <div class="data-card-body">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                                    <div style="display: flex; align-items: center; gap: 12px;">
                                        <div class="list-item-avatar" style="background: var(--gradient-primary);">🤖</div>
                                        <div>
                                            <div style="font-size: 16px; font-weight: 700;">${a.name}</div>
                                            <div style="font-family: 'Courier New', monospace; font-size: 11px; color: var(--accent); margin-top: 2px;">${a.endpoint}</div>
                                        </div>
                                    </div>
                                    <div style="text-align: right;">
                                        <span class="status-light ${a.status}"></span>
                                        <span style="font-size: 12px; margin-left: 6px; color: var(--${a.status === 'online' ? 'success' : 'warning'});">${a.status === 'online' ? '运行中' : a.status === 'busy' ? '高负载' : '离线'}</span>
                                    </div>
                                </div>
                                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;">
                                    <div style="text-align: center; padding: 10px; background: var(--dark-bg); border-radius: var(--radius-sm);">
                                        <div style="font-size: 11px; color: var(--text-secondary);">总调用</div>
                                        <div style="font-size: 16px; font-weight: 700; color: var(--primary);">${a.calls.toLocaleString()}</div>
                                    </div>
                                    <div style="text-align: center; padding: 10px; background: var(--dark-bg); border-radius: var(--radius-sm);">
                                        <div style="font-size: 11px; color: var(--text-secondary);">QPS</div>
                                        <div style="font-size: 16px; font-weight: 700; color: var(--accent);">${a.qps}</div>
                                    </div>
                                    <div style="text-align: center; padding: 10px; background: var(--dark-bg); border-radius: var(--radius-sm);">
                                        <div style="font-size: 11px; color: var(--text-secondary);">状态</div>
                                        <div style="font-size: 16px; font-weight: 700; color: var(--success);">${a.status === 'online' ? '99.9%' : '98.2%'}</div>
                                    </div>
                                </div>
                                <div class="flex gap-10">
                                    <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="showAgentDoc('${a.doc}')">📘 调用文档</button>
                                    <button class="btn btn-ghost btn-sm" style="flex: 1;">📊 监控</button>
                                    <button class="btn btn-ghost btn-sm">⚙️</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // 12 客服服务
        function renderService() {
            const list = MOCK.service;
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">🎧 客服服务中心</div>
                        <div class="page-header-subtitle">7 个工单 · 紧急 2 · 处理中 4 · 已完成 2</div>
                    </div>
                    <div class="flex gap-10">
                        <div class="search-box"><input placeholder="搜索工单 / 客户..." /></div>
                        <button class="btn btn-primary btn-sm">+ 创建工单</button>
                    </div>
                </div>
                <div class="filter-tags">
                    <span class="filter-tag active">全部 (7)</span>
                    <span class="filter-tag badge-danger">紧急 (2)</span>
                    <span class="filter-tag">处理中 (3)</span>
                    <span class="filter-tag">已完成 (2)</span>
                </div>
                <div class="data-card">
                    <table class="data-table">
                        <thead><tr><th>工单号</th><th>客户</th><th>问题类型</th><th>紧急度</th><th>状态</th><th>处理人</th><th>创建时间</th><th>操作</th></tr></thead>
                        <tbody>
                            ${list.map(s => `
                                <tr>
                                    <td style="font-family: 'Courier New', monospace; color: var(--accent); font-size: 12px;">${s.id}</td>
                                    <td style="font-weight: 600;">${s.client}</td>
                                    <td>${s.type}</td>
                                    <td><span class="badge badge-${s.urgency === 'high' ? 'danger' : s.urgency === 'medium' ? 'warning' : 'default'}">${s.urgency === 'high' ? '紧急' : s.urgency === 'medium' ? '中等' : '一般'}</span></td>
                                    <td><span class="badge badge-${s.status === 'done' ? 'success' : s.status === 'processing' ? 'primary' : 'warning'}">${s.statusText}</span></td>
                                    <td>${s.handler}</td>
                                    <td style="color: var(--text-secondary); font-size: 12px;">${s.created}</td>
                                    <td>
                                        <button class="btn btn-primary btn-sm" onclick="updateTicket('${s.id}','processing')">处理</button>
                                        <button class="btn btn-ghost btn-sm" style="margin-left: 4px;">详情</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                ${renderPagination()}
            `;
        }

        // 13 公司知识库
        function renderKnowledge() {
            const list = MOCK.knowledge;
            const categories = ['全部', '投放策略', '客户案例', '行业报告', '操作手册', '法规'];
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">📚 公司知识库</div>
                        <div class="page-header-subtitle">8 篇核心文档 · 累计阅读 12,368 次</div>
                    </div>
                    <div class="flex gap-10">
                        <div class="search-box"><input placeholder="搜索文档标题..." /></div>
                        <button class="btn btn-primary btn-sm">+ 上传文档</button>
                    </div>
                </div>
                <div class="filter-tags">
                    ${categories.map((c, i) => `<span class="filter-tag ${i === 0 ? 'active' : ''}">${c}</span>`).join('')}
                </div>
                <div class="data-card">
                    <div class="list">
                        ${list.map(k => `
                            <div class="list-item">
                                <div class="list-item-avatar" style="background: var(--gradient-secondary);">📄</div>
                                <div class="list-item-main">
                                    <div class="list-item-title">${k.title}</div>
                                    <div class="list-item-meta">
                                        <span class="badge badge-primary">${k.category}</span>
                                        ${k.tags.map(t => `<span style="font-size: 11px; padding: 2px 8px; background: var(--dark-bg); border-radius: 4px;">#${t}</span>`).join('')}
                                    </div>
                                </div>
                                <div class="list-item-right" style="min-width: 180px;">
                                    <div style="font-size: 12px; color: var(--text-secondary);">👁 ${k.views} 浏览 · 📅 ${k.date}</div>
                                    <div style="margin-top: 6px;">
                                        <button class="btn btn-primary btn-sm" onclick="readKnowledge('${k.title}', ${k.id})">阅读</button>
                                        <button class="btn btn-ghost btn-sm" style="margin-left: 4px;">⭐</button>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ${renderPagination()}
            `;
        }

        // 14 产品研发
        function renderRd() {
            const list = MOCK.rd;
            const roadmap = MOCK.roadmap;
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">💡 产品研发 · 需求池</div>
                        <div class="page-header-subtitle">10 条需求 · 3 条进行中 · 2026 路线图已发布</div>
                    </div>
                    <button class="btn btn-primary btn-sm">+ 提交需求</button>
                </div>
                <div class="page-grid cols-2-1">
                    <div>
                        <div class="filter-tags">
                            <span class="filter-tag active">全部 (10)</span>
                            <span class="filter-tag">高优 (4)</span>
                            <span class="filter-tag">进行中 (3)</span>
                            <span class="filter-tag">已上线 (1)</span>
                        </div>
                        <div class="data-card">
                            <div class="list">
                                ${list.map(r => `
                                    <div class="list-item">
                                        <div class="list-item-avatar" style="background: var(--gradient-${r.priority === 'high' ? 'warning' : r.priority === 'medium' ? 'secondary' : 'success'});">💡</div>
                                        <div class="list-item-main">
                                            <div class="list-item-title">${r.title}</div>
                                            <div class="list-item-meta">
                                                <span class="badge badge-${r.priority === 'high' ? 'danger' : r.priority === 'medium' ? 'warning' : 'default'}">${r.priority === 'high' ? '高优' : r.priority === 'medium' ? '中优' : '低优'}</span>
                                                <span class="badge badge-${r.status === 'completed' ? 'success' : r.status === 'in_progress' ? 'primary' : r.status === 'review' ? 'warning' : 'default'}">${r.statusText}</span>
                                                <span>👤 ${r.author}</span>
                                                <span>👍 ${r.votes}</span>
                                                <span>💬 ${r.comments}</span>
                                            </div>
                                        </div>
                                        <div class="list-item-actions">
                                            <button class="btn btn-ghost btn-sm" onclick="voteRd(${r.id})">👍</button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div>
                        <div class="data-card">
                            <div class="data-card-header">
                                <div class="data-card-title">🗓️ 2026 产品路线图</div>
                            </div>
                            <div class="data-card-body">
                                <div class="timeline">
                                    ${roadmap.map(r => `
                                        <div class="timeline-item ${r.status}">
                                            <div class="timeline-title">${r.quarter} · ${r.title}</div>
                                            <div class="timeline-meta">${r.desc}</div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // 15 每日日报
        function renderDaily() {
            const list = MOCK.daily;
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="page-header-title">📅 每日日报 · 2026-06-24</div>
                        <div class="page-header-subtitle">${list.length} 篇日报已提交 · 全员完成率 100%</div>
                    </div>
                    <div class="flex gap-10">
                        <button class="btn btn-ghost btn-sm" onclick="exportDaily()">📥 导出日报</button>
                        <button class="btn btn-primary btn-sm" onclick="openDailyForm()">✍️ 写日报</button>
                    </div>
                </div>
                <div class="filter-tags">
                    <span class="filter-tag active">全部 (6)</span>
                    <span class="filter-tag">销售部 (1)</span>
                    <span class="filter-tag">运维部 (1)</span>
                    <span class="filter-tag">设计部 (1)</span>
                    <span class="filter-tag">商务部 (1)</span>
                    <span class="filter-tag">客服部 (1)</span>
                    <span class="filter-tag">产品部 (1)</span>
                </div>
                <div class="page-grid cols-2">
                    ${list.map(d => `
                        <div class="data-card">
                            <div class="data-card-header">
                                <div class="data-card-title">${d.mood} ${d.title}</div>
                                <span class="badge badge-primary">${d.dept}</span>
                            </div>
                            <div class="data-card-body">
                                <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">
                                    👤 ${d.author} · ${d.dept} · ${d.moodText}
                                </div>
                                <div style="margin-bottom: 16px;">
                                    <div style="font-size: 13px; font-weight: 600; color: var(--success); margin-bottom: 8px;">✅ 今日完成</div>
                                    <ul class="todo-list">
                                        ${d.done.map(item => `
                                            <li class="todo-item">
                                                <div class="todo-checkbox done"></div>
                                                <div class="todo-text done">${item}</div>
                                            </li>
                                        `).join('')}
                                    </ul>
                                </div>
                                <div>
                                    <div style="font-size: 13px; font-weight: 600; color: var(--accent); margin-bottom: 8px;">🎯 明日计划</div>
                                    <ul class="todo-list">
                                        ${d.plan.map(item => `
                                            <li class="todo-item">
                                                <div class="todo-checkbox"></div>
                                                <div class="todo-text">${item}</div>
                                            </li>
                                        `).join('')}
                                    </ul>
                                </div>
                                <div style="margin-top: 16px; display: flex; gap: 8px;">
                                    <button class="btn btn-ghost btn-sm" style="flex: 1;" onclick="showToast('已打开 ${d.author} 的日报评论区', 'info')">💬 评论</button>
                                    <button class="btn btn-ghost btn-sm" style="flex: 1;">⭐ 点赞 (3)</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // 16 数据连接
        function renderData() {
            const list = MOCK.dataSources;
            const onlineCount = list.filter(d => d.status === 'online').length;
            return `
                <div class="page-header">
                    <div class="page-header-left">
                        <div class="data-card-title" style="font-size: 22px;">🔌 数据连接中心</div>
                        <div class="page-header-subtitle">7 个核心数据源 · ${onlineCount} 在线 · 1 高负载</div>
                    </div>
                    <div class="flex gap-10">
                        <button class="btn btn-ghost btn-sm" onclick="syncAllDataSources()">🔄 全量同步</button>
                        <button class="btn btn-primary btn-sm" onclick="openSqlConsole()">🔎 SQL 查询控制台</button>
                    </div>
                </div>
                ${renderKPI([
                    { label: '在线数据源', value: onlineCount + '/7', icon: '✅', color: 'success', trend: '全部同步正常' },
                    { label: '总 QPS', value: '644', icon: '⚡', color: 'primary', trend: '↑ 8% 较昨日' },
                    { label: '平均延迟', value: '131ms', icon: '📡', color: 'warning', trend: 'AI 服务最高 486ms' },
                    { label: '今日同步', value: '1.2M', icon: '🔄', color: 'info', trend: '条记录已同步' }
                ])}
                <div class="data-card" style="margin-top: 20px;">
                    <div class="data-card-header">
                        <div class="data-card-title">📋 数据源详情</div>
                    </div>
                    <table class="data-table">
                        <thead><tr><th>数据源</th><th>类型</th><th>状态</th><th>最后同步</th><th>延迟</th><th>QPS</th><th>操作</th></tr></thead>
                        <tbody>
                            ${list.map(d => `
                                <tr>
                                    <td style="font-weight: 600;">${d.name}</td>
                                    <td style="color: var(--text-secondary); font-size: 12px;">${d.type}</td>
                                    <td><span class="status-light ${d.status}"></span><span style="margin-left: 8px; color: var(--${d.status === 'online' ? 'success' : d.status === 'busy' ? 'warning' : 'danger'});">${d.statusText}</span></td>
                                    <td style="color: var(--text-secondary); font-size: 12px;">${d.lastSync}</td>
                                    <td>${d.latency}</td>
                                    <td style="color: var(--accent); font-weight: 600;">${d.qps}</td>
                                    <td>
                                        <button class="btn btn-primary btn-sm" onclick="syncDataSource(${d.id})">同步</button>
                                        <button class="btn btn-ghost btn-sm" style="margin-left: 4px;">配置</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        // ==================== 页面切换 ====================
        const PAGE_RENDERERS = {
            dashboard: renderDashboard,
            pending: renderPending,
            map: renderMap,
            messages: renderMessages,
            acquisition: renderAcquisition,
            sales: renderSales,
            progress: renderProgress,
            community: renderCommunity,
            contracts: renderContracts,
            creative: renderCreative,
            agent: renderAgent,
            service: renderService,
            knowledge: renderKnowledge,
            rd: renderRd,
            daily: renderDaily,
            data: renderData
        };

        const PAGE_TITLES = {
            dashboard: { title: '今日工作台', subtitle: '你的每日任务总览 · 2026年6月24日 周三' },
            pending: { title: '待确认', subtitle: '需要你审批的点位 / 合同 / 素材清单' },
            decision: { title: 'AI经营决策中心', subtitle: '基于AI大数据的智能经营分析与决策支持系统' },
            map: { title: '投放作战地图', subtitle: '粤港澳大湾区 5 城点位实时分布' },
            messages: { title: '客户待跟进 / 获客 CRM', subtitle: '客户录入 · 阶段推进 · 跟进历史' },
            acquisition: { title: '获客中心', subtitle: '公开留资入口 · 来源分析 · 转化漏斗' },
            sales: { title: '销售作战卡', subtitle: '销售漏斗实时数据 · TOP 5 英雄榜' },
            progress: { title: '全面投放进度', subtitle: '正在执行的 6 个投放计划进度跟踪' },
            community: { title: '社区看板', subtitle: '4 个核心社区点位运营数据' },
            contracts: { title: '合同兑现', subtitle: '8 个执行中合同的履约进度追踪' },
            creative: { title: 'AI素材生产中心', subtitle: 'AI 自动生成的户外广告素材库' },
            agent: { title: '智能体交付中心', subtitle: '4 个 AI Agent API 集成状态监控' },
            service: { title: '客服服务中心', subtitle: '7 个待处理工单 · 紧急 2 个' },
            knowledge: { title: '公司知识库', subtitle: '8 篇核心文档 · 涵盖投放 / 案例 / 法规' },
            rd: { title: '产品研发', subtitle: '需求池 10 条 · 2026 路线图已上线' },
            daily: { title: '每日日报', subtitle: '团队今日 6 篇日报已提交' },
            data: { title: '数据连接中心', subtitle: '7 个核心数据源实时同步状态' }
        };

        function switchPage(pageId) {
            // 工作台实时引擎：只在该页可见时运行
            if (pageId === 'dashboard') startDashboardLive(); else stopDashboardLive();
            // 隐藏所有页面
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            // 显示目标页面
            const target = document.getElementById('page-' + pageId);
            if (target) {
                target.classList.add('active');
            } else {
                console.warn('找不到页面:', pageId);
                return;
            }
            // 更新标题
            const t = PAGE_TITLES[pageId];
            if (t) {
                document.getElementById('page-title').textContent = t.title;
                document.getElementById('page-subtitle').textContent = t.subtitle;
            }
            // 滚动到顶部
            document.getElementById('content-body').scrollTop = 0;
        }

        // ==================== 数据加载 ====================
        function loadMockData() {
            // 数据由后端提供，此函数保留用于向后兼容
            return API.get('/api/bootstrap');
        }

        // 刷新：重新从后端 SQL 拉取全部模块数据并重绘当前页
        async function refreshData() {
            try {
                await loadAllData();
                const active = document.querySelector('.nav-link.active');
                const pageId = active ? active.getAttribute('data-page') : 'decision';
                renderAllPages();
                hydrateKpi();
                hydrateChat();
                if (pageId && PAGE_RENDERERS[pageId]) {
                    const el = document.getElementById('page-' + pageId);
                    if (el) el.innerHTML = PAGE_RENDERERS[pageId]();
                }
                showToast(`数据已刷新 · ${META.generatedAt}`, 'success');
            } catch (e) {
                showToast('刷新失败: ' + e.message, 'danger');
            }
        }

        // 导出报告：后端生成真实 CSV（含 KPI / 收入 / 风险 / 合同 / 进度）
        function exportReport() {
            showToast('正在生成报告...', 'info');
            window.location.href = apiPath('/api/export/report.csv');
            setTimeout(() => showToast('报告已导出 (CSV)', 'success'), 800);
        }

        // ==================== CSS动画 ====================
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(400px);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
