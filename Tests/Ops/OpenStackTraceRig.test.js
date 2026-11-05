"use strict";

/**
 * The tools Tests/Ops/openstack-e2e/traces-record.sh leans on, without a cloud. A scene that
 * proves nothing because its patch quietly did not apply is the failure to guard against, and a
 * run takes an hour to say so.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const RIG = path.resolve(__dirname, "openstack-e2e");
const CONFIGURE = path.join(RIG, "logs-configure.py");
const READ = path.join(RIG, "traces-read.py");
const RECORD = path.join(RIG, "traces-record.sh");
const IMPORT = path.join(RIG, "import-trace-recording.py");

let folder;

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "ou-trace-rig-"));
});

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

function python(script, args, env = {}) {
  return spawnSync("python3", ["-I", script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function write(name, text) {
  const file = path.join(folder, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// What the driver's file exporter writes, one export per line.
function exportLine(serviceName, scope, spans) {
  return JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
          ],
        },
        scopeSpans: [{ scope: { name: scope }, spans: spans }],
      },
    ],
  });
}

function span(traceId, values = {}) {
  return {
    traceId: traceId,
    spanId: "b82e0a6a55e3def6",
    parentSpanId: traceId.slice(16),
    name: "WSGI_GET_/x",
    kind: 2,
    startTimeUnixNano: "1793826131009830108",
    endTimeUnixNano: "1793826131011140418",
    attributes: [],
    ...values,
  };
}

const NOVA_PASTE = `[composite:openstack_compute_api_v21]
use = call:nova.api.auth:pipeline_factory_v21
keystone = cors http_proxy_to_wsgi compute_req_id faultwrap request_log sizelimit osprofiler authtoken keystonecontext osapi_compute_app_v21

[pipeline:oscomputeversions]
pipeline = cors faultwrap request_log http_proxy_to_wsgi oscomputeversionapp

[filter:osprofiler]
paste.filter_factory = nova.profiler:WsgiMiddleware.factory
`;

describe("putting oslo.middleware's tracing filter into a pipeline", () => {
  test("goes just before osprofiler, in the pipelines that have it, and defines the filter", () => {
    const file = write("api-paste.ini", NOVA_PASTE);
    const result = python(CONFIGURE, ["paste-otel", file]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("1");

    const text = fs.readFileSync(file, "utf8");

    expect(text).toContain(
      "sizelimit otel_tracing osprofiler authtoken keystonecontext osapi_compute_app_v21",
    );
    expect(text).toContain(
      "pipeline = cors faultwrap request_log http_proxy_to_wsgi oscomputeversionapp\n",
    );
    expect(text).toContain("[filter:otel_tracing]");
    expect(text).toContain(
      "paste.filter_factory = oslo_middleware:TracingMiddleware.factory",
    );
  });

  test("twice is once", () => {
    const file = write("api-paste.ini", NOVA_PASTE);

    python(CONFIGURE, ["paste-otel", file]);

    const once = fs.readFileSync(file, "utf8");
    const result = python(CONFIGURE, ["paste-otel", file]);

    expect(result.stdout.trim()).toBe("0");
    expect(fs.readFileSync(file, "utf8")).toBe(once);
  });

  test("a release whose pipelines already name it keeps what it has", () => {
    const file = write(
      "api-paste.ini",
      NOVA_PASTE.replace("sizelimit osprofiler", "sizelimit otel_tracing osprofiler"),
    );
    const result = python(CONFIGURE, ["paste-otel", file]);

    expect(result.stdout.trim()).toBe("0");
    expect(fs.readFileSync(file, "utf8")).not.toContain("[filter:otel_tracing]");
  });
});

describe("adding lines to a source file", () => {
  test("after the line that says so, with the indentation it was given", () => {
    const file = write(
      "opts.py",
      "def set_defaults(conf):\n    conf.register_opts(_PROFILER_OPTS, group=_profiler_opt_group)\n    other()\n",
    );
    const result = python(CONFIGURE, [
      "insert-after",
      file,
      "conf.register_opts(_PROFILER_OPTS, group=_profiler_opt_group)",
      "    one()",
      "    two()",
    ]);

    expect(result.status).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(
      "def set_defaults(conf):\n    conf.register_opts(_PROFILER_OPTS, group=_profiler_opt_group)\n    one()\n    two()\n    other()\n",
    );
  });

  test("a patch that no longer applies is an error, and changes nothing", () => {
    const file = write("opts.py", "def set_defaults(conf):\n    pass\n");
    const result = python(CONFIGURE, [
      "insert-after",
      file,
      "this line is not here",
      "    one()",
    ]);

    expect(result.status).not.toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(
      "def set_defaults(conf):\n    pass\n",
    );
  });
});

describe("Placement's one line", () => {
  const COMMAND = /sudo (sed -i '[^']+') "\$PLACEMENT_WSGI"/;

  // sed's own quirks are the point, so this runs the very command the rig runs.
  test("lands where Placement's profiler options are set, indented to fit", () => {
    const sed = spawnSync("sed", ["--version"], { encoding: "utf8" });

    if (sed.status !== 0) {
      // BSD sed reads `-i` and `a\` differently, and the rig is Linux.
      return;
    }

    const match = fs.readFileSync(RECORD, "utf8").match(COMMAND);

    expect(match).not.toBeNull();

    const file = write(
      "wsgi.py",
      "def _parse_args(config, argv, default_config_files):\n    conf.register_opts(config)\n\n    if profiler:\n        profiler.set_defaults(config)\n\n    _set_middleware_defaults()\n",
    );
    const result = spawnSync("bash", ["-c", `${match[1]} "${file}"`], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toContain(
      '        profiler.set_defaults(config)\n        config.register_opts(profiler._OTLP_OPTS, group="profiler_otlp")\n\n',
    );
  });
});

describe("signing by hand", () => {
  test("is what OpenStackTraceSigning.ts writes, byte for byte", () => {
    const result = python(READ, ["sign", "4e3e0ec6-2938-40b1-8504-09eb1d4b0dee"], {
      OU_TRACES_KEY: "sekret",
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(
      "eyJiYXNlX2lkIjoiNGUzZTBlYzYtMjkzOC00MGIxLTg1MDQtMDllYjFkNGIwZGVlIiwicGFyZW50X2lkIjoiNGUzZTBlYzYtMjkzOC00MGIxLTg1MDQtMDllYjFkNGIwZGVlIn0= 9478501588ee443de42ca9e1a9c1cd154bb35fbe",
    );
  });

  test("with no key it says so", () => {
    const result = python(READ, ["sign", "x"], { OU_TRACES_KEY: "" });

    expect(result.status).toBe(1);
  });
});

describe("what a run is held to", () => {
  const TRACE = "302f30b374c24a1c8a6438124ca5e121";
  const PRINTED = "302f30b3-74c2-4a1c-8a64-38124ca5e121";
  const INSTANCE = "0d9fe1d3-260e-4a6e-ae9e-685e1c5a6ba9";
  const STOCK = [
    "nova-osapi_compute",
    "nova-nova-compute",
    "neutron-neutron-server",
    "keystone-public",
    "glance-api",
  ];

  function recording(services, scenes = {}) {
    const lines = services.map((service) => {
      return exportLine(service, "osprofiler.drivers.otlp", [
        span(TRACE, {
          attributes: [
            {
              key: "http.path",
              value: { stringValue: `/compute/v2.1/servers/${INSTANCE}` },
            },
          ],
        }),
      ]);
    });

    for (const [, value] of Object.entries(scenes)) {
      for (const service of value.services) {
        lines.push(
          exportLine(service, "osprofiler.drivers.otlp", [
            span(value.trace, {}),
          ]),
        );
      }
    }

    write("otlp-driver.json", `${lines.join("\n")}\n`);
    write("ids.env", `instance_booted=${INSTANCE}\n`);
    write(
      "scenes.jsonl",
      [
        JSON.stringify({
          scene: "signed-boot",
          startedAt: "2026-11-04T21:02:10Z",
          endedAt: "2026-11-04T21:02:28Z",
          exitCode: 0,
          traceIds: [PRINTED],
          spansMade: 5,
        }),
        ...Object.entries(scenes).map(([name, value]) => {
          return JSON.stringify({
            scene: name,
            startedAt: "2026-11-04T21:03:10Z",
            endedAt: "2026-11-04T21:03:28Z",
            exitCode: value.exitCode || 0,
            traceIds: [value.trace],
            spansMade: value.services.length,
          });
        }),
      ].join("\n") + "\n",
    );
  }

  function check() {
    const result = python(READ, ["check", folder]);

    return {
      status: result.status,
      text: fs.readFileSync(path.join(folder, "check.txt"), "utf8"),
    };
  }

  test("a stock boot across what a stock cloud sends holds", () => {
    recording(STOCK);

    expect(check()).toEqual({ status: 0, text: "Everything held.\n" });
  });

  test("a service that goes quiet fails it, and says which", () => {
    recording(STOCK.filter((service) => service !== "neutron-neutron-server"));

    const { status, text } = check();

    expect(status).toBe(1);
    expect(text).toContain("neutron-neutron-server");
  });

  test("Placement sending spans as shipped fails it, because the guide then says something untrue", () => {
    recording([...STOCK, "placement-placement"]);

    const { status, text } = check();

    expect(status).toBe(1);
    expect(text).toContain("guide's line about it is out of date");
  });

  test("the patched scene has to show Placement, once it ran", () => {
    const other = "aaaaaaaabbbbbbbbccccccccdddddddd";

    recording(STOCK, {
      "signed-boot-placement": { trace: other, services: ["nova-nova-compute"] },
    });

    const { status, text } = check();

    expect(status).toBe(1);
    expect(text).toContain("signed-boot-placement");
    expect(text).toContain("placement-placement");
  });

  test("one worker each has to show the conductor and the scheduler, once it ran", () => {
    const other = "aaaaaaaabbbbbbbbccccccccdddddddd";

    recording(STOCK, {
      "signed-boot-whole": {
        trace: other,
        services: ["placement-placement", "nova-nova-conductor"],
      },
    });

    const { status, text } = check();

    expect(status).toBe(1);
    expect(text).toContain("nova-nova-scheduler");
    expect(text).not.toContain("nova-nova-conductor span");
  });

  test("a scene a release did not run is held to nothing", () => {
    recording(STOCK);

    expect(check().text).not.toContain("signed-boot-whole");
  });
});

describe("what the scenes with nothing signed made", () => {
  test("is read by their moments, by scope, with request IDs and ids out of the names", () => {
    const at = BigInt(Date.parse("2026-11-04T21:03:15Z")) * 1000000n;

    write(
      "otlp-driver.json",
      `${[
        exportLine("nova", "oslo.messaging", [
          span("a".repeat(32), {
            name: "conductor.schedule_and_build_instances",
            kind: 4,
            startTimeUnixNano: at.toString(),
            endTimeUnixNano: at.toString(),
            attributes: [
              {
                key: "openstack.request_id",
                value: { stringValue: "req-c4382fa8" },
              },
            ],
          }),
        ]),
        exportLine("nova-api", "oslo_middleware.tracing", [
          span("a".repeat(32), {
            name: "HTTP GET /v2.1/servers/0d9fe1d3-260e-4a6e-ae9e-685e1c5a6ba9",
            startTimeUnixNano: at.toString(),
            endTimeUnixNano: at.toString(),
          }),
        ]),
        // Before the scene began, so not its.
        exportLine("nova", "oslo.messaging", [
          span("b".repeat(32), {
            name: "earlier",
            startTimeUnixNano: "1000",
            endTimeUnixNano: "1000",
          }),
        ]),
      ].join("\n")}\n`,
    );
    write(
      "scenes.jsonl",
      `${JSON.stringify({
        scene: "native-both-boot",
        startedAt: "2026-11-04T21:03:10Z",
        endedAt: "2026-11-04T21:03:28Z",
        exitCode: 0,
        seconds: 18,
        traceIds: [],
        spansMade: 2,
      })}\n${JSON.stringify({
        scene: "signed-boot",
        startedAt: "2026-11-04T21:02:10Z",
        endedAt: "2026-11-04T21:02:28Z",
        exitCode: 0,
        traceIds: [],
      })}\n`,
    );

    expect(python(READ, ["native", folder]).status).toBe(0);

    const summary = JSON.parse(
      fs.readFileSync(path.join(folder, "native-summary.json"), "utf8"),
    );

    expect(Object.keys(summary)).toEqual(["native-both-boot"]);
    expect(summary["native-both-boot"].spans).toBe(2);
    expect(summary["native-both-boot"].spansByScope).toEqual({
      "oslo.messaging": 1,
      "oslo_middleware.tracing": 1,
    });
    expect(summary["native-both-boot"].tracesAcrossServices).toBe(1);
    expect(summary["native-both-boot"].requestIdsOnSpans).toEqual([
      "req-c4382fa8",
    ]);
    expect(Object.keys(summary["native-both-boot"].names)).toContain(
      "oslo_middleware.tracing | nova-api | 2 | HTTP GET /v2.1/servers/{id}",
    );
  });
});

describe("the scenes", () => {
  const script = fs.readFileSync(RECORD, "utf8");

  test("the script is valid", () => {
    const result = spawnSync("bash", ["-n", RECORD], { encoding: "utf8" });

    expect(result.status).toBe(0);
  });

  test("everything the importer keeps is a scene the script runs", () => {
    const importer = fs.readFileSync(IMPORT, "utf8");
    const names = new Set();

    for (const block of [
      importer.match(/WHOLE_SCENES = \(([\s\S]*?)\n\)/)[1],
      importer.match(/SAMPLED_SCENES = \{([^}]*)\}/)[1],
      importer.match(/NATIVE_SCENES = \{([\s\S]*?)\n\}/)[1],
    ]) {
      for (const match of block.matchAll(/"([a-z-]+)"/g)) {
        names.add(match[1]);
      }
    }

    expect(names.size).toBeGreaterThan(10);

    for (const name of names) {
      expect(script).toMatch(new RegExp(`scene ${name} `));
    }
  });

  test("every file it edits is put back", () => {
    expect(script).toContain(
      'save_files "${SERVICE_CONFS[@]}" "${PASTE_FILES[@]}" "$PLACEMENT_WSGI" "$OSPROFILER_OPTS"',
    );
    expect(script).toContain(
      'restore_files "${SERVICE_CONFS[@]}" "${PASTE_FILES[@]}" "$PLACEMENT_WSGI" "$OSPROFILER_OPTS"',
    );
  });

  test("a scene that has to fail in the scheduler can get there", () => {
    expect(script).toContain("--ram -1 ou-payments");
  });
});
