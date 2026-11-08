/**
 * Pong 游戏模块
 * 依赖 window.GameRegistry（由 index.html 提供）
 */
(function () {
  'use strict';

  if (!window.GameRegistry) {
    console.error('[pong] GameRegistry 未定义，跳过注册');
    return;
  }

  var CANVAS_W = 800, CANVAS_H = 500;
  var PADDLE_W = 12, PADDLE_H = 92, BALL_R = 9;

  window.GameRegistry.register('pong', {
    name: 'Pong',
    icon: '🏓',
    desc: '双人实时对打 · 主机负责物理模拟',

    create: function (api) {
      var GAME = {
        active: false,
        isHost: !!api.isHost,
        myY: CANVAS_H / 2,
        remoteY: CANVAS_H / 2,
        ball: { x: CANVAS_W / 2, y: CANVAS_H / 2, vx: 0, vy: 0 },
        leftScore: 0, rightScore: 0, serveDelay: 0
      };

      var canvas = null, ctx = null;
      var rafId = null, lastTs = 0;
      var lastSentPaddleY = -999;
      var keys = Object.create(null);

      function clampPaddle(y) {
        var half = PADDLE_H / 2;
        if (y < half) return half;
        if (y > CANVAS_H - half) return CANVAS_H - half;
        return y;
      }
      function getPaddles() {
        if (GAME.isHost) return { left: GAME.myY, right: GAME.remoteY };
        return { left: GAME.remoteY, right: GAME.myY };
      }
      function resetBall(dir) {
        GAME.ball.x = CANVAS_W / 2;
        GAME.ball.y = CANVAS_H / 2;
        var angle = (Math.random() - 0.5) * 0.6;
        var speed = 360;
        GAME.ball.vx = Math.cos(angle) * speed * dir;
        GAME.ball.vy = Math.sin(angle) * speed;
        GAME.serveDelay = 0.9;
      }
      function hostStep(dt) {
        if (GAME.serveDelay > 0) { GAME.serveDelay -= dt; return; }
        var p = getPaddles();
        var b = GAME.ball;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y - BALL_R < 0) { b.y = BALL_R; b.vy = Math.abs(b.vy); }
        else if (b.y + BALL_R > CANVAS_H) { b.y = CANVAS_H - BALL_R; b.vy = -Math.abs(b.vy); }
        if (b.vx < 0 && b.x - BALL_R <= PADDLE_W && b.x - BALL_R > -PADDLE_W - 24
            && Math.abs(b.y - p.left) <= PADDLE_H / 2 + BALL_R * 0.6) {
          b.x = PADDLE_W + BALL_R;
          b.vx = Math.abs(b.vx) * 1.055;
          var relL = (b.y - p.left) / (PADDLE_H / 2);
          b.vy = relL * Math.abs(b.vx) * 0.78;
        }
        if (b.vx > 0 && b.x + BALL_R >= CANVAS_W - PADDLE_W && b.x + BALL_R < CANVAS_W + PADDLE_W + 24
            && Math.abs(b.y - p.right) <= PADDLE_H / 2 + BALL_R * 0.6) {
          b.x = CANVAS_W - PADDLE_W - BALL_R;
          b.vx = -Math.abs(b.vx) * 1.055;
          var relR = (b.y - p.right) / (PADDLE_H / 2);
          b.vy = relR * Math.abs(b.vx) * 0.78;
        }
        var MAX_V = 900;
        if (Math.abs(b.vx) > MAX_V) b.vx = (b.vx > 0 ? 1 : -1) * MAX_V;
        if (Math.abs(b.vy) > MAX_V) b.vy = (b.vy > 0 ? 1 : -1) * MAX_V;
        if (b.x < -BALL_R * 3) { GAME.rightScore++; resetBall(-1); }
        else if (b.x > CANVAS_W + BALL_R * 3) { GAME.leftScore++; resetBall(1); }
      }
      function broadcastState() {
        var p = getPaddles();
        api.send({
          t: 's',
          bx: Math.round(GAME.ball.x * 10) / 10,
          by: Math.round(GAME.ball.y * 10) / 10,
          ly: Math.round(p.left * 10) / 10,
          ry: Math.round(p.right * 10) / 10,
          ls: GAME.leftScore,
          rs: GAME.rightScore,
          sv: GAME.serveDelay > 0 ? 1 : 0
        });
      }
      function sendPaddleIfNeeded() {
        if (GAME.isHost) return;
        if (Math.abs(GAME.myY - lastSentPaddleY) < 0.4) return;
        lastSentPaddleY = GAME.myY;
        api.send({ t: 'p', y: Math.round(GAME.myY * 10) / 10 });
      }
      function roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
        c.fill();
      }
      function render() {
        if (!ctx) return;
        var p = getPaddles();
        ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.save();
        ctx.strokeStyle = '#21262d'; ctx.lineWidth = 3; ctx.setLineDash([10, 14]);
        ctx.beginPath(); ctx.moveTo(CANVAS_W / 2, 0); ctx.lineTo(CANVAS_W / 2, CANVAS_H); ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.fillStyle = 'rgba(230,237,243,0.13)';
        ctx.font = 'bold 120px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(GAME.leftScore), CANVAS_W / 2 - 110, 110);
        ctx.fillText(String(GAME.rightScore), CANVAS_W / 2 + 110, 110);
        ctx.restore();
        ctx.fillStyle = '#58a6ff';
        roundRect(ctx, 0, p.left - PADDLE_H / 2, PADDLE_W, PADDLE_H, 6);
        ctx.fillStyle = '#3fb950';
        roundRect(ctx, CANVAS_W - PADDLE_W, p.right - PADDLE_H / 2, PADDLE_W, PADDLE_H, 6);
        ctx.save();
        ctx.globalAlpha = GAME.serveDelay > 0 ? 0.5 : 1;
        ctx.fillStyle = '#e6edf3';
        ctx.beginPath(); ctx.arc(GAME.ball.x, GAME.ball.y, BALL_R, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      function loop(ts) {
        if (!GAME.active) { rafId = null; return; }
        var dt = (ts - lastTs) / 1000;
        if (!isFinite(dt) || dt < 0) dt = 0;
        dt = Math.min(dt, 0.05); lastTs = ts;
        var mv = 0;
        if (keys['ArrowUp'] || keys['w'] || keys['W']) mv -= 1;
        if (keys['ArrowDown'] || keys['s'] || keys['S']) mv += 1;
        if (mv !== 0) GAME.myY = clampPaddle(GAME.myY + mv * 520 * dt);
        if (GAME.isHost) { hostStep(dt); broadcastState(); }
        else { sendPaddleIfNeeded(); }
        render();
        rafId = requestAnimationFrame(loop);
      }
      function startLoop() {
        if (rafId !== null) return;
        lastTs = performance.now();
        rafId = requestAnimationFrame(loop);
      }
      function stopLoop() {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      }
      function onPointerMove(e) {
        if (!GAME.active || !canvas) return;
        var rect = canvas.getBoundingClientRect();
        if (!rect.height) return;
        GAME.myY = clampPaddle(((e.clientY - rect.top) / rect.height) * CANVAS_H);
        e.preventDefault();
      }
      function onPointerDown(e) {
        if (!GAME.active || !canvas) return;
        var rect = canvas.getBoundingClientRect();
        if (!rect.height) return;
        GAME.myY = clampPaddle(((e.clientY - rect.top) / rect.height) * CANVAS_H);
        e.preventDefault();
      }
      function onKeyDown(e) {
        if (!GAME.active) return;
        var k = e.key;
        if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'w' || k === 'W' || k === 's' || k === 'S') {
          keys[k] = true; e.preventDefault();
        }
      }
      function onKeyUp(e) { delete keys[e.key]; }
      function onBlur() { keys = Object.create(null); }

      return {
        mount: function (bodyEl) {
          canvas = document.createElement('canvas');
          canvas.className = 'game-canvas pong-canvas';
          bodyEl.appendChild(canvas);
          var dpr = window.devicePixelRatio || 1;
          canvas.width = CANVAS_W * dpr;
          canvas.height = CANVAS_H * dpr;
          ctx = canvas.getContext('2d');
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

          canvas.addEventListener('pointermove', onPointerMove, { passive: false });
          canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
          window.addEventListener('keydown', onKeyDown);
          window.addEventListener('keyup', onKeyUp);
          window.addEventListener('blur', onBlur);

          GAME.active = true;
          GAME.myY = CANVAS_H / 2;
          GAME.remoteY = CANVAS_H / 2;
          GAME.ball = { x: CANVAS_W / 2, y: CANVAS_H / 2, vx: 0, vy: 0 };
          GAME.leftScore = 0; GAME.rightScore = 0; GAME.serveDelay = 0;
          lastSentPaddleY = -999; keys = Object.create(null);

          api.setStatus(GAME.isHost ? '你是左侧 · 蓝色球拍' : '你是右侧 · 绿色球拍',
                        GAME.isHost ? 'host' : 'guest');
          api.setHint('移动鼠标 / 手指控制球拍，也可用 ↑ ↓ 或 W S 键');

          if (GAME.isHost) resetBall(Math.random() < 0.5 ? -1 : 1);
          startLoop();
          render();
        },
        unmount: function () {
          GAME.active = false;
          stopLoop();
          if (canvas) {
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerdown', onPointerDown);
          }
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('keyup', onKeyUp);
          window.removeEventListener('blur', onBlur);
          canvas = null; ctx = null; keys = Object.create(null);
        },
        handleMessage: function (msg) {
          if (!GAME.active || !msg) return;
          if (GAME.isHost) {
            if (msg.t === 'p' && typeof msg.y === 'number') {
              GAME.remoteY = clampPaddle(msg.y);
            }
          } else {
            if (msg.t === 's') {
              if (typeof msg.bx === 'number') GAME.ball.x = msg.bx;
              if (typeof msg.by === 'number') GAME.ball.y = msg.by;
              if (typeof msg.ly === 'number') GAME.remoteY = msg.ly;
              if (typeof msg.ls === 'number') GAME.leftScore = msg.ls;
              if (typeof msg.rs === 'number') GAME.rightScore = msg.rs;
              GAME.serveDelay = msg.sv ? 1 : 0;
            }
          }
        }
      };
    }
  });
})();