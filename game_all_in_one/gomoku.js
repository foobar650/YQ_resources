<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>五子棋 · Gomoku</title>
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: #0f1115;
    color: #e6e8ee;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  body {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: 100vh;
    padding: 16px;
    box-sizing: border-box;
  }
  #app {
    width: 100%;
    max-width: 620px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .loader-bar {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    font-size: 13px;
  }
  .badge {
    padding: 4px 12px;
    border-radius: 999px;
    background: rgba(255,255,255,.08);
    border: 1px solid rgba(255,255,255,.12);
    font-size: 12px;
    line-height: 1.6;
    white-space: nowrap;
  }
  .badge.host { background: rgba(64,158,255,.18); border-color: rgba(64,158,255,.5); color: #7cc0ff; }
  .badge.guest { background: rgba(255,159,64,.18); border-color: rgba(255,159,64,.5); color: #ffbf7c; }
  .badge.turn { background: rgba(82,196,26,.18); border-color: rgba(82,196,26,.5); color: #8ce05a; }
  .badge.wait { background: rgba(255,255,255,.08); color: #b8bcc6; }
  .badge.over { background: rgba(255,77,79,.18); border-color: rgba(255,77,79,.5); color: #ff9a9b; }
  .game-area {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .game-canvas {
    display: block;
    width: 100%;
    max-width: 552px;
    aspect-ratio: 1 / 1;
    height: auto;
    border-radius: 10px;
    touch-action: none;
    box-shadow: 0 8px 28px rgba(0,0,0,.45);
    cursor: pointer;
  }
  .hint-bar {
    width: 100%;
    max-width: 552px;
    font-size: 13px;
    color: #b8bcc6;
    text-align: center;
    min-height: 20px;
    line-height: 1.5;
  }
  .log-box {
    width: 100%;
    max-width: 552px;
    height: 88px;
    overflow-y: auto;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
    font-size: 12px;
    line-height: 1.7;
    color: #9aa0ab;
  }
  .log-box .sys { color: #8ce05a; }
  .log-box .send { color: #7cc0ff; }
  .log-box .recv { color: #ffbf7c; }
  .log-box .err { color: #ff9a9b; }
  .hidden { display: none !important; }
</style>
</head>
<body>

<div id="app">
  <div class="loader-bar">
    <span class="badge" id="statusBadge">未连接</span>
  </div>
  <div class="game-area" id="gameArea"></div>
  <div class="hint-bar" id="hintBar">等待连接…</div>
  <div class="log-box" id="logBox"></div>
</div>

<!-- 极简加载器：仅用于本地独立运行 / 预览，真实环境由 index.html 提供 -->
<script>
(function () {
  'use strict';

  var registry = {};
  window.GameRegistry = {
    register: function (id, def) { registry[id] = def; },
    list: function () { return registry; }
  };

  var statusBadge = document.getElementById('statusBadge');
  var hintBar = document.getElementById('hintBar');
  var logBox = document.getElementById('logBox');
  var gameArea = document.getElementById('gameArea');

  function log(msg, type) {
    var line = document.createElement('div');
    line.className = type || 'sys';
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
  }

  // 预览用：无 WebRTC，isHost = true，send 只写日志
  var api = {
    isHost: true,
    send: function (obj) { log('→ ' + JSON.stringify(obj), 'send'); return true; },
    log: log,
    setStatus: function (text, cls) {
      statusBadge.textContent = text;
      statusBadge.className = 'badge ' + (cls || '');
    },
    setHint: function (text) { hintBar.textContent = text; }
  };

  // 本文件就是游戏模块，先加载它，再启动
  window.__previewApi = api;
})();
<\/script>

<!-- ===================== 游戏模块 ===================== -->
<script>
/* =========================================================
 * 五子棋 · Gomoku  —— 独立的游戏模块
 * 依赖：window.GameRegistry（由加载器提供）
 * 约定：主机(发起方)执黑先手，客机(应答方)执白后手
 * ======================================================= */
(function () {
  'use strict';

  if (!window.GameRegistry || typeof window.GameRegistry.register !== 'function') {
    return;
  }

  /* ---------------- 常量 ---------------- */
  var N = 15;                                   // 15×15 棋盘
  var CELL = 36;                                // 逻辑格距
  var PAD = 24;                                 // 边距
  var SIZE = PAD * 2 + CELL * (N - 1);          // 逻辑尺寸 552
  var PREFIX = 'g5:';                           // 消息前缀，避免与加载器 t:'select' 冲突
  var STONE_R = CELL * 0.44;
  var STAR_POINTS = [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]];
  var COLS = 'ABCDEFGHIJKLMNO';

  window.GameRegistry.register('gomoku', {
    name: '五子棋',
    icon: '⚫',
    desc: '15×15 经典五子棋，发起方执黑先手',
    create: function (api) {

      /* ---------------- 模块状态 ---------------- */
      var rootEl = null;      // 本游戏根节点
      var canvas = null;
      var ctx = null;
      var dpr = 1;
      var restartBtn = null;
      var infoEl = null;

      var board = [];         // 0 空 / 1 黑(主机) / 2 白(客机)
      var turn = 'host';      // 'host' | 'guest'，表示该谁落子
      var gameOver = false;
      var winner = null;      // null | 'host' | 'guest' | 'draw'
      var lastMove = null;    // { x, y }
      var moveCount = 0;
      var hover = null;       // { x, y }
      var rafId = null;       // 本游戏按需重绘，保留字段以便统一清理

      var handlers = {};      // 保存事件处理器引用，unmount 时精确移除

      /* ---------------- 基础工具 ---------------- */

      function myRole() { return api.isHost ? 'host' : 'guest'; }
      function myColor() { return api.isHost ? 1 : 2; }

      function inb(x, y) { return x >= 0 && x < N && y >= 0 && y < N; }

      function coordText(x, y) {
        return COLS.charAt(x) + (y + 1);
      }

      function createBoard() {
        var b = new Array(N);
        for (var y = 0; y < N; y++) {
          b[y] = new Array(N);
          for (var x = 0; x < N; x++) { b[y][x] = 0; }
        }
        return b;
      }

      /**
       * 判断以 (x,y) 为落点、颜色为 color 的棋子是否形成五连。
       * 四个方向：横、竖、主对角、副对角。
       */
      function checkWin(x, y, color) {
        var dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (var d = 0; d < dirs.length; d++) {
          var dx = dirs[d][0], dy = dirs[d][1];
          var count = 1;
          var nx = x + dx, ny = y + dy;
          while (inb(nx, ny) && board[ny][nx] === color) { count++; nx += dx; ny += dy; }
          nx = x - dx; ny = y - dy;
          while (inb(nx, ny) && board[ny][nx] === color) { count++; nx -= dx; ny -= dy; }
          if (count >= 5) { return true; }
        }
        return false;
      }

      /* ---------------- 渲染 ---------------- */

      function drawStone(cx, cy, color) {
        var g = ctx.createRadialGradient(
          cx - STONE_R * 0.35, cy - STONE_R * 0.35, STONE_R * 0.12,
          cx, cy, STONE_R
        );
        if (color === 1) {
          g.addColorStop(0, '#7d7d7d');
          g.addColorStop(0.45, '#2b2b2b');
          g.addColorStop(1, '#000000');
        } else {
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.7, '#efefef');
          g.addColorStop(1, '#c2c2c2');
        }
        ctx.beginPath();
        ctx.arc(cx, cy, STONE_R, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = (color === 1) ? 'rgba(0,0,0,0.55)' : 'rgba(130,130,130,0.7)';
        ctx.stroke();
      }

      function drawBoard() {
        if (!ctx || !canvas) { return; }

        // DPR 适配：每次重绘前重置变换，保证逻辑坐标可用
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, SIZE, SIZE);

        // 木质背景
        var bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
        bg.addColorStop(0, '#eac58c');
        bg.addColorStop(0.5, '#e0b676');
        bg.addColorStop(1, '#d3a463');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, SIZE, SIZE);

        // 网格线
        ctx.strokeStyle = 'rgba(90, 58, 28, 0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 0; i < N; i++) {
          var p = PAD + i * CELL;
          ctx.moveTo(PAD, p);
          ctx.lineTo(SIZE - PAD, p);
          ctx.moveTo(p, PAD);
          ctx.lineTo(p, SIZE - PAD);
        }
        ctx.stroke();

        // 外边框加粗
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(80, 50, 22, 0.95)';
        ctx.strokeRect(PAD - 0.5, PAD - 0.5, SIZE - 2 * PAD + 1, SIZE - 2 * PAD + 1);

        // 星位
        ctx.fillStyle = 'rgba(80, 50, 22, 0.95)';
        for (var s = 0; s < STAR_POINTS.length; s++) {
          var sx = PAD + STAR_POINTS[s][0] * CELL;
          var sy = PAD + STAR_POINTS[s][1] * CELL;
          ctx.beginPath();
          ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // 悬停预览（仅在轮到己方且该点为空时显示）
        if (hover && !gameOver && turn === myRole() &&
            inb(hover.x, hover.y) && board[hover.y][hover.x] === 0) {
          ctx.globalAlpha = 0.35;
          drawStone(PAD + hover.x * CELL, PAD + hover.y * CELL, myColor());
          ctx.globalAlpha = 1;
        }

        // 棋子
        for (var yy = 0; yy < N; yy++) {
          for (var xx = 0; xx < N; xx++) {
            if (board[yy][xx] !== 0) {
              drawStone(PAD + xx * CELL, PAD + yy * CELL, board[yy][xx]);
            }
          }
        }

        // 最后一手标记（红点）
        if (lastMove) {
          var lx = PAD + lastMove.x * CELL;
          var ly = PAD + lastMove.y * CELL;
          ctx.beginPath();
          ctx.arc(lx, ly, CELL * 0.13, 0, Math.PI * 2);
          ctx.fillStyle = '#ff4d4f';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.stroke();
        }
      }

      /* ---------------- 界面提示 ---------------- */

      function updateUI() {
        var me = myRole();

        if (gameOver) {
          if (winner === 'draw') {
            api.setStatus('平局', 'over');
            api.setHint('棋盘已满，平局。点击「重新开始」再来一局');
          } else if (winner === me) {
            api.setStatus('你赢了', 'over');
            api.setHint('五连成功！点击「重新开始」再来一局');
          } else {
            api.setStatus('你输了', 'over');
            api.setHint('对方五连获胜。点击「重新开始」再来一局');
          }
          return;
        }

        if (turn === me) {
          api.setStatus('轮到你', 'turn');
          api.setHint('轮到你落子（' + (api.isHost ? '黑棋' : '白棋') + '）· 已下 ' + moveCount + ' 手');
        } else {
          api.setStatus('等待对方', 'wait');
          api.setHint('等待对方落子… · 已下 ' + moveCount + ' 手');
        }
      }

      /* ---------------- 核心逻辑：落子 ---------------- */

      /**
       * 执行一次落子（本地或远端）。
       * @param {number} x
       * @param {number} y
       * @param {'host'|'guest'} by 落子方角色
       * @param {boolean} isLocal 是否为本地玩家操作（本地操作需要广播）
       */
      function doMove(x, y, by, isLocal) {
        if (gameOver) { return false; }
        if (!inb(x, y)) { return false; }
        if (by !== 'host' && by !== 'guest') { return false; }
        if (board[y][x] !== 0) { return false; }

        var color = (by === 'host') ? 1 : 2;
        board[y][x] = color;
        lastMove = { x: x, y: y };
        moveCount++;

        var win = checkWin(x, y, color);
        var draw = false;

        if (win) {
          gameOver = true;
          winner = by;
        } else if (moveCount >= N * N) {
          gameOver = true;
          winner = 'draw';
          draw = true;
        } else {
          // 未分胜负则换手
          turn = (by === 'host') ? 'guest' : 'host';
        }

        hover = null;
        drawBoard();
        updateUI();

        if (isLocal) {
          // 本地落子 -> 广播给对端（权威结果双方各自本地计算，保持一致）
          api.send({
            t: 'g5:move',
            x: x,
            y: y,
            by: by,
            win: win,
            draw: draw
          });
          api.log('落子 ' + coordText(x, y) + (win ? ' · 五连获胜' : ''), 'send');
        } else {
          api.log('对方落子 ' + coordText(x, y) + (win ? ' · 五连获胜' : ''), 'recv');
        }

        return true;
      }

      /* ---------------- 重新开始 ---------------- */

      function resetGame(broadcast) {
        board = createBoard();
        turn = 'host';          // 主机（发起方）先手
        gameOver = false;
        winner = null;
        lastMove = null;
        moveCount = 0;
        hover = null;

        drawBoard();
        updateUI();

        if (broadcast) {
          api.send({ t: 'g5:restart', by: myRole() });
        }
      }

      /* ---------------- 输入：坐标换算 ---------------- */

      function toBoardCoords(clientX, clientY) {
        if (!canvas) { return null; }
        var rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) { return null; }

        // CSS 尺寸可能与逻辑尺寸不同，这里按比例换算回逻辑坐标
        var scaleX = SIZE / rect.width;
        var scaleY = SIZE / rect.height;
        var lx = (clientX - rect.left) * scaleX;
        var ly = (clientY - rect.top) * scaleY;

        var x = Math.round((lx - PAD) / CELL);
        var y = Math.round((ly - PAD) / CELL);
        if (!inb(x, y)) { return null; }

        // 距离交叉点过远则视为无效点击，避免误触
        var cx = PAD + x * CELL;
        var cy = PAD + y * CELL;
        var dx = lx - cx, dy = ly - cy;
        var limit = CELL * 0.62;
        if (dx * dx + dy * dy > limit * limit) { return null; }

        return { x: x, y: y };
      }

      /* ---------------- 消息处理 ---------------- */

      function handleRemoteMove(msg) {
        var x = msg.x, y = msg.y, by = msg.by;

        // 防御性校验：非法字段直接丢弃，不抛异常
        if (typeof x !== 'number' || typeof y !== 'number') { return; }
        if (!isFinite(x) || !isFinite(y)) { return; }
        x = Math.floor(x); y = Math.floor(y);
        if (!inb(x, y)) { return; }
        if (by !== 'host' && by !== 'guest') { return; }
        if (by === myRole()) { return; }        // 不应收到「己方」的落子
        if (gameOver) { return; }
        if (turn !== by) { return; }            // 回合不符，丢弃
        if (board[y][x] !== 0) { return; }      // 该点已有棋子

        doMove(x, y, by, false);
      }

      function handleRemoteRestart() {
        // 双方重置为同一初始状态，重复收到也无副作用
        resetGame(false);
        api.log('对方发起「重新开始」', 'recv');
      }

      /* ---------------- 挂载 / 卸载 ---------------- */

      function mount(container) {
        if (!container) { return; }

        // 初始化状态
        board = createBoard();
        turn = 'host';
        gameOver = false;
        winner = null;
        lastMove = null;
        moveCount = 0;
        hover = null;

        // 根节点
        rootEl = document.createElement('div');
        rootEl.className = 'gomoku-root';
        rootEl.style.cssText =
          'display:flex;flex-direction:column;align-items:center;gap:12px;width:100%;';

        // 角色信息
        infoEl = document.createElement('div');
        infoEl.style.cssText = 'font-size:13px;opacity:.8;text-align:center;letter-spacing:.5px;';
        infoEl.textContent = api.isHost
          ? '你执黑棋 · 先手'
          : '你执白棋 · 后手';
        rootEl.appendChild(infoEl);

        // 画布（DPR 适配）
        canvas = document.createElement('canvas');
        canvas.className = 'game-canvas gomoku-canvas';
        canvas.style.cssText =
          'display:block;width:100%;max-width:' + SIZE + 'px;' +
          'aspect-ratio:1 / 1;height:auto;border-radius:10px;' +
          'touch-action:none;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.45);';

        dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
        canvas.width = Math.round(SIZE * dpr);
        canvas.height = Math.round(SIZE * dpr);

        ctx = canvas.getContext('2d');
        if (ctx) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }

        rootEl.appendChild(canvas);

        // 重新开始按钮
        restartBtn = document.createElement('button');
        restartBtn.type = 'button';
        restartBtn.textContent = '重新开始';
        restartBtn.style.cssText =
          'padding:8px 22px;border-radius:8px;font-size:14px;cursor:pointer;' +
          'border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);' +
          'color:inherit;outline:none;transition:background .15s;';
        rootEl.appendChild(restartBtn);

        container.appendChild(rootEl);

        /* -------- 事件绑定（全部记录引用以便 unmount 精确移除） -------- */

        handlers.pointerdown = function (e) {
          e.preventDefault();
          if (gameOver) { return; }
          if (turn !== myRole()) { return; }

          var p = toBoardCoords(e.clientX, e.clientY);
          if (!p) { return; }
          if (board[p.y][p.x] !== 0) { return; }

          doMove(p.x, p.y, myRole(), true);
        };

        handlers.pointermove = function (e) {
          if (gameOver || turn !== myRole()) {
            if (hover) { hover = null; drawBoard(); }
            return;
          }
          var p = toBoardCoords(e.clientX, e.clientY);
          var changed = false;
          if (p) {
            if (!hover || hover.x !== p.x || hover.y !== p.y) {
              hover = { x: p.x, y: p.y };
              changed = true;
            }
          } else if (hover) {
            hover = null;
            changed = true;
          }
          if (changed) { drawBoard(); }
        };

        handlers.pointerleave = function () {
          if (hover) {
            hover = null;
            drawBoard();
          }
        };

        handlers.restartClick = function () {
          resetGame(true);
          api.log('你发起「重新开始」', 'info');
        };

        canvas.addEventListener('pointerdown', handlers.pointerdown);
        canvas.addEventListener('pointermove', handlers.pointermove);
        canvas.addEventListener('pointerleave', handlers.pointerleave);
        canvas.addEventListener('pointercancel', handlers.pointerleave);
        restartBtn.addEventListener('click', handlers.restartClick);

        // 首帧绘制 + 初始提示
        drawBoard();
        updateUI();

        api.log(
          '五子棋开始：' + (api.isHost ? '你执黑先手' : '你执白后手'),
          'sys'
        );
      }

      function unmount() {
        // 1) 移除画布事件
        if (canvas) {
          if (handlers.pointerdown) { canvas.removeEventListener('pointerdown', handlers.pointerdown); }
          if (handlers.pointermove) { canvas.removeEventListener('pointermove', handlers.pointermove); }
          if (handlers.pointerleave) {
            canvas.removeEventListener('pointerleave', handlers.pointerleave);
            canvas.removeEventListener('pointercancel', handlers.pointerleave);
          }
        }

        // 2) 移除按钮事件
        if (restartBtn && handlers.restartClick) {
          restartBtn.removeEventListener('click', handlers.restartClick);
        }

        // 3) 取消动画帧（本游戏按需重绘，一般不会有，但统一清理）
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        // 4) 移除 DOM
        if (rootEl && rootEl.parentNode) {
          rootEl.parentNode.removeChild(rootEl);
        }

        // 5) 置空引用，避免内存泄漏
        rootEl = null;
        infoEl = null;
        canvas = null;
        ctx = null;
        restartBtn = null;
        board = [];
        hover = null;
        lastMove = null;
        gameOver = false;
        winner = null;
        moveCount = 0;
        handlers = {};
      }

      /* ---------------- 对外 controller ---------------- */

      return {
        mount: mount,
        unmount: unmount,
        handleMessage: function (msg) {
          if (!msg || typeof msg !== 'object') { return; }
          var t = msg.t;
          // 只处理本游戏消息，避免与加载器的 t:'select' 冲突
          if (typeof t !== 'string' || t.indexOf(PREFIX) !== 0) { return; }

          try {
            if (t === 'g5:move') {
              handleRemoteMove(msg);
            } else if (t === 'g5:restart') {
              handleRemoteRestart();
            }
            // 其它未知前缀消息静默忽略
          } catch (err) {
            // 不静默吞掉影响状态同步的错误
            api.log('五子棋处理消息异常：' + (err && err.message ? err.message : String(err)), 'err');
          }
        }
      };
    }
  });

  /* ===== 本地预览启动（真实环境中由加载器调用 mount，此处自动兜底） ===== */
  if (window.__previewApi && !window.__previewStarted) {
    window.__previewStarted = true;
    var def = window.GameRegistry.list()['gomoku'];
    if (def) {
      var controller = def.create(window.__previewApi);
      var area = document.getElementById('gameArea');
      if (area) { controller.mount(area); }
      window.__previewApi.setStatus('预览模式', 'host');
      window.__previewApi.setHint('本地预览：你执黑先手，点击棋盘交叉点落子');
    }
  }

})();
<\/script>

</body>
</html>