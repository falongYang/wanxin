export default {
  // Relative asset paths so the same build works under a sub-path (e.g.
  // http://host/wanxin/), at the domain root, and locally via file://.
  base: './',
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:3001' } },
}