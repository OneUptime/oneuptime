import RunnerJobService from "../../../Server/Services/RunnerJobService";
import RunnerService from "../../../Server/Services/RunnerService";
import Runner from "../../../Models/DatabaseModels/Runner";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — RunnerJobService.enqueueAiCommand, the chokepoint
 * every AI-composed Bash or SSH command passes (FullAuto inline execution,
 * approved plans, rollbacks), refuses a kubernetes-agent Runner as the
 * target:
 *
 * - that Runner exists to run policy-tiered kubectl with its own
 *   ServiceAccount; the claim path serves it kubectl only, so a Bash or SSH
 *   job aimed at it would sit unclaimed until its deadline after a human
 *   approved it;
 * - its identity is minted with the project's telemetry ingestion key, so
 *   it must never be handed AI-composed shell work or an SSH credential;
 * - the decision keys on the server-owned NAME marker, never on the
 *   posture the Runner rewrites on every heartbeat;
 * - the target must be one of the project's Runners at all.
 *
 * Refusing here (not only in the tool that lists hosts) also stops a plan
 * that was stored before the fix.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CREDENTIAL_ID: string = "55555555-5555-4555-8555-555555555555";

type EnqueueArgs = Parameters<typeof RunnerJobService.enqueueAiCommand>[0];

function args(overrides: Partial<EnqueueArgs> = {}): EnqueueArgs {
  return {
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    autoRemediationSuggestionId: SUGGESTION_ID,
    stepId: "ai-command-1",
    stepType: RunbookStepType.Bash,
    targetAgentId: RUNNER_ID,
    command: "systemctl restart nginx",
    timeoutInMs: 30000,
    ...overrides,
  };
}

function runner(overrides: Partial<Record<string, unknown>> = {}): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    projectId: PROJECT_ID,
    name: "office-runner",
    ...overrides,
  } as unknown as Runner;
}

describe("RunnerJobService.enqueueAiCommand never targets a kubernetes-agent Runner", () => {
  let create: jest.SpyInstance;
  let runnerLookup: jest.SpyInstance;
  let countBy: jest.SpyInstance;

  beforeEach(() => {
    create = jest
      .spyOn(RunnerJobService, "create")
      .mockImplementation(async (data: unknown): Promise<RunnerJob> => {
        return (data as { data: RunnerJob }).data;
      });
    countBy = jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    runnerLookup = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(runner());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses a Bash job for an agent Runner and creates nothing", async () => {
    runnerLookup.mockResolvedValue(
      runner({
        name: "kubernetes-agent/prod-us",
        hostInfo: {
          kubernetes: { inCluster: true, clusterIdentifier: "prod-us" },
        },
      }),
    );

    await expect(RunnerJobService.enqueueAiCommand(args())).rejects.toThrow(
      /in-cluster Runner: it runs kubectl through its cluster only, never Bash commands/,
    );
    expect(create).not.toHaveBeenCalled();
    // Refused before the hourly brake spends a count on it.
    expect(countBy).not.toHaveBeenCalled();
  });

  it("refuses an SSH job for an agent Runner too", async () => {
    runnerLookup.mockResolvedValue(
      runner({ name: "kubernetes-agent/prod-us" }),
    );

    await expect(
      RunnerJobService.enqueueAiCommand(
        args({
          stepType: RunbookStepType.SSH,
          credentialId: CREDENTIAL_ID,
        }),
      ),
    ).rejects.toThrow(/never SSH commands/);
    expect(create).not.toHaveBeenCalled();
  });

  it("keys on the server-owned name: an agent row whose heartbeat dropped its posture is still refused", async () => {
    runnerLookup.mockResolvedValue(
      runner({ name: "kubernetes-agent/prod-us", hostInfo: {} }),
    );

    await expect(RunnerJobService.enqueueAiCommand(args())).rejects.toThrow(
      BadDataException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a target Runner that is not in the project", async () => {
    runnerLookup.mockResolvedValue(null);

    await expect(RunnerJobService.enqueueAiCommand(args())).rejects.toThrow(
      /Runner was not found or it does not belong to this project/,
    );
    expect(create).not.toHaveBeenCalled();

    const query: Record<string, unknown> = (
      runnerLookup.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["_id"]).toBe(RUNNER_ID.toString());
    expect(query["projectId"]).toBe(PROJECT_ID);
  });

  it("negative control: an ordinary Runner in a pod (in-cluster posture, own name) still gets its Bash job", async () => {
    runnerLookup.mockResolvedValue(
      runner({
        name: "pod-runner",
        hostInfo: {
          kubernetes: { inCluster: true, clusterIdentifier: "prod-us" },
        },
      }),
    );

    const job: RunnerJob = await RunnerJobService.enqueueAiCommand(args());

    expect(create).toHaveBeenCalledTimes(1);
    expect(job.stepType).toBe(RunbookStepType.Bash);
    expect(job.script).toBe("systemctl restart nginx");
  });

  it("negative control: an ordinary Runner gets its SSH job with the credential reference", async () => {
    const job: RunnerJob = await RunnerJobService.enqueueAiCommand(
      args({ stepType: RunbookStepType.SSH, credentialId: CREDENTIAL_ID }),
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(job.payload).toEqual({
      credentialId: CREDENTIAL_ID,
      command: "systemctl restart nginx",
    });
  });

  it("a Kubectl job is still turned away first, towards its own chokepoint", async () => {
    await expect(
      RunnerJobService.enqueueAiCommand(
        args({
          stepType: RunbookStepType.Kubectl,
          command: "kubectl get pods",
        }),
      ),
    ).rejects.toThrow(/enqueueAiKubectlCommand/);
    expect(runnerLookup).not.toHaveBeenCalled();
  });
});
