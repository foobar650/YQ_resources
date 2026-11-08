/**
 * 海战棋模块
 * 主机设置舰队配置，双方各自部署，回合制炮击。
 * 消息（t 字段）：
 *   bs:config { ships:[{len,count}] }   主机广播配置
 *   bs:ready                            部署完成
 *   bs:start  { firstTurn:'host'|'guest' } 主机宣布开始
 *   bs:attack { x,y }                   攻击
 *   bs:result { x,y,hit,sunk,gameOver,nextTurn }
 */
(function () {
  'use strict';

  if (!window.GameRegistry) {
    console.error('[battleship] GameRegistry 未定义，跳过注册');
    return;
  }

  var BS_N = 10;
  var CELL = 28;
  var GRID = BS_N * CELL;
  var CANVAS_W = 800, CANVAS_H = 820;
  var MY_X = 260, MY_Y = 60;
  var EN_X = 260, EN_Y = 460;

  window.GameRegistry.register('battleship', {
    name: '海战棋',
    icon: '🚢',
    desc: '回合制炮击 · 主机设置舰队配置',

    create: function (api) {
      var state = {
        phase: 'idle',        // 'config'|'waitConfig'|'deploy'|'waitPeer'|'battle'|'over'
        isHost: !!api.isHost,
        config: [],
        myBoard: null,
        myShots: null,
        myShips: [],
        myTurn: false,
        deployed: false,
        selfReady: false,
        peerReady: false,
        waitingResult: false,
        gameOver: false,
        iWon: false
      };

      var canvas = null, ctx = null;
      var configPanel = null, waitConfigPanel = null, deployPanel = null, battlePanel = null;
      var shipRowsEl = null, configErrorEl = null, configSummaryEl = null;
      var turnInfoEl = null, resultInfoEl = null, confirmDeployBtn = null;

      /* ---------- 棋盘 ---------- */
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

      /* ---------- 配置 UI ---------- */
      function addConfigRow(len, count) {
        var row = document.createElement('div');
        row.className = 'bs-config-row';
        row.innerHTML = ''
          + '<span>长度</span>'
          + '<input type="number" min="1" max="5" value="' + (len || 2) + '" class="bs-input bs-len">'
          + '<span>数量</span>'
          + '<input type="number" min="0" max="6" value="' + (count == null ? 1 : count) + '" class="bs-input bs-count">'
          + '<button type="button" class="danger bs-del" style="padding:4px 10px;font-size:12px;">删除</button>';
        row.querySelector('.bs-del').addEventListener('click', function () {
          if (row.parentNode) row.parentNode.removeChild(row);
        });
        shipRowsEl.appendChild(row);
      }
      function buildDefaultConfig() {
        shipRowsEl.innerHTML = '';
        addConfigRow(4, 1);
        addConfigRow(3, 2);
        addConfigRow(2, 3);
        addConfigRow(1, 4);
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
          var existing = null;
          for (var j = 0; j < cfg.length