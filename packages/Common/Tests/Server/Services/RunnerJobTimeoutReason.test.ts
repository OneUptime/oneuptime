import RunnerJobService, {
  describeRunnerJobTimeout,
} from "../../../Server/Services/RunnerJobService";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — IP-3: the reason a timed-out job carries is worded
 * for what the job is, ON THE ROW, so every reader agrees: the access test,
 * the AI page's command history ("Commands OneUptime AI ran on this
 * cluster"), an investigation and a remediation run all read
 * RunnerJob.errorMessage.
 *
 * - an AI-composed kubectl job says whether nothing ran (no Runner picked it
 *   up — including a job still Pending when the overall window ran out) or
 *   what it did is unknown (the Runner went silent, or never reported in
 *   time), in kubectl's words, never the runbook agent's "try running the
 *   runbook again";
 * - a remediation command that may have changed the cluster says to check
 *   it before running a change again;
 * - a runbook step keeps its runbook wording, unchanged.
 */

const JOB_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CLAIM_TIMEOUT_MS: number = 60_000;
const EXECUTION_TIMEOUT_MS: number = 30_000;

describe("RunnerJobService.pollUntilTerminal words a timeout for the job it is", () => {
  let row: Record<string, unknown>;
  let timeoutSpy: jest.SpyInstance;

  beforeEach(() => {
    row = {};
    jest
      .spyOn(RunnerJobService, "findOneById")
      .mockImplementation(async (): Promise<RunnerJob> => {
        return row as unknown as RunnerJob;
      });
    timeoutSpy = jest
      .spyOn(RunnerJobService, "timeoutJob")
      .mockImplementation(
        async (data: { reason: string }): Promise<RunnerJob> => {
          return {
            status: RunnerJobStatus.TimedOut,
            errorMessage: data.reason,
          } as unknown as RunnerJob;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function reasonFor(data: {
    status: RunnerJobStatus;
    origin?: RunnerJobOrigin | undefined;
    stepType: RunbookStepType;
    // Which deadline has passed.
    elapsed: "claim" | "lease" | "overall";
  }): Promise<string> {
    const past: Date = new Date(Date.now() - 1000);
    const future: Date = new Date(Date.now() + 60 * 60 * 1000);

    row = {
      status: data.status,
      origin: data.origin,
      stepType: data.stepType,
      claimDeadlineAt: data.elapsed === "claim" ? past : future,
      leaseExpiresAt: data.elapsed === "lease" ? past : future,
    };

    await RunnerJobService.pollUntilTerminal({
      jobId: JOB_ID,
      claimTimeoutInMs: CLAIM_TIMEOUT_MS,
      executionTimeoutInMs: EXECUTION_TIMEOUT_MS,
      /*
       * For the overall window, a wait that started long ago: the job is
       * past it on the first poll.
       */
      waitStartedAt:
        data.elapsed === "overall"
          ? new Date(Date.now() - 24 * 60 * 60 * 1000)
          : undefined,
    });

    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    const reason: string = (timeoutSpy.mock.calls[0]![0] as { reason: string })
      .reason;
    timeoutSpy.mockClear();
    return reason;
  }

  it("an investigation kubectl job nobody picked up: nothing was run, in kubectl's words", async () => {
    const reason: string = await reasonFor({
      status: RunnerJobStatus.Pending,
      origin: RunnerJobOrigin.AiInvestigation,
      stepType: RunbookStepType.Kubectl,
      elapsed: "claim",
    });

    expect(reason).toContain("kubectl command");
    expect(reason).toContain("within 60s");
    expect(reason).toContain("Nothing was run on the cluster");
    expect(reason).not.toMatch(/runbook/i);
    expect(reason).not.toMatch(/\bstep\b/i);
  });

  it("a remediation kubectl job whose Runner went silent: unknown, and check before changing again", async () => {
    const reason: string = await reasonFor({
      status: RunnerJobStatus.Running,
      origin: RunnerJobOrigin.AiRemediation,
      stepType: RunbookStepType.Kubectl,
      elapsed: "lease",
    });

    expect(reason).toContain("stopped responding");
    expect(reason).toContain("What the command did is unknown");
    expect(reason).toContain("Check the cluster before running a change again");
    expect(reason).not.toMatch(/try running the runbook again/i);
    expect(reason).not.toMatch(/runbook/i);
  });

  it("an investigation job past the overall window: unknown, but no 'check before a change' (it was a read)", async () => {
    const reason: string = await reasonFor({
      status: RunnerJobStatus.Claimed,
      origin: RunnerJobOrigin.AiInvestigation,
      stepType: RunbookStepType.Kubectl,
      elapsed: "overall",
    });

    expect(reason).toContain("did not report a result");
    expect(reason).toContain("30s timeout");
    expect(reason).toContain("What the command did is unknown");
    expect(reason).not.toContain("Check the cluster");
  });

  it("a kubectl job still Pending when the overall window ran out was never picked up", async () => {
    const reason: string = await reasonFor({
      status: RunnerJobStatus.Pending,
      origin: RunnerJobOrigin.AiRemediation,
      stepType: RunbookStepType.Kubectl,
      elapsed: "overall",
    });

    expect(reason).toContain("Nothing was run on the cluster");
    expect(reason).not.toContain("unknown");
  });

  it("negative control: a runbook step keeps the runbook wording for every kind of timeout", async () => {
    expect(
      await reasonFor({
        status: RunnerJobStatus.Pending,
        stepType: RunbookStepType.Bash,
        elapsed: "claim",
      }),
    ).toBe(
      "No runbook agent picked up this step before the wait window expired. The agent may be offline — check that it is running and reachable, then try again.",
    );
    expect(
      await reasonFor({
        status: RunnerJobStatus.Running,
        origin: RunnerJobOrigin.Runbook,
        stepType: RunbookStepType.Bash,
        elapsed: "lease",
      }),
    ).toBe(
      "The runbook agent stopped responding while this step was running. The agent may have crashed or lost its network connection — check that it is still online, then try running the runbook again.",
    );
    expect(
      await reasonFor({
        status: RunnerJobStatus.Pending,
        origin: RunnerJobOrigin.Runbook,
        stepType: RunbookStepType.Bash,
        elapsed: "overall",
      }),
    ).toBe(
      "This step ran longer than the allowed execution window. Increase the timeout on the step or make the script complete faster.",
    );
  });

  it("negative control: an AI-composed Bash command is not a kubectl job", () => {
    expect(
      describeRunnerJobTimeout({
        kind: "unclaimed",
        origin: RunnerJobOrigin.AiRemediation,
        stepType: RunbookStepType.Bash,
        claimTimeoutInMs: CLAIM_TIMEOUT_MS,
        executionTimeoutInMs: EXECUTION_TIMEOUT_MS,
      }),
    ).toContain("No runbook agent picked up this step");
  });
});

describe("RunnerJobService.timeoutJob hands back whether any Runner claimed the job", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("selects claimedAt, startedAt and assignedAgentId on the row it returns", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(RunnerJobService, "findOneById")
      .mockResolvedValue({
        status: RunnerJobStatus.TimedOut,
      } as unknown as RunnerJob);
    // The UPDATE itself needs a database; only the read-back is under test.
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: async (): Promise<Array<unknown>> => {
        return [];
      },
    } as unknown as ReturnType<typeof PostgresAppInstance.getDataSource>);

    await RunnerJobService.timeoutJob({ jobId: JOB_ID, reason: "x" });

    const select: Record<string, unknown> = (
      findOneById.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["claimedAt"]).toBe(true);
    expect(select["startedAt"]).toBe(true);
    expect(select["assignedAgentId"]).toBe(true);
  });
});
