"use strict";

/**
 * The release's Terraform provider job generates, vets and tests the
 * provider once, and the jobs that generate it ask actions/setup-go for no
 * cache it cannot restore (#7592).
 *
 * release.yml's publish-terraform-provider used to generate the provider and
 * vet and test it in steps of its own, then run publish-terraform-provider.sh,
 * which generates, vets and tests it again before GoReleaser builds anything:
 * the generator's Node.js work and its two compiles' cache lookups twice, and
 * two copies of every message in the log. The script was always the one that
 * mattered: it vets and tests the tree it publishes, after syncing it with
 * the provider's repository, and it stops before it pushes anything when
 * generation fails. So the job runs the script alone, as test-release.yaml's
 * dry run of it always has, and that dry run now runs what the release runs.
 *
 * actions/setup-go keys its cache on the hash of a go.sum: the one at the
 * repository's root, unless cache-dependency-path names others. The
 * repository has none at its root, and the provider's go.sum is generated
 * after setup-go runs, so `cache: true` restored nothing and warned
 * "Restore cache failed: Dependencies file is not found". These jobs turn
 * the cache off, as the Crossplane jobs already did: a Go cache that worked
 * would come to several GB, in the cache space the npm caches share.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const { stepCommand, stepCommandFromRoot } = require("./Utils/WorkflowStep");
const {
  generatesTheProvider,
  jobsThatGenerateTheProvider,
} = require("./Utils/TerraformProviderJobs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PUBLISH_SCRIPT =
  "Scripts/TerraformProvider/publish-terraform-provider.sh";
const PUBLISH = "npm run publish-terraform-provider";
const GENERATE = "npm run generate-terraform-provider";

// The jobs that run the publish script, which generates the provider itself.
const PUBLISH_JOBS = [
  [".github/workflows/release.yml", "publish-terraform-provider"],
  [".github/workflows/test-release.yaml", "publish-terraform-provider"],
];

// A step that runs Go on the provider itself.
const RUNS_GO = /(^|[\s;&|(])go (build|vet|test|run)\b/m;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function jobOf(workflowFile, id) {
  return (yaml.load(read(workflowFile)).jobs || {})[id];
}

// Words alone on a line of shell that are not a function being called.
const SHELL_KEYWORDS = ["do", "done", "else", "esac", "fi", "then"];

// The names of the functions `main` calls, in order.
function callsInMain(script) {
  const body = script.slice(
    script.indexOf("\nmain() {"),
    script.indexOf("\n}\n", script.indexOf("\nmain() {")),
  );
  return body
    .split("\n")
    .map((line) => {
      return line.trim();
    })
    .filter((line) => {
      return /^[a-z_]+$/.test(line) && !SHELL_KEYWORDS.includes(line);
    });
}

describe("the helpers this suite reads the workflows with", () => {
  test("find Go run by a step, and not in its words", () => {
    expect(RUNS_GO.test("go vet ./...")).toBe(true);
    expect(RUNS_GO.test("set -e\ngo test ./...")).toBe(true);
    expect(RUNS_GO.test("cd x && go build ./...")).toBe(true);
    expect(RUNS_GO.test('echo "to go there"')).toBe(false);
    expect(RUNS_GO.test("npm run generate-terraform-provider")).toBe(false);
  });

  test("read the functions main calls, and not the words that close a block", () => {
    expect(
      callsInMain(
        'x\nmain() {\n    parse_args "$@"\n    build\n    if [[ a ]]; then\n        clean\n        exit 0\n    fi\n    upload\n}\n\nmain "$@"\n',
      ),
    ).toEqual(["build", "clean", "upload"]);
  });
});

describe(`${PUBLISH_SCRIPT}`, () => {
  const script = read(PUBLISH_SCRIPT);
  const lines = script.split("\n").map((line) => {
    return line.trim();
  });

  test("generates the provider in one place", () => {
    expect(
      lines.filter((line) => {
        return line === GENERATE;
      }),
    ).toHaveLength(1);
  });

  test("vets and tests it in one place, stopping when either fails", () => {
    expect(
      lines.filter((line) => {
        return line === "if ! go vet ./...; then";
      }),
    ).toHaveLength(1);
    expect(
      lines.filter((line) => {
        return line === "if ! go test ./...; then";
      }),
    ).toHaveLength(1);
  });

  test("does each once, before it builds the assets, which come before anything is pushed", () => {
    const calls = callsInMain(script);

    for (const step of ["generate_provider", "run_provider_tests"]) {
      expect(
        calls.filter((call) => {
          return call === step;
        }),
      ).toEqual([step]);
    }
    expect(calls.indexOf("generate_provider")).toBeLessThan(
      calls.indexOf("run_provider_tests"),
    );
    expect(calls.indexOf("run_provider_tests")).toBeLessThan(
      calls.indexOf("build_release_assets"),
    );
    expect(calls.indexOf("build_release_assets")).toBeLessThan(
      calls.indexOf("push_repository_changes"),
    );
  });
});

describe.each(PUBLISH_JOBS)("%s %s", (workflowFile, id) => {
  const job = jobOf(workflowFile, id);

  test("runs the publish script once", () => {
    expect(
      job.steps.map(stepCommand).filter((command) => {
        return command.includes(PUBLISH);
      }),
    ).toHaveLength(1);
  });

  test("leaves generating the provider to it", () => {
    expect(
      job.steps
        .filter(generatesTheProvider)
        .map(stepCommandFromRoot)
        .every((command) => {
          return command.includes(PUBLISH) && !command.includes(GENERATE);
        }),
    ).toBe(true);
  });

  test("and vetting, testing and building it", () => {
    expect(
      job.steps
        .filter((step) => {
          return RUNS_GO.test(stepCommand(step));
        })
        .map((step) => {
          return step.name || stepCommand(step);
        }),
    ).toEqual([]);
  });
});

/*
 * Whether git tracks `relativePath`: only a tracked file is there when a job
 * has only checked the repository out. The provider's go.sum is on disk once
 * it has been generated, and is gitignored.
 */
function tracked(relativePath) {
  const result = spawnSync("git", ["ls-files", "--", relativePath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr || result.error}`);
  }
  return result.stdout.trim().length > 0;
}

describe("every job that generates the Terraform provider", () => {
  const jobs = jobsThatGenerateTheProvider();
  const rootGoSum = tracked("go.sum");

  /*
   * Whether a setup-go step's cache can restore anything: it is off, or it
   * is keyed on go.sum files that are in the repository when it runs.
   */
  function cacheCanRestore(step) {
    const inputs = step.with || {};
    // setup-go caches unless told not to.
    if (inputs.cache === false || inputs.cache === "false") {
      return true;
    }
    const dependencyPaths = String(inputs["cache-dependency-path"] || "")
      .split("\n")
      .map((line) => {
        return line.trim();
      })
      .filter((line) => {
        return line.length > 0;
      });
    if (dependencyPaths.length === 0) {
      return rootGoSum;
    }
    return dependencyPaths.every(tracked);
  }

  test("is found", () => {
    expect(jobs.length).toBeGreaterThanOrEqual(6);
  });

  test("the repository has no go.sum at its root, for setup-go to key a cache on", () => {
    expect(rootGoSum).toBe(false);
  });

  test.each(
    jobs.map(({ name }) => {
      return name;
    }),
  )("%s sets up Go with no cache it cannot restore", (name) => {
    const { job } = jobs.find((entry) => {
      return entry.name === name;
    });
    const setupGo = (job.steps || []).filter((step) => {
      return String(step.uses || "").startsWith("actions/setup-go@");
    });

    expect(setupGo.length).toBeGreaterThan(0);
    expect(
      setupGo
        .filter((step) => {
          return !cacheCanRestore(step);
        })
        .map((step) => {
          return step.name || step.uses;
        }),
    ).toEqual([]);
  });
});
