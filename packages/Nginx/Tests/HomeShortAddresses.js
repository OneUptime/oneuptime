/**
 * Addresses the marketing site (packages/Home) redirects, read from Home's
 * own source, for the ingress tests that check nginx hands them to Home: a
 * redirect Home answers is only reached if nginx sends the address where it
 * sends the rest of the marketing site.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { NGINX_DIRECTORY } = require("./NginxConfigParser");

const DEMO_PAGE_SOURCE = path.join(
  NGINX_DIRECTORY,
  "..",
  "Home",
  "Utils",
  "DemoPage.ts",
);

/**
 * DEMO_PAGE_PATH and DEMO_SHORT_PATHS of Home/Utils/DemoPage.ts: the demo
 * page, and oneuptime.com/demo with the other addresses Home sends to it.
 */
function readDemoAddresses() {
  const source = fs.readFileSync(DEMO_PAGE_SOURCE, "utf8");
  const page = source.match(/DEMO_PAGE_PATH:\s*string\s*=\s*"([^"]+)"/);
  const list = source.match(
    /DEMO_SHORT_PATHS:\s*ReadonlyArray<string>\s*=\s*\[([^\]]*)\]/,
  );

  assert.ok(page, "read no DEMO_PAGE_PATH from Home/Utils/DemoPage.ts");
  assert.ok(list, "read no DEMO_SHORT_PATHS from Home/Utils/DemoPage.ts");

  const shortPaths = Array.from(list[1].matchAll(/"([^"]*)"/g), (match) => {
    return match[1];
  });

  // A list read only in part would let the tests pass vacuously.
  assert.ok(shortPaths.includes("/demo"), "DEMO_SHORT_PATHS lost /demo");
  assert.equal(
    shortPaths.length,
    (list[1].split('"').length - 1) / 2,
    "every entry of DEMO_SHORT_PATHS must be read",
  );

  return { pagePath: page[1], shortPaths };
}

module.exports = {
  readDemoAddresses,
};
