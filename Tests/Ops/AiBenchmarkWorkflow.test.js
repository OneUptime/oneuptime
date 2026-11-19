"use strict";

/**
 * The AI Benchmark workflow (#7764) runs `npm run ai-benchmark` - OneUptime
 * AI's real investigation loop, with a real model - where a change to what
 * an investigation reads or says can make it worse, and spends model
 * credits only there.
 *
 * Nothing at runtime says it went wrong: a path filter that stopped
 * matching the persona's file runs nothing and stays green, a key pasted
 * into a script shows in the job's log, and a step left ungated on a fork's
 * pull request fails it for a secret it was never handed. So this suite
 * pins:
 *
 *   - when it runs: on pull requests that touch the investigation's persona
 *     and prompt, its loop, the toolbox's shape, the LLM client, the
 *     benchmark or this workflow - every one a path that exists - nightly,
 *     and by hand; never on a push, and never for each tool's own file;
 *   - where the key comes from: the repository secret, in the environment of
 *     the two steps that need it, never in a script or on a command line;
 *   - a missing key: the job says why in its summary - the secret not set,
 *     or a fork's pull request - and every later step is skipped;
 *   - what it reports: the pass table in the job's summary, every answer as
 *     an artifact, and a failure under its threshold;
 *   - its model and threshold: a model the benchmark can run, and a share
 *     of the scenarios the benchmark accepts.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW_FILE = ".github/workflows/ai-benchmark.yml";
const CANCELLER_FILE = ".github/workflows/cancel-closed-pr-runs.yml";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const workflow = yaml.load(read(WORKFLOW_FILE));
const job = workflow.jobs.benchmark;
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
const RUN = stepNamed("Run the benchmark");
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
    // The persona, the system prompt and the question.
    "packages/Common/Server/Utils/AI/SRE/AIInvestigationEngine.ts",
    "packages/Common/Server/Utils/AI/SRE/InvestigationReportLanguagePrompt.ts",
    // The loop.
    "packages/Common/Server/Utils/AI/Chat/ObservabilityAssistant.ts",
    "packages/Common/Server/Utils/AI/Chat/AgentContextCompactor.ts",
    // Which tools are offered, and how their results read.
    "packages/Common/Server/Utils/AI/Toolbox/Index.ts",
    "packages/Common/Server/Utils/AI/Toolbox/Serializer.ts",
    // How an answer is read.
    "packages/Common/Utils/AI/InvestigationReport.ts",
    // The model client.
    "packages/Common/Server/Utils/LLM/LLMService.ts",
    // The benchmark.
    "packages/Common/Server/Utils/AI/Eval/Benchmark/BenchmarkScorer.ts",
    "packages/Common/Server/Utils/AI/Eval/Benchmark/Scenarios/CheckoutDeployBreaksDiscounts.ts",
    "packages/Common/Server/Utils/AI/Eval/PinnedModel.ts",
    "Scripts/AI/RunInvestigationBenchmark.ts",
    WORKFLOW_FILE,
  ])("a pull request that changes %s runs it", (file) => {
    expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
    expect(filtered(file)).toBe(true);
  });

  /*
   * Some thirty pull requests a week change one tool's file, mostly a tool
   * an investigation never calls; the nightly run catches the ones that
   * matter. Running on each would spend model credits on nearly every
   * Ask AI change.
   */
  test.each([
    "packages/Common/Server/Utils/AI/Toolbox/StatusPageTools.ts",
    "packages/Common/Server/Utils/AI/Toolbox/LogTools.ts",
    "packages/Common/Server/Utils/AI/SRE/IncidentInvestigationRunner.ts",
    "packages/App/FeatureSet/Dashboard/src/Pages/AI/AiResults.tsx",
    "README.md",
  ])("a pull request that changes only %s does not", (file) => {
    expect(filtered(file)).toBe(false);
  });

  test("by hand, it asks how many runs a scenario gets and which scenarios run, both optional", () => {
    const inputs = triggers(workflow).workflow_dispatch.inputs;

    expect(Object.keys(inputs).sort()).toEqual(["repeat", "scenarios"]);
    expect(inputs.repeat).toEqual(
      expect.objectContaining({ required: false, default: "1" }),
    );
    expect(inputs.scenarios).toEqual(
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

  test("the key is never put on the command line, which the benchmark refuses", () => {
    expect(RUN.run).toMatch(/npm run ai-benchmark --/);
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
  test("the pinned model, the runs and scenarios asked for, its threshold, and the report into the job's summary", () => {
    expect(RUN.env.REPEAT).toBe("${{ inputs.repeat || '1' }}");
    expect(RUN.env.SCENARIOS).toBe("${{ inputs.scenarios || '' }}");

    for (const argument of [
      '--llm-type="$AI_BENCHMARK_LLM_TYPE"',
      '--model="$AI_BENCHMARK_MODEL"',
      '--repeat="$REPEAT"',
      '--scenario="$SCENARIOS"',
      '--fail-under="$AI_BENCHMARK_FAIL_UNDER"',
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
        name: "ai-benchmark-results",
        path: "ai-benchmark-results.json",
        "retention-days": 30,
      }),
    );
  });

  test("the benchmark writes the file the artifact keeps", () => {
    expect(read("Scripts/AI/RunInvestigationBenchmark.ts")).toContain(
      'const OUTPUT_PATH: string = "./ai-benchmark-results.json";',
    );
  });

  test("its token reads the repository, nothing more", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.permissions).toBeUndefined();
  });
});

describe("its model and threshold", () => {
  test("the model's type is one the benchmark accepts, and the model a Claude model id", () => {
    const llmTypes = Array.from(
      read("packages/Common/Types/LLM/LlmType.ts").matchAll(
        /^\s*\w+\s*=\s*"([^"]+)",?$/gm,
      ),
      (match) => {
        return match[1];
      },
    );

    expect(llmTypes).toContain(job.env.AI_BENCHMARK_LLM_TYPE);
    expect(job.env.AI_BENCHMARK_MODEL).toMatch(/^claude-[a-z]+-[0-9-]+$/);
  });

  test("the threshold is a share of the scenarios, from 0% to 100%, so a new scenario needs no new threshold", () => {
    const match = /^(\d+(?:\.\d+)?)%$/.exec(job.env.AI_BENCHMARK_FAIL_UNDER);

    expect(match).not.toBeNull();
    expect(Number(match[1])).toBeGreaterThan(0);
    expect(Number(match[1])).toBeLessThanOrEqual(100);
  });

  test("the job has room for every scenario, one after another", () => {
    expect(job["timeout-minutes"]).toBeGreaterThanOrEqual(60);
  });
});

describe("the guide", () => {
  test("Docs/ai/evals.md says when the workflow runs and which secret it needs", () => {
    const guide = read("Docs/ai/evals.md");

    expect(guide).toContain(WORKFLOW_FILE);
    expect(guide).toContain("AI_EVAL_LLM_API_KEY");
    expect(guide).toContain(job.env.AI_BENCHMARK_MODEL);
  });
});
