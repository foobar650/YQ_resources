/* =========================================================================
 * 五子棋 · 经典 15×15
 * 用于「WebRTC 手动信令游戏加载器」的独立游戏脚本
 *  - 经典 <script> 加载，IIFE 包裹，不污染全局
 *  - 仅依赖 window.GameRegistry 与注入的 api
 *  - 主机（发起方，api.isHost === true）执黑先手，且为权威方
 *  - 客机（应答方）执白后手，只上报落子请求，等待主机广播权威状态
 * ========================================================================= */
(function () {
  'use strict';

  if (!window.GameRegistry || typeof window.GameRegistry.register !== 'function') {
    // 加载器未就绪，直接放弃注册（不抛异常）
    if (window.console && console.error) {
      console.error('[gomoku] 未找到 window.GameRegistry，无法注册游戏');
    }
    return;
  }

  /* ----------------------------- 常量定义 ----------------------------- */
  var N = 15;                                  // 棋盘 15×15
  var SIZE = 540;                              // 逻辑画布边长（正方形）
  var PAD = 30;                                // 棋盘内边距
  var GAP = (SIZE - PAD * 2) / (N - 1);        // 相邻交叉点间距
  var STAR = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]]; // 星位（行, 列）
  var EMPTY = '.';
  var BLACK = '1';                             // 主机（发起方）执黑，先手
  var WHITE = '2';                             // 客机（应答方）执白，后手

  // 所有游戏消息统一加 gomoku: 前缀，避免与加载器的 t:'select' 等冲突
  var MSG_HELLO = 'gomoku:hello';              // 客机 → 主机：请求状态同步
  var MSG_MOVE = 'gomoku:move';                // 客机 → 主机：落子请求
  var MSG_STATE = 'gomoku:state';              // 主机 → 客机：权威完整状态

  /* --------------------------- 游戏控制器工厂 -------------------------- */
  function create(api) {
    /* --------------------------- 运行时状态 --------------------------- */
    var myColor = api.isHost ? BLACK : WHITE;  // 本端棋子颜色
    var pendingMove = -1;                      // 客机已提交待确认的落子索引
    var state = {
      board: [],      // 长度 N*N 的字符数组：'.' / '1' / '2'
      turn: BLACK,    // 当前该谁走：'1' 或 '2'
      last: -1,       // 最后一手索引，-1 表示无
      over: false,    // 是否终局
      draw: false,    // 是否和棋
      winner: null,   // 胜方颜色 '1' / '2' / null
      win: null,      // 获胜连线索引数组
      moves: 0        // 已落子数
    };

    /* --------------------------- DOM / 渲染引用 --------------------------- */
    var root = null;
    var canvas = null;
    var ctx = null;
    var infoEl = null;
    var btnRow = null;
    var restartBtn = null;
    var rafId = 0;
    var lastDpr = 0;

    /* ------------------------------ 初始化 ------------------------------ */
    resetState();

    /* ------------------------------ 工具 ------------------------------ */
    function getDpr() {
      var d = window.devicePixelRatio || 1;
      if (!isFinite(d) || d < 1) d = 1;
      if (d > 3) d = 3;   // 限制上限，避免超大画布拖慢渲染
      return d;
    }

    // 带防御的发送封装：任何异常都不应中断游戏逻辑
    function send(obj) {
      try {
        var ok = api.send(obj);
        if (ok === false) api.log('发送失败（通道拥塞或已关闭）', 'err');
        return ok;
      } catch (e) {
        api.log('发送异常：' + (e && e.message ? e.message : e), 'err');
        return false;
      }
    }

    /* ---------------------------- 状态管理 ---------------------------- */
    function resetState() {
      state.board = [];
      for (var i = 0; i < N * N; i++) state.board.push(EMPTY);
      state.turn = BLACK;   // 黑棋（主机）永远先手
      state.last = -1;
      state.over = false;
      state.draw = false;
      state.winner = null;
      state.win = null;
      state.moves = 0;
      pendingMove = -1;
    }

    /* -------------------------- 胜负判定（权威方） -------------------------- */
    // 以 idx 为中心检查四个方向是否形成五连，返回有序连线索引数组或 null
    function findWin(idx, color) {
      var r = Math.floor(idx / N);
      var c = idx % N;
      var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];

      for (var d = 0; d < dirs.length; d++) {
        var dr = dirs[d][0];
        var dc = dirs[d][1];
        var pos = [];
        var neg = [];
        var rr, cc, i;

        // 正方向延伸
        for (i = 1; i < N; i++) {
          rr = r + dr * i; cc = c + dc * i;
          if (rr < 0 || rr >= N || cc < 0 || cc >= N) break;
          if (state.board[rr * N + cc] !== color) break;
          pos.push(rr * N + cc);
        }
        // 反方向延伸
        for (i = 1; i < N; i++) {
          rr = r - dr * i; cc = c - dc * i;
          if (rr < 0 || rr >= N || cc < 0 || cc >= N) break;
          if (state.board[rr * N + cc] !== color) break;
          neg.push(rr * N + cc);
        }

        // 长连（>=5）同样判胜（无禁手规则）
        if (pos.length + neg.length + 1 >= 5) {
          // 按「负端 → idx → 正端」排列，方便直接取首尾画高亮线
          return neg.reverse().concat([idx], pos);
        }
      }
      return null;
    }

    /* -------------------------- 主机：落子 + 广播 -------------------------- */
    // 主机是唯一权威方：只有这里能修改棋盘，修改完立刻广播完整状态
    function hostCommit(r, c, color) {
      var idx = r * N + c;
      if (state.board[idx] !== EMPTY) return false;

      state.board[idx] = color;
      state.last = idx;
      state.moves++;

      var line = findWin(idx, color);
      if (line) {
        state.win = line;
        state.winner = color;
        state.over = true;
      } else if (state.moves >= N * N) {
        state.over = true;
        state.draw = true;      // 棋盘填满且无人五连 → 和棋
      } else {
        state.turn = (color === BLACK) ? WHITE : BLACK; // 换手
      }

      pendingMove = -1;
      render();
      updateStatus();
      broadcastState();
      return true;
    }

    // 广播权威完整状态（225 字符的棋盘串，体积小、天然防错位）
    function broadcastState() {
      send({
        t: MSG_STATE,
        b: state.board.join(''),
        turn: state.turn,
        last: state.last,
        over: state.over,
        draw: state.draw,
        winner: state.winner,
        win: state.win
      });
    }

    /* -------------------------- 客机：应用权威状态 -------------------------- */
    function applyHostState(msg) {
      // 严格校验棋盘串，任何异常字段直接丢弃，不抛异常
      var b = msg.b;
      if (typeof b !== 'string' || b.length !== N * N) return;
      for (var i = 0; i < b.length; i++) {
        var ch = b.charAt(i);
        if (ch !== EMPTY && ch !== BLACK && ch !== WHITE) return;
      }

      var turn = (msg.turn === WHITE) ? WHITE : BLACK;
      var last = (typeof msg.last === 'number' && msg.last >= 0 && msg.last < N * N)
        ? (msg.last | 0) : -1;
      var winner = (msg.winner === BLACK || msg.winner === WHITE) ? msg.winner : null;

      var win = null;
      if (Object.prototype.toString.call(msg.win) === '[object Array]') {
        var tmp = [];
        for (var k = 0; k < msg.win.length; k++) {
          var v = msg.win[k];
          if (typeof v === 'number' && v >= 0 && v < N * N) tmp.push(v | 0);
        }
        if (tmp.length >= 5) win = tmp;
      }

      state.board = b.split('');
      state.turn = turn;
      state.last = last;
      state.over = !!msg.over;
      state.draw = !!msg.draw;
      state.winner = winner;
      state.win = win;
      state.moves = 0;
      for (var j = 0; j < state.board.length; j++) {
        if (state.board[j] !== EMPTY) state.moves++;
      }

      pendingMove = -1;   // 收到权威状态后解除「等待确认」锁定
      render();
      updateStatus();
    }

    /* ------------------------------ 绘制 ------------------------------ */
    function setupCanvas() {
      if (!canvas) return;
      var dpr = getDpr();
      lastDpr = dpr;
      canvas.width = Math.round(SIZE * dpr);
      canvas.height = Math.round(SIZE * dpr);
      ctx = canvas.getContext('2d');
      if (!ctx) return;
      // DPR 适配：之后所有绘制都用逻辑坐标（0 ~ SIZE）
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawStone(x, y, color) {
      var r = GAP * 0.44;
      var grd = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.12, x, y, r);
      if (color === BLACK) {
        grd.addColorStop(0, '#6e6e6e');
        grd.addColorStop(1, '#080808');
      } else {
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(1, '#c6c6c6');
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = (color === BLACK) ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.28)';
      ctx.stroke();
    }

    // 回合制游戏：只在状态变化时重绘，无需 rAF 每帧循环
    function render() {
      if (!ctx) return;
      var i, r, c, p;

      ctx.clearRect(0, 0, SIZE, SIZE);

      // 棋盘底色
      var bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
      bg.addColorStop(0, '#f0dcae');
      bg.addColorStop(1, '#d7b076');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, SIZE, SIZE);

      // 网格线
      ctx.strokeStyle = 'rgba(92, 60, 24, 0.68)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (i = 0; i < N; i++) {
        p = PAD + i * GAP;
        ctx.moveTo(PAD, p);
        ctx.lineTo(PAD + (N - 1) * GAP, p);
        ctx.moveTo(p, PAD);
        ctx.lineTo(p, PAD + (N - 1) * GAP);
      }
      ctx.stroke();

      // 外框加粗
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(78, 48, 16, 0.9)';
      ctx.strokeRect(PAD, PAD, (N - 1) * GAP, (N - 1) * GAP);

      // 星位
      ctx.fillStyle = 'rgba(70, 44, 16, 0.9)';
      for (i = 0; i < STAR.length; i++) {
        ctx.beginPath();
        ctx.arc(PAD + STAR[i][1] * GAP, PAD + STAR[i][0] * GAP, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // 棋子
      for (r = 0; r < N; r++) {
        for (c = 0; c < N; c++) {
          var v = state.board[r * N + c];
          if (v === BLACK || v === WHITE) {
            drawStone(PAD + c * GAP, PAD + r * GAP, v);
          }
        }
      }

      // 最后一手标记
      if (state.last >= 0 && state.last < N * N) {
        var lr = Math.floor(state.last / N);
        var lc = state.last % N;
        var lx = PAD + lc * GAP;
        var ly = PAD + lr * GAP;
        ctx.beginPath();
        ctx.arc(lx, ly, Math.max(2, GAP * 0.14), 0, Math.PI * 2);
        ctx.fillStyle = (state.board[state.last] === BLACK) ? '#ff9c3c' : '#3b7ce0';
        ctx.fill();
      }

      // 获胜连线高亮
      if (state.win && state.win.length >= 5) {
        var a = state.win[0];
        var z = state.win[state.win.length - 1];
        ctx.save();
        ctx.strokeStyle = 'rgba(240, 60, 60, 0.85)';
        ctx.lineWidth = Math.max(3, GAP * 0.13);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(PAD + (a % N) * GAP, PAD + Math.floor(a / N) * GAP);
        ctx.lineTo(PAD + (z % N) * GAP, PAD + Math.floor(z / N) * GAP);
        ctx.stroke();
        ctx.restore();
      }
    }

    /* ---------------------------- 状态徽章 / 提示 ---------------------------- */
    function updateStatus() {
      if (state.over) {
        if (state.draw) {
          api.setStatus('和棋', 'over');
          api.setHint('棋盘已满，双方战平。' + (api.isHost ? '点击「重新开始」再来一局。' : '等待主机重新开始。'));
        } else if (state.winner === myColor) {
          api.setStatus('你赢了', 'over');
          api.setHint('五子连珠，恭喜获胜！' + (api.isHost ? '点击「重新开始」再来一局。' : '等待主机重新开始。'));
        } else if (state.winner) {
          api.setStatus('你输了', 'over');
          api.setHint('对方五子连珠。' + (api.isHost ? '点击「重新开始」再来一局。' : '等待主机重新开始。'));
        } else {
          api.setStatus('对局结束', 'over');
          api.setHint('本局已结束。');
        }
        return;
      }

      if (state.turn === myColor) {
        api.setStatus('你的回合', 'turn');
        api.setHint(pendingMove >= 0 ? '落子已提交，等待主机确认…' : '点击棋盘交叉点落子');
      } else {
        api.setStatus('对方回合', 'wait');
        api.setHint(pendingMove >= 0 ? '落子已提交，等待主机确认…' : '等待对方落子…');
      }
    }

    /* ------------------------------ 输入处理 ------------------------------ */
    function onPointerDown(e) {
      if (!canvas) return;
      if (e && typeof e.preventDefault === 'function') e.preventDefault();

      var rect = canvas.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;

      // CSS 会缩放画布，这里把屏幕坐标换算回逻辑坐标
      var x = (e.clientX - rect.left) * (SIZE / rect.width);
      var y = (e.clientY - rect.top) * (SIZE / rect.height);

      var c = Math.round((x - PAD) / GAP);
      var r = Math.round((y - PAD) / GAP);
      if (r < 0 || r >= N || c < 0 || c >= N) return;

      // 点得太偏（离交叉点超过半个格）视为无效
      var px = PAD + c * GAP;
      var py = PAD + r * GAP;
      var dx = x - px;
      var dy = y - py;
      if (Math.sqrt(dx * dx + dy * dy) > GAP * 0.55) return;

      handleClick(r, c);
    }

    function handleClick(r, c) {
      if (!state || state.over) return;
      if (state.turn !== myColor) {
        api.setHint('还没轮到你落子。');
        return;
      }
      var idx = r * N + c;
      if (state.board[idx] !== EMPTY) return;   // 已有棋子

      if (api.isHost) {
        // 主机 = 权威方：本地直接判定并落子
        hostCommit(r, c, myColor);
      } else {
        // 客机：只上报请求，绝不本地改棋盘，等主机广播
        if (pendingMove >= 0) return;           // 防止重复提交
        var ok = send({ t: MSG_MOVE, r: r, c: c });
        if (ok) {
          pendingMove = idx;
          api.setHint('落子已提交，等待主机确认…');
        }
      }
    }

    function onRestartClick(e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (!api.isHost) return;                  // 只有主机能开局
      resetState();
      render();
      updateStatus();
      broadcastState();
      api.log('主机重新开始对局', 'sys');
    }

    function onWindowResize() {
      if (!canvas) return;
      // 仅在 DPR 变化时重建画布（普通缩放由 CSS 处理，坐标换算已兼容）
      if (getDpr() !== lastDpr) {
        setupCanvas();
        render();
      }
    }

    /* ------------------------------ 生命周期 ------------------------------ */
    function mount(container) {
      if (!container) return;

      root = document.createElement('div');
      root.className = 'gomoku-root';
      root.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;' +
        'padding:12px;box-sizing:border-box;width:100%;';

      infoEl = document.createElement('div');
      infoEl.style.cssText = 'font:inherit;font-size:13px;opacity:.7;text-align:center;letter-spacing:.4px;';
      infoEl.textContent = (api.isHost ? '你执黑先行' : '你执白后行') +
        ' · 横、竖、斜任意方向连成五子获胜';

      canvas = document.createElement('canvas');
      canvas.className = 'game-canvas gomoku-canvas';
      canvas.style.cssText = 'display:block;width:100%;max-width:540px;aspect-ratio:1 / 1;' +
        'border-radius:12px;touch-action:none;cursor:crosshair;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.28);';
      canvas.setAttribute('aria-label', '五子棋棋盘');

      btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px;align-items:center;';

      restartBtn = document.createElement('button');
      restartBtn.type = 'button';
      restartBtn.textContent = '重新开始';
      restartBtn.style.cssText = 'font:inherit;font-size:13px;padding:6px 16px;border-radius:8px;' +
        'border:1px solid rgba(140,160,190,.45);background:rgba(140,160,190,.15);' +
        'color:inherit;cursor:pointer;transition:opacity .15s;';
      if (api.isHost) {
        restartBtn.addEventListener('click', onRestartClick);
      } else {
        // 客机无权开局，按钮置灰仅作展示
        restartBtn.disabled = true;
        restartBtn.style.opacity = '0.45';
        restartBtn.style.cursor = 'not-allowed';
      }

      btnRow.appendChild(restartBtn);
      root.appendChild(infoEl);
      root.appendChild(canvas);
      root.appendChild(btnRow);
      container.appendChild(root);

      // 绑定输入事件
      canvas.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('resize', onWindowResize);

      // 初始化渲染与提示
      resetState();
      setupCanvas();
      render();
      updateStatus();

      // 主机先广播一次（若客机已就绪可立即同步）；客机发 hello 请求同步
      if (api.isHost) {
        broadcastState();
      } else {
        send({ t: MSG_HELLO });
      }
    }

    function unmount() {
      // 移除所有事件监听（含 window 级）
      if (canvas) {
        canvas.removeEventListener('pointerdown', onPointerDown);
      }
      if (restartBtn) {
        restartBtn.removeEventListener('click', onRestartClick);
      }
      window.removeEventListener('resize', onWindowResize);

      // 取消可能存在的动画帧
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }

      // 移除 DOM 并置空引用，避免内存泄漏
      if (root && root.parentNode) {
        root.parentNode.removeChild(root);
      }
      root = null;
      canvas = null;
      ctx = null;
      infoEl = null;
      btnRow = null;
      restartBtn = null;
      pendingMove = -1;
    }

    /* ---------------------------- 消息处理 ---------------------------- */
    function handleMessage(msg) {
      if (!msg || typeof msg !== 'object') return;
      var t = msg.t;
      if (typeof t !== 'string') return;

      // 客机请求同步：主机重播完整状态
      if (t === MSG_HELLO) {
        if (!api.isHost) return;
        broadcastState();
        return;
      }

      // 落子请求：只有主机处理
      if (t === MSG_MOVE) {
        if (!api.isHost) return;

        var r = msg.r;
        var c = msg.c;
        if (typeof r !== 'number' || typeof c !== 'number') return;
        if (!isFinite(r) || !isFinite(c)) return;
        r = r | 0;
        c = c | 0;

        // 越界 / 终局 / 非客机回合 / 重复落子 —— 全部拒绝并回播状态重新对齐
        if (r < 0 || r >= N || c < 0 || c >= N) { broadcastState(); return; }
        if (state.over) { broadcastState(); return; }
        if (state.turn !== WHITE) { broadcastState(); return; }
        if (state.board[r * N + c] !== EMPTY) { broadcastState(); return; }

        hostCommit(r, c, WHITE);
        return;
      }

      // 权威状态：只有客机处理
      if (t === MSG_STATE) {
        if (api.isHost) return;   // 主机忽略状态广播（防止自激）
        applyHostState(msg);
        return;
      }

      // 其它 t 属于别的游戏，静默忽略
    }

    /* ------------------------------ 导出 ------------------------------ */
    return {
      mount: mount,
      unmount: unmount,
      handleMessage: handleMessage
    };
  }

  /* ------------------------------ 注册 ------------------------------ */
  // 注意：id 必须与加载清单中的 id 保持一致，且只能注册一次
  window.GameRegistry.register('gomoku', {
    name: '五子棋',
    icon: '⚫',
    desc: '经典 15×15 五子棋，发起方执黑先手',
    create: create
  });

})();