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
  KubernetesAction,
  KubernetesStepConfig,
  KubernetesWorkloadKind,
  RunbookStep,
  SSHStepConfig,
} from "Common/Types/Runbook/RunbookStep";
import { REMOVED_RUNBOOK_CREDENTIAL_STEP_MESSAGE } from "Common/Types/Runbook/RunbookLegacySteps";
import {
  DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
  DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
  MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
} from "Common/Types/Runbook/RunbookStepTimeout";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import {
  runKubernetesStep,
  runSshStep,
  StepExecutionContext,
  StepRunResult,
} from "../../FeatureSet/Runbook/Services/StepExecutors";

/*
 * SSH and kubectl steps act on the customer's own infrastructure, so the
 * Worker never executes them: it builds a payload of references and hands
 * it to a Runner, which is given what they name when it claims the job.
 * Everything below is about that hand-off:
 *
 *   - a step written with a runbook credential - an SSH step with a
 *     credential and a command, a Kubernetes step with a credential and one
 *     workload action, never moved to variables - no longer runs: runbook
 *     credentials were removed. It fails before anything is read, looked up
 *     or queued, with what to do instead, whatever else it holds - secrets
 *     stashed on its config included. A step that names a credential beside
 *     a script is a script step, and runs as one, without it;
 *   - which misconfigurations of a step that takes a script are caught
 *     before a job row is ever created, and in which order;
 *   - where a step runs: the Runner it picked, else the project's default
 *     Runner, never a global Runner;
 *   - the dispatched job: an empty top-level script that is not mistaken for
 *     a no-op step, a payload picked field by field, timeouts on the job row
 *     and the poll window alike;
 *   - results and redelivery: a failed job's error and output, an enqueue
 *     failure, a redelivered execution adopting the job it already has.
 *
 * What a script step's payload holds, field by field, and its variable
 * checks are ScriptStepExecutors'. Step configs are untyped JSON at rest, so
 * the fixtures here are raw objects rather than typed literals: a field can
 * be genuinely absent, which is the shape the validation has to survive.
 */
type RawConfig = Record<string, unknown>;

// The Runner the steps here picked: a Runner ID, as the step editor stores it.
const AGENT_ID: string = "a9e10000-0000-4000-8000-0000000000a1";

function makeCtx(): StepExecutionContext {
  return {
    projectId: new ObjectID("proj1"),
    runbookExecutionId: new ObjectID("exec1"),
  };
}

/*
 * Where a step runs is decided by GlobalRunnerChoice, which reads, as
 * OneUptime, the Runner the step picked, the project's default Runner, the
 * project's "Use global Runners" switch and whether the server has a global
 * Runner. Here the Runner a step picked is always one of its project's own,
 * the project has no default Runner (unless a test gives it one) and uses
 * global Runners, and the server has none - so a step that picked no Runner
 * is refused. StepExecutorsGlobalRunner covers the rest.
 */
let projectDefaultRunner: Runner | null = null;

// The project's default Runner, as RunnerService.findProjectDefaultRunner answers.
const PROJECT_DEFAULT_RUNNER_ID: string =
  "c1e10000-0000-4000-8000-0000000000d1";

interface RunnerChoiceSpies {
  findRunnerSpy: jest.SpyInstance;
  findDefaultSpy: jest.SpyInstance;
}

let runnerChoice: RunnerChoiceSpies;
let variablesSpy: jest.SpyInstance;

function stubRunnerChoiceFacts(): RunnerChoiceSpies {
  projectDefaultRunner = null;
  const findDefaultSpy: jest.SpyInstance = jest
    .spyOn(RunnerService, "findProjectDefaultRunner")
    .mockImplementation(async (): Promise<Runner | null> => {
      return projectDefaultRunner;
    });
  const findRunnerSpy: jest.SpyInstance = jest
    .spyOn(RunnerService, "findOneById")
    .mockImplementation(async (args: { id: ObjectID }): Promise<Runner> => {
      const runner: Runner = new Runner();
      runner._id = args.id.toString();
      runner.projectId = makeCtx().projectId;
      runner.isGlobalRunner = false;
      return runner;
    });
  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<Project> => {
      const project: Project = new Project();
      project.useGlobalRunners = true;
      return project;
    });
  jest
    .spyOn(RunnerService, "hasGlobalRunnerForRunbooks")
    .mockResolvedValue(false);

  return { findRunnerSpy, findDefaultSpy };
}

// The project's variables: the steps sign in with the two secret ones.
function stubVariables(): jest.SpyInstance {
  const variables: Array<RunbookVariable> = [
    Object.assign(new RunbookVariable(), { name: "DB_KEY", isSecret: true }),
    Object.assign(new RunbookVariable(), {
      name: "PROD_KUBECONFIG",
      isSecret: true,
    }),
  ];

  return jest
    .spyOn(RunbookVariableService, "findBy")
    .mockImplementation(async (): Promise<never> => {
      return variables as never;
    });
}

beforeEach(() => {
  runnerChoice = stubRunnerChoiceFacts();
  variablesSpy = stubVariables();
});

function omit(config: RawConfig, ...keys: Array<string>): RawConfig {
  const copy: RawConfig = { ...config };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

// An SSH step that takes a script: the machine, the secret it signs in with, the script.
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

// An SSH step written with a runbook credential and a command, before variables.
function legacySshConfig(overrides: RawConfig = {}): RawConfig {
  return {
    credentialId: "cred-ssh-1",
    command: "systemctl restart nginx",
    agentId: AGENT_ID,
    ...overrides,
  };
}

function makeSshStep(config: RawConfig = sshConfig()): RunbookStep {
  return {
    id: "ssh-step-1",
    order: 0,
    type: RunbookStepType.SSH,
    title: "Restart nginx",
    config: config as unknown as SSHStepConfig,
  };
}

// A kubectl step: the kubeconfig it uses, and a script of kubectl commands.
function k8sConfig(overrides: RawConfig = {}): RawConfig {
  return {
    kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
    script: "kubectl rollout restart deployment/api --namespace production",
    agentId: AGENT_ID,
    ...overrides,
  };
}

// A Kubernetes step written with a runbook credential and one workload action.
function legacyK8sConfig(overrides: RawConfig = {}): RawConfig {
  return {
    credentialId: "cred-k8s-1",
    action: KubernetesAction.RestartWorkload,
    workloadKind: KubernetesWorkloadKind.Deployment,
    namespace: "production",
    workloadName: "api",
    agentId: AGENT_ID,
    ...overrides,
  };
}

function makeK8sStep(config: RawConfig = k8sConfig()): RunbookStep {
  return {
    id: "k8s-step-1",
    order: 0,
    type: RunbookStepType.Kubernetes,
    title: "Restart the API deployment",
    config: config as unknown as KubernetesStepConfig,
  };
}

function makeJob(overrides: Partial<Record<string, unknown>> = {}): RunnerJob {
  return {
    _id: "job1",
    status: RunnerJobStatus.Succeeded,
    output: "job output",
    ...overrides,
  } as unknown as RunnerJob;
}

interface DispatchSpies {
  findSpy: jest.SpyInstance;
  enqueueSpy: jest.SpyInstance;
  pollSpy: jest.SpyInstance;
}

/*
 * Every one of the three service calls the dispatcher can make is stubbed,
 * including on the tests that assert nothing is dispatched: if a guard ever
 * regresses, the test should fail on the assertion rather than reach for a
 * database that is not there.
 */
function stubDispatch(): DispatchSpies {
  return {
    findSpy: jest
      .spyOn(RunnerJobService, "findLatestJobForStep")
      .mockResolvedValue(null),
    enqueueSpy: jest
      .spyOn(RunnerJobService, "enqueue")
      .mockResolvedValue(makeJob()),
    pollSpy: jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(makeJob()),
  };
}

function firstCallArgs(spy: jest.SpyInstance): Record<string, unknown> {
  return spy.mock.calls[0]![0] as Record<string, unknown>;
}

function enqueuedPayload(spy: jest.SpyInstance): Record<string, unknown> {
  return firstCallArgs(spy)["payload"] as Record<string, unknown>;
}

/*
 * Strings that must never appear in a dispatched job: a job row is not a
 * place a private key, a password or a service-account token may be
 * persisted. A step names secret variables; the Runner is handed what they
 * hold when it claims the job (RunnerIngress, RunbookJobVariables).
 */
const SECRET_MARKERS: Array<string> = [
  "sshPrivateKey",
  "sshPassword",
  "sshPassphrase",
  "sshHostname",
  "sshUsername",
  "kubernetesServiceAccountToken",
  "kubernetesCaCertificate",
  "kubernetesApiServerUrl",
  "BEGIN OPENSSH PRIVATE KEY",
  "hunter2",
  "eyJhbGciOi",
];

function expectNoSecretMaterial(spy: jest.SpyInstance): void {
  const serialized: string = JSON.stringify(firstCallArgs(spy));
  for (const marker of SECRET_MARKERS) {
    expect(serialized).not.toContain(marker);
  }
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The answer to a step written with a runbook credential, and nothing else.
async function expectRefusedAsRemoved(
  run: () => Promise<StepRunResult>,
): Promise<void> {
  const { findSpy, enqueueSpy, pollSpy } = stubDispatch();

  const result: StepRunResult = await run();

  expect(result).toEqual({
    success: false,
    output: "",
    errorMessage: REMOVED_RUNBOOK_CREDENTIAL_STEP_MESSAGE,
  });

  // Nothing is queued, looked up or read: the step cannot run anywhere.
  expect(enqueueSpy).not.toHaveBeenCalled();
  expect(findSpy).not.toHaveBeenCalled();
  expect(pollSpy).not.toHaveBeenCalled();
  expect(runnerChoice.findRunnerSpy).not.toHaveBeenCalled();
  expect(runnerChoice.findDefaultSpy).not.toHaveBeenCalled();
  expect(variablesSpy).not.toHaveBeenCalled();
}

describe("a step written with a runbook credential no longer runs", () => {
  test("its answer says why, and what to do: turn it into a script step that signs in with a variable", () => {
    expect(REMOVED_RUNBOOK_CREDENTIAL_STEP_MESSAGE).toBe(
      "This step names a runbook credential, and runbook credentials were removed, so it was not run. Open the runbook's Steps page, choose Turn into a script step on this step, and pick the secret runbook variable it signs in with.",
    );
  });

  test.each([
    ["a credential and a command", legacySshConfig()],
    ["a credential and no command", omit(legacySshConfig(), "command")],
    ["a credential and no Runner", legacySshConfig({ agentId: "" })],
    ["a credential and a blank script", legacySshConfig({ script: "   " })],
    [
      "a credential with secrets stashed on the step",
      legacySshConfig({
        sshPrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n",
        sshPassword: "hunter2",
        sshHostname: "db-primary.internal",
        sshUsername: "root",
      }),
    ],
  ])(
    "an SSH step with %s fails before anything is read or queued",
    async (_label: string, config: RawConfig) => {
      await expectRefusedAsRemoved(async (): Promise<StepRunResult> => {
        return await runSshStep(makeSshStep(config), makeCtx());
      });
    },
  );

  test.each([
    ["a restart", legacyK8sConfig()],
    [
      "a scale to zero",
      legacyK8sConfig({ action: KubernetesAction.ScaleWorkload, replicas: 0 }),
    ],
    [
      "a scale with no replica count",
      legacyK8sConfig({ action: KubernetesAction.ScaleWorkload }),
    ],
    [
      "no namespace or workload",
      omit(legacyK8sConfig(), "namespace", "workloadName"),
    ],
    ["no Runner", legacyK8sConfig({ agentId: "" })],
    [
      "a service account token stashed on the step",
      legacyK8sConfig({
        kubernetesServiceAccountToken: "eyJhbGciOiJSUzI1NiJ9.token",
        kubernetesCaCertificate: "-----BEGIN CERTIFICATE-----",
        kubernetesApiServerUrl: "https://10.0.0.1:6443",
      }),
    ],
  ])(
    "a Kubernetes step with a credential and %s fails before anything is read or queued",
    async (_label: string, config: RawConfig) => {
      await expectRefusedAsRemoved(async (): Promise<StepRunResult> => {
        return await runKubernetesStep(makeK8sStep(config), makeCtx());
      });
    },
  );

  /*
   * Negative controls: a credential beside a script is what a step the move
   * to variables wrote looked like, or what an API client left behind. Such
   * a step is a script step; it runs, and the credential and the action go
   * nowhere.
   */
  test("an SSH step that names a credential beside its script runs as a script step, without the credential", async () => {
    const { enqueueSpy } = stubDispatch();

    const result: StepRunResult = await runSshStep(
      makeSshStep(sshConfig({ credentialId: "cred-ssh-1", command: "uptime" })),
      makeCtx(),
    );

    expect(result.success).toBe(true);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(Object.keys(enqueuedPayload(enqueueSpy)).sort()).toEqual([
      "host",
      "port",
      "script",
      "signIn",
      "username",
    ]);
  });

  test("a kubectl step that kept its credential and action beside its script runs the script, without them", async () => {
    const { enqueueSpy } = stubDispatch();

    const result: StepRunResult = await runKubernetesStep(
      makeK8sStep({ ...legacyK8sConfig(), ...k8sConfig() }),
      makeCtx(),
    );

    expect(result.success).toBe(true);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueuedPayload(enqueueSpy)).toEqual({
      kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
      script: "kubectl rollout restart deployment/api --namespace production",
    });
  });
});

describe("runSshStep", () => {
  describe("misconfiguration is caught before a job is created", () => {
    test.each([
      ["the host is absent", omit(sshConfig(), "host")],
      ["the host is empty", sshConfig({ host: "" })],
      ["the user is absent", omit(sshConfig(), "username")],
      ["the user is only whitespace", sshConfig({ username: "   " })],
    ])(
      "a step without a machine fails and never dispatches - %s",
      async (_label: string, config: RawConfig) => {
        const { findSpy, enqueueSpy, pollSpy } = stubDispatch();

        const result: StepRunResult = await runSshStep(
          makeSshStep(config),
          makeCtx(),
        );

        expect(result.success).toBe(false);
        expect(result.output).toBe("");
        // The message has to say what to fill in; "invalid config" helps nobody.
        expect(result.errorMessage).toBe(
          "This SSH step has no machine to sign in to. Open the step and fill in SSH to, as user@host.",
        );
        expect(enqueueSpy).not.toHaveBeenCalled();
        // Not even a lookup: the step cannot possibly run.
        expect(findSpy).not.toHaveBeenCalled();
        expect(pollSpy).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["the field is absent", omit(sshConfig(), "script")],
      ["the field is an empty string", sshConfig({ script: "" })],
      ["the field is only whitespace", sshConfig({ script: "  \n " })],
    ])(
      "a step without a script fails and never dispatches - %s",
      async (_label: string, config: RawConfig) => {
        const { findSpy, enqueueSpy, pollSpy } = stubDispatch();

        const result: StepRunResult = await runSshStep(
          makeSshStep(config),
          makeCtx(),
        );

        expect(result.success).toBe(false);
        expect(result.output).toBe("");
        expect(result.errorMessage).toBe("This SSH step has no script to run.");
        expect(enqueueSpy).not.toHaveBeenCalled();
        expect(findSpy).not.toHaveBeenCalled();
        expect(pollSpy).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["the field is absent", omit(sshConfig(), "agentId")],
      ["the field is an empty string", sshConfig({ agentId: "" })],
      ["the field is only whitespace", sshConfig({ agentId: "   " })],
    ])(
      "a step without a Runner fails and never dispatches - %s",
      async (_label: string, config: RawConfig) => {
        const { findSpy, enqueueSpy, pollSpy } = stubDispatch();

        const result: StepRunResult = await runSshStep(
          makeSshStep(config),
          makeCtx(),
        );

        expect(result.success).toBe(false);
        expect(result.output).toBe("");
        // An SSH step never runs on a global Runner: it needs one of the project's own.
        expect(result.errorMessage).toBe(
          "This SSH step has no Runner. SSH steps run on a Runner of your own, inside your network: global Runners run JavaScript steps only. Pick one of your Runners for the step, or make one the project's default Runner under Runbooks → Runners.",
        );
        expect(enqueueSpy).not.toHaveBeenCalled();
        /*
         * It looked for a job of its own first, as any step that may run
         * does: the project's default Runner could have run it.
         */
        expect(findSpy).toHaveBeenCalledTimes(1);
        expect(pollSpy).not.toHaveBeenCalled();
      },
    );

    test("a step without a Runner runs on the project's default Runner when the project has one", async () => {
      const { enqueueSpy } = stubDispatch();
      const defaultRunner: Runner = new Runner();
      defaultRunner._id = PROJECT_DEFAULT_RUNNER_ID;
      projectDefaultRunner = defaultRunner;

      const result: StepRunResult = await runSshStep(
        makeSshStep(sshConfig({ agentId: "" })),
        makeCtx(),
      );

      expect(result.success).toBe(true);
      expect(
        (firstCallArgs(enqueueSpy)["targetAgentId"] as ObjectID).toString(),
      ).toBe(PROJECT_DEFAULT_RUNNER_ID);
      expect(firstCallArgs(enqueueSpy)).not.toHaveProperty(
        "runsOnGlobalRunner",
      );
    });

    test("a step missing everything reports the machine first, deterministically", async () => {
      const { enqueueSpy } = stubDispatch();

      const result: StepRunResult = await runSshStep(
        makeSshStep(
          omit(sshConfig(), "host", "username", "signIn", "script", "agentId"),
        ),
        makeCtx(),
      );

      expect(result.errorMessage).toBe(
        "This SSH step has no machine to sign in to. Open the step and fill in SSH to, as user@host.",
      );
      expect(enqueueSpy).not.toHaveBeenCalled();
    });
  });

  describe("the dispatched job", () => {
    test("enqueues an SSH job with an empty top-level script and a payload of references, field by field", async () => {
      const { enqueueSpy, pollSpy } = stubDispatch();
      pollSpy.mockResolvedValue(makeJob({ output: "nginx restarted" }));

      const step: RunbookStep = makeSshStep();
      const result: StepRunResult = await runSshStep(step, makeCtx());

      expect(result.success).toBe(true);
      expect(result.output).toBe("nginx restarted");

      const args: Record<string, unknown> = firstCallArgs(enqueueSpy);
      expect(args["stepType"]).toBe(RunbookStepType.SSH);
      // The instruction lives in the payload, not in the job's own script.
      expect(args["script"]).toBe("");
      expect(args["stepId"]).toBe(step.id);
      expect((args["targetAgentId"] as ObjectID).toString()).toBe(AGENT_ID);

      /*
       * Exact keys, not objectContaining: the assertion that matters here is
       * the absence of anything else. A payload that grew a resolved key
       * would still pass a containment check.
       */
      expect(enqueuedPayload(enqueueSpy)).toEqual({
        host: "10.0.4.21",
        username: "deploy",
        port: 22,
        signIn: "{{global.variables.DB_KEY}}",
        script: "sudo systemctl restart nginx",
      });
      expectNoSecretMaterial(enqueueSpy);
    });

    test("secrets stashed on the step config never reach the job", async () => {
      /*
       * The executor picks fields out of the config explicitly rather than
       * spreading it. That is what stops a stray key - pasted into the step
       * by an older UI, a template or an API caller - from being persisted in
       * plaintext on the job row and shipped to whichever Runner claims it.
       */
      const { enqueueSpy } = stubDispatch();

      await runSshStep(
        makeSshStep(
          sshConfig({
            sshPrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n",
            sshPassword: "hunter2",
            sshHostname: "db-primary.internal",
            sshUsername: "root",
          }),
        ),
        makeCtx(),
      );

      expect(Object.keys(enqueuedPayload(enqueueSpy)).sort()).toEqual([
        "host",
        "port",
        "script",
        "signIn",
        "username",
      ]);
      expectNoSecretMaterial(enqueueSpy);
    });

    test("the empty top-level script is not mistaken for a no-op step", async () => {
      /*
       * The dispatcher short-circuits script steps with nothing to run. An
       * SSH step's own script travels in its payload, so if that guard did
       * not exempt payload-carrying steps, every SSH step in production would
       * silently succeed without ever touching the host.
       */
      const { enqueueSpy, pollSpy } = stubDispatch();

      const result: StepRunResult = await runSshStep(makeSshStep(), makeCtx());

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      expect(pollSpy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    test("the script is forwarded verbatim, whatever it contains", async () => {
      const { enqueueSpy } = stubDispatch();
      const script: string =
        "bash -lc 'pg_dump -Fc app | gzip > /backup/$(date +%F).gz' # \"quotes\" & $vars";

      await runSshStep(makeSshStep(sshConfig({ script })), makeCtx());

      expect(enqueuedPayload(enqueueSpy)["script"]).toBe(script);
    });

    test("unset timeouts dispatch with the documented defaults", async () => {
      const { enqueueSpy, pollSpy } = stubDispatch();

      await runSshStep(makeSshStep(), makeCtx());

      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(
        DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(enqueueSpy)["claimTimeoutInMs"]).toBe(
        DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(pollSpy)["executionTimeoutInMs"]).toBe(
        DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(pollSpy)["claimTimeoutInMs"]).toBe(
        DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
      );
    });

    test("configured timeouts reach both the job row and the poll window, and are clamped together", async () => {
      const { enqueueSpy, pollSpy } = stubDispatch();

      await runSshStep(
        makeSshStep(
          sshConfig({ timeoutInMs: 600_000, claimTimeoutInMs: 300_000 }),
        ),
        makeCtx(),
      );

      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(600_000);
      expect(firstCallArgs(enqueueSpy)["claimTimeoutInMs"]).toBe(300_000);
      expect(firstCallArgs(pollSpy)["executionTimeoutInMs"]).toBe(600_000);
      expect(firstCallArgs(pollSpy)["claimTimeoutInMs"]).toBe(300_000);

      jest.restoreAllMocks();
      runnerChoice = stubRunnerChoiceFacts();
      variablesSpy = stubVariables();
      jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });
      jest.spyOn(logger, "info").mockImplementation((): void => {
        return undefined;
      });
      const clamped: DispatchSpies = stubDispatch();

      await runSshStep(
        makeSshStep(sshConfig({ timeoutInMs: 24 * 60 * 60_000 })),
        makeCtx(),
      );

      expect(firstCallArgs(clamped.enqueueSpy)["timeoutInMs"]).toBe(
        MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
      expect(firstCallArgs(clamped.pollSpy)["executionTimeoutInMs"]).toBe(
        MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
    });
  });

  describe("results and redelivery", () => {
    test("a failed job surfaces the Runner's error message and partial output", async () => {
      const { pollSpy } = stubDispatch();
      pollSpy.mockResolvedValue(
        makeJob({
          status: RunnerJobStatus.Failed,
          output: "Permission denied (publickey).",
          errorMessage: "SSH authentication failed",
        }),
      );

      const result: StepRunResult = await runSshStep(makeSshStep(), makeCtx());

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("SSH authentication failed");
      expect(result.output).toBe("Permission denied (publickey).");
    });

    test("an enqueue failure fails the step rather than throwing into the execution", async () => {
      const { enqueueSpy } = stubDispatch();
      enqueueSpy.mockRejectedValue(new Error("queue unavailable"));

      const result: StepRunResult = await runSshStep(makeSshStep(), makeCtx());

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("queue unavailable");
    });

    test("a redelivered execution adopts the finished job instead of running the script twice", async () => {
      /*
       * The whole point of the lookup: `systemctl restart` is survivable
       * twice, `rm -rf` on a stale directory is not. A step that already
       * produced a terminal job row has already run.
       */
      const { findSpy, enqueueSpy, pollSpy } = stubDispatch();
      findSpy.mockResolvedValue(
        makeJob({
          status: RunnerJobStatus.Succeeded,
          output: "ran once",
        }),
      );

      const result: StepRunResult = await runSshStep(makeSshStep(), makeCtx());

      expect(enqueueSpy).not.toHaveBeenCalled();
      expect(pollSpy).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.output).toBe("ran once");
    });
  });
});

describe("runKubernetesStep", () => {
  describe("misconfiguration is caught before a job is created", () => {
    test.each([
      ["the field is absent", omit(k8sConfig(), "script")],
      ["the field is an empty string", k8sConfig({ script: "" })],
      ["the field is only whitespace", k8sConfig({ script: " \n " })],
    ])(
      "a step without a script fails and never dispatches - %s",
      async (_label: string, config: RawConfig) => {
        const { findSpy, enqueueSpy, pollSpy } = stubDispatch();

        const result: StepRunResult = await runKubernetesStep(
          makeK8sStep(config),
          makeCtx(),
        );

        expect(result.success).toBe(false);
        expect(result.output).toBe("");
        expect(result.errorMessage).toBe(
          "This kubectl step has no script to run.",
        );
        expect(enqueueSpy).not.toHaveBeenCalled();
        expect(findSpy).not.toHaveBeenCalled();
        expect(pollSpy).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["the field is absent", omit(k8sConfig(), "agentId")],
      ["the field is an empty string", k8sConfig({ agentId: "" })],
      ["the field is only whitespace", k8sConfig({ agentId: "  " })],
    ])(
      "a step without a Runner fails and never dispatches - %s",
      async (_label: string, config: RawConfig) => {
        const { enqueueSpy, pollSpy } = stubDispatch();

        const result: StepRunResult = await runKubernetesStep(
          makeK8sStep(config),
          makeCtx(),
        );

        expect(result.success).toBe(false);
        // A kubectl step never runs on a global Runner: it needs one of the project's own.
        expect(result.errorMessage).toBe(
          "This Kubernetes step has no Runner. Kubernetes steps run on a Runner of your own, inside your network: global Runners run JavaScript steps only. Pick one of your Runners for the step, or make one the project's default Runner under Runbooks → Runners.",
        );
        expect(enqueueSpy).not.toHaveBeenCalled();
        expect(pollSpy).not.toHaveBeenCalled();
      },
    );

    test("a step without a Runner runs on the project's default Runner when the project has one", async () => {
      const { enqueueSpy } = stubDispatch();
      const defaultRunner: Runner = new Runner();
      defaultRunner._id = PROJECT_DEFAULT_RUNNER_ID;
      projectDefaultRunner = defaultRunner;

      const result: StepRunResult = await runKubernetesStep(
        makeK8sStep(k8sConfig({ agentId: "" })),
        makeCtx(),
      );

      expect(result.success).toBe(true);
      expect(
        (firstCallArgs(enqueueSpy)["targetAgentId"] as ObjectID).toString(),
      ).toBe(PROJECT_DEFAULT_RUNNER_ID);
    });

    test("a step missing everything reports the script first, deterministically", async () => {
      const { enqueueSpy } = stubDispatch();

      const result: StepRunResult = await runKubernetesStep(
        makeK8sStep(omit(k8sConfig(), "kubeconfig", "script", "agentId")),
        makeCtx(),
      );

      expect(result.errorMessage).toBe(
        "This kubectl step has no script to run.",
      );
      expect(enqueueSpy).not.toHaveBeenCalled();
    });
  });

  describe("the dispatched job", () => {
    test("enqueues a Kubernetes job with an empty top-level script, the kubeconfig reference and the script", async () => {
      const { enqueueSpy, pollSpy } = stubDispatch();
      pollSpy.mockResolvedValue(makeJob({ output: "restart triggered" }));

      const step: RunbookStep = makeK8sStep();
      const result: StepRunResult = await runKubernetesStep(step, makeCtx());

      expect(result.success).toBe(true);
      expect(result.output).toBe("restart triggered");

      const args: Record<string, unknown> = firstCallArgs(enqueueSpy);
      expect(args["stepType"]).toBe(RunbookStepType.Kubernetes);
      expect(args["script"]).toBe("");
      expect(args["stepId"]).toBe(step.id);
      expect((args["targetAgentId"] as ObjectID).toString()).toBe(AGENT_ID);

      expect(enqueuedPayload(enqueueSpy)).toEqual({
        kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
        script: "kubectl rollout restart deployment/api --namespace production",
      });
      expectNoSecretMaterial(enqueueSpy);
    });

    test("with no kubeconfig, it carries none: the Runner's own access", async () => {
      const { enqueueSpy } = stubDispatch();

      await runKubernetesStep(
        makeK8sStep(omit(k8sConfig(), "kubeconfig")),
        makeCtx(),
      );

      expect(enqueuedPayload(enqueueSpy)).toEqual({
        script: "kubectl rollout restart deployment/api --namespace production",
      });
    });

    test("secrets stashed on the step config never reach the job", async () => {
      const { enqueueSpy } = stubDispatch();

      await runKubernetesStep(
        makeK8sStep(
          k8sConfig({
            kubernetesServiceAccountToken: "eyJhbGciOiJSUzI1NiJ9.token",
            kubernetesCaCertificate: "-----BEGIN CERTIFICATE-----",
            kubernetesApiServerUrl: "https://10.0.0.1:6443",
          }),
        ),
        makeCtx(),
      );

      expect(Object.keys(enqueuedPayload(enqueueSpy)).sort()).toEqual([
        "kubeconfig",
        "script",
      ]);
      expectNoSecretMaterial(enqueueSpy);
    });

    test("the empty top-level script is not mistaken for a no-op step", async () => {
      const { enqueueSpy, pollSpy } = stubDispatch();

      const result: StepRunResult = await runKubernetesStep(
        makeK8sStep(),
        makeCtx(),
      );

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      expect(pollSpy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    test("timeouts flow to the job row and the poll window alike", async () => {
      const { enqueueSpy, pollSpy } = stubDispatch();

      await runKubernetesStep(
        makeK8sStep(
          k8sConfig({ timeoutInMs: 120_000, claimTimeoutInMs: 240_000 }),
        ),
        makeCtx(),
      );

      expect(firstCallArgs(enqueueSpy)["timeoutInMs"]).toBe(120_000);
      expect(firstCallArgs(enqueueSpy)["claimTimeoutInMs"]).toBe(240_000);
      expect(firstCallArgs(pollSpy)["executionTimeoutInMs"]).toBe(120_000);
      expect(firstCallArgs(pollSpy)["claimTimeoutInMs"]).toBe(240_000);
    });

    test("the prior-job lookup is scoped to this execution and this step", async () => {
      const { findSpy } = stubDispatch();

      const step: RunbookStep = makeK8sStep();
      await runKubernetesStep(step, makeCtx());

      const args: Record<string, unknown> = firstCallArgs(findSpy);
      expect((args["runbookExecutionId"] as ObjectID).toString()).toBe(
        new ObjectID("exec1").toString(),
      );
      expect(args["stepId"]).toBe(step.id);
    });
  });

  describe("results and redelivery", () => {
    test("a failed job surfaces the Runner's error message", async () => {
      const { pollSpy } = stubDispatch();
      pollSpy.mockResolvedValue(
        makeJob({
          status: RunnerJobStatus.Failed,
          output: "",
          errorMessage: 'deployments.apps "api" is forbidden',
        }),
      );

      const result: StepRunResult = await runKubernetesStep(
        makeK8sStep(),
        makeCtx(),
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("is forbidden");
    });

    test("a redelivered execution adopts the finished job instead of running the script twice", async () => {
      const { findSpy, enqueueSpy, pollSpy } = stubDispatch();
      findSpy.mockResolvedValue(
        makeJob({
          status: RunnerJobStatus.Succeeded,
          output: "deployment.apps/api scaled",
        }),
      );

      const result: StepRunResult = await runKubernetesStep(
        makeK8sStep(
          k8sConfig({
            script: "kubectl scale deployment/api --replicas=0 -n production",
          }),
        ),
        makeCtx(),
      );

      expect(enqueueSpy).not.toHaveBeenCalled();
      expect(pollSpy).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.output).toContain("scaled");
    });

    test("an in-flight job is re-attached to rather than dispatched a second time", async () => {
      const createdAt: Date = new Date("2026-08-03T10:00:00.000Z");
      const { findSpy, enqueueSpy, pollSpy } = stubDispatch();
      findSpy.mockResolvedValue(
        makeJob({
          _id: "existing-k8s-job",
          status: RunnerJobStatus.Running,
          createdAt,
        }),
      );
      pollSpy.mockResolvedValue(makeJob({ output: "finished later" }));

      const result: StepRunResult = await runKubernetesStep(
        makeK8sStep(),
        makeCtx(),
      );

      expect(enqueueSpy).not.toHaveBeenCalled();
      const pollArgs: Record<string, unknown> = firstCallArgs(pollSpy);
      expect(pollArgs["jobId"]).toEqual(new ObjectID("existing-k8s-job"));
      // The original job's clock, so redelivery cannot buy a fresh window.
      expect(pollArgs["waitStartedAt"]).toBe(createdAt);
      expect(result.output).toBe("finished later");
    });
  });
});
