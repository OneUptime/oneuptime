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
 * would not fail - it would test the previous push's image.
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

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = ".github/workflows";
const TEST_RELEASE = `${WORKFLOWS_DIR}/test-release.yaml`;
const RELEASE = `${WORKFLOWS_DIR}/release.yml`;
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

  return Object.values(services)
    .filter((service) => {
      return !service.profiles || service.profiles.length === 0;
    })
    .map((service) => {
      return service.image;
    })
    .filter(Boolean)
    .sort();
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
    // The billing overlay puts the runner behind a profile.
    expect(images).not.toContain("oneuptime/runner:${APP_TAG}");
    expect(stackImages(["docker-compose.yml"])).toContain(
      "oneuptime/runner:${APP_TAG}",
    );
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
    const merges = images.map(mergeJobFor).filter(Boolean).sort();

    // The suite's own image, and at least the App, really are among them.
    expect(merges).toContain("e2e-docker-image-merge");
    expect(merges).toContain("app-docker-image-merge");
    for (const merge of merges) {
      expect(jobs[merge]).toBeDefined();
    }

    expect(
      needsOf(jobs[name])
        .filter((need) => {
          return need !== "read-version";
        })
        .sort(),
    ).toEqual(merges);
  });
});
