"use strict";

/**
 * release.yml's e2e jobs run the amd64 images this run's builds push, and
 * push-release-tags moves `release` only onto the images they ran.
 *
 * Each image's build job is a matrix of two legs, amd64 and arm64, and each
 * leg pushes its own tags with an arch suffix (oneuptime/app:9.9.9-amd64);
 * the merge job then joins the two into the multi-arch tag
 * (oneuptime/app:9.9.9), whose amd64 entry is the very image the amd64 leg
 * pushed. The e2e jobs run on amd64 runners, so the -amd64 tag is what they
 * pulled through the merged tag anyway. A merge is a few seconds of work
 * behind a queue for a runner of its own: a release run's merges queued 8 to
 * 21 minutes between the last build and the e2e jobs (#5328), on the
 * release's critical path. Master's e2e jobs (test-release.yaml) boot the
 * -amd64 tags since #4953 (TestReleaseE2eImages.test.js); the release's do
 * the same now.
 *
 * But the release publishes the MERGED tags: push-release-tags moves each
 * image's `release` and `enterprise-release` tags from them. So before it
 * moves any, it checks each merged tag's linux/amd64 image is the -amd64
 * image the e2e jobs ran (Scripts/GHA/check_tested_digests.sh; its own bash
 * suite holds the check's reads and answers). This suite holds the wiring:
 *
 *   - every e2e job boots, for every image of its stack, a tag the image's
 *     amd64 build leg pushes, names no tag a merge pushes in any step, and
 *     waits for the builds, not the merges, of the same images it waited for;
 *   - push-release-tags still waits for every merge and every e2e job, and
 *     runs the check - for real here, with a fake registry - before the step
 *     that moves the tags, over the same images and version: it reads the
 *     very merged tags the move step moves `release` from, and the -amd64
 *     tags the merge jobs built them from; a merged tag that is not the
 *     tested image stops the job before a single tag moves.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const {
  needsOf,
  ancestorsOf,
  callsFor,
  matrixPlatforms,
  mergedTags,
  releaseTagImages,
} = require("./Utils/ReleaseWorkflow");
const {
  REPO_ROOT,
  VERSION,
  withVersion,
  startedStack,
  stackImages,
  imageName,
  tagsNamed,
  pinStep,
  pinnedTag,
  recordingDocker,
  amd64LegPushes,
} = require("./Utils/E2eStack");

const RELEASE = ".github/workflows/release.yml";
const E2E_OVERLAY = "packages/E2E/docker-compose.e2e.yml";
const CHECK_SCRIPT = "Scripts/GHA/check_tested_digests.sh";
const MERGE_SCRIPT = "Scripts/GHA/merge_docker_manifests.sh";

const E2E_JOBS = [
  "test-e2e-release-saas",
  "test-e2e-release-self-hosted",
  "test-e2e-release-enterprise",
];

// The images the e2e jobs waited for, at their merges, before they waited for their builds.
const IMAGES_THE_E2E_JOBS_WAIT_FOR = [
  "app",
  "e2e",
  "home",
  "nginx",
  "probe",
  "runner",
  "test",
  "test-server",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const workflowText = read(RELEASE);
const jobs = yaml.load(workflowText).jobs;

describe(`${RELEASE}: the e2e jobs run the amd64 images this run's builds push`, () => {
  let workDir = "";
  const pushed = {};

  function pushedByTheAmd64Leg(image) {
    if (!pushed[image]) {
      pushed[image] = amd64LegPushes(jobs, image, workDir);
    }
    return pushed[image];
  }

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-e2e-"));
    recordingDocker(workDir);
  });

  afterAll(() => {
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  test("finds every e2e job, its stack and the builds of its images (the checks below are not vacuous)", () => {
    for (const name of E2E_JOBS) {
      const images = [
        ...stackImages(startedStack(jobs[name])),
        ...stackImages([E2E_OVERLAY]),
      ];
      expect(images.length).toBeGreaterThan(3);
      for (const image of images) {
        expect(jobs[`${imageName(image)}-docker-image-build`]).toBeDefined();
      }
    }
  });

  test("the fake docker sees the pushes: the App's amd64 leg pushes both editions, arch-suffixed, under the release's version", () => {
    const tags = pushedByTheAmd64Leg("app");

    expect(tags).toEqual(
      expect.arrayContaining([
        `oneuptime/app:${VERSION}-amd64`,
        `ghcr.io/oneuptime/app:${VERSION}-amd64`,
        `oneuptime/app:enterprise-${VERSION}-amd64`,
        `ghcr.io/oneuptime/app:enterprise-${VERSION}-amd64`,
      ]),
    );
    expect(
      tags.filter((tag) => {
        return !tag.endsWith("-amd64");
      }),
    ).toEqual([]);
  });

  describe.each(E2E_JOBS)("%s", (name) => {
    const job = jobs[name];
    const images = [
      ...stackImages(startedStack(job)),
      ...stackImages([E2E_OVERLAY]),
    ];

    test("runs on an amd64 runner", () => {
      expect(job["runs-on"]).toBe("ubuntu-latest");
    });

    test("names one tag, the amd64 one, in every step that names it", () => {
      const named = tagsNamed(job);
      const pinned = pinnedTag(job, workDir);

      expect(named.length).toBeGreaterThanOrEqual(3);
      expect([...new Set([...named, pinned])]).toEqual([pinned]);
      expect(pinned.endsWith("-amd64")).toBe(true);
    });

    test("boots, for every image of its stack, a tag the image's amd64 build leg pushes", () => {
      const tag = pinnedTag(job, workDir);

      for (const image of images) {
        const reference = image.replace("${APP_TAG}", tag);
        expect({
          image,
          pushed: pushedByTheAmd64Leg(imageName(image)),
        }).toEqual({ image, pushed: expect.arrayContaining([reference]) });
      }
    });

    /*
     * The tags a merge pushes - <version> and enterprise-<version> - move
     * only once the merge has run, and this job does not wait for it: until
     * then they still name the previous release's images. So no step of the
     * job may name one, wherever it names an image: a run line, a step's or
     * the job's env, an action's inputs. The pin step builds its tag in the
     * shell and is run above; every other step must spell the arch suffix out.
     */
    test("names no tag a merge pushes, in any step: every image it names is an -amd64 tag", () => {
      const pin = pinStep(job);
      const texts = [
        { where: "the job's env", text: JSON.stringify(job.env || {}) },
        ...(job.steps || [])
          .filter((step) => {
            return step !== pin;
          })
          .map((step) => {
            return {
              where: step.name || step.uses || "a step",
              text: JSON.stringify(step),
            };
          }),
      ];
      const unsuffixed = [];
      let imagesNamed = 0;

      for (const { where, text } of texts) {
        const filled = withVersion(text);
        // The run's version, as a merge's tags carry it: never on its own.
        for (const match of filled.matchAll(/\b9\.9\.9(?!-amd64)/g)) {
          unsuffixed.push(`${where}: ${match[0]}`);
        }
        // An image by name and tag, other than the pinned ${APP_TAG}.
        for (const match of filled.matchAll(
          /(?:ghcr\.io\/)?oneuptime\/[a-z0-9-]+:([A-Za-z0-9_.{}$-]+)/g,
        )) {
          imagesNamed += 1;
          if (match[1] !== "${APP_TAG}" && !match[1].endsWith("-amd64")) {
            unsuffixed.push(`${where}: ${match[0]}`);
          }
        }
        // APP_TAG set to a literal anywhere: an env entry or an assignment.
        for (const match of filled.matchAll(
          /\bAPP_TAG"?\s*[:=]\s*"?([A-Za-z0-9_.-]+)/g,
        )) {
          if (!match[1].endsWith("-amd64")) {
            unsuffixed.push(`${where}: ${match[0]}`);
          }
        }
      }

      // The App image its edition check pulls, at least.
      expect(imagesNamed).toBeGreaterThan(0);
      expect(unsuffixed).toEqual([]);
    });

    test("waits for each of those builds, whose matrix has the amd64 leg", () => {
      for (const image of images) {
        const build = `${imageName(image)}-docker-image-build`;
        expect(needsOf(job)).toContain(build);
        expect(matrixPlatforms(jobs[build])).toContain("linux/amd64");
      }
    });

    test("waits for no merge, directly or through another job", () => {
      expect(
        [...ancestorsOf(jobs, name)].filter((ancestor) => {
          return ancestor.endsWith("-docker-image-merge");
        }),
      ).toEqual([]);
    });

    test("waits for the builds of the same images it waited for at their merges, and for what else it waited for", () => {
      expect([...needsOf(job)].sort()).toEqual(
        [
          ...IMAGES_THE_E2E_JOBS_WAIT_FOR.map((image) => {
            return `${image}-docker-image-build`;
          }),
          "helm-chart-check",
          "read-version",
        ].sort(),
      );
    });
  });

  test("the editions match: the SaaS and enterprise jobs boot enterprise- tags, the self-hosted job a Community tag", () => {
    expect(pinnedTag(jobs["test-e2e-release-saas"], workDir)).toBe(
      `enterprise-${VERSION}-amd64`,
    );
    expect(pinnedTag(jobs["test-e2e-release-enterprise"], workDir)).toBe(
      `enterprise-${VERSION}-amd64`,
    );
    expect(pinnedTag(jobs["test-e2e-release-self-hosted"], workDir)).toBe(
      `${VERSION}-amd64`,
    );
  });
});

/*
 * push-release-tags, run for real: the check step and the move step, each as
 * Actions runs a step that names no shell (`bash -e`, the script in a file of
 * its own), against a fake docker that answers `imagetools inspect` from a
 * fake registry and records every `imagetools create`.
 */
describe(`${RELEASE}: push-release-tags moves \`release\` only onto the images the e2e jobs ran`, () => {
  const job = jobs["push-release-tags"];
  const CHECK_STEP =
    "Check each merged tag's amd64 image is the one the e2e jobs ran";
  const MOVE_STEP =
    "Move each image's release and enterprise-release tags to this version";
  const steps = job.steps || [];
  const checkIndex = steps.findIndex((step) => {
    return step.name === CHECK_STEP;
  });
  const moveIndex = steps.findIndex((step) => {
    return step.name === MOVE_STEP;
  });

  let workDir = "";
  let runs = 0;

  function digest(character) {
    return `sha256:${character.repeat(64)}`;
  }

  function registryFile(registry, reference) {
    return path.join(registry, `${reference.replace(/[/:]/g, "_")}.json`);
  }

  // An index whose linux/amd64 image is `amd64`, with an attestation beside it.
  function putIndex(registry, reference, amd64) {
    fs.writeFileSync(
      registryFile(registry, reference),
      JSON.stringify({
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.index.v1+json",
        digest: digest("f"),
        manifests: [
          {
            digest: amd64,
            platform: { architecture: "amd64", os: "linux" },
          },
          {
            digest: digest("e"),
            annotations: {
              "vnd.docker.reference.digest": amd64,
              "vnd.docker.reference.type": "attestation-manifest",
            },
            platform: { architecture: "unknown", os: "unknown" },
          },
        ],
      }),
    );
  }

  /*
   * The registry a release run leaves: every image's merged tags, both
   * editions, with their -amd64 tags' images - each image and edition a
   * digest of its own.
   */
  function releaseRegistry(images) {
    runs += 1;
    const registry = path.join(workDir, `registry-${runs}`);
    fs.mkdirSync(registry);
    images.forEach((image, index) => {
      const hex = "0123456789abcdef";
      for (const [edition, tag] of [
        [0, VERSION],
        [1, `enterprise-${VERSION}`],
      ]) {
        const image64 = digest(hex[(index * 2 + edition) % 16]);
        putIndex(registry, `ghcr.io/oneuptime/${image}:${tag}`, image64);
        putIndex(registry, `ghcr.io/oneuptime/${image}:${tag}-amd64`, image64);
      }
    });
    return registry;
  }

  function runStep(step, registry, images = job.env.RELEASE_TAG_IMAGES) {
    runs += 1;
    const log = path.join(workDir, `calls-${runs}`);
    fs.writeFileSync(log, "");
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
        VERSION,
        RETRY_WITH_BACKOFF_DELAYS: "0 0 0",
        RETRY_REGISTRY_READ_DELAYS: "0 0 0",
        FAKE_DOCKER_LOG: log,
        FAKE_REGISTRY: registry,
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

  function inspected(calls) {
    return calls
      .filter((call) => {
        return call.startsWith("buildx imagetools inspect ");
      })
      .map((call) => {
        return call.split(" ")[3];
      });
  }

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-digests-"));
    fs.mkdirSync(path.join(workDir, "bin"));
    fs.writeFileSync(
      path.join(workDir, "bin", "docker"),
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$*" >>"$FAKE_DOCKER_LOG"',
        'if [[ "$1 $2 $3" == "buildx imagetools inspect" ]]; then',
        '  file="$FAKE_REGISTRY/$(echo "$4" | tr "/:" "__").json"',
        '  if [[ ! -f "$file" ]]; then echo "ERROR: $4: not found: manifest unknown" >&2; exit 1; fi',
        '  cat "$file"; exit 0',
        "fi",
        'if [[ "$1 $2 $3" == "buildx imagetools create" ]]; then exit 0; fi',
        'echo "unexpected docker call: $*" >&2; exit 2',
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

  test("still waits for every merge it moves `release` from, and for the three e2e jobs", () => {
    for (const image of releaseTagImages(job)) {
      expect(needsOf(job)).toContain(`${image}-docker-image-merge`);
    }
    for (const e2e of E2E_JOBS) {
      expect(needsOf(job)).toContain(e2e);
    }
  });

  test("runs the check before the step that moves the tags, over the same images and the run's version", () => {
    expect(checkIndex).toBeGreaterThan(-1);
    expect(moveIndex).toBeGreaterThan(checkIndex);

    const check = steps[checkIndex];
    expect(check.env).toEqual({
      VERSION: "${{needs.read-version.outputs.major_minor}}",
    });
    expect(check.run.trim()).toBe(
      `bash ./${CHECK_SCRIPT} --images "$RELEASE_TAG_IMAGES" --version "$VERSION"`,
    );
    // A failed check stops the job: nothing lets the move step run after it.
    expect(check["continue-on-error"]).toBeUndefined();
    expect(check.if).toBeUndefined();
    expect(steps[moveIndex].if).toBeUndefined();
    expect(fs.existsSync(path.join(REPO_ROOT, CHECK_SCRIPT))).toBe(true);
  });

  test("passes when every merged tag is the image the e2e jobs ran, reading both editions of all ten images", () => {
    const images = releaseTagImages(job);
    const run = runStep(steps[checkIndex], releaseRegistry(images));

    expect(run.status).toBe(0);
    expect(images).toHaveLength(10);
    expect(inspected(run.calls)).toEqual(
      images.flatMap((image) => {
        return [VERSION, `enterprise-${VERSION}`].flatMap((tag) => {
          return [
            `ghcr.io/oneuptime/${image}:${tag}`,
            `ghcr.io/oneuptime/${image}:${tag}-amd64`,
          ];
        });
      }),
    );
  });

  test("fails, naming it, when one merged tag is not the image the e2e jobs ran - and every image is still read", () => {
    const images = releaseTagImages(job);
    const registry = releaseRegistry(images);
    putIndex(
      registry,
      `ghcr.io/oneuptime/probe:enterprise-${VERSION}`,
      digest("9"),
    );

    const run = runStep(steps[checkIndex], registry);

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      `::error title=Release tags not moved::not the images the e2e jobs ran: probe:enterprise-${VERSION}`,
    );
    expect(inspected(run.calls)).toHaveLength(images.length * 4);
  });

  test("reads exactly the merged tags the move step moves `release` from", () => {
    const images = releaseTagImages(job);
    const check = runStep(steps[checkIndex], releaseRegistry(images));
    const move = runStep(steps[moveIndex], releaseRegistry(images));
    // The last word of each move is the tag it moves `release` from.
    const moved = move.calls.map((call) => {
      const words = call.split(" ");
      return words[words.length - 1];
    });

    expect(move.status).toBe(0);
    expect(moved.length).toBe(images.length * 2);
    expect(
      inspected(check.calls).filter((reference) => {
        return !reference.endsWith("-amd64");
      }),
    ).toEqual(moved);
  });

  test("compares each merged tag with the -amd64 tag its merge job built it from", () => {
    const images = releaseTagImages(job);
    const check = runStep(steps[checkIndex], releaseRegistry(images));
    const read = inspected(check.calls);

    for (const image of images) {
      const [call] = callsFor(jobs, "merge_docker_manifests.sh", image);
      expect(call).toBeDefined();
      expect(call.job).toBe(`${image}-docker-image-merge`);

      // The merge step's shell names the version sanitized, as a variable.
      const tags = mergedTags(call.command).map((tag) => {
        return tag.replace("${SANITIZED_VERSION}", VERSION);
      });

      for (const tag of [VERSION, `enterprise-${VERSION}`]) {
        expect({ image, tags }).toEqual({
          image,
          tags: expect.arrayContaining([tag]),
        });
        // merge_docker_manifests.sh joins <tag>-amd64 and <tag>-arm64 into <tag>.
        const merge = spawnSync(
          "bash",
          [path.join(REPO_ROOT, MERGE_SCRIPT), "--image", image, "--tags", tag],
          {
            cwd: REPO_ROOT,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${path.join(workDir, "bin")}${path.delimiter}${process.env.PATH}`,
              FAKE_DOCKER_LOG: path.join(workDir, `merge-${image}-${tag}`),
              FAKE_REGISTRY: path.join(workDir, "no-registry"),
              RETRY_WITH_BACKOFF_DELAYS: "0 0 0",
            },
          },
        );
        expect(merge.status).toBe(0);
        const created = fs
          .readFileSync(path.join(workDir, `merge-${image}-${tag}`), "utf8")
          .split("\n")
          .find((line) => {
            return line.startsWith("buildx imagetools create ");
          });
        const sources = created.split(" ").slice(-2);

        expect(sources).toEqual([
          `ghcr.io/oneuptime/${image}:${tag}-amd64`,
          `ghcr.io/oneuptime/${image}:${tag}-arm64`,
        ]);
        expect(read).toEqual(
          expect.arrayContaining([
            `ghcr.io/oneuptime/${image}:${tag}`,
            sources[0],
          ]),
        );
      }
    }
  });

  test("refuses to pass with no image to check, rather than look like every image passed", () => {
    const run = runStep(steps[checkIndex], releaseRegistry([]), " \n ");

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("--images names no image");
    expect(run.calls).toEqual([]);
  });
});
