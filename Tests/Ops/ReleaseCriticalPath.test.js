"use strict";

/**
 * What a release run (release.yml) waits for, and what it no longer does.
 *
 * The organization runs 20 jobs at a time, and a release run's ~75 jobs queue
 * for them behind every pull request and master push: on 14.0.65 (run
 * 39000188317) the run took 4h42m, of which under two hours was work. So
 * release.yml starts each job as soon as it has what it truly needs, and has
 * fewer jobs on the way to the publish:
 *
 *   - the image builds that publish version tags only, and the e2e jobs, no
 *     longer wait for generate-build-number, which they never read (it sat
 *     24.5 minutes in the queue on 14.0.65, with every build behind it);
 *   - the e2e jobs no longer wait for publish-npm-packages, whose packages
 *     they never install; push-release-tags needs it instead, so a failed
 *     npm publish still holds the tags and the GitHub release back;
 *   - push-release-tags is one job, not a matrix of ten that each queued (the
 *     last started 68 minutes after the e2e jobs passed on 14.0.65);
 *   - the SBOMs, the infrastructure agent and the two apps are built while
 *     the images are tested and attached by finalize-github-release, right
 *     before it publishes, instead of being built after the draft by four
 *     jobs that each queued (62 minutes from draft to publish on 14.0.65).
 *
 * The release owner's rule for all of it: build earlier, never publish
 * earlier. Every job that publishes still waits, directly or through other
 * jobs, for everything it waited for before; nothing users can see starts
 * before the three e2e jobs have passed that did not before.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const {
  needsOf,
  ancestorsOf,
  danglingNeeds,
  stepCommand,
  releaseTagImages,
  readBashArray,
} = require("./Utils/ReleaseWorkflow");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE = ".github/workflows/release.yml";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const jobs = yaml.load(read(RELEASE)).jobs;

const E2E_JOBS = [
  "test-e2e-release-saas",
  "test-e2e-release-self-hosted",
  "test-e2e-release-enterprise",
];

const BUILD_NUMBER = "generate-build-number";

/*
 * Everything each job that publishes waited for, directly or through other
 * jobs, in release.yml as it was before these changes (14.0.66's), with the
 * three jobs that were renamed under their new names: infrastructure-agent-
 * deploy, mobile-app-android-deploy and mobile-app-ios-deploy built and then
 * uploaded after the draft; infrastructure-agent-build, mobile-app-android-
 * build and mobile-app-ios-build build at the start, and finalize-github-
 * release does the uploading.
 *
 * A job may come to wait for more. It may never wait for less: that is what
 * "never publish earlier" means for a job graph.
 */
const IMAGES_BEHIND_THE_E2E_JOBS = [
  "app",
  "e2e",
  "home",
  "kubernetes-ai-agent",
  "nginx",
  "probe",
  "resource-ai-agent",
  "runner",
  "test",
  "test-server",
];
const AGENTS_WITH_THEIR_OWN_RELEASE_TAGS = [
  "docker-agent",
  "kubernetes-cost-agent",
  "kubernetes-log-tailer",
  "podman-agent",
];

function buildAndMerge(images) {
  return images.flatMap((image) => {
    return [`${image}-docker-image-build`, `${image}-docker-image-merge`];
  });
}

const TAGS_WAITED_FOR = [
  ...buildAndMerge(IMAGES_BEHIND_THE_E2E_JOBS),
  BUILD_NUMBER,
  "helm-chart-check",
  "publish-npm-packages",
  "read-version",
  ...E2E_JOBS,
];

const WAITED_FOR_BEFORE = {
  "push-release-tags": TAGS_WAITED_FOR,
  "draft-github-release": [...TAGS_WAITED_FOR, "push-release-tags"],
  "helm-chart-deploy": [...TAGS_WAITED_FOR, "push-release-tags"],
  "finalize-github-release": [
    ...TAGS_WAITED_FOR,
    ...buildAndMerge(AGENTS_WITH_THEIR_OWN_RELEASE_TAGS),
    "push-release-tags",
    "draft-github-release",
    "helm-chart-deploy",
    "generate-sboms",
    "infrastructure-agent-build",
    "mobile-app-android-build",
    "mobile-app-ios-build",
  ],
  "publish-terraform-provider": [
    BUILD_NUMBER,
    "read-version",
    "terraform-provider-e2e",
  ],
  "publish-npm-packages": [BUILD_NUMBER, "read-version"],
  "publish-android-to-play-store": [BUILD_NUMBER, "read-version"],
  "publish-ios-to-app-store": [BUILD_NUMBER, "read-version"],
  // These four move their own `release` tags at build and merge time.
  ...Object.fromEntries(
    AGENTS_WITH_THEIR_OWN_RELEASE_TAGS.flatMap((image) => {
      return [
        [`${image}-docker-image-build`, [BUILD_NUMBER, "read-version"]],
        [
          `${image}-docker-image-merge`,
          [BUILD_NUMBER, "read-version", `${image}-docker-image-build`],
        ],
      ];
    }),
  ),
};

/*
 * What the four jobs that used to upload to the draft waited for: they built
 * and uploaded after draft-github-release. Their uploads are steps of
 * finalize-github-release now, which must still wait for all of it.
 */
const UPLOADS_WAITED_FOR_BEFORE = [
  ...TAGS_WAITED_FOR,
  "push-release-tags",
  "draft-github-release",
];

// A step that creates, fills or edits this repository's GitHub release.
function writesTheRelease(step) {
  return (
    /^(softprops\/action-gh-release|ncipollo\/release-action)@/.test(
      step.uses || "",
    ) || /\bgh release (create|upload|edit)\b/.test(stepCommand(step))
  );
}

function stepsUsing(job, action) {
  return (job.steps || []).filter((step) => {
    return (step.uses || "").startsWith(`${action}@`);
  });
}

describe(`${RELEASE}: build earlier, never publish earlier`, () => {
  test("the job graph is whole (the checks below are not vacuous)", () => {
    expect(danglingNeeds(jobs)).toEqual([]);
    for (const name of Object.keys(WAITED_FOR_BEFORE)) {
      expect({ name, defined: Boolean(jobs[name]) }).toEqual({
        name,
        defined: true,
      });
    }
  });

  test.each(Object.entries(WAITED_FOR_BEFORE))(
    "%s still waits for everything it waited for",
    (name, before) => {
      const waitsFor = ancestorsOf(jobs, name);

      expect(
        before.filter((job) => {
          return !waitsFor.has(job);
        }),
      ).toEqual([]);
    },
  );

  test.each([
    "push-release-tags",
    "draft-github-release",
    "helm-chart-deploy",
    "finalize-github-release",
  ])("%s starts only after the three e2e jobs have passed", (name) => {
    const waitsFor = ancestorsOf(jobs, name);

    for (const e2e of E2E_JOBS) {
      expect({ name, e2e, waited: waitsFor.has(e2e) }).toEqual({
        name,
        e2e,
        waited: true,
      });
    }
  });

  test("the Terraform provider is published only after its own e2e suite", () => {
    expect(needsOf(jobs["publish-terraform-provider"])).toContain(
      "terraform-provider-e2e",
    );
  });

  test("the SBOMs, the infrastructure agent and the apps reach the release only after everything their uploads waited for", () => {
    const waitsFor = ancestorsOf(jobs, "finalize-github-release");

    expect(
      UPLOADS_WAITED_FOR_BEFORE.filter((job) => {
        return !waitsFor.has(job);
      }),
    ).toEqual([]);
  });

  test("the store jobs still run only when someone asks for them, from `release`", () => {
    expect(jobs["publish-android-to-play-store"].if).toBe(
      "github.ref == 'refs/heads/release' && github.event_name == 'workflow_dispatch' && github.event.inputs.publish_android_to_store == 'true'",
    );
    expect(jobs["publish-ios-to-app-store"].if).toBe(
      "github.ref == 'refs/heads/release' && github.event_name == 'workflow_dispatch' && github.event.inputs.publish_ios_to_store == 'true'",
    );
  });
});

/*
 * release.yml runs for a push to `release`, and for a workflow_dispatch from
 * any branch. Only the draft and the publish used to check the branch, so a
 * dispatch from another one (for the store jobs, say) would build that
 * branch, run its e2e, and then move the `release` tags to its images,
 * publish its charts, npm packages, Terraform provider and the four agents'
 * `release` tags. Every job that publishes now runs only for `release`: its
 * own `if` names the branch, or - with no status function in its `if`, so
 * Actions requires every job it needs to have succeeded - a job it needs
 * runs only for `release`, and is skipped for any other.
 */
describe(`${RELEASE}: every job that publishes runs only for \`release\``, () => {
  const RELEASE_REF = "github.ref == 'refs/heads/release'";

  // The `&&` terms of a job's `if`, without the ${{ }} around it.
  function termsOf(name) {
    return String(jobs[name].if || "")
      .trim()
      .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
      .split("&&")
      .map((term) => {
        return term.trim();
      })
      .filter(Boolean);
  }

  function callsAStatusFunction(name) {
    return /\b(success|failure|cancelled|always)\(\)/.test(
      String(jobs[name].if || ""),
    );
  }

  /*
   * Whether a job runs only for `release`: its `if` requires the branch, or
   * it requires every job it needs to have succeeded and one of them runs
   * only for `release`.
   */
  function runsOnlyForRelease(name, seen = new Set()) {
    if (seen.has(name)) {
      return false;
    }
    seen.add(name);
    if (termsOf(name).includes(RELEASE_REF)) {
      return true;
    }
    if (callsAStatusFunction(name)) {
      return false;
    }
    return needsOf(jobs[name]).some((need) => {
      return runsOnlyForRelease(need, seen);
    });
  }

  const publishing = Object.keys(WAITED_FOR_BEFORE).sort();

  test("finds every job that publishes (the checks below are not vacuous)", () => {
    expect(publishing).toEqual(
      expect.arrayContaining([
        "push-release-tags",
        "helm-chart-deploy",
        "publish-npm-packages",
        "publish-terraform-provider",
        "draft-github-release",
        "finalize-github-release",
        "publish-android-to-play-store",
        "publish-ios-to-app-store",
        ...buildAndMerge(AGENTS_WITH_THEIR_OWN_RELEASE_TAGS),
      ]),
    );
  });

  test.each(publishing)("%s runs only for `release`", (name) => {
    expect({ job: name, onlyForRelease: runsOnlyForRelease(name) }).toEqual({
      job: name,
      onlyForRelease: true,
    });
  });

  test.each([
    "push-release-tags",
    "helm-chart-deploy",
    "publish-npm-packages",
    "publish-terraform-provider",
    "draft-github-release",
    ...AGENTS_WITH_THEIR_OWN_RELEASE_TAGS.map((image) => {
      return `${image}-docker-image-build`;
    }),
  ])("%s says so itself, with no status function", (name) => {
    expect(jobs[name].if).toBe(RELEASE_REF);
  });

  test("the e2e jobs and the image builds behind them still run for any branch: only publishing waits for `release`", () => {
    for (const name of [
      ...E2E_JOBS,
      ...buildAndMerge(IMAGES_BEHIND_THE_E2E_JOBS),
      "read-version",
    ]) {
      expect({ job: name, onlyForRelease: runsOnlyForRelease(name) }).toEqual({
        job: name,
        onlyForRelease: false,
      });
    }
  });

  test("reads a gate through a job's needs, and not through a status function", () => {
    const saved = { ...jobs };
    try {
      jobs["gate-probe-gated"] = { if: RELEASE_REF };
      jobs["gate-probe-through-needs"] = { needs: ["gate-probe-gated"] };
      jobs["gate-probe-always"] = {
        needs: ["gate-probe-gated"],
        if: "always()",
      };
      jobs["gate-probe-open"] = { needs: ["read-version"] };
      expect(runsOnlyForRelease("gate-probe-gated")).toBe(true);
      expect(runsOnlyForRelease("gate-probe-through-needs")).toBe(true);
      expect(runsOnlyForRelease("gate-probe-always")).toBe(false);
      expect(runsOnlyForRelease("gate-probe-open")).toBe(false);
    } finally {
      for (const name of Object.keys(jobs)) {
        if (!(name in saved)) {
          delete jobs[name];
        }
      }
    }
  });
});

/*
 * generate-build-number creates a tag through the API and queues for a
 * runner of its own, so whatever needs it waits for both. The mobile app
 * builds read the number (versionCode, CURRENT_PROJECT_VERSION) and the
 * draft prints it; the image builds and the e2e jobs never did.
 */
describe(`${RELEASE}: only what reads the build number, or publishes, waits for it`, () => {
  const reads = (job) => {
    return JSON.stringify(job.steps || []).includes(
      "needs.generate-build-number.outputs",
    );
  };
  const publishes = (name) => {
    return Object.prototype.hasOwnProperty.call(WAITED_FOR_BEFORE, name);
  };

  test("the jobs that read it are the apps', the stores' and the draft (the checks below are not vacuous)", () => {
    expect(
      Object.keys(jobs)
        .filter((name) => {
          return reads(jobs[name]);
        })
        .sort(),
    ).toEqual([
      "draft-github-release",
      "mobile-app-android-build",
      "mobile-app-ios-build",
      "publish-android-to-play-store",
      "publish-ios-to-app-store",
    ]);
  });

  test.each(Object.keys(jobs))(
    "%s waits for it only if it reads it or publishes",
    (name) => {
      if (needsOf(jobs[name]).includes(BUILD_NUMBER)) {
        expect({
          name,
          readsOrPublishes: reads(jobs[name]) || publishes(name),
        }).toEqual({ name, readsOrPublishes: true });
      }
    },
  );

  test.each([...buildAndMerge(IMAGES_BEHIND_THE_E2E_JOBS), ...E2E_JOBS])(
    "%s does not wait for it, even through another job",
    (name) => {
      expect(ancestorsOf(jobs, name).has(BUILD_NUMBER)).toBe(false);
    },
  );

  test.each(IMAGES_BEHIND_THE_E2E_JOBS)(
    "%s's build starts on read-version alone",
    (image) => {
      expect(needsOf(jobs[`${image}-docker-image-build`])).toEqual([
        "read-version",
      ]);
    },
  );
});

/*
 * publish-npm-packages publishes @oneuptime/common, @oneuptime/react-native-
 * replay and @oneuptime/cli. The e2e jobs needed it, so a slow npm (its wait
 * for Common to appear took 8.6 to 55 minutes) held the release's e2e suite;
 * yet nothing those jobs run installs any of the three. They boot images this
 * run built and run the e2e image, whose Dockerfile installs packages/E2E's
 * lockfile and copies packages/Common from the checkout.
 */
describe(`${RELEASE}: the e2e jobs do not wait for the npm publish, and the release still does`, () => {
  const published = [
    "packages/Common",
    "packages/App/FeatureSet/MobileRecorder",
    "packages/CLI",
  ].map((directory) => {
    return JSON.parse(read(`${directory}/package.json`)).name;
  });

  // The Dockerfile templates of every image the release e2e stacks run.
  const STACK_DOCKERFILES = [
    "packages/App/Dockerfile.tpl",
    "packages/Home/Dockerfile.tpl",
    "packages/Probe/Dockerfile.tpl",
    "packages/Runner/Dockerfile.tpl",
    "packages/Nginx/Dockerfile.tpl",
    "packages/E2E/Dockerfile.tpl",
  ];

  test("the packages it publishes are the three it always has (the checks below are not vacuous)", () => {
    expect(published).toEqual([
      "@oneuptime/common",
      "@oneuptime/react-native-replay",
      "@oneuptime/cli",
    ]);
    expect(read("Scripts/NPM/PublishAllPackages.sh")).toContain(
      'publish_to_npm "packages/CLI"',
    );
  });

  test.each(E2E_JOBS)("%s does not wait for it", (name) => {
    expect(ancestorsOf(jobs, name).has("publish-npm-packages")).toBe(false);
  });

  test("push-release-tags needs it, so a failed npm publish holds the tags and the GitHub release back", () => {
    expect(needsOf(jobs["push-release-tags"])).toContain(
      "publish-npm-packages",
    );
    for (const name of [
      "draft-github-release",
      "helm-chart-deploy",
      "finalize-github-release",
    ]) {
      expect(ancestorsOf(jobs, name).has("publish-npm-packages")).toBe(true);
    }
  });

  test("the e2e suite's own package installs none of them", () => {
    const manifest = JSON.parse(read("packages/E2E/package.json"));
    const declared = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    };
    const lock = JSON.parse(read("packages/E2E/package-lock.json"));
    const locked = Object.keys(lock.packages || {}).filter((key) => {
      return published.some((name) => {
        return key === `node_modules/${name}` || key.endsWith(`/${name}`);
      });
    });

    for (const name of published) {
      expect({ name, declared: declared[name] }).toEqual({
        name,
        declared: undefined,
      });
    }
    expect(locked).toEqual([]);
  });

  test.each(STACK_DOCKERFILES)("%s names none of them", (dockerfile) => {
    const text = read(dockerfile);

    for (const name of published) {
      expect({ dockerfile, name, named: text.includes(name) }).toEqual({
        dockerfile,
        name,
        named: false,
      });
    }
  });

  test("the stacks the e2e jobs boot run only images this run builds", () => {
    const composeImages = [
      "docker-compose.yml",
      "packages/E2E/docker-compose.billing.yml",
      "packages/E2E/docker-compose.e2e.yml",
    ].flatMap((file) => {
      return Object.values(yaml.load(read(file)).services || {})
        .map((service) => {
          return service.image;
        })
        .filter(Boolean);
    });
    const ours = composeImages.filter((image) => {
      return /^(?:ghcr\.io\/)?oneuptime\//.test(image);
    });

    expect(ours.length).toBeGreaterThan(4);
    for (const image of ours) {
      // oneuptime/<name>:${APP_TAG}: this run's tag of an image it builds,
      // from one of the Dockerfiles above.
      const match = /oneuptime\/([a-z0-9-]+):\$\{APP_TAG\}$/.exec(image);
      const dockerfile = match
        ? STACK_DOCKERFILES.find((candidate) => {
            return candidate.toLowerCase().includes(`/${match[1]}/`);
          })
        : undefined;

      expect({ image, dockerfile: Boolean(dockerfile) }).toEqual({
        image,
        dockerfile: true,
      });
      expect(jobs[`${match[1]}-docker-image-build`]).toBeDefined();
    }
  });
});

/*
 * One job moves every image's release and enterprise-release tags. Its step
 * is run here for real, with a fake docker on PATH that records each call
 * and fails where it is told to, and with retry.sh's back-off set to zero.
 */
describe(`${RELEASE}: push-release-tags moves every image's tags in one job`, () => {
  const job = jobs["push-release-tags"];
  const MOVE_STEP =
    "Move each image's release and enterprise-release tags to this version";
  const step = (job.steps || []).find((candidate) => {
    return candidate.name === MOVE_STEP;
  });

  let workDir = "";

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-release-tags-"));
    fs.mkdirSync(path.join(workDir, "bin"));
    fs.writeFileSync(
      path.join(workDir, "bin", "docker"),
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$*" >>"$FAKE_DOCKER_LOG"',
        'count_file="$FAKE_DOCKER_LOG.count"',
        "count=0",
        '[ -f "$count_file" ] && count="$(cat "$count_file")"',
        'count=$((count + 1)); echo "$count" >"$count_file"',
        'if [ "$count" -le "${FAKE_DOCKER_FAIL_FIRST:-0}" ]; then',
        '  echo "denied: You have exceeded a secondary rate limit" >&2; exit 1',
        "fi",
        // FAKE_DOCKER_FAIL_ON: one run of words per line; a call whose
        // arguments contain one of them fails.
        "while IFS= read -r fail_on; do",
        '  if [ -n "$fail_on" ] && [[ " $* " == *" $fail_on "* ]]; then',
        '    echo "MANIFEST_UNKNOWN: $fail_on" >&2; exit 1',
        "  fi",
        'done <<<"${FAKE_DOCKER_FAIL_ON:-}"',
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
  });

  afterAll(() => {
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  let runs = 0;

  function runStep({
    failOn = [],
    failFirst = 0,
    images = job.env.RELEASE_TAG_IMAGES,
  } = {}) {
    runs += 1;
    const log = path.join(workDir, `calls-${runs}`);
    fs.writeFileSync(log, "");
    // As Actions runs a step that names no shell: `bash -e {0}`, the script
    // in a file of its own.
    const script = path.join(workDir, `step-${runs}.sh`);
    fs.writeFileSync(script, step.run);
    const result = spawnSync("bash", ["-e", script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60000,
      env: {
        ...process.env,
        PATH: `${path.join(workDir, "bin")}${path.delimiter}${process.env.PATH}`,
        RELEASE_TAG_IMAGES: images,
        VERSION: "9.9.9",
        RETRY_WITH_BACKOFF_DELAYS: "0 0 0",
        FAKE_DOCKER_LOG: log,
        FAKE_DOCKER_FAIL_ON: [].concat(failOn).join("\n"),
        FAKE_DOCKER_FAIL_FIRST: String(failFirst),
      },
    });
    const calls = fs
      .readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => {
        return line.length > 0;
      });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      calls,
    };
  }

  // The two calls that move one image's tags.
  function moves(image) {
    return [
      `buildx imagetools create --tag oneuptime/${image}:release --tag ghcr.io/oneuptime/${image}:release ghcr.io/oneuptime/${image}:9.9.9`,
      `buildx imagetools create --tag oneuptime/${image}:enterprise-release --tag ghcr.io/oneuptime/${image}:enterprise-release ghcr.io/oneuptime/${image}:enterprise-9.9.9`,
    ];
  }

  test("is one job, for the ten images the matrix of ten jobs moved", () => {
    expect(job.strategy).toBeUndefined();
    expect(String(job.name)).not.toContain("matrix");
    expect(releaseTagImages(job)).toEqual([
      "nginx",
      "e2e",
      "home",
      "test-server",
      "test",
      "probe",
      "runner",
      "kubernetes-ai-agent",
      "resource-ai-agent",
      "app",
    ]);
    expect(step).toBeDefined();
    expect(step.env).toEqual({
      VERSION: "${{needs.read-version.outputs.major_minor}}",
    });
  });

  /*
   * The runs below start the step with `bash -e`, the shell Actions gives a
   * step that names none. A `shell:` on the step, or a `defaults.run.shell`
   * on the job or the workflow, would run it differently, so neither is set.
   */
  test("runs in the shell Actions gives a step that names none, as the runs below do", () => {
    expect(step.shell).toBeUndefined();
    expect(((job.defaults || {}).run || {}).shell).toBeUndefined();
    expect(
      ((yaml.load(read(RELEASE)).defaults || {}).run || {}).shell,
    ).toBeUndefined();
  });

  test("waits for the merge of every image it retags", () => {
    for (const image of releaseTagImages(job)) {
      expect(needsOf(job)).toContain(`${image}-docker-image-merge`);
    }
  });

  test("moves release and enterprise-release on Docker Hub and GHCR, image by image, from this version's tags", () => {
    const run = runStep();

    expect(run.status).toBe(0);
    expect(run.calls).toEqual(releaseTagImages(job).flatMap(moves));
  });

  test("still moves every other image when one cannot be moved, then fails naming it", () => {
    const run = runStep({ failOn: "ghcr.io/oneuptime/probe:9.9.9" });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("::error title=Release tags not moved::probe");
    // probe's release tag is tried four times (retry.sh's three retries) and
    // its enterprise-release tag is not tried after it, as the matrix job's
    // steps stopped at the first that failed; every other image is moved.
    const expected = releaseTagImages(job).flatMap((image) => {
      if (image !== "probe") {
        return moves(image);
      }
      return Array(4).fill(moves("probe")[0]);
    });
    expect(run.calls).toEqual(expected);
  });

  test("retries a call GitHub turned away for a moment, and succeeds", () => {
    const run = runStep({ failFirst: 1 });

    expect(run.status).toBe(0);
    const all = releaseTagImages(job).flatMap(moves);
    expect(run.calls).toEqual([all[0], ...all]);
  });

  test("names the failing images, all of them", () => {
    const run = runStep({
      failOn: [
        "ghcr.io/oneuptime/probe:9.9.9",
        "--tag oneuptime/app:enterprise-release",
      ],
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      "::error title=Release tags not moved::probe app",
    );
    // app's release tags moved; its enterprise-release tags did not.
    expect(
      run.calls.filter((call) => {
        return call.includes("oneuptime/app:");
      }),
    ).toEqual([moves("app")[0], ...Array(4).fill(moves("app")[1])]);
    expect(
      run.calls.filter((call) => {
        return call.includes("oneuptime/nginx:");
      }),
    ).toEqual(moves("nginx"));
  });

  test("refuses to run with no image to move, rather than succeed doing nothing", () => {
    const run = runStep({ images: " \n " });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("RELEASE_TAG_IMAGES names no image");
    expect(run.calls).toEqual([]);
  });
});

/*
 * The SBOMs, the infrastructure agent's files and the two apps are built
 * while the images are tested, kept as artifacts, and attached to the draft
 * by finalize-github-release, before the step that publishes it.
 */
describe(`${RELEASE}: what the release carries is built ahead of it and attached by the publish job`, () => {
  const PUBLISH = "finalize-github-release";
  const publishSteps = jobs[PUBLISH].steps;
  const publishIndex = publishSteps.findIndex((step) => {
    return /^actions\/github-script@/.test(step.uses || "");
  });

  /*
   * Each build job, the artifact it keeps, the files the publish job attaches
   * from it, and whether a failed build still lets the release go out (the
   * apps) or holds it (the rest). alsoKeeps names what else a job keeps that
   * is not for the release: the infrastructure agent's Homebrew cask and
   * winget manifests, which the publish-infrastructure-agent-* jobs publish
   * after the release.
   */
  const ASSETS = [
    {
      job: "generate-sboms",
      artifact: "release-sboms",
      directory: "release-assets/sboms",
      attach: "Attach SBOMs to release",
      files: "release-assets/sboms/*.cdx.json",
      required: true,
    },
    {
      job: "infrastructure-agent-build",
      artifact: "release-infrastructure-agent",
      directory: "release-assets/infrastructure-agent",
      attach: "Attach the infrastructure agent to release",
      files: "release-assets/infrastructure-agent/*",
      required: true,
      alsoKeeps: ["infrastructure-agent-package-manifests"],
    },
    {
      job: "mobile-app-android-build",
      artifact: "release-android-app",
      directory: "release-assets/android-app",
      attach: "Upload APK to GitHub Release",
      files: "release-assets/android-app/oneuptime-on-call-android-app.apk",
      required: false,
    },
    {
      job: "mobile-app-ios-build",
      artifact: "release-ios-app",
      directory: "release-assets/ios-app",
      attach: "Upload IPA to GitHub Release",
      files: "release-assets/ios-app/oneuptime-on-call-ios-app.ipa",
      required: false,
    },
  ];

  test("the publish job publishes in its last step (the checks below are not vacuous)", () => {
    expect(publishIndex).toBe(publishSteps.length - 1);
    expect(needsOf(jobs[PUBLISH])).toEqual(
      expect.arrayContaining(
        ASSETS.map((asset) => {
          return asset.job;
        }),
      ),
    );
  });

  describe.each(ASSETS)(
    "$job",
    ({ job, artifact, directory, attach, files, required, alsoKeeps = [] }) => {
      const definition = jobs[job];
      const uploads = stepsUsing(definition, "actions/upload-artifact");
      const download = publishSteps.findIndex((step) => {
        return (
          (step.uses || "").startsWith("actions/download-artifact@") &&
          step.with.name === artifact
        );
      });
      const attachIndex = publishSteps.findIndex((step) => {
        return step.name === attach;
      });

      test("starts before the release's e2e jobs have finished: it waits for none of them, nor for the draft", () => {
        const waitsFor = ancestorsOf(jobs, job);

        for (const late of [
          ...E2E_JOBS,
          "push-release-tags",
          "draft-github-release",
          "publish-npm-packages",
        ]) {
          expect({ job, late, waited: waitsFor.has(late) }).toEqual({
            job,
            late,
            waited: false,
          });
        }
      });

      test("writes nothing to the release, and may not", () => {
        expect((definition.steps || []).filter(writesTheRelease)).toEqual([]);
        expect(definition.permissions.contents).toBe("read");
      });

      /*
       * It used to need draft-github-release, which runs only for `release`,
       * so a run of another branch (a workflow_dispatch for the store jobs)
       * skipped it. It needs the draft no more, so it says so itself: the
       * draft's own condition, with no status function, so Actions still
       * requires every job it needs to have succeeded.
       */
      test("runs only for `release`, as the draft does, and only once what it needs has succeeded", () => {
        expect(jobs["draft-github-release"].if).toBe(
          "github.ref == 'refs/heads/release'",
        );
        expect(definition.if).toBe(jobs["draft-github-release"].if);
      });

      test("keeps what it built as one artifact, replaced on a re-run, failing if there is nothing to keep", () => {
        expect(
          uploads.map((upload) => {
            return upload.with.name;
          }),
        ).toEqual([artifact, ...alsoKeeps]);
        expect(uploads[0].with).toEqual(
          expect.objectContaining({
            name: artifact,
            "if-no-files-found": "error",
            overwrite: true,
          }),
        );
        expect(uploads[0].with["retention-days"]).toBeGreaterThanOrEqual(30);
      });

      test("keeps nothing else for the release: the publish job downloads none of its other artifacts", () => {
        for (const other of alsoKeeps) {
          expect({
            other,
            downloaded: publishSteps.some((step) => {
              return (
                (step.uses || "").startsWith("actions/download-artifact@") &&
                step.with.name === other
              );
            }),
          }).toEqual({ other, downloaded: false });
        }
      });

      test("is downloaded and attached by the publish job, to the draft, at the run's commit, before the publish", () => {
        const attachStep = publishSteps[attachIndex];

        expect(download).toBeGreaterThan(-1);
        expect(attachIndex).toBeGreaterThan(download);
        expect(attachIndex).toBeLessThan(publishIndex);
        expect(publishSteps[download].with.path).toBe(directory);
        expect(files.startsWith(`${directory}/`)).toBe(true);
        expect(attachStep.uses).toBe("softprops/action-gh-release@v2");
        expect(attachStep.with).toEqual(
          expect.objectContaining({
            files,
            fail_on_unmatched_files: true,
            draft: true,
            prerelease: false,
            target_commitish: "${{ github.sha }}",
          }),
        );
      });

      test(
        required
          ? "is attached whatever happened to the apps, and a failed build holds the release back"
          : "is attached only when its build succeeded, so a failed build lets the release go out without it",
        () => {
          const condition = `needs.${job}.result == 'success'`;
          const ifs = [publishSteps[download].if, publishSteps[attachIndex].if];

          if (required) {
            expect(ifs).toEqual([undefined, undefined]);
            expect(jobs[PUBLISH].if).toContain(condition);
          } else {
            expect(ifs).toEqual([condition, condition]);
            expect(jobs[PUBLISH].if).not.toContain(`needs.${job}.result`);
          }
        },
      );
    },
  );

  test("the apps keep the asset names the release has always had", () => {
    const androidBuild = (jobs["mobile-app-android-build"].steps || [])
      .map(stepCommand)
      .join("\n");
    const iosBuild = (jobs["mobile-app-ios-build"].steps || [])
      .map(stepCommand)
      .join("\n");

    expect(androidBuild).toContain(
      "apk/release/oneuptime-on-call-android-app.apk",
    );
    expect(iosBuild).toContain("/build/oneuptime-on-call-ios-app.ipa");
    expect(
      stepsUsing(jobs["mobile-app-android-build"], "actions/upload-artifact")[0]
        .with.path,
    ).toBe(
      "packages/MobileApp/android/app/build/outputs/apk/release/oneuptime-on-call-android-app.apk",
    );
    expect(
      stepsUsing(jobs["mobile-app-ios-build"], "actions/upload-artifact")[0]
        .with.path,
    ).toBe("${{ runner.temp }}/build/oneuptime-on-call-ios-app.ipa");
  });

  test("the infrastructure agent keeps the files the release always got: the top of dist/, no directories, no dotfiles", () => {
    const collect = (jobs["infrastructure-agent-build"].steps || [])
      .map(stepCommand)
      .join("\n");

    expect(collect).toContain(
      "find agents/InfrastructureAgent/dist -maxdepth 1 -type f ! -name '.*'",
    );
    expect(
      stepsUsing(
        jobs["infrastructure-agent-build"],
        "actions/upload-artifact",
      )[0].with.path,
    ).toBe("${{ runner.temp }}/release-infrastructure-agent/*");
  });

  test("the SBOM job waits for the merge of exactly the images generate_sboms.sh scans", () => {
    const scanned = readBashArray(
      read("Scripts/GHA/generate_sboms.sh"),
      "IMAGES",
    );
    const merges = needsOf(jobs["generate-sboms"]).filter((need) => {
      return need.endsWith("-docker-image-merge");
    });

    expect(scanned.length).toBeGreaterThan(10);
    expect([...merges].sort()).toEqual(
      scanned
        .map((image) => {
          return `${image}-docker-image-merge`;
        })
        .sort(),
    );
  });
});
