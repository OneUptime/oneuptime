"use strict";

/**
 * Every action a workflow names exists on GitHub, and the release signs with
 * an installer pinned to the release it is.
 *
 * GitHub resolves a `uses:` ref only when a job that runs it starts, and
 * release.yml's jobs start only on release day. sign-images named
 * sigstore/cosign-installer@v4, a tag that repository never published (its v4
 * releases are v4.0.0 to v4.1.3), so 14.0.104's "Sign the release's images"
 * failed at "Set up job" and none of its images were signed (#6151).
 *
 * Ops Config Test's action-refs job runs Scripts/GHA/check_action_refs.sh on
 * every pull request: it reads each repository's tags and branches and fails
 * a ref that is neither, or a commit pin that is not the tag its comment
 * names. Its own suite (Scripts/GHA/Tests/check_action_refs_test.sh) drives
 * it with a fake git. This one holds it to the real workflows: it reads every
 * `uses:` the YAML has, and nothing the YAML does not, so no ref skips the
 * check because the script's line reading missed it.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECK_REFS = "Scripts/GHA/check_action_refs.sh";
const FULL_SHA = /^[0-9a-f]{40}$/;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// Every workflow and composite action file, as the script finds them.
function yamlFilesUnder(relativeDirectory) {
  const directory = path.join(REPO_ROOT, relativeDirectory);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory, { recursive: true })
    .map((entry) => {
      return path.posix.join(
        relativeDirectory,
        String(entry).split(path.sep).join("/"),
      );
    })
    .filter((file) => {
      return (
        /\.ya?ml$/.test(file) &&
        fs.statSync(path.join(REPO_ROOT, file)).isFile()
      );
    });
}

const FILES = [
  ...yamlFilesUnder(".github/workflows"),
  ...yamlFilesUnder(".github/actions"),
].sort();

function isRemote(target) {
  return !target.startsWith("./") && !target.startsWith("docker://");
}

// Every remote `uses:` of a file, as its YAML says: a job's (a reusable
// workflow), its steps', and a composite action's steps'.
function usesInYaml(file) {
  const document = yaml.load(read(file)) || {};
  const found = [];
  const fromSteps = (steps) => {
    for (const step of steps || []) {
      if (step && typeof step.uses === "string") {
        found.push(step.uses);
      }
    }
  };
  for (const job of Object.values(document.jobs || {})) {
    if (job && typeof job.uses === "string") {
      found.push(job.uses);
    }
    fromSteps(job && job.steps);
  }
  fromSteps(document.runs && document.runs.steps);
  return found.filter(isRemote);
}

function runCheck(args) {
  return spawnSync("bash", [CHECK_REFS, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

// What the script reads: <file>:<line> TAB <target> TAB <comment>.
const listed = (() => {
  const result = runCheck(["--list"]);
  if (result.status !== 0) {
    throw new Error(`${CHECK_REFS} --list failed: ${result.stderr}`);
  }
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [place, target, comment] = line.split("\t");
      const at = place.lastIndexOf(":");
      return {
        file: place.slice(0, at),
        line: Number(place.slice(at + 1)),
        target,
        comment: comment || "",
      };
    });
})();

function counts(values) {
  const tally = {};
  for (const value of values) {
    tally[value] = (tally[value] || 0) + 1;
  }
  return tally;
}

describe("check_action_refs.sh reads every action ref of the real workflows", () => {
  test("it finds the workflows and composite actions", () => {
    expect(FILES).toContain(".github/workflows/release.yml");
    expect(FILES).toContain(".github/workflows/test.ops.yaml");
    expect(
      FILES.some((file) => {
        return file.startsWith(".github/actions/");
      }),
    ).toBe(true);
    // A few hundred refs: one missing file or a parser that stopped early
    // would show here before anywhere else.
    expect(listed.length).toBeGreaterThan(300);
  });

  test.each(FILES)(
    "%s: the refs it reads are the YAML's, each as often",
    (file) => {
      const fromScript = listed
        .filter((use) => {
          return use.file === file;
        })
        .map((use) => {
          return use.target;
        });
      expect(counts(fromScript)).toEqual(counts(usesInYaml(file)));
    },
  );

  test("it names no file the YAML walk does not", () => {
    const files = new Set(
      listed.map((use) => {
        return use.file;
      }),
    );
    for (const file of files) {
      expect(FILES).toContain(file);
    }
  });

  test("each ref's line is the line that names it", () => {
    for (const use of listed) {
      const line = read(use.file).split("\n")[use.line - 1];
      expect(line).toMatch(/^\s*(-\s+)?uses:/);
      expect(line).toContain(use.target);
    }
  });

  test("every commit pin says which release it is, so the check can hold it to that tag", () => {
    const pins = listed.filter((use) => {
      return FULL_SHA.test(use.target.split("@").pop());
    });
    expect(pins.length).toBeGreaterThan(0);
    for (const pin of pins) {
      expect({ ...pin, tag: pin.comment.split(/\s+/)[0] }).toEqual({
        ...pin,
        tag: expect.stringMatching(/^v\d+(\.\d+)*$/),
      });
    }
  });
});

describe("the release signs its images with an installer that exists", () => {
  const signImages = yaml.load(read(".github/workflows/release.yml")).jobs[
    "sign-images"
  ];
  const steps = signImages.steps;
  const installIndex = steps.findIndex((step) => {
    return (
      typeof step.uses === "string" &&
      step.uses.startsWith("sigstore/cosign-installer@")
    );
  });
  const signIndex = steps.findIndex((step) => {
    return (
      typeof step.run === "string" &&
      step.run.includes("Scripts/GHA/sign_docker_images.sh")
    );
  });

  test("it installs cosign with sigstore/cosign-installer, before it signs", () => {
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(signIndex).toBeGreaterThan(installIndex);
  });

  test("the installer is pinned by commit, never by a major tag the repository does not publish", () => {
    const ref = steps[installIndex].uses.split("@").pop();
    expect(ref).toMatch(FULL_SHA);
    expect(ref).not.toBe("v4");
  });

  test("the pin names its release, which is the tag check_action_refs.sh holds the commit to", () => {
    const pin = listed.find((use) => {
      return (
        use.file === ".github/workflows/release.yml" &&
        use.target === steps[installIndex].uses
      );
    });
    expect(pin).toBeDefined();
    expect(pin.comment).toMatch(/^v4\.\d+\.\d+$/);
  });

  test("it can still sign keyless: an OIDC token and the packages it signs", () => {
    expect(signImages.permissions).toEqual({
      contents: "read",
      packages: "write",
      "id-token": "write",
    });
  });
});

describe("every pull request checks the refs", () => {
  const workflow = yaml.load(read(".github/workflows/test.ops.yaml"));
  const job = workflow.jobs["action-refs"];

  test("Ops Config Test runs on pull requests and on main", () => {
    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.on.push.branches).toEqual(["main"]);
  });

  test("its action-refs job checks out the code, then runs the check on all of it", () => {
    expect(job).toBeDefined();
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
    expect(job.steps[0].uses).toMatch(/^actions\/checkout@/);
    const runs = job.steps
      .map((step) => {
        return step.run;
      })
      .filter(Boolean);
    expect(runs).toEqual(["bash ./Scripts/GHA/check_action_refs.sh"]);
  });

  test("its suite runs with the other Scripts/GHA suites", () => {
    expect(
      fs.existsSync(
        path.join(REPO_ROOT, "Scripts/GHA/Tests/check_action_refs_test.sh"),
      ),
    ).toBe(true);
    expect(read("Scripts/GHA/Tests/run.sh")).toContain(
      '"${TESTS_DIR}"/*_test.sh',
    );
  });
});
