/*
 * One address for the site, the docs and the API reference, as oneuptime.com
 * has: /docs, /reference, /install/ and their sitemaps go to the App's docs
 * server, everything else to Home, the way the primary server in
 * packages/Nginx/default.conf.template routes them when billing is on (the
 * SaaS). The docs' pages load their favicons and manifest from Home's
 * paths, so a scan of the docs server on its own would find files missing
 * that oneuptime.com serves.
 *
 * Ports: LIGHTHOUSE_PORT (4800) here, LIGHTHOUSE_HOME_PORT (4801) and
 * LIGHTHOUSE_DOCS_PORT (4802) behind it.
 */
const http = require("http");

const port = Number(process.env.LIGHTHOUSE_PORT || 4800);
const homePort = Number(process.env.LIGHTHOUSE_HOME_PORT || 4801);
const docsPort = Number(process.env.LIGHTHOUSE_DOCS_PORT || 4802);

// The locations default.conf.template's primary server sends to the App.
function isTheAppsPath(pathname) {
  return (
    pathname.startsWith("/docs") ||
    pathname.startsWith("/reference") ||
    pathname.startsWith("/install/") ||
    /^\/sitemap-(docs|reference)\.xml$/.test(pathname)
  );
}

const server = http.createServer((request, response) => {
  const { pathname } = new URL(request.url, "http://127.0.0.1");

  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: isTheAppsPath(pathname) ? docsPort : homePort,
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        "x-forwarded-for": request.socket.remoteAddress,
        "x-forwarded-proto": "http",
      },
    },
    (answer) => {
      response.writeHead(answer.statusCode, answer.headers);
      answer.pipe(response);
    },
  );

  upstream.on("error", (error) => {
    // Until both servers are up: Playwright's webServer waits past a 502.
    response.writeHead(502, { "content-type": "text/plain" });
    response.end(`${pathname}: ${error.message}\n`);
  });

  request.pipe(upstream);
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `Lighthouse proxy on ${port}: Home on ${homePort}, the docs on ${docsPort}`,
  );
});
