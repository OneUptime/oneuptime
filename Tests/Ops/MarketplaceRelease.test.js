"use strict";

/**
 * .github/workflows/marketplace-release.yml ships OneUptime releases to the AWS Marketplace,
 * Microsoft Marketplace and Google Cloud Marketplace listings of self-hosted OneUptime
 * Enterprise, and to the Kubernetes agent's Amazon EKS add-on on AWS Marketplace
 * (packages/Common/Server/Utils/Marketplace/SELF_HOSTED_RELEASING.md).
 *
 * Nothing at runtime notices most of what makes it safe, so this suite pins it:
 *
 *   - it runs once a week on the newest release (the newest #.#.# tag), once
 *     MARKETPLACE_RELEASES is "enabled", or by hand - where it is a dry run unless asked;
 *   - each push job first asks its marketplace whether it has the release already, and then
 *     pushes nothing, and its publishing job neither runs nor waits for an approval - and the
 *     weekly run adds no EKS add-on version while another is still on its way or in testing;
 *   - it holds no secret: every cloud is signed in to with GitHub's OIDC token, which only the
 *     jobs that sign in may ask for, and the token's subject is one of two environments the
 *     one-time setup (HelmChart/Marketplace/automation/ci_setup.py) trusts;
 *   - every job that publishes - adds an AWS version, changes or publishes the Microsoft offer -
 *     runs in marketplace-publish, so it waits for a maintainer's approval; the jobs that only
 *     push run in marketplace-push; the rest run in neither;
 *   - no workflow expression is pasted into a script: values reach scripts through env;
 *   - every edition is built from the charts as they were released (the marketplace-edition
 *     action, given the release's commit), and checked by the marketplace suite first;
 *   - one run at a time, and none cancelled halfway;
 *   - the scripts it runs exist, and crane is pinned by its sha256.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = ".github/workflows/marketplace-release.yml";
const EDITION_ACTION = ".github/actions/marketplace-edition/action.yml";
const SETUP_SCRIPT = "HelmChart/Marketplace/automation/ci_setup.py";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const workflow = yaml.load(read(WORKFLOW));
const action = yaml.load(read(EDITION_ACTION));
const jobs = workflow.jobs;

const PUBLISHING_JOBS = [
  "aws-publish",
  "azure-publish",
  "azure-go-live",
  "aws-eks-addon-publish",
];
const PUSHING_JOBS = [
  "aws-push",
  "azure-push",
  "google-cloud-push",
  "aws-eks-addon-push",
];
const SIGNING_IN_JOBS = [...PUSHING_JOBS, ...PUBLISHING_JOBS];

// What a script that publishes, or pushes, runs.
const PUBLISHES =
  /aws_catalog\.py submit|partner_center\.py (update-bundle|publish)/;
const PUSHES =
  /mirror-images\.sh "\$OUT\/images\.json"$|helm push|cpa buildbundle|--push/m;

// What the steps of a job run, joined.
function scriptsOf(steps) {
  return (steps || [])
    .map((step) => {
      return step.run || "";
    })
    .join("\n");
}

function stepOf(job, id) {
  return jobs[job].steps.find((step) => {
    return step.id === id;
  });
}

describe(WORKFLOW, () => {
  test("runs once a week", () => {
    expect(workflow.on.schedule).toHaveLength(1);
    const fields = workflow.on.schedule[0].cron.split(" ");
    expect(fields).toHaveLength(5);

    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
    expect(minute).toMatch(/^\d+$/);
    expect(hour).toMatch(/^\d+$/);
    expect([dayOfMonth, month]).toEqual(["*", "*"]);
    expect(dayOfWeek).toMatch(/^[0-6]$/);
  });

  test("runs on nothing else but by hand, and by hand it is a dry run unless asked", () => {
    expect(Object.keys(workflow.on).sort()).toEqual([
      "schedule",
      "workflow_dispatch",
    ]);
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.dry_run).toMatchObject({ type: "boolean", default: true });
    expect(inputs.action.options).toEqual(["release", "azure-go-live"]);
    expect(inputs.action.default).toBe("release");
  });

  test("starts on its own only once releases are enabled", () => {
    expect(jobs.prepare.if).toBe(
      "github.event_name == 'workflow_dispatch' || vars.MARKETPLACE_RELEASES == 'enabled'",
    );
  });

  test("runs one at a time, and never cancels a run halfway", () => {
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
    expect(workflow.concurrency.group).toContain("github.workflow");
  });

  test("holds no secret", () => {
    expect(read(WORKFLOW)).not.toMatch(/secrets\./);
  });

  test("grants nothing by default, and each job only what it needs", () => {
    expect(workflow.permissions).toEqual({});

    for (const [name, job] of Object.entries(jobs)) {
      const expected = SIGNING_IN_JOBS.includes(name)
        ? { contents: "read", "id-token": "write" }
        : { contents: "read" };
      expect({ job: name, permissions: job.permissions }).toEqual({
        job: name,
        permissions: expected,
      });
    }
  });

  test("publishes only from marketplace-publish, which waits for a maintainer", () => {
    for (const [name, job] of Object.entries(jobs)) {
      const scripts = scriptsOf(job.steps);
      const publishes = PUBLISHES.test(scripts);
      const pushes = PUSHES.test(scripts);

      if (PUBLISHING_JOBS.includes(name)) {
        expect({ job: name, publishes, environment: job.environment }).toEqual({
          job: name,
          publishes: true,
          environment: "marketplace-publish",
        });
      } else if (PUSHING_JOBS.includes(name)) {
        expect({
          job: name,
          publishes,
          pushes,
          environment: job.environment,
        }).toEqual({
          job: name,
          publishes: false,
          pushes: true,
          environment: "marketplace-push",
        });
      } else {
        expect({
          job: name,
          publishes,
          pushes,
          environment: job.environment,
        }).toEqual({
          job: name,
          publishes: false,
          pushes: false,
          environment: undefined,
        });
      }
    }
  });

  test("signs in only through the environments the one-time setup trusts", () => {
    const setup = read(SETUP_SCRIPT);
    expect(setup).toContain(
      'ENVIRONMENTS = ("marketplace-push", "marketplace-publish")',
    );
  });

  test("pushes and publishes only on a real run of a release", () => {
    for (const name of PUSHING_JOBS) {
      expect(jobs[name].if).toContain(
        "needs.prepare.outputs.dry_run == 'false'",
      );
      expect(jobs[name].if).toContain(
        "needs.prepare.outputs.release == 'true'",
      );
      expect(jobs[name].needs).toEqual(["prepare", "test"]);
    }

    expect(jobs["aws-publish"].needs).toEqual(["prepare", "aws-push"]);
    expect(jobs["azure-publish"].needs).toEqual(["prepare", "azure-push"]);
    expect(jobs["aws-eks-addon-publish"].needs).toEqual([
      "prepare",
      "aws-eks-addon-push",
    ]);
    expect(jobs["aws-eks-addon-push"].if).toContain(
      "needs.prepare.outputs.aws_eks_addon == 'true'",
    );
    expect(jobs["azure-go-live"].if).toContain(
      "needs.prepare.outputs.action == 'azure-go-live'",
    );
  });

  test("asks each marketplace whether it has the release first, and pushes nothing it has", () => {
    expect(stepOf("aws-push", "shipped").run).toContain(
      'aws_catalog.py shipped --version "$VERSION"',
    );
    expect(stepOf("azure-push", "shipped").run).toContain(
      'partner_center.py shipped --tag "$VERSION"',
    );
    expect(stepOf("google-cloud-push", "shipped").run).toContain(
      'crane digest "${registry}/deployer:${VERSION}"',
    );
    expect(stepOf("aws-eks-addon-push", "shipped").run).toContain(
      'aws_catalog.py shipped --edition aws-eks-addon --version "$VERSION"',
    );

    for (const name of PUSHING_JOBS) {
      const steps = jobs[name].steps;
      const check = steps.findIndex((step) => {
        return step.id === "shipped";
      });
      expect(jobs[name].outputs.shipped).toBe(
        "${{ steps.shipped.outputs.shipped }}",
      );
      expect({
        job: name,
        pushesBeforeAsking: PUSHES.test(scriptsOf(steps.slice(0, check))),
      }).toEqual({ job: name, pushesBeforeAsking: false });

      for (const step of steps.slice(check + 1)) {
        expect({ job: name, step: step.name, if: step.if }).toEqual({
          job: name,
          step: step.name,
          if: "steps.shipped.outputs.shipped == 'false'",
        });
      }
    }
  });

  test("publishes only what a marketplace does not have, and asks no approval otherwise", () => {
    expect(jobs["aws-publish"].if).toBe(
      "needs.aws-push.outputs.shipped == 'false'",
    );
    expect(jobs["azure-publish"].if).toBe(
      "needs.azure-push.outputs.shipped == 'false'",
    );
    expect(jobs["aws-eks-addon-publish"].if).toBe(
      "needs.aws-eks-addon-push.outputs.shipped == 'false'",
    );
  });

  // What the add-on's check runs, with a python3 that only says what it was given.
  function addonCheck(automatic) {
    const step = stepOf("aws-eks-addon-push", "shipped");
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-addon-"));
    fs.writeFileSync(
      path.join(bin, "python3"),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n',
      { mode: 0o755 },
    );

    try {
      const result = spawnSync("bash", ["-c", step.run], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          VERSION: "14.0.66",
          AUTOMATIC: automatic,
        },
      });
      expect({ status: result.status, stderr: result.stderr }).toEqual({
        status: 0,
        stderr: "",
      });
      return result.stdout.split("\n").filter(Boolean);
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  }

  test("the weekly run waits while an EKS add-on version is on its way; a run by hand does not", () => {
    const step = stepOf("aws-eks-addon-push", "shipped");
    expect(step.env.AUTOMATIC).toBe("${{ needs.prepare.outputs.automatic }}");
    expect(jobs.prepare.outputs.automatic).toBe(
      "${{ steps.plan.outputs.automatic }}",
    );
    expect(jobs.prepare.outputs.aws_eks_addon).toBe(
      "${{ steps.plan.outputs.aws_eks_addon }}",
    );

    expect(addonCheck("true")).toEqual([
      "HelmChart/Marketplace/automation/aws_catalog.py",
      "shipped",
      "--edition",
      "aws-eks-addon",
      "--version",
      "14.0.66",
      "--wait-while-testing",
    ]);
    expect(addonCheck("false")).toEqual([
      "HelmChart/Marketplace/automation/aws_catalog.py",
      "shipped",
      "--edition",
      "aws-eks-addon",
      "--version",
      "14.0.66",
    ]);
  });

  test("adds an EKS add-on version for testing, never public: making it public is by hand", () => {
    const publish = scriptsOf(jobs["aws-eks-addon-publish"].steps);
    expect(publish).toContain("aws_catalog.py plan --edition aws-eks-addon");
    for (const job of Object.values(jobs)) {
      expect(scriptsOf(job.steps)).not.toContain("go-public");
    }
    expect(jobs["dry-run"].strategy.matrix.include).toContainEqual({
      marketplace: "aws-eks-addon",
      selected: "aws_eks_addon",
    });
  });

  test("pastes no expression into a script: values reach scripts through env", () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps || []) {
        if (step.run) {
          expect({
            job: name,
            step: step.name,
            expression: step.run.includes("${{"),
          }).toEqual({
            job: name,
            step: step.name,
            expression: false,
          });
        }
      }
    }
  });

  test("unit-tests the automation on this repository's charts, then checks the release's", () => {
    const steps = jobs.test.steps;
    const unitTests = steps.findIndex((step) => {
      return (step.run || "").includes(
        "python3 -m unittest discover -s HelmChart/Marketplace",
      );
    });
    const takeRelease = steps.findIndex((step) => {
      return step.uses === "./.github/actions/marketplace-edition";
    });
    const suite = steps.find((step) => {
      return (step.run || "").includes("run.sh marketplace");
    });

    // The unit tests test this repository's code: a release's charts may predate it.
    expect(unitTests).toBeGreaterThan(-1);
    expect(unitTests).toBeLessThan(takeRelease);
    // The suite is told its charts are a release's, so it skips what that release cannot have.
    expect(suite.env.MARKETPLACE_RELEASED_CHARTS).toBe(
      "${{ needs.prepare.outputs.version }}",
    );
  });

  test("builds every edition from the released chart, after the marketplace suite passed", () => {
    expect(scriptsOf(jobs.test.steps)).toContain(
      "bash ./HelmChart/Tests/run.sh marketplace",
    );

    for (const name of ["test", "dry-run", ...PUSHING_JOBS]) {
      const uses = jobs[name].steps.filter((step) => {
        return step.uses === "./.github/actions/marketplace-edition";
      });
      expect({ job: name, count: uses.length }).toEqual({
        job: name,
        count: 1,
      });
      expect(uses[0].with["release-sha"]).toBe(
        "${{ needs.prepare.outputs.release_sha }}",
      );
      expect(uses[0].with.version).toBe("${{ needs.prepare.outputs.version }}");
    }
  });

  test("runs only scripts that exist", () => {
    const text = read(WORKFLOW);
    const scripts = new Set(text.match(/HelmChart\/[A-Za-z/_.-]+\.(?:py|sh)/g));
    expect(scripts.size).toBeGreaterThan(4);

    for (const script of scripts) {
      expect({
        script,
        exists: fs.existsSync(path.join(REPO_ROOT, script)),
      }).toEqual({
        script,
        exists: true,
      });
    }
  });
});

// The prepare job's "Find the release" step, run against a repository of its own: release
// tags (lightweight, as the release workflow cuts them, and one annotated) and others.
describe(`${WORKFLOW}: finding the release`, () => {
  const find = stepOf("prepare", "release");
  const commits = {};
  let root;
  let clone;

  function git(cwd, ...args) {
    return execFileSync(
      "git",
      [
        "-c",
        "user.name=Marketplace Release Test",
        "-c",
        "user.email=marketplace-release-test@example.com",
        "-c",
        "commit.gpgSign=false",
        "-c",
        "tag.gpgSign=false",
        ...args,
      ],
      { cwd, encoding: "utf8" },
    ).trim();
  }

  // What the step writes to GITHUB_OUTPUT, given the version asked for.
  function run(versionInput) {
    const output = path.join(root, `output-${Math.random()}`);
    fs.writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", find.run], {
      cwd: clone,
      encoding: "utf8",
      env: {
        ...process.env,
        VERSION_INPUT: versionInput,
        GITHUB_OUTPUT: output,
      },
    });
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: "",
    });
    return fs.readFileSync(output, "utf8").split("\n").filter(Boolean);
  }

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-release-"));
    const origin = path.join(root, "origin");
    clone = path.join(root, "clone");
    fs.mkdirSync(origin);
    git(origin, "init", "-q");

    for (const [name, tags] of [
      ["first", ["14.0.9", "9.99.99"]],
      ["second", ["14.0.10"]],
      ["third", ["14.0.11-rc1", "v15.0.0", "15.0", "nightly"]],
    ]) {
      git(origin, "commit", "-q", "--allow-empty", "-m", name);
      commits[name] = git(origin, "rev-parse", "HEAD");

      for (const tag of tags) {
        git(origin, "tag", tag);
      }
    }

    git(origin, "tag", "-a", "14.0.8", "-m", "annotated", commits.first);
    git(root, "clone", "-q", origin, clone);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("is given the version asked for, and gives the plan the release and its commit", () => {
    expect(find.env.VERSION_INPUT).toBe("${{ inputs.version }}");
    const plan = stepOf("prepare", "plan");
    expect(plan.env.VERSION).toBe("${{ steps.release.outputs.version }}");
    expect(plan.env.RELEASE_SHA).toBe("${{ steps.release.outputs.sha }}");
    expect(jobs.prepare.outputs.release_sha).toBe(
      "${{ steps.release.outputs.sha }}",
    );
  });

  test("takes the newest release tag, by number, when none is asked for", () => {
    expect(run("")).toEqual(["version=14.0.10", `sha=${commits.second}`]);
  });

  test("takes the release asked for, and its commit even when its tag is annotated", () => {
    expect(run(" 14.0.9 ")).toEqual(["version=14.0.9", `sha=${commits.first}`]);
    expect(run("14.0.8")).toEqual(["version=14.0.8", `sha=${commits.first}`]);
  });

  test("finds no commit for a version that was not released", () => {
    expect(run("14.0.12")).toEqual(["version=14.0.12", "sha="]);
  });

  test("writes nothing but the version and its commit, whatever is asked for", () => {
    const lines = run("14.0.9\naws=true");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("version=14.0.9aws=true");
    expect(lines[1]).toBe("sha=");
  });
});

describe(EDITION_ACTION, () => {
  test("pins crane by the sha256 of its binary, fetched with backoff", () => {
    const install = action.runs.steps.find((step) => {
      return step.name === "Install crane";
    });
    expect(install.env.CRANE_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(install.env.CRANE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(install.run).toContain("Scripts/GHA/fetch_pinned_artifact.sh");
    expect(install.run).toContain('--sha256 "$CRANE_SHA256"');
  });

  test("takes the charts as they were released, whole", () => {
    const take = action.runs.steps.find((step) => {
      return step.name === "Take the released chart";
    });
    expect(take.run).toContain(
      "rm -rf HelmChart/Public/oneuptime HelmChart/Public/kubernetes-agent",
    );
    expect(take.run).toContain(
      "git checkout FETCH_HEAD -- HelmChart/Public/oneuptime HelmChart/Public/kubernetes-agent",
    );
    expect(take.run).not.toContain("${{");
  });
});
