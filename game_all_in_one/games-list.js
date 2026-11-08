/**
 * 游戏清单（数据库）
 * 加载器按顺序加载每个 file；游戏脚本自行调用 GameRegistry.register 注册。
 * 新增游戏：把 js 放到同目录，在下面加一行即可。
 */
window.GAMES_MANIFEST = [
  { id: 'pong',       file: 'pong.js' },
  { id: 'battleship', file: 'battleship.js' }
];