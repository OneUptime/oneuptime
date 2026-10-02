"use strict";

/**
 * The Compile workflow (.github/workflows/compile.yml) type-checks every
 * package on every pull request and every push to master.
 *
 * Its core packages compile in four jobs, not one job each - a job's fixed
 * cost (runner, checkout, Node, Common's install) was most of its run time.
 * That is only as strong as a job per package was if each package still sees,
 * while it compiles, exactly what it saw on its own. Module resolution sets
 * what that is, and this suite pins it:
 *
 *   - the FeatureSet packages live inside packages/App, so resolution from
 *     them walks up into packages/App/node_modules. A job that installs a
 *     FeatureSet does not install App - or an import the FeatureSet does not
 *     declare would resolve from App's node_modules and compile - and the job
 *     that compiles App installs no FeatureSet;
 *   - the recorder SDKs published to npm compile with neither Common nor App
 *     installed: they must build from their own dependencies alone;
 *   - MobileApp compiles against Common's build output (its tsconfig maps
 *     Common/* to ../Common/build/dist/*), so Common compiles before it in its
 *     job;
 *   - a failing package does not hide the others: every step after a job's
 *     first install runs unless the run was cancelled.
 *
 * And the thing a job per package made easy to see and still easy to miss:
 * every package under packages/ and packages/App/FeatureSet/ with a compile
 * script is compiled here, after its own install, in the same job. Public
 * Dashboard once went uncompiled until it broke.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { NPM_INSTALL_ACTION, stepCommand } = require("./Utils/WorkflowStep");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const COMPILE_WORKFLOW = ".github/workflows/compile.yml";
const FEATURE_SET = "packages/App/FeatureSet/";
const RECORDERS = [
  "packages/App/FeatureSet/BrowserRecorder",
  "packages/App/FeatureSet/MobileRecorder",
];

function readJson(relativePath) {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"),
  );
}

const workflow = yaml.load(
  fs.readFileSync(path.join(REPO_ROOT, COMPILE_WORKFLOW), "utf8"),
);

// The core jobs: all but compile-ee, which has its own pinned shape.
const coreJobs = Object.entries(workflow.jobs).filter(([name]) => {
  return name !== "compile-ee";
});

function installDirectory(step) {
  if (step.uses !== NPM_INSTALL_ACTION) {
    return null;
  }
  const directory = String((step.with || {})["working-directory"] || ".");
  return directory.replace(/\/+$/, "");
}

function installsOf(job) {
  return job.steps.map(installDirectory).filter(Boolean);
}

// The package a step compiles, from `cd <dir> && npm run compile ...`.
function compiledDirectory(step) {
  const match = /^cd (\S+) && npm run compile(?:\s|$)/.exec(
    stepCommand(step).trim(),
  );
  return match ? match[1] : null;
}

/**
 * Every package.json directly under packages/ and packages/App/FeatureSet/
 * that has a compile script.
 * @returns {Array<string>}
 */
function packagesWithCompileScripts() {
  const directories = [];
  for (const parent of ["packages", "packages/App/FeatureSet"]) {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, parent), {
      withFileTypes: true,
    })) {
      const directory = `${parent}/${entry.name}`;
      if (
        entry.isDirectory() &&
        fs.existsSync(path.join(REPO_ROOT, directory, "package.json")) &&
        (readJson(`${directory}/package.json`).scripts || {}).compile
      ) {
        directories.push(directory);
      }
    }
  }
  return directories.sort();
}

describe("the helpers this suite reads the workflow with", () => {
  test("read the package a compile step compiles, and nothing else", () => {
    expect(
      compiledDirectory({
        with: {
          command: "cd packages/Home && npm run compile && npm run dep-check",
        },
      }),
    ).toBe("packages/Home");
    expect(
      compiledDirectory({ run: "cd packages/Common && npm run compile-tests" }),
    ).toBeNull();
    expect(compiledDirectory({ run: "npm run test-sharding" })).toBeNull();
  });

  test("find packages with a compile script, and not ones without", () => {
    const found = packagesWithCompileScripts();

    expect(found).toContain("packages/Common");
    expect(found).toContain("packages/App/FeatureSet/Dashboard");
    // The FeatureSet directory itself is not a package.
    expect(found).not.toContain("packages/App/FeatureSet");
  });
});

describe(`${COMPILE_WORKFLOW}: every package is compiled`, () => {
  const compiled = coreJobs.flatMap(([, job]) => {
    return job.steps.map(compiledDirectory).filter(Boolean);
  });

  test.each(packagesWithCompileScripts())("%s", (directory) => {
    expect(compiled).toContain(directory);
  });

  test("once", () => {
    expect(new Set(compiled).size).toBe(compiled.length);
  });
});

describe.each(coreJobs)(`${COMPILE_WORKFLOW} %s`, (_name, job) => {
  test("installs each package before it compiles it, in this job", () => {
    job.steps.forEach((step, index) => {
      const directory = compiledDirectory(step);
      if (!directory) {
        return;
      }
      const installedBefore = job.steps.slice(0, index).map(installDirectory);
      expect({
        directory,
        installedBefore: installedBefore.includes(directory),
      }).toEqual({
        directory,
        installedBefore: true,
      });
      // Everything but the recorders links Common, and needs it installed.
      if (!RECORDERS.includes(directory)) {
        expect({
          directory,
          common: installedBefore.includes("packages/Common"),
        }).toEqual({
          directory,
          common: true,
        });
      }
    });
  });

  test("installs App and a FeatureSet in different jobs", () => {
    const installs = installsOf(job);
    const featureSets = installs.filter((directory) => {
      return directory.startsWith(FEATURE_SET);
    });

    if (featureSets.length > 0) {
      expect(installs).not.toContain("packages/App");
    }
  });

  test("installs neither Common nor App beside a recorder", () => {
    const installs = installsOf(job);

    if (
      installs.some((directory) => {
        return RECORDERS.includes(directory);
      })
    ) {
      expect(installs).not.toContain("packages/Common");
      expect(installs).not.toContain("packages/App");
    }
  });

  test("runs every step after its first install unless the run was cancelled", () => {
    const first = job.steps.findIndex((step) => {
      return installDirectory(step) !== null;
    });

    expect(first).toBeGreaterThan(-1);
    for (const step of job.steps.slice(first + 1)) {
      expect({ step: step.name, if: step.if }).toEqual({
        step: step.name,
        if: "${{ !cancelled() }}",
      });
    }
  });
});

test(`${COMPILE_WORKFLOW}: MobileApp compiles after Common, in the same job`, () => {
  const [, job] = coreJobs.find(([, candidate]) => {
    return candidate.steps.some((step) => {
      return compiledDirectory(step) === "packages/MobileApp";
    });
  });
  const order = job.steps.map(compiledDirectory);

  expect(order.indexOf("packages/Common")).toBeGreaterThan(-1);
  expect(order.indexOf("packages/Common")).toBeLessThan(
    order.indexOf("packages/MobileApp"),
  );
  // What makes that necessary.
  expect(
    fs.readFileSync(
      path.join(REPO_ROOT, "packages/MobileApp/tsconfig.json"),
      "utf8",
    ),
  ).toContain("../Common/build/dist/*");
});
