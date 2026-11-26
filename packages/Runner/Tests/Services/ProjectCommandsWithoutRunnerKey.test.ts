/*
 * ---------------------------------------------------------------------------
 * WHAT A RUNNER RUNS FOR A PROJECT SEES NONE OF THE RUNNER'S OWN SETTINGS.
 *
 * The report: a project's commands - a runbook's Bash step, a code
 * repository's setup, build and test commands - ran with the Runner's whole
 * environment, so `env` printed ONEUPTIME_RUNNER_KEY, the key that claims
 * every job the Runner is sent with its secrets. Each of these runs a REAL
 * bash or a REAL git, with the Runner's environment holding its key, its id,
 * its other settings, the Kubernetes agent Runner's ingestion key and a
 * server secret, beside what an operator puts there for commands (a registry
 * token, a proxy), and checks that:
 *
 *   - a Bash step, with a run's inputs or without, a kubectl step, with a
 *     kubeconfig or the Runner's own access, and a repository's commands
 *     see none of the Runner's own, and everything else as before - the
 *     operator's settings, the inputs, KUBECONFIG, CI=true;
 *   - the pipeline's own git does not hand them to what a command before it
 *     set up in the tree: an fsmonitor git runs on a status, a hook;
 *   - the pipeline's commit runs no hook of the repository's at all:
 *     --no-verify still ran prepare-commit-msg and post-commit.
 *
 * Only the server calls are mocked.
 *
 * Jest gives each test file its own copy of process.env, and a child
 * started without an environment of its own gets the real one, which holds
 * none of what a test sets. So each case checks both halves: the operator's
 * settings are there - the command's environment is built from this
 * process's - and the Runner's own are not - they were taken out of it.
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

import Executor from "../../Services/RunbookExecutor";
import KubectlScriptExecutor from "../../Services/KubectlScriptExecutor";
import AgentClient, { ClaimedJob } from "../../Services/RunnerClient";
import BuildVerification, {
  CommandRunResult,
} from "../../Utils/BuildVerification";
import RepositoryManager from "../../Utils/RepositoryManager";
import { BashRunResult } from "../../Utils/RunBash";
import { JSONObject } from "Common/Types/JSON";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

jest.setTimeout(120000);

const submitJobResult: jest.Mock =
  AgentClient.submitJobResult as unknown as jest.Mock;

const RUNNER_KEY: string = "8c1f2a4e-6b7d-4e9f-a0b1-c2d3e4f5a6b7";

// The Runner's own settings, as an operator starts a Runner with them.
const RUNNER_OWN: Record<string, string> = {
  ONEUPTIME_RUNNER_KEY: RUNNER_KEY,
  ONEUPTIME_RUNNER_NAME: "prod-eu-west-1",
  ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: "true",
  ONEUPTIME_INGESTION_KEY: "telemetry-ingestion-key-0123456789",
  ONEUPTIME_SECRET: "the-servers-cluster-secret-0123456789",
};

// What an operator puts in a Runner's environment for its commands.
const OPERATOR_SETTINGS: Record<string, string> = {
  ACME_REGISTRY_TOKEN: "registry-token-the-build-needs",
  ACME_PROXY_FOR_TESTS: "http://proxy.internal:3128",
};

// Every name a command must not see, ONEUPTIME_RUNNER_ID among them.
const NEVER_SEEN: Array<string> = [
  "ONEUPTIME_RUNNER_ID",
  ...Object.keys(RUNNER_OWN),
];

// The Runner's own credentials, which no output may hold under any name.
const CREDENTIALS: Array<string> = [
  RUNNER_KEY,
  RUNNER_OWN["ONEUPTIME_INGESTION_KEY"]!,
  RUNNER_OWN["ONEUPTIME_SECRET"]!,
];

const saved: Record<string, string | undefined> = {};
const temporaryPaths: Array<string> = [];

beforeEach(() => {
  submitJobResult.mockClear();

  for (const [name, value] of Object.entries({
    ...RUNNER_OWN,
    ...OPERATOR_SETTINGS,
  })) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }

  // Set by jest.setup.ts, as Config needs it.
  expect(process.env["ONEUPTIME_RUNNER_ID"]).toBeTruthy();
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

afterAll(() => {
  for (const target of temporaryPaths) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

function scratchDirectory(prefix: string): string {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(dir);
  return dir;
}

// What a variable's name looks like.
const VARIABLE_NAME: RegExp = new RegExp("^[A-Za-z_][A-Za-z0-9_]*$");

// The names `env` printed, one per line of NAME=value.
function namesIn(envOutput: string): Array<string> {
  return envOutput
    .split("\n")
    .map((line: string): string => {
      return line.split("=")[0] || "";
    })
    .filter((name: string): boolean => {
      return VARIABLE_NAME.test(name);
    });
}

function expectNoRunnerOwnSetting(output: string): void {
  const names: Array<string> = namesIn(output);

  for (const name of NEVER_SEEN) {
    expect({ name, seen: names.includes(name) }).toEqual({
      name,
      seen: false,
    });
  }

  expect(
    names.filter((name: string): boolean => {
      return name.toUpperCase().startsWith("ONEUPTIME_RUNNER_");
    }),
  ).toEqual([]);

  // Nor any credential of the Runner's own, under any name.
  for (const value of CREDENTIALS) {
    expect(output).not.toContain(value);
  }
}

function bashJob(data: {
  script: string;
  inputs?: JSONObject | undefined;
}): ClaimedJob {
  return {
    jobId: "job-1",
    runbookExecutionId: "execution-1",
    origin: "Runbook",
    stepId: "step-1",
    stepType: "Bash",
    script: data.script,
    timeoutInMs: 20_000,
    ...(data.inputs !== undefined
      ? { inputs: data.inputs, trigger: "Webhook" }
      : {}),
  } as unknown as ClaimedJob;
}

async function runStep(claimed: ClaimedJob): Promise<{
  success: boolean;
  output: string;
}> {
  await Executor.executeAndReport(claimed);

  expect(submitJobResult).toHaveBeenCalledTimes(1);

  return submitJobResult.mock.calls[0]![0] as {
    success: boolean;
    output: string;
  };
}

function git(cwd: string, args: Array<string>): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  }).toString();
}

function makeRepository(): string {
  const dir: string = scratchDirectory("oneuptime-runner-own-env-");

  git(dir, ["init", "-q", "-b", "main", "."]);
  git(dir, ["config", "user.email", "tests@oneuptime.com"]);
  git(dir, ["config", "user.name", "Runner Tests"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(dir, "README.md"), "# app\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "baseline"]);

  return dir;
}

// A program that writes the environment it was started with to `file`.
function environmentRecorder(directory: string, file: string): string {
  const program: string = path.join(directory, "record-environment.sh");

  fs.writeFileSync(program, `#!/bin/sh\nenv >> "${file}"\nexit 0\n`, {
    mode: 0o755,
  });

  return program;
}

describe("a Bash step", () => {
  test("the report's step: `env` shows none of the Runner's own settings, and the operator's are there", async () => {
    const result: { success: boolean; output: string } = await runStep(
      bashJob({ script: "env" }),
    );

    expect(result.success).toBe(true);
    expectNoRunnerOwnSetting(result.output);

    const names: Array<string> = namesIn(result.output);
    expect(names).toEqual(
      expect.arrayContaining(["PATH", ...Object.keys(OPERATOR_SETTINGS)]),
    );
    expect(result.output).toContain(
      "ACME_REGISTRY_TOKEN=registry-token-the-build-needs",
    );
  });

  test.each([
    ["with no inputs", undefined],
    ["with a run's inputs", { host: "web-1" }],
  ])(
    "naming the key prints nothing, %s; the operator's token prints as it is",
    async (_how: string, inputs: JSONObject | undefined) => {
      const result: { success: boolean; output: string } = await runStep(
        bashJob({
          script:
            'printf "[%s][%s][%s][%s]" "$ONEUPTIME_RUNNER_KEY" "$ONEUPTIME_RUNNER_ID" "$ONEUPTIME_INGESTION_KEY" "$ACME_REGISTRY_TOKEN"',
          inputs,
        }),
      );

      expect(result.output).toBe(
        "[stdout]\n[][][][registry-token-the-build-needs]",
      );
    },
  );

  test("with a run's inputs: the inputs are there, the Runner's own are not", async () => {
    const result: { success: boolean; output: string } = await runStep(
      bashJob({ script: "env", inputs: { host: "web-1" } }),
    );

    expectNoRunnerOwnSetting(result.output);
    expect(result.output).toContain("ONEUPTIME_INPUT_HOST=web-1");
    expect(result.output).toContain("ONEUPTIME_TRIGGER=Webhook");
    expect(result.output).toContain(
      "ACME_REGISTRY_TOKEN=registry-token-the-build-needs",
    );
  });

  test("an input cannot bring a Runner setting back: every name it adds is an input's", async () => {
    const result: { success: boolean; output: string } = await runStep(
      bashJob({
        script: "env",
        inputs: { RUNNER_KEY: RUNNER_KEY.toUpperCase() },
      }),
    );

    expect(namesIn(result.output)).toContain("ONEUPTIME_INPUT_RUNNER_KEY");
    expect(namesIn(result.output)).not.toContain("ONEUPTIME_RUNNER_KEY");
  });

  test("the Runner keeps its own settings: nothing a step runs takes them from this process", async () => {
    await runStep(bashJob({ script: "env" }));

    expect(process.env["ONEUPTIME_RUNNER_KEY"]).toBe(RUNNER_KEY);
    expect(process.env["ONEUPTIME_INGESTION_KEY"]).toBe(
      RUNNER_OWN["ONEUPTIME_INGESTION_KEY"],
    );
  });
});

describe("a kubectl step", () => {
  test("with the cluster's kubeconfig: KUBECONFIG is there, the Runner's own settings are not", async () => {
    const result: BashRunResult = await KubectlScriptExecutor.execute({
      script: 'env; printf "first line: %s\\n" "$(head -n 1 "$KUBECONFIG")"',
      kubeconfig: "apiVersion: v1\nkind: Config\n",
      timeoutInMs: 20_000,
    });

    expect(result.success).toBe(true);
    expectNoRunnerOwnSetting(result.output);
    expect(namesIn(result.output)).toContain("KUBECONFIG");
    expect(result.output).toContain("first line: apiVersion: v1");
    expect(result.output).toContain(
      "ACME_REGISTRY_TOKEN=registry-token-the-build-needs",
    );
  });

  test("with the Runner's own access: the Runner's own settings are not there either", async () => {
    const result: BashRunResult = await KubectlScriptExecutor.execute({
      script: "env",
      timeoutInMs: 20_000,
    });

    expect(result.success).toBe(true);
    expectNoRunnerOwnSetting(result.output);
    expect(result.output).toContain(
      "ACME_REGISTRY_TOKEN=registry-token-the-build-needs",
    );
  });

  test("with the run's inputs, as a Bash step gets them", async () => {
    const result: BashRunResult = await KubectlScriptExecutor.execute({
      script: "env",
      kubeconfig: "apiVersion: v1\n",
      timeoutInMs: 20_000,
      environment: { ...process.env, ONEUPTIME_INPUT_NAMESPACE: "payments" },
    });

    expectNoRunnerOwnSetting(result.output);
    expect(result.output).toContain("ONEUPTIME_INPUT_NAMESPACE=payments");
  });
});

describe("a code repository's setup, build and test commands", () => {
  test("see none of the Runner's own settings, and get CI=true and the operator's settings", async () => {
    const repository: string = makeRepository();
    let printed: string = "";

    const result: CommandRunResult = await BuildVerification.runCommand({
      command: { label: "setup", command: "env" },
      repositoryPath: repository,
      onOutput: (chunk: string): void => {
        printed += chunk;
      },
    });

    expect(result.passed).toBe(true);
    expectNoRunnerOwnSetting(printed);

    const names: Array<string> = namesIn(printed);
    expect(names).toEqual(
      expect.arrayContaining(["PATH", "CI", ...Object.keys(OPERATOR_SETTINGS)]),
    );
    expect(printed).toContain("CI=true");
  });

  test("a failing command's output, which goes into the pull request and the repair prompt, holds none either", async () => {
    const repository: string = makeRepository();

    const result: CommandRunResult = await BuildVerification.runCommand({
      command: {
        label: "test",
        command:
          'env; echo "key=[$ONEUPTIME_RUNNER_KEY] ingest=[$ONEUPTIME_INGESTION_KEY]"; exit 3',
      },
      repositoryPath: repository,
    });

    expect(result.passed).toBe(false);
    expectNoRunnerOwnSetting(result.outputTail || "");
    expect(result.outputTail).toContain("key=[] ingest=[]");
    expect(result.outputTail).toContain("exited with code 3");
  });

  test("a command that only prints PATH still works, as before", async () => {
    const repository: string = makeRepository();
    let printed: string = "";

    const result: CommandRunResult = await BuildVerification.runCommand({
      command: { label: "build", command: 'printf "%s" "$PATH"' },
      repositoryPath: repository,
      onOutput: (chunk: string): void => {
        printed += chunk;
      },
    });

    expect(result.passed).toBe(true);
    expect(printed).toBe(process.env["PATH"]);
  });
});

describe("the pipeline's own git, in a tree a command set up", () => {
  test("an fsmonitor a command planted runs on the status that lists what changed - without the Runner's own settings", async () => {
    const repository: string = makeRepository();
    const record: string = path.join(
      scratchDirectory("oneuptime-fsmonitor-"),
      "environment.txt",
    );

    // What a setup command could do: `git config core.fsmonitor <program>`.
    git(repository, [
      "config",
      "core.fsmonitor",
      environmentRecorder(path.dirname(record), record),
    ]);
    fs.writeFileSync(path.join(repository, "README.md"), "# changed\n");

    const dirty: Array<string> =
      await BuildVerification.listDirtyPaths(repository);

    expect(dirty).toEqual(["README.md"]);
    // It ran: git hands its program the status's environment.
    expect(fs.existsSync(record)).toBe(true);

    const seen: string = fs.readFileSync(record, "utf-8");
    expect(namesIn(seen)).toEqual(
      expect.arrayContaining(["PATH", ...Object.keys(OPERATOR_SETTINGS)]),
    );
    expectNoRunnerOwnSetting(seen);
  });

  test("the same fsmonitor gets none of them from the pipeline's add", async () => {
    const repository: string = makeRepository();
    const record: string = path.join(
      scratchDirectory("oneuptime-fsmonitor-add-"),
      "environment.txt",
    );

    git(repository, [
      "config",
      "core.fsmonitor",
      environmentRecorder(path.dirname(record), record),
    ]);
    fs.writeFileSync(path.join(repository, "src.ts"), "export {};\n");

    await new RepositoryManager().addPaths(repository, ["src.ts"]);

    // Read before this test's own git runs, which would run it too.
    expect(fs.existsSync(record)).toBe(true);

    const seen: string = fs.readFileSync(record, "utf-8");
    expect(namesIn(seen)).toEqual(
      expect.arrayContaining(Object.keys(OPERATOR_SETTINGS)),
    );
    expectNoRunnerOwnSetting(seen);

    expect(
      git(repository, [
        "-c",
        "core.fsmonitor=false",
        "diff",
        "--cached",
        "--name-only",
      ]),
    ).toBe("src.ts\n");
  });

  test("the pipeline's commit runs no hook of the repository's, not even those --no-verify leaves", async () => {
    const repository: string = makeRepository();
    const hooks: string = scratchDirectory("oneuptime-hooks-");
    const ran: string = path.join(hooks, "ran.txt");

    // What `npm ci` installing husky does: point core.hooksPath at hooks.
    for (const hook of [
      "pre-commit",
      "prepare-commit-msg",
      "commit-msg",
      "post-commit",
    ]) {
      fs.writeFileSync(
        path.join(hooks, hook),
        `#!/bin/sh\necho ${hook} >> "${ran}"\nenv >> "${ran}"\nexit 0\n`,
        { mode: 0o755 },
      );
    }

    git(repository, ["config", "core.hooksPath", hooks]);

    fs.writeFileSync(path.join(repository, "fix.ts"), "export const x = 1;\n");
    git(repository, ["add", "fix.ts"]);

    await new RepositoryManager().commitChanges(repository, "Fix the bug");

    expect(git(repository, ["log", "-1", "--format=%s"])).toBe("Fix the bug\n");
    expect(fs.existsSync(ran)).toBe(false);
  });

  test("negative control: the same hooks do run in a commit with --no-verify alone", () => {
    const repository: string = makeRepository();
    const hooks: string = scratchDirectory("oneuptime-hooks-control-");
    const ran: string = path.join(hooks, "ran.txt");

    for (const hook of ["prepare-commit-msg", "post-commit"]) {
      fs.writeFileSync(
        path.join(hooks, hook),
        `#!/bin/sh\necho ${hook} >> "${ran}"\nexit 0\n`,
        { mode: 0o755 },
      );
    }

    git(repository, ["config", "core.hooksPath", hooks]);
    fs.writeFileSync(path.join(repository, "fix.ts"), "export const x = 1;\n");
    git(repository, ["add", "fix.ts"]);
    git(repository, ["commit", "--no-verify", "-q", "-m", "x"]);

    expect(fs.readFileSync(ran, "utf-8")).toBe(
      "prepare-commit-msg\npost-commit\n",
    );
  });
});
