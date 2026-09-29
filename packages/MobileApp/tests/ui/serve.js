const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../dist-ui");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".woff": "font/woff", ".svg": "image/svg+xml" };
http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const requested = path.resolve(root, "." + decodeURIComponent(url.pathname));
  if (!requested.startsWith(root + path.sep) && requested !== root) {
    response.writeHead(403); response.end(); return;
  }
  const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, "index.html");
  response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
}).listen(8096, "127.0.0.1");
