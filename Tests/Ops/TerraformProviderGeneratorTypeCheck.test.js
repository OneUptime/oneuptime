"use strict";

/**
 * Scripts/TerraformProvider's `npm run compile` type-checks the Terraform
 * provider generator: its own files, Scripts/OpenAPI/GenerateSpec.ts, and the
 * Common sources they import, with Common's own compiler options. No
 * workflow ran it, and it had been failing with some 10,700 errors - from
 * options of its own that Common's code was never written for - before
 * anyone looked.
 *
 * The Terraform Provider Generation workflow runs it now. This pins that it
 * keeps doing so, where it can work:
 *
 *   - on every pull request, and on main nightly (not on every push to
 *     main, which PullRequestChecksNotOnPush.test.js explains);
 *   - after installing, in the same job, Common (the Common files it checks
 *     resolve their packages from packages/Common/node_modules), Scripts
 *     (GenerateSpec.ts's @readme/openapi-parser) and the generator itself
 *     (TypeScript and the generator's @types);
 *   - before the provider is generated, so a failed generation cannot skip
 *     it, and with nothing that lets it fail without failing the job;
 *   - with the generator's unit tests still running when it fails, so one
 *     run reports both.
 *
 * It is the generator's only type check. Generation itself checks nothing:
 * `npm run generate-terraform-provider` runs the generator transpile-only.
 * With ts-node's type checker, Node.js held about 2.1 GiB while Go compiled
 * the provider, and 1.1 GiB without it, for a provider byte for byte the
 * same (#7592). Every other job that generates the provider runs code this
 * check has already checked: on the same pull request, or on main and in a
 * release after the pull requests that brought it there - the release's own
 * pull request into `release` among them - and nightly on main. A job that
 * starts to generate the provider is named below with why that holds for
 * it, or type-checks the generator itself.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const {
  isNpmInstallStep,
  stepCommandFromRoot,
  stepWorkingDirectory,
} = require("./Utils/WorkflowStep");
const {
  jobsThatGenerateTheProvider,
} = require("./Utils/TerraformProviderJobs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = ".github/workflows/terraform-provider-generation.yml";
const GENERATOR = "Scripts/TerraformProvider";

// Each as one shell line typed at the repository root (stepCommandFromRoot).
const TYPE_CHECK = `cd ${GENERATOR} && npm run compile`;
const UNIT_TESTS = `cd ${GENERATOR} && npm test`;
const GENERATE = "npm run generate-terraform-provider";

// Where the type check resolves imports from (see above).
const INSTALLS_THE_TYPE_CHECK_NEEDS = ["packages/Common", "Scripts", GENERATOR];

const NOT_CANCELLED = "${{ !cancelled() }}";

// How the root's package.json runs the generator: without a type check.
const GENERATE_SCRIPT =
  "sh ./Scripts/Install/WithConfig.sh node --require ts-node/register/transpile-only ./Scripts/TerraformProvider/GenerateProvider.ts";

/*
 * The jobs that generate the provider without type-checking the generator
 * themselves, and the runs of the type check that checked their code first.
 */
const CHECKED_BEFORE_THEY_RUN = {
  "crossplane-provider.yml crossplane-e2e":
    "its pull requests run the type check too, as do main's nightly run and the release's pull request",
  "release.yml publish-crossplane-provider":
    "it publishes what the release's pull request into `release` type-checked",
  "release.yml publish-terraform-provider":
    "it publishes what the release's pull request into `release` type-checked",
  "terraform-provider-e2e.yml terraform-e2e-tests":
    "it runs on the pull requests the type check runs on, on main nightly beside it, and in the release run after the release's pull request",
  "test-release.yaml publish-terraform-provider":
    "it runs on main, after the pull request that brought each change there",
};

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const workflow = yaml.load(read(WORKFLOW));

/**
 * A workflow's triggers as a map. `on:` can be an event name, a list of them,
 * or a map of event to its filters.
 * @param {object} parsed - The parsed workflow
 * @returns {object} event name -> filters (null when it has none)
 */
function triggers(parsed) {
  // js-yaml reads `on` as a string; a YAML 1.1 reader would make it `true`.
  const on = parsed.on === undefined ? parsed[true] : parsed.on;
  if (typeof on === "string") {
    return { [on]: null };
  }
  if (Array.isArray(on)) {
    return Object.fromEntries(
      on.map((event) => {
        return [event, null];
      }),
    );
  }
  return on || {};
}

/**
 * Every step of the workflow that runs `command`, with its job and position.
 * @param {string} command - As stepCommandFromRoot writes it
 * @returns {Array<{jobName: string, job: object, index: number, step: object}>}
 */
function stepsRunning(command) {
  const found = [];
  for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
    (job.steps || []).forEach((step, index) => {
      if (stepCommandFromRoot(step).trim() === command) {
        found.push({ jobName, job, index, step });
      }
    });
  }
  return found;
}

function onlyStepRunning(command) {
  const found = stepsRunning(command);
  expect(found.map(({ jobName, index }) => `${jobName}#${index}`)).toHaveLength(
    1,
  );
  return found[0];
}

describe("the helpers this suite reads the workflow with", () => {
  test("read a step that cds into the generator, and one with a working-directory, as the same command", () => {
    expect(stepCommandFromRoot({ run: TYPE_CHECK })).toBe(TYPE_CHECK);
    expect(
      stepCommandFromRoot({
        "working-directory": GENERATOR,
        run: "npm run compile",
      }),
    ).toBe(TYPE_CHECK);
  });

  test("read `on` as a map of events, whatever form it is written in", () => {
    expect(triggers({ on: "push" })).toEqual({ push: null });
    expect(triggers({ on: ["push", "pull_request"] })).toEqual({
      push: null,
      pull_request: null,
    });
    expect(triggers({ [true]: { push: { branches: ["main"] } } })).toEqual({
      push: { branches: ["main"] },
    });
  });
});

describe(`${GENERATOR}: npm run compile`, () => {
  test("is a type check: tsc over the generator's tsconfig.json, building nothing", () => {
    const packageJson = JSON.parse(read(`${GENERATOR}/package.json`));

    expect(packageJson.scripts.compile).toBe("tsc --noEmit");
  });
});

describe(`${WORKFLOW} type-checks the generator`, () => {
  test("in exactly one step", () => {
    expect(stepsRunning(TYPE_CHECK)).toHaveLength(1);
  });

  test("on every pull request, and on main nightly", () => {
    const events = triggers(workflow);

    // pull_request with no filter: every pull request, whatever it touches.
    expect(Object.keys(events)).toContain("pull_request");
    expect(events.pull_request).toBeNull();
    // Main's run is the nightly one, of whatever main holds by then.
    expect(events.schedule).toHaveLength(1);
  });

  test.each(INSTALLS_THE_TYPE_CHECK_NEEDS)(
    "after installing %s, in the same job",
    (directory) => {
      const { job, index } = onlyStepRunning(TYPE_CHECK);
      const installedBefore = job.steps
        .slice(0, index)
        .filter(isNpmInstallStep)
        .map(stepWorkingDirectory);

      expect(installedBefore).toContain(directory);
    },
  );

  test("before the provider is generated, so a failed generation cannot skip it", () => {
    const typeCheck = onlyStepRunning(TYPE_CHECK);
    const generate = onlyStepRunning(GENERATE);

    expect(generate.jobName).toBe(typeCheck.jobName);
    expect(typeCheck.index).toBeLessThan(generate.index);
  });

  test("and a failure fails the job", () => {
    const { job, step } = onlyStepRunning(TYPE_CHECK);

    expect(step["continue-on-error"]).toBeUndefined();
    expect(job["continue-on-error"]).toBeUndefined();
    // Runs unless an earlier step failed or the run was cancelled.
    expect([undefined, NOT_CANCELLED]).toContain(step.if);
  });

  test("and the generator's unit tests still run when it fails", () => {
    const typeCheck = onlyStepRunning(TYPE_CHECK);
    const unitTests = onlyStepRunning(UNIT_TESTS);

    expect(unitTests.jobName).toBe(typeCheck.jobName);
    expect(unitTests.index).toBeGreaterThan(typeCheck.index);
    expect(unitTests.step.if).toBe(NOT_CANCELLED);
  });
});

describe("npm run generate-terraform-provider", () => {
  const rootPackage = JSON.parse(read("package.json"));

  test("runs the generator transpile-only, so this workflow's step is its type check", () => {
    expect(rootPackage.scripts["generate-terraform-provider"]).toBe(
      GENERATE_SCRIPT,
    );
  });
});

describe("every job that generates the Terraform provider", () => {
  const jobs = jobsThatGenerateTheProvider();
  const names = jobs.map(({ name }) => {
    return name;
  });

  function typeChecksTheGenerator(job) {
    return (job.steps || []).some((step) => {
      return stepCommandFromRoot(step).trim() === TYPE_CHECK;
    });
  }

  test("is found, this workflow's among them", () => {
    expect(names).toEqual(
      expect.arrayContaining([
        "terraform-provider-generation.yml generate-terraform-provider",
        ...Object.keys(CHECKED_BEFORE_THEY_RUN),
      ]),
    );
  });

  test.each(names)(
    "%s type-checks the generator, or runs code the type check checked first",
    (name) => {
      const { job } = jobs.find((entry) => {
        return entry.name === name;
      });

      expect({
        job: name,
        checked:
          typeChecksTheGenerator(job) ||
          CHECKED_BEFORE_THEY_RUN[name] !== undefined,
      }).toEqual({ job: name, checked: true });
    },
  );

  test("each job named as checked first still generates it, and has no type check of its own", () => {
    for (const name of Object.keys(CHECKED_BEFORE_THEY_RUN)) {
      const entry = jobs.find((found) => {
        return found.name === name;
      });

      expect({ job: name, generates: entry !== undefined }).toEqual({
        job: name,
        generates: true,
      });
      expect({
        job: name,
        typeChecks: typeChecksTheGenerator(entry.job),
      }).toEqual({ job: name, typeChecks: false });
    }
  });
});
