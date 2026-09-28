// Minimal local server mimicking Vercel: /api/* -> api/*.js, everything else -> index.html.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    const m = pathname.match(/^\/api\/([a-z]+)$/);
    if (m) {
      const file = path.join(__dirname, 'api', `${m[1]}.js`);
      if (fs.existsSync(file)) return require(file)(req, res);
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT}`));
