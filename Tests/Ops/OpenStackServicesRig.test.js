"use strict";

/**
 * The rig that records the services a cloud may not run (#5741 to #5744): a job of its own in
 * test.openstack-e2e.yaml, a script per group, and an importer. A DevStack takes half an hour
 * to deploy and runs on the org's shared runners, so what can be checked without one is checked
 * here: that a scene going wrong costs nothing after it, that record.sh reads what it says it
 * reads, and that the importer scrubs what it must and writes nowhere else.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const RIG = path.join(__dirname, "openstack-e2e");
const WORKFLOW = path.join(
  ROOT,
  ".github",
  "workflows",
  "test.openstack-e2e.yaml",
);
const IMPORTER = path.join(RIG, "import-services-recording.py");

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openstack-services-rig-"));
  scratchDirs.push(dir);
  return dir;
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function writeExecutable(file, text) {
  write(file, text);
  fs.chmodSync(file, 0o755);
}

const workflow = yaml.load(read(WORKFLOW));
const job = workflow.jobs["record-services"];
const entries = job.strategy.matrix.include;
const GROUPS = entries.map((entry) => {
  return entry.name;
});

// The scenes a script runs, in order: `scene <name> ...` at the start of a line.
function scenesOf(group) {
  return Array.from(
    read(path.join(RIG, `${group}.sh`)).matchAll(/^\s*scene ([a-z0-9-]+)\b/gm),
  ).map((match) => {
    return match[1];
  });
}

describe("the job that records them", () => {
  test("runs only when asked, and nothing else runs when it is", () => {
    expect(job.if).toBe("${{ inputs.services_only }}");
    expect(workflow.on.workflow_dispatch.inputs.services_only.type).toBe(
      "boolean",
    );
    expect(workflow.on.workflow_dispatch.inputs.services_only.default).toBe(
      false,
    );
    expect(workflow.jobs.record.if).toContain("!inputs.services_only");
    expect(workflow.jobs["record-control-plane"].if).toContain(
      "!inputs.services_only",
    );
  });

  test("a run of it never cancels another kind of run, and a retry cancels only itself", () => {
    expect(workflow.concurrency.group).toContain(
      "inputs.services_only && format('services-{0}', inputs.services_filter)",
    );
    // The others keep the groups they had.
    expect(workflow.concurrency.group).toContain(
      "inputs.control_plane_only && 'control-plane'",
    );
    expect(workflow.concurrency.group).toContain("inputs.traces_only && 'traces'");
  });

  test("runs one group per runner, on the action and runner the rest of the rig uses", () => {
    expect(job["runs-on"]).toBe("ubuntu-24.04");
    expect(job.strategy["fail-fast"]).toBe(false);
    expect(GROUPS).toEqual([
      "services-octavia",
      "services-ironic",
      "services-heat-magnum",
      "services-manila",
      "services-designate-barbican-swift",
      "services-trove",
      "services-gnocchi",
    ]);
    const deployOf = (definition) => {
      return definition.steps.find((step) => {
        return step.name === "Deploy DevStack";
      });
    };
    expect(deployOf(job).uses).toBe(deployOf(workflow.jobs.record).uses);
    expect(deployOf(job).with.branch).toBe("stable/2026.1");
  });

  test("every step of a filtered-out entry is skipped, so a retry can run just one", () => {
    expect(job.env.WANTED).toContain("inputs.services_filter == ''");
    expect(workflow.on.workflow_dispatch.inputs.services_filter.type).toBe(
      "string",
    );
    for (const step of job.steps) {
      expect({ step: step.name || step.uses, if: step.if }).toEqual({
        step: step.name || step.uses,
        if: expect.stringContaining("env.WANTED == 'true'"),
      });
    }
  });

  test("makes every name one an artifact can hold before it uploads, even when a scene failed", () => {
    const names = job.steps.map((step) => {
      return step.name;
    });
    expect(names.indexOf("Make every name one an artifact can hold")).toBeLessThan(
      names.indexOf("Upload the recordings"),
    );
    expect(names.indexOf("Make every name one an artifact can hold")).toBeGreaterThan(0);
    for (const name of [
      "Stop the agent and keep what it exported",
      "Make every name one an artifact can hold",
      "Upload the recordings",
    ]) {
      expect(
        job.steps.find((step) => {
          return step.name === name;
        }).if,
      ).toContain("always()");
    }
  });

  test("the access check costs no scene: last, and allowed to fail", () => {
    const names = job.steps.map((step) => {
      return step.name;
    });
    const access = job.steps.find((step) => {
      return step.run === "bash Tests/Ops/openstack-e2e/access-matrix.sh";
    });
    expect(access["continue-on-error"]).toBe(true);
    expect(names.indexOf(access.name)).toBeGreaterThan(
      names.indexOf("Drive it through each state, and record what it says"),
    );
  });

  test.each(entries)("$name pins every plugin it enables to one branch", (entry) => {
    const plugins = entry.conf_overrides
      .split("\n")
      .filter((line) => {
        return line.startsWith("enable_plugin ");
      });
    expect(plugins.length).toBeGreaterThan(0);
    for (const line of plugins) {
      expect(line).toMatch(
        /^enable_plugin [a-z-]+ https:\/\/github\.com\/openstack\/[a-z-]+ stable\/2026\.1$/,
      );
    }
  });

  test.each(entries)(
    "$name asks the exporter only for names it takes, and has a script",
    (entry) => {
      // exporters.SupportedExporters in the exporter the agent pins.
      const supported = [
        "network",
        "compute",
        "image",
        "volume",
        "identity",
        "object-store",
        "load-balancer",
        "container-infra",
        "dns",
        "baremetal",
        "gnocchi",
        "database",
        "orchestration",
        "placement",
        "sharev2",
      ];
      for (const service of entry.exporter_services.split(" ")) {
        expect(supported).toContain(service);
      }
      expect(fs.existsSync(path.join(RIG, `${entry.name}.sh`))).toBe(true);
    },
  );
});

describe("each group's script", () => {
  test.each(GROUPS)("%s drives scenes and says at the end how they went", (group) => {
    const script = read(path.join(RIG, `${group}.sh`));
    expect(script).toContain("services-lib.sh");
    expect(script).toMatch(/^export RECORD_SERVICES="/m);
    expect(script.trimEnd().endsWith("finish_scenes")).toBe(true);
    expect(scenesOf(group).length).toBeGreaterThan(1);
  });

  test.each(GROUPS)("%s never names a scene what a release's fixtures use", (group) => {
    // A scene called healthy makes the tests of the releases read this group as a release.
    for (const scene of scenesOf(group)) {
      expect(["healthy", "access"]).not.toContain(scene);
    }
  });

  test.each(GROUPS)(
    "%s's record of what each scene is for sits where the importer will keep it",
    (group) => {
      const groupsInImporter = spawnSync(
        "python3",
        [
          "-I",
          "-B",
          "-c",
          `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("importer", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps(module.GROUPS))
`,
          IMPORTER,
        ],
        { encoding: "utf8" },
      );
      expect(groupsInImporter.status).toBe(0);
      const parts = JSON.parse(groupsInImporter.stdout)[group].parts;
      for (const scene of scenesOf(group)) {
        // A scene no part claims would keep its how.txt and nothing else.
        expect({
          scene,
          claimed: parts.some((part) => {
            return scene.startsWith(part.scene_prefix || "");
          }),
        }).toEqual({ scene, claimed: true });
      }
    },
  );
});

/* ------------------------------------------------- each script, start to finish, under stubs */

/*
 * Each script as it runs on a runner, with every wait answered at once and every command line
 * stubbed. This proves no state: a real cloud does that. It finds what `set -u` and a typo would
 * otherwise find an hour into a run: a variable set inside one scene's subshell and read in
 * another, a function called before it is defined, a scene that cannot get through its own lines.
 */
describe("each group's script, start to finish", () => {
  function runGroup(group, { lib = "" } = {}) {
    const dir = scratch();
    const bin = path.join(dir, "bin");
    write(
      path.join(dir, "services-lib.sh"),
      `${read(path.join(RIG, "services-lib.sh"))}
wait_for() {
  echo "$1: $2"
}
wait_for_either() {
  echo "$1: $2"
}
${lib}
`,
    );
    fs.copyFileSync(path.join(RIG, `${group}.sh`), path.join(dir, `${group}.sh`));
    write(
      path.join(dir, "record.sh"),
      `#!/usr/bin/env bash
set -euo pipefail
echo "$1 RECORD_SERVICES=$RECORD_SERVICES RECON_TARGETS=\${RECON_TARGETS:-}" >>"$OUTPUT_DIR/recorded.txt"
`,
    );

    // A thing does not exist the first time anyone checks by showing it with no format, so each
    // script's "create it unless it is there" line runs too.
    writeExecutable(
      path.join(bin, "openstack"),
      `#!/usr/bin/env python3
import hashlib, json, os, sys
args = " ".join(sys.argv[1:])
if "catalog list" in args:
    print(json.dumps([{"Type": "metric", "Endpoints": [{"interface": "public", "url": "http://10.0.0.1/metric"}]}]))
elif "provider list" in args:
    print("amphora\\novn")
elif "-f json" in args and "addresses" in args:
    print(json.dumps({"addresses": {"ou-net": ["10.77.0.5"]}}))
elif "image list" in args and "-c ID" in args:
    print("image-id cirros-0.6.3-x86_64-disk")
elif "image list" in args:
    print("cirros-0.6.3-x86_64-disk")
elif "datastore version list" in args:
    print("8.4")
elif "database instance show" in args and "-c status" in args:
    print("ACTIVE")
elif "coe cluster show" in args and "-c status" in args:
    print("CREATE_COMPLETE")
elif " show " in args and " -f " not in args and " -c " not in args:
    seen = os.path.join(os.environ["STUB_STATE"], hashlib.sha1(args.encode()).hexdigest())
    if not os.path.exists(seen):
        open(seen, "w").close()
        sys.exit(1)
elif " -f value" in args:
    print("stub-value")
`,
    );
    writeExecutable(
      path.join(bin, "sudo"),
      `#!/usr/bin/env bash
case "$1" in
  systemctl|journalctl) exit 0 ;;
esac
exec "$@"
`,
    );
    // Every unit exists, as far as a script asks.
    writeExecutable(
      path.join(bin, "systemctl"),
      `#!/usr/bin/env bash\necho "$2 enabled"\n`,
    );
    writeExecutable(path.join(bin, "journalctl"), `#!/usr/bin/env bash\nexit 0\n`);
    writeExecutable(path.join(bin, "sleep"), `#!/usr/bin/env bash\nexit 0\n`);
    writeExecutable(
      path.join(bin, "mysql"),
      `#!/usr/bin/env bash\nprintf 'id\\nstub-row-id\\n'\n`,
    );
    writeExecutable(
      path.join(bin, "curl"),
      `#!/usr/bin/env bash
# Gnocchi's answers, the only API these scripts read for themselves.
printf '{"id": "stub-metric", "metricd": {"processors": ["one"]}, "storage": {"summary": {"measures": 0, "metrics": 0}}}'
`,
    );
    const output = path.join(dir, "out");
    fs.mkdirSync(path.join(dir, "state"));
    const run = spawnSync("bash", [path.join(dir, `${group}.sh`)], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        OUTPUT_DIR: output,
        STUB_STATE: path.join(dir, "state"),
      },
    });
    return {
      run,
      scenes: fs.existsSync(path.join(output, "scenes.txt"))
        ? read(path.join(output, "scenes.txt"))
        : "",
      recorded: fs.existsSync(path.join(output, "recorded.txt"))
        ? read(path.join(output, "recorded.txt"))
        : "",
    };
  }

  test.each(GROUPS)("%s reaches its end with every scene recorded", (group) => {
    const { run, scenes, recorded } = runGroup(group);
    expect({
      status: run.status,
      scenes: scenes.trim().split("\n").sort(),
      stderr: run.stderr,
    }).toEqual({
      status: 0,
      // Each once: Octavia's fallback names some of them again, and only a failure reaches it.
      scenes: Array.from(new Set(scenesOf(group)))
        .filter((scene) => {
          return scene !== "amphora-provider-failed";
        })
        .map((scene) => {
          return `${scene} recorded`;
        })
        .sort(),
      stderr: expect.anything(),
    });
    expect(recorded.split("\n")[0]).toContain("RECORD_SERVICES=");
  });

  test("Swift's scenes are told where its storage servers answer", () => {
    const { recorded } = runGroup("services-designate-barbican-swift");
    const swift = recorded.split("\n").find((line) => {
      return line.startsWith("swift-baseline");
    });
    expect(swift).toContain("object=");
    expect(swift).toContain(":6613");
    expect(swift).toContain("account=");
  });

  test("a runner that cannot boot an amphora says so, and the ovn provider's scenes still run", () => {
    const { run, scenes } = runGroup("services-octavia", {
      lib: `
wait_for_either() {
  [ "$1" != "Load balancer ou-lb" ] || return 1
  echo "$1: $2"
}
`,
    });
    expect(run.status).not.toBe(0);
    expect(scenes).toContain("amphora-provider-failed FAILED");
    expect(scenes).toContain("ovn-provider recorded\n");
    expect(scenes).toContain("lb-error recorded\n");
    expect(scenes).toContain("api-down recorded\n");
    // Nothing that needs an amphora was tried.
    expect(scenes).not.toContain("baseline");
    expect(scenes).not.toContain("pending-update");
  });

  test("a load balancer stuck in the wrong state costs its own scene, and the rest still run", () => {
    const { run, scenes } = runGroup("services-octavia", {
      lib: `
wait_for() {
  [ "$1" != "ou-lb provisioning status" ] || return 1
  echo "$1: $2"
}
`,
    });
    expect(run.status).not.toBe(0);
    expect(scenes).toContain("pending-update FAILED");
    expect(scenes).toContain("pending-create recorded\n");
    expect(scenes).toContain("recovered recorded\n");
  });
});

/* ------------------------------------------------- a scene that goes wrong costs nothing else */

describe("scene()", () => {
  // The library, beside a record.sh that only says it ran.
  function harness(body) {
    const dir = scratch();
    fs.copyFileSync(
      path.join(RIG, "services-lib.sh"),
      path.join(dir, "services-lib.sh"),
    );
    write(
      path.join(dir, "record.sh"),
      `#!/usr/bin/env bash
set -euo pipefail
echo "$1" >>"$OUTPUT_DIR/recorded.txt"
`,
    );
    write(
      path.join(dir, "main.sh"),
      `#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/services-lib.sh"
${body}
`,
    );
    const output = path.join(dir, "out");
    const run = spawnSync("bash", [path.join(dir, "main.sh")], {
      encoding: "utf8",
      env: { ...process.env, OUTPUT_DIR: output },
    });
    return {
      run,
      output,
      file: (name) => {
        return read(path.join(output, name));
      },
    };
  }

  test("a scene that fails partway is recorded, says why, and the next one still runs", () => {
    const { run, output, file } = harness(`
drive_bad() {
  false
  echo "never reached" >"$OUTPUT_DIR/reached.txt"
}
drive_good() {
  note "On its own."
}
scene one "The first." drive_bad
scene two "The second." drive_good
finish_scenes
`);
    expect(run.status).toBe(1);
    expect(fs.existsSync(path.join(output, "reached.txt"))).toBe(false);
    expect(file("recorded.txt")).toBe("one\ntwo\n");
    expect(file("one/failed.txt")).toContain("false");
    expect(fs.existsSync(path.join(output, "two/failed.txt"))).toBe(false);
    expect(file("two/how.txt")).toBe("The second.\nOn its own.\n");
    expect(file("scenes.txt")).toContain("one FAILED: line");
    expect(file("scenes.txt")).toContain("two recorded\n");
    expect(run.stderr).toContain("Did not reach: one");
  });

  test("puts the cloud back after recording, whichever way the scene went", () => {
    const { run, file } = harness(`
drive() {
  echo "drive" >>"$OUTPUT_DIR/order.txt"
  false
}
undo() {
  echo "undo after $(wc -l <"$OUTPUT_DIR/recorded.txt" | tr -d ' ') recording" >>"$OUTPUT_DIR/order.txt"
}
scene one "The first." drive undo
finish_scenes || true
`);
    expect(run.status).toBe(0);
    expect(file("order.txt")).toBe("drive\nundo after 1 recording\n");
  });

  test("an undo that fails is said, and costs the next scene nothing", () => {
    const { run, file } = harness(`
drive() {
  :
}
undo() {
  false
}
scene one "The first." drive undo
scene two "The second." drive
finish_scenes
`);
    expect(run.status).toBe(0);
    expect(file("recorded.txt")).toBe("one\ntwo\n");
    expect(file("scenes.txt")).toContain(
      "one: could not put the cloud back (exit 1)",
    );
  });

  test("wait_for gives up after its tries, and takes what it was waiting for", () => {
    const { run, file } = harness(`
says() {
  echo yes
}
drive_ok() {
  wait_for "it" yes 2 0 says
}
drive_never() {
  wait_for "it" no 2 0 says
}
scene ok "Reached." drive_ok
scene never "Not reached." drive_never
finish_scenes || true
`);
    expect(run.status).toBe(0);
    expect(file("scenes.txt")).toContain("ok recorded\n");
    expect(file("scenes.txt")).toContain("never FAILED");
    expect(run.stderr).toContain("it never became no (it is 'yes')");
  });

  test("wait_for_either stops at once on what can never become what it wants", () => {
    const { run, file } = harness(`
says() {
  echo ERROR
}
drive() {
  wait_for_either "it" ACTIVE ERROR 500 5 says
}
scene one "Not reached." drive
finish_scenes || true
`);
    expect(run.status).toBe(0);
    expect(run.stderr).toContain("it went to ERROR while waiting for ACTIVE");
    expect(file("scenes.txt")).toContain("one FAILED");
  });
});

/* -------------------------------------------------------------------- record.sh, under stubs */

describe("record.sh reads each service only where the catalog has it", () => {
  // The IDs each list answers with, so the reads of each row have something to read.
  const ANSWERS = {
    "/v2/lbaas/loadbalancers": { loadbalancers: [{ id: "lb1", name: "ou-lb" }] },
    "/v2/lbaas/listeners": { listeners: [{ id: "li1", name: "ou-lb-listener" }] },
    "/v2/lbaas/pools": { pools: [{ id: "po1", name: "ou-lb-pool" }] },
    "/v2/octavia/amphorae": { amphorae: [{ id: "abcdef0123456789" }] },
    "/v1/nodes/detail": { nodes: [{ uuid: "no1", name: "ou-node-half" }] },
    "/stacks?global_tenant=true": {
      stacks: [{ id: "st1", stack_name: "ou-stack-ok", project: "pr1" }],
    },
    "/clusters": { clusters: [{ uuid: "cl1", name: "ou-cluster" }] },
    "/v2/zones": { zones: [{ id: "zo1", name: "ou-active.example.org." }] },
  };

  function recordWith(catalog, extraEnv = {}) {
    const dir = scratch();
    const bin = path.join(dir, "bin");
    // Answers from a file, and writes where curl's -o says, as the script reads it back.
    write(path.join(dir, "answers.json"), JSON.stringify(ANSWERS));
    writeExecutable(
      path.join(bin, "curl"),
      `#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
out, fmt, head, url = None, "", False, ""
i = 0
while i < len(args):
    a = args[i]
    if a == "-o": out = args[i + 1]; i += 2; continue
    if a == "-w": fmt = args[i + 1]; i += 2; continue
    if a == "-D":
        open(args[i + 1], "w").write("HTTP/1.1 204 No Content\\r\\nX-Account-Bytes-Used: 7\\r\\n")
        i += 2; continue
    if a in ("-H", "--max-time"): i += 2; continue
    if a.startswith("-"): i += 1; continue
    url = a; i += 1
with open(os.environ["STUB_LOG"], "a") as log:
    log.write(url + "\\n")
answers = json.load(open(os.environ["STUB_ANSWERS"]))
body = "{}"
for suffix, answer in answers.items():
    if url.endswith(suffix):
        body = json.dumps(answer)
if out and out != "/dev/null":
    open(out, "w").write(body)
sys.stdout.write(fmt.replace("%{http_code}", "200").replace("%{time_total}", "0.01").replace("\\\\n", "\\n"))
`,
    );
    writeExecutable(
      path.join(bin, "openstack"),
      `#!/usr/bin/env python3
import json, os, sys
args = " ".join(sys.argv[1:])
if "catalog list" in args:
    print(os.environ["STUB_CATALOG"])
elif "token issue" in args:
    print("gAAAAstubtoken")
elif "project show" in args:
    print("pr1" if "-c id" in args else "ou-payments")
`,
    );
    writeExecutable(path.join(bin, "gnocchi"), `#!/usr/bin/env bash\nexit 0\n`);
    const output = path.join(dir, "out");
    const log = path.join(dir, "curl.log");
    const run = spawnSync(
      "bash",
      [path.join(RIG, "record.sh"), "a-scene"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ...extraEnv,
          PATH: `${bin}:${process.env.PATH}`,
          OUTPUT_DIR: output,
          STUB_LOG: log,
          STUB_ANSWERS: path.join(dir, "answers.json"),
          STUB_CATALOG: JSON.stringify(
            Object.entries(catalog).map(([type, url]) => {
              return {
                Type: type,
                Endpoints: [{ interface: "public", url }],
              };
            }),
          ),
        },
      },
    );
    return {
      run,
      scene: path.join(output, "a-scene"),
      calls: fs.existsSync(path.join(output, "a-scene", "api-status.txt"))
        ? read(path.join(output, "a-scene", "api-status.txt"))
            .trim()
            .split("\n")
            .map((line) => {
              return line.split(" ")[1];
            })
        : [],
      urls: fs.existsSync(log) ? read(log) : "",
    };
  }

  const EVERY_SERVICE = {
    "load-balancer": "http://10.0.0.1/load-balancer",
    baremetal: "http://10.0.0.1/baremetal",
    orchestration: "http://10.0.0.1/heat-api/v1/pr9",
    "container-infra": "http://10.0.0.1/container-infra/v1",
    dns: "http://10.0.0.1/dns",
    sharev2: "http://10.0.0.1/share/v2",
    "object-store": "http://10.0.0.1:8080/v1/AUTH_pr9",
    database: "http://10.0.0.1:8779/v1.0/pr9",
    "key-manager": "http://10.0.0.1/key-manager",
    metric: "http://10.0.0.1/metric",
  };

  test("a cloud of only the core services records what it always did, and no more", () => {
    const { run, calls } = recordWith({});
    expect({ status: run.status, stderr: run.stderr }).toEqual({
      status: 0,
      stderr: expect.anything(),
    });
    expect(calls).toEqual([]);
  });

  test("the reads each service has, by the names the importer keeps", () => {
    const { run, calls, urls } = recordWith(EVERY_SERVICE);
    expect({ status: run.status, stderr: run.stderr }).toEqual({
      status: 0,
      stderr: expect.anything(),
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        "octavia-loadbalancers",
        "octavia-lb-status-ou-lb",
        "octavia-lb-stats-ou-lb",
        "octavia-listener-stats-ou-lb-listener",
        "octavia-members-ou-lb-pool",
        "octavia-amphora-stats-abcdef01",
        "ironic-conductors",
        "ironic-node-validate-ou-node-half",
        "heat-stacks",
        "heat-stacks-own",
        "heat-services",
        "heat-stack-ou-stack-ok",
        "heat-stack-resources-ou-stack-ok",
        "magnum-clustertemplates",
        "magnum-cluster-ou-cluster",
        "designate-recordsets-ou-active.example.org.",
        "designate-service-statuses",
        "manila-shares-versioned",
        "manila-services",
        "manila-pools",
        "barbican-secrets",
        "barbican-orders",
        "barbican-secrets-ou-payments",
        "swift-info",
        "swift-account-own",
        "swift-account-ou-payments-as-admin",
        "swift-account-ou-payments",
        "trove-mgmt-instances",
        "gnocchi-status",
      ]),
    );
    // A stack is read as its own project, at its own project's address.
    expect(urls).toContain(
      "http://10.0.0.1/heat-api/v1/pr1/stacks/ou-stack-ok/st1/resources?nested_depth=2",
    );
    // The other project's Swift account, by its own id.
    expect(urls).toContain("http://10.0.0.1:8080/v1/AUTH_pr1");
  });

  test("what Swift's whole account says is in its headers, and is scrubbed like the rest", () => {
    const { scene } = recordWith(EVERY_SERVICE);
    expect(
      read(path.join(scene, "api", "swift-account-own.headers.txt")),
    ).toContain("X-Account-Bytes-Used: 7");
  });

  test("the scrapes it makes can be narrowed, and every service stays the default", () => {
    const narrowed = recordWith({}, { RECORD_SERVICES: "dns gnocchi" });
    expect(
      read(path.join(narrowed.scene, "exporter", "status.txt"))
        .trim()
        .split("\n")
        .map((line) => {
          return line.split(" ")[0];
        }),
    ).toEqual(["dns", "gnocchi", "all-at-once"]);

    const everything = recordWith({});
    expect(
      read(path.join(everything.scene, "exporter", "status.txt")).split("\n")
        .length,
    ).toBe(17);
  });

  test("Swift's recon is read from each server named, and a read it lacks only says so", () => {
    const { scene } = recordWith(
      {},
      { RECON_TARGETS: "object=127.0.0.1:6613 account=127.0.0.1:6612" },
    );
    const status = read(path.join(scene, "recon", "status.txt"));
    expect(status).toContain("200 object version");
    expect(status).toContain("200 account replication/account");
    expect(fs.existsSync(path.join(scene, "recon", "object-version.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(scene, "recon", "object-replication-object.json")),
    ).toBe(true);
  });

  test("a cloud without a service runs no CLI of it", () => {
    const { scene } = recordWith({});
    const cli = read(path.join(scene, "cli.txt"));
    expect(cli).toContain("$ openstack compute service list");
    expect(cli).not.toContain("loadbalancer");
    expect(cli).not.toContain("baremetal");
  });

  test("a cloud with one says what a person would read, for each", () => {
    const { scene } = recordWith(EVERY_SERVICE);
    const cli = read(path.join(scene, "cli.txt"));
    for (const line of [
      "$ openstack loadbalancer amphora list",
      "$ openstack loadbalancer member list ou-lb-pool",
      "$ openstack loadbalancer stats show ou-lb",
      "$ openstack baremetal conductor list",
      "$ openstack stack list --all-projects",
      "$ openstack coe cluster list",
      "$ openstack share list --all-projects",
      "$ openstack zone list --all-projects",
      "$ openstack secret list",
      "$ openstack object store account show",
      "$ openstack database instance list --all-projects",
      "$ gnocchi status",
    ]) {
      expect(cli).toContain(line);
    }
  });
});

/* ------------------------------------------------------------------------------- the importer */

describe("import-services-recording.py", () => {
  const RUNNER = "runnervm-abc123";
  const RUNNER_FULL = "runnervm-abc123.internal.cloudapp.net";
  const TOKEN = "gAAAAABpretendtoken_-=";

  // A recording as a group's job leaves it, with what must not survive in it.
  function makeRecording() {
    const dir = scratch();
    const folder = path.join(dir, "recordings", "openstack-recording-services-octavia");
    write(
      path.join(folder, "runner-names.txt"),
      `${RUNNER}\n${RUNNER_FULL}\n10.1.0.5\n`,
    );
    write(path.join(folder, "scenes.txt"), "baseline recorded\nnever FAILED: line 3\n");
    write(path.join(folder, "octavia-policy.txt"), `On ${RUNNER_FULL}\n`);

    const baseline = path.join(folder, "baseline");
    write(path.join(baseline, "how.txt"), "On its own.\n");
    write(
      path.join(baseline, "exporter", "load-balancer.prom"),
      `openstack_loadbalancer_up 1\nopenstack_loadbalancer_amphora_status{compute_id="c",lb_network_ip="10.1.0.5"} 1 # ${RUNNER}\n`,
    );
    write(path.join(baseline, "exporter", "compute.prom"), "openstack_nova_up 1\n");
    write(path.join(baseline, "exporter", "network.prom"), "openstack_neutron_up 1\n");
    write(
      path.join(baseline, "exporter", "status.txt"),
      "load-balancer 200 0.1s\ndns 200 0.01s\n",
    );
    write(
      path.join(baseline, "exporter-stable", "load-balancer.prom"),
      "openstack_loadbalancer_up 1\n",
    );
    write(
      path.join(baseline, "api", "octavia-loadbalancers.json"),
      JSON.stringify({
        loadbalancers: [
          {
            id: "lb1",
            name: "ou-lb",
            links: [{ href: "http://10.1.0.5/x" }],
            vip_port_id: `http://10.1.0.5:9876/${TOKEN}`,
          },
        ],
      }),
    );
    write(path.join(baseline, "api", "octavia-amphora-stats-abc.json"), "<html>503</html>");
    write(path.join(baseline, "api", "nova-servers.json"), `{"servers": []}`);
    write(path.join(baseline, "api", "keystone-users.json"), `{"users": [{"name": "secret"}]}`);
    write(
      path.join(baseline, "api-status.txt"),
      "200 octavia-loadbalancers openstack.example/x\n503 octavia-amphora-stats-abc openstack.example/y\n200 keystone-users openstack.example/z\n200 nova-servers openstack.example/w\n",
    );
    write(
      path.join(baseline, "cli.txt"),
      `$ openstack compute service list\nnot this\n$ openstack loadbalancer list\nou-lb on ${RUNNER_FULL} http://10.1.0.5/x\n$ openstack hypervisor list\nnot this either\n`,
    );

    // Never reached what it was for: kept out, though scenes.txt says so.
    const never = path.join(folder, "never");
    write(path.join(never, "how.txt"), "Not reached.\n");
    write(path.join(never, "failed.txt"), "line 3: false\n");
    write(path.join(never, "exporter", "load-balancer.prom"), "x 1\n");

    const later = path.join(folder, "pending-update");
    write(path.join(later, "how.txt"), "On its own.\n");
    write(path.join(later, "exporter", "compute.prom"), "openstack_nova_up 1\n");

    write(
      path.join(folder, "otlp", "metrics.json"),
      [
        // A small export of Octavia's and then a fuller one: the fuller is the one to keep.
        {
          resourceMetrics: [
            {
              scopeMetrics: [
                {
                  metrics: [
                    {
                      name: "up",
                      gauge: {
                        dataPoints: [
                          {
                            attributes: [
                              {
                                key: "openstack_service",
                                value: { stringValue: "load-balancer" },
                              },
                            ],
                            asDouble: 1,
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          resourceMetrics: [
            {
              scopeMetrics: [
                {
                  metrics: [
                    { name: "openstack_loadbalancer_up" },
                    {
                      name: "up",
                      gauge: {
                        dataPoints: [
                          {
                            attributes: [
                              {
                                key: "openstack_service",
                                value: { stringValue: "load-balancer" },
                              },
                            ],
                            asDouble: 1,
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        // A service this cloud does not run, and one every cloud does.
        ...["dns", "compute"].map((service) => {
          return {
            resourceMetrics: [
              {
                scopeMetrics: [
                  {
                    metrics: [
                      {
                        name: "up",
                        gauge: {
                          dataPoints: [
                            {
                              attributes: [
                                {
                                  key: "openstack_service",
                                  value: { stringValue: service },
                                },
                              ],
                              asDouble: 1,
                            },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          };
        }),
      ]
        .map((line) => {
          return JSON.stringify(line);
        })
        .join("\n"),
    );

    write(path.join(folder, "access", "matrix.json"), `{"reads": [], "at": "${RUNNER}"}`);
    write(path.join(folder, "access", "appcred-error.txt"), "secret\n");
    write(path.join(folder, "access", "exporter", "reader", "status.txt"), "load-balancer 200 3 series\n");
    write(path.join(folder, "access", "exporter", "reader", "load-balancer.prom"), "x 1\n");
    write(path.join(folder, "access", "exporter", "reader", "exporter.log"), "not this\n");

    const fixtures = path.join(dir, "fixtures");
    // What must survive: another group's folder is not this run's to touch, nor is a release.
    write(path.join(fixtures, "hibiscus-ovn", "healthy", "exporter", "compute.prom"), "kept\n");
    write(path.join(fixtures, "services-trove", "baseline", "how.txt"), "kept\n");
    write(path.join(fixtures, "services-octavia", "old-scene", "how.txt"), "replaced\n");

    return { recordings: path.join(dir, "recordings"), fixtures, folder };
  }

  function importInto({ recordings, fixtures }) {
    return spawnSync("python3", ["-I", "-B", IMPORTER, recordings, fixtures], {
      encoding: "utf8",
    });
  }

  function everyFile(folder) {
    const found = [];
    const walk = (at) => {
      for (const name of fs.readdirSync(at).sort()) {
        const full = path.join(at, name);
        if (fs.statSync(full).isDirectory()) {
          walk(full);
        } else {
          found.push(path.relative(folder, full));
        }
      }
    };
    walk(folder);
    return found;
  }

  test("keeps what the group is about, and nothing else", () => {
    const recording = makeRecording();
    const run = importInto(recording);
    expect({ status: run.status, stderr: run.stderr }).toEqual({
      status: 0,
      stderr: "",
    });
    const target = path.join(recording.fixtures, "services-octavia");
    expect(everyFile(target).sort()).toEqual(
      [
        "access-check/exporter/reader.txt",
        "access-check/exporter/reader/load-balancer.prom",
        "access-check/matrix.json",
        "baseline/api-status.txt",
        "baseline/api/nova-servers.json",
        "baseline/api/octavia-amphora-stats-abc.json",
        "baseline/api/octavia-loadbalancers.json",
        "baseline/cli.txt",
        "baseline/exporter-stable/load-balancer.prom",
        "baseline/exporter/compute.prom",
        "baseline/exporter/load-balancer.prom",
        "baseline/exporter/status.txt",
        "baseline/how.txt",
        "octavia-policy.txt",
        "otlp.json",
        "pending-update/how.txt",
        "scenes.txt",
      ].sort(),
    );
  });

  test("leaves out a scene that never got there, and scenes.txt says so", () => {
    const recording = makeRecording();
    const run = importInto(recording);
    expect(run.stdout).toContain("left out never");
    const target = path.join(recording.fixtures, "services-octavia");
    expect(fs.existsSync(path.join(target, "never"))).toBe(false);
    expect(read(path.join(target, "scenes.txt"))).toContain("never FAILED");
  });

  test("scrubs tokens, addresses and the runner's names from everything it keeps", () => {
    const recording = makeRecording();
    importInto(recording);
    const target = path.join(recording.fixtures, "services-octavia");
    for (const file of everyFile(target)) {
      const text = read(path.join(target, file));
      expect({ file, token: text.includes("gAAAA") }).toEqual({
        file,
        token: false,
      });
      expect({ file, runner: text.includes("runnervm") }).toEqual({
        file,
        runner: false,
      });
      expect({ file, address: text.includes("10.1.0.5") }).toEqual({
        file,
        address: false,
      });
    }
    expect(read(path.join(target, "baseline/cli.txt"))).toBe(
      "$ openstack loadbalancer list\nou-lb on compute-01.example.internal https://openstack.example/x\n",
    );
    expect(
      read(path.join(target, "baseline/exporter/load-balancer.prom")),
    ).toContain('lb_network_ip="203.0.113.10"');
  });

  test("takes an answer's links out, keeps an error page as it was, and gives status by code and call", () => {
    const recording = makeRecording();
    importInto(recording);
    const target = path.join(recording.fixtures, "services-octavia");
    expect(
      JSON.parse(read(path.join(target, "baseline/api/octavia-loadbalancers.json")))
        .loadbalancers[0].links,
    ).toBe(undefined);
    expect(
      read(path.join(target, "baseline/api/octavia-amphora-stats-abc.json")),
    ).toBe("<html>503</html>");
    expect(read(path.join(target, "baseline/api-status.txt"))).toBe(
      "200 octavia-loadbalancers\n503 octavia-amphora-stats-abc\n200 nova-servers\n",
    );
  });

  test("keeps the fullest export of each service, and one of a service this cloud lacks", () => {
    const recording = makeRecording();
    importInto(recording);
    const { resourceMetrics } = JSON.parse(
      read(path.join(recording.fixtures, "services-octavia", "otlp.json")),
    );
    const services = resourceMetrics.map((entry) => {
      const up = entry.scopeMetrics[0].metrics.find((metric) => {
        return metric.name === "up";
      });
      return {
        service: up.gauge.dataPoints[0].attributes[0].value.stringValue,
        metrics: entry.scopeMetrics[0].metrics.length,
      };
    });
    expect(services).toEqual([
      { service: "dns", metrics: 1 },
      { service: "load-balancer", metrics: 2 },
    ]);
  });

  test("touches no release's folder and no other group's, and replaces its own", () => {
    const recording = makeRecording();
    importInto(recording);
    expect(
      read(path.join(recording.fixtures, "hibiscus-ovn/healthy/exporter/compute.prom")),
    ).toBe("kept\n");
    expect(
      read(path.join(recording.fixtures, "services-trove/baseline/how.txt")),
    ).toBe("kept\n");
    expect(
      fs.existsSync(path.join(recording.fixtures, "services-octavia/old-scene")),
    ).toBe(false);
  });

  test("never writes a folder the generated access table would read as a release", () => {
    const recording = makeRecording();
    importInto(recording);
    expect(
      fs.existsSync(path.join(recording.fixtures, "services-octavia", "access")),
    ).toBe(false);
  });

  test.each(["healthy", "access"])(
    "refuses a scene called %s, which would read as a release",
    (scene) => {
      const recording = makeRecording();
      write(path.join(recording.folder, scene, "how.txt"), "No.\n");
      const run = importInto(recording);
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain(`a scene cannot be called ${scene}`);
      // Before it changed anything.
      expect(
        read(path.join(recording.fixtures, "services-octavia/old-scene/how.txt")),
      ).toBe("replaced\n");
    },
  );

  test("says so when there is nothing to import", () => {
    const dir = scratch();
    fs.mkdirSync(path.join(dir, "recordings", "openstack-recording-hibiscus-ovn"), {
      recursive: true,
    });
    const run = spawnSync(
      "python3",
      ["-I", "-B", IMPORTER, path.join(dir, "recordings"), path.join(dir, "fixtures")],
      { encoding: "utf8" },
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("No services recording");
  });
});
