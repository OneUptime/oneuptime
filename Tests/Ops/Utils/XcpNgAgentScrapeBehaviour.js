"use strict";

/**
 * The node half of xcp-ng-agent-scrape-behaviour.sh: it reads what the
 * XCP-ng Agent's collector sent (the OTLP JSON lines an OTLP sink wrote) and
 * what the stand-in Xen Orchestra served (its log), and checks one against
 * the other. Kept out of the shell script so it is plain JavaScript.
 *
 *   check <metrics.json> <fake-xo.log> <relay.log> <agent version> <fixtures dir> [--write-fixtures]
 *
 * Every exported resource is matched to the scrape it came from: by the
 * timestamps Xen Orchestra served (each scrape on a clock of its own, 60
 * seconds apart), or - for a resource holding only xcp_pool_connected, which
 * Xen Orchestra serves without a timestamp, so the collector stamps it with
 * the moment it scraped - by the moment the stand-in was asked.
 *
 * Then, for scrapes 1 to 3 (scrape 3 is scrape 2 with the unnamed pool
 * lost), every exported datapoint must be a served xcp_* sample of a pool,
 * with the same name, labels, value and time, and every such sample must be
 * exported - nothing more, nothing less. And the export's shape: one
 * resource per pool, its identity on the resource, nothing that is not
 * xcp_*, no resource without a pool, the eight rate series as gauges with
 * the values served (which go down between scrapes 1 and 2), and the one
 * staleness marker the collector sends: for xcp_pool_connected of the pool
 * Xen Orchestra lost.
 *
 * With --write-fixtures it writes scrapes 1 and 2 as AgentOtlpScrape1.json
 * and AgentOtlpScrape2.json (normalized as the fixtures' README says);
 * without it, it holds this run to those files when they exist.
 *
 * Exits non-zero, saying why, when a check fails.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildXenOrchestraScrape,
  POOLS,
  RATE_TYPED_AS_COUNTER,
} = require("../Fixtures/XcpNg/XenOrchestraScrape");
const { withoutUnnamedPool } = require("./FakeXenOrchestra");

const POOL_ID = "xcp_ng.pool.id";
const POOL_NAME = "xcp_ng.pool.name";
const XO_NAME = "xen_orchestra.name";
const AGENT_VERSION = "oneuptime.agent.version";
const NO_TIMESTAMP_SERIES = "xcp_pool_connected";
// The resource attributes the receiver itself adds, kept as Proxmox keeps them.
const RECEIVER_ATTRIBUTES = ["server.address", "server.port", "url.scheme"];

let failures = 0;

function ok(message) {
  process.stdout.write(`ok: ${message}\n`);
}

function failed(message) {
  process.stdout.write(`FAILED: ${message}\n`);
  failures++;
}

function check(condition, message) {
  if (condition) {
    ok(message);
  } else {
    failed(message);
  }
  return condition;
}

function attributes(list) {
  const out = {};
  for (const attribute of list || []) {
    const value = attribute.value || {};
    const [kind] = Object.keys(value);
    out[attribute.key] = kind === undefined ? null : value[kind];
  }
  return out;
}

// The served scrapes, from the stand-in's log lines.
function servedScrapes(logText) {
  const served = [];
  for (const line of logText.split("\n")) {
    const match =
      /served=(\d+) scrape=(\d+) now=(\d+) wall=(\d+)( lost-pool)?/.exec(line);
    if (match) {
      const nowSeconds = Number(match[3]);
      served.push({
        index: Number(match[1]),
        scrape: Number(match[2]),
        nowSeconds,
        rrdSeconds: Math.floor(nowSeconds / 60) * 60 - 60,
        wallMs: Number(match[4]),
        lostPool: Boolean(match[5]),
      });
    }
  }
  return served;
}

// Every resource the sink received, in order, with where it was.
function exportedResources(metricsText) {
  const resources = [];
  metricsText
    .split("\n")
    .filter(Boolean)
    .forEach((line, lineIndex) => {
      const request = JSON.parse(line);
      for (const resourceMetrics of request.resourceMetrics || []) {
        resources.push({ lineIndex, resourceMetrics });
      }
    });
  return resources;
}

function points(resourceMetrics) {
  const out = [];
  for (const scopeMetrics of resourceMetrics.scopeMetrics || []) {
    for (const metric of scopeMetrics.metrics || []) {
      const kind = ["gauge", "sum", "histogram", "summary"].find((key) => {
        return metric[key];
      });
      for (const datapoint of metric[kind].dataPoints || []) {
        out.push({ metric, kind, datapoint });
      }
    }
  }
  return out;
}

// The scrape a resource came from.
function attribute(resource, served) {
  const times = points(resource.resourceMetrics).map((point) => {
    return BigInt(point.datapoint.timeUnixNano);
  });
  for (const scrape of served) {
    const now = BigInt(scrape.nowSeconds) * 1000000000n;
    const rrd = BigInt(scrape.rrdSeconds) * 1000000000n;
    if (
      times.some((time) => {
        return time === now || time === rrd;
      })
    ) {
      return scrape;
    }
  }
  // Only series the collector stamped itself: the scrape asked nearest then.
  let nearest = null;
  for (const scrape of served) {
    const distance = Math.abs(Number(times[0] / 1000000n) - scrape.wallMs);
    if (!nearest || distance < nearest.distance) {
      nearest = { scrape, distance };
    }
  }
  return nearest ? nearest.scrape : null;
}

// One sample of an OpenMetrics body: name, labels, value, time.
function parseSamples(body) {
  return body
    .split("\n")
    .filter((line) => {
      return line && !line.startsWith("#");
    })
    .map((line) => {
      const match =
        /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})? (\S+)(?: (\S+))?$/.exec(line);
      const labels = {};
      for (const pair of (match[2] || "").matchAll(
        /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g,
      )) {
        // Prometheus drops a label with an empty value.
        if (pair[2] !== "") {
          labels[pair[1]] = pair[2].replace(/\\(.)/g, (whole, escaped) => {
            return escaped === "n" ? "\n" : escaped;
          });
        }
      }
      return {
        name: match[1],
        labels,
        value: Number(match[3]),
        seconds: match[4] === undefined ? null : Number(match[4]),
      };
    });
}

function sampleKey(name, labels) {
  const sorted = Object.keys(labels)
    .sort()
    .map((key) => {
      return `${key}=${labels[key]}`;
    });
  return `${name}{${sorted.join(",")}}`;
}

// What the agent must send of one served scrape, by pool and series.
function expectedFor(scrape) {
  let body = buildXenOrchestraScrape({
    scrape: scrape.scrape,
    nowSeconds: scrape.nowSeconds,
  });
  if (scrape.lostPool) {
    body = withoutUnnamedPool(body);
  }
  const byPool = {};
  for (const sample of parseSamples(body)) {
    if (!sample.name.startsWith("xcp_") || !sample.labels.pool_id) {
      continue;
    }
    const { pool_id: poolId, pool_name: poolName, ...rest } = sample.labels;
    byPool[poolId] = byPool[poolId] || {
      poolName: poolName || null,
      samples: new Map(),
    };
    byPool[poolId].samples.set(sampleKey(sample.name, rest), sample);
  }
  return byPool;
}

function datapointValue(datapoint) {
  if (datapoint.asDouble !== undefined) {
    return Number(datapoint.asDouble);
  }
  if (datapoint.asInt !== undefined) {
    return Number(datapoint.asInt);
  }
  return undefined;
}

function byKey(left, right) {
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

function attributesKey(list) {
  return JSON.stringify(
    [...(list || [])].sort(byKey).map((attribute) => {
      return [attribute.key, attribute.value];
    }),
  );
}

/*
 * One scrape's export as the fixtures keep it. Only two things change from
 * run to run, so only they are normalized: xcp_pool_connected's time (Xen
 * Orchestra serves it without one, so the collector stamps the moment it
 * scraped; the second the stand-in served the scrape is used instead), and
 * the order of resources, metrics, datapoints and attributes (the collector
 * builds them through maps; OTLP gives their order no meaning) - sorted by
 * pool, name, attributes and key.
 */
function normalizeForFixture(exported, scrape) {
  const resourceMetrics = exported.map((resource) => {
    const copy = JSON.parse(JSON.stringify(resource.resourceMetrics));
    copy.resource.attributes.sort(byKey);
    for (const scopeMetrics of copy.scopeMetrics || []) {
      scopeMetrics.metrics.sort((left, right) => {
        return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
      });
      for (const metric of scopeMetrics.metrics) {
        const kind = metric.gauge ? "gauge" : "sum";
        for (const datapoint of metric[kind].dataPoints) {
          (datapoint.attributes || []).sort(byKey);
          if (metric.name === NO_TIMESTAMP_SERIES) {
            datapoint.timeUnixNano = `${scrape.nowSeconds}000000000`;
          }
        }
        metric[kind].dataPoints.sort((left, right) => {
          const a = attributesKey(left.attributes);
          const b = attributesKey(right.attributes);
          return a < b ? -1 : a > b ? 1 : 0;
        });
      }
    }
    return copy;
  });
  resourceMetrics.sort((left, right) => {
    const a = attributes(left.resource.attributes)[POOL_ID];
    const b = attributes(right.resource.attributes)[POOL_ID];
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { resourceMetrics };
}

function checkResourceShape(resource, agentVersion) {
  const attrs = attributes(resource.resourceMetrics.resource.attributes);
  const poolId = attrs[POOL_ID];
  const label = `resource ${poolId || "(no pool)"}`;
  const expectedKeys = [
    POOL_ID,
    ...(attrs[POOL_NAME] !== undefined ? [POOL_NAME] : []),
    XO_NAME,
    AGENT_VERSION,
    ...RECEIVER_ATTRIBUTES,
  ].sort();
  const keysOk =
    JSON.stringify(Object.keys(attrs).sort()) === JSON.stringify(expectedKeys);
  if (!keysOk) {
    failed(
      `${label} carries exactly the pool, XO and agent attributes (has ${Object.keys(attrs).sort().join(", ")})`,
    );
  }
  if (attrs[XO_NAME] !== "xo-behaviour") {
    failed(`${label}: xen_orchestra.name is XO_NAME (got ${attrs[XO_NAME]})`);
  }
  if (attrs[AGENT_VERSION] !== agentVersion) {
    failed(
      `${label}: oneuptime.agent.version is ${agentVersion} (got ${attrs[AGENT_VERSION]})`,
    );
  }
  return { attrs, poolId };
}

function main() {
  const [
    command,
    metricsFile,
    fakeLogFile,
    relayLogFile,
    agentVersion,
    fixturesDir,
    flag,
  ] = process.argv.slice(2);
  if (command !== "check") {
    throw new Error(`unknown command ${command}`);
  }
  const served = servedScrapes(fs.readFileSync(fakeLogFile, "utf8"));
  const resources = exportedResources(
    fs.existsSync(metricsFile) ? fs.readFileSync(metricsFile, "utf8") : "",
  );

  check(
    served.length >= 3,
    `the stand-in served at least three scrapes (${served.length})`,
  );
  check(
    resources.length > 0,
    `the sink received resources (${resources.length})`,
  );

  // ---- the relay saw what the exporter sends OneUptime
  const posts = fs
    .readFileSync(relayLogFile, "utf8")
    .split("\n")
    .filter((line) => {
      return line.startsWith("OTLP ");
    });
  check(
    posts.length > 0 &&
      posts.every((line) => {
        return (
          line === "OTLP POST /otlp/v1/metrics token=behaviour-ingestion-key"
        );
      }),
    `every export is a POST to <ONEUPTIME_URL>/otlp/v1/metrics with the ingestion key (${posts.length})`,
  );

  // ---- the whole export's shape
  const names = new Set();
  let withoutPool = 0;
  let sums = 0;
  let startTimes = 0;
  for (const resource of resources) {
    const { poolId } = checkResourceShape(resource, agentVersion);
    if (!poolId) {
      withoutPool++;
    }
    for (const point of points(resource.resourceMetrics)) {
      names.add(point.metric.name);
      if (point.kind !== "gauge") {
        sums++;
      }
      if (
        point.datapoint.startTimeUnixNano !== undefined &&
        point.datapoint.startTimeUnixNano !== "0"
      ) {
        startTimes++;
      }
    }
  }
  check(
    withoutPool === 0,
    "no resource without xcp_ng.pool.id (the IPMI host power is dropped)",
  );
  const notXcp = [...names].filter((name) => {
    return !name.startsWith("xcp_");
  });
  check(
    notXcp.length === 0,
    `nothing but xcp_* series (no xo_*, no up / scrape_*): ${notXcp.join(", ") || "none"}`,
  );
  check(
    !names.has("xcp_host_power_consumption_watts"),
    "no xcp_host_power_consumption_watts (it has no pool)",
  );
  check(
    sums === 0,
    "every series is a gauge: the eight Xen Orchestra types counter arrive as gauges",
  );
  check(
    startTimes === 0,
    "no datapoint carries a start time: nothing was read as a cumulative counter",
  );
  for (const name of RATE_TYPED_AS_COUNTER) {
    check(names.has(name), `${name} is sent`);
  }

  // ---- each scrape, sample for sample
  const byScrape = new Map();
  for (const resource of resources) {
    const scrape = attribute(resource, served);
    if (!scrape) {
      failed("a resource that matches no served scrape");
      continue;
    }
    if (!byScrape.has(scrape.index)) {
      byScrape.set(scrape.index, []);
    }
    byScrape.get(scrape.index).push(resource);
  }

  const fixtures = {};
  for (const scrape of served.filter((candidate) => {
    return candidate.index <= 3;
  })) {
    const exported = byScrape.get(scrape.index) || [];
    const expected = expectedFor(scrape);
    const label = `scrape ${scrape.index}${scrape.lostPool ? " (the unnamed pool lost)" : ""}`;
    const poolIds = exported.map((resource) => {
      return attributes(resource.resourceMetrics.resource.attributes)[POOL_ID];
    });
    const expectedPools = scrape.lostPool
      ? [POOLS.production.id, POOLS.unnamed.id]
      : Object.keys(expected);
    check(
      poolIds.length === expectedPools.length &&
        [...poolIds].sort().join() === [...expectedPools].sort().join(),
      `${label}: one OTLP resource per pool (${poolIds.join(", ")})`,
    );

    for (const resource of exported) {
      const attrs = attributes(resource.resourceMetrics.resource.attributes);
      const poolId = attrs[POOL_ID];
      if (scrape.lostPool && poolId === POOLS.unnamed.id) {
        const stale = points(resource.resourceMetrics);
        check(
          stale.length === 1 &&
            stale[0].metric.name === NO_TIMESTAMP_SERIES &&
            stale[0].datapoint.flags === 1 &&
            datapointValue(stale[0].datapoint) === undefined,
          `${label}: the lost pool arrives once more, as one xcp_pool_connected staleness marker (flags 1, no value)`,
        );
        continue;
      }
      const pool = expected[poolId];
      if (!pool) {
        failed(
          `${label}: a resource for a pool that was not served: ${poolId}`,
        );
        continue;
      }
      const poolLabel = `${label}, pool ${pool.poolName || "(unnamed)"}`;
      check(
        (attrs[POOL_NAME] || null) === pool.poolName,
        `${poolLabel}: xcp_ng.pool.name is pool_name (${attrs[POOL_NAME] === undefined ? "absent, as XO sends it empty" : attrs[POOL_NAME]})`,
      );
      const missing = new Map(pool.samples);
      let mismatched = 0;
      let unexpected = 0;
      let flagged = 0;
      for (const point of points(resource.resourceMetrics)) {
        const key = sampleKey(
          point.metric.name,
          attributes(point.datapoint.attributes),
        );
        const sample = missing.get(key);
        if (!sample) {
          unexpected++;
          if (unexpected <= 3) {
            failed(`${poolLabel}: exported but not served: ${key}`);
          }
          continue;
        }
        missing.delete(key);
        if (point.datapoint.flags) {
          flagged++;
        }
        const time = BigInt(point.datapoint.timeUnixNano);
        let timeOk;
        if (sample.seconds === null) {
          // Served without a timestamp: the collector's scrape time.
          timeOk = Math.abs(Number(time / 1000000n) - scrape.wallMs) < 5000;
        } else {
          timeOk = time === BigInt(sample.seconds) * 1000000000n;
        }
        if (datapointValue(point.datapoint) !== sample.value || !timeOk) {
          mismatched++;
          if (mismatched <= 3) {
            failed(
              `${poolLabel}: ${key} served ${sample.value} at ${sample.seconds}, exported ${datapointValue(point.datapoint)} at ${point.datapoint.timeUnixNano}`,
            );
          }
        }
      }
      check(
        missing.size === 0,
        `${poolLabel}: every served sample of the pool is exported (${pool.samples.size}, missing ${missing.size}${missing.size ? `: ${[...missing.keys()].slice(0, 3).join("; ")}` : ""})`,
      );
      check(
        unexpected === 0,
        `${poolLabel}: nothing exported that was not served`,
      );
      check(
        mismatched === 0,
        `${poolLabel}: every value as served, every time the second Xen Orchestra served (the collector's own scrape time for xcp_pool_connected)`,
      );
      check(
        flagged === 0,
        `${poolLabel}: no staleness flag on any served sample`,
      );
    }

    if (scrape.index <= 2) {
      fixtures[scrape.index] = normalizeForFixture(exported, scrape);
    }
  }

  // ---- the trap: rates that went down between scrapes 1 and 2, sent as served
  const traps = (index) => {
    const values = {};
    for (const resource of byScrape.get(index) || []) {
      for (const point of points(resource.resourceMetrics)) {
        if (RATE_TYPED_AS_COUNTER.includes(point.metric.name)) {
          const key = sampleKey(
            point.metric.name,
            attributes(point.datapoint.attributes),
          );
          values[key] = {
            kind: point.kind,
            value: datapointValue(point.datapoint),
          };
        }
      }
    }
    return values;
  };
  const first = traps(1);
  const second = traps(2);
  const wentDown = Object.keys(first).filter((key) => {
    return second[key] && second[key].value < first[key].value;
  });
  check(
    wentDown.length >= 8,
    `rate series whose value went DOWN from scrape 1 to scrape 2 are sent as served, as gauges, not as counter resets (${wentDown.length}, e.g. ${wentDown[0]}: ${first[wentDown[0]] && first[wentDown[0]].value} then ${second[wentDown[0]] && second[wentDown[0]].value})`,
  );

  // ---- the fixtures
  if (fixturesDir) {
    for (const index of [1, 2]) {
      const file = path.join(fixturesDir, `AgentOtlpScrape${index}.json`);
      // One value a line, unindented, as the OpenStack agent's OTLP fixtures:
      // a change reads as a diff, at a fraction of an indented file's size.
      const text = `${JSON.stringify(fixtures[index], null, 1).replace(/^ +/gm, "")}\n`;
      if (flag === "--write-fixtures") {
        fs.writeFileSync(file, text);
        ok(`wrote ${file}`);
      } else if (fs.existsSync(file)) {
        const committed = fs.readFileSync(file, "utf8");
        if (
          !check(
            committed === text,
            `scrape ${index}'s export is ${path.basename(file)} exactly (run with --write-fixtures after a deliberate change)`,
          )
        ) {
          const actual = path.join(
            os.tmpdir(),
            `AgentOtlpScrape${index}.actual.json`,
          );
          fs.writeFileSync(actual, text);
          const committedLines = committed.split("\n");
          const lines = text.split("\n");
          const at = lines.findIndex((line, lineIndex) => {
            return line !== committedLines[lineIndex];
          });
          failed(
            `this run's export is ${actual}; it first differs at line ${at + 1}: ${JSON.stringify(committedLines[at])} != ${JSON.stringify(lines[at])}`,
          );
        }
      }
    }
  }

  if (failures > 0) {
    process.stdout.write(`${failures} check(s) failed\n`);
    process.exit(1);
  }
}

module.exports = {
  attribute,
  exportedResources,
  expectedFor,
  normalizeForFixture,
  parseSamples,
  servedScrapes,
};

if (require.main === module) {
  main();
}
