"use strict";

/**
 * .github/workflows/marketplace-release.yml ships a OneUptime release to the AWS Marketplace,
 * Microsoft Marketplace and Google Cloud Marketplace listings of self-hosted OneUptime
 * Enterprise (packages/Common/Server/Utils/Marketplace/SELF_HOSTED_RELEASING.md).
 *
 * Nothing at runtime notices most of what makes it safe, so this suite pins it:
 *
 *   - it runs after the release workflow (by its exact name), only once that run succeeded
 *     and MARKETPLACE_RELEASES is "enabled", or by hand - where it is a dry run unless asked;
 *   - it holds no secret: every cloud is signed in to with GitHub's OIDC token, which only the
 *     jobs that sign in may ask for, and the token's subject is one of two environments the
 *     one-time setup (HelmChart/Marketplace/automation/ci_setup.py) trusts;
 *   - every job that publishes - adds an AWS version, changes or publishes the Microsoft offer -
 *     runs in marketplace-publish, so it waits for a maintainer's approval; the jobs that only
 *     push run in marketplace-push; the rest run in neither;
 *   - no workflow expression is pasted into a script: values reach scripts through env;
 *   - every edition is built from the chart as it was released (the marketplace-edition
 *     action, given the release's commit), and checked by the marketplace suite first;
 *   - one run at a time, and none cancelled halfway;
 *   - the scripts it runs exist, and crane is pinned by its sha256.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = ".github/workflows/marketplace-release.yml";
const RELEASE_WORKFLOW = ".github/workflows/release.yml";
const EDITION_ACTION = ".github/actions/marketplace-edition/action.yml";
const SETUP_SCRIPT = "HelmChart/Marketplace/automation/ci_setup.py";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const workflow = yaml.load(read(WORKFLOW));
const action = yaml.load(read(EDITION_ACTION));
const jobs = workflow.jobs;

const PUBLISHING_JOBS = ["aws-publish", "azure-publish", "azure-go-live"];
const PUSHING_JOBS = ["aws-push", "azure-push", "google-cloud-push"];
const SIGNING_IN_JOBS = [...PUSHING_JOBS, ...PUBLISHING_JOBS];

// What the steps of a job run, joined.
function scriptsOf(job) {
  return (job.steps || [])
    .map((step) => {
      return step.run || "";
    })
    .join("\n");
}

describe(WORKFLOW, () => {
  test("runs after the release workflow, by that workflow's exact name, on the release branch", () => {
    const release = yaml.load(read(RELEASE_WORKFLOW));
    expect(workflow.on.workflow_run).toEqual({
      workflows: [release.name],
      types: ["completed"],
      branches: ["release"],
    });
  });

  test("runs on nothing else but by hand, and by hand it is a dry run unless asked", () => {
    expect(Object.keys(workflow.on).sort()).toEqual([
      "workflow_dispatch",
      "workflow_run",
    ]);
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.dry_run).toMatchObject({ type: "boolean", default: true });
    expect(inputs.action.options).toEqual(["release", "azure-go-live"]);
    expect(inputs.action.default).toBe("release");
  });

  test("starts after a release only once it succeeded and releases are enabled", () => {
    expect(jobs.prepare.if).toContain(
      "github.event.workflow_run.conclusion == 'success'",
    );
    expect(jobs.prepare.if).toContain("vars.MARKETPLACE_RELEASES == 'enabled'");
    expect(jobs.prepare.if).toContain(
      "github.event_name == 'workflow_dispatch'",
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
      const scripts = scriptsOf(job);
      const publishes =
        /aws_catalog\.py submit|partner_center\.py (update-bundle|publish)/.test(
          scripts,
        );
      const pushes =
        /mirror-images\.sh "\$OUT\/images\.json"$|helm push|cpa buildbundle|--push/m.test(
          scripts,
        );

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
    expect(jobs["azure-go-live"].if).toContain(
      "needs.prepare.outputs.action == 'azure-go-live'",
    );
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

  test("builds every edition from the released chart, after the marketplace suite passed", () => {
    expect(scriptsOf(jobs.test)).toContain(
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

  test("takes the chart as it was released, whole", () => {
    const take = action.runs.steps.find((step) => {
      return step.name === "Take the released chart";
    });
    expect(take.run).toContain("rm -rf HelmChart/Public/oneuptime");
    expect(take.run).toContain(
      "git checkout FETCH_HEAD -- HelmChart/Public/oneuptime",
    );
    expect(take.run).not.toContain("${{");
  });
});
