"use strict";

/**
 * Tests/Ops/openstack-e2e/ai-agent-record.sh runs the OpenStack AI agent's real code against a
 * DevStack with nova-compute stopped. A DevStack takes half an hour to deploy, so what can be
 * proven without one is proven here: the scripts parse, the job runs on its own by a word on the
 * command line, and what it reads stands on what the policy really allows. The executor tests
 * in agents/ResourceAIAgent run the same commands through the same executor, on recordings.
 */

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const RIG = path.join(__dirname, "openstack-e2e");
const RECORD = path.join(RIG, "ai-agent-record.sh");
const READ = path.join(RIG, "ai-agent-read.js");
const WORKFLOW = path.join(
  ROOT,
  ".github",
  "workflows",
  "test.openstack-e2e.yaml",
);
const POLICY = path.join(
  ROOT,
  "packages",
  "Common",
  "Utils",
  "AiRemediation",
  "Resource",
  "OpenStackCommandPolicy.ts",
);

function read(file) {
  return fs.readFileSync(file, "utf8");
}

describe("the scripts", () => {
  test("parse", () => {
    childProcess.execFileSync("bash", ["-n", RECORD]);
    childProcess.execFileSync(process.execPath, ["--check", READ]);
  });

  test("stop nova-compute only long enough, and always try to start it again", () => {
    const script = read(RECORD);

    expect(script).toContain("sudo systemctl stop devstack@n-cpu.service");
    expect(script.indexOf("sudo systemctl stop devstack@n-cpu.service")).toBeLessThan(
      script.indexOf("sudo systemctl start devstack@n-cpu.service"),
    );
    expect(script).toContain("read_cloud compute-down");
  });

  test("plant a password in an instance's user data, as text and as Nova hands it back", () => {
    const script = read(RECORD);

    expect(script).toContain('--user-data "$USER_DATA_FILE"');
    expect(script).toContain(
      'AI_AGENT_PLANTED_SECRETS="$PLANTED_SECRET,$(base64 -w0 "$USER_DATA_FILE")"',
    );
  });

  test("the driver goes through the agent's own factory, and its own policy", () => {
    const driver = read(READ);

    expect(driver).toContain('path.join(dist, "Executors", "ExecutorFactory.js")');
    expect(driver).toContain("ResourceCommandPolicy.evaluateArgv");
    expect(driver).toContain("executor.prepare(");
    // Nothing but what the policy tiers Read gets as far as the cloud.
    expect(driver).toContain('policy.tier !== "Read"');
    expect(driver).not.toContain("transport");
  });

  test("every command the policy allows has its way to an ID, or needs none", () => {
    const routes = Array.from(
      read(POLICY).matchAll(/^ {4}command: "([a-z ]+)",$/gm),
    ).map((match) => {
      return match[1];
    });

    expect(routes.length).toBeGreaterThan(30);

    const driver = read(READ);
    const sources = driver.slice(
      driver.indexOf("const SOURCE_OF_IDS"),
      driver.indexOf("const EXTRA_WORDS"),
    );

    for (const command of routes) {
      const needsAnId =
        / show$/.test(command) || /(event|inventory) list$/.test(command);

      // A request's ID comes from what server event list printed.
      if (!needsAnId || command === "server event show") {
        continue;
      }

      expect({ command, hasSource: sources.includes(`"${command}":`) }).toEqual({
        command,
        hasSource: true,
      });
    }
  });
});

describe("the importer", () => {
  const IMPORTER = path.join(RIG, "import-ai-agent-recording.py");
  const SHORT = "runnervm48cm3";
  const FULL = `${SHORT}.ud5ijlraqheefht0kqil2otfyc.xx.internal.cloudapp.net`;
  let folder;

  function record(scene, summary, printed) {
    const directory = path.join(folder, "ai-agent", scene);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "summary.json"),
      JSON.stringify(summary),
    );
    fs.writeFileSync(path.join(directory, "001-hypervisor-list.txt"), printed);
  }

  function run() {
    return childProcess.spawnSync(
      "python3",
      ["-I", IMPORTER, folder, path.join(folder, "fixtures"), "hibiscus-ovn"],
      { encoding: "utf8" },
    );
  }

  function imported(scene) {
    return read(
      path.join(
        folder,
        "fixtures",
        "ai-agent",
        "hibiscus-ovn",
        scene,
        "001-hypervisor-list.txt",
      ),
    );
  }

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), "ou-ai-agent-import-"));
  });

  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });

  test("gives the runner the one name every fixture uses, in both its forms", () => {
    const printed = `$ openstack hypervisor list\n${FULL} ${SHORT} down\n`;
    for (const scene of ["healthy", "compute-down"]) {
      record(scene, { host: SHORT, problems: [] }, printed);
    }

    expect(run().status).toBe(0);
    expect(imported("compute-down")).toBe(
      "$ openstack hypervisor list\ncompute-01.example.internal compute-01 down\n",
    );
    expect(imported("healthy")).not.toContain(SHORT);
  });

  test("a run that reported a problem leaves what is there as it was", () => {
    const printed = `$ openstack hypervisor list\n${SHORT} up\n`;
    for (const scene of ["healthy", "compute-down"]) {
      record(scene, { host: SHORT, problems: [] }, printed);
    }
    expect(run().status).toBe(0);

    record("compute-down", { host: SHORT, problems: ["no"] }, "broken\n");

    const refused = run();
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("compute-down");
    expect(imported("compute-down")).toContain("compute-01 up");
  });

  test("a run that stopped before a scene is refused too", () => {
    record("healthy", { host: SHORT, problems: [] }, "x\n");

    expect(run().status).not.toBe(0);
  });
});

describe("the workflow", () => {
  const workflow = yaml.load(read(WORKFLOW));
  const job = workflow.jobs["ai-agent"];

  test("runs it on its own, on one DevStack, by a word on the command line", () => {
    const on = workflow.on || workflow[true];

    expect(on.workflow_dispatch.inputs.ai_agent_only.type).toBe("boolean");
    expect(job.if).toContain("inputs.ai_agent_only");
    expect(job.strategy).toBeUndefined();
    expect(workflow.jobs.record.if).toContain("!inputs.ai_agent_only");
    expect(workflow.jobs["record-control-plane"].if).toContain(
      "!inputs.ai_agent_only",
    );
  });

  test("holds no runner on a pull request", () => {
    expect(job.if).not.toContain("pull_request");
    expect(job.if).toContain("github.event_name == 'schedule'");
  });

  test("builds the estate before it reads, and keeps what it read even when it fails", () => {
    const names = job.steps.map((step) => {
      return step.name || step.uses;
    });

    expect(names.indexOf("Build the estate")).toBeLessThan(
      names.findIndex((name) => {
        return name.startsWith("Run the agent's real code");
      }),
    );

    const upload = job.steps.find((step) => {
      return step.name === "Upload what it read";
    });

    expect(upload.if).toBe("always()");
    expect(upload.with.name).toBe("openstack-ai-agent");
  });

  test("the README says what it does and what it does not prove", () => {
    const readme = read(path.join(RIG, "README.md"));

    expect(readme).toContain("`ai-agent-record.sh`");
    expect(readme).toContain("`-f ai_agent_only=true`");
    expect(readme).toContain("The model is not called");
  });
});
