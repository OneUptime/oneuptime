/**
 * The compatible ingest endpoints (issue #6797) on the primary ingress.
 *
 * Every one of them is served under /telemetry, which the primary server
 * already sends to the App. Splunk's HTTP Event Collector is also served at
 * the root, because Splunk's Docker logging driver and Fluent Bit's splunk
 * output post to /services/collector/event at the root of the host they are
 * given: on the primary server, where `location /` goes to the marketing
 * Home service when billing is on, /services/collector needs a location of
 * its own that goes to the App, sized like /telemetry.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getDirectives,
  getLocationBlocks,
  getServerBlocks,
  readTemplate,
  resolveLocation,
} = require("./NginxConfigParser");

const template = readTemplate();
const serverBlocks = getServerBlocks(template);

const primaryServerBlock = serverBlocks.find((block) => {
  return /server_name\s+localhost\s+ingress/.test(block.body);
});

const HEC_PATHS = [
  "/services/collector",
  "/services/collector/event",
  "/services/collector/event/1.0",
  "/services/collector/raw",
  "/services/collector/health",
];

const UNDER_TELEMETRY = [
  "/telemetry/prometheus/api/v1/write",
  "/telemetry/loki/api/v1/push",
  "/telemetry/services/collector/event",
  "/telemetry/datadog/api/v2/series",
  "/telemetry/sentry/api/1/envelope/",
];

test("the primary server sends Splunk HEC's root paths to the App, sized like /telemetry", () => {
  assert.ok(primaryServerBlock, "expected the primary server block");

  const locations = getLocationBlocks(primaryServerBlock.body);

  for (const uri of HEC_PATHS) {
    const location = resolveLocation(locations, uri);

    assert.ok(location, `${uri} matches no location`);
    assert.equal(location.spec, "/services/collector", uri);
    assert.match(location.body, /proxy_pass \$\{BACKEND_APP_TARGET\};/);
    assert.doesNotMatch(location.body, /backend_home/);
    assert.deepEqual(getDirectives(location.body, "client_max_body_size"), [
      "client_max_body_size 4M;",
    ]);
    assert.match(location.body, /if=\$ingest_access_log/);
  }
});

test("every other compatible endpoint is reached through /telemetry", () => {
  const locations = getLocationBlocks(primaryServerBlock.body);

  for (const uri of UNDER_TELEMETRY) {
    const location = resolveLocation(locations, uri);

    assert.ok(location, `${uri} matches no location`);
    assert.equal(location.spec, "/telemetry", uri);
  }
});
