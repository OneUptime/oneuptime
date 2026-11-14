/**
 * Does every address OneUptime hands out for a telemetry route reach the
 * App on oneuptime.com?
 *
 * The App serves each telemetry route at the root and under /telemetry, but
 * the primary ingress sends a root path to the App only through a location
 * that names it: anything else falls to `location /`, the marketing site
 * when BILLING_ENABLED=true. A root address with no location of its own
 * works on every self-hosted OneUptime and answers 404 on the hosted one,
 * which is how the host collector's installers shipped: the supervisor they
 * set up asked <OneUptime URL>/opamp/v1 for its config and got the
 * marketing site's 404, every 30 seconds, for good.
 *
 * TelemetryIngestAddresses.js lists every route the Telemetry routers
 * register, read from the App's source, with each address clients reach it
 * at and where OneUptime hands that out. These tests hold the list to the
 * source in both directions, and send every address through the primary
 * server's locations the way nginx picks them. NginxTemplateRender.test.js
 * sends the same addresses through a real nginx.
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
const {
  HOST_COLLECTOR_INSTALL_PS1,
  HOST_COLLECTOR_INSTALL_SH,
  TELEMETRY_INGEST_ADDRESSES,
  exampleOf,
  listPublicAddresses,
  readRepositoryFile,
  readTelemetryRoutes,
} = require("./TelemetryIngestAddresses");

const template = readTemplate();
const serverBlocks = getServerBlocks(template);
const primaryServerBlock = serverBlocks.find((block) => {
  return /server_name\s+localhost\s+ingress/.test(block.body);
});
const primaryLocations = getLocationBlocks(primaryServerBlock.body);

const OPAMP_LOCATION = "/opamp/";
const OPAMP_ROUTE = "/opamp/v1";
const OPAMP_ADDRESS = "/telemetry/opamp/v1";

function describeRoute(entry) {
  return `${entry.method} ${entry.route}`;
}

function directivesOf(location) {
  return location.body
    .split("\n")
    .map((line) => {
      return line.trim().replace(/\s+/g, " ");
    })
    .filter((line) => {
      return line !== "" && !line.startsWith("#");
    });
}

/*
 * The path the App is handed for an address: rewritten when the location
 * rewrites it (/fluentd/logs), as it is otherwise.
 */
function upstreamPathOf(location, address) {
  const rewrites = getDirectives(location.body, "rewrite");

  for (const rewrite of rewrites) {
    const match = rewrite.match(/^rewrite (\S+) (\S+) break;$/);

    assert.ok(match, `unexpected rewrite in ${location.spec}: ${rewrite}`);

    const expression = new RegExp(match[1]);

    if (expression.test(address)) {
      return address.replace(expression, match[2].replace(/\$(\d)/g, "$$$1"));
    }
  }

  return address;
}

/*
 * Whether a location sends what it gets to the App whatever billing says:
 * it proxies to the App, never to Home, and has no billing branch that
 * could send it elsewhere.
 */
function assertReachesTheApp(location, label) {
  assert.ok(location, `${label}: no location in the primary server takes it`);

  const directives = directivesOf(location);

  assert.ok(
    directives.includes("proxy_pass ${BACKEND_APP_TARGET};"),
    `${label} lands in location ${location.spec}, which does not proxy to the App`,
  );
  assert.ok(
    !location.body.includes("$backend_home"),
    `${label} lands in location ${location.spec}, which can send it to the marketing site`,
  );
  assert.ok(
    !location.body.includes("$billing_enabled"),
    `${label} lands in location ${location.spec}, which depends on billing`,
  );
}

const { mountPrefixes, routes } = readTelemetryRoutes();

test("the Telemetry feature set still serves its routers at the root and under /telemetry", () => {
  // The premise of everything below: both prefixes reach the same route.
  assert.deepEqual([...mountPrefixes].sort(), ["/", "/telemetry"]);
});

test("every route the Telemetry routers register is listed with the addresses clients reach it at", () => {
  /*
   * Read from the routers rather than written out, so a route added later
   * fails here until someone says which address clients get for it - and
   * so whether nginx sends that address to the App.
   */
  const registered = routes.map(describeRoute).sort();
  const listed = TELEMETRY_INGEST_ADDRESSES.map(describeRoute).sort();

  assert.ok(registered.length >= 25, `read only ${registered.length} routes`);
  assert.deepEqual(registered, listed);
});

test("every listed route says who calls it", () => {
  for (const entry of TELEMETRY_INGEST_ADDRESSES) {
    const label = describeRoute(entry);

    if (entry.inCluster) {
      assert.equal(entry.addresses, undefined, `${label}: in-cluster only`);
      continue;
    }

    assert.ok(
      Array.isArray(entry.addresses) && entry.addresses.length > 0,
      `${label}: no address`,
    );

    // At least one address OneUptime still hands out.
    assert.ok(
      entry.addresses.some((address) => {
        return Array.isArray(address.handedOutBy);
      }),
      `${label}: no address OneUptime hands out`,
    );

    for (const address of entry.addresses) {
      assert.ok(
        address.address.startsWith("/"),
        `${label}: ${address.address}`,
      );
      assert.notEqual(
        Array.isArray(address.handedOutBy) && address.handedOutBy.length > 0,
        typeof address.calledBy === "string" && address.calledBy.length > 0,
        `${label} ${address.address}: either where OneUptime hands it out, or who still calls it`,
      );
    }
  }
});

test("every address is still handed out where the list says", () => {
  /*
   * The list says which address a client gets. If that client changes to
   * another address - the root instead of /telemetry, say - the text is
   * no longer there, and this fails until the list, and so the routing
   * checks below, follow.
   */
  const checks = TELEMETRY_INGEST_ADDRESSES.flatMap((entry) => {
    const evidence = entry.inCluster ? [entry.inCluster] : [];

    for (const address of entry.addresses || []) {
      evidence.push(...(address.handedOutBy || []));
    }

    return evidence.map((item) => {
      return { label: describeRoute(entry), ...item };
    });
  });

  assert.ok(checks.length >= 30, `only ${checks.length} checks`);

  for (const check of checks) {
    assert.ok(
      readRepositoryFile(check.file).includes(check.contains),
      `${check.label}: ${check.file} no longer contains ${check.contains}`,
    );
  }
});

test("every address clients reach a telemetry route at reaches the App, whatever billing says", () => {
  const addresses = listPublicAddresses();

  assert.ok(addresses.length >= 30, `only ${addresses.length} addresses`);

  for (const address of addresses) {
    const example = exampleOf(address.address);
    const label = `${address.method} ${example} (${address.route})`;
    const location = resolveLocation(primaryLocations, example);

    assertReachesTheApp(location, label);

    // And the App is handed a path it serves the route at.
    const upstreamPath = upstreamPathOf(location, example);
    const route = exampleOf(address.route);

    assert.ok(
      upstreamPath === route || upstreamPath === `/telemetry${route}`,
      `${label} reaches the App as ${upstreamPath}, which is not the route`,
    );
  }
});

test("an address at the root reaches the App only through a location that names it", () => {
  /*
   * The trap itself, spelled out: `location /` takes every root address no
   * other location claims, and it is the marketing site when billing is
   * on. Its premise is checked here so the test above cannot pass by the
   * catch-all quietly proxying to the App.
   */
  const catchAll = primaryLocations.find((location) => {
    return location.spec === "/";
  });

  assert.ok(catchAll, "the primary server has a catch-all location");
  assert.ok(directivesOf(catchAll).includes("proxy_pass $backend_home;"));
  assert.ok(directivesOf(catchAll).includes("if ($billing_enabled = true) {"));

  for (const address of listPublicAddresses()) {
    const example = exampleOf(address.address);

    assert.notEqual(
      resolveLocation(primaryLocations, example).spec,
      "/",
      `${example} falls to the marketing site's catch-all`,
    );
  }
});

// ---------------------------------------------------------------------------
// The host collector's supervisor
// ---------------------------------------------------------------------------

test("the installers point the supervisor at the address every ingress sends to the App", () => {
  const sh = readRepositoryFile(HOST_COLLECTOR_INSTALL_SH);
  const ps1 = readRepositoryFile(HOST_COLLECTOR_INSTALL_PS1);

  assert.ok(sh.includes(`OPAMP_PATH="${OPAMP_ADDRESS}"`));
  assert.ok(sh.includes('endpoint: $(yaml_quote "$ONEUPTIME_URL$OPAMP_PATH")'));
  assert.ok(ps1.includes(`$OpAmpPath = "${OPAMP_ADDRESS}"`));
  assert.ok(ps1.includes('endpoint: $(ConvertTo-YamlString "$Url$OpAmpPath")'));

  // Nothing else in either installer names an OpAMP address.
  for (const script of [sh, ps1]) {
    assert.equal(script.split("opamp/v1").length - 1, 1);
  }

  const location = resolveLocation(primaryLocations, OPAMP_ADDRESS);

  assert.equal(location.spec, "/telemetry");
  assertReachesTheApp(location, OPAMP_ADDRESS);
});

test("a host installed before still reaches its config at /opamp/v1, through a location of its own", () => {
  /*
   * Those hosts keep asking at /opamp/v1 every 30 seconds, and nothing on
   * them changes until someone runs the installer again. This location is
   * what connects them, on their next poll.
   */
  const location = resolveLocation(primaryLocations, OPAMP_ROUTE);

  assert.equal(location.spec, OPAMP_LOCATION);
  assertReachesTheApp(location, OPAMP_ROUTE);
  assert.equal(upstreamPathOf(location, OPAMP_ROUTE), OPAMP_ROUTE);
});

test("the OpAMP location claims /opamp/ and leaves every other address to the marketing site", () => {
  const opamp = primaryLocations.filter((location) => {
    return location.spec === OPAMP_LOCATION;
  });

  assert.equal(opamp.length, 1, "exactly one /opamp/ location");

  for (const uri of ["/opamp/v1", "/opamp/v1/", "/opamp/v2", "/opamp/"]) {
    assert.equal(
      resolveLocation(primaryLocations, uri).spec,
      OPAMP_LOCATION,
      uri,
    );
  }

  /*
   * A prefix is not a path segment: the slash keeps these on `location /`.
   * (/opamp itself nginx redirects to /opamp/, as it does for a location
   * ending in a slash; NginxTemplateRender.test.js asks a real nginx.)
   */
  for (const uri of ["/opampx", "/opamp-collector", "/opamps/v1"]) {
    assert.equal(resolveLocation(primaryLocations, uri).spec, "/", uri);
  }
});

test("the OpAMP location is only in the primary server, where billing sends the root to Home", () => {
  /*
   * The two status-page servers send the root to the App already when
   * billing is off, and to https when it is on, as they do /otlp.
   */
  for (const serverBlock of serverBlocks) {
    const count = getLocationBlocks(serverBlock.body).filter((location) => {
      return location.spec === OPAMP_LOCATION;
    }).length;

    assert.equal(count, serverBlock === primaryServerBlock ? 1 : 0);
  }
});

test("the OpAMP location proxies like /telemetry, which serves the same router", () => {
  const opamp = primaryLocations.find((location) => {
    return location.spec === OPAMP_LOCATION;
  });
  const telemetry = primaryLocations.find((location) => {
    return location.spec === "/telemetry";
  });

  // Every directive of /telemetry, and nothing else: the same headers, the
  // same pooled upstream connection, the same ingest logging switch and the
  // same body cap, so a message that fits one address fits the other.
  assert.deepEqual(
    [...directivesOf(opamp)].sort(),
    [...directivesOf(telemetry)].sort(),
  );

  for (const directive of [
    "proxy_set_header Host $host;",
    "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "proxy_set_header X-Forwarded-Proto $visitor_scheme;",
    "proxy_http_version 1.1;",
    "proxy_set_header Connection $connection_upgrade;",
    "access_log /var/log/nginx/access.log main buffer=64k flush=10s if=$ingest_access_log;",
    "client_max_body_size 4M;",
  ]) {
    assert.ok(directivesOf(opamp).includes(directive), directive);
  }
});

test("the OpAMP location takes every message the App does", () => {
  /*
   * The App answers a message over MAX_OPAMP_MESSAGE_BYTES with its own
   * 413. nginx must let at least that much through, or a supervisor gets
   * nginx's bare 413 page for a message the App would have read.
   */
  const route = readRepositoryFile(
    "packages/App/FeatureSet/Telemetry/API/HostCollectorOpAmp.ts",
  );
  const cap = route.match(
    /export const MAX_OPAMP_MESSAGE_BYTES: number = (\d+) \* (\d+);/,
  );

  assert.ok(
    cap,
    "MAX_OPAMP_MESSAGE_BYTES is no longer a product of two numbers",
  );

  const appLimit = Number(cap[1]) * Number(cap[2]);
  const opamp = primaryLocations.find((location) => {
    return location.spec === OPAMP_LOCATION;
  });
  const size = getDirectives(opamp.body, "client_max_body_size")[0].match(
    /client_max_body_size (\d+)M;/,
  );

  assert.ok(size, "the OpAMP location's body cap is not in megabytes");
  assert.ok(Number(size[1]) * 1024 * 1024 >= appLimit);
});
