/**
 * Tests for the ingress configuration itself.
 *
 * The nginx config has no code path a unit test can call, but the things it
 * gets wrong are expensive and silent: a compression level that quietly
 * defaults to 1, a Cache-Control that makes every page load re-download the
 * whole bundle, an unbuffered access log that costs a syscall per OTLP export.
 * These tests read default.conf.template and nginx.conf and assert on the
 * directives that carry those costs, plus the regressions each change could
 * introduce.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  readTemplate,
  readNginxConf,
  stripComments,
  getServerBlocks,
  getLocationBlocks,
  getDirectives,
  hasDirective,
  locationRegexSource,
  resolveLocation,
} = require("./NginxConfigParser");

const template = readTemplate();
const nginxConf = readNginxConf();

const serverBlocks = getServerBlocks(template);

// The third server block is the primary ingress ("localhost ingress $HOST");
// the first two are the status-page servers on port 7849.
const primaryServerBlock = serverBlocks.find((block) => {
  return /server_name\s+localhost\s+ingress/.test(block.body);
});

const INGEST_LOCATIONS = [
  "/telemetry",
  "/otlp",
  "/kubernetes-cost",
  "/session-replay",
  "/pyroscope",
];

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/*
 * The one location in the primary ingress that proxies without asking for
 * HTTP/1.1 upstream. It predates these changes: it is the PWA
 * manifest/service-worker regex, which proxies from inside `if` blocks and is
 * hit twice per page load rather than once per bundle chunk. It is listed here
 * explicitly, and asserted on exactly, so the allow-list cannot quietly grow.
 */
const PROXY_HTTP_VERSION_EXCEPTIONS = [
  "~* ^/(manifest\\.json|service-worker\\.js)$",
];

// ---------------------------------------------------------------------------
// gzip
// ---------------------------------------------------------------------------

test("the template still has exactly three server blocks", () => {
  assert.equal(serverBlocks.length, 3);
  assert.ok(primaryServerBlock, "expected a 'localhost ingress' server block");
});

test("every server block that enables gzip also pins the compression level", () => {
  const gzipBlocks = serverBlocks.filter((block) => {
    return getDirectives(block.body, "gzip").includes("gzip on;");
  });

  assert.equal(gzipBlocks.length, 3);

  for (const block of gzipBlocks) {
    assert.deepEqual(getDirectives(block.body, "gzip_comp_level"), [
      "gzip_comp_level 5;",
    ]);
  }
});

test("every server block that enables gzip sends Vary: Accept-Encoding", () => {
  for (const block of serverBlocks) {
    assert.deepEqual(
      getDirectives(block.body, "gzip_vary"),
      ["gzip_vary on;"],
      "a shared cache can serve a gzipped body to a client that never negotiated one without gzip_vary",
    );
  }
});

test("gzip_proxied compresses proxied responses instead of only uncacheable ones", () => {
  for (const block of serverBlocks) {
    assert.deepEqual(getDirectives(block.body, "gzip_proxied"), [
      "gzip_proxied any;",
    ]);
  }

  // Comments are stripped first: the replacement is documented in a comment
  // that names the old value, and that prose must not count as a directive.
  assert.ok(
    !/no-cache\s+no-store\s+private\s+expired\s+auth/.test(
      stripComments(template),
    ),
    "the old restrictive gzip_proxied value must be gone from every server block",
  );
});

test("the gzip settings that were already correct are left alone", () => {
  for (const block of serverBlocks) {
    // Below ~1KB the gzip header costs more than the compression saves.
    assert.deepEqual(getDirectives(block.body, "gzip_min_length"), [
      "gzip_min_length 1000;",
    ]);

    const gzipTypes = getDirectives(block.body, "gzip_types");
    assert.equal(gzipTypes.length, 1);

    for (const mimeType of [
      "text/plain",
      "application/xml",
      "application/javascript",
      "text/javascript",
      "text/css",
      "application/json",
    ]) {
      assert.ok(gzipTypes[0].includes(mimeType), `gzip_types lost ${mimeType}`);
    }
  }
});

test("compression level stays at the measured knee, not the maximum", () => {
  // Level 6 buys another 2.9% over level 5 for roughly 50% more CPU, and 9
  // costs several times that for well under a percent. If someone raises this,
  // it should be a deliberate decision with new numbers, not a drive-by.
  assert.ok(
    !/gzip_comp_level\s+([6-9])\s*;/.test(template),
    "gzip_comp_level above 5 needs a fresh measurement, not a guess",
  );
});

// ---------------------------------------------------------------------------
// access_log buffering
// ---------------------------------------------------------------------------

test("nginx.conf declares exactly one global access_log, and it is buffered", () => {
  const globalAccessLogs = getDirectives(nginxConf, "access_log");

  assert.equal(globalAccessLogs.length, 1);

  const [directive] = globalAccessLogs;

  assert.ok(directive.includes("/var/log/nginx/access.log"), directive);
  assert.ok(
    /\bmain\b/.test(directive),
    "the buffered access_log must still use the 'main' log format",
  );
  assert.ok(directive.includes("buffer=64k"), directive);
  assert.ok(directive.includes("flush=10s"), directive);
});

test("the 'main' log format the access_log names is still defined", () => {
  assert.ok(/^\s*log_format\s+main\s/m.test(nginxConf));
});

test("every access_log in the ingress config uses identical buffer parameters", () => {
  // nginx refuses to start with "access_log ... already defined with
  // conflicting parameters" if two directives name one file with different
  // buffer/flush/gzip settings. Every directive writes to the same file, so
  // they must agree exactly.
  const allAccessLogs = [
    ...getDirectives(nginxConf, "access_log"),
    ...getDirectives(template, "access_log"),
  ];

  assert.ok(allAccessLogs.length > 1);

  for (const directive of allAccessLogs) {
    assert.ok(
      directive.includes("/var/log/nginx/access.log"),
      `unexpected access_log target: ${directive}`,
    );
    assert.ok(
      directive.includes("buffer=64k") && directive.includes("flush=10s"),
      `access_log without the shared buffer parameters: ${directive}`,
    );
  }
});

test("no access_log is switched off anywhere in the ingress config", () => {
  // Per-request status and client IP at the ingress are how a tenant's 413s
  // and 429s get diagnosed. Ingest logging is operator-controllable, never
  // hard-disabled in the shipped config.
  for (const source of [nginxConf, template]) {
    assert.ok(
      !/^\s*access_log\s+off\s*;/m.test(source),
      "access_log off must not appear in the shipped config",
    );
  }
});

// ---------------------------------------------------------------------------
// Operator-controllable ingest logging
// ---------------------------------------------------------------------------

test("each high-volume ingest location logs through the operator switch", () => {
  const locations = getLocationBlocks(primaryServerBlock.body);

  for (const ingestPath of INGEST_LOCATIONS) {
    const location = locations.find((candidate) => {
      return candidate.spec === ingestPath;
    });

    assert.ok(location, `missing location ${ingestPath}`);

    const accessLogs = getDirectives(location.body, "access_log");

    assert.equal(
      accessLogs.length,
      1,
      `${ingestPath} should declare exactly one access_log`,
    );
    assert.ok(
      accessLogs[0].includes("if=$ingest_access_log"),
      `${ingestPath}: ${accessLogs[0]}`,
    );
  }
});

test("ordinary locations are left on the inherited global access_log", () => {
  // The switch is scoped to ingest. If it leaks onto /api or /dashboard, an
  // operator turning ingest logging off would blind the whole ingress.
  const locations = getLocationBlocks(primaryServerBlock.body);

  for (const location of locations) {
    if (INGEST_LOCATIONS.includes(location.spec)) {
      continue;
    }

    assert.deepEqual(
      getDirectives(location.body, "access_log"),
      [],
      `location ${location.spec} should not carry its own access_log`,
    );
  }
});

test("the ingest switch defaults to logging ENABLED", () => {
  const mapMatch = template.match(
    /map\s+"\$\{NGINX_INGEST_ACCESS_LOG\}"\s+\$ingest_access_log\s*\{([^}]*)\}/,
  );

  assert.ok(mapMatch, "expected a map driving $ingest_access_log");

  const mapBody = stripComments(mapMatch[1]);

  // "1" is truthy for access_log's if= parameter, so the default logs.
  assert.ok(
    /^\s*default\s+1\s*;/m.test(mapBody),
    "the map default must enable logging",
  );

  // Only explicit off switches disable it. A typo or an empty value must not.
  for (const offValue of ["off", "false", "0", "no"]) {
    assert.ok(
      new RegExp(`^\\s*"${offValue}"\\s+0\\s*;`, "m").test(mapBody),
      `"${offValue}" should map to 0`,
    );
  }

  for (const onValue of ["on", "true", "1", "yes", ""]) {
    assert.ok(
      !new RegExp(`^\\s*"${onValue}"\\s+0\\s*;`, "m").test(mapBody),
      `"${onValue}" must not disable ingest logging`,
    );
  }
});

test("nginx.conf supplies the fallback for an unset NGINX_INGEST_ACCESS_LOG", () => {
  // envsubst leaves ${NGINX_INGEST_ACCESS_LOG} verbatim when the variable is
  // absent from the environment, and nginx then reads it as a variable of that
  // name. Without this declaration the ingress would fail to start with
  // "unknown NGINX_INGEST_ACCESS_LOG variable" on every default install.
  const declaration = nginxConf.match(
    /map\s+\$host\s+\$NGINX_INGEST_ACCESS_LOG\s*\{([^}]*)\}/,
  );

  assert.ok(declaration, "nginx.conf must declare $NGINX_INGEST_ACCESS_LOG");
  assert.ok(
    /default\s+"?on"?\s*;/.test(declaration[1]),
    "the fallback must keep ingest logging on",
  );

  // The declaration has to be in scope before conf.d/default.conf is included.
  assert.ok(
    nginxConf.indexOf("$NGINX_INGEST_ACCESS_LOG") <
      nginxConf.indexOf("include /etc/nginx/conf.d/default.conf;"),
  );

  // And it must live in nginx.conf, which the Dockerfile copies verbatim.
  // Declaring it inside the template would not work: envsubst would rewrite
  // the declaration itself the moment an operator set the variable.
  assert.ok(
    !/map\s+\$host\s+\$NGINX_INGEST_ACCESS_LOG/.test(template),
    "the fallback declaration must not be inside the envsubst-rendered template",
  );
});

// ---------------------------------------------------------------------------
// Immutable caching for content-hashed assets
// ---------------------------------------------------------------------------

function findImmutableLocation(serverBlock) {
  return getLocationBlocks(serverBlock.body).find((location) => {
    return location.body.includes(IMMUTABLE_CACHE_CONTROL);
  });
}

test("exactly one location serves far-future immutable caching", () => {
  const immutableLocations = serverBlocks
    .map(findImmutableLocation)
    .filter(Boolean);

  assert.equal(
    immutableLocations.length,
    1,
    "immutable caching belongs only in the server block that was sending no-store on hashed assets",
  );

  assert.equal(
    findImmutableLocation(primaryServerBlock).spec,
    immutableLocations[0].spec,
    "the immutable location must be in the primary ingress server block",
  );
});

test("the immutable location no longer sends no-store", () => {
  const location = findImmutableLocation(primaryServerBlock);

  assert.ok(!location.body.includes("no-store"), location.body);

  const cacheControlHeaders = getDirectives(location.body, "add_header").filter(
    (directive) => {
      return directive.includes("Cache-Control");
    },
  );

  assert.deepEqual(cacheControlHeaders, [
    `add_header Cache-Control "${IMMUTABLE_CACHE_CONTROL}";`,
  ]);
});

test("any location pinning an immutable Cache-Control hides the upstream one", () => {
  /*
   * This is the invariant that decides whether far-future caching actually
   * happens, and it is not visible in nginx's own add_header list.
   *
   * add_header APPENDS. It cannot replace a header the upstream already sent,
   * and the upstream for these paths is the ExpressStatic handler registered
   * in App/FeatureSet/Frontend/Index.ts with NO maxAge -- so `send` emits its
   * own "Cache-Control: public, max-age=0". Without proxy_hide_header the
   * client receives both headers and honours the first max-age it sees, which
   * is zero: the immutable header is inert and every page load still
   * re-downloads the whole bundle.
   *
   * Config order between the two directives is irrelevant (they are applied by
   * different modules, not in file order), so only presence is asserted.
   */
  let checked = 0;

  for (const serverBlock of serverBlocks) {
    for (const location of getLocationBlocks(serverBlock.body)) {
      const pinsImmutable = getDirectives(location.body, "add_header").some(
        (directive) => {
          return (
            directive.includes("Cache-Control") &&
            directive.includes("immutable")
          );
        },
      );

      if (!pinsImmutable) {
        continue;
      }

      checked++;

      assert.deepEqual(
        getDirectives(location.body, "proxy_hide_header"),
        ["proxy_hide_header Cache-Control;"],
        `location ${location.spec} adds an immutable Cache-Control on top of the upstream's own instead of replacing it, so browsers keep the upstream max-age=0`,
      );
    }
  }

  assert.equal(checked, 1, "expected exactly one immutable location to check");
});

test("the immutable location reuses pooled upstream connections", () => {
  /*
   * nginx proxies with HTTP/1.0 and "Connection: close" unless told otherwise,
   * which bypasses the upstream{} keepalive pool and costs a fresh TCP
   * connection per bundle chunk -- directly against the point of the block.
   */
  const location = findImmutableLocation(primaryServerBlock);

  assert.deepEqual(getDirectives(location.body, "proxy_http_version"), [
    "proxy_http_version 1.1;",
  ]);

  const connectionHeaders = getDirectives(
    location.body,
    "proxy_set_header",
  ).filter((directive) => {
    return directive.startsWith("proxy_set_header Connection");
  });

  assert.deepEqual(connectionHeaders, ['proxy_set_header Connection "";']);
});

test("every proxying location in the primary ingress asks for HTTP/1.1 upstream", () => {
  const proxyingLocations = getLocationBlocks(primaryServerBlock.body).filter(
    (location) => {
      // grpc_pass locations are a different upstream protocol entirely and
      // carry no proxy_http_version; there is one, /opentelemetry.proto.*.
      return hasDirective(location.body, "proxy_pass");
    },
  );

  assert.ok(
    proxyingLocations.length > 40,
    `only found ${proxyingLocations.length} proxying locations; the parser or the block layout changed`,
  );

  const withoutKeepalive = proxyingLocations
    .filter((location) => {
      return !getDirectives(location.body, "proxy_http_version").includes(
        "proxy_http_version 1.1;",
      );
    })
    .map((location) => {
      return location.spec;
    });

  assert.deepEqual(
    withoutKeepalive,
    PROXY_HTTP_VERSION_EXCEPTIONS,
    "a proxying location without proxy_http_version 1.1 opens a new TCP connection to the app per request",
  );
});

test("every location that asks for HTTP/1.1 upstream also clears Connection: close", () => {
  // proxy_http_version 1.1 on its own is not enough: nginx's built-in default
  // still sends "Connection: close" upstream, which retires the socket after
  // one request. Either spelling neutralises it -- "" outright, or the
  // $connection_upgrade map in nginx.conf, which yields "" for any request
  // that is not a WebSocket handshake.
  const allowedValues = [
    'proxy_set_header Connection "";',
    "proxy_set_header Connection $connection_upgrade;",
  ];

  for (const serverBlock of serverBlocks) {
    for (const location of getLocationBlocks(serverBlock.body)) {
      if (!hasDirective(location.body, "proxy_http_version")) {
        continue;
      }

      const connectionHeaders = getDirectives(
        location.body,
        "proxy_set_header",
      ).filter((directive) => {
        return directive.startsWith("proxy_set_header Connection");
      });

      assert.equal(
        connectionHeaders.length,
        1,
        `location ${location.spec} should set Connection exactly once`,
      );
      assert.ok(
        allowedValues.includes(connectionHeaders[0]),
        `location ${location.spec}: ${connectionHeaders[0]}`,
      );
    }
  }

  // $connection_upgrade is what makes the second spelling safe, so pin the map
  // that produces the empty value for non-upgrade requests.
  assert.ok(
    /map\s+\$http_upgrade\s+\$connection_upgrade\s*\{[^}]*''\s+'';/.test(
      nginxConf,
    ),
    "the $connection_upgrade map must still yield an empty Connection for non-WebSocket requests",
  );
});

test("the immutable location still proxies to the app and keeps nosniff", () => {
  const location = findImmutableLocation(primaryServerBlock);

  assert.ok(/proxy_pass\s+\$\{BACKEND_APP_TARGET\}\s*;/.test(location.body));
  assert.ok(
    location.body.includes(
      'add_header X-Content-Type-Options "nosniff" always;',
    ),
  );
});

test("the immutable location repeats every security header of the block it pre-empts", () => {
  /*
   * A regex location wins outright over the /dashboard-style prefix locations,
   * and add_header only inherits DOWN a level -- never sideways from a sibling.
   * So every security header the pre-empted block sets has to be restated in
   * the immutable block or it is simply not sent.
   *
   * This is not a static-asset-only concern. A request for a hashed chunk that
   * does not exist falls through ExpressStatic into the SPA catch-all
   * (App/FeatureSet/Frontend/Index.ts), which renders the authenticated
   * Dashboard document as text/html with a 200. A crafted
   * /dashboard/dist/a-AAAAAAAA.js therefore reaches real HTML through this
   * location, and must carry the same framing protection it would have had.
   *
   * The expected set is derived from the /dashboard block rather than hardcoded,
   * so adding a security header there without adding it here fails loudly.
   */
  const immutableLocation = findImmutableLocation(primaryServerBlock);
  const dashboardLocation = getLocationBlocks(primaryServerBlock.body).find(
    (location) => {
      return location.spec.trim() === "/dashboard";
    },
  );

  assert.ok(
    dashboardLocation,
    "expected a /dashboard prefix location to derive the security-header set from",
  );

  const securityHeaders = getDirectives(
    dashboardLocation.body,
    "add_header",
  ).filter((directive) => {
    return !directive.includes("Cache-Control");
  });

  assert.ok(
    securityHeaders.length >= 3,
    `expected /dashboard to set at least 3 security headers, found ${securityHeaders.length}`,
  );

  for (const header of securityHeaders) {
    assert.ok(
      immutableLocation.body.includes(header),
      `the immutable location pre-empts /dashboard but does not resend "${header}", so a crafted hashed-chunk URL would serve the Dashboard document without it`,
    );
  }
});

test("the immutable regex matches content-hashed chunks only", () => {
  const location = findImmutableLocation(primaryServerBlock);

  assert.ok(
    location.spec.startsWith("~ "),
    `expected a case-sensitive regex location, got: ${location.spec}`,
  );

  const pattern = new RegExp(locationRegexSource(location.spec));

  const shouldMatch = [
    "/dashboard/dist/chunk-VBWK6RSS.js",
    "/admin/dist/chunk-A2B3C4D5.js",
    "/accounts/dist/chunk-ZZZZ2345.css",
    "/status-page/dist/chunk-QWERTY23.js",
    "/public-dashboard/dist/chunk-ABCDEFGH.js",
    "/dashboard/dist/nested/chunk-ABCDEFGH.js",
  ];

  for (const uri of shouldMatch) {
    assert.ok(pattern.test(uri), `should match ${uri}`);
  }

  const shouldNotMatch = [
    // The esbuild ENTRY file is not content-hashed. A year-long cache entry
    // here would pin a client to one build forever.
    "/dashboard/dist/Index.js",
    "/accounts/dist/Index.js",
    // HTML entrypoints must keep revalidating.
    "/dashboard",
    "/dashboard/",
    "/dashboard/index.html",
    "/dashboard/dist/index.html",
    "/status-page/index.html",
    // Not under /dist/.
    "/dashboard/assets/js/tailwind-3.4.5.js",
    "/dashboard/assets/monaco/vs/loader.js",
    // Lowercase is not esbuild's hash alphabet, so a hand-written name with a
    // dash in it cannot be mistaken for a content hash.
    "/dashboard/dist/mermaid-wrapper.js",
    // Unknown app prefixes are not covered.
    "/docs/dist/chunk-ABCDEFGH.js",
    // Query strings are not part of the location match, but a hash-looking
    // path segment that is not a bundle must still miss.
    "/dashboard/dist/chunk-ABCDEFGH.json",
  ];

  for (const uri of shouldNotMatch) {
    assert.ok(!pattern.test(uri), `should NOT match ${uri}`);
  }
});

test("any location regex containing braces is quoted", () => {
  // nginx's config tokeniser ends a word at an unquoted "{". A regex with a
  // repetition quantifier -- {8,} in the immutable asset location -- therefore
  // has to be written in double quotes, or nginx reads that brace as the start
  // of the location block and refuses to start. This is invisible until the
  // container boots, so it is worth pinning down here.
  for (const serverBlock of serverBlocks) {
    for (const location of getLocationBlocks(serverBlock.body)) {
      if (!location.spec.startsWith("~")) {
        continue;
      }

      const expression = location.spec.replace(/^~\*?/, "").trim();

      if (!/[{}]/.test(expression)) {
        continue;
      }

      assert.ok(
        /^".*"$/.test(expression),
        `location regex uses braces but is not quoted: ${location.spec}`,
      );
    }
  }
});

test("HTML entrypoints still get no-store from their prefix locations", () => {
  const locations = getLocationBlocks(primaryServerBlock.body);

  for (const appPath of [
    "/dashboard",
    "/admin",
    "/status-page",
    "/public-dashboard",
    "/accounts",
  ]) {
    const location = locations.find((candidate) => {
      return candidate.spec === appPath;
    });

    assert.ok(location, `missing location ${appPath}`);
    assert.ok(
      location.body.includes(
        'add_header Cache-Control "no-cache, no-store, must-revalidate" always;',
      ),
      `${appPath} must keep revalidating so users are not pinned to a stale build`,
    );
  }
});

test("nginx location precedence sends chunks to the immutable block and pages to the app block", () => {
  const locations = getLocationBlocks(primaryServerBlock.body);
  const immutableLocation = findImmutableLocation(primaryServerBlock);

  assert.equal(
    resolveLocation(locations, "/dashboard/dist/chunk-VBWK6RSS.js").spec,
    immutableLocation.spec,
    "a regex location must win over the /dashboard prefix",
  );

  assert.equal(
    resolveLocation(locations, "/dashboard/dist/Index.js").spec,
    "/dashboard",
    "the unhashed entry file must fall through to the revalidating prefix location",
  );

  assert.equal(resolveLocation(locations, "/dashboard").spec, "/dashboard");
  assert.equal(resolveLocation(locations, "/admin").spec, "/admin");
});

test("the status-page server blocks are not given immutable caching", () => {
  // Only the primary ingress was sending no-store on hashed asset paths. The
  // other two blocks send no Cache-Control at all, so there is nothing to fix
  // there and nothing to blanket-apply.
  const otherBlocks = serverBlocks.filter((block) => {
    return block !== primaryServerBlock;
  });

  assert.equal(otherBlocks.length, 2);

  for (const block of otherBlocks) {
    assert.ok(!block.body.includes(IMMUTABLE_CACHE_CONTROL));
    assert.ok(!block.body.includes("max-age=31536000"));
  }
});
