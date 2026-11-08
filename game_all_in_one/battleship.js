/**
 * 海战棋模块（完整版）
 * 依赖 window.GameRegistry（由 index.html 提供）
 *
 * 消息协议（index.html 只拦截 t === 'select'，其余全部转发给本模块）：
 *   bs:config   { ships:[{len,count}] }   主机广播舰队配置
 *   bs:ready    {}                         一方部署完成
 *   bs:start    { firstTurn:'host'|'guest' } 主机宣布开局与先手
 *   bs:attack   { x,y }                    攻击方发起炮击
 *   bs:result   { x,y,hit,sunk,gameOver,nextTurn } 被攻击方回执
 */
(function () {
  'use strict';

  if (!window.GameRegistry) {
    console.error('[battleship] GameRegistry 未定义，跳过注册');
    return;
  }

  var BS_N = 10;
  var CELL = 28;
  var GRID = BS_N * CELL;          // 280
  var CANVAS_W = 800;
  var CANVAS_H = 820;
  var MY_X = 260, MY_Y = 70;       // 我的海域左上角
  var EN_X = 260, EN_Y = 470;      // 敌方海域左上角

  window.GameRegistry.register('battleship', {
    name: '海战棋',
    icon: '🚢',
    desc: '回合制炮击 · 主机设置舰队配置',

    create: function (api) {
      /* ---------- 状态 ---------- */
      var state = {
        phase: 'idle',          // idle | config | waitConfig | deploy | waitPeer | battle | over
        isHost: !!api.isHost,
        config: [],             // [{len, count}]
        myBoard: null,          // 10x10 { shipId, shot }
        myShots: null,          // 10x10 null|'hit'|'miss'
        myShips: [],            // [{id, len, cells:[{x,y}], hits}]
        myTurn: false,
        deployed: false,
        peerReady: false,
        waitingResult: false,
        gameOver: false,
        iWon: false,
        hoverCell: null
      };

      /* ---------- DOM / 画布 ---------- */
      var canvas = null, ctx = null;
      var panelRoot = null;
      var configPanel = null, waitConfigPanel = null, deployPanel = null, battlePanel = null;
      var shipRowsEl = null, configErrorEl = null, configSummaryEl = null;
      var turnInfoEl = null, resultInfoEl = null, confirmDeployBtn = null;

      /* ---------- 工具 ---------- */
      function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

      function createEmptyBoard() {
        var b = [];
        for (var y = 0; y < BS_N; y++) {
          var row = [];
          for (var x = 0; x < BS_N; x++) row.push({ shipId: null, shot: null });
          b.push(row);
        }
        return b;
      }
      function createEmptyShots() {
        var b = [];
        for (var y = 0; y < BS_N; y++) {
          var row = [];
          for (var x = 0; x < BS_N; x++) row.push(null);
          b.push(row);
        }
        return b;
      }
      function formatConfig(cfg) {
        return cfg.map(function (s) { return s.len + '格×' + s.count; }).join('，');
      }
      function countAliveShips() {
        return state.myShips.filter(function (s) { return s.hits < s.len; }).length;
      }
      function totalShipCells(cfg) {
        return cfg.reduce(function (acc, s) { return acc + s.len * s.count; }, 0);
      }

      /* ============================================================
       * 面板构建
       * ============================================================ */
      function buildConfigPanel() {
        configPanel = document.createElement('div');
        configPanel.className = 'bs-subpanel';
        configPanel.innerHTML =
          '<h3>设置舰队配置</h3>' +
          '<p class="hint" style="margin-bottom:10px;">设置每种舰船的长度（1~5）和数量，总格数不超过 70。</p>' +
          '<div class="bs-ship-rows"></div>' +
          '<div class="row" style="margin-top:10px;">' +
            '<button type="button" class="bs-add-row">+ 添加舰船类型</button>' +
            '<button type="button" class="bs-confirm-config">确认配置</button>' +
          '</div>' +
          '<p class="hint warn bs-config-error"></p>';

        shipRowsEl = configPanel.querySelector('.bs-ship-rows');
        configErrorEl = configPanel.querySelector('.bs-config-error');

        configPanel.querySelector('.bs-add-row').addEventListener('click', function () {
          addConfigRow(2, 1);
        });
        configPanel.querySelector('.bs-confirm-config').addEventListener('click', onConfirmConfig);

        // 默认配置
        addConfigRow(4, 1);
        addConfigRow(3, 2);
        addConfigRow(2, 3);
        addConfigRow(1, 4);
      }

      function addConfigRow(len, count) {
        var row = document.createElement('div');
        row.className = 'bs-config-row';
        row.innerHTML =
          '<span>长度</span>' +
          '<input type="number" min="1" max="5" value="' + len + '" class="bs-input bs-len">' +
          '<span>数量</span>' +
          '<input type="number" min="0" max="6" value="' + count + '" class="bs-input bs-count">' +
          '<button type="button" class="danger bs-del" style="padding:4px 10px;font-size:12px;">删除</button>';
        row.querySelector('.bs-del').addEventListener('click', function () {
          if (row.parentNode) row.parentNode.removeChild(row);
        });
        shipRowsEl.appendChild(row);
      }

      function readConfig() {
        var rows = shipRowsEl.querySelectorAll('.bs-config-row');
        var cfg = [];
        for (var i = 0; i < rows.length; i++) {
          var len = parseInt(rows[i].querySelector('.bs-len').value, 10);
          var cnt = parseInt(rows[i].querySelector('.bs-count').value, 10);
          if (isNaN(len) || isNaN(cnt)) continue;
          if (len < 1 || len > 5) continue;
          if (cnt < 0 || cnt > 6) continue;
          if (cnt === 0) continue;
          var merged = false;
          for (var j = 0; j < cfg.length; j++) {
            if (cfg[j].len === len) { cfg[j].count += cnt; merged = true; break; }
          }
          if (!merged) cfg.push({ len: len, count: cnt });
        }
        return cfg;
      }

      function validateConfig(cfg) {
        if (!cfg.length) return '至少需要一种舰船';
        var total = totalShipCells(cfg);
        var count = cfg.reduce(function (a, s) { return a + s.count; }, 0);
        if (total > 70) return '舰船总格数过多（' + total + ' 格），最多 70 格';
        if (count > 20) return '舰船总数过多（' + count + ' 艘），最多 20 艘';
        return null;
      }

      function buildDeployPanel() {
        deployPanel = document.createElement('div');
        deployPanel.className = 'bs-subpanel';
        deployPanel.innerHTML =
          '<p>舰队配置：<span class="bs-summary">—</span></p>' +
          '<div class="row" style="margin-top:10px;">' +
            '<button type="button" class="bs-random">随机部署</button>' +
            '<button type="button" class="bs-confirm-deploy" disabled>确认部署</button>' +
          '</div>' +
          '<p class="hint bs-deploy-hint">点击「随机部署」生成阵型，满意后确认。</p>';

        configSummaryEl = deployPanel.querySelector('.bs-summary');
        confirmDeployBtn = deployPanel.querySelector('.bs-confirm-deploy');

        deployPanel.querySelector('.bs-random').addEventListener('click', onRandomDeploy);
        confirmDeployBtn.addEventListener('click', onConfirmDeploy);
      }

      function buildWaitConfigPanel() {
        waitConfigPanel = document.createElement('div');
        waitConfigPanel.className = 'bs-subpanel';
        waitConfigPanel.innerHTML = '<p>等待主机设置舰队配置…</p>';
      }

      function buildBattlePanel() {
        battlePanel = document.createElement('div');
        battlePanel.className = 'bs-subpanel';
        battlePanel.innerHTML =
          '<p class="bs-turn" style="font-size:14px;font-weight:600;">—</p>' +
          '<p class="bs-result hint"></p>';
        turnInfoEl = battlePanel.querySelector('.bs-turn');
        resultInfoEl = battlePanel.querySelector('.bs-result');
      }

      function showPanel(name) {
        [configPanel, waitConfigPanel, deployPanel, battlePanel].forEach(function (el) {
          if (el) el.style.display = 'none';
        });
        if (name === 'config' && configPanel) configPanel.style.display = 'block';
        else if (name === 'waitConfig' && waitConfigPanel) waitConfigPanel.style.display = 'block';
        else if (name === 'deploy' && deployPanel) deployPanel.style.display = 'block';
        else if (name === 'battle' && battlePanel) battlePanel.style.display = 'block';
      }

      /* ============================================================
       * 配置阶段
       * ============================================================ */
      function onConfirmConfig() {
        var cfg = readConfig();
        var err = validateConfig(cfg);
        if (err) {
          configErrorEl.textContent = err;
          return;
        }
        configErrorEl.textContent = '';
        state.config = cfg;
        state.phase = 'deploy';

        // 主机把配置广播给客机
        api.send({ t: 'bs:config', ships: cfg });
        api.log('舰队配置已确认：' + formatConfig(cfg) + '，共 ' + totalShipCells(cfg) + ' 格', 'sys');

        enterDeploy();
      }

      function enterDeploy() {
        state.phase = 'deploy';
        state.myBoard = createEmptyBoard();
        state.myShots = createEmptyShots();
        state.myShips = [];
        state.deployed = false;
        state.peerReady = false;

        configSummaryEl.textContent = formatConfig(state.config);
        confirmDeployBtn.disabled = true;
        deployPanel.querySelector('.bs-deploy-hint').textContent =
          '点击「随机部署」生成阵型，满意后确认。';

        showPanel('deploy');
        api.setStatus('部署阶段', 'wait');
        api.setHint('点击「随机部署」生成阵型，确认后等待对方。');
        draw();
      }

      /* ============================================================
       * 随机部署
       * ============================================================ */
      function randomDeploy() {
        var lens = [];
        state.config.forEach(function (s) {
          for (var i = 0; i < s.count; i++) lens.push(s.len);
        });
        lens.sort(function (a, b) { return b - a; });

        for (var outer = 0; outer < 200; outer++) {
          var board = createEmptyBoard();
          var ships = [];
          var ok = true;
          var id = 0;

          for (var i = 0; i < lens.length && ok; i++) {
            var len = lens[i];
            var placed = false;
            for (var attempt = 0; attempt < 300; attempt++) {
              var horiz = Math.random() < 0.5;
              var maxX = horiz ? BS_N - len : BS_N - 1;
              var maxY = horiz ? BS_N - 1 : BS_N - len;
              var sx = Math.floor(Math.random() * (maxX + 1));
              var sy = Math.floor(Math.random() * (maxY + 1));
              var cells = [];
              var canPlace = true;
              for (var k = 0; k < len; k++) {
                var cx = horiz ? sx + k : sx;
                var cy = horiz ? sy : sy + k;
                if (board[cy][cx].shipId !== null) { canPlace = false; break; }
                cells.push({ x: cx, y: cy });
              }
              if (!canPlace) continue;
              var ship = { id: id++, len: len, cells: cells, hits: 0 };
              for (var m = 0; m < cells.length; m++) {
                board[cells[m].y][cells[m].x].shipId = ship.id;
              }
              ships.push(ship);
              placed = true;
              break;
            }
            if (!placed) { ok = false; }
          }
          if (ok) {
            state.myBoard = board;
            state.myShips = ships;
            return true;
          }
        }
        return false;
      }

      function onRandomDeploy() {
        if (state.phase !== 'deploy') return;
        var ok = randomDeploy();
        if (!ok) {
          api.log('随机部署失败，请调整舰队配置（可能是总格数过大导致放不下）', 'err');
          return;
        }
        confirmDeployBtn.disabled = false;
        deployPanel.querySelector('.bs-deploy-hint').textContent =
          '阵型已生成，确认后进入对战。';
        draw();
      }

      function onConfirmDeploy() {
        if (state.phase !== 'deploy' || state.deployed) return;
        state.deployed = true;
        state.phase = 'waitPeer';
        confirmDeployBtn.disabled = true;
        deployPanel.querySelector('.bs-deploy-hint').textContent = '已确认，等待对方部署…';

        api.send({ t: 'bs:ready' });
        api.setStatus('等待对方部署', 'wait');
        api.log('本端部署完成，等待对方…', 'sys');

        maybeStartBattle();
      }

      /* ============================================================
       * 开局
       * ============================================================ */
      function maybeStartBattle() {
        if (!state.deployed || !state.peerReady) return;
        // 主机负责宣布开局
        if (state.isHost) {
          var firstTurn = Math.random() < 0.5 ? 'host' : 'guest';
          api.send({ t: 'bs:start', firstTurn: firstTurn });
          beginBattle(firstTurn);
        }
      }

      function beginBattle(firstTurn) {
        state.phase = 'battle';
        state.gameOver = false;
        state.iWon = false;
        state.waitingResult = false;
        state.myTurn =
          (state.isHost && firstTurn === 'host') ||
          (!state.isHost && firstTurn === 'guest');

        showPanel('battle');
        updateBattleStatus();
        api.setHint('点击下方「敌方海域」的格子发起炮击。');
        draw();
      }

      function updateBattleStatus() {
        if (state.gameOver) {
          api.setStatus(state.iWon ? '你赢了 🎉' : '你输了', state.iWon ? 'host' : 'over');
          turnInfoEl.textContent = state.iWon ? '胜利！对方舰队已全部被击沉。' : '失败！你的舰队已被全部击沉。';
          return;
        }
        if (state.waitingResult) {
          api.setStatus('等待对方回执…', 'wait');
          turnInfoEl.textContent = '已发射，等待对方判定…';
          return;
        }
        if (state.myTurn) {
          api.setStatus('你的回合', 'turn');
          turnInfoEl.textContent = '你的回合：点击敌方海域发起炮击';
        } else {
          api.setStatus('对方回合', 'wait');
          turnInfoEl.textContent = '对方回合：等待对方炮击…';
        }
      }

      /* ============================================================
       * 攻击 / 判定
       * ============================================================ */
      function onCanvasClick(e) {
        if (state.phase !== 'battle' || state.gameOver) return;
        if (!state.myTurn || state.waitingResult) return;

        var cell = hitTestEnemy(e);
        if (!cell) return;
        if (state.myShots[cell.y][cell.x] !== null) {
          resultInfoEl.textContent = '这个格子已经打过了，换一个。';
          return;
        }

        state.waitingResult = true;
        state.myShots[cell.y][cell.x] = 'pending';
        api.send({ t: 'bs:attack', x: cell.x, y: cell.y });
        api.log('发起炮击：' + cellName(cell.x, cell.y), 'send');
        resultInfoEl.textContent = '';
        updateBattleStatus();
        draw();
      }

      function onReceiveAttack(msg) {
        if (state.phase !== 'battle' || state.gameOver) return;
        var x = msg.x, y = msg.y;
        if (typeof x !== 'number' || typeof y !== 'number') return;
        if (x < 0 || x >= BS_N || y < 0 || y >= BS_N) return;

        var cell = state.myBoard[y][x];
        if (cell.shot !== null) {
          // 重复攻击，理论上不该发生
          api.send({ t: 'bs:result', x: x, y: y, hit: cell.shot === 'hit', sunk: false, gameOver: false, nextTurn: false });
          return;
        }

        var hit = cell.shipId !== null;
        var sunk = false;

        if (hit) {
          cell.shot = 'hit';
          for (var i = 0; i < state.myShips.length; i++) {
            if (state.myShips[i].id === cell.shipId) {
              state.myShips[i].hits++;
              if (state.myShips[i].hits >= state.myShips[i].len) sunk = true;
              break;
            }
          }
        } else {
          cell.shot = 'miss';
        }

        var allSunk = countAliveShips() === 0;
        var gameOver = allSunk;
        var nextTurn = !hit;   // 未命中切换回合；命中则攻击方继续

        api.send({
          t: 'bs:result',
          x: x, y: y,
          hit: hit,
          sunk: sunk,
          gameOver: gameOver,
          nextTurn: nextTurn
        });
        api.log('被炮击 ' + cellName(x, y) + '：' + (hit ? (sunk ? '命中并击沉' : '命中') : '未命中'), 'recv');

        if (gameOver) {
          state.gameOver = true;
          state.iWon = false;
          updateBattleStatus();
        } else if (nextTurn) {
          state.myTurn = true;
          updateBattleStatus();
        }
        draw();
      }

      function onReceiveResult(msg) {
        var x = msg.x, y = msg.y;
        if (typeof x !== 'number' || typeof y !== 'number') return;
        if (x < 0 || x >= BS_N || y < 0 || y >= BS_N) return;

        state.waitingResult = false;
        state.myShots[y][x] = msg.hit ? 'hit' : 'miss';

        var text = '炮击 ' + cellName(x, y) + '：' + (msg.hit ? (msg.sunk ? '命中并击沉！' : '命中！') : '未命中');
        resultInfoEl.textContent = text;
        api.log(text, 'recv');

        if (msg.gameOver) {
          state.gameOver = true;
          state.iWon = true;
          updateBattleStatus();
        } else if (msg.nextTurn) {
          state.myTurn = false;
          updateBattleStatus();
        } else {
          state.myTurn = true;
          updateBattleStatus();
        }
        draw();
      }

      function cellName(x, y) {
        return String.fromCharCode(65 + x) + (y + 1);
      }

      /* ============================================================
       * 命中检测
       * ============================================================ */
      function hitTestEnemy(e) {
        if (!canvas) return null;
        var rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        var sx = (e.clientX - rect.left) / rect.width * CANVAS_W;
        var sy = (e.clientY - rect.top) / rect.height * CANVAS_H;
        if (sx < EN_X || sx >= EN_X + GRID || sy < EN_Y || sy >= EN_Y + GRID) return null;
        var cx = Math.floor((sx - EN_X) / CELL);
        var cy = Math.floor((sy - EN_Y) / CELL);
        if (cx < 0 || cx >= BS_N || cy < 0 || cy >= BS_N) return null;
        return { x: cx, y: cy };
      }

      function onCanvasMove(e) {
        if (!canvas) return;
        var cell = hitTestEnemy(e);
        var changed = (cell && !state.hoverCell) ||
                      (!cell && state.hoverCell) ||
                      (cell && state.hoverCell && (cell.x !== state.hoverCell.x || cell.y !== state.hoverCell.y));
        state.hoverCell = cell;
        if (changed) draw();
      }

      function onCanvasLeave() {
        if (state.hoverCell) {
          state.hoverCell = null;
          draw();
        }
      }

      /* ============================================================
       * 绘制
       * ============================================================ */
      function draw() {
        if (!ctx) return;
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        drawGridTitle('我的海域', MY_X, MY_Y, '#3fb950');
        drawGridTitle('敌方海域', EN_X, EN_Y, '#f85149');

        drawGridBase(MY_X, MY_Y);
        drawGridBase(EN_X, EN_Y);

        // 我的海域
        if (state.myBoard) {
          for (var y = 0; y < BS_N; y++) {
            for (var x = 0; x < BS_N; x++) {
              var cell = state.myBoard[y][x];
              var px = MY_X + x * CELL;
              var py = MY_Y + y * CELL;
              if (cell.shipId !== null) {
                ctx.fillStyle = cell.shot === 'hit' ? '#f85149' : '#1f6feb';
                ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
              }
              if (cell.shot === 'miss') {
                ctx.fillStyle = '#8b949e';
                ctx.beginPath();
                ctx.arc(px + CELL / 2, py + CELL / 2, 5, 0, Math.PI * 2);
                ctx.fill();
              }
              if (cell.shot === 'hit') {
                // 命中标记：白色 X
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(px + 8, py + 8); ctx.lineTo(px + CELL - 8, py + CELL - 8);
                ctx.moveTo(px + CELL - 8, py + 8); ctx.lineTo(px + 8, py + CELL - 8);
                ctx.stroke();
              }
            }
          }
        }

        // 敌方海域
        if (state.myShots) {
          for (var yy = 0; yy < BS_N; yy++) {
            for (var xx = 0; xx < BS_N; xx++) {
              var s = state.myShots[yy][xx];
              var ppx = EN_X + xx * CELL;
              var ppy = EN_Y + yy * CELL;
              if (s === 'hit') {
                ctx.fillStyle = '#f85149';
                ctx.fillRect(ppx + 2, ppy + 2, CELL - 4, CELL - 4);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(ppx + 8, ppy + 8); ctx.lineTo(ppx + CELL - 8, ppy + CELL - 8);
                ctx.moveTo(ppx + CELL - 8, ppy + 8); ctx.lineTo(ppx + 8, ppy + CELL - 8);
                ctx.stroke();
              } else if (s === 'miss') {
                ctx.fillStyle = '#8b949e';
                ctx.beginPath();
                ctx.arc(ppx + CELL / 2, ppy + CELL / 2, 5, 0, Math.PI * 2);
                ctx.fill();
              } else if (s === 'pending') {
                ctx.strokeStyle = '#d29922';
                ctx.lineWidth = 2;
                ctx.strokeRect(ppx + 4, ppy + 4, CELL - 8, CELL - 8);
              }
            }
          }
        }

        // 悬停高亮
        if (state.hoverCell && state.phase === 'battle' && state.myTurn && !state.waitingResult && !state.gameOver) {
          var h = state.hoverCell;
          if (state.myShots[h.y][h.x] === null) {
            ctx.strokeStyle = '#58a6ff';
            ctx.lineWidth = 2;
            ctx.strokeRect(EN_X + h.x * CELL + 2, EN_Y + h.y * CELL + 2, CELL - 4, CELL - 4);
          }
        }

        // 坐标标签
        drawCoords(MY_X, MY_Y);
        drawCoords(EN_X, EN_Y);
      }

      function drawGridTitle(text, ox, oy, color) {
        ctx.fillStyle = color;
        ctx.font = 'bold 15px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, ox + GRID / 2, oy - 30);
      }

      function drawGridBase(ox, oy) {
        for (var y = 0; y < BS_N; y++) {
          for (var x = 0; x < BS_N; x++) {
            ctx.fillStyle = '#161b22';
            ctx.fillRect(ox + x * CELL, oy + y * CELL, CELL, CELL);
          }
        }
        ctx.strokeStyle = '#30363d';
        ctx.lineWidth = 1;
        for (var i = 0; i <= BS_N; i++) {
          ctx.beginPath();
          ctx.moveTo(ox + i * CELL, oy);
          ctx.lineTo(ox + i * CELL, oy + GRID);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(ox, oy + i * CELL);
          ctx.lineTo(ox + GRID, oy + i * CELL);
          ctx.stroke();
        }
      }

      function drawCoords(ox, oy) {
        ctx.fillStyle = '#6e7681';
        ctx.font = '11px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var j = 0; j < BS_N; j++) {
          ctx.fillText(String.fromCharCode(65 + j), ox + j * CELL + CELL / 2, oy - 12);
          ctx.fillText(String(j + 1), ox - 14, oy + j * CELL + CELL / 2);
        }
      }

      /* ============================================================
       * 消息处理
       * ============================================================ */
      function handleMessage(msg) {
        if (!msg || typeof msg.t !== 'string') return;

        if (msg.t === 'bs:config') {
          if (state.phase === 'waitConfig' && Array.isArray(msg.ships)) {
            state.config = msg.ships;
            api.log('收到主机舰队配置：' + formatConfig(state.config), 'recv');
            enterDeploy();
          }
          return;
        }

        if (msg.t === 'bs:ready') {
          state.peerReady = true;
          api.log('对方已部署完成', 'sys');
          if (state.phase === 'waitPeer') {
            api.setStatus('等待对方部署', 'wait');
          }
          maybeStartBattle();
          return;
        }

        if (msg.t === 'bs:start') {
          if (state.phase === 'waitPeer' || state.phase === 'deploy') {
            // 客机收到 start 后进入对战
            if (!state.deployed) {
              // 还没确认部署就收到 start，忽略（理论上不会发生）
              api.log('收到开局消息但本端尚未部署，忽略', 'err');
              return;
            }
            beginBattle(msg.firstTurn === 'host' ? 'host' : 'guest');
          }
          return;
        }

        if (msg.t === 'bs:attack') {
          onReceiveAttack(msg);
          return;
        }

        if (msg.t === 'bs:result') {
          onReceiveResult(msg);
          return;
        }
      }

      /* ============================================================
       * 生命周期
       * ============================================================ */
      function mount(bodyEl) {
        // 创建画布
        canvas = document.createElement('canvas');
        canvas.className = 'game-canvas bs-canvas';
        canvas.width = CANVAS_W * (window.devicePixelRatio || 1);
        canvas.height = CANVAS_H * (window.devicePixelRatio || 1);
        ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        bodyEl.appendChild(canvas);

        // 创建面板
        var panelHost = document.createElement('div');
        bodyEl.appendChild(panelHost);
        panelRoot = panelHost;

        buildConfigPanel();
        buildWaitConfigPanel();
        buildDeployPanel();
        buildBattlePanel();

        panelHost.appendChild(configPanel);
        panelHost.appendChild(waitConfigPanel);
        panelHost.appendChild(deployPanel);
        panelHost.appendChild(battlePanel);

        // 事件
        canvas.addEventListener('click', onCanvasClick);
        canvas.addEventListener('mousemove', onCanvasMove);
        canvas.addEventListener('mouseleave', onCanvasLeave);

        // 初始化状态
        state.myBoard = createEmptyBoard();
        state.myShots = createEmptyShots();
        state.myShips = [];
        state.gameOver = false;

        if (state.isHost) {
          state.phase = 'config';
          showPanel('config');
          api.setStatus('设置舰队配置', 'host');
          api.setHint('设置舰船长度与数量，总格数不超过 70。');
        } else {
          state.phase = 'waitConfig';
          showPanel('waitConfig');
          api.setStatus('等待主机配置', 'wait');
          api.setHint('等待主机设置舰队配置…');
        }

        draw();
      }

      function unmount() {
        if (canvas) {
          canvas.removeEventListener('click', onCanvasClick);
          canvas.removeEventListener('mousemove', onCanvasMove);
          canvas.removeEventListener('mouseleave', onCanvasLeave);
        }
        canvas = null;
        ctx = null;
        panelRoot = null;
        configPanel = waitConfigPanel = deployPanel = battlePanel = null;
        shipRowsEl = configErrorEl = configSummaryEl = null;
        turnInfoEl = resultInfoEl = confirmDeployBtn = null;
      }

      return {
        mount: mount,
        unmount: unmount,
        handleMessage: handleMessage
      };
    }
  });
})();