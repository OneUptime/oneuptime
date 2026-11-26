"use strict";

/**
 * What the XCP-ng Agent sends, as the real collector sent it.
 *
 * xcp-ng-agent-scrape-behaviour.sh runs the agent's collector exactly as it
 * ships against a stand-in Xen Orchestra and checks, sample for sample,
 * that what reaches OneUptime is what Xen Orchestra served; it needs Docker,
 * so it runs in the Ops workflow. Its export of the first two scrapes is
 * kept as packages/Common/Tests/Server/Utils/Telemetry/Fixtures/XcpNg/
 * AgentOtlpScrape{1,2}.json, which OneUptime's ingest tests read. This
 * suite needs no Docker: it holds the script to how it runs (in the
 * workflow, on the shipped files, with the secret as install.sh writes
 * it), its node half (Utils/XcpNgAgentScrapeBehaviour.js) to how it
 * matches an export to the scrape it came from, and the committed fixtures
 * to the recorded scrape: every served sample of each pool, as served.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");
const behaviour = require("./Utils/XcpNgAgentScrapeBehaviour");
const { POOLS } = require("./Fixtures/XcpNg/XenOrchestraScrape");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = "Tests/Ops/xcp-ng-agent-scrape-behaviour.sh";
const FIXTURES_DIR =
  "packages/Common/Tests/Server/Utils/Telemetry/Fixtures/XcpNg";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function composePin() {
  const compose = yaml.load(read("agents/XcpNgAgent/docker-compose.yml"));
  const image = compose.services["oneuptime-xcp-ng-agent"].image;
  return image.substring(image.lastIndexOf(":") + 1);
}

function stringAttributes(list) {
  const out = {};
  for (const attribute of list || []) {
    out[attribute.key] = attribute.value.stringValue;
  }
  return out;
}

describe("xcp-ng-agent-scrape-behaviour.sh", () => {
  const script = read(SCRIPT);

  test("runs in the Ops workflow after the node image it needs is warmed, held to the fixtures", () => {
    const workflow = read(".github/workflows/test.ops.yaml");
    const run = workflow.indexOf(`- run: bash ${SCRIPT}\n`);
    const nodeImage = script.match(/^NODE_IMAGE="([^"]+)"$/m)[1];
    const warm = workflow.indexOf(`warm_base_images.sh --image ${nodeImage}`);
    expect(run).toBeGreaterThan(-1);
    expect(warm).toBeGreaterThan(-1);
    expect(warm).toBeLessThan(run);
    // Without --write-fixtures, a run fails when the export moves away from them.
    expect(workflow).not.toContain(`${SCRIPT} --write-fixtures`);
  });

  test("runs the shipped files, changing only how often the collector scrapes", () => {
    expect(script).toContain(
      'cp "${AGENT_DIR}/docker-compose.yml" "${WORK_DIR}/docker-compose.yml"',
    );
    expect(script).toContain(
      "sed -e 's/scrape_interval: 60s/scrape_interval: 5s/' -e 's/scrape_timeout: 50s/scrape_timeout: 4s/'",
    );
    // The config's own exporter sends, to a stand-in OneUptime.
    expect(script).toContain("ONEUPTIME_URL='http://oneuptime:4318'");
    // The secret as install.sh writes it (every $ doubled for the collector),
    // and as Xen Orchestra holds it ($$ is Compose's $): a $, and what YAML
    // reads as a list and a map.
    expect(script).toContain("SECRET_FOR_COLLECTOR='[behaviour] s3cr$$et: +1'");
    expect(script).toContain('- "XO_SECRET=[behaviour] s3cr\\$\\$et: +1"');
    // And a name YAML reads as a map, which must arrive as the text it is.
    expect(script).toContain(
      "write_env \"${SECRET_FOR_COLLECTOR}\" 'XO: lab [2026]'",
    );
  });

  test("refuses a wrong secret, a certificate that is not the pinned one, and Xen Orchestra's own", () => {
    for (const line of [
      'collector_says "server returned HTTP status 401 Unauthorized"',
      '"tls: failed to verify certificate: x509: certificate signed by unknown authority"',
      '"x509: certificate is not valid for any names, but wanted to match xo.example.test"',
      "openssl req -batch -new -x509 -days 360 -nodes -newkey rsa:2048 \\",
    ]) {
      expect(script).toContain(line);
    }
  });

  test("passes bash -n", () => {
    const result = spawnSync("bash", ["-n", path.join(REPO_ROOT, SCRIPT)], {
      encoding: "utf8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("Utils/XcpNgAgentScrapeBehaviour.js", () => {
  const served = behaviour.servedScrapes(
    [
      "LISTENING 443",
      "REQUEST GET /openmetrics/metrics 200 served=1 scrape=1 now=1795000000 wall=1795545309791",
      "REQUEST GET /openmetrics/metrics 200 served=2 scrape=2 now=1795000060 wall=1795545314525",
      "REQUEST GET /openmetrics/metrics 200 served=3 scrape=2 now=1795000120 wall=1795545319538 lost-pool",
      "REQUEST GET /openmetrics/health 200 health",
    ].join("\n"),
  );

  test("reads what the stand-in served, and when", () => {
    expect(served).toEqual([
      {
        index: 1,
        scrape: 1,
        nowSeconds: 1795000000,
        rrdSeconds: 1794999900,
        wallMs: 1795545309791,
        lostPool: false,
      },
      {
        index: 2,
        scrape: 2,
        nowSeconds: 1795000060,
        rrdSeconds: 1794999960,
        wallMs: 1795545314525,
        lostPool: false,
      },
      {
        index: 3,
        scrape: 2,
        nowSeconds: 1795000120,
        rrdSeconds: 1795000020,
        wallMs: 1795545319538,
        lostPool: true,
      },
    ]);
  });

  test("expects each pool's xcp_* samples without the pool's labels, and nothing else", () => {
    const expected = behaviour.expectedFor(served[0]);
    expect(Object.keys(expected).sort()).toEqual(
      [POOLS.unnamed.id, POOLS.production.id].sort(),
    );
    expect(expected[POOLS.production.id].poolName).toBe("Production");
    // Xen Orchestra sends the unnamed pool's pool_name="", which Prometheus
    // reads as no label.
    expect(expected[POOLS.unnamed.id].poolName).toBeNull();
    for (const pool of Object.values(expected)) {
      for (const key of pool.samples.keys()) {
        expect(key).toMatch(/^xcp_/);
        expect(key).not.toMatch(/pool_id=|pool_name=/);
        expect(key).not.toMatch(/^xcp_host_power_consumption_watts/);
      }
    }
    // The lost pool is not served at all.
    expect(Object.keys(behaviour.expectedFor(served[2]))).toEqual([
      POOLS.production.id,
    ]);
  });

  test("matches a resource to its scrape by the times Xen Orchestra served, or by when it was asked", () => {
    const resource = (times) => {
      return {
        resourceMetrics: {
          resource: { attributes: [] },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "xcp_any",
                  gauge: {
                    dataPoints: times.map((time) => {
                      return { timeUnixNano: time };
                    }),
                  },
                },
              ],
            },
          ],
        },
      };
    };
    // The RRD minute of scrape 2.
    expect(
      behaviour.attribute(resource(["1794999960000000000"]), served).index,
    ).toBe(2);
    // The second scrape 3 was served at.
    expect(
      behaviour.attribute(resource(["1795000120000000000"]), served).index,
    ).toBe(3);
    // Only the collector's own clock: the scrape asked nearest then.
    expect(
      behaviour.attribute(resource(["1795545319530000000"]), served).index,
    ).toBe(3);
  });
});

describe("the recorded export, against the recorded scrape", () => {
  test.each([
    [1, 1795000000],
    [2, 1795000060],
  ])(
    "AgentOtlpScrape%i.json: every served sample of each pool, as served, and nothing else",
    (index, nowSeconds) => {
      const exported = JSON.parse(
        read(`${FIXTURES_DIR}/AgentOtlpScrape${index}.json`),
      );
      const expected = behaviour.expectedFor({
        scrape: index,
        nowSeconds,
        lostPool: false,
      });
      expect(exported.resourceMetrics).toHaveLength(2);
      for (const resourceMetrics of exported.resourceMetrics) {
        const attrs = stringAttributes(resourceMetrics.resource.attributes);
        expect(Object.keys(attrs).sort()).toEqual(
          [
            "oneuptime.agent.version",
            "server.address",
            "server.port",
            "url.scheme",
            "xcp_ng.pool.id",
            ...(attrs["xcp_ng.pool.name"] ? ["xcp_ng.pool.name"] : []),
            "xen_orchestra.name",
          ].sort(),
        );
        expect(attrs["oneuptime.agent.version"]).toBe(composePin());
        const pool = expected[attrs["xcp_ng.pool.id"]];
        expect(pool).toBeDefined();
        expect(attrs["xcp_ng.pool.name"] || null).toBe(pool.poolName);
        const missing = new Map(pool.samples);
        for (const scopeMetrics of resourceMetrics.scopeMetrics) {
          for (const metric of scopeMetrics.metrics) {
            // All gauges: the eight rate series typed counter too.
            expect({ name: metric.name, sum: metric.sum }).toEqual({
              name: metric.name,
              sum: undefined,
            });
            for (const datapoint of metric.gauge.dataPoints) {
              const labels = stringAttributes(datapoint.attributes);
              const key = `${metric.name}{${Object.keys(labels)
                .sort()
                .map((name) => {
                  return `${name}=${labels[name]}`;
                })
                .join(",")}}`;
              const sample = missing.get(key);
              expect({ key, served: Boolean(sample) }).toEqual({
                key,
                served: true,
              });
              missing.delete(key);
              const value =
                datapoint.asDouble !== undefined
                  ? Number(datapoint.asDouble)
                  : Number(datapoint.asInt);
              expect({ key, value }).toEqual({ key, value: sample.value });
              // xcp_pool_connected, served without a time, normalized to the
              // second the scrape was served.
              expect({ key, time: datapoint.timeUnixNano }).toEqual({
                key,
                time: `${sample.seconds === null ? nowSeconds : sample.seconds}000000000`,
              });
              expect(datapoint.startTimeUnixNano).toBeUndefined();
              expect(datapoint.flags).toBeUndefined();
            }
          }
        }
        expect([...missing.keys()]).toEqual([]);
      }
    },
  );

  test("the files are as the behaviour test writes them: normalized, one value a line", () => {
    for (const [index, nowSeconds] of [
      [1, 1795000000],
      [2, 1795000060],
    ]) {
      const text = read(`${FIXTURES_DIR}/AgentOtlpScrape${index}.json`);
      const parsed = JSON.parse(text);
      expect(`${JSON.stringify(parsed, null, 1).replace(/^ +/gm, "")}\n`).toBe(
        text,
      );
      // Normalizing the recorded export again changes nothing.
      expect(
        behaviour.normalizeForFixture(
          parsed.resourceMetrics.map((resourceMetrics) => {
            return { resourceMetrics };
          }),
          { index, scrape: index, nowSeconds },
        ),
      ).toEqual(parsed);
    }
    expect(read(`${FIXTURES_DIR}/README.md`)).toContain(
      `bash ${SCRIPT} --write-fixtures`,
    );
  });
});
