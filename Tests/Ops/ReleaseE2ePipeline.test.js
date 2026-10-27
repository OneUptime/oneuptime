"use strict";

/**
 * How the release workflows run the e2e suite, and what keeps the master
 * pipeline (test-release.yaml) both fast and honest.
 *
 * test-release.yaml runs on every push to master. A started run is allowed to
 * finish - it used to be cancelled by the next merge, so master went most
 * days without an e2e result - which makes three things load-bearing:
 *
 *   - every job has a timeout, or one hang holds the queue for six hours;
 *   - every checkout is the commit that triggered the run. With
 *     `ref: ${{ github.ref }}` actions/checkout fetches the branch tip as of
 *     the moment the job starts, so a job that started after a newer push
 *     would build the newer commit, under this run's version;
 *   - prerun's Scripts/Install/configure.sh is told it is in CI
 *     (CI_PIPELINE_ID), or it `git pull`s, which moves the checkout too - and
 *     fetches every branch and tag first, ~45 seconds a job.
 *
 * release.yml is held to the same checkout rule, for the same reason: a
 * release run takes hours and its jobs start far apart, queued behind the
 * organization's concurrent-job limit, so a push to `release` mid-run would
 * have one release publish images of two commits, all tagged with its
 * version and labelled with its github.sha. A job stays on the branch tip
 * only from BRANCH_TIP_CHECKOUTS, which says why.
 *
 * The e2e jobs wait for the images of the stack they boot and nothing else:
 * they used to wait for the Helm chart test and, through it, a 35-minute
 * Terraform provider dry run. That is checked here against the compose files
 * themselves, because a job that started before one of its images was pushed
 * would not fail - it would test the previous push's image. In
 * test-release.yaml they wait for those images' builds, not their merges, and
 * run the amd64 tags the builds push (TestReleaseE2eImages.test.js).
 *
 * The SaaS and self-hosted suites run as shards (E2E_SHARD, see
 * packages/E2E/Sharding/Sharding.ts). packages/E2E's `npm run test-sharding`
 * proves, against Playwright's own --list, that the shard counts in its
 * WORKFLOW_SHARD_TOTALS add up to exactly the whole suite; this checks that
 * those are the counts the workflows run.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { ancestorsOf } = require("./Utils/ReleaseWorkflow");
const { evaluateExpressions } = require("./Utils/WorkflowExpression");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = ".github/workflows";
const TEST_RELEASE = `${WORKFLOWS_DIR}/test-release.yaml`;
const RELEASE = `${WORKFLOWS_DIR}/release.yml`;
const TERRAFORM_E2E = `${WORKFLOWS_DIR}/terraform-provider-e2e.yml`;
const SHARDING_SPEC = "packages/E2E/Sharding/Sharding.spec.ts";
const E2E_OVERLAY = "packages/E2E/docker-compose.e2e.yml";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readYaml(relativePath) {
  return yaml.load(read(relativePath));
}

function needsOf(job) {
  const needs = (job && job.needs) || [];
  return Array.isArray(needs) ? needs : [needs];
}

// What a step runs as shell: `run`, or the `command` of a retry step.
function commandOf(step) {
  if (typeof step.run === "string") {
    return step.run;
  }
  return step.with && typeof step.with.command === "string"
    ? step.with.command
    : "";
}

// The `ref` of a checkout that gets the commit that triggered the run:
// none (actions/checkout's default), or that commit by name.
const RUN_COMMIT_REFS = [undefined, "${{ github.sha }}"];

/**
 * The jobs that may check out the branch tip instead of the commit that
 * triggered the run, by workflow, as { job: "why it must" }. A job belongs
 * here only if it has to build on commits pushed after the run started - one
 * that commits and pushes back to the branch it runs on, say, whose push from
 * the run's own commit would be rejected as a non-fast-forward.
 *
 * No job does. helm-chart-deploy (release.yml) commits and pushes, but to
 * OneUptime/helm-chart's master, from a clone of its own: its checkout of this
 * repository is only the chart source it packages, and that has to be the
 * commit the rest of the run built and tested, not one pushed since. A
 * checkout of another repository is not held to the rule at all (see
 * checksOutThisRepository).
 */
const BRANCH_TIP_CHECKOUTS = {
  [TEST_RELEASE]: {},
  [RELEASE]: {},
};

/**
 * Whether a step checks out this repository: any actions/checkout, unless its
 * `repository` names another one outright. Another repository's checkout is
 * not this run's code, and may pin whatever ref it needs.
 * @param {Object} step
 * @returns {boolean}
 */
function checksOutThisRepository(step) {
  if (!/^actions\/checkout@/.test(step.uses || "")) {
    return false;
  }
  const repository = String((step.with || {}).repository || "");
  const another =
    /^[\w.-]+\/[\w.-]+$/.test(repository) &&
    repository.toLowerCase() !== "oneuptime/oneuptime";
  return !another;
}

/**
 * The jobs of a workflow's run, as [label, job]: its own, with each job that
 * calls a workflow of this repository (`uses: ./.github/workflows/...`)
 * replaced by the called workflow's jobs, labelled "caller -> job". Those run
 * inside the caller's run, against the same github.sha.
 * @param {string} relativePath
 * @returns {Array<[string, Object]>}
 */
function jobsOfRun(relativePath) {
  return Object.entries(readYaml(relativePath).jobs).flatMap(([name, job]) => {
    if (typeof job.uses !== "string" || !job.uses.startsWith("./")) {
      return [[name, job]];
    }
    return jobsOfRun(job.uses.slice(2)).map(([called, calledJob]) => {
      return [`${name} -> ${called}`, calledJob];
    });
  });
}

/**
 * The shard counts packages/E2E's test-sharding checks, read out of
 * Sharding.spec.ts (`const WORKFLOW_SHARD_TOTALS: Array<number> = [3, 4];`).
 * @returns {Array<number>}
 */
function verifiedShardTotals() {
  const match =
    /const WORKFLOW_SHARD_TOTALS: Array<number> = \[([\d,\s]*)\];/.exec(
      read(SHARDING_SPEC),
    );

  if (!match) {
    throw new Error(
      `${SHARDING_SPEC} no longer declares WORKFLOW_SHARD_TOTALS`,
    );
  }

  return match[1]
    .split(",")
    .map((value) => {
      return Number(value.trim());
    })
    .filter((value) => {
      return Number.isInteger(value) && value > 0;
    });
}

/**
 * The images a `docker compose -f a -f b ...` stack runs: each file's
 * services merged over the previous ones', minus services behind a profile
 * (nothing activates one), as "repository/name:tag" strings. Services with no
 * image of their own (postgres, valkey, clickhouse) get theirs from
 * docker-compose.base.yml and are third-party; they are left out.
 * @param {Array<string>} composeFiles
 * @returns {Array<string>}
 */
function stackImages(composeFiles) {
  const services = {};

  for (const file of composeFiles) {
    for (const [name, service] of Object.entries(
      readYaml(file).services || {},
    )) {
      services[name] = { ...(services[name] || {}), ...service };
    }
  }

  // Each image once, however many services run it.
  return [
    ...new Set(
      Object.values(services)
        .filter((service) => {
          return !service.profiles || service.profiles.length === 0;
        })
        .map((service) => {
          return service.image;
        })
        .filter(Boolean),
    ),
  ].sort();
}

/**
 * The merge job that publishes a OneUptime image, from its reference:
 * oneuptime/app:${APP_TAG} -> app-docker-image-merge. null for anything that
 * is not a OneUptime image built by the workflow.
 * @param {string} image
 * @returns {string|null}
 */
function mergeJobFor(image) {
  const match = /^(?:ghcr\.io\/)?oneuptime\/([a-z0-9-]+):\$\{APP_TAG\}$/.exec(
    image,
  );
  return match ? `${match[1]}-docker-image-merge` : null;
}

/**
 * The build job of a OneUptime image, from its reference:
 * oneuptime/app:${APP_TAG} -> app-docker-image-build. null for anything that
 * is not a OneUptime image built by the workflow.
 * @param {string} image
 * @returns {string|null}
 */
function buildJobFor(image) {
  const merge = mergeJobFor(image);
  return merge
    ? merge.replace(/-docker-image-merge$/, "-docker-image-build")
    : null;
}

// The compose files a job's `docker compose ... up ... -d` boots its stack with.
function startedStack(job) {
  const start = job.steps.map(commandOf).find((command) => {
    return /docker compose [^\n]*\bup\b[^\n]*\s-d\b/.test(command);
  });

  if (!start) {
    throw new Error("the job has no `docker compose ... up -d` step");
  }

  const line = start.split("\n").find((candidate) => {
    return /docker compose [^\n]*\bup\b[^\n]*\s-d\b/.test(candidate);
  });

  return [...line.matchAll(/-f (\S+\.ya?ml)/g)].map((match) => {
    return match[1];
  });
}

describe("the helpers this suite reads the workflows with", () => {
  test("merge compose files in order and drop services behind a profile", () => {
    const images = stackImages([
      "docker-compose.yml",
      "packages/E2E/docker-compose.billing.yml",
    ]);

    expect(images).toContain("oneuptime/home:${APP_TAG}");
    expect(images).toContain("oneuptime/app:${APP_TAG}");
    // The billing overlay puts the global Runner behind a profile.
    expect(images).not.toContain("oneuptime/runner:${APP_TAG}");
    expect(stackImages(["docker-compose.yml"])).toContain(
      "oneuptime/runner:${APP_TAG}",
    );
  });

  test("name each image once, however many services run it", () => {
    const images = stackImages(["docker-compose.yml"]);

    expect(
      images.filter((image) => {
        return image === "oneuptime/runner:${APP_TAG}";
      }),
    ).toHaveLength(1);
    expect(new Set(images).size).toBe(images.length);
  });

  test("name the merge job of a OneUptime image, and of nothing else", () => {
    expect(mergeJobFor("oneuptime/nginx:${APP_TAG}")).toBe(
      "nginx-docker-image-merge",
    );
    expect(mergeJobFor("ghcr.io/oneuptime/e2e:${APP_TAG}")).toBe(
      "e2e-docker-image-merge",
    );
    expect(mergeJobFor("postgres:15")).toBeNull();
    expect(mergeJobFor("oneuptime/app:release")).toBeNull();
  });

  test("name the build job of a OneUptime image, and of nothing else", () => {
    expect(buildJobFor("oneuptime/nginx:${APP_TAG}")).toBe(
      "nginx-docker-image-build",
    );
    expect(buildJobFor("ghcr.io/oneuptime/e2e:${APP_TAG}")).toBe(
      "e2e-docker-image-build",
    );
    expect(buildJobFor("postgres:15")).toBeNull();
    expect(buildJobFor("oneuptime/app:release")).toBeNull();
  });

  test("read the shard counts test-sharding checks", () => {
    expect(verifiedShardTotals().length).toBeGreaterThan(0);
  });

  test("tell a checkout of this repository from one of another", () => {
    const checkout = (inputs) => {
      return { uses: "actions/checkout@v4", with: inputs };
    };

    expect(checksOutThisRepository({ uses: "actions/checkout@v4" })).toBe(true);
    expect(checksOutThisRepository(checkout({ path: "src" }))).toBe(true);
    expect(
      checksOutThisRepository(
        checkout({ repository: "${{ github.repository }}" }),
      ),
    ).toBe(true);
    expect(
      checksOutThisRepository(checkout({ repository: "OneUptime/oneuptime" })),
    ).toBe(true);
    expect(
      checksOutThisRepository(checkout({ repository: "OneUptime/helm-chart" })),
    ).toBe(false);
    expect(checksOutThisRepository({ uses: "actions/setup-node@v4" })).toBe(
      false,
    );
  });

  test("read a run's jobs with those of the workflows it calls", () => {
    const labels = jobsOfRun(RELEASE).map(([label]) => {
      return label;
    });

    expect(labels).toContain("read-version");
    // The Terraform provider gate is a workflow of its own, called by a job.
    expect(labels).not.toContain("terraform-provider-e2e");
    expect(
      labels.filter((label) => {
        return label.startsWith("terraform-provider-e2e -> ");
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe(`${TEST_RELEASE}: a started run finishes`, () => {
  const workflow = readYaml(TEST_RELEASE);
  const jobs = Object.entries(workflow.jobs);

  test("one run at a time, and a run in progress is never cancelled", () => {
    expect(workflow.concurrency).toEqual({
      group: "test-release",
      "cancel-in-progress": false,
    });
  });

  test.each(jobs)("%s has a timeout", (_name, job) => {
    expect(Number.isInteger(job["timeout-minutes"])).toBe(true);
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
  });

  /*
   * generate-build-number creates a tag through the API, which can be
   * refused - it was, once, while a newer push changed the workflows - and
   * every job waiting for it is skipped when it fails. Only a job that reads
   * the number may wait for it, so a failed counter costs that job, not the
   * run's images and e2e.
   */
  test.each(jobs)(
    "%s waits for generate-build-number only if it reads the build number",
    (_name, job) => {
      const needs = needsOf(job);
      const reads = JSON.stringify(job.steps || []).includes(
        "needs.generate-build-number.outputs",
      );

      expect({
        waits: needs.includes("generate-build-number"),
      }).toEqual({ waits: reads });
    },
  );
});

describe.each([TEST_RELEASE, RELEASE])(
  "%s: every job builds the commit that triggered the run",
  (workflow) => {
    const jobs = jobsOfRun(workflow);
    const branchTip = BRANCH_TIP_CHECKOUTS[workflow];
    const mayCheckOutBranchTip = (label) => {
      return Object.prototype.hasOwnProperty.call(branchTip, label);
    };

    test("checks out code in its jobs (the check below is not vacuous)", () => {
      const checkouts = jobs.flatMap(([, job]) => {
        return (job.steps || []).filter(checksOutThisRepository);
      });

      expect(checkouts.length).toBeGreaterThan(20);
    });

    test.each(
      jobs.filter(([label]) => {
        return !mayCheckOutBranchTip(label);
      }),
    )(
      "%s checks out the commit that triggered the run, never the branch tip",
      (_label, job) => {
        for (const step of (job.steps || []).filter(checksOutThisRepository)) {
          expect(RUN_COMMIT_REFS).toContain((step.with || {}).ref);
        }
      },
    );

    test("lets a job check out the branch tip only if it says why, and still does", () => {
      const byLabel = new Map(jobs);
      const problems = Object.entries(branchTip).flatMap(([label, reason]) => {
        const job = byLabel.get(label);
        if (!job) {
          return [`${label} is not a job of this run`];
        }
        if (typeof reason !== "string" || reason.trim() === "") {
          return [`${label} does not say why it needs the branch tip`];
        }
        const onBranchTip = (job.steps || [])
          .filter(checksOutThisRepository)
          .some((step) => {
            return !RUN_COMMIT_REFS.includes((step.with || {}).ref);
          });
        return onBranchTip
          ? []
          : [`${label} checks out the run's own commit; take it off the list`];
      });

      expect(problems).toEqual([]);
    });
  },
);

describe("every CI job that runs prerun tells configure.sh it is in CI", () => {
  // `npm run prerun` ends in configure.sh; dev, force-build and update run it.
  const RUNS_CONFIGURE =
    /\bnpm run (?:prerun|dev|force-build|update)\b|Scripts\/Install\/configure\.sh/;

  const jobsRunningPrerun = fs
    .readdirSync(path.join(REPO_ROOT, WORKFLOWS_DIR))
    .filter((file) => {
      return /\.ya?ml$/.test(file);
    })
    .flatMap((file) => {
      const workflow = readYaml(`${WORKFLOWS_DIR}/${file}`);
      return Object.entries(workflow.jobs || {})
        .filter(([, job]) => {
          return (job.steps || []).some((step) => {
            return RUNS_CONFIGURE.test(commandOf(step));
          });
        })
        .map(([name, job]) => {
          return [`${file}: ${name}`, workflow, job];
        });
    });

  test("there are such jobs, the image builds among them", () => {
    expect(jobsRunningPrerun.length).toBeGreaterThan(20);
    expect(
      jobsRunningPrerun.map(([label]) => {
        return label;
      }),
    ).toContain("test-release.yaml: app-docker-image-build");
  });

  test.each(jobsRunningPrerun)(
    "%s sets CI_PIPELINE_ID, so configure.sh does not git pull",
    (_label, workflow, job) => {
      const set =
        "CI_PIPELINE_ID" in (workflow.env || {}) ||
        "CI_PIPELINE_ID" in (job.env || {}) ||
        (job.steps || []).every((step) => {
          return (
            !RUNS_CONFIGURE.test(commandOf(step)) ||
            "CI_PIPELINE_ID" in (step.env || {})
          );
        });

      expect(set).toBe(true);
    },
  );
});

const SHARDED_E2E_JOBS = [
  { workflow: TEST_RELEASE, job: "test-e2e-test-saas" },
  { workflow: TEST_RELEASE, job: "test-e2e-test-self-hosted" },
  { workflow: RELEASE, job: "test-e2e-release-saas" },
  { workflow: RELEASE, job: "test-e2e-release-self-hosted" },
];

describe.each(SHARDED_E2E_JOBS)(
  "$workflow $job: sharded",
  ({ workflow, job }) => {
    const definition = readYaml(workflow).jobs[job];

    test("runs shards 1..N for an N that test-sharding checks, and lets each finish", () => {
      const shards = definition.strategy.matrix.shard;

      expect(definition.strategy["fail-fast"]).toBe(false);
      expect(shards).toEqual(
        Array.from({ length: shards.length }, (_, index) => {
          return index + 1;
        }),
      );
      expect(verifiedShardTotals()).toContain(shards.length);
    });

    test("hands the e2e container its shard, on the step that runs the suite", () => {
      const run = definition.steps.filter((step) => {
        return /--exit-code-from e2e/.test(commandOf(step));
      });

      expect(run).toHaveLength(1);
      expect(run[0].env).toEqual({
        E2E_SHARD: "${{ matrix.shard }}/${{ strategy.job-total }}",
      });
      // The image the workflow pushed, not a build from source.
      expect(commandOf(run[0])).toContain(`-f ${E2E_OVERLAY} up`);
    });

    test("names each shard's failure artifact apart", () => {
      const uploads = definition.steps.filter((step) => {
        return /^actions\/upload-artifact@/.test(step.uses || "");
      });

      expect(uploads.length).toBeGreaterThan(0);
      for (const upload of uploads) {
        expect(upload.with.name).toContain("${{ matrix.shard }}");
      }
    });
  },
);

test("docker-compose.base.yml hands E2E_SHARD to the e2e container, empty unless set", () => {
  const e2e = readYaml("docker-compose.base.yml").services.e2e;

  expect(e2e.environment.E2E_SHARD).toBe("${E2E_SHARD:-}");
});

/*
 * Each e2e job waits for the builds of exactly the images its stack runs,
 * and for no merge, directly or through another job: it runs the -amd64 tags
 * the builds' amd64 legs push (TestReleaseE2eImages.test.js holds the tags to
 * Scripts/GHA/build_docker_images.sh). The merges, a few seconds of work each
 * behind a queue of their own, used to stand between the last build and the
 * e2e jobs: 34 to 49 minutes on run 38996994440.
 */
describe(`${TEST_RELEASE}: each e2e job waits for exactly the images it runs`, () => {
  const jobs = readYaml(TEST_RELEASE).jobs;

  test.each([
    "test-e2e-test-saas",
    "test-e2e-test-self-hosted",
    "test-e2e-test-enterprise",
  ])("%s", (name) => {
    const images = [
      ...stackImages(startedStack(jobs[name])),
      ...stackImages([E2E_OVERLAY]),
    ];
    const builds = images.map(buildJobFor).filter(Boolean).sort();

    // The suite's own image, and at least the App, really are among them.
    expect(builds).toContain("e2e-docker-image-build");
    expect(builds).toContain("app-docker-image-build");
    for (const build of builds) {
      expect(jobs[build]).toBeDefined();
    }

    expect(
      needsOf(jobs[name])
        .filter((need) => {
          return need !== "read-version";
        })
        .sort(),
    ).toEqual(builds);
    expect(
      [...ancestorsOf(jobs, name)].filter((job) => {
        return job.endsWith("-docker-image-merge");
      }),
    ).toEqual([]);
  });
});

/**
 * Runs an actions/github-script step's script as the action does - the body
 * of an async function of `github` and `context` - with each ${{ }}
 * expression in it replaced from `expressions`. An expression with no value
 * there throws, rather than reaching the script as literal text.
 * `setTimeout`, if given, stands in for the global one the script waits on.
 * @param {object} step
 * @param {{github: object, context: object, expressions: Object<string, string>, setTimeout?: Function}} scope
 * @returns {Promise<unknown>}
 */
function runGithubScript(
  step,
  { github, context, expressions, setTimeout = global.setTimeout },
) {
  const script = step.with.script.replace(
    /\$\{\{\s*(.+?)\s*\}\}/g,
    (match, expression) => {
      if (!(expression in expressions)) {
        throw new Error(`no value given for ${match}`);
      }
      return expressions[expression];
    },
  );
  const AsyncFunction = Object.getPrototypeOf(async () => {
    return undefined;
  }).constructor;

  return new AsyncFunction("github", "context", "setTimeout", script)(
    github,
    context,
    setTimeout,
  );
}

/*
 * A draft release has no tag. GitHub cuts it when finalize-github-release
 * publishes the draft, from the release's target_commitish, and a release
 * created without one targets the default branch - so releases were tagged
 * on master as it was at publish time, hours after the run started (14.0.12
 * on a commit merged two minutes before it), and the tag and the release
 * page's source archives were not the code the release was built from.
 *
 * Every step that can create the release names the run's commit:
 * ncipollo/release-action as `commit` (it sends it when it updates a draft,
 * too), softprops/action-gh-release as `target_commitish` - before
 * publication it always creates a draft of its own, and keeps it if it
 * cannot find draft-github-release's. The publish names the commit once
 * more, so the tag is right whichever draft it publishes.
 */
describe(`${RELEASE}: the release is tagged on the commit the run built`, () => {
  const workflow = readYaml(RELEASE);

  function stepsUsing(action) {
    return Object.entries(workflow.jobs).flatMap(([jobName, job]) => {
      return (job.steps || [])
        .filter((step) => {
          return (step.uses || "").startsWith(`${action}@`);
        })
        .map((step) => {
          return [`${jobName}: ${step.name || step.id}`, step];
        });
    });
  }

  const draftSteps = stepsUsing("ncipollo/release-action");
  const uploadSteps = stepsUsing("softprops/action-gh-release");
  const publish = (workflow.jobs["finalize-github-release"].steps || []).find(
    (step) => {
      return /^actions\/github-script@/.test(step.uses || "");
    },
  );

  test("finds the steps that create, fill and publish the release (the checks below are not vacuous)", () => {
    // The draft step is written out three times, as retries.
    expect(draftSteps.length).toBeGreaterThanOrEqual(3);
    // SBOMs, the infrastructure agent, and the Android and iOS apps.
    expect(uploadSteps.length).toBeGreaterThanOrEqual(4);
    expect(publish).toBeDefined();
  });

  test.each(draftSteps)(
    "%s creates the draft with commit: ${{ github.sha }}",
    (_label, step) => {
      expect(step.with.commit).toBe("${{ github.sha }}");
    },
  );

  test.each(uploadSteps)(
    "%s passes target_commitish: ${{ github.sha }}, for a draft it creates",
    (_label, step) => {
      expect(step.with.target_commitish).toBe("${{ github.sha }}");
    },
  );

  describe("finalize-github-release", () => {
    const sha = "5a55eface9b1d6f0c2e8a4b7d3c9e1f2a6b8c0d4";

    // Runs the publish script for 9.9.9, whose draft is release 42.
    async function runPublish(updateRelease, waits = jest.fn()) {
      const github = {
        paginate: jest.fn().mockResolvedValue([
          { id: 41, tag_name: "9.9.8", draft: false },
          {
            id: 42,
            tag_name: "9.9.9",
            draft: true,
            target_commitish: "master",
          },
        ]),
        rest: { repos: { listReleases: jest.fn(), updateRelease } },
      };
      const log = jest.spyOn(console, "log").mockImplementation(() => {
        return undefined;
      });

      try {
        await runGithubScript(publish, {
          github,
          context: { repo: { owner: "OneUptime", repo: "oneuptime" }, sha },
          expressions: { "needs.read-version.outputs.major_minor": "9.9.9" },
          // The back-off between attempts returns at once, recorded in
          // `waits`, so a retry shows up as calls rather than minutes.
          setTimeout: (resolve, ms) => {
            waits(ms);
            resolve();
          },
        });
      } finally {
        log.mockRestore();
      }

      expect(github.paginate).toHaveBeenCalledWith(
        github.rest.repos.listReleases,
        expect.objectContaining({ owner: "OneUptime", repo: "oneuptime" }),
      );
    }

    test("publishes the draft with target_commitish set to the run's commit", async () => {
      const updateRelease = jest.fn().mockResolvedValue({ data: {} });

      await runPublish(updateRelease);

      expect(updateRelease).toHaveBeenCalledTimes(1);
      expect(updateRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          release_id: 42,
          draft: false,
          target_commitish: sha,
        }),
      );
    });

    test("still retries a transient failure", async () => {
      const unavailable = Object.assign(
        new Error("No server is currently available to service your request."),
        { status: 503 },
      );
      const updateRelease = jest
        .fn()
        .mockRejectedValueOnce(unavailable)
        .mockResolvedValue({ data: {} });
      const waits = jest.fn();

      await runPublish(updateRelease, waits);

      expect(updateRelease).toHaveBeenCalledTimes(2);
      expect(waits).toHaveBeenCalledTimes(1);
    });

    /*
     * The workflow token may not create a ref at a commit whose workflows
     * differ from master's, so the publish is refused if master changed a
     * workflow during the run. That is not transient: retrying it only
     * waited out 150 seconds of back-off before failing with a bare 403.
     */
    test("stops at once when GitHub refuses to create the tag, and says how to publish by hand", async () => {
      const refused = Object.assign(
        new Error(
          "Resource not accessible by integration - https://docs.github.com/rest/releases/releases#update-a-release",
        ),
        { status: 403 },
      );
      const updateRelease = jest.fn().mockRejectedValue(refused);
      const waits = jest.fn();
      const publishing = runPublish(updateRelease, waits);

      await expect(publishing).rejects.toThrow(
        `GitHub refused to create tag 9.9.9 at ${sha}`,
      );
      await expect(publishing).rejects.toThrow(
        "Publish the draft for 9.9.9 from the Releases page",
      );
      expect(updateRelease).toHaveBeenCalledTimes(1);
      expect(waits).not.toHaveBeenCalled();
    });
  });
});

/*
 * Every upload to the GitHub release lands on the draft: nothing writes the
 * release once finalize-github-release has published it. 14.0.46 shipped
 * without its Android APK (run 38267959528). The publish did not wait for the
 * app jobs, the APK finished three minutes after it, and GitHub refused the
 * upload's update of the published release with 403 "Resource not
 * accessible by integration". A repository with immutable releases refuses
 * every upload after publishing.
 *
 * The SBOMs, the infrastructure agent and the two apps are built ahead of the
 * release and kept as artifacts; the publish job itself attaches them, each
 * in a step before the one that publishes (ReleaseCriticalPath.test.js holds
 * that). Outside it, only the draft writes the release.
 *
 * The app builds are waited for but not required: a failed app build still
 * publishes the release, without that app, rather than leaving a draft
 * behind images and tags that have already gone out. So the publish's `if`
 * is read here the way Actions reads it.
 */
describe(`${RELEASE}: nothing writes the release once it is published`, () => {
  const jobs = readYaml(RELEASE).jobs;
  const PUBLISH = "finalize-github-release";
  const APP_JOBS = ["mobile-app-android-build", "mobile-app-ios-build"];

  // A step that creates, fills or edits this repository's GitHub release.
  function writesTheRelease(step) {
    return (
      /^(softprops\/action-gh-release|ncipollo\/release-action)@/.test(
        step.uses || "",
      ) || /\bgh release (create|upload|edit)\b/.test(commandOf(step))
    );
  }

  /**
   * Whether Actions runs the publish, given how each job it needs ended
   * (anything not named succeeded). An `if` that calls no status function
   * (success(), failure(), cancelled(), always()) is read as
   * `success() && if`, and success() is false once a needed job has not
   * succeeded. The `if` is read as a chain of `&&` terms, every one of them
   * evaluated: a term this does not know fails the test rather than being
   * guessed at.
   * @param {{results?: Object, ref?: string, cancelled?: boolean}} run
   * @returns {boolean}
   */
  function publishRuns({
    results = {},
    ref = "refs/heads/release",
    cancelled = false,
  }) {
    const needs = needsOf(jobs[PUBLISH]);
    const resultOf = (need) => {
      return results[need] || "success";
    };
    const succeeded = () => {
      return (
        !cancelled &&
        needs.every((need) => {
          return resultOf(need) === "success";
        })
      );
    };
    const condition = String(jobs[PUBLISH].if || "success()")
      .trim()
      .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
      .trim();

    const valueOf = (term) => {
      if (term === "!cancelled()") {
        return !cancelled;
      }
      if (term === "cancelled()") {
        return cancelled;
      }
      if (term === "always()") {
        return true;
      }
      if (term === "success()") {
        return succeeded();
      }
      if (term === "failure()") {
        return needs.some((need) => {
          return resultOf(need) === "failure";
        });
      }
      const branch = /^github\.ref == '([^']*)'$/.exec(term);
      if (branch) {
        return ref === branch[1];
      }
      const result = /^needs\.([\w-]+)\.result == '(\w+)'$/.exec(term);
      if (result) {
        if (!needs.includes(result[1])) {
          throw new Error(
            `${PUBLISH} reads needs.${result[1]}, a job it does not need`,
          );
        }
        return resultOf(result[1]) === result[2];
      }
      throw new Error(`${PUBLISH}'s if: no way to read "${term}"`);
    };

    const values = condition.split("&&").map((term) => {
      return valueOf(term.trim());
    });
    const callsAStatusFunction =
      /\b(success|failure|cancelled|always)\(\)/.test(condition);

    return values.every(Boolean) && (callsAStatusFunction || succeeded());
  }

  const writers = Object.keys(jobs).filter((name) => {
    return (
      name !== PUBLISH &&
      (jobs[name].steps || []).some((step) => {
        return writesTheRelease(step);
      })
    );
  });

  test("finds the jobs that write the release, and the publish job's own attach steps (the checks below are not vacuous)", () => {
    expect(writers).toEqual(["draft-github-release"]);
    expect(
      jobs[PUBLISH].steps.filter(writesTheRelease).map((step) => {
        return step.name;
      }),
    ).toEqual([
      "Attach SBOMs to release",
      "Attach the infrastructure agent to release",
      "Upload APK to GitHub Release",
      "Upload IPA to GitHub Release",
    ]);
  });

  test.each(writers)("%s is done before the release is published", (job) => {
    expect(ancestorsOf(jobs, PUBLISH).has(job)).toBe(true);
  });

  test("the publish job writes the release only before the step that publishes it", () => {
    const steps = jobs[PUBLISH].steps;
    const publishing = steps.findIndex((step) => {
      return /^actions\/github-script@/.test(step.uses || "");
    });

    expect(publishing).toBe(steps.length - 1);
    steps.forEach((step, index) => {
      if (writesTheRelease(step)) {
        expect({
          step: step.name,
          beforeThePublish: index < publishing,
        }).toEqual({ step: step.name, beforeThePublish: true });
      }
    });
  });

  describe(`${PUBLISH} publishes the release`, () => {
    const required = needsOf(jobs[PUBLISH]).filter((need) => {
      return !APP_JOBS.includes(need);
    });

    test("waiting for both app jobs and requiring the rest (the checks below are not vacuous)", () => {
      expect(needsOf(jobs[PUBLISH])).toEqual(expect.arrayContaining(APP_JOBS));
      expect(required).toEqual(
        expect.arrayContaining([
          "draft-github-release",
          "infrastructure-agent-build",
          "generate-sboms",
          "helm-chart-deploy",
        ]),
      );
    });

    test("once every job it waits for has succeeded", () => {
      expect(publishRuns({})).toBe(true);
    });

    test.each(
      APP_JOBS.flatMap((job) => {
        return [
          [job, "failure"],
          [job, "cancelled"],
        ];
      }),
    )("without that app when %s ended %s", (job, result) => {
      expect(publishRuns({ results: { [job]: result } })).toBe(true);
    });

    test("without either app when both app jobs failed", () => {
      const results = Object.fromEntries(
        APP_JOBS.map((job) => {
          return [job, "failure"];
        }),
      );
      expect(publishRuns({ results })).toBe(true);
    });

    test.each(
      required.flatMap((need) => {
        return [
          [need, "failure"],
          [need, "cancelled"],
          [need, "skipped"],
        ];
      }),
    )("not when %s ended %s", (need, result) => {
      expect(publishRuns({ results: { [need]: result } })).toBe(false);
    });

    test("not when the run was cancelled", () => {
      expect(publishRuns({ cancelled: true })).toBe(false);
    });

    test("not for a run of another branch", () => {
      expect(publishRuns({ ref: "refs/heads/master" })).toBe(false);
    });
  });
});

/*
 * terraform-provider-e2e.yml supersedes its in-flight run for the same branch
 * or pull request. release.yml calls it as the gate of the release it
 * publishes, and a called workflow reads the caller's github.workflow and
 * github.ref, so every release run used to share one group: a newer release
 * run, or a re-run of an older one, cancelled the suite of the release in
 * flight (14.0.47's, run 38302467596, a minute after 14.0.46's run was
 * re-run). release.yml now passes its run id as an input the group reads
 * first. The group is worked out here for the runs that matter, a release
 * run's with the inputs release.yml passes; CancelClosedPrRuns.test.js holds
 * a pull request's group to the one its canceller joins.
 */
describe(`${TERRAFORM_E2E}: each release run's suite is its own`, () => {
  const suite = readYaml(TERRAFORM_E2E);
  const release = readYaml(RELEASE);
  const callers = Object.values(release.jobs).filter((job) => {
    return job.uses === `./${TERRAFORM_E2E}`;
  });

  // The group of the suite a release run calls, given the inputs release.yml
  // passes it, evaluated for that run.
  function releaseRunGroup(runId) {
    const github = {
      workflow: release.name,
      ref: "refs/heads/release",
      run_id: runId,
      event: {},
    };
    const inputs = Object.fromEntries(
      Object.entries(callers[0].with || {}).map(([name, value]) => {
        return [name, evaluateExpressions(String(value), { github })];
      }),
    );
    return evaluateExpressions(suite.concurrency.group, { github, inputs });
  }

  // The group of one of the suite's own runs, on a push or a pull request.
  function ownRunGroup(ref, runId, pullRequestNumber) {
    const github = {
      workflow: suite.name,
      ref,
      run_id: runId,
      event: pullRequestNumber
        ? { pull_request: { number: pullRequestNumber } }
        : {},
    };
    return evaluateExpressions(suite.concurrency.group, {
      github,
      inputs: {},
    });
  }

  /*
   * GitHub refuses to start a run whose call passes an input the called
   * workflow does not declare - every job of the release, not just this one.
   */
  test("is called once by release.yml, with inputs it declares (the checks below are not vacuous)", () => {
    expect(callers).toHaveLength(1);
    const declared = Object.keys(
      (suite.on.workflow_call && suite.on.workflow_call.inputs) || {},
    );
    const passed = Object.keys(callers[0].with || {});
    expect(passed.length).toBeGreaterThan(0);
    for (const name of passed) {
      expect(declared).toContain(name);
    }
    expect(suite.concurrency["cancel-in-progress"]).toBe(true);
  });

  test("two release runs never share a group, so neither cancels the other", () => {
    expect(releaseRunGroup("38267959528")).not.toEqual(
      releaseRunGroup("38302467596"),
    );
  });

  test("two pushes to master share a group, so the newer supersedes the older", () => {
    expect(ownRunGroup("refs/heads/master", "1")).toEqual(
      ownRunGroup("refs/heads/master", "2"),
    );
  });

  test("pushes to one pull request share a group, and two pull requests do not", () => {
    expect(ownRunGroup("refs/pull/4727/merge", "1", 4727)).toEqual(
      ownRunGroup("refs/pull/4727/merge", "2", 4727),
    );
    expect(ownRunGroup("refs/pull/4727/merge", "1", 4727)).not.toEqual(
      ownRunGroup("refs/pull/4728/merge", "1", 4728),
    );
  });
});

/*
 * HashiCorp asks the providers it lists as Partner for tests that run nightly
 * as a GitHub Action, so terraform-provider-e2e.yml also runs on a schedule.
 * The nightly run is master's, and its group is its own, worked out from
 * github.event.schedule, which GitHub sets on scheduled runs only. In the
 * group master's pushes share, a merge landing during the three-hour suite
 * would cancel the nightly run, or the nightly run the merge's.
 */
describe(`${TERRAFORM_E2E}: runs every night, in a group of its own`, () => {
  const suite = readYaml(TERRAFORM_E2E);
  const schedules = (suite.on && suite.on.schedule) || [];

  // The group of one of the suite's runs on master, for the event's payload.
  function masterRunGroup(runId, event) {
    return evaluateExpressions(suite.concurrency.group, {
      github: {
        workflow: suite.name,
        ref: "refs/heads/master",
        run_id: runId,
        event,
      },
      inputs: {},
    });
  }

  test("is scheduled once a day, every day", () => {
    expect(schedules).toHaveLength(1);
    const fields = String(schedules[0].cron).trim().split(/\s+/);
    expect(fields).toHaveLength(5);
    // One minute of one hour, on every day of every month.
    expect(fields[0]).toMatch(/^\d+$/);
    expect(fields[1]).toMatch(/^\d+$/);
    expect(fields.slice(2)).toEqual(["*", "*", "*"]);
  });

  test("a nightly run and a push to master never share a group, so neither cancels the other", () => {
    const nightly = masterRunGroup("1", { schedule: schedules[0].cron });

    expect(nightly).not.toEqual(masterRunGroup("2", {}));
    expect(nightly).toContain(schedules[0].cron);
  });
});

/*
 * HashiCorp also asks partner providers to pass acceptance tests written with
 * terraform-plugin-testing. Go skips them unless TF_ACC is set, so the job
 * that runs them must set it, give them the OneUptime and the project key
 * the test account step writes to test-env.sh, and point them at the
 * Terraform the job installed instead of letting them download one. A step
 * that lost any of that would pass while running nothing.
 */
describe(`${TERRAFORM_E2E}: runs the provider's acceptance tests`, () => {
  const suite = readYaml(TERRAFORM_E2E);
  const steps = suite.jobs["terraform-e2e-tests"].steps;
  const names = steps.map((step) => {
    return step.name;
  });
  const acceptance = steps.find((step) => {
    return step.name === "Run provider acceptance tests";
  });

  test("in a step of its own", () => {
    expect(acceptance).toBeDefined();
  });

  test("with TF_ACC set, and the Terraform the job installed", () => {
    expect(acceptance.env.TF_ACC).toBe("1");
    expect(acceptance.env.TF_ACC_TERRAFORM_PATH).toBe(
      "/usr/local/bin/terraform",
    );
    expect(names.indexOf(acceptance.name)).toBeGreaterThan(
      names.indexOf("Install Terraform and OpenTofu"),
    );
  });

  test("against the test project, after the end-to-end suite", () => {
    expect(acceptance.run).toContain(
      "source ../../packages/E2E/Terraform/e2e-tests/test-env.sh",
    );
    expect(names.indexOf(acceptance.name)).toBeGreaterThan(
      names.indexOf("Set up test account"),
    );
    expect(names.indexOf(acceptance.name)).toBeGreaterThan(
      names.indexOf("Run OpenTofu E2E tests"),
    );
  });

  test("running every acceptance test of the generated provider", () => {
    expect(acceptance["working-directory"]).toBe(
      "Terraform/terraform-provider-oneuptime",
    );
    expect(acceptance.run).toContain(
      "go test ./internal/provider -run '^TestAcc'",
    );
  });
});
