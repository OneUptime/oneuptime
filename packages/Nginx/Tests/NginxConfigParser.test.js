/**
 * Tests for the small nginx-config reader the other suites in this directory
 * are built on.
 *
 * Everything NginxConfig.test.js and IngestAccessLogPlumbing.test.js assert is
 * only as true as this parser is. That is an uncomfortable amount of weight for
 * ~150 lines of regex, and its failure mode is the bad one: a directive it
 * misreads does not throw, it comes back subtly wrong, and a test that then
 * substring-matches the wrong value passes. The quoted-semicolon case below is
 * exactly that -- it silently halved a header comparison for as long as the
 * X-XSS-Protection header has existed in the config.
 *
 * So the parser gets its own tests, written against hand-built config snippets
 * rather than the real files, so they keep meaning something as the real files
 * change.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  stripComments,
  findBlocks,
  getServerBlocks,
  getLocationBlocks,
  getDirectives,
  hasDirective,
  locationRegexSource,
  resolveLocation,
} = require("./NginxConfigParser");

test("stripComments removes trailing and whole-line comments", () => {
  const source = ["# a whole line", "gzip on; # why", "keepalive_timeout 65;"].join(
    "\n",
  );

  assert.deepEqual(stripComments(source).split("\n"), [
    "",
    "gzip on; ",
    "keepalive_timeout 65;",
  ]);
});

test("stripComments keeps line numbering, so block boundaries do not shift", () => {
  const source = "# one\n# two\nserver {\n}\n";

  assert.equal(stripComments(source).split("\n").length, source.split("\n").length);
});

test("getDirectives normalises whitespace", () => {
  assert.deepEqual(getDirectives("  gzip_proxied     any;\n", "gzip_proxied"), [
    "gzip_proxied any;",
  ]);
});

test("getDirectives reads a value containing a quoted semicolon whole", () => {
  /*
   * The regression this parser had: X-XSS-Protection's value is "1; mode=block",
   * and a rule that ended the directive at the first `;` returned
   * `add_header X-XSS-Protection "1;`. Callers compare headers with
   * String#includes, so the truncated form still matched -- a test that
   * believed it was comparing whole headers was comparing a prefix.
   */
  const body = '    add_header X-XSS-Protection "1; mode=block" always;\n';

  assert.deepEqual(getDirectives(body, "add_header"), [
    'add_header X-XSS-Protection "1; mode=block" always;',
  ]);
});

test("getDirectives does not run one directive into the next on the same line", () => {
  const body = "  gzip on; gzip_vary on;\n";

  // The second is not at the start of a line, so only the first is collected;
  // what matters is that the first stops at its own semicolon.
  assert.deepEqual(getDirectives(body, "gzip"), ["gzip on;"]);
});

test("getDirectives collects every occurrence, including inside nested blocks", () => {
  const body = [
    "  add_header A 1 always;",
    "  if ($x = y) {",
    "    add_header B 2 always;",
    "  }",
    "  add_header C 3 always;",
  ].join("\n");

  assert.deepEqual(getDirectives(body, "add_header"), [
    "add_header A 1 always;",
    "add_header B 2 always;",
    "add_header C 3 always;",
  ]);
});

test("getDirectives ignores a directive whose name is only a prefix of another", () => {
  const body = "  gzip_comp_level 6;\n";

  assert.deepEqual(getDirectives(body, "gzip"), []);
});

test("getDirectives ignores commented-out directives", () => {
  assert.deepEqual(getDirectives("  # gzip on;\n", "gzip"), []);
});

test("getDirectives reads a valueless directive", () => {
  assert.deepEqual(getDirectives("  internal;\n", "internal"), ["internal;"]);
});

test("hasDirective answers from the same reading", () => {
  assert.equal(hasDirective("  gzip on;\n", "gzip"), true);
  assert.equal(hasDirective("  gzip on;\n", "gunzip"), false);
});

test("getServerBlocks splits sibling server blocks at their own braces", () => {
  const source = [
    "server {",
    "  server_name a;",
    "  location / {",
    "    proxy_pass http://a;",
    "  }",
    "}",
    "server {",
    "  server_name b;",
    "}",
  ].join("\n");

  const blocks = getServerBlocks(source);

  assert.equal(blocks.length, 2);
  assert.ok(blocks[0].body.includes("server_name a;"));
  assert.ok(!blocks[0].body.includes("server_name b;"));
  assert.ok(blocks[1].body.includes("server_name b;"));
});

test("a location whose regex contains braces is still read to its real end", () => {
  /*
   * `{8,}` is a quantifier, not a block. Counting braces from the FIRST one on
   * the header line would treat it as the block opener and end the location at
   * the `}` of the quantifier -- so the block's body would be read as empty and
   * every assertion about its contents would vacuously pass.
   */
  const source = [
    'location ~ "^/(dashboard)/dist/.+-[A-Z0-9]{8,}\\.(js|css)$" {',
    '  add_header Cache-Control "public, max-age=31536000, immutable";',
    "}",
  ].join("\n");

  const [location] = getLocationBlocks(source);

  assert.ok(location);
  assert.ok(location.body.includes("immutable"));
  assert.deepEqual(getDirectives(location.body, "add_header"), [
    'add_header Cache-Control "public, max-age=31536000, immutable";',
  ]);
});

test("findBlocks refuses to guess at unbalanced braces", () => {
  assert.throws(() => {
    return getServerBlocks("server {\n  location / {\n");
  }, /Unbalanced braces/);
});

test("locationRegexSource unwraps both the quoted and bare spellings", () => {
  assert.equal(locationRegexSource('~ "^/a/[A-Z]{2,}$"'), "^/a/[A-Z]{2,}$");
  assert.equal(locationRegexSource("~* ^/(manifest\\.json)$"), "^/(manifest\\.json)$");
  assert.equal(locationRegexSource("~ ^/api/"), "^/api/");
});

test("resolveLocation lets a regex location win over a longer prefix", () => {
  // nginx's real rule, and the reason the immutable-asset block pre-empts
  // /dashboard rather than merely sitting beside it.
  const source = [
    "server {",
    "  location /dashboard {",
    "    proxy_pass http://app;",
    "  }",
    '  location ~ "^/dashboard/dist/.+-[A-Z0-9]{8,}\\.js$" {',
    "    proxy_pass http://app;",
    "  }",
    "}",
  ].join("\n");

  const locations = getLocationBlocks(getServerBlocks(source)[0].body);

  assert.equal(
    resolveLocation(locations, "/dashboard/dist/chunk-ABCDEFGH.js").spec.startsWith(
      "~",
    ),
    true,
  );
  assert.equal(resolveLocation(locations, "/dashboard/home").spec, "/dashboard");
});

test("resolveLocation picks the longest matching prefix", () => {
  const source = [
    "server {",
    "  location / {",
    "    proxy_pass http://a;",
    "  }",
    "  location /status-page-api/ {",
    "    proxy_pass http://b;",
    "  }",
    "  location /status-page {",
    "    proxy_pass http://c;",
    "  }",
    "}",
  ].join("\n");

  const locations = getLocationBlocks(getServerBlocks(source)[0].body);

  assert.equal(
    resolveLocation(locations, "/status-page-api/announcement").spec,
    "/status-page-api/",
  );
  assert.equal(resolveLocation(locations, "/status-page/abc").spec, "/status-page");
  assert.equal(resolveLocation(locations, "/anything-else").spec, "/");
});

test("resolveLocation returns null when nothing matches", () => {
  const source = ["server {", "  location /only {", "    internal;", "  }", "}"].join(
    "\n",
  );

  const locations = getLocationBlocks(getServerBlocks(source)[0].body);

  assert.equal(resolveLocation(locations, "/elsewhere"), null);
});

test("findBlocks is exported and reads an arbitrary block header", () => {
  const blocks = findBlocks("upstream app {\n  server a:80;\n}\n", /^upstream\s+(\S+)\s*\{[^\S\n]*$/);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].spec, "app");
  assert.ok(blocks[0].body.includes("server a:80;"));
});
