/*
 * ---------------------------------------------------------------------------
 * A RUN'S INPUTS REACH A STEP AS DATA, NEVER AS CODE.
 *
 * A runbook's webhook takes a JSON body from whoever holds its URL, and the
 * run hands its values to the steps. The Runner gives a Bash step each one
 * as an environment variable (ONEUPTIME_INPUT_<NAME>, plus ONEUPTIME_INPUTS
 * and ONEUPTIME_TRIGGER) and a JavaScript step the object as `args` - and
 * runs the script exactly as its author wrote it.
 *
 * These run a REAL bash and the REAL JavaScript sandbox, with values built
 * to break out - command substitution, quotes, a newline, a variable a shell
 * reads - and check each comes back as the text it was, nothing ran, and
 * nothing the Runner or the shell reads was replaced. Only the server calls
 * are mocked, to read the result the Runner reports.
 * ---------------------------------------------------------------------------
 */

jest.mock("../../Services/RunnerClient", () => {
  return {
    __esModule: true,
    default: {
      submitJobResult: jest.fn().mockResolvedValue(true),
      jobHeartbeat: jest.fn().mockResolvedValue(true),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import fs from "fs";
import os from "os";
import path from "path";
import Executor, { getBashEnvironment } from "../../Services/RunbookExecutor";
import AgentClient, { ClaimedJob } from "../../Services/RunnerClient";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const submitJobResult: jest.Mock =
  AgentClient.submitJobResult as unknown as jest.Mock;

let scratch: string;
let canary: string;

beforeEach(() => {
  submitJobResult.mockClear();
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "runbook-inputs-"));
  canary = path.join(scratch, "pwned");
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function job(data: {
  stepType: "Bash" | "JavaScript";
  script: string;
  inputs?: JSONObject | undefined;
  trigger?: string | null | undefined;
}): ClaimedJob {
  return {
    jobId: "job-1",
    runbookExecutionId: "execution-1",
    origin: "Runbook",
    stepId: "step-1",
    stepType: data.stepType,
    script: data.script,
    timeoutInMs: 20_000,
    ...(data.inputs !== undefined ? { inputs: data.inputs } : {}),
    ...(data.trigger !== undefined ? { trigger: data.trigger } : {}),
  } as unknown as ClaimedJob;
}

async function run(claimed: ClaimedJob): Promise<{
  success: boolean;
  output: string;
  errorMessage?: string;
}> {
  await Executor.executeAndReport(claimed);

  expect(submitJobResult).toHaveBeenCalledTimes(1);

  return submitJobResult.mock.calls[0]![0] as {
    success: boolean;
    output: string;
    errorMessage?: string;
  };
}

function stdoutOf(output: string): string {
  return output.startsWith("[stdout]\n")
    ? output.slice("[stdout]\n".length)
    : output;
}

describe("a Bash step", () => {
  test("reads each input as a variable, and a value built to run a command stays text", async () => {
    const hostile: string = `$(touch ${canary}); \`touch ${canary}\`; "; touch ${canary}; echo '`;

    const result: { success: boolean; output: string } = await run(
      job({
        stepType: "Bash",
        script: 'printf "%s" "$ONEUPTIME_INPUT_HOST"',
        inputs: { host: hostile },
        trigger: "Webhook",
      }),
    );

    expect(result.success).toBe(true);
    expect(stdoutOf(result.output)).toBe(hostile);
    expect(fs.existsSync(canary)).toBe(false);
  });

  test("gets the whole object as JSON and what started the run", async () => {
    const inputs: JSONObject = {
      host: "web-1",
      replicas: 3,
      labels: { team: "payments" },
    };

    const result: { success: boolean; output: string } = await run(
      job({
        stepType: "Bash",
        script:
          'printf "%s|%s|%s|%s" "$ONEUPTIME_INPUTS" "$ONEUPTIME_TRIGGER" "$ONEUPTIME_INPUT_REPLICAS" "$ONEUPTIME_INPUT_LABELS"',
        inputs,
        trigger: "Webhook",
      }),
    );

    expect(stdoutOf(result.output)).toBe(
      `${JSON.stringify(inputs)}|Webhook|3|{"team":"payments"}`,
    );
  });

  test("a value with a newline is one variable, its lines intact", async () => {
    const result: { success: boolean; output: string } = await run(
      job({
        stepType: "Bash",
        script: 'printf "%s" "$ONEUPTIME_INPUT_NOTE"',
        inputs: { note: "first line\nsecond line\n$(id)" },
      }),
    );

    expect(stdoutOf(result.output)).toBe("first line\nsecond line\n$(id)");
  });

  test("a caller cannot replace a variable the shell or the Runner reads", async () => {
    const result: { success: boolean; output: string } = await run(
      job({
        stepType: "Bash",
        script:
          'printf "%s|%s|%s" "$PATH" "$ONEUPTIME_INPUT_PATH" "${BASH_ENV:-unset}"',
        inputs: {
          PATH: "/tmp/evil",
          BASH_ENV: `${canary}.sh`,
          LD_PRELOAD: "/tmp/evil.so",
        },
      }),
    );

    expect(stdoutOf(result.output)).toBe(
      `${process.env["PATH"]}|/tmp/evil|unset`,
    );
    expect(fs.existsSync(canary)).toBe(false);
  });

  test("every variable a run adds starts with ONEUPTIME_", async () => {
    const result: { success: boolean; output: string } = await run(
      job({
        stepType: "Bash",
        script: "env | cut -d= -f1 | sort",
        inputs: { "a b": 1, "x-y": 2, "../etc": 3 },
        trigger: "Schedule",
      }),
    );

    const names: Array<string> = stdoutOf(result.output)
      .split("\n")
      .filter((name: string) => {
        return name.length > 0;
      });
    const added: Array<string> = names.filter((name: string) => {
      return process.env[name] === undefined;
    });

    for (const name of added) {
      expect(name.startsWith("ONEUPTIME_")).toBe(true);
    }

    expect(added).toEqual(
      expect.arrayContaining([
        "ONEUPTIME_INPUT_A_B",
        "ONEUPTIME_INPUT_X_Y",
        "ONEUPTIME_INPUT____ETC",
        "ONEUPTIME_INPUTS",
        "ONEUPTIME_TRIGGER",
      ]),
    );
  });

  test("a job from a server that sends no inputs runs with the Runner's environment, as before", async () => {
    expect(getBashEnvironment({})).toBeUndefined();

    const result: { success: boolean; output: string } = await run(
      job({
        stepType: "Bash",
        script: 'printf "%s" "${ONEUPTIME_INPUTS:-none}"',
      }),
    );

    expect(stdoutOf(result.output)).toBe("none");
  });
});

describe("a JavaScript step", () => {
  test("reads the inputs as args, and a value built to run code stays text", async () => {
    const hostile: string =
      "'); require('child_process').execSync('touch " + canary + "'); ('";

    const result: { success: boolean; output: string } = await run(
      job({
        stepType: "JavaScript",
        script: "return args.inputs.host + ' | ' + args.trigger;",
        inputs: { host: hostile },
        trigger: "Webhook",
      }),
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe(`Return: ${hostile} | Webhook`);
    expect(fs.existsSync(canary)).toBe(false);
  });

  test("gets nested values as they were sent", async () => {
    const result: { success: boolean; output: string } = await run(
      job({
        stepType: "JavaScript",
        script: "return args.inputs.labels.team + ':' + args.inputs.replicas;",
        inputs: { labels: { team: "payments" }, replicas: 3 },
        trigger: "Webhook",
      }),
    );

    expect(result.output).toBe("Return: payments:3");
  });

  test("gets an empty object from a run with no inputs", async () => {
    const result: { success: boolean; output: string } = await run(
      job({
        stepType: "JavaScript",
        script: "return JSON.stringify(args);",
        inputs: {},
        trigger: "Schedule",
      }),
    );

    expect(result.output).toBe('Return: {"inputs":{},"trigger":"Schedule"}');
  });
});
