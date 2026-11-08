/**
 * gomoku.js —— 加载链路测试版（占位）
 * 目的：验证 index.html 能否正常加载并注册本文件。
 * 验证通过后，请替换回真正的五子棋实现。
 */
(function () {
  'use strict';

  // 标记：脚本一旦执行，Console 里就能查到
  window.__GOMOKU_TEST_LOADED__ = true;
  console.log('[gomoku-test] 脚本已执行，准备注册游戏');

  if (!window.GameRegistry) {
    console.error('[gomoku-test] GameRegistry 不存在，加载器未就绪');
    return;
  }

  window.GameRegistry.register('gomoku', {
    name: '五子棋（测试版）',
    icon: '⚫',
    desc: '加载链路测试 · 仅显示占位内容',

    create: function (api) {
      var el = null;

      return {
        mount: function (container) {
          console.log('[gomoku-test] mount 被调用，isHost =', api.isHost);

          el = document.createElement('div');
          el.style.cssText =
            'padding:24px; text-align:center; color:#e6edf3; ' +
            'background:#0d1117; border:1px dashed #3fb950; border-radius:8px;';
          el.innerHTML =
            '<div style="font-size:22px;margin-bottom:8px;">✅ gomoku.js 加载成功</div>' +
            '<div style="font-size:13px;color:#8b949e;">' +
            '本端角色：' + (api.isHost ? '主机' : '客机') +
            '</div>' +
            '<div style="font-size:12px;color:#6e7681;margin-top:8px;">' +
            '如果看到这段文字，说明加载器、CDN、GameRegistry 全部正常。' +
            '</div>';

          container.appendChild(el);

          api.setStatus('测试占位', api.isHost ? 'host' : 'guest');
          api.setHint('这是测试版 gomoku.js，请替换回正式实现。');
        },

        unmount: function () {
          console.log('[gomoku-test] unmount 被调用');
          if (el && el.parentNode) el.parentNode.removeChild(el);
          el = null;
        },

        handleMessage: function (msg) {
          console.log('[gomoku-test] 收到消息：', msg);
        }
      };
    }
  });

  console.log('[gomoku-test] 注册完成，GameRegistry 当前游戏：',
    window.GameRegistry.list().map(function (g) { return g.id; }));
})();