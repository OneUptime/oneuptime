"use strict";

/**
 * The test jobs pull Docker Hub images through mirror.gcr.io.
 *
 * Common Test, App Test, the Enterprise Edition and Ops Config tests, Postgres
 * Schema Drift and Terraform Provider E2E pull postgres, valkey and clickhouse
 * from Docker Hub, without an account. On 2026-10-09 (~21:26 UTC, fb78dc289a)
 * Docker Hub's token service timed out and answered "unauthenticated pull rate
 * limit" to every one of those pulls, and all of those jobs failed before
 * running a test.
 *
 * .github/actions/docker-hub-mirror adds mirror.gcr.io to the runner's Docker
 * daemon (Scripts/GHA/use_docker_hub_mirror.sh), with Docker Hub still behind
 * it. It only helps a job that runs it before its first pull, and nothing at
 * runtime notices a job that does not: the pull just goes back to Docker Hub.
 *
 * It is also only for jobs that pull other people's images. A registry mirror
 * answers for a tag with whatever image it holds under that tag, and the
 * daemon takes that answer without asking Docker Hub. The e2e jobs of
 * test-release.yaml and release.yml pull OneUptime's own images from Docker
 * Hub under tags every master push or release pushes again
 * (oneuptime/app:enterprise-<version>-test, ...): through a mirror holding an
 * older image under the same tag, they would test that older image and pass.
 *
 * So this suite holds
 *
 *   - every job that sets up the test services (packages/Common/test-setup.sh,
 *     which pulls postgres and valkey) to running the action after its
 *     checkout and before that step;
 *   - each job of MIRRORED_JOBS to running it before the first step that can
 *     pull from Docker Hub, and no other job to running it at all;
 *   - every service container in every workflow to naming its registry: the
 *     runner pulls those before the first step, so the daemon's mirror never
 *     applies to them, and a bare "postgres:15" is an anonymous Docker Hub pull;
 *   - the action to running the script, so the two cannot drift apart.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { stepCommand } = require("./Utils/WorkflowStep");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = ".github/workflows";
const MIRROR_ACTION = "./.github/actions/docker-hub-mirror";
const MIRROR_ACTION_FILE = ".github/actions/docker-hub-mirror/action.yml";
const MIRROR_SCRIPT = "Scripts/GHA/use_docker_hub_mirror.sh";

/*
 * The jobs that run the mirror action, "<workflow file>: <job id>", and what
 * their first step that can pull from Docker Hub runs. Every image these jobs
 * pull from Docker Hub is a third party's (postgres, valkey, clickhouse, the
 * OpenTelemetry collector, OBI); add a job here only if that holds for it
 * too.
 */
const MIRRORED_JOBS = {
  // test-setup.sh starts postgres and valkey.
  "test.common.yaml: test": "test-setup.sh",
  "test.ee.yaml: test": "test-setup.sh",
  "test.app.yaml: test": "test-setup.sh",
  // Seeds public.ecr.aws's node image, from Docker Hub when ECR will not
  // serve it; the collector, OBI and VMware install tests pull after it.
  "test.ops.yaml: test": "warm_base_images.sh",
  // The same warm-up, then `npm run dev` brings up postgres, valkey and
  // clickhouse (app and ingress are built from source).
  "terraform-provider-e2e.yml: terraform-e2e-tests": "warm_base_images.sh",
};

/*
 * Registries a service container may name. A bare name or a docker.io one is
 * an anonymous Docker Hub pull before any step runs.
 */
const SERVICE_REGISTRIES = ["mirror.gcr.io/", "ghcr.io/", "public.ecr.aws/"];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function workflowFiles() {
  return fs
    .readdirSync(path.join(REPO_ROOT, WORKFLOWS_DIR))
    .filter((name) => {
      return name.endsWith(".yml") || name.endsWith(".yaml");
    })
    .sort();
}

function jobsOf(file) {
  const workflow = yaml.load(read(path.join(WORKFLOWS_DIR, file))) || {};
  return Object.entries(workflow.jobs || {});
}

function allJobs() {
  const jobs = [];
  for (const file of workflowFiles()) {
    for (const [jobId, job] of jobsOf(file)) {
      jobs.push({ key: `${file}: ${jobId}`, steps: job.steps || [], job });
    }
  }
  return jobs;
}

function stepLabel(step) {
  return step.name || step.uses || stepCommand(step).split("\n")[0];
}

function isCheckout(step) {
  return (
    typeof step.uses === "string" && step.uses.startsWith("actions/checkout@")
  );
}

function isMirror(step) {
  return step.uses === MIRROR_ACTION;
}

/*
 * Index of the first step of the job matching `matches`, or -1.
 */
function firstStep(steps, matches) {
  return steps.findIndex((step) => {
    return matches(step);
  });
}

function expectMirrorBefore(key, steps, pullIndex) {
  const checkout = firstStep(steps, isCheckout);
  const mirror = firstStep(steps, isMirror);

  expect({
    job: key,
    mirrorStep: mirror >= 0,
  }).toEqual({ job: key, mirrorStep: true });
  // The action runs a script from the repository, so the checkout comes
  // first; and it only helps pulls that come after it.
  expect({ job: key, afterCheckout: mirror > checkout }).toEqual({
    job: key,
    afterCheckout: true,
  });
  expect({
    job: key,
    beforeFirstPull: mirror < pullIndex,
    firstPull: stepLabel(steps[pullIndex]),
  }).toEqual({
    job: key,
    beforeFirstPull: true,
    firstPull: stepLabel(steps[pullIndex]),
  });
}

describe("test jobs pull Docker Hub images through mirror.gcr.io", () => {
  test("every job that sets up the test services runs the mirror action first", () => {
    const covered = [];

    for (const { key, steps } of allJobs()) {
      const setup = firstStep(steps, (step) => {
        return stepCommand(step).includes("test-setup.sh");
      });
      if (setup < 0) {
        continue;
      }
      covered.push(key);
      expectMirrorBefore(key, steps, setup);
    }

    // The suite finds the jobs it is about (test-setup.sh is Common's).
    expect(covered).toEqual(
      expect.arrayContaining([
        "test.app.yaml: test",
        "test.common.yaml: test",
        "test.ee.yaml: test",
      ]),
    );
  });

  test.each(Object.entries(MIRRORED_JOBS))(
    "%s runs the mirror action before it can first pull from Docker Hub",
    (key, firstPull) => {
      const entry = allJobs().find((job) => {
        return job.key === key;
      });
      expect(entry).toBeDefined();

      const pull = firstStep(entry.steps, (step) => {
        return stepCommand(step).includes(firstPull);
      });
      expect({ job: key, pullStepFound: pull >= 0 }).toEqual({
        job: key,
        pullStepFound: true,
      });
      expectMirrorBefore(key, entry.steps, pull);
    },
  );

  test("no other job runs the mirror action", () => {
    const mirrored = allJobs()
      .filter(({ steps }) => {
        return steps.some(isMirror);
      })
      .map(({ key }) => {
        return key;
      });

    expect(mirrored.sort()).toEqual(Object.keys(MIRRORED_JOBS).sort());
  });

  test("every service container names a registry, never Docker Hub", () => {
    const services = [];

    for (const { key, job } of allJobs()) {
      for (const [name, service] of Object.entries(job.services || {})) {
        const image = typeof service === "string" ? service : service.image;
        services.push({
          service: `${key}: ${name}`,
          image,
          fromARegistry: SERVICE_REGISTRIES.some((registry) => {
            return String(image).startsWith(registry);
          }),
          // Never one of OneUptime's own images through the mirror, for the
          // reason the e2e jobs do not use it.
          oneUptimeThroughMirror: String(image).startsWith(
            "mirror.gcr.io/oneuptime/",
          ),
        });
      }
    }

    expect(services.length).toBeGreaterThan(0);
    for (const entry of services) {
      expect(entry).toEqual({
        ...entry,
        fromARegistry: true,
        oneUptimeThroughMirror: false,
      });
    }
  });

  test("the action runs the mirror script", () => {
    const action = yaml.load(read(MIRROR_ACTION_FILE));
    expect(action.runs.using).toBe("composite");
    expect(
      action.runs.steps.map((step) => {
        return step.run;
      }),
    ).toEqual([`bash ${MIRROR_SCRIPT}`]);
    expect(fs.existsSync(path.join(REPO_ROOT, MIRROR_SCRIPT))).toBe(true);
  });
});
