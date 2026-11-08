(function () {
  'use strict';

  if (!window.GameRegistry) return;

  window.GameRegistry.register('踏入孔府', {
    name: '踏入孔府',
    icon: '🧱',
    desc: '双人实时射击与搭建掩体，破坏对方护甲',
    create: function (api) {
      // ================= 常量配置 =================
      var CFG = {
        MAP: 100, HALF: 50,
        EYE: 1.65,
        GRAVITY: 20, ACCEL: 40, MAX_SPD: 6, DECEL: 30,
        JUMP_H: 2.2,
        PROJ_SPD: 45, PROJ_DMG: 5, PROJ_LIFE: 3,
        FIRE_CD: 0.1, BUILD_CD: 0.3,
        MAX_HP: 100, NET_HZ: 20,
        PLAYER_R: 0.5, PLAYER_H: 2,
        BUILD_H: 2, BUILD_W: 1, BUILD_T: 0.1, BUILD_HP: 15,
        FALL_KILL_Y: -5,
        LOOK_SENS_TOUCH: 0.0045,
        LOOK_SENS_MOUSE: 0.0022,
        JOY_DEADZONE: 0.15,
        FOV_DEG: 75,
        NEAR: 0.15, // 略微提高近平面，给大网格留点余量
        INTRO_DURATION: 3.0
      };
      CFG.JUMP_V = Math.sqrt(2 * CFG.GRAVITY * CFG.JUMP_H);

      // ================= 资源仓库配置 =================
      var REPO = 'foobar650/YQ_resources';
      var BRANCH = 'master';
      var FALLBACK_SHA = 'b004eae7e2e52f9228ff6485dc114e3b9fe6f800';
      var CDN_BASE = 'https://cdn.jsdmirror.com/gh/' + REPO + '@';
      var GAME_PATH = '/game_all_in_one/KZR_res/';

      var currentSha = FALLBACK_SHA;
      var images = {};

      // ================= 状态变量 =================
      var mounted = false;
      var stage = null, canvas = null, ctx = null;
      var rafId = 0, lastTime = 0;

      var localId = api.isHost ? 0 : 1;
      var remoteId = 1 - localId;

      var buildings = {};
      var projectiles = {}; 
      var seq = 0, fireCd = 0, buildCd = 0, netAcc = 0;
      var gameOver = false;
      var introActive = false;
      var introTimer = 0;

      // 内联语录（Fallback）
      var sayTexts = [
        "朽木不可雕也，粪土之墙不可污也，于予与何诛？",
        "非吾徒也。小子鸣鼓而攻之，可也。",
        "过我门而不入我室，我不憾焉者，其惟乡愿乎！乡愿，德之贼也。",
        "幼而不孙弟，长而无述焉，老而不死，是为贼。",
        "由之瑟，奚为于丘之门？",
        "小人哉，樊须也！",
        "予之不仁也！",
        "赐也，非尔所能也。",
        "赐也贤乎哉？夫我则不暇。",
        "枨也欲，焉得刚？",
        "八佾舞于庭，是可忍也，孰不可忍也？",
        "乡愿，德之贼也。"
      ];

      // 剧情状态
      var storyTexts = api.isHost ? [
        "你是孔子",
        "有一个不尊重礼乐的差生要来拜访你并想进入孔府",
        "你的任务是劝解学生放弃念头，同时躲避学生发来的腊肉",
        "为了礼乐，尽力劝解学生吧!"
      ] : [
        "你是一个有钱的学生，无所事事的你突然想进入孔府看看",
        "但是孔子貌似不想让你进入孔府",
        "你的任务是在躲避孔子的劝解的同时，向孔子发射腊肉",
        "Just Do IT!"
      ];
      var storyIdx = 0;
      var localStoryReady = false;
      var peerStoryReady = false;
      var gameStarted = false;
      var storyTimeoutId = 0;
      var storyAnimating = false;
      var storyFinished = false;

      // 隐藏调试功能
      var spacePressCount = 0;
      var spaceTimer = 0;

      var keys = {};
      var joy = { active: false, dx: 0, dy: 0 };
      var actBtn = { fire: false, build: false, jump: false };
      var lookPointer = { id: -1, x: 0, y: 0 };
      
      var me = { id: localId, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, hp: CFG.MAX_HP, onGround: true };
      var foe = { id: remoteId, x: 0, y: 0, z: 0, yaw: 0, hp: CFG.MAX_HP };
      var foeNet = { x: 0, y: 0, z: 0, yaw: 0 };

      var dom = {};

      // ================= 数学与几何工具 =================
      function wrapAngle(a) {
        if (!isFinite(a)) return 0;
        var TAU = Math.PI * 2;
        a = a - TAU * Math.floor((a + Math.PI) / TAU);
        if (a === -Math.PI) a = Math.PI;
        return a;
      }

      function distSq(a, b) {
        var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
        return dx * dx + dy * dy + dz * dz;
      }

      function segAABB(p0, p1, min, max) {
        var o = [p0[0], p0[1], p0[2]];
        var d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        var tmin = 0, tmax = 1;
        for (var i = 0; i < 3; i++) {
          if (Math.abs(d[i]) < 1e-9) {
            if (o[i] < min[i] || o[i] > max[i]) return false;
          } else {
            var t1 = (min[i] - o[i]) / d[i];
            var t2 = (max[i] - o[i]) / d[i];
            if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
            if (t1 > tmin) tmin = t1;
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) return false;
          }
        }
        return true;
      }

      function rayAABB(ox, oy, oz, dx, dy, dz, box) {
        var tmin = 0, tmax = 1000;
        var invD = 1 / (dx === 0 ? 1e-9 : dx);
        var t1 = (box.minx - ox) * invD;
        var t2 = (box.maxx - ox) * invD;
        if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;

        invD = 1 / (dy === 0 ? 1e-9 : dy);
        t1 = (box.miny - oy) * invD;
        t2 = (box.maxy - oy) * invD;
        if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;

        invD = 1 / (dz === 0 ? 1e-9 : dz);
        t1 = (box.minz - oz) * invD;
        t2 = (box.maxz - oz) * invD;
        if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;

        return tmin;
      }

      function overlapsAABB(a, b) {
        return a.minx < b.maxx - 1e-6 && a.maxx > b.minx + 1e-6 &&
               a.miny < b.maxy - 1e-6 && a.maxy > b.miny + 1e-6 &&
               a.minz < b.maxz - 1e-6 && a.maxz > b.minz + 1e-6;
      }

      // ================= 渲染工具 =================
      function makeCamera(pos, yaw, pitch) {
        var cy = Math.cos(yaw), sy = Math.sin(yaw);
        var cp = Math.cos(pitch), sp = Math.sin(pitch);
        return {
          pos: pos,
          right: [cy, 0, -sy],
          up: [sy * sp, cp, cy * sp],
          forward: [-sy * cp, sp, -cy * cp]
        };
      }

      function camSpace(p, cam) {
        var rx = p[0] - cam.pos[0], ry = p[1] - cam.pos[1], rz = p[2] - cam.pos[2];
        var r = cam.right, u = cam.up, f = cam.forward;
        return [
          rx * r[0] + ry * r[1] + rz * r[2],
          rx * u[0] + ry * u[1] + rz * u[2],
          rx * f[0] + ry * f[1] + rz * f[2]
        ];
      }

      function proj(v, focal, W, H) {
        var inv = focal / v[2];
        return [W * 0.5 + v[0] * inv, H * 0.5 - v[1] * inv];
      }

      function clipPolyNear(poly, near) {
        var out = [], n = poly.length;
        if (n === 0) return out;
        for (var i = 0; i < n; i++) {
          var a = poly[i], b = poly[(i + 1) % n];
          var aIn = a[2] >= near, bIn = b[2] >= near;
          if (aIn) out.push(a);
          if (aIn !== bIn) {
            var t = (near - a[2]) / (b[2] - a[2]);
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near]);
          }
        }
        return out;
      }

      function clipLineNear(a, b, near) {
        var aIn = a[2] >= near, bIn = b[2] >= near;
        if (!aIn && !bIn) return null;
        if (aIn && bIn) return [a, b];
        var dz = b[2] - a[2];
        if (Math.abs(dz) < 1e-6) return null;
        var t = (near - a[2]) / dz;
        var p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near];
        return aIn ? [a, p] : [p, b];
      }

      function boxFaces(center, hx, hy, hz, ax, ay, az) {
        var C = [];
        for (var i = 0; i < 8; i++) {
          var sx = (i & 1) ? 1 : -1, sy = (i & 2) ? 1 : -1, sz = (i & 4) ? 1 : -1;
          C.push([
            center[0] + ax[0] * hx * sx + ay[0] * hy * sy + az[0] * hz * sz,
            center[1] + ax[1] * hx * sx + ay[1] * hy * sy + az[1] * hz * sz,
            center[2] + ax[2] * hx * sx + ay[2] * hy * sy + az[2] * hz * sz
          ]);
        }
        var defs = [
          { n: [-1, 0, 0], idx: [0, 4, 6, 2] }, { n: [1, 0, 0], idx: [1, 3, 7, 5] },
          { n: [0, -1, 0], idx: [0, 1, 5, 4] }, { n: [0, 1, 0], idx: [2, 6, 7, 3] },
          { n: [0, 0, -1], idx: [0, 2, 3, 1] }, { n: [0, 0, 1], idx: [4, 5, 7, 6] }
        ];
        var faces = [];
        for (var f = 0; f < 6; f++) {
          var d = defs[f];
          var n = [
            ax[0] * d.n[0] + ay[0] * d.n[1] + az[0] * d.n[2],
            ax[1] * d.n[0] + ay[1] * d.n[1] + az[1] * d.n[2],
            ax[2] * d.n[0] + ay[2] * d.n[1] + az[2] * d.n[2]
          ];
          var v = [C[d.idx[0]], C[d.idx[1]], C[d.idx[2]], C[d.idx[3]]];
          var cx = (v[0][0] + v[1][0] + v[2][0] + v[3][0]) * 0.25;
          var cy = (v[0][1] + v[1][1] + v[2][1] + v[3][1]) * 0.25;
          var cz = (v[0][2] + v[1][2] + v[2][2] + v[3][2]) * 0.25;
          faces.push({ verts: v, normal: n, center: [cx, cy, cz], uvs: [[0,1],[1,1],[1,0],[0,0]] });
        }
        return faces;
      }

      // 仿射三角形映射（修复了图片像素坐标）
      function drawAffineTriangle(ctx, img, src, dst) {
        var x0 = src[0][0] * img.width, y0 = src[0][1] * img.height;
        var x1 = src[1][0] * img.width, y1 = src[1][1] * img.height;
        var x2 = src[2][0] * img.width, y2 = src[2][1] * img.height;
        var u0 = dst[0][0], v0 = dst[0][1];
        var u1 = dst[1][0], v1 = dst[1][1];
        var u2 = dst[2][0], v2 = dst[2][1];
        
        var delta = x0 * (y2 - y1) - x1 * y2 + x2 * y1 + (x1 - x2) * y0;
        if (delta === 0) return;
        var a = -(y0 * (u2 - u1) - y1 * u2 + y2 * u1 + (y1 - y2) * u0) / delta;
        var b = (y1 * v2 + y0 * (v1 - v2) - y2 * v1 + (y2 - y1) * v0) / delta;
        var c = (x0 * (u2 - u1) - x1 * u2 + x2 * u1 + (x1 - x2) * u0) / delta;
        var d = -(x1 * v2 + x0 * (v1 - v2) - x2 * v1 + (x2 - x1) * v0) / delta;
        var e = (x0 * (y2 * u1 - y1 * u2) + y0 * (x1 * u2 - x2 * u1) + (x2 * y1 - x1 * y2) * u0) / delta;
        var f = (x0 * (y2 * v1 - y1 * v2) + y0 * (x1 * v2 - x2 * v1) + (x2 * y1 - x1 * y2) * v0) / delta;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(u0, v0);
        ctx.lineTo(u1, v1);
        ctx.lineTo(u2, v2);
        ctx.closePath();
        ctx.clip();
        ctx.transform(a, b, c, d, e, f);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      }

      // ================= 资源加载 =================
      function loadResources() {
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId = setTimeout(function () { if (controller) controller.abort(); }, 2000);

        fetch('https://api.github.com/repos/' + REPO + '/branches/' + BRANCH, {
          cache: 'no-store',
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller ? controller.signal : undefined
        })
        .then(function (res) {
          if (!res.ok) throw new Error('API error');
          return res.json();
        })
        .then(function (data) {
          clearTimeout(timeoutId);
          if (data && data.commit && data.commit.sha) {
            currentSha = data.commit.sha;
          }
        })
        .catch(function (err) {
          clearTimeout(timeoutId);
        })
        .finally(function () {
          doLoadAssets();
        });
      }

      function doLoadAssets() {
        var baseUrl = CDN_BASE + currentSha + GAME_PATH;

        function loadImg(name, file) {
          var img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = function () { images[name] = img; };
          img.onerror = function () {
            if (currentSha !== FALLBACK_SHA) {
              img.src = CDN_BASE + FALLBACK_SHA + GAME_PATH + file;
            }
          };
          img.src = baseUrl + file;
        }

        loadImg('kongzi', 'kongzi.jpg');
        loadImg('wantong', 'wantong.jpg');
        loadImg('map', 'map.webp');
        loadImg('larou', 'larou.jpg');
        loadImg('obstacle', 'obstacle.jpg'); // 新增障碍物贴图

        // 尝试加载 says.txt
        fetch(baseUrl + 'says.txt')
          .then(res => res.text())
          .then(text => {
            var regex = /"([^"]+)"/g;
            var match;
            var parsed = [];
            while ((match = regex.exec(text)) !== null) {
              if (match[1] && match[1].trim()) parsed.push(match[1].trim());
            }
            if (parsed.length > 0) {
              sayTexts = parsed;
            }
          })
          .catch(() => {
            // 忽略错误，使用内联的 sayTexts
          });
      }

      // ================= 剧情控制 =================
      function showNextStory() {
        if (storyAnimating || gameStarted || localStoryReady) return;

        if (storyFinished) {
          localStoryReady = true;
          if (dom.storyText) {
            dom.storyText.textContent = '等待对方完成剧情...';
            dom.storyText.style.opacity = '1';
          }
          if (dom.storyHint) dom.storyHint.style.display = 'none';
          
          checkStorySync();
          api.send({ t: 'fort:story:ready' });
          return;
        }

        if (storyIdx < storyTexts.length) {
          storyAnimating = true;
          if (dom.storyText) dom.storyText.style.opacity = '0';
          
          clearTimeout(storyTimeoutId);
          storyTimeoutId = setTimeout(function () {
            if (!mounted) return;
            if (dom.storyText) {
              dom.storyText.textContent = storyTexts[storyIdx];
              dom.storyText.style.opacity = '1';
            }
            storyIdx++;
            storyAnimating = false;
            
            if (storyIdx >= storyTexts.length) {
              storyFinished = true;
              if (dom.storyHint) dom.storyHint.textContent = '点击屏幕继续';
            }
          }, 500);
        }
      }

      function checkStorySync() {
        if (localStoryReady && peerStoryReady) {
          if (dom.storyOverlay) dom.storyOverlay.style.display = 'none';
          startRealGame();
        } else if (localStoryReady && !peerStoryReady) {
          if (dom.storyText) {
            dom.storyText.textContent = '等待对方完成剧情...';
            dom.storyText.style.opacity = '1';
          }
          if (dom.storyHint) dom.storyHint.style.display = 'none';
        }
      }

      function startRealGame() {
        if (gameStarted) return;
        gameStarted = true;
        if (dom.hud) dom.hud.style.display = 'block';
        resetState();
        showIntro();
        lastTime = 0;
      }

      function onStoryClick() {
        if (!mounted || gameStarted) return;
        showNextStory();
      }

      // ================= 游戏逻辑 =================
      function resetState() {
        me.x = 0; me.z = api.isHost ? 10 : -10; me.y = 0;
        me.vx = 0; me.vy = 0; me.vz = 0;
        me.yaw = api.isHost ? 0 : Math.PI; me.pitch = 0;
        me.hp = CFG.MAX_HP; me.onGround = true;

        foe.x = 0; foe.z = api.isHost ? -10 : 10; foe.y = 0;
        foe.yaw = api.isHost ? Math.PI : 0; foe.hp = CFG.MAX_HP;
        foeNet.x = foe.x; foeNet.y = foe.y; foeNet.z = foe.z; foeNet.yaw = foe.yaw;

        buildings = {}; projectiles = {};
        fireCd = 0; buildCd = 0; netAcc = 0;
        gameOver = false; keys = {};
        actBtn = { fire: false, build: false, jump: false };
        joy = { active: false, dx: 0, dy: 0 };
        lookPointer.id = -1;

        if (dom.knob) dom.knob.style.transform = 'translate(-50%,-50%)';
        if (dom.btnFire) dom.btnFire.classList.remove('pressed');
        if (dom.btnBuild) dom.btnBuild.classList.remove('pressed');
        if (dom.btnJump) dom.btnJump.classList.remove('pressed');
        if (dom.overlay) dom.overlay.className = 'fb-overlay';

        updateHud();
        api.setStatus(api.isHost ? '主机' : '客机', api.isHost ? 'host' : 'guest');
        api.setHint('重新开始 · 拖动画面转视角 · 底部按键');
      }

      function showIntro() {
        introActive = true;
        introTimer = CFG.INTRO_DURATION;
        if (dom.intro) {
          dom.intro.classList.remove('show');
          void dom.intro.offsetWidth;
          dom.intro.classList.add('show');
        }
      }

      function updateHud() {
        var sp = Math.max(0, me.hp) / CFG.MAX_HP * 100;
        var fp = Math.max(0, foe.hp) / CFG.MAX_HP * 100;
        if (dom.hpSelfBar) { dom.hpSelfBar.style.width = sp + '%'; dom.hpSelfBar.className = sp <= 30 ? 'low' : ''; }
        if (dom.hpFoeBar) { dom.hpFoeBar.style.width = fp + '%'; dom.hpFoeBar.className = fp <= 30 ? 'low' : ''; }
        if (dom.hpSelfVal) dom.hpSelfVal.textContent = Math.max(0, Math.round(me.hp));
        if (dom.hpFoeVal) dom.hpFoeVal.textContent = Math.max(0, Math.round(foe.hp));
      }

      function updateDebug() {
        if (!dom.debug) return;
        dom.debug.textContent = 'pos ' + me.x.toFixed(2) + ', ' + me.y.toFixed(2) + ', ' + me.z.toFixed(2) +
          '  yaw ' + (me.yaw * 180 / Math.PI).toFixed(1) + '°' +
          '  pitch ' + (me.pitch * 180 / Math.PI).toFixed(1) + '°' +
          '  bld ' + Object.keys(buildings).length;
      }

      function addBuilding(id, x, y, z, axis, type) {
        if (buildings[id]) return;
        var w, h, d;
        if (type === 'floor') {
          w = (axis === 'x') ? 2 : 1; d = (axis === 'x') ? 1 : 2; h = 0.1;
        } else {
          w = (axis === 'x') ? 0.1 : 1; d = (axis === 'x') ? 1 : 0.1; h = 2;
        }
        buildings[id] = { id: id, x: x, y: y, z: z, axis: axis, type: type,
          aabb: { minx: x - w/2, maxx: x + w/2, miny: y, maxy: y + h, minz: z - d/2, maxz: z + d/2 },
          hp: CFG.BUILD_HP
        };
      }

      function removeBuilding(id) { delete buildings[id]; }

      function applyDamageToBuilding(id, dmg) {
        var b = buildings[id];
        if (!b) return;
        b.hp -= dmg;
        if (b.hp <= 0) removeBuilding(id);
      }

      function blockedAt(x, z, y) {
        var pminx = x - CFG.PLAYER_R, pmaxx = x + CFG.PLAYER_R;
        var pminy = y + 0.05, pmaxy = y + CFG.PLAYER_H - 0.05;
        var pminz = z - CFG.PLAYER_R, pmaxz = z + CFG.PLAYER_R;
        for (var id in buildings) {
          var a = buildings[id].aabb;
          if (pminx < a.maxx - 1e-4 && pmaxx > a.minx + 1e-4 &&
              pminy < a.maxy - 1e-4 && pmaxy > a.miny + 1e-4 &&
              pminz < a.maxz - 1e-4 && pmaxz > a.minz + 1e-4) {
            return true;
          }
        }
        return false;
      }

      function getGroundHeight(x, z, currentY) {
        var h = 0;
        var pminx = x - CFG.PLAYER_R, pmaxx = x + CFG.PLAYER_R;
        var pminz = z - CFG.PLAYER_R, pmaxz = z + CFG.PLAYER_R;
        for (var id in buildings) {
          var a = buildings[id].aabb;
          if (pminx < a.maxx && pmaxx > a.minx && pminz < a.maxz && pmaxz > a.minz) {
            if (a.maxy <= currentY + 0.5 && a.maxy > h) h = a.maxy;
          }
        }
        return h;
      }

      function fire() {
        if (gameOver || introActive || fireCd > 0) return;
        fireCd = CFG.FIRE_CD;
        var cp = Math.cos(me.pitch);
        var dx = -Math.sin(me.yaw) * cp;
        var dy = Math.sin(me.pitch);
        var dz = -Math.cos(me.yaw) * cp;
        var ox = me.x + dx * 0.55, oy = me.y + CFG.EYE + dy * 0.55, oz = me.z + dz * 0.55;
        var id = localId + '_' + (++seq);
        
        var text = "";
        if (localId === 0 && sayTexts.length > 0) {
          text = sayTexts[Math.floor(Math.random() * sayTexts.length)];
        }

        projectiles[id] = { id: id, owner: localId, x: ox, y: oy, z: oz,
          vx: dx * CFG.PROJ_SPD, vy: dy * CFG.PROJ_SPD, vz: dz * CFG.PROJ_SPD, 
          life: CFG.PROJ_LIFE, text: text };
          
        api.send({ t: 'fort:shot', id: id, x: ox, y: oy, z: oz,
          vx: dx * CFG.PROJ_SPD, vy: dy * CFG.PROJ_SPD, vz: dz * CFG.PROJ_SPD, text: text });
      }

      function tryBuild() {
        if (gameOver || introActive || buildCd > 0) return;
        var ey = me.y + CFG.EYE;
        var cp = Math.cos(me.pitch);
        var dx = -Math.sin(me.yaw) * cp, dy = Math.sin(me.pitch), dz = -Math.cos(me.yaw) * cp;

        var minT = 100, hitBld = null;
        if (dy < -0.001) {
          var tG = -ey / dy;
          if (tG < minT) minT = tG;
        }
        for (var bid in buildings) {
          var tB = rayAABB(me.x, ey, me.z, dx, dy, dz, buildings[bid].aabb);
          if (tB !== null && tB > 0 && tB < minT) {
            minT = tB; hitBld = buildings[bid];
          }
        }

        var hitPos, lenH = Math.sqrt(dx*dx + dz*dz);
        if (minT === 100) {
          if (lenH < 1e-3) return;
          var distTo5 = 5 / lenH;
          hitPos = [me.x + dx * distTo5, ey + dy * distTo5, me.z + dz * distTo5];
        } else {
          var hx = me.x + dx * minT, hz = me.z + dz * minT;
          var manh = Math.abs(hx - me.x) + Math.abs(hz - me.z);
          if (manh > 5) {
            var distTo5 = 5 / lenH;
            hitPos = [me.x + dx * distTo5, ey + dy * distTo5, me.z + dz * distTo5];
          } else {
            hitPos = [hx, ey + dy * minT, hz];
          }
        }

        var bx = Math.round(hitPos[0]), bz = Math.round(hitPos[2]);
        var baseY = 0;
        for (var id in buildings) {
          var a = buildings[id].aabb;
          if (bx >= a.minx - 0.1 && bx <= a.maxx + 0.1 && bz >= a.minz - 0.1 && bz <= a.maxz + 0.1) {
            if (a.maxy <= hitPos[1] + 0.5) baseY = Math.max(baseY, a.maxy);
          }
        }

        var isFlat = (me.pitch <= -Math.PI / 3) && (hitBld && hitBld.type === 'wall');
        var axis = Math.abs(dx) > Math.abs(dz) ? 'x' : 'z';
        var w, h, d, type;
        if (isFlat) {
          type = 'floor';
          w = (axis === 'x') ? 2 : 1; d = (axis === 'x') ? 1 : 2; h = 0.1;
        } else {
          type = 'wall';
          w = (axis === 'x') ? 0.1 : 1; d = (axis === 'x') ? 1 : 0.1; h = 2;
        }

        if (Math.abs(bx) > CFG.HALF - 1 || Math.abs(bz) > CFG.HALF - 1) {
          api.setHint('超出地图范围'); return;
        }

        var na = { minx: bx - w/2, maxx: bx + w/2, miny: baseY, maxy: baseY + h, minz: bz - d/2, maxz: bz + d/2 };
        var pme = { minx: me.x-CFG.PLAYER_R, maxx: me.x+CFG.PLAYER_R, miny: me.y, maxy: me.y+CFG.PLAYER_H, minz: me.z-CFG.PLAYER_R, maxz: me.z+CFG.PLAYER_R };
        var pfoe = { minx: foe.x-CFG.PLAYER_R, maxx: foe.x+CFG.PLAYER_R, miny: foe.y, maxy: foe.y+CFG.PLAYER_H, minz: foe.z-CFG.PLAYER_R, maxz: foe.z+CFG.PLAYER_R };

        if (overlapsAABB(na, pme) || overlapsAABB(na, pfoe)) { api.setHint('位置被占用'); return; }
        for (var bid in buildings) {
          if (overlapsAABB(na, buildings[bid].aabb)) { api.setHint('此处已有障碍物'); return; }
        }

        buildCd = CFG.BUILD_CD;
        var id = localId + '_' + (++seq);
        addBuilding(id, bx, baseY, bz, axis, type);
        api.send({ t: 'fort:build', id: id, x: bx, y: baseY, z: bz, axis: axis, btype: type });
        api.setHint('已建造' + (isFlat ? '地板' : '墙体'));
      }

      function takeDamage(projId) {
        if (gameOver) return;
        me.hp = Math.max(0, me.hp - CFG.PROJ_DMG);
        updateHud();
        api.send({ t: 'fort:hit', proj: projId, hp: me.hp, by: localId });
        if (me.hp <= 0) {
          api.send({ t: 'fort:ko' });
          endGame(false);
        } else {
          api.setHint('你被击中！剩余血量 ' + Math.round(me.hp));
        }
      }

      function dieByFall() {
        if (gameOver) return;
        me.hp = 0;
        updateHud();
        api.send({ t: 'fort:ko' });
        endGame(false);
      }

      function endGame(win) {
        if (gameOver) return;
        gameOver = true;
        api.setStatus(win ? '胜利' : '失败', 'over');
        api.setHint(win ? '你击败了对手！' : '你被击败了……');
        
        if (dom.overlay) {
          dom.overTitle.textContent = win ? '胜利' : '失败';
          dom.overDesc.textContent = win ? '你击败了对手！' : '你被击败了……';
          dom.overlay.className = win ? 'fb-overlay fb-win fb-show' : 'fb-overlay fb-show';
        }
        if (document.pointerLockElement === canvas) {
          try { document.exitPointerLock(); } catch (e) {}
        }
      }

      // ================= 帧更新 =================
      function updateSelf(dt) {
        if (fireCd > 0) fireCd = Math.max(0, fireCd - dt);
        if (buildCd > 0) buildCd = Math.max(0, buildCd - dt);

        var f = 0, s = 0;
        if (keys['w'] || keys['arrowup']) f += 1;
        if (keys['s'] || keys['arrowdown']) f -= 1;
        if (keys['a'] || keys['arrowleft']) s -= 1;
        if (keys['d'] || keys['arrowright']) s += 1;

        if (joy.active) {
          var jm = Math.sqrt(joy.dx * joy.dx + joy.dy * joy.dy);
          if (jm > CFG.JOY_DEADZONE) { f += -joy.dy; s += joy.dx; }
        }

        var len = Math.sqrt(f * f + s * s);
        if (len > 1) { f /= len; s /= len; }

        var sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
        var wx = -sy * f + cy * s;
        var wz = -cy * f - sy * s;
        var moving = (f !== 0 || s !== 0);

        if (moving) {
          me.vx += wx * CFG.ACCEL * dt;
          me.vz += wz * CFG.ACCEL * dt;
        } else {
          var sp = Math.sqrt(me.vx * me.vx + me.vz * me.vz);
          if (sp > 0) {
            var ns = Math.max(0, sp - CFG.DECEL * dt);
            me.vx = me.vx / sp * ns; me.vz = me.vz / sp * ns;
          }
        }

        var sp2 = Math.sqrt(me.vx * me.vx + me.vz * me.vz);
        if (sp2 > CFG.MAX_SPD) { me.vx = me.vx / sp2 * CFG.MAX_SPD; me.vz = me.vz / sp2 * CFG.MAX_SPD; }

        var stuck = blockedAt(me.x, me.z, me.y);
        var nx = me.x + me.vx * dt;
        if (!blockedAt(nx, me.z, me.y) || stuck) me.x = nx; else me.vx = 0;
        var nz = me.z + me.vz * dt;
        if (!blockedAt(me.x, nz, me.y) || stuck) me.z = nz; else me.vz = 0;

        if ((keys[' '] || actBtn.jump) && me.onGround) {
          me.vy = CFG.JUMP_V; me.onGround = false;
        }
        me.vy -= CFG.GRAVITY * dt;
        me.y += me.vy * dt;

        var inMap = Math.abs(me.x) <= CFG.HALF && Math.abs(me.z) <= CFG.HALF;
        if (inMap) {
          var groundH = getGroundHeight(me.x, me.z, me.y);
          if (me.y <= groundH && me.vy <= 0) {
            me.y = groundH; me.vy = 0; me.onGround = true;
          } else {
            me.onGround = false;
          }
        } else {
          me.onGround = false;
          if (me.y <= CFG.FALL_KILL_Y) dieByFall();
        }

        if (actBtn.fire) fire();
        if (actBtn.build) tryBuild();
      }

      function updateFoe(dt) {
        var k = Math.min(1, dt * 14);
        foe.x += (foeNet.x - foe.x) * k;
        foe.y += (foeNet.y - foe.y) * k;
        foe.z += (foeNet.z - foe.z) * k;
        foe.yaw = foeNet.yaw;
      }

      function updateProjectiles(dt) {
        for (var id in projectiles) {
          var p = projectiles[id];
          p.life -= dt;
          if (p.life <= 0) { delete projectiles[id]; continue; }

          var ox = p.x, oy = p.y, oz = p.z;
          var nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;

          if (Math.abs(nx) > CFG.HALF || Math.abs(nz) > CFG.HALF || ny < CFG.FALL_KILL_Y - 5 || ny > 80) {
            delete projectiles[id]; continue;
          }

          if (p.owner === localId) {
            var hitBid = null;
            for (var bid in buildings) {
              var a = buildings[bid].aabb;
              if (segAABB([ox, oy, oz], [nx, ny, nz], [a.minx, a.miny, a.minz], [a.maxx, a.maxy, a.maxz])) {
                hitBid = bid; break;
              }
            }
            if (hitBid) {
              api.send({ t: 'fort:hitb', proj: id, bid: hitBid, dmg: CFG.PROJ_DMG });
              applyDamageToBuilding(hitBid, CFG.PROJ_DMG);
              delete projectiles[id]; continue;
            }
          }

          if (p.owner === remoteId) {
            if (segAABB([ox, oy, oz], [nx, ny, nz],
                [me.x - CFG.PLAYER_R, me.y, me.z - CFG.PLAYER_R],
                [me.x + CFG.PLAYER_R, me.y + CFG.PLAYER_H, me.z + CFG.PLAYER_R])) {
              delete projectiles[id]; takeDamage(id); continue;
            }
          }

          p.x = nx; p.y = ny; p.z = nz;
        }
      }

      function updateNet(dt) {
        netAcc += dt;
        if (netAcc < 1 / CFG.NET_HZ) return;
        netAcc = 0;
        api.send({ t: 'fort:state', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(3) });
      }

      // ================= 渲染 =================
      function render() {
        if (!ctx || !canvas || !stage || !gameStarted) return;
        var W = Math.max(1, stage.clientWidth || window.innerWidth);
        var H = Math.max(1, stage.clientHeight || window.innerHeight);
        var dpr = Math.min(window.devicePixelRatio || 1, 2);

        if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
          canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // 纯色天空背景
        ctx.fillStyle = '#87CEEB';
        ctx.fillRect(0, 0, W, H);

        var cam = makeCamera([me.x, me.y + CFG.EYE, me.z], me.yaw, me.pitch);
        var focal = (H * 0.5) / Math.tan(CFG.FOV_DEG * Math.PI / 360);
        var NEAR = CFG.NEAR;
        var h = CFG.HALF;

        if (images.map) {
          // ★ 关键优化：step 改为 2，细分地面网格，极大减轻近处拉伸和透视变形
          var step = 2; 
          for (var gx = -h; gx < h; gx += step) {
            for (var gz = -h; gz < h; gz += step) {
              // 快速视野剔除，如果距离太远直接跳过（保留视野内的网格）
              var dxc = gx + step/2 - me.x;
              var dzc = gz + step/2 - me.z;
              if (dxc*dxc + dzc*dzc > 2500) continue; 

              var p1 = [gx, 0, gz], p2 = [gx + step, 0, gz];
              var p3 = [gx + step, 0, gz + step], p4 = [gx, 0, gz + step];
              var c1 = camSpace(p1, cam), c2 = camSpace(p2, cam), c3 = camSpace(p3, cam), c4 = camSpace(p4, cam);

              if (c1[2] < NEAR && c2[2] < NEAR && c3[2] < NEAR && c4[2] < NEAR) continue;

              var poly = [c1, c2, c3, c4];
              var clipped = clipPolyNear(poly, NEAR);
              if (clipped.length < 3) continue;

              // ★ 处理被裁切的地块：现在小网格被裁切后面积很小，可以放心用相近色填充
              if (c1[2] < NEAR || c2[2] < NEAR || c3[2] < NEAR || c4[2] < NEAR) {
                ctx.beginPath();
                for (var j = 0; j < clipped.length; j++) {
                  var s = proj(clipped[j], focal, W, H);
                  if (j === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
                }
                ctx.closePath();
                ctx.fillStyle = '#7a7768'; // 取地图近似色，避免突兀
                ctx.fill();
              } else {
                var s1 = proj(c1, focal, W, H), s2 = proj(c2, focal, W, H);
                var s3 = proj(c3, focal, W, H), s4 = proj(c4, focal, W, H);

                if (Math.max(s1[0], s2[0], s3[0], s4[0]) < 0 || Math.min(s1[0], s2[0], s3[0], s4[0]) > W) continue;
                if (Math.max(s1[1], s2[1], s3[1], s4[1]) < 0 || Math.min(s1[1], s2[1], s3[1], s4[1]) > H) continue;

                var u1 = (gx + h) / (h * 2), v1 = (gz + h) / (h * 2);
                var u2 = (gx + step + h) / (h * 2), v2 = v1;
                var u3 = u2, v3 = (gz + step + h) / (h * 2);
                var u4 = u1, v4 = v3;

                drawAffineTriangle(ctx, images.map, [[u1,v1],[u2,v2],[u3,v3]], [s1,s2,s3]);
                drawAffineTriangle(ctx, images.map, [[u1,v1],[u3,v3],[u4,v4]], [s1,s3,s4]);
              }
            }
          }
        } else {
          var tris = [
            [[-h, 0, -h], [h, 0, -h], [h, 0, h]],
            [[-h, 0, -h], [h, 0, h], [-h, 0, h]]
          ];
          ctx.fillStyle = '#2e6a3a';
          for (var i = 0; i < 2; i++) {
            var pts = [];
            for (var k = 0; k < 3; k++) pts.push(camSpace(tris[i][k], cam));
            var clipped = clipPolyNear(pts, NEAR);
            if (clipped.length < 3) continue;
            ctx.beginPath();
            for (var j = 0; j < clipped.length; j++) {
              var s = proj(clipped[j], focal, W, H);
              if (j === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
            }
            ctx.closePath();
            ctx.fill();
          }
        }

        var faces = [];
        for (var id in buildings) {
          var a = buildings[id].aabb;
          var bf = boxFaces([(a.minx+a.maxx)/2, (a.miny+a.maxy)/2, (a.minz+a.maxz)/2],
            (a.maxx-a.minx)/2, (a.maxy-a.miny)/2, (a.maxz-a.minz)/2, [1,0,0], [0,1,0], [0,0,1]);
          for (var i = 0; i < bf.length; i++) {
            bf[i].depth = distSq(bf[i].center, cam.pos); 
            bf[i].texture = 'obstacle'; // ★ 应用障碍物贴图
            faces.push(bf[i]);
          }
        }

        for (var pid in projectiles) {
          var p = projectiles[pid];
          if (p.owner === 0) continue;

          var dl = Math.sqrt(p.vx*p.vx + p.vy*p.vy + p.vz*p.vz);
          if (dl > 1e-6) {
            var dz = [p.vx/dl, p.vy/dl, p.vz/dl], ref = Math.abs(dz[1]) > 0.99 ? [1,0,0] : [0,1,0];
            var xx = ref[1]*dz[2]-ref[2]*dz[1], xy = ref[2]*dz[0]-ref[0]*dz[2], xz = ref[0]*dz[1]-ref[1]*dz[0];
            var xl = Math.sqrt(xx*xx+xy*xy+xz*xz);
            if (xl > 1e-9) {
              xx/=xl; xy/=xl; xz/=xl;
              var yx = dz[1]*xz-dz[2]*xy, yy = dz[2]*xx-dz[0]*xz, yz = dz[0]*xy-dz[1]*xx;
              var pf = boxFaces([p.x, p.y, p.z], 0.15, 0.15, 0.5, [xx,xy,xz], [yx,yy,yz], dz);
              for (var i = 0; i < pf.length; i++) {
                pf[i].depth = distSq(pf[i].center, cam.pos); 
                pf[i].texture = 'larou';
                faces.push(pf[i]);
              }
            }
          }
        }

        var fx = me.x - foe.x, fz = me.z - foe.z, fl = Math.sqrt(fx*fx + fz*fz);
        if (fl < 1e-3) { fx = 0; fz = -1; } else { fx /= fl; fz /= fl; }
        var facing = [fx, 0, fz], right = [fz, 0, -fx], c = [foe.x, foe.y + 1, foe.z];
        
        var ff = [{ verts: [
          [c[0]-right[0], c[1]-1, c[2]-right[2]], [c[0]+right[0], c[1]-1, c[2]+right[2]],
          [c[0]+right[0], c[1]+1, c[2]+right[2]], [c[0]-right[0], c[1]+1, c[2]-right[2]]
        ], normal: facing, center: c }];
        
        ff[0].texture = (localId === 0) ? 'wantong' : 'kongzi';
        ff[0].uvs = [[0,1], [1,1], [1,0], [0,0]];
        
        for (var i = 0; i < ff.length; i++) { 
          ff[i].depth = distSq(ff[i].center, cam.pos); 
          faces.push(ff[i]); 
        }

        faces.sort(function (a, b) { return b.depth - a.depth; });

        for (var i = 0; i < faces.length; i++) {
          var face = faces[i];
          var vx = cam.pos[0] - face.center[0], vy = cam.pos[1] - face.center[1], vz = cam.pos[2] - face.center[2];
          var d = vx*face.normal[0] + vy*face.normal[1] + vz*face.normal[2];
          if (d <= 0) continue;

          var v0 = face.verts[0], v1 = face.verts[1], v2 = face.verts[2], v3 = face.verts[3];
          var c0 = camSpace(v0, cam), c1 = camSpace(v1, cam), c2 = camSpace(v2, cam), c3 = camSpace(v3, cam);
          
          if (c0[2] < NEAR || c1[2] < NEAR || c2[2] < NEAR || c3[2] < NEAR) {
            var clipped = clipPolyNear([c0, c1, c2, c3], NEAR);
            if (clipped.length < 3) continue;
            ctx.beginPath();
            for (var j = 0; j < clipped.length; j++) {
              var s = proj(clipped[j], focal, W, H);
              if (j === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
            }
            ctx.closePath();
            ctx.fillStyle = '#33ff55';
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,.45)';
            ctx.lineWidth = 1;
            ctx.stroke();
            continue;
          }

          var s0 = proj(c0, focal, W, H), s1 = proj(c1, focal, W, H);
          var s2 = proj(c2, focal, W, H), s3 = proj(c3, focal, W, H);

          var img = face.texture ? images[face.texture] : null;
          if (img && face.uvs) {
            var uv = face.uvs;
            drawAffineTriangle(ctx, img, [uv[0], uv[1], uv[2]], [s0, s1, s2]);
            drawAffineTriangle(ctx, img, [uv[0], uv[2], uv[3]], [s0, s2, s3]);
            
            ctx.beginPath();
            ctx.moveTo(s0[0], s0[1]);
            ctx.lineTo(s1[0], s1[1]);
            ctx.lineTo(s2[0], s2[1]);
            ctx.lineTo(s3[0], s3[1]);
            ctx.closePath();
            ctx.strokeStyle = 'rgba(0,0,0,.45)';
            ctx.lineWidth = 1;
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.moveTo(s0[0], s0[1]);
            ctx.lineTo(s1[0], s1[1]);
            ctx.lineTo(s2[0], s2[1]);
            ctx.lineTo(s3[0], s3[1]);
            ctx.closePath();
            ctx.fillStyle = '#33ff55';
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,.45)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        for (var pid in projectiles) {
          var p = projectiles[pid];
          if (p.owner !== 0 || !p.text) continue;
          
          var cs = camSpace([p.x, p.y, p.z], cam);
          if (cs[2] < NEAR) continue;
          
          var screenP = proj(cs, focal, W, H);
          var baseFontSize = 14;
          var screenFontSize = (baseFontSize * focal) / (cs[2] * 30);
          screenFontSize = Math.max(8, Math.min(50, screenFontSize));
          
          ctx.save();
          ctx.font = 'bold ' + screenFontSize.toFixed(1) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = Math.max(1, screenFontSize * 0.15);
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.strokeText(p.text, screenP[0], screenP[1]);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(p.text, screenP[0], screenP[1]);
          ctx.restore();
        }
      }

      // ================= 循环 =================
      function tick(now) {
        if (!mounted) return;
        rafId = requestAnimationFrame(tick);
        
        if (!gameStarted) return;

        if (!lastTime) lastTime = now;
        var dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;

        if (introActive) {
          introTimer -= dt;
          if (introTimer <= 0) {
            introActive = false;
            if (dom.intro) dom.intro.classList.remove('show');
          }
        }

        if (!gameOver && !introActive) {
          updateSelf(dt);
          updateFoe(dt);
          updateProjectiles(dt);
          updateNet(dt);
        }

        render();
        updateDebug();
      }

      // ================= 生命周期与事件 =================
      function onKeyDown(e) {
        var k = (e.key || '').toLowerCase();

        if (k === ' ' && localStoryReady && !peerStoryReady && !gameStarted) {
          e.preventDefault();
          if (spaceTimer) clearTimeout(spaceTimer);
          spacePressCount++;
          if (spacePressCount >= 10) {
            peerStoryReady = true;
            checkStorySync();
            spacePressCount = 0;
            spaceTimer = 0;
          } else {
            spaceTimer = setTimeout(function() { spacePressCount = 0; }, 1000);
          }
          return;
        }

        if (k === ' ') { keys[' '] = true; e.preventDefault(); return; }
        if (k === 'escape') { keys = {}; return; }
        keys[k] = true;
        if (k === 'e' && document.pointerLockElement === canvas) tryBuild();
      }
      function onKeyUp(e) { keys[(e.key || '').toLowerCase()] = false; }
      function onBlur() {
        keys = {}; actBtn = { fire: false, build: false, jump: false }; joy = { active: false, dx: 0, dy: 0 };
        if (dom.knob) dom.knob.style.transform = 'translate(-50%,-50%)';
        if (dom.btnFire) dom.btnFire.classList.remove('pressed');
        if (dom.btnBuild) dom.btnBuild.classList.remove('pressed');
        if (dom.btnJump) dom.btnJump.classList.remove('pressed');
      }
      function onContextMenu(e) { if (document.pointerLockElement === canvas) e.preventDefault(); }
      function onDocMouseDown(e) {
        if (document.pointerLockElement !== canvas) return;
        if (e.button === 0) { e.preventDefault(); fire(); }
        else if (e.button === 2) { e.preventDefault(); tryBuild(); }
      }
      function onMouseMove(e) {
        if (document.pointerLockElement !== canvas) return;
        me.yaw = wrapAngle(me.yaw - (e.movementX || 0) * CFG.LOOK_SENS_MOUSE);
        me.pitch = Math.max(-Math.PI/2+0.02, Math.min(Math.PI/2-0.02, me.pitch - (e.movementY || 0) * CFG.LOOK_SENS_MOUSE));
      }
      function onCanvasPointerDown(e) {
        if (e.pointerType === 'mouse') {
          if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
            try { var p = canvas.requestPointerLock(); if (p && p.catch) p.catch(function(){}); } catch (_) {}
          }
          return;
        }
        if (lookPointer.id !== -1) return;
        lookPointer.id = e.pointerId; lookPointer.x = e.clientX; lookPointer.y = e.clientY;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      }
      function onCanvasPointerMove(e) {
        if (e.pointerId !== lookPointer.id) return;
        var dx = e.clientX - lookPointer.x, dy = e.clientY - lookPointer.y;
        lookPointer.x = e.clientX; lookPointer.y = e.clientY;
        me.yaw = wrapAngle(me.yaw - dx * CFG.LOOK_SENS_TOUCH);
        me.pitch = Math.max(-Math.PI/2+0.02, Math.min(Math.PI/2-0.02, me.pitch - dy * CFG.LOOK_SENS_TOUCH));
        e.preventDefault();
      }
      function onCanvasPointerUp(e) { if (e.pointerId === lookPointer.id) lookPointer.id = -1; }
      function onLockChange() {
        if (document.pointerLockElement === canvas) api.setHint('WASD 移动 · 空格跳跃 · 左键射击 · 右键/E 建造 · ESC 释放');
        else api.setHint('点击画面锁定鼠标 · 触屏可直接拖动');
      }

      function bindMobileControls() {
        if (!dom.joyBase) return;
        var R = 44, cx = 0, cy = 0, pid = -1;
        var st = { active: false, dx: 0, dy: 0 };
        function updateKnob() { dom.knob.style.transform = 'translate(-50%,-50%) translate(' + (st.dx*R).toFixed(1) + 'px,' + (st.dy*R).toFixed(1) + 'px)'; }
        function reset() { st.active = false; st.dx = 0; st.dy = 0; pid = -1; updateKnob(); }
        function onDown(e) {
          if (st.active) return;
          e.preventDefault(); e.stopPropagation();
          st.active = true; pid = e.pointerId;
          var r = dom.joyBase.getBoundingClientRect();
          cx = r.left + r.width / 2; cy = r.top + r.height / 2;
          try { dom.joyBase.setPointerCapture(e.pointerId); } catch (_) {}
          onMove(e);
        }
        function onMove(e) {
          if (!st.active || e.pointerId !== pid) return;
          e.preventDefault(); e.stopPropagation();
          var dx = e.clientX - cx, dy = e.clientY - cy, len = Math.sqrt(dx*dx+dy*dy);
          if (len > R) { dx = dx/len*R; dy = dy/len*R; }
          st.dx = dx/R; st.dy = dy/R;
          updateKnob(); joy = st;
        }
        function onUp(e) { if (e && e.pointerId !== pid) return; reset(); joy = st; }
        dom.joyBase.addEventListener('pointerdown', onDown);
        dom.joyBase.addEventListener('pointermove', onMove);
        dom.joyBase.addEventListener('pointerup', onUp);
        dom.joyBase.addEventListener('pointercancel', onUp);

        function bindBtn(btn, key) {
          function down(e) { e.preventDefault(); actBtn[key] = true; btn.classList.add('pressed'); try { btn.setPointerCapture(e.pointerId); } catch (_) {} }
          function up() { actBtn[key] = false; btn.classList.remove('pressed'); }
          btn.addEventListener('pointerdown', down);
          btn.addEventListener('pointerup', up);
          btn.addEventListener('pointercancel', up);
        }
        bindBtn(dom.btnFire, 'fire'); bindBtn(dom.btnBuild, 'build'); bindBtn(dom.btnJump, 'jump');
      }

      // ================= 暴露给加载器的接口 =================
      return {
        mount: function (container) {
          if (mounted) return;
          mounted = true;
          stage = container;

          loadResources();

          var style = document.createElement('style');
          style.innerHTML = `
            .fb-hud{position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;overflow:hidden;color:#dff3e0;display:none;}
            .fb-crosshair{position:absolute;left:50%;top:50%;width:22px;height:22px;transform:translate(-50%,-50%);}
            .fb-crosshair::before,.fb-crosshair::after{content:"";position:absolute;background:rgba(0,0,0,.6);box-shadow:0 0 4px rgba(255,255,255,.8);}
            .fb-crosshair::before{left:50%;top:0;width:2px;height:100%;transform:translateX(-50%);}
            .fb-crosshair::after{top:50%;left:0;height:2px;width:100%;transform:translateY(-50%);}
            .fb-status{position:absolute;left:50%;top:14px;transform:translateX(-50%);padding:6px 16px;border-radius:999px;background:rgba(20,40,25,.82);border:1px solid rgba(120,220,150,.35);font-size:13px;}
            .fb-hpbox{position:absolute;top:56px;width:230px;display:flex;align-items:center;gap:8px;}
            .fb-hpbox.left{left:20px;} .fb-hpbox.right{right:20px;flex-direction:row-reverse;}
            .fb-hpbar{flex:1;height:12px;border-radius:6px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.18);overflow:hidden;}
            .fb-hpbar i{display:block;height:100%;width:100%;transition:width .12s;background:linear-gradient(90deg,#4fe08a,#9dffb9);}
            .fb-hpbar.foe i{background:linear-gradient(90deg,#ffb066,#ff7a5c);}
            .fb-hpbar i.low{background:linear-gradient(90deg,#ff4d4d,#ff8a8a)!important;}
            .fb-hpbox b{font-size:13px;min-width:34px;text-align:center;opacity:.9;}
            .fb-hint{position:absolute;left:50%;top:96px;transform:translateX(-50%);font-size:12.5px;color:#a8c8ae;background:rgba(10,20,12,.7);padding:6px 14px;border-radius:8px;border:1px solid rgba(120,200,140,.18);}
            .fb-debug{position:absolute;left:8px;top:8px;font:11px/1.5 monospace;color:#8fe0a0;background:rgba(0,0,0,.5);padding:5px 9px;border-radius:6px;}
            .fb-touch{position:absolute;inset:0;pointer-events:none;}
            .fb-joy{position:absolute;left:22px;bottom:26px;width:132px;height:132px;border-radius:50%;background:rgba(70,150,90,.28);border:2px solid rgba(120,220,150,.45);pointer-events:auto;touch-action:none;}
            .fb-knob{position:absolute;left:50%;top:50%;width:64px;height:64px;border-radius:50%;background:radial-gradient(circle at 40% 35%,rgba(170,255,190,.9),rgba(70,180,100,.85));border:2px solid rgba(200,255,215,.85);transform:translate(-50%,-50%);pointer-events:none;}
            .fb-actions{position:absolute;right:22px;bottom:30px;display:flex;gap:12px;align-items:flex-end;pointer-events:none;}
            .fb-actions button{pointer-events:auto;touch-action:none;border-radius:50%;color:#eafff0;border:2px solid rgba(120,220,150,.5);background:rgba(70,140,90,.75);font-weight:600;transition:.1s;}
            .fb-actions button.pressed{transform:scale(.9);background:rgba(140,240,160,.9);}
            #fbBtnBuild{width:70px;height:70px;font-size:13px;}
            #fbBtnJump{width:70px;height:70px;font-size:13px;}
            #fbBtnFire{width:86px;height:86px;font-size:15px;margin-bottom:2px;}
            .fb-intro{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(0,0,0,.35);opacity:0;visibility:hidden;transition:opacity .5s ease,visibility 0s linear .5s;}
            .fb-intro.show{opacity:1;visibility:visible;transition:opacity .5s ease,visibility 0s linear 0s;}
            .fb-intro span{font-size:min(17vw,24vh);font-weight:900;color:#fff;letter-spacing:.05em;}
            .fb-overlay{position:absolute;inset:0;z-index:45;display:none;align-items:center;justify-content:center;background:rgba(20,0,0,.5);backdrop-filter:blur(2px);}
            .fb-overlay.fb-show{display:flex;}
            .fb-box{text-align:center;padding:40px 64px;border-radius:16px;background:rgba(40,15,15,.88);border:2px solid rgba(255,100,100,.5);box-shadow:0 0 50px rgba(255,60,60,.3);}
            .fb-box h2{margin:0 0 8px;font-size:36px;color:#ff8a8a;}
            .fb-box p{margin:0 0 24px;color:#cc9999;font-size:14px;}
            .fb-box button{padding:12px 36px;border-radius:8px;cursor:pointer;border:1px solid rgba(255,150,150,.6);background:rgba(80,30,30,.9);color:#ffd0d0;font-size:15px;}
            .fb-overlay.fb-win .fb-box{background:rgba(15,40,20,.88);border-color:rgba(120,255,160,.5);}
            .fb-overlay.fb-win h2{color:#8affb0;} .fb-overlay.fb-win p{color:#8fbf9a;}
            .fb-overlay.fb-win button{border-color:rgba(150,255,180,.6);background:rgba(30,80,45,.9);color:#cfffd8;}
            
            .fb-story-overlay{position:absolute;inset:0;z-index:60;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;}
            .fb-story-text{font-size:clamp(18px,4vw,32px);color:#fff;text-align:center;padding:0 40px;max-width:800px;line-height:1.6;opacity:0;transition:opacity 0.5s ease;}
            .fb-story-hint{position:absolute;bottom:40px;font-size:14px;color:rgba(255,255,255,.4);animation:fb-pulse 2s infinite;}
            @keyframes fb-pulse {0%,100%{opacity:.4;}50%{opacity:1;}}
          `;
          document.head.appendChild(style);

          container.innerHTML = `
            <canvas id="fbCanvas" style="display:block;width:100%;height:100%;outline:none;touch-action:none;"></canvas>
            
            <div class="fb-story-overlay" id="fbStoryOverlay">
              <div class="fb-story-text" id="fbStoryText"></div>
              <div class="fb-story-hint" id="fbStoryHint">点击屏幕继续</div>
            </div>

            <div class="fb-hud" id="fbHud">
              <div class="fb-status" id="fbStatus">准备</div>
              <div class="fb-hpbox left"><div class="fb-hpbar"><i id="fbHpSelfBar"></i></div><b id="fbHpSelfVal">100</b></div>
              <div class="fb-hpbox right"><div class="fb-hpbar foe"><i id="fbHpFoeBar"></i></div><b id="fbHpFoeVal">100</b></div>
              <div class="fb-crosshair"></div>
              <div class="fb-hint" id="fbHintBar"></div>
              <div class="fb-debug" id="fbDebug"></div>
              <div class="fb-touch">
                <div class="fb-joy" id="fbJoyBase"><div class="fb-knob" id="fbJoyKnob"></div></div>
                <div class="fb-actions">
                  <button id="fbBtnBuild">建造</button>
                  <button id="fbBtnJump">跳跃</button>
                  <button id="fbBtnFire">发射</button>
                </div>
              </div>
            </div>
            
            <div class="fb-intro" id="fbIntro"><span>请输入文本</span></div>
            
            <div class="fb-overlay" id="fbOverlay">
              <div class="fb-box">
                <h2 id="fbOverTitle">失败</h2>
                <p id="fbOverDesc">你被击败了</p>
                <button id="fbBtnRestart">重新对局</button>
              </div>
            </div>
          `;

          canvas = document.getElementById('fbCanvas');
          ctx = canvas.getContext('2d', { alpha: false });
          
          dom = {
            status: document.getElementById('fbStatus'),
            hpSelfBar: document.getElementById('fbHpSelfBar'),
            hpFoeBar: document.getElementById('fbHpFoeBar'),
            hpSelfVal: document.getElementById('fbHpSelfVal'),
            hpFoeVal: document.getElementById('fbHpFoeVal'),
            hint: document.getElementById('fbHintBar'),
            debug: document.getElementById('fbDebug'),
            joyBase: document.getElementById('fbJoyBase'),
            knob: document.getElementById('fbJoyKnob'),
            btnFire: document.getElementById('fbBtnFire'),
            btnBuild: document.getElementById('fbBtnBuild'),
            btnJump: document.getElementById('fbBtnJump'),
            intro: document.getElementById('fbIntro'),
            overlay: document.getElementById('fbOverlay'),
            overTitle: document.getElementById('fbOverTitle'),
            overDesc: document.getElementById('fbOverDesc'),
            btnRestart: document.getElementById('fbBtnRestart'),
            
            hud: document.getElementById('fbHud'),
            storyOverlay: document.getElementById('fbStoryOverlay'),
            storyText: document.getElementById('fbStoryText'),
            storyHint: document.getElementById('fbStoryHint')
          };

          dom.btnRestart.addEventListener('click', function () {
            resetState();
            api.send({ t: 'fort:restart' });
          });

          dom.storyOverlay.addEventListener('pointerdown', onStoryClick);
          
          if (dom.storyText) {
            dom.storyText.textContent = storyTexts[0];
            storyIdx = 1;
            setTimeout(function(){ if (dom.storyText) dom.storyText.style.opacity = '1'; }, 50);
          }

          canvas.addEventListener('pointerdown', onCanvasPointerDown);
          canvas.addEventListener('pointermove', onCanvasPointerMove);
          canvas.addEventListener('pointerup', onCanvasPointerUp);
          canvas.addEventListener('pointercancel', onCanvasPointerUp);
          document.addEventListener('mousedown', onDocMouseDown);
          document.addEventListener('contextmenu', onContextMenu);
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('pointerlockchange', onLockChange);
          window.addEventListener('keydown', onKeyDown);
          window.addEventListener('keyup', onKeyUp);
          window.addEventListener('blur', onBlur);
          
          bindMobileControls();
          
          lastTime = 0;
          rafId = requestAnimationFrame(tick);
        },

        unmount: function () {
          if (!mounted) return;
          mounted = false;
          
          if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
          if (storyTimeoutId) { clearTimeout(storyTimeoutId); storyTimeoutId = 0; }
          if (spaceTimer) { clearTimeout(spaceTimer); spaceTimer = 0; }

          if (canvas) {
            canvas.removeEventListener('pointerdown', onCanvasPointerDown);
            canvas.removeEventListener('pointermove', onCanvasPointerMove);
            canvas.removeEventListener('pointerup', onCanvasPointerUp);
            canvas.removeEventListener('pointercancel', onCanvasPointerUp);
          }
          if (dom.storyOverlay) dom.storyOverlay.removeEventListener('pointerdown', onStoryClick);
          
          document.removeEventListener('mousedown', onDocMouseDown);
          document.removeEventListener('contextmenu', onContextMenu);
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('pointerlockchange', onLockChange);
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('keyup', onKeyUp);
          window.removeEventListener('blur', onBlur);

          if (document.pointerLockElement === canvas) {
            try { document.exitPointerLock(); } catch (_) {}
          }

          stage.innerHTML = '';
          canvas = null; ctx = null; stage = null; dom = {};
        },

        handleMessage: function (msg) {
          if (!msg || typeof msg !== 'object') return;
          var t = msg.t;
          if (typeof t !== 'string' || t.indexOf('fort:') !== 0) return;

          try {
            switch (t) {
              case 'fort:story:ready':
                peerStoryReady = true;
                checkStorySync();
                break;

              case 'fort:state':
                if (!gameStarted || typeof msg.x !== 'number' || typeof msg.z !== 'number') return;
                if (!isFinite(msg.x) || !isFinite(msg.z)) return;
                foeNet.x = msg.x;
                foeNet.y = (typeof msg.y === 'number' && isFinite(msg.y)) ? msg.y : 0;
                foeNet.z = msg.z;
                foeNet.yaw = (typeof msg.yaw === 'number' && isFinite(msg.yaw)) ? msg.yaw : 0;
                break;

              case 'fort:shot':
                if (!gameStarted || typeof msg.id !== 'string' || projectiles[msg.id]) return;
                if (!isFinite(msg.x) || !isFinite(msg.y) || !isFinite(msg.z)) return;
                if (!isFinite(msg.vx) || !isFinite(msg.vy) || !isFinite(msg.vz)) return;
                projectiles[msg.id] = { 
                  id: msg.id, owner: remoteId, x: msg.x, y: msg.y, z: msg.z, 
                  vx: msg.vx, vy: msg.vy, vz: msg.vz, life: CFG.PROJ_LIFE,
                  text: msg.text || ""
                };
                break;

              case 'fort:hit':
                if (!gameStarted) return;
                if (typeof msg.hp === 'number' && isFinite(msg.hp)) foe.hp = Math.max(0, msg.hp);
                if (typeof msg.proj === 'string') delete projectiles[msg.proj];
                updateHud();
                if (foe.hp <= 0 && !gameOver) endGame(true);
                break;

              case 'fort:ko':
                if (!gameStarted) return;
                foe.hp = 0;
                updateHud();
                if (!gameOver) endGame(true);
                break;

              case 'fort:hitb':
                if (!gameStarted) return;
                if (typeof msg.proj === 'string') delete projectiles[msg.proj];
                if (typeof msg.bid === 'string') applyDamageToBuilding(msg.bid, msg.dmg || CFG.PROJ_DMG);
                break;

              case 'fort:build':
                if (!gameStarted) return;
                if (typeof msg.id !== 'string' || buildings[msg.id]) return;
                if (typeof msg.x !== 'number' || typeof msg.z !== 'number') return;
                if (Math.abs(msg.x) > CFG.HALF || Math.abs(msg.z) > CFG.HALF) return;
                addBuilding(msg.id, msg.x, msg.y || 0, msg.z, msg.axis === 'x' ? 'x' : 'z', msg.btype === 'floor' ? 'floor' : 'wall');
                break;

              case 'fort:restart':
                if (!gameStarted) return;
                resetState();
                break;
            }
          } catch (err) {
            api.log('消息处理异常: ' + (err && err.message), 'err');
          }
        }
      };
    }
  });
})();