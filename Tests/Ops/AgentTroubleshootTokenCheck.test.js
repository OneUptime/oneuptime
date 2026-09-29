"use strict";

/**
 * The ingestion-key check in the agents' troubleshoot.sh, run for real
 * against stubbed `docker` / `kubectl` that answer each probe the way a
 * OneUptime server would.
 *
 * GH#3978: OTLP ingest answers a refused key with 401 (missing, unknown or
 * expired) or 422 (disabled, or a browser key used from a collector). The
 * scripts were written when it answered 200 whatever the key, and read the
 * new answers wrongly:
 *
 *  - a browser key validates (/otlp/v1/validate → 200, keyType Browser) but
 *    ingest refuses it from a collector, so it must not be VALID;
 *  - on a server without /otlp/v1/validate (404), POST /otlp/v1/metrics
 *    answering 401/422 is a refused key, not "reachable";
 *  - the /fluentd/v1/logs fallback must read 401/422 (and "Missing
 *    ingestion token") as a refusal, still read the old 400 "Invalid service
 *    token" as one, and must not call a probe that got no HTTP answer at all
 *    "Token ACCEPTED".
 *
 * One matrix, run through every script that carries this check: the Ceph,
 * Proxmox, VMware and Docker Swarm agents (docker compose; probes run as
 * `docker run curl` in the agent's network namespace) and the Kubernetes
 * agent chart's (probes run as `kubectl run curl` in the cluster). The
 * Database Agent's differs in shape and has its own tests in
 * DatabaseAgentScripts.test.js.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BASE_URL = "https://oneuptime.example.com";
const KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-token-check-"));
  scratchDirs.push(dir);
  return dir;
}

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

/*
 * What a server answers each probe with: the body, the HTTP status, and the
 * exit code of the curl that asked (non-zero when no HTTP answer came back).
 * Bodies are what OTelIngest.ts and TelemetryIngest.ts send.
 */
function answer(status, body = "", curlExit = 0) {
  return { status, body, curlExit };
}

const SERVER_KEY = answer(
  "200",
  JSON.stringify({
    tokenProvided: true,
    valid: true,
    projectId: "6a1c0e0e0e0e0e0e0e0e0e0e",
    keyType: "Server",
    isEnabled: true,
    isExpired: false,
    message: "Ingestion token is valid.",
  }),
);
const BROWSER_KEY = answer(
  "200",
  JSON.stringify({
    tokenProvided: true,
    valid: true,
    projectId: "6a1c0e0e0e0e0e0e0e0e0e0e",
    keyType: "Browser",
    isEnabled: true,
    isExpired: false,
    message: "Ingestion token is valid, but it is a BROWSER ingestion key.",
  }),
);
const NO_VALIDATE_ROUTE = answer("404", "Cannot GET /otlp/v1/validate");
const ACCEPTED = answer("200");
const UNREACHABLE = answer(
  "000",
  "curl: (7) Failed to connect to oneuptime.example.com port 443",
  7,
);

/*
 * Each case: what the server answers, and the check lines (✔ / ✗ / ▲) the
 * token section must print, in order. `swarm` overrides `lines` for the
 * Docker Swarm agent, whose check has no /fluentd fallback: a server without
 * /otlp/v1/validate that does not refuse the key leaves it inconclusive.
 * `refused` is whether the verdict must blame the ingestion key.
 */
const REACHABLE_METRICS = `✔ Reachable: ${BASE_URL}/otlp/v1/metrics returned HTTP 200.`;
const SWARM_INCONCLUSIVE = [
  `✔ Reachable: ${BASE_URL}/otlp/v1/metrics returned HTTP 200 (token check inconclusive on this server version).`,
];

const CASES = [
  {
    name: "a server key that validates",
    probes: { validate: SERVER_KEY },
    lines: [
      "✔ Reached OneUptime and the ingestion token is VALID (/otlp/v1/validate → 200).",
    ],
    refused: false,
  },
  {
    name: "a browser key: validates, but ingest refuses it from a collector",
    probes: { validate: BROWSER_KEY },
    lines: [
      "✗ Reached OneUptime, but the token is a BROWSER ingestion key: it validates, yet ingest refuses it from a collector (422).",
    ],
    refused: true,
  },
  {
    name: "a key /otlp/v1/validate rejects",
    probes: {
      validate: answer(
        "401",
        JSON.stringify({
          tokenProvided: true,
          valid: false,
          message: "This ingestion token is unknown or has been revoked.",
        }),
      ),
    },
    lines: [
      "✗ Reached OneUptime, but it REJECTED the token (/otlp/v1/validate → 401).",
    ],
    refused: true,
  },
  {
    name: "no /otlp/v1/validate, and /otlp/v1/metrics answers 401",
    probes: {
      validate: NO_VALIDATE_ROUTE,
      "otlp-metrics": answer(
        "401",
        JSON.stringify({ message: "Invalid ingestion token." }),
      ),
    },
    lines: [
      "✗ Reached OneUptime, but /otlp/v1/metrics REFUSED the token (HTTP 401).",
    ],
    refused: true,
  },
  {
    name: "no /otlp/v1/validate, and /otlp/v1/metrics answers 422",
    probes: {
      validate: NO_VALIDATE_ROUTE,
      "otlp-metrics": answer(
        "422",
        JSON.stringify({
          message: "This telemetry ingestion key has been disabled.",
        }),
      ),
    },
    lines: [
      "✗ Reached OneUptime, but /otlp/v1/metrics REFUSED the token (HTTP 422).",
    ],
    refused: true,
  },
  {
    name: "an old server: /fluentd answers 400 Invalid service token",
    probes: {
      validate: NO_VALIDATE_ROUTE,
      "otlp-metrics": ACCEPTED,
      fluentd: answer(
        "400",
        JSON.stringify({ message: "Invalid service token: 0b6a4e39" }),
      ),
    },
    lines: [
      REACHABLE_METRICS,
      '✗ OneUptime REJECTED this token: "Invalid service token" (HTTP 400).',
    ],
    swarm: SWARM_INCONCLUSIVE,
    refused: true,
  },
  {
    name: "/fluentd answers 401",
    probes: {
      validate: NO_VALIDATE_ROUTE,
      "otlp-metrics": ACCEPTED,
      fluentd: answer(
        "401",
        JSON.stringify({ message: "Invalid ingestion token." }),
      ),
    },
    lines: [
      REACHABLE_METRICS,
      "✗ OneUptime REFUSED this token (/fluentd/v1/logs → HTTP 401).",
    ],
    swarm: SWARM_INCONCLUSIVE,
    refused: true,
  },
  {
    name: "/fluentd says the ingestion token is missing",
    probes: {
      validate: NO_VALIDATE_ROUTE,
      "otlp-metrics": ACCEPTED,
      fluentd: answer(
        "401",
        JSON.stringify({ message: "Missing ingestion token." }),
      ),
    },
    lines: [
      REACHABLE_METRICS,
      "✗ Server says the token header is missing (HTTP 401) — a proxy may be stripping it.",
    ],
    swarm: SWARM_INCONCLUSIVE,
    refused: true,
  },
  {
    name: "/fluentd accepts the key",
    probes: {
      validate: NO_VALIDATE_ROUTE,
      "otlp-metrics": ACCEPTED,
      fluentd: ACCEPTED,
    },
    lines: [
      REACHABLE_METRICS,
      "✔ Token ACCEPTED by OneUptime (auth passed; /fluentd returned HTTP 200).",
    ],
    swarm: SWARM_INCONCLUSIVE,
    refused: false,
  },
  {
    name: "/fluentd gets no HTTP answer at all",
    probes: {
      validate: NO_VALIDATE_ROUTE,
      "otlp-metrics": ACCEPTED,
      fluentd: UNREACHABLE,
    },
    lines: [
      REACHABLE_METRICS,
      "▲ No HTTP answer from /fluentd/v1/logs (curl exit 7) — token check inconclusive.",
    ],
    swarm: SWARM_INCONCLUSIVE,
    refused: false,
  },
  {
    name: "/otlp/v1/validate answers 502, and /fluentd answers 422",
    probes: {
      validate: answer("502", "<html>502 Bad Gateway</html>"),
      fluentd: answer(
        "422",
        JSON.stringify({
          message: "A browser ingestion key cannot be used for Fluentd.",
        }),
      ),
    },
    lines: [
      "▲ Unexpected HTTP 502 from /otlp/v1/validate; trying the legacy token probe.",
      "✗ OneUptime REFUSED this token (/fluentd/v1/logs → HTTP 422).",
    ],
    swarm: ["▲ Unexpected HTTP 502 from /otlp/v1/validate."],
    refused: true,
  },
];

/* ------------------------------------------------ docker compose agents */

/*
 * `docker` answers the runtime checks as a healthy install would, reads the
 * container's environment from container.env, and answers each OneUptime
 * probe from <probe>.out (body, then the OUSTATUS line curl's -w appends),
 * exiting with <probe>.exit as `docker run` passes curl's exit code on.
 * Anything else it is asked to fetch (a scrape target, the collector's own
 * metrics) gets a plausible healthy answer.
 */
function dockerStub(bin) {
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/docker.log"
probe_answer() {
  cat "$STUB_DIR/$1.out" 2>/dev/null
  exit "$(cat "$STUB_DIR/$1.exit" 2>/dev/null || echo 0)"
}
case "$1" in
  info) exit 0 ;;
  compose) exit 0 ;;
  node) printf 'ID HOSTNAME STATUS AVAILABILITY MANAGER\\nabc * node1 Ready Active Leader\\n'; exit 0 ;;
  exec) printf '3\\n'; exit 0 ;;
  inspect)
    case "$*" in
      *Config.Env*) cat "$STUB_DIR/container.env" ;;
      *restarting*) printf 'running restarting=false restarts=0\\n' ;;
      *State.Status*) printf 'running\\n' ;;
    esac
    exit 0 ;;
  logs) cat "$STUB_DIR/collector.log" 2>/dev/null; exit 0 ;;
  run)
    case "$*" in
      */otlp/v1/validate*) probe_answer validate ;;
      */otlp/v1/metrics*) probe_answer otlp-metrics ;;
      */fluentd/v1/logs*) probe_answer fluentd ;;
      *127.0.0.1:8888/metrics*)
        printf 'otelcol_receiver_accepted_metric_points 10\\notelcol_exporter_sent_metric_points 10\\notelcol_exporter_send_failed_metric_points 0\\n' ;;
      *) printf 'ceph_health_status 0\\npve_up 1\\n\\nOUSTATUS:200\\n' ;;
    esac
    exit 0 ;;
esac
exit 0
`,
  );
}

function writeProbes(dir, probes, withExitCodes) {
  for (const [probe, reply] of Object.entries(probes)) {
    const lines = [reply.body, `OUSTATUS:${reply.status}`];
    if (!withExitCodes) {
      // In-cluster, the snippet prints curl's exit code itself.
      lines.push(`OUEXIT:${reply.curlExit}`);
    }
    fs.writeFileSync(path.join(dir, `${probe}.out`), `${lines.join("\n")}\n`);
    if (withExitCodes) {
      fs.writeFileSync(path.join(dir, `${probe}.exit`), `${reply.curlExit}\n`);
    }
  }
}

const COMMON_ENV = [`ONEUPTIME_URL=${BASE_URL}`];

const DOCKER_AGENTS = [
  {
    agent: "CephAgent",
    env: [
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
      "CEPH_CLUSTER_NAME=ceph-prod",
      "CEPH_MGR_ENDPOINTS=[mgr1:9283,mgr2:9283]",
    ],
  },
  {
    agent: "ProxmoxAgent",
    env: [
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
      "PROXMOX_CLUSTER_NAME=pve-prod",
      "PVE_HOST=192.168.1.10",
    ],
  },
  {
    agent: "VMwareAgent",
    env: [
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
      "VMWARE_VCENTER_NAME=vc-prod",
      "VCENTER_ENDPOINT=https://vcsa.example.com",
      "VCENTER_USERNAME=monitor@vsphere.local",
      "VCENTER_PASSWORD=secret",
    ],
  },
  {
    agent: "DockerSwarmAgent",
    env: [`ONEUPTIME_SERVICE_TOKEN=${KEY}`, "DOCKER_SWARM_CLUSTER_NAME=swarm"],
    swarm: true,
  },
];

function runDockerAgent({ agent, env }, probes) {
  const dir = scratch();
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  dockerStub(bin);
  writeProbes(dir, probes, true);

  const envText = `${[...COMMON_ENV, ...env].join("\n")}\n`;
  fs.writeFileSync(path.join(dir, "container.env"), envText);

  const installDir = path.join(dir, "agent");
  fs.mkdirSync(installDir);
  for (const file of ["docker-compose.yml", "otel-collector-config.yaml"]) {
    const source = path.join(REPO_ROOT, "agents", agent, file);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(installDir, file));
    }
  }
  fs.writeFileSync(path.join(installDir, ".env"), envText);

  const result = spawnSync(
    "bash",
    [
      path.join(REPO_ROOT, "agents", agent, "troubleshoot.sh"),
      "-d",
      installDir,
      "--no-color",
    ],
    {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, STUB_DIR: dir },
      encoding: "utf8",
      timeout: 60000,
    },
  );

  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/* -------------------------------------------------- kubernetes agent */

const K8S_SCRIPT = path.join(
  REPO_ROOT,
  "HelmChart/Public/kubernetes-agent/troubleshoot.sh",
);
const K8S_POD = "kubernetes-agent-7d9f5c6b8-x2x7q";

/*
 * `kubectl` answers as for one healthy metrics-collector Deployment whose
 * Secret holds KEY and whose exporter points at BASE_URL, with no debug
 * sidecar and cost collection off. `kubectl run` (the throwaway curl pod)
 * answers each OneUptime probe from <probe>.out, wrapped in the noise
 * `kubectl run -i --rm` adds; `port-forward` stays up until killed. `curl`
 * on this machine answers the port-forwarded health and self-metrics
 * endpoints, and `sleep` returns at once.
 */
function kubernetesStubs(bin, dir) {
  writeExecutable(
    path.join(bin, "kubectl"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/kubectl.log"
case "$1" in
  config) printf 'kind-test\\n'; exit 0 ;;
  delete) exit 0 ;;
  port-forward) exec tail -f /dev/null ;;
  logs) cat "$STUB_DIR/collector.log" 2>/dev/null; exit 0 ;;
  run|exec)
    snippet="\${!#}"
    case "$snippet" in
      */otlp/v1/validate*) probe=validate ;;
      */otlp/v1/metrics*) probe=otlp-metrics ;;
      */fluentd/v1/logs*) probe=fluentd ;;
      *) probe=none ;;
    esac
    printf "If you don't see a command prompt, try pressing enter.\\n"
    cat "$STUB_DIR/$probe.out" 2>/dev/null
    printf 'pod "oub-curl-1" deleted\\n'
    exit 0 ;;
  get)
    case "$*" in
      *--raw*) exit 0 ;;
      "get ns "*) exit 0 ;;
      *deploy,daemonset*) printf 'Deployment\\tkubernetes-agent\\n' ;;
      *component=cost*|*component=opencost*) ;;
      *"get deploy -n"*component=metrics-collector*) printf 'kubernetes-agent' ;;
      *"get pods"*component=metrics-collector*) printf '${K8S_POD}' ;;
      *"get pods"*) printf '${K8S_POD}\\n' ;;
      *readyReplicas*|*.spec.replicas*) printf '1' ;;
      *.status.phase*) printf 'Running' ;;
      *restartCount*) printf '0+' ;;
      *containerStatuses*) ;;
      *".spec.containers[*].name"*) printf 'otel-collector' ;;
      *secretKeyRef.name*) printf 'kubernetes-agent' ;;
      *secretKeyRef.key*) printf 'api-key' ;;
      *"get secret"*jsonpath*) cat "$STUB_DIR/api-key.b64" ;;
      *"get secret"*) ;;
      *configMap.name*) printf 'kubernetes-agent' ;;
      *"get cm"*) cat "$STUB_DIR/collector-config.yaml" ;;
      *CLUSTER_NAME*) printf 'k8s-prod' ;;
    esac
    exit 0 ;;
esac
exit 0
`,
  );
  writeExecutable(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash
case "$*" in
  *127.0.0.1:11313*) exit 0 ;;
  *127.0.0.1:18888/metrics*)
    printf 'otelcol_exporter_sent_metric_points 10\\notelcol_exporter_send_failed_metric_points 0\\notelcol_exporter_queue_size 0\\n'
    exit 0 ;;
esac
exit 7
`,
  );
  writeExecutable(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(
    path.join(dir, "api-key.b64"),
    Buffer.from(KEY).toString("base64"),
  );
  fs.writeFileSync(
    path.join(dir, "collector-config.yaml"),
    [
      "exporters:",
      "  otlphttp:",
      `    endpoint: "${BASE_URL}/otlp"`,
      "    headers:",
      '      "x-oneuptime-token": "${env:ONEUPTIME_API_KEY}"',
      "",
    ].join("\n"),
  );
}

function runKubernetesAgent(probes) {
  const dir = scratch();
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  kubernetesStubs(bin, dir);
  writeProbes(dir, probes, false);

  const result = spawnSync("bash", [K8S_SCRIPT, "--no-color"], {
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, STUB_DIR: dir },
    encoding: "utf8",
    timeout: 60000,
  });

  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/* ------------------------------------------------------------ reading */

const TOKEN_SECTION = /── \d+\. Egress \+ DEFINITIVE token check ──/;
const ANY_SECTION = /^── .* ──$/;
const CHECK_LINE = /^ {2}[✔✗▲] /;
const KEY_REFUSED_VERDICT =
  "ROOT CAUSE: the ingestion token is rejected by OneUptime.";
const KEY_REFUSED_FINDING =
  "Every export is refused (401/422) and dropped, and the collector only logs 'Exporting failed'";

// The ✔ / ✗ / ▲ lines of the token section, in order.
function tokenCheckLines(output) {
  const lines = output.split("\n");
  const start = lines.findIndex((line) => {
    return TOKEN_SECTION.test(line);
  });

  if (start < 0) {
    throw new Error(`no token-check section in:\n${output}`);
  }

  const end = lines.findIndex((line, index) => {
    return index > start && ANY_SECTION.test(line);
  });

  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .filter((line) => {
      return CHECK_LINE.test(line);
    })
    .map((line) => {
      return line.trim();
    });
}

function expectVerdict(run, { refused }) {
  if (refused) {
    expect(run.output).toContain(KEY_REFUSED_VERDICT);
    expect(run.status).toBe(1);
  } else {
    expect(run.output).not.toContain(KEY_REFUSED_VERDICT);
    expect(run.output).not.toContain(KEY_REFUSED_FINDING);
  }
}

/* -------------------------------------------------------------- tests */

describe.each(DOCKER_AGENTS)("agents/$agent/troubleshoot.sh", (config) => {
  test.each(CASES)("$name", (testCase) => {
    const run = runDockerAgent(config, testCase.probes);

    expect(tokenCheckLines(run.output)).toEqual(
      config.swarm && testCase.swarm ? testCase.swarm : testCase.lines,
    );
    expectVerdict(run, {
      refused: config.swarm && testCase.swarm ? false : testCase.refused,
    });
  });

  test("no HTTP answer from /otlp/v1/validate is an egress failure, not a key problem", () => {
    const run = runDockerAgent(config, {
      validate: answer(
        "000",
        "curl: (6) Could not resolve host: oneuptime.example.com",
        6,
      ),
    });

    expect(tokenCheckLines(run.output)).toEqual([
      `✗ Cannot reach ${BASE_URL}/otlp/v1/validate from the agent's network (curl exit 6).`,
    ]);
    expect(run.output).toContain(
      "ROOT CAUSE: the agent can't deliver telemetry to OneUptime (network/URL/TLS).",
    );
    expectVerdict(run, { refused: false });
  });
});

describe("HelmChart/Public/kubernetes-agent/troubleshoot.sh", () => {
  test.each(CASES)("$name", (testCase) => {
    const run = runKubernetesAgent(testCase.probes);

    expect(tokenCheckLines(run.output)).toEqual(testCase.lines);
    expectVerdict(run, testCase);
  });

  test("a healthy agent with a server key passes outright", () => {
    const run = runKubernetesAgent({ validate: SERVER_KEY });

    expect(run.output).toContain(
      "The agent looks healthy and OneUptime accepts the token.",
    );
    expect(run.status).toBe(0);
  });

  test("no HTTP answer from /otlp/v1/validate is an egress failure, not a key problem", () => {
    const run = runKubernetesAgent({
      validate: answer(
        "000",
        "curl: (6) Could not resolve host: oneuptime.example.com",
        6,
      ),
    });

    expect(tokenCheckLines(run.output)).toEqual([
      `✗ Cannot reach ${BASE_URL}/otlp/v1/validate from inside the cluster (curl exit 6).`,
    ]);
    expect(run.output).toContain(
      "ROOT CAUSE: the cluster can't deliver telemetry to OneUptime (network/URL/TLS).",
    );
    expectVerdict(run, { refused: false });
  });
});
