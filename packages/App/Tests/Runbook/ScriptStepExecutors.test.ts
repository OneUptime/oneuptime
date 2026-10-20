import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunnerJobStatus from "Common/Types/Runbook/RunnerJobStatus";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import RunbookVariableService from "Common/Server/Services/RunbookVariableService";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import RunbookVariable from "Common/Models/DatabaseModels/RunbookVariable";
import logger from "Common/Server/Utils/Logger";
import RunnerService from "Common/Server/Services/RunnerService";
import ProjectService from "Common/Server/Services/ProjectService";
import Runner from "Common/Models/DatabaseModels/Runner";
import Project from "Common/Models/DatabaseModels/Project";
import {
  KubernetesStepConfig,
  RunbookStep,
  SSHStepConfig,
} from "Common/Types/Runbook/RunbookStep";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  getVariableRefusal,
  runBashStep,
  runKubernetesStep,
  runSshStep,
  StepExecutionContext,
  StepRunResult,
} from "../../FeatureSet/Runbook/Services/StepExecutors";

/*
 * SSH AND KUBECTL STEPS THAT TAKE A SCRIPT, DISPATCHED.
 *
 * The Worker builds the job a Runner takes: the step's references, never a
 * value - the Runner is handed the values when it takes the job
 * (RunnerIngress, RunbookJobVariables). What is caught before a job is ever
 * created:
 *
 *   - an SSH step with no machine, nothing to sign in with, a sign-in that
 *     is not one secret variable, or no script;
 *   - a kubectl step with no script, or a kubeconfig that is not one secret
 *     variable;
 *   - any step that names a variable that is not there, or signs in with
 *     one that is not a secret.
 */

const AGENT_ID: string = "a9e10000-0000-4000-8000-0000000000a1";
const RUNBOOK_ID: ObjectID = new ObjectID(
  "a9e10000-0000-4000-8000-0000000000b1",
);

type RawConfig = Record<string, unknown>;

function makeCtx(): StepExecutionContext {
  return {
    projectId: new ObjectID("proj1"),
    runbookExecutionId: new ObjectID("exec1"),
    runbookId: RUNBOOK_ID,
  };
}

function sshConfig(overrides: RawConfig = {}): RawConfig {
  return {
    host: "10.0.4.21",
    username: "deploy",
    signIn: "{{global.variables.DB_KEY}}",
    script: "sudo systemctl restart nginx",
    agentId: AGENT_ID,
    ...overrides,
  };
}

function sshStep(config: RawConfig = sshConfig()): RunbookStep {
  return {
    id: "ssh-step-1",
    order: 0,
    type: RunbookStepType.SSH,
    title: "Restart nginx",
    config: config as unknown as SSHStepConfig,
  };
}

function kubectlConfig(overrides: RawConfig = {}): RawConfig {
  return {
    kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
    script: "kubectl rollout restart deployment/api --namespace web",
    agentId: AGENT_ID,
    ...overrides,
  };
}

function kubectlStep(config: RawConfig = kubectlConfig()): RunbookStep {
  return {
    id: "kubectl-step-1",
    order: 1,
    type: RunbookStepType.Kubernetes,
    title: "Restart the API",
    config: config as unknown as KubernetesStepConfig,
  };
}

function finishedJob(output: string): RunnerJob {
  return {
    _id: "job1",
    status: RunnerJobStatus.Succeeded,
    output,
  } as unknown as RunnerJob;
}

let enqueueSpy: jest.SpyInstance;
let variables: Array<RunbookVariable>;

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });

  // The step's Runner is one of its project's own.
  jest
    .spyOn(RunnerService, "findOneById")
    .mockImplementation(async (args: { id: ObjectID }): Promise<Runner> => {
      return Object.assign(new Runner(), {
        _id: args.id.toString(),
        projectId: makeCtx().projectId,
        isGlobalRunner: false,
      });
    });
  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(
      Object.assign(new Project(), { useGlobalRunners: true }) as never,
    );
  jest
    .spyOn(RunnerService, "hasGlobalRunnerForRunbooks")
    .mockResolvedValue(false);

  jest.spyOn(RunnerJobService, "findLatestJobForStep").mockResolvedValue(null);
  enqueueSpy = jest
    .spyOn(RunnerJobService, "enqueue")
    .mockResolvedValue(finishedJob("") as never);
  jest
    .spyOn(RunnerJobService, "pollUntilTerminal")
    .mockResolvedValue(finishedJob("done") as never);

  variables = [
    Object.assign(new RunbookVariable(), { name: "DB_KEY", isSecret: true }),
    Object.assign(new RunbookVariable(), {
      name: "DB_HOST",
      isSecret: false,
    }),
    Object.assign(new RunbookVariable(), {
      name: "PROD_KUBECONFIG",
      isSecret: true,
    }),
  ];
  jest
    .spyOn(RunbookVariableService, "findBy")
    .mockImplementation(async (): Promise<never> => {
      return variables as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function enqueued(): Record<string, unknown> {
  expect(enqueueSpy).toHaveBeenCalledTimes(1);
  return enqueueSpy.mock.calls[0]![0] as Record<string, unknown>;
}

describe("an SSH step that takes a script", () => {
  test("dispatches the machine, the sign-in reference and the script - never a value", async () => {
    const result: StepRunResult = await runSshStep(sshStep(), makeCtx());

    expect(result).toEqual({ success: true, output: "done" });

    const job: Record<string, unknown> = enqueued();
    expect(job["stepType"]).toBe(RunbookStepType.SSH);
    expect(job["script"]).toBe("");
    expect(job["payload"]).toEqual({
      host: "10.0.4.21",
      username: "deploy",
      port: 22,
      signIn: "{{global.variables.DB_KEY}}",
      script: "sudo systemctl restart nginx",
    });
    expect((job["targetAgentId"] as ObjectID).toString()).toBe(AGENT_ID);
  });

  test("keeps a port and a passphrase it was given", async () => {
    variables.push(
      Object.assign(new RunbookVariable(), {
        name: "DB_KEY_PASSPHRASE",
        isSecret: true,
      }),
    );

    await runSshStep(
      sshStep(
        sshConfig({
          port: 2222,
          passphrase: " {{global.variables.DB_KEY_PASSPHRASE}} ",
        }),
      ),
      makeCtx(),
    );

    expect(enqueued()["payload"]).toMatchObject({
      port: 2222,
      passphrase: "{{global.variables.DB_KEY_PASSPHRASE}}",
    });
  });

  test.each([
    ["0", 0],
    ["above 65535", 70000],
    ["not a whole number", 22.5],
    ["text", "2222"],
  ])("a port that is %s is 22", async (_label: string, port: unknown) => {
    await runSshStep(sshStep(sshConfig({ port })), makeCtx());

    expect((enqueued()["payload"] as Record<string, unknown>)["port"]).toBe(22);
  });

  test.each([
    [
      "no host",
      { host: "" },
      "This SSH step has no machine to sign in to. Open the step and fill in SSH to, as user@host.",
    ],
    [
      "no user",
      { username: "  " },
      "This SSH step has no machine to sign in to. Open the step and fill in SSH to, as user@host.",
    ],
    [
      "nothing to sign in with",
      { signIn: "" },
      "This step has no key or password to sign in with. Open the step and pick the secret variable that holds it.",
    ],
    [
      "a password typed into the sign-in",
      { signIn: "hunter2" },
      "This step's key or password to sign in with is not one secret variable. Open the step and pick a secret variable.",
    ],
    [
      "a passphrase that is not one variable",
      { passphrase: "open sesame" },
      "This step's key passphrase is not one secret variable. Open the step and pick a secret variable.",
    ],
    ["no script", { script: "  \n" }, "This SSH step has no script to run."],
  ])(
    "%s fails the step before anything is dispatched",
    async (_label: string, overrides: RawConfig, message: string) => {
      const result: StepRunResult = await runSshStep(
        sshStep(sshConfig(overrides)),
        makeCtx(),
      );

      expect(result).toEqual({
        success: false,
        output: "",
        errorMessage: message,
      });
      expect(enqueueSpy).not.toHaveBeenCalled();
    },
  );

  test("signing in with a variable that is not a secret fails the step before dispatch", async () => {
    const result: StepRunResult = await runSshStep(
      sshStep(sshConfig({ signIn: "{{global.variables.DB_HOST}}" })),
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      'This step names variables it cannot use, so it was not run: "DB_HOST" is not a secret variable (keep a key, a password or a kubeconfig in a secret variable).',
    );
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test("a script naming a variable that is not there fails the step before dispatch", async () => {
    const result: StepRunResult = await runSshStep(
      sshStep(sshConfig({ script: "psql -h {{global.variables.NOPE}}" })),
      makeCtx(),
    );

    expect(result.errorMessage).toBe(
      'This step names variables it cannot use, so it was not run: there is no global variable named "NOPE" (Runbooks → Settings → Global Variables).',
    );
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test("an SSH step needs a Runner of its own", async () => {
    const result: StepRunResult = await runSshStep(
      sshStep(sshConfig({ agentId: "" })),
      makeCtx(),
    );

    expect(result.errorMessage).toBe(
      "This SSH step has no Runner. SSH steps run on a Runner of your own, inside your network: global Runners run JavaScript steps only. Pick one of your Runners for the step, or add one under Runbooks → Runners.",
    );
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});

describe("a kubectl step that takes a script", () => {
  test("dispatches the kubeconfig reference and the script - never a value", async () => {
    const result: StepRunResult = await runKubernetesStep(
      kubectlStep(),
      makeCtx(),
    );

    expect(result.success).toBe(true);

    const job: Record<string, unknown> = enqueued();
    expect(job["stepType"]).toBe(RunbookStepType.Kubernetes);
    expect(job["script"]).toBe("");
    expect(job["payload"]).toEqual({
      kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
      script: "kubectl rollout restart deployment/api --namespace web",
    });
  });

  test("with no kubeconfig, it carries none: the Runner's own access", async () => {
    await runKubernetesStep(
      kubectlStep(kubectlConfig({ kubeconfig: "" })),
      makeCtx(),
    );

    expect(enqueued()["payload"]).toEqual({
      script: "kubectl rollout restart deployment/api --namespace web",
    });
  });

  test.each([
    ["no script", { script: "" }, "This kubectl step has no script to run."],
    [
      "a kubeconfig pasted in",
      { kubeconfig: "apiVersion: v1" },
      "This step's kubeconfig is not one secret variable. Open the step and pick a secret variable.",
    ],
  ])(
    "%s fails the step before anything is dispatched",
    async (_label: string, overrides: RawConfig, message: string) => {
      const result: StepRunResult = await runKubernetesStep(
        kubectlStep(kubectlConfig(overrides)),
        makeCtx(),
      );

      expect(result.errorMessage).toBe(message);
      expect(enqueueSpy).not.toHaveBeenCalled();
    },
  );

  test("a kubectl step needs a Runner of its own", async () => {
    const result: StepRunResult = await runKubernetesStep(
      kubectlStep(kubectlConfig({ agentId: "" })),
      makeCtx(),
    );

    expect(result.errorMessage).toContain(
      "This Kubernetes step has no Runner.",
    );
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});

describe("getVariableRefusal: before a job is sent", () => {
  test("names nothing: nothing is read", async () => {
    const findBy: jest.SpyInstance = RunbookVariableService.findBy as never;

    expect(
      await getVariableRefusal({
        ctx: makeCtx(),
        texts: ["uptime"],
        secretFields: [],
      }),
    ).toBeNull();
    expect(findBy).not.toHaveBeenCalled();
  });

  test("reads the run's runbook for the step's own variables, and never values", async () => {
    variables = [
      Object.assign(new RunbookVariable(), { name: "NS", isSecret: false }),
    ];

    expect(
      await getVariableRefusal({
        ctx: makeCtx(),
        texts: ["kubectl -n {{local.variables.NS}} get pods"],
        secretFields: [],
      }),
    ).toBeNull();

    const args: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = (RunbookVariableService.findBy as unknown as jest.Mock).mock
      .calls[0]![0] as never;
    expect(String(args.query["runbookId"])).toBe(RUNBOOK_ID.toString());
    expect(args.select).not.toHaveProperty("secretValue");
    expect(args.select).not.toHaveProperty("value");
  });

  test("a Bash step naming a variable that is not there is not dispatched either", async () => {
    const result: StepRunResult = await runBashStep(
      {
        id: "bash-1",
        order: 0,
        type: RunbookStepType.Bash,
        title: "Clear the cache",
        config: {
          script: "redis-cli -h {{global.variables.REDIS_HOST}} flushall",
          agentId: AGENT_ID,
        },
      },
      makeCtx(),
    );

    expect(result.errorMessage).toBe(
      'This step names variables it cannot use, so it was not run: there is no global variable named "REDIS_HOST" (Runbooks → Settings → Global Variables).',
    );
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
