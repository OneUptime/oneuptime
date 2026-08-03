import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunbookAgentJobStatus from "Common/Types/Runbook/RunbookAgentJobStatus";
import RunbookAgentJobService from "Common/Server/Services/RunbookAgentJobService";
import RunbookAgentJob from "Common/Models/DatabaseModels/RunbookAgentJob";
import logger from "Common/Server/Utils/Logger";
import {
  KubernetesAction,
  KubernetesStepConfig,
  KubernetesWorkloadKind,
  RunbookStep,
  SSHStepConfig,
} from "Common/Types/Runbook/RunbookStep";
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
 * SSH and Kubernetes steps act on the customer's own infrastructure, so the
 * Worker never executes them: it builds a payload and hands it to a Runner,
 * which resolves the credential at claim time. Everything below is about that
 * payload — what has to be in it, what must never be in it, and which
 * misconfigurations have to be caught before a job row is ever created.
 *
 * Step configs are untyped JSON at rest, so the fixtures here are raw objects
 * rather than typed literals: a field can be genuinely absent, which is the
 * shape the validation actually has to survive.
 */
type RawConfig = Record<string, unknown>;

const AGENT_ID: string = new ObjectID("runner-1").toString();

function makeCtx(): StepExecutionContext {
  return {
    projectId: new ObjectID("proj1"),
    runbookExecutionId: new ObjectID("exec1"),
  };
}

function omit(config: RawConfig, ...keys: Array<string>): RawConfig {
  const copy: RawConfig = { ...config };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

function sshConfig(overrides: RawConfig = {}): RawConfig {
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

function k8sConfig(overrides: RawConfig = {}): RawConfig {
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

function makeJob(
  overrides: Partial<Record<string, unknown>> = {},
): RunbookAgentJob {
  return {
    _id: "job1",
    status: RunbookAgentJobStatus.Succeeded,
    output: "job output",
    ...overrides,
  } as unknown as RunbookAgentJob;
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
      .spyOn(RunbookAgentJobService, "findLatestJobForStep")
      .mockResolvedValue(null),
    enqueueSpy: jest
      .spyOn(RunbookAgentJobService, "enqueue")
      .mockResolvedValue(makeJob()),
    pollSpy: jest
      .spyOn(RunbookAgentJobService, "pollUntilTerminal")
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
 * Strings that must never appear in a dispatched job. The credential's secret
 * columns are write-only and decrypted exactly once, at claim time, inside
 * Credentials.resolveForJob — an agent job row is not a place a private key
 * or a service-account token may be persisted.
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

describe("runSshStep", () => {
  describe("misconfiguration is caught before a job is created", () => {
    test.each([
      ["the field is absent", omit(sshConfig(), "credentialId")],
      ["the field is an empty string", sshConfig({ credentialId: "" })],
    ])(
      "a step without a credential fails and never dispatches — %s",
      async (_label: string, config: RawConfig) => {
        const { findSpy, enqueueSpy, pollSpy } = stubDispatch();

        const result: StepRunResult = await runSshStep(
          makeSshStep(config),
          makeCtx(),
        );

        expect(result.success).toBe(false);
        expect(result.output).toBe("");
        expect(result.errorMessage).toContain("missing a credential");
        // The message has to say where to go; "invalid config" helps nobody.
        expect(result.errorMessage).toContain("Credentials");
        expect(enqueueSpy).not.toHaveBeenCalled();
        // Not even a lookup: the step cannot possibly run.
        expect(findSpy).not.toHaveBeenCalled();
        expect(pollSpy).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["the field is absent", omit(sshConfig(), "command")],
      ["the field is an empty string", sshConfig({ command: "" })],
    ])(
      "a step without a command fails and never dispatches — %s",
      async (_label: string, config: RawConfig) => {
        const { findSpy, enqueueSpy, pollSpy } = stubDispatch();

        const result: StepRunResult = await runSshStep(
          makeSshStep(config),
          makeCtx(),
        );

        expect(result.success).toBe(false);
        expect(result.output).toBe("");
        expect(result.errorMessage).toContain("no command to run");
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
      "a step without a Runner fails and never dispatches — %s",
      async (_label: string, config: RawConfig) => {
        const { findSpy, enqueueSpy, pollSpy } = stubDispatch();

        const result: StepRunResult = await runSshStep(
          makeSshStep(config),
          makeCtx(),
        );

        expect(result.success).toBe(false);
        expect(result.output).toBe("");
        expect(result.errorMessage).toContain("missing a Runner");
        expect(enqueueSpy).not.toHaveBeenCalled();
        expect(findSpy).not.toHaveBeenCalled();
        expect(pollSpy).not.toHaveBeenCalled();
      },
    );

    test("a step missing everything reports the credential first, deterministically", async () => {
      const { enqueueSpy } = stubDispatch();

      const result: StepRunResult = await runSshStep(
        makeSshStep(omit(sshConfig(), "credentialId", "command", "agentId")),
        makeCtx(),
      );

      expect(result.errorMessage).toContain("missing a credential");
      expect(enqueueSpy).not.toHaveBeenCalled();
    });
  });

  describe("the dispatched job", () => {
    test("enqueues an SSH job with an empty script and a payload carrying only the credential id and the command", async () => {
      const { enqueueSpy, pollSpy } = stubDispatch();
      pollSpy.mockResolvedValue(makeJob({ output: "nginx restarted" }));

      const step: RunbookStep = makeSshStep();
      const result: StepRunResult = await runSshStep(step, makeCtx());

      expect(result.success).toBe(true);
      expect(result.output).toBe("nginx restarted");

      const args: Record<string, unknown> = firstCallArgs(enqueueSpy);
      expect(args["stepType"]).toBe(RunbookStepType.SSH);
      // An SSH step has no script: the instruction lives in the payload.
      expect(args["script"]).toBe("");
      expect(args["stepId"]).toBe(step.id);
      expect((args["targetAgentId"] as ObjectID).toString()).toBe(AGENT_ID);

      /*
       * Exact keys, not objectContaining: the assertion that matters here is
       * the absence of anything else. A payload that grew a resolved host,
       * user or key would still pass a containment check.
       */
      const payload: Record<string, unknown> = enqueuedPayload(enqueueSpy);
      expect(Object.keys(payload).sort()).toEqual(["command", "credentialId"]);
      expect(payload).toEqual({
        credentialId: "cred-ssh-1",
        command: "systemctl restart nginx",
      });
      expectNoSecretMaterial(enqueueSpy);
    });

    test("a credential is referenced by id only — secrets stashed on the step config never reach the job", async () => {
      /*
       * The executor picks fields out of the config explicitly rather than
       * spreading it. That is what stops a stray key — pasted into the step
       * by an older UI, a template or an API caller — from being persisted in
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

      const payload: Record<string, unknown> = enqueuedPayload(enqueueSpy);
      expect(Object.keys(payload).sort()).toEqual(["command", "credentialId"]);
      expectNoSecretMaterial(enqueueSpy);
    });

    test("the empty script is not mistaken for a no-op step", async () => {
      /*
       * The dispatcher short-circuits script steps with nothing to run. SSH
       * steps always have an empty script, so if that guard did not exempt
       * payload-carrying steps, every SSH step in production would silently
       * succeed without ever touching the host.
       */
      const { enqueueSpy, pollSpy } = stubDispatch();

      const result: StepRunResult = await runSshStep(makeSshStep(), makeCtx());

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      expect(pollSpy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    test("the command is forwarded verbatim, whatever it contains", async () => {
      const { enqueueSpy } = stubDispatch();
      const command: string =
        "bash -lc 'pg_dump -Fc app | gzip > /backup/$(date +%F).gz' # \"quotes\" & $vars";

      await runSshStep(makeSshStep(sshConfig({ command })), makeCtx());

      expect(enqueuedPayload(enqueueSpy)["command"]).toBe(command);
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
          status: RunbookAgentJobStatus.Failed,
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

    test("a redelivered execution adopts the finished job instead of running the command twice", async () => {
      /*
       * The whole point of the lookup: `systemctl restart` is survivable
       * twice, `rm -rf` on a stale directory is not. A step that already
       * produced a terminal job row has already run.
       */
      const { findSpy, enqueueSpy, pollSpy } = stubDispatch();
      findSpy.mockResolvedValue(
        makeJob({
          status: RunbookAgentJobStatus.Succeeded,
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
      ["the field is absent", omit(k8sConfig(), "credentialId")],
      ["the field is an empty string", k8sConfig({ credentialId: "" })],
    ])(
      "a step without a credential fails and never dispatches — %s",
      async (_label: string, config: RawConfig) => {
        const { findSpy, enqueueSpy, pollSpy } = stubDispatch();

        const result: StepRunResult = await runKubernetesStep(
          makeK8sStep(config),
          makeCtx(),
        );

        expect(result.success).toBe(false);
        expect(result.output).toBe("");
        expect(result.errorMessage).toContain("missing a credential");
        expect(result.errorMessage).toContain("Credentials");
        expect(enqueueSpy).not.toHaveBeenCalled();
        expect(findSpy).not.toHaveBeenCalled();
        expect(pollSpy).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["namespace absent", omit(k8sConfig(), "namespace")],
      ["namespace empty", k8sConfig({ namespace: "" })],
      ["workload name absent", omit(k8sConfig(), "workloadName")],
      ["workload name empty", k8sConfig({ workloadName: "" })],
      ["both absent", omit(k8sConfig(), "namespace", "workloadName")],
    ])(
      "a step without a target fails and never dispatches — %s",
      async (_label: string, config: RawConfig) => {
        const { findSpy, enqueueSpy, pollSpy } = stubDispatch();

        const result: StepRunResult = await runKubernetesStep(
          makeK8sStep(config),
          makeCtx(),
        );

        expect(result.success).toBe(false);
        expect(result.output).toBe("");
        expect(result.errorMessage).toBe(
          "Kubernetes step needs a namespace and a workload name.",
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
      "a step without a Runner fails and never dispatches — %s",
      async (_label: string, config: RawConfig) => {
        const { enqueueSpy, pollSpy } = stubDispatch();

        const result: StepRunResult = await runKubernetesStep(
          makeK8sStep(config),
          makeCtx(),
        );

        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain("missing a Runner");
        expect(enqueueSpy).not.toHaveBeenCalled();
        expect(pollSpy).not.toHaveBeenCalled();
      },
    );

    test("a step missing everything reports the credential first, deterministically", async () => {
      const { enqueueSpy } = stubDispatch();

      const result: StepRunResult = await runKubernetesStep(
        makeK8sStep(
          omit(
            k8sConfig({ action: KubernetesAction.ScaleWorkload }),
            "credentialId",
            "namespace",
            "workloadName",
            "agentId",
          ),
        ),
        makeCtx(),
      );

      expect(result.errorMessage).toContain("missing a credential");
      expect(enqueueSpy).not.toHaveBeenCalled();
    });
  });

  describe("ScaleWorkload replica count", () => {
    test.each([
      ["replicas absent", omit(k8sConfig(), "replicas")],
      ["replicas explicitly null", k8sConfig({ replicas: null })],
      ["replicas explicitly undefined", k8sConfig({ replicas: undefined })],
    ])(
      "a scale step with no replica count fails and never dispatches — %s",
      async (_label: string, overrides: RawConfig) => {
        /*
         * There is no safe default here in either direction. Guessing 1 would
         * scale a 40-replica fleet down to one pod during an incident;
         * guessing "leave it alone" would make the step a silent no-op the
         * author believed had run. So it has to be an error, and the message
         * has to name the missing thing.
         */
        const { findSpy, enqueueSpy, pollSpy } = stubDispatch();

        const result: StepRunResult = await runKubernetesStep(
          makeK8sStep({
            ...overrides,
            action: KubernetesAction.ScaleWorkload,
          }),
          makeCtx(),
        );

        expect(result.success).toBe(false);
        expect(result.output).toBe("");
        expect(result.errorMessage).toBe("Scale step needs a replica count.");
        expect(result.errorMessage).toMatch(/replica/i);
        expect(enqueueSpy).not.toHaveBeenCalled();
        expect(findSpy).not.toHaveBeenCalled();
        expect(pollSpy).not.toHaveBeenCalled();
      },
    );

    test("scaling to zero is allowed and is dispatched with replicas 0", async () => {
      /*
       * The boundary that a naive `if (!config.replicas)` check would swallow.
       * Draining a workload to zero — a poison-pill consumer, a runaway job
       * processor — is one of the remediations this step type exists for, and
       * turning it into "needs a replica count" would block it entirely.
       */
      const { enqueueSpy } = stubDispatch();

      const result: StepRunResult = await runKubernetesStep(
        makeK8sStep(
          k8sConfig({
            action: KubernetesAction.ScaleWorkload,
            replicas: 0,
          }),
        ),
        makeCtx(),
      );

      expect(result.success).toBe(true);
      expect(enqueueSpy).toHaveBeenCalledTimes(1);

      const payload: Record<string, unknown> = enqueuedPayload(enqueueSpy);
      // Present as a real 0, not dropped and not coerced to something truthy.
      expect(Object.keys(payload)).toContain("replicas");
      expect(payload["replicas"]).toBe(0);
      expect(payload["action"]).toBe(KubernetesAction.ScaleWorkload);
    });

    test.each([1, 3, 40])(
      "scaling to %s replicas forwards the exact count",
      async (replicas: number) => {
        const { enqueueSpy } = stubDispatch();

        const result: StepRunResult = await runKubernetesStep(
          makeK8sStep(
            k8sConfig({ action: KubernetesAction.ScaleWorkload, replicas }),
          ),
          makeCtx(),
        );

        expect(result.success).toBe(true);
        expect(enqueuedPayload(enqueueSpy)["replicas"]).toBe(replicas);
      },
    );

    test("a scale payload carries exactly the keys the Runner needs", async () => {
      const { enqueueSpy } = stubDispatch();

      await runKubernetesStep(
        makeK8sStep(
          k8sConfig({
            action: KubernetesAction.ScaleWorkload,
            workloadKind: KubernetesWorkloadKind.StatefulSet,
            replicas: 2,
          }),
        ),
        makeCtx(),
      );

      expect(Object.keys(enqueuedPayload(enqueueSpy)).sort()).toEqual([
        "action",
        "credentialId",
        "namespace",
        "replicas",
        "workloadKind",
        "workloadName",
      ]);
    });

    test("a nonsensical replica count is forwarded rather than silently corrected", async () => {
      /*
       * Documenting where the check lives: the Worker does not sanitise the
       * number, the Runner rejects anything non-numeric or negative before it
       * ever reaches the API server (Runner/Services/KubernetesExecutor.ts).
       * Clamping here would hide a misconfiguration behind a scale that
       * "worked" but did something other than what the step said.
       */
      const { enqueueSpy } = stubDispatch();

      await runKubernetesStep(
        makeK8sStep(
          k8sConfig({ action: KubernetesAction.ScaleWorkload, replicas: -1 }),
        ),
        makeCtx(),
      );

      expect(enqueuedPayload(enqueueSpy)["replicas"]).toBe(-1);
    });
  });

  describe("the dispatched job", () => {
    test("a restart enqueues a Kubernetes job with an empty script and no replicas key", async () => {
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

      const payload: Record<string, unknown> = enqueuedPayload(enqueueSpy);
      expect(payload).toEqual({
        credentialId: "cred-k8s-1",
        action: KubernetesAction.RestartWorkload,
        workloadKind: KubernetesWorkloadKind.Deployment,
        namespace: "production",
        workloadName: "api",
      });
      expect(Object.keys(payload).sort()).toEqual([
        "action",
        "credentialId",
        "namespace",
        "workloadKind",
        "workloadName",
      ]);
      /*
       * Not merely undefined: a `replicas` key on a restart would be a scale
       * instruction riding along with it.
       */
      expect("replicas" in payload).toBe(false);
      expectNoSecretMaterial(enqueueSpy);
    });

    test("a restart needs no replica count", async () => {
      const { enqueueSpy } = stubDispatch();

      const result: StepRunResult = await runKubernetesStep(
        makeK8sStep(
          omit(
            k8sConfig({ action: KubernetesAction.RestartWorkload }),
            "replicas",
          ),
        ),
        makeCtx(),
      );

      expect(result.success).toBe(true);
      expect(enqueueSpy).toHaveBeenCalledTimes(1);
    });

    test.each([
      KubernetesWorkloadKind.Deployment,
      KubernetesWorkloadKind.StatefulSet,
      KubernetesWorkloadKind.DaemonSet,
    ])("the %s workload kind is forwarded verbatim", async (kind: string) => {
      const { enqueueSpy } = stubDispatch();

      await runKubernetesStep(
        makeK8sStep(k8sConfig({ workloadKind: kind })),
        makeCtx(),
      );

      expect(enqueuedPayload(enqueueSpy)["workloadKind"]).toBe(kind);
    });

    test("the namespace and workload name are forwarded verbatim", async () => {
      const { enqueueSpy } = stubDispatch();

      await runKubernetesStep(
        makeK8sStep(
          k8sConfig({ namespace: "team-payments", workloadName: "ledger-api" }),
        ),
        makeCtx(),
      );

      const payload: Record<string, unknown> = enqueuedPayload(enqueueSpy);
      expect(payload["namespace"]).toBe("team-payments");
      expect(payload["workloadName"]).toBe("ledger-api");
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
        "action",
        "credentialId",
        "namespace",
        "workloadKind",
        "workloadName",
      ]);
      expectNoSecretMaterial(enqueueSpy);
    });

    test("the empty script is not mistaken for a no-op step", async () => {
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
          status: RunbookAgentJobStatus.Failed,
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

    test("a redelivered execution adopts the finished job instead of scaling twice", async () => {
      const { findSpy, enqueueSpy, pollSpy } = stubDispatch();
      findSpy.mockResolvedValue(
        makeJob({
          status: RunbookAgentJobStatus.Succeeded,
          output: "Scaled deployment production/api to 0 replica(s).",
        }),
      );

      const result: StepRunResult = await runKubernetesStep(
        makeK8sStep(
          k8sConfig({ action: KubernetesAction.ScaleWorkload, replicas: 0 }),
        ),
        makeCtx(),
      );

      expect(enqueueSpy).not.toHaveBeenCalled();
      expect(pollSpy).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.output).toContain("to 0 replica(s)");
    });

    test("an in-flight job is re-attached to rather than dispatched a second time", async () => {
      const createdAt: Date = new Date("2026-08-03T10:00:00.000Z");
      const { findSpy, enqueueSpy, pollSpy } = stubDispatch();
      findSpy.mockResolvedValue(
        makeJob({
          _id: "existing-k8s-job",
          status: RunbookAgentJobStatus.Running,
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
