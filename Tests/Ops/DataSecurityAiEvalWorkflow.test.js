"use strict";

/**
 * The Data Security AI Eval workflow (#10365) runs `npm run
 * ai-data-security-eval` - every OneUptime AI feature of Data Security on
 * fixed cases, with a real, pinned model - nightly, by hand, before a
 * release, and on a pull request that changes a feature's prompt, for that
 * feature's cases only.
 *
 * Nothing at runtime says it went wrong: a path filter that stopped
 * matching a prompt's file runs nothing and stays green, a key pasted into
 * a script shows in the job's log, a step left ungated on a fork's pull
 * request fails it for a secret it was never handed, and a pull request
 * that ran every feature would spend credits on the ones it did not touch.
 * So this suite pins:
 *
 *   - when it runs: on pull requests that touch a Data Security AI prompt,
 *     the builder, the eval or this workflow - every one a path that
 *     exists - nightly and by hand; never on a push;
 *   - what a pull request runs: only the features its changed files change
 *     (--changed-files), listed from the pull request's own diff;
 *   - where the key comes from: the repository secret, in the environment
 *     of the two steps that need it, never in a script or on a command line;
 *   - a missing key: the job says why in its summary and every later step
 *     is skipped;
 *   - what it reports: the score of each feature in the job's summary,
 *     every answer as an artifact, and a failure under a threshold.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW_FILE = ".github/workflows/data-security-ai-eval.yml";
const CANCELLER_FILE = ".github/workflows/cancel-closed-pr-runs.yml";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const workflow = yaml.load(read(WORKFLOW_FILE));
const job = workflow.jobs.eval;
const steps = job.steps;

/**
 * A workflow's triggers as a map (js-yaml reads `on` as a string key).
 * @param {object} parsed - The parsed workflow
 * @returns {object} event name -> filters
 */
function triggers(parsed) {
  return parsed.on === undefined ? parsed[true] : parsed.on;
}

/**
 * Whether a path filter matches a file, as GitHub's filter does for the
 * patterns this workflow uses: a literal path, or a directory with `/**`.
 * @param {string} pattern - The filter's pattern
 * @param {string} file - A path from the repository's root
 * @returns {boolean} Whether the pattern matches it
 */
function matches(pattern, file) {
  if (pattern.endsWith("/**")) {
    return file.startsWith(pattern.slice(0, -2));
  }

  if (pattern.includes("*")) {
    throw new Error(`a pattern this suite cannot read: ${pattern}`);
  }

  return pattern === file;
}

const PATHS = triggers(workflow).pull_request.paths;

function filtered(file) {
  return PATHS.some((pattern) => {
    return matches(pattern, file);
  });
}

function stepNamed(name) {
  const step = steps.find((candidate) => {
    return candidate.name === name;
  });

  if (!step) {
    throw new Error(`no step named "${name}"`);
  }

  return step;
}

const KEY_CHECK = stepNamed("Check for the model's key");
const CHANGES = stepNamed("List what the pull request changes");
const RUN = stepNamed("Run the eval");
const UPLOAD = stepNamed("Keep every answer and score");
const PRESENT = "steps.key.outputs.present == 'true'";

describe("when it runs", () => {
  test("on pull requests that touch the paths below, nightly and by hand, never on a push", () => {
    expect(Object.keys(triggers(workflow)).sort()).toEqual([
      "pull_request",
      "schedule",
      "workflow_dispatch",
    ]);
    expect(triggers(workflow).schedule).toHaveLength(1);
    expect(PATHS.length).toBeGreaterThan(5);
  });

  test("every path it filters on is in the repository", () => {
    const missing = PATHS.filter((pattern) => {
      const target = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
      return !fs.existsSync(path.join(REPO_ROOT, target));
    });

    expect(missing).toEqual([]);
  });

  test.each([
    "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityAiInput.ts",
    "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityIssuePrompt.ts",
    "packages/Common/Server/Utils/AI/DataSecurity/FieldSuggestionPrompt.ts",
    "packages/Common/Server/Utils/AI/Toolbox/DataSecurityTools.ts",
    "packages/Common/Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCases.ts",
    "packages/Common/Server/Utils/LLM/LLMService.ts",
    "Scripts/AI/RunDataSecurityEval.ts",
    WORKFLOW_FILE,
  ])("a pull request that changes %s runs it", (file) => {
    expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
    expect(filtered(file)).toBe(true);
  });

  test.each([
    "packages/Common/Server/Utils/AI/Toolbox/LogTools.ts",
    "packages/Common/Server/Utils/AI/SRE/AIInvestigationEngine.ts",
    "packages/App/FeatureSet/Dashboard/src/Pages/DataSecurity/Overview.tsx",
    "README.md",
  ])("a pull request that changes only %s does not", (file) => {
    expect(filtered(file)).toBe(false);
  });

  test("by hand, it asks which features and cases run and how many runs a case gets, all optional", () => {
    const inputs = triggers(workflow).workflow_dispatch.inputs;

    expect(Object.keys(inputs).sort()).toEqual(["cases", "features", "repeat"]);
    expect(inputs.repeat).toEqual(
      expect.objectContaining({ required: false, default: "1" }),
    );
    expect(inputs.features).toEqual(
      expect.objectContaining({ required: false, default: "" }),
    );
    expect(inputs.cases).toEqual(
      expect.objectContaining({ required: false, default: "" }),
    );
  });

  test("a newer push supersedes a run, and a closed pull request's run is cancelled", () => {
    expect(workflow.concurrency).toEqual({
      group:
        "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
      "cancel-in-progress": true,
    });
    expect(
      yaml.load(read(CANCELLER_FILE)).jobs.cancel.strategy.matrix.workflow,
    ).toContain(workflow.name);
  });
});

describe("what a pull request runs", () => {
  test("lists the files the pull request changes, from its own base and head", () => {
    expect(CHANGES.if).toBe(
      `${PRESENT} && github.event_name == 'pull_request'`,
    );
    expect(CHANGES.env).toEqual({
      BASE_SHA: "${{ github.event.pull_request.base.sha }}",
      HEAD_SHA: "${{ github.event.pull_request.head.sha }}",
    });
    expect(CHANGES.run).toContain(
      'git diff --name-only "$BASE_SHA" "$HEAD_SHA" > changed-files.txt',
    );
  });

  test("and runs only the features they change; nightly and by hand, every one asked for", () => {
    expect(RUN.run).toContain('if [ "$EVENT_NAME" = "pull_request" ]; then');
    expect(RUN.run).toContain('changed="--changed-files=changed-files.txt"');
    expect(RUN.run).toContain("$changed");
    expect(RUN.env.EVENT_NAME).toBe("${{ github.event_name }}");
  });
});

describe("where the model's key comes from", () => {
  test("the repository secret AI_EVAL_LLM_API_KEY, in the environment of the two steps that need it", () => {
    const withKey = steps.filter((step) => {
      return JSON.stringify(step).includes("secrets.");
    });

    expect(withKey).toEqual([KEY_CHECK, RUN]);

    for (const step of withKey) {
      expect(step.env.AI_EVAL_LLM_API_KEY).toBe(
        "${{ secrets.AI_EVAL_LLM_API_KEY }}",
      );
    }

    expect(JSON.stringify(job.env || {})).not.toContain("secrets.");
    expect(JSON.stringify(workflow.env || {})).not.toContain("secrets.");
  });

  test("no script names an expression: inputs and secrets reach them through the environment", () => {
    for (const step of steps) {
      if (step.run) {
        expect({ step: step.name, run: step.run }).toEqual({
          step: step.name,
          run: expect.not.stringContaining("${{"),
        });
      }
    }
  });

  test("the key is never put on the command line, which the eval refuses", () => {
    expect(RUN.run).toMatch(/npm run ai-data-security-eval --/);
    expect(RUN.run).not.toMatch(/--(?:judge-)?(?:api-?key|key)\b/i);
    expect(RUN.run).not.toContain("AI_EVAL_LLM_API_KEY");
  });
});

describe("a missing key", () => {
  test("is said in the job's summary, with why: the secret not set, or a fork's pull request", () => {
    expect(KEY_CHECK.id).toBe("key");
    expect(KEY_CHECK.if).toBeUndefined();
    expect(KEY_CHECK.env.IS_FORK).toBe(
      "${{ github.event.pull_request.head.repo.fork }}",
    );
    expect(KEY_CHECK.run).toContain('echo "present=false" >> "$GITHUB_OUTPUT"');
    expect(KEY_CHECK.run).toContain('echo "present=true" >> "$GITHUB_OUTPUT"');
    expect(KEY_CHECK.run).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(KEY_CHECK.run).toContain(
      "the repository secret AI_EVAL_LLM_API_KEY is not set",
    );
    expect(KEY_CHECK.run).toContain("comes from a fork");
    expect(KEY_CHECK.run).toContain("Nothing was run and no model was called");
  });

  test("skips every step after it, so nothing is installed, run or spent", () => {
    const afterTheCheck = steps.slice(steps.indexOf(KEY_CHECK) + 1);

    expect(afterTheCheck.length).toBeGreaterThan(3);

    for (const step of afterTheCheck) {
      expect({ step: step.name, if: step.if }).toEqual({
        step: step.name,
        if: expect.stringContaining(PRESENT),
      });
    }
  });

  test("leaves the job green: nothing in the check fails it", () => {
    expect(KEY_CHECK.run).not.toMatch(/exit [1-9]/);
    expect(KEY_CHECK["continue-on-error"]).toBeUndefined();
  });
});

describe("what it runs and reports", () => {
  test("the pinned model, the features, cases and runs asked for, the thresholds, and the report into the job's summary", () => {
    expect(RUN.env.REPEAT).toBe("${{ inputs.repeat || '1' }}");
    expect(RUN.env.FEATURES).toBe("${{ inputs.features || '' }}");
    expect(RUN.env.CASES).toBe("${{ inputs.cases || '' }}");

    for (const argument of [
      '--llm-type="$DATA_SECURITY_EVAL_LLM_TYPE"',
      '--model="$DATA_SECURITY_EVAL_MODEL"',
      '--feature="$FEATURES"',
      '--case="$CASES"',
      '--repeat="$REPEAT"',
      "--enforce-thresholds",
      '--report-markdown="$GITHUB_STEP_SUMMARY"',
    ]) {
      expect(RUN.run).toContain(argument);
    }
  });

  test("every answer and score is kept as an artifact, even when the run failed", () => {
    expect(UPLOAD.uses).toBe("actions/upload-artifact@v4");
    expect(UPLOAD.if).toBe(`always() && ${PRESENT}`);
    expect(UPLOAD.with).toEqual(
      expect.objectContaining({
        name: "data-security-ai-eval-results",
        path: "ai-data-security-eval-results.json",
        "retention-days": 30,
      }),
    );
  });

  test("the eval writes the file the artifact keeps, and the command is the root's", () => {
    expect(read("Scripts/AI/RunDataSecurityEval.ts")).toContain(
      'const OUTPUT_PATH: string = "./ai-data-security-eval-results.json";',
    );
    expect(JSON.parse(read("package.json")).scripts["ai-data-security-eval"]).toContain(
      "./Scripts/AI/RunDataSecurityEval.ts",
    );
    expect(read(".gitignore")).toContain("ai-data-security-eval-results.json");
  });

  test("its token reads the repository, nothing more", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.permissions).toBeUndefined();
  });

  test("the model's type is one the eval accepts, and the model a Claude model id", () => {
    const llmTypes = Array.from(
      read("packages/Common/Types/LLM/LlmType.ts").matchAll(
        /^\s*\w+\s*=\s*"([^"]+)",?$/gm,
      ),
      (match) => {
        return match[1];
      },
    );

    expect(llmTypes).toContain(job.env.DATA_SECURITY_EVAL_LLM_TYPE);
    expect(job.env.DATA_SECURITY_EVAL_MODEL).toMatch(/^claude-[a-z]+-[0-9-]+$/);
  });
});

describe("the guides", () => {
  test("Docs/ai/evals.md says when the workflow runs, which secret it needs and its model", () => {
    const guide = read("Docs/ai/evals.md");

    expect(guide).toContain(WORKFLOW_FILE);
    expect(guide).toContain("npm run ai-data-security-eval");
    expect(guide).toContain(job.env.DATA_SECURITY_EVAL_MODEL);
  });

  test("the release checklist runs it on the release branch", () => {
    expect(read("RELEASING.md")).toContain(
      "gh workflow run data-security-ai-eval.yml --ref",
    );
  });
});
