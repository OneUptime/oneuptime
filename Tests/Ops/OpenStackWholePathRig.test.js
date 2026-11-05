"use strict";

/**
 * The job that runs real data all the way from a cloud to a running OneUptime. It takes three hours
 * of a runner, so what can go wrong without one is checked here: that it only runs when asked for,
 * and takes no other job with it, that what it holds a cloud to is what estate.sh makes, and that
 * what it lifts from the docs and the product is still there to lift.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const RIG = path.join(__dirname, "openstack-e2e");
const WALK = fs.readFileSync(path.join(RIG, "whole-path.py"), "utf8");
const WORKFLOW = yaml.load(
  fs.readFileSync(
    path.join(ROOT, ".github", "workflows", "test.openstack-e2e.yaml"),
    "utf8",
  ),
);
const JOB = WORKFLOW.jobs["whole-path"];

function stepNamed(name) {
  return JOB.steps.find((step) => {
    return step.name === name;
  });
}

describe("the whole-path job", () => {
  test("runs only when asked for by name, with a limit of its own", () => {
    expect(JOB.if).toBe("${{ inputs.whole_path }}");
    expect(WORKFLOW.on.workflow_dispatch.inputs.whole_path.type).toBe(
      "boolean",
    );
    expect(WORKFLOW.on.workflow_dispatch.inputs.whole_path.default).toBe(false);
    expect(JOB["timeout-minutes"]).toBeGreaterThan(0);
    expect(JOB["timeout-minutes"]).toBeLessThanOrEqual(240);
  });

  test("takes none of the jobs that run on any other dispatch with it", () => {
    for (const name of ["record", "record-control-plane"]) {
      expect(WORKFLOW.jobs[name].if).toContain("!inputs.whole_path");
    }
  });

  test("builds what it tests from the branch, before DevStack leaves a build less memory", () => {
    const names = JOB.steps.map((step) => {
      return step.name || step.uses;
    });
    const built = names.indexOf(
      "Build the app and the probe from this branch, and pull the rest of the stack",
    );
    const script = JOB.steps[built].run;

    expect(script).toContain("--tag oneuptime/app:test");
    expect(script).toContain("--tag oneuptime/probe:test");
    expect(built).toBeLessThan(
      names.indexOf("Deploy DevStack with every API behind TLS"),
    );
  });

  test("keeps every API behind TLS, because a probe never sends a credential over plain HTTP", () => {
    const deploy = stepNamed("Deploy DevStack with every API behind TLS");

    expect(deploy.with.enabled_services).toBe("tls-proxy");
    // A certificate's CN holds 64 characters, and a hosted runner's full name can be 65.
    expect(
      JOB.steps.findIndex((step) => {
        return step.name === "Give the runner a name a certificate can hold";
      }),
    ).toBeLessThan(JOB.steps.indexOf(deploy));
  });

  test("moves OneUptime off the ports DevStack's Apache holds, and tells the walk where it went", () => {
    const start = stepNamed("Start OneUptime").run;

    expect(start).toContain("ONEUPTIME_HTTP_PORT=8880");
    expect(start).toContain("STATUS_PAGE_HTTPS_PORT=8843");
    expect(stepNamed("Walk the whole path").env.ONEUPTIME_URL).toBe(
      "http://localhost:8880",
    );
  });

  test("keeps what it found whichever way the walk ends", () => {
    for (const name of [
      "Keep what the containers said",
      "Upload what each check found",
    ]) {
      expect(stepNamed(name).if).toBe("always()");
    }
  });
});

describe("what the walk reads", () => {
  test("is Python the runner's own can run, with only the standard library", () => {
    const parsed = spawnSync(
      "python3",
      [
        "-I",
        "-c",
        "import ast, sys; ast.parse(open(sys.argv[1]).read())",
        path.join(RIG, "whole-path.py"),
      ],
      { encoding: "utf8" },
    );

    expect(parsed.stderr).toBe("");
    expect(parsed.status).toBe(0);

    const imported = [...WALK.matchAll(/^import (\S+)$/gm)].map((match) => {
      return match[1];
    });

    expect(imported.sort()).toEqual([
      "importlib.util",
      "json",
      "os",
      "re",
      "secrets",
      "shlex",
      "subprocess",
      "sys",
      "tempfile",
      "time",
      "urllib.parse",
    ]);
  });

  test("holds a cloud to names estate.sh really makes", () => {
    const estate = fs.readFileSync(path.join(RIG, "estate.sh"), "utf8");
    const estateBlock = WALK.slice(
      WALK.indexOf("ESTATE = {"),
      WALK.indexOf("\n}\n", WALK.indexOf("ESTATE = {")),
    );
    const names = [...estateBlock.matchAll(/"(ou[-.][^"]+)":/g)].map(
      (match) => {
        return match[1];
      },
    );

    expect(names.length).toBeGreaterThan(10);

    for (const name of names) {
      expect({ name, inEstate: estate.includes(name) }).toEqual({
        name,
        inEstate: true,
      });
    }
  });

  test("makes its monitor from a template that exists, and from nothing written out here", () => {
    const templates = fs.readFileSync(
      path.join(ROOT, "packages/Common/Types/Monitor/OpenStackAlertTemplates.ts"),
      "utf8",
    );

    expect(WALK).toContain('TEMPLATE_ID = "openstack-compute-service-down"');
    expect(templates).toContain('id: "openstack-compute-service-down"');
    expect(templates).toContain('name: "Compute Service Down"');
    expect(WALK).not.toContain("openstack_nova_agent_state");
    expect(fs.existsSync(path.join(RIG, "whole-path-template.ts"))).toBe(true);
  });

  test("lifts the commands it runs off the docs, and they are still there", () => {
    const page = fs.readFileSync(
      path.join(
        ROOT,
        "packages/App/FeatureSet/Docs/Content/en/telemetry/openstack.md",
      ),
      "utf8",
    );

    expect(page).toMatch(
      /^```bash\ncurl -fsSLO https:\/\/oneuptime\.com\/install\/openstack-agent\/install-traces\.sh\n[^`]*?\n```$/m,
    );

    const probeDocs = fs.readFileSync(
      path.join(
        ROOT,
        "packages/App/FeatureSet/Docs/Content/en/probe/custom-probe.md",
      ),
      "utf8",
    );

    expect(probeDocs).toContain(
      "docker run --name oneuptime-probe --network host",
    );
    expect(WALK).toContain(
      "docker run --name oneuptime-probe --network host -e PROBE_KEY -e PROBE_ID -e ONEUPTIME_URL -d oneuptime/probe:test",
    );
  });

  test("keeps no credential's output, because nothing knows it is a secret until it has been read", () => {
    const made = WALK.slice(
      WALK.indexOf("def make_credential"),
      WALK.indexOf("def level_one_credential"),
    );

    expect(made).toContain("keep_output=False");
    expect(made).toContain('secret(answer.get("secret")');
  });
});
