// ==UserScript==
// @name         数据标注挂机助手
// @namespace    http://tampermonkey.net/
// @version      6.2
// @description  F12自动显示状态 | 输入r刷新缓存 | 移除运行暂停指令
// @author       人事
// @match       *://*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // ================= 配置区域 =================
    const SCRIPT_VERSION = "v6.2";
    const SCRIPT_TITLE = "挂机助手";
    const CONFIG_URL = "https://cdn.jsdelivr.net/gh/asd2261/fdx25-13@main/yz.json";
    // ===========================================

    // --- 全局变量 ---
    let isVerified = false;
    let timer = null;
    let isRunning = false;
    let totalRunTime = 0;
    let sessionStartTime = 0;
    let keyCount = 0;
    let timeInterval = null;
    let currentKeyIndex = 0;
    let currentConfigData = null;
    let autoStopTargetTime = 0;

    // --- 时间工具 ---
    const pad = (n) => n.toString().padStart(2, '0');
    const getFullTimeStr = () => {
        const now = new Date();
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    };
    const getDateStr = () => {
        const now = new Date();
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    };

    // --- 状态显示逻辑 (提取为独立函数) ---
    function logStatusTable() {
        let deadlineStr = currentConfigData ? (currentConfigData.deadline || "无限制") : "获取中...";
        console.group(`${SCRIPT_TITLE} 实时状态`); // 使用分组让控制台更整洁
        console.table({
            "1. 当前时间": getFullTimeStr(),
            "2. 运行状态": isRunning ? "🏃 运行中" : "🛑 已停止",
            "3. 累计按键": keyCount + " 次",
            "4. 运行时间": document.getElementById('ka-run-time') ? document.getElementById('ka-run-time').textContent : "00:00:00",
            "5. 定时任务": autoStopTargetTime > 0 ? "⏳ 开启中" : "⚪ 未开启",
            "6. 验证状态": isVerified ? "✅ 通过" : "❌ 未通过",
            "7. 到期时间": deadlineStr,
            "8. 接口地址": CONFIG_URL
        });
        console.log("%c 👉 提示: 输入 r 并回车，可清除缓存并刷新页面", "color: #FFC107; font-weight: bold; background: #333; padding: 4px;");
        console.groupEnd();
        return "状态已更新";
    }

    // --- F12 控制台指令 (已精简) ---
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    function registerConsoleCommands() {
        const cmds = {
            's': { desc: '刷新查看状态', fn: logStatusTable },
            'r': { desc: '清除缓存并刷新', fn: () => {
                localStorage.clear();
                window.location.reload();
                return "正在刷新...";
            }}
        };
        for (let key in cmds) {
            try {
                Object.defineProperty(win, key, {
                    get: function() { return `> [指令 ${key}] ${cmds[key].desc}: ${cmds[key].fn()}`; },
                    configurable: true
                });
            } catch (e) {}
        }
    }

    // --- 网络验证 ---
    function verifyNetwork() {
        const statusDiv = document.getElementById('ka-status');
        const startBtn = document.getElementById('ka-start-btn');
        if(!statusDiv) return;

        statusDiv.textContent = `连接验证中...`;
        statusDiv.style.color = "#FFC107";

        GM_xmlhttpRequest({
            method: "GET",
            url: CONFIG_URL + "?t=" + new Date().getTime(),
            timeout: 5000,
            onload: function(response) {
                if (response.status !== 200) { statusDiv.textContent = "服务器异常"; statusDiv.style.color = "#FF5252"; return; }
                try {
                    const data = JSON.parse(response.responseText);
                    currentConfigData = data;
                    if (data.enable === false) { statusDiv.textContent = "维护中"; statusDiv.style.color = "#FF5252"; alert("维护通知: " + (data.notice || "暂不可用")); return; }
                    if (data.deadline && new Date() > new Date(data.deadline)) { statusDiv.textContent = "授权过期"; statusDiv.style.color = "#FF5252"; return; }

                    // 验证通过
                    isVerified = true;
                    statusDiv.textContent = `验证通过 - 就绪`;
                    statusDiv.style.color = "#69F0AE";
                    if(!isRunning) startBtn.textContent = "开始挂机";
                    startBtn.classList.remove('disabled');

                    // 验证成功后，自动在控制台打印状态
                    setTimeout(logStatusTable, 500);

                } catch (e) { statusDiv.textContent = "解析错误"; statusDiv.style.color = "#FF5252"; }
            },
            onerror: function() { statusDiv.textContent = "网络错误"; statusDiv.style.color = "#FF5252"; },
            ontimeout: function() { statusDiv.textContent = "验证超时"; statusDiv.style.color = "#FF5252"; }
        });
    }

    // --- UI 初始化 ---
    function initPanel() {
        const css = `
            #keep-alive-panel {
                position: fixed; top: 100px; right: 20px; width: 260px;
                background: #1e1e1e; color: #e0e0e0;
                border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.6);
                z-index: 999999; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                font-size: 13px; user-select: none; border: 1px solid #333;
                display: flex; flex-direction: column; gap: 10px; padding: 15px;
            }
            #keep-alive-panel * { box-sizing: border-box; outline: none; }

            /* 最小化样式 - 极简黑胶囊 */
            #keep-alive-panel.minimized {
                width: auto; height: auto; padding: 6px 12px; right: 10px;
                background: rgba(30, 30, 30, 0.9); border: 1px solid #444;
                cursor: pointer; align-items: center; justify-content: center;
                border-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            }
            #keep-alive-panel.minimized .ka-header,
            #keep-alive-panel.minimized .ka-content { display: none; }
            #keep-alive-panel.minimized::after {
                content: "🛠️ 挂机助手"; color: #bbb; font-size: 12px; font-weight: bold; white-space: nowrap;
            }
            #keep-alive-panel.minimized:hover { background: #2c2c2c; border-color: #666; }
            #keep-alive-panel.minimized:hover::after { color: #fff; }

            /* 正常面板样式 */
            .ka-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 8px; margin-bottom: 5px; }
            .ka-title { color: #4CAF50; font-weight: 600; font-size: 12px; white-space: nowrap; }
            .ka-minimize-btn { background: transparent; border: none; color: #666; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 5px; }
            .ka-minimize-btn:hover { color: #fff; }

            .ka-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
            .ka-label { color: #aaa; }
            .ka-input { background: #2c2c2c; border: 1px solid #333; color: #fff; border-radius: 4px; padding: 4px; text-align: center; font-family: monospace; }
            .ka-input:disabled { background: #252525; color: #555; cursor: not-allowed; }

            .key-group { display: flex; align-items: center; gap: 5px; background: #2c2c2c; padding: 2px; border-radius: 4px; border: 1px solid #333; }
            .ka-key-input { width: 30px; border: none; background: transparent; color: #fff; text-align: center; font-weight: bold; text-transform: uppercase; }

            .timer-group { display: flex; align-items: center; gap: 5px; }
            .timer-group.disabled { opacity: 0.3; pointer-events: none; }
            .timer-input { width: 35px; }

            .ka-switch { position: relative; display: inline-block; width: 32px; height: 18px; }
            .ka-switch input { opacity: 0; width: 0; height: 0; }
            .ka-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #444; border-radius: 18px; }
            .ka-slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background-color: white; border-radius: 50%; }
            input:checked + .ka-slider { background-color: #4CAF50; }
            input:checked + .ka-slider:before { left: 16px; }

            .stats-box { background: #252525; padding: 8px; border-radius: 4px; font-size: 12px; margin: 10px 0; }
            .stats-row { display: flex; justify-content: space-between; color: #888; margin-top: 4px; }
            .stats-val { color: #e0e0e0; font-family: monospace; }
            #ka-timer-countdown { color: #FFC107; text-align: right; }

            .btn-main { width: 100%; padding: 8px; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; background: #4CAF50; color: white; }
            .btn-main.stop { background: #D32F2F; display: none; }
            .btn-main.disabled { background: #444; color: #888; cursor: not-allowed; }
            #ka-status { font-size: 11px; text-align: center; margin-top: 5px; color: #666; white-space: nowrap; overflow: hidden; }
        `;
        GM_addStyle(css);

        const panel = document.createElement('div');
        panel.id = 'keep-alive-panel';
        const titleStr = `${SCRIPT_VERSION} ${SCRIPT_TITLE} ${getDateStr()}`;

        panel.innerHTML = `
            <div class="ka-header">
                <span class="ka-title">${titleStr}</span>
                <button class="ka-minimize-btn" id="ka-min-btn" title="最小化">_</button>
            </div>
            <div class="ka-content">
                <div class="ka-row">
                    <span class="ka-label">按键配置</span>
                    <div class="key-group">
                        <input type="text" id="ka-key1" class="ka-key-input" value="R" maxlength="1">
                        <span style="color:#4CAF50">↔</span>
                        <input type="text" id="ka-key2" class="ka-key-input" value="E" maxlength="1">
                    </div>
                </div>
                <div class="ka-row">
                    <span class="ka-label">点击间隔(秒)</span>
                    <input type="number" id="ka-interval" class="ka-input" value="2" min="1" style="width: 50px;">
                </div>
                <div class="ka-row" style="justify-content: flex-start; gap: 10px;">
                    <label class="ka-switch" title="开启定时停止">
                        <input type="checkbox" id="ka-timer-switch">
                        <span class="ka-slider"></span>
                    </label>
                    <div class="timer-group disabled" id="ka-timer-inputs">
                        <input type="number" id="ka-stop-h" class="ka-input timer-input" placeholder="0" min="0">
                        <span style="color:#666">:</span>
                        <input type="number" id="ka-stop-m" class="ka-input timer-input" placeholder="0" min="0">
                        <span class="ka-label" style="font-size:12px;">后停止</span>
                    </div>
                </div>
                <div class="stats-box">
                    <div class="stats-row"><span>运行时间</span><span class="stats-val" id="ka-run-time">00:00:00</span></div>
                    <div class="stats-row"><span>按键次数</span><span class="stats-val" id="ka-key-count">0</span></div>
                    <div class="stats-row" id="ka-countdown-row" style="display:none;"><span>剩余时间</span><span class="stats-val" id="ka-timer-countdown">--:--:--</span></div>
                </div>
                <button id="ka-start-btn" class="btn-main disabled">正在初始化...</button>
                <button id="ka-stop-btn" class="btn-main stop">停止运行</button>
                <div id="ka-status">等待验证...</div>
            </div>
        `;
        document.body.appendChild(panel);

        bindEvents();
        loadSettings();

        registerConsoleCommands();
        console.log(`%c ${titleStr} 加载成功!`, "background: #222; color: #4CAF50; padding: 4px;");
    }

    function bindEvents() {
        const panel = document.getElementById('keep-alive-panel');
        const minBtn = document.getElementById('ka-min-btn');
        minBtn.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.add('minimized'); });
        panel.addEventListener('click', () => { if (panel.classList.contains('minimized')) panel.classList.remove('minimized'); });
        document.querySelector('.ka-content').addEventListener('click', (e) => e.stopPropagation());

        document.getElementById('ka-start-btn').addEventListener('click', startScript);
        document.getElementById('ka-stop-btn').addEventListener('click', stopScript);

        ['ka-key1', 'ka-key2', 'ka-interval', 'ka-stop-h', 'ka-stop-m'].forEach(id => {
            document.getElementById(id).addEventListener('input', (e) => {
                if(id.includes('key')) e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/, '').substring(0,1).toUpperCase();
                localStorage.setItem(id, e.target.value);
            });
        });
        const timerSwitch = document.getElementById('ka-timer-switch');
        const timerInputs = document.getElementById('ka-timer-inputs');
        timerSwitch.addEventListener('change', (e) => {
            if (e.target.checked) timerInputs.classList.remove('disabled');
            else timerInputs.classList.add('disabled');
        });
    }

    function loadSettings() {
        const get = (k, def) => localStorage.getItem(k) || def;
        document.getElementById('ka-key1').value = get('ka-key1', 'R');
        document.getElementById('ka-key2').value = get('ka-key2', 'E');
        document.getElementById('ka-interval').value = get('ka-interval', '2');
        document.getElementById('ka-stop-h').value = get('ka-stop-h', '');
        document.getElementById('ka-stop-m').value = get('ka-stop-m', '');

        document.getElementById('ka-timer-switch').checked = false;
        document.getElementById('ka-timer-inputs').classList.add('disabled');
    }

    function simulateSingleKey(keyChar) {
        if (!keyChar) return;
        const key = keyChar.toLowerCase();
        let code, keyCode;
        if (/[a-z]/.test(key)) { code = `Key${key.toUpperCase()}`; keyCode = key.charCodeAt(0) - 32; }
        else if (/[0-9]/.test(key)) { code = `Digit${key}`; keyCode = key.charCodeAt(0); }
        else return;
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, keyCode, bubbles: true }));
        setTimeout(() => { document.body.dispatchEvent(new KeyboardEvent('keyup', { key, code, keyCode, bubbles: true })); }, 50);
    }

    function runLoop() {
        if (!isRunning) return;
        const k1 = document.getElementById('ka-key1').value.trim();
        const k2 = document.getElementById('ka-key2').value.trim();
        let targetKey = (k1 && k2) ? ((currentKeyIndex === 0) ? k1 : k2) : (k1 || k2);
        if (k1 && k2) currentKeyIndex = (currentKeyIndex === 0) ? 1 : 0;

        if (targetKey) {
            simulateSingleKey(targetKey);
            keyCount++;
            document.getElementById('ka-key-count').textContent = keyCount;
            document.getElementById('ka-status').textContent = `${getFullTimeStr()} 按下: ${targetKey}`;
            document.getElementById('ka-status').style.color = "#69F0AE";
        }

        const interval = Math.max(0.5, parseFloat(document.getElementById('ka-interval').value) || 2) * 1000;
        timer = setTimeout(runLoop, interval);
    }

    function updateRunTime() {
        if (!isRunning) return;
        const t = totalRunTime + (Date.now() - sessionStartTime);
        const h = Math.floor(t/3600000).toString().padStart(2,'0');
        const m = Math.floor((t%3600000)/60000).toString().padStart(2,'0');
        const s = Math.floor((t%60000)/1000).toString().padStart(2,'0');
        document.getElementById('ka-run-time').textContent = `${h}:${m}:${s}`;
        if (autoStopTargetTime > 0) {
            const remaining = autoStopTargetTime - Date.now();
            if (remaining <= 0) {
                stopScript();
                document.getElementById('ka-status').textContent = "⏰ 定时任务结束";
                document.getElementById('ka-status').style.color = "#FFC107";
                document.getElementById('ka-timer-countdown').textContent = "00:00:00";
                alert("挂机助手：已到达设定时间，自动停止。");
                return;
            }
            const rh = Math.floor(remaining/3600000).toString().padStart(2,'0');
            const rm = Math.floor((remaining%3600000)/60000).toString().padStart(2,'0');
            const rs = Math.floor((remaining%60000)/1000).toString().padStart(2,'0');
            document.getElementById('ka-timer-countdown').textContent = `${rh}:${rm}:${rs}`;
        }
    }

    function startScript() {
        if (isRunning) return;
        if (!document.getElementById('ka-key1').value && !document.getElementById('ka-key2').value) { alert('请设置按键'); return; }
        if (!isVerified) { verifyNetwork(); return; }

        const timerEnabled = document.getElementById('ka-timer-switch').checked;
        if (timerEnabled) {
            const stopH = parseInt(document.getElementById('ka-stop-h').value) || 0;
            const stopM = parseInt(document.getElementById('ka-stop-m').value) || 0;
            if (stopH > 0 || stopM > 0) {
                autoStopTargetTime = Date.now() + (stopH * 3600000) + (stopM * 60000);
                document.getElementById('ka-countdown-row').style.display = 'flex';
                console.log(`[系统] 定时任务开启，${stopH}小时${stopM}分后停止`);
            } else { autoStopTargetTime = 0; document.getElementById('ka-countdown-row').style.display = 'none'; }
        } else { autoStopTargetTime = 0; document.getElementById('ka-countdown-row').style.display = 'none'; }

        document.getElementById('ka-start-btn').style.display = 'none';
        document.getElementById('ka-stop-btn').style.display = 'block';
        disableInputs(true);
        isRunning = true;
        sessionStartTime = Date.now();
        currentKeyIndex = 0;
        timeInterval = setInterval(updateRunTime, 1000);
        runLoop();
        document.getElementById('ka-status').textContent = "挂机运行中...";
    }

    function stopScript() {
        if (!isRunning) return;
        isRunning = false;
        clearTimeout(timer);
        clearInterval(timeInterval);
        totalRunTime += (Date.now() - sessionStartTime);
        document.getElementById('ka-start-btn').style.display = 'block';
        document.getElementById('ka-stop-btn').style.display = 'none';
        document.getElementById('ka-countdown-row').style.display = 'none';
        disableInputs(false);
        document.getElementById('ka-status').textContent = "已暂停";
        document.getElementById('ka-status').style.color = "#aaa";
    }

    function disableInputs(disabled) {
        ['ka-key1', 'ka-key2', 'ka-interval', 'ka-timer-switch'].forEach(id => document.getElementById(id).disabled = disabled);
        if (disabled) { document.getElementById('ka-stop-h').disabled = true; document.getElementById('ka-stop-m').disabled = true; }
        else {
            const timerEnabled = document.getElementById('ka-timer-switch').checked;
            if (timerEnabled) { document.getElementById('ka-stop-h').disabled = false; document.getElementById('ka-stop-m').disabled = false; }
        }
    }

    initPanel();
    verifyNetwork();
})();
