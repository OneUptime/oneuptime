"use strict";

/**
 * Every step that runs one of this repository's composite actions passes it
 * only the inputs it declares, and every input it requires (#11403).
 *
 * GitHub Actions gives a step's `with:` keys to the action by name, and one
 * the action does not declare under `inputs:` earns only a warning in the
 * run's log ("Unexpected input(s)"): a misspelt `working-directroy:` is
 * dropped without failing anything, and the action runs on its default, in
 * the wrong directory. Nor is `required: true` enforced for a composite
 * action: an input left out reads as empty. So a typo in a workflow's call
 * to .github/actions/<name> passes every check and does something else.
 *
 * This reads every step under .github/workflows and .github/actions that
 * uses ./.github/actions/<name>, and holds its `with:` keys to that action's
 * action.yml.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const ACTIONS_DIR = path.join(REPO_ROOT, ".github", "actions");
const LOCAL_ACTION = /^\.\/\.github\/actions\/([A-Za-z0-9_.-]+)\/?$/;

function yamlFilesIn(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => {
      return /\.ya?ml$/.test(name);
    })
    .map((name) => {
      return path.join(dir, name);
    });
}

function actionFiles() {
  return fs.readdirSync(ACTIONS_DIR).flatMap((name) => {
    return ["action.yml", "action.yaml"]
      .map((file) => {
        return path.join(ACTIONS_DIR, name, file);
      })
      .filter((file) => {
        return fs.existsSync(file);
      });
  });
}

// Each local action's inputs: name -> { required, hasDefault }.
function localActionInputs() {
  const actions = new Map();
  for (const file of actionFiles()) {
    const action = yaml.load(fs.readFileSync(file, "utf8")) || {};
    const inputs = new Map();
    for (const [name, spec] of Object.entries(action.inputs || {})) {
      inputs.set(name, {
        required: Boolean(spec && spec.required === true),
        hasDefault: Boolean(spec && "default" in spec),
      });
    }
    actions.set(path.basename(path.dirname(file)), inputs);
  }
  return actions;
}

// Every step of a workflow's jobs, or of a composite action's runs.
function stepsOf(document) {
  const steps = [];
  for (const job of Object.values((document && document.jobs) || {})) {
    for (const step of (job && job.steps) || []) {
      steps.push(step);
    }
  }
  if (document && document.runs && Array.isArray(document.runs.steps)) {
    steps.push(...document.runs.steps);
  }
  return steps;
}

/*
 * The problems of the steps given, each naming the file and the step, and
 * how many of them run a local action.
 */
function problemsOf(label, steps, actions) {
  const problems = [];
  let calls = 0;
  for (const step of steps) {
    const match = LOCAL_ACTION.exec((step && step.uses) || "");
    if (!match) {
      continue;
    }
    calls++;
    const name = match[1];
    const where = `${label} (${step.name || step.id || step.uses})`;
    const inputs = actions.get(name);
    if (!inputs) {
      problems.push(
        `${where}: uses ./.github/actions/${name}, which has no action.yml`,
      );
      continue;
    }
    const passed = Object.keys(step.with || {});
    for (const key of passed) {
      if (!inputs.has(key)) {
        problems.push(
          `${where}: passes ${key}, which ${name} does not declare (it declares ${[...inputs.keys()].join(", ") || "none"}); GitHub drops it with a warning`,
        );
      }
    }
    for (const [key, spec] of inputs) {
      if (spec.required && !spec.hasDefault && !passed.includes(key)) {
        problems.push(
          `${where}: leaves out ${key}, which ${name} requires and gives no default; GitHub runs it empty`,
        );
      }
    }
  }
  return { problems, calls };
}

describe("the steps that run this repository's composite actions", () => {
  const actions = localActionInputs();
  const files = [...yamlFilesIn(WORKFLOWS_DIR), ...actionFiles()];

  test("pass each action only the inputs it declares, and every input it requires", () => {
    let calls = 0;
    const problems = [];
    for (const file of files) {
      const found = problemsOf(
        path.relative(REPO_ROOT, file),
        stepsOf(yaml.load(fs.readFileSync(file, "utf8"))),
        actions,
      );
      calls += found.calls;
      problems.push(...found.problems);
    }

    expect(problems).toEqual([]);
    // 238 steps when this was written: a walk that found far fewer has
    // stopped reading most of them.
    expect(calls).toBeGreaterThan(150);
    expect(actions.size).toBeGreaterThan(5);
  });

  const planted = new Map([
    [
      "npm-install",
      new Map([
        ["working-directory", { required: false, hasDefault: true }],
        ["command", { required: false, hasDefault: true }],
      ]),
    ],
    ["image-sbom", new Map([["image", { required: true, hasDefault: false }]])],
  ]);

  test("would report a misspelt input, which GitHub only warns about", () => {
    const found = problemsOf(
      "planted.yml",
      [
        {
          name: "Install",
          uses: "./.github/actions/npm-install",
          with: { "working-directroy": "Tests/Ops" },
        },
      ],
      planted,
    );

    expect(found.calls).toBe(1);
    expect(found.problems).toEqual([
      "planted.yml (Install): passes working-directroy, which npm-install does not declare (it declares working-directory, command); GitHub drops it with a warning",
    ]);
  });

  test("would report a required input left out, which GitHub runs empty", () => {
    expect(
      problemsOf(
        "planted.yml",
        [{ name: "SBOM", uses: "./.github/actions/image-sbom" }],
        planted,
      ).problems,
    ).toEqual([
      "planted.yml (SBOM): leaves out image, which image-sbom requires and gives no default; GitHub runs it empty",
    ]);
  });

  test("would report a step that uses a local action that is not there", () => {
    expect(
      problemsOf(
        "planted.yml",
        [{ name: "Setup", uses: "./.github/actions/setup-nothing" }],
        planted,
      ).problems,
    ).toEqual([
      "planted.yml (Setup): uses ./.github/actions/setup-nothing, which has no action.yml",
    ]);
  });

  test("passes a call that names only declared inputs, and reads no other step", () => {
    expect(
      problemsOf(
        "planted.yml",
        [
          {
            name: "Install",
            uses: "./.github/actions/npm-install",
            with: { "working-directory": "Tests/Ops", command: "ci" },
          },
          {
            name: "Checkout",
            uses: "actions/checkout@v4",
            with: { anything: 1 },
          },
          { name: "Run", run: "echo hi" },
        ],
        planted,
      ),
    ).toEqual({ problems: [], calls: 1 });
  });
});
