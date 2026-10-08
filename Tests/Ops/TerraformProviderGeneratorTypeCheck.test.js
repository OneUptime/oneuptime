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
 *   - on every pull request and every push to master;
 *   - after installing, in the same job, Common (the Common files it checks
 *     resolve their packages from packages/Common/node_modules), Scripts
 *     (GenerateSpec.ts's @readme/openapi-parser) and the generator itself
 *     (TypeScript and the generator's @types);
 *   - before the provider is generated, so a failed generation cannot skip
 *     it, and with nothing that lets it fail without failing the job;
 *   - with the generator's unit tests still running when it fails, so one
 *     run reports both.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const {
  isNpmInstallStep,
  stepCommandFromRoot,
  stepWorkingDirectory,
} = require("./Utils/WorkflowStep");

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
    expect(triggers({ [true]: { push: { branches: ["master"] } } })).toEqual({
      push: { branches: ["master"] },
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

  test("on every pull request and every push to master", () => {
    const events = triggers(workflow);

    // pull_request with no filter: every pull request, whatever it touches.
    expect(Object.keys(events)).toContain("pull_request");
    expect(events.pull_request).toBeNull();
    expect((events.push || {}).branches).toContain("master");
    expect(events.push).not.toHaveProperty("paths");
    expect(events.push).not.toHaveProperty("paths-ignore");
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
