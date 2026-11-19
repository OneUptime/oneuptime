import AiActivityFailedCommands, {
  AiActivityFailedCommandsRead,
  FAILED_COMMAND_SELECT,
  FAILED_COMMAND_TEXT_SELECT,
} from "../../../../../Server/Utils/AI/ActivityInsights/AiActivityFailedCommands";
import RunnerJobService from "../../../../../Server/Services/RunnerJobService";
import RunnerJob from "../../../../../Models/DatabaseModels/RunnerJob";
import {
  AI_ACTIVITY_INSIGHTS_MAX_FAILED_COMMANDS,
  AiActivityFailedCommand,
  AiActivitySubject,
} from "../../../../../Types/AI/AiActivityInsights";
import {
  INCIDENT_ALERT_AI_LOGS_COMMAND_MAX_LENGTH,
  INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH,
} from "../../../../../Types/AI/IncidentAlertAiLogs";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import RunnerJobOrigin from "../../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../../Types/Runbook/RunnerJobStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AiActivityFailedCommands (#9749): what an AI Insights page's "N failed"
 * says, and opens - the failed commands of the page's count that the reader
 * may read as Runner jobs, newest first, each with how it ended and what it
 * was for; what it ran only for a reader who may read that.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "97490000-0000-4000-8000-000000000001",
);
const RUN_ID: ObjectID = new ObjectID("97490000-0000-4000-8000-0000000000a1");
const FIX_ID: ObjectID = new ObjectID("97490000-0000-4000-8000-0000000000b1");

const READER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("97490000-0000-4000-8000-0000000000c1"),
};

const SUBJECT: AiActivitySubject = {
  kind: "incident",
  id: "97490000-0000-4000-8000-0000000000d1",
  title: "Checkout is down",
  numberWithPrefix: "INC-42",
};

function jobId(index: number): ObjectID {
  return new ObjectID(
    `97490000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

function job(index: number, overrides: Partial<RunnerJob> = {}): RunnerJob {
  const value: RunnerJob = new RunnerJob();
  value.id = jobId(index);
  value.status = RunnerJobStatus.Failed;
  value.origin = RunnerJobOrigin.AiInvestigation;
  value.aiRunId = RUN_ID;
  value.createdAt = new Date("2026-11-18T10:00:00.000Z");
  value.completedAt = new Date("2026-11-18T10:00:05.000Z");
  value.payload = { displayCommand: `kubectl get pods -n shop # ${index}` };
  value.exitCode = 1;
  value.errorMessage = "Error from server (Forbidden): pods is forbidden";
  Object.assign(value, overrides);
  return value;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AiActivityFailedCommands.getFailedJobIds", () => {
  test("the failed ones of the commands counted, each once, nothing without an id", () => {
    const failed: RunnerJob = job(1);
    const withoutId: RunnerJob = new RunnerJob();
    withoutId.status = RunnerJobStatus.Failed;

    const ids: Array<ObjectID> = AiActivityFailedCommands.getFailedJobIds([
      failed,
      job(2, { status: RunnerJobStatus.Succeeded }),
      job(3, { status: RunnerJobStatus.TimedOut }),
      failed,
      withoutId,
      job(5),
    ]);

    expect(
      ids.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([jobId(1).toString(), jobId(5).toString()]);
  });

  test("none counted, none failed", () => {
    expect(AiActivityFailedCommands.getFailedJobIds([])).toEqual([]);
  });
});

describe("AiActivityFailedCommands.toFailedCommand", () => {
  test("what it ran, how it ended, why, when it ended, and what for", () => {
    expect(
      AiActivityFailedCommands.toFailedCommand({
        job: job(1),
        subject: SUBJECT,
      }),
    ).toEqual({
      id: jobId(1).toString(),
      at: "2026-11-18T10:00:05.000Z",
      command: "kubectl get pods -n shop # 1",
      exitCode: 1,
      errorMessage: "Error from server (Forbidden): pods is forbidden",
      origin: RunnerJobOrigin.AiInvestigation,
      subject: SUBJECT,
    });
  });

  test("one that never said when it ended is dated when it was sent", () => {
    expect(
      AiActivityFailedCommands.toFailedCommand({
        job: job(1, { completedAt: undefined }),
      }).at,
    ).toBe("2026-11-18T10:00:00.000Z");
  });

  test("an exit code of 0 is still said: the agent failed it for another reason", () => {
    expect(
      AiActivityFailedCommands.toFailedCommand({ job: job(1, { exitCode: 0 }) })
        .exitCode,
    ).toBe(0);
  });

  test("says nothing it does not know", () => {
    const bare: AiActivityFailedCommand =
      AiActivityFailedCommands.toFailedCommand({
        job: job(1, {
          payload: undefined,
          exitCode: undefined,
          errorMessage: "   ",
          origin: undefined,
        }),
      });

    expect(Object.keys(bare).sort()).toEqual(["at", "id"]);
  });

  test("a Bash command is its script; a long one, and a long error, are cut as AI Logs cut them", () => {
    const failed: AiActivityFailedCommand =
      AiActivityFailedCommands.toFailedCommand({
        job: job(1, {
          payload: undefined,
          script: `echo ${"x".repeat(INCIDENT_ALERT_AI_LOGS_COMMAND_MAX_LENGTH)}`,
          errorMessage: "y".repeat(INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH * 2),
        }),
      });

    expect(failed.command!.startsWith("echo x")).toBe(true);
    expect(failed.command!.length).toBe(
      INCIDENT_ALERT_AI_LOGS_COMMAND_MAX_LENGTH,
    );
    expect(failed.command!.endsWith("…")).toBe(true);
    expect(failed.errorMessage!.length).toBe(
      INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH,
    );
  });
});

describe("AiActivityFailedCommands.read", () => {
  let find: jest.SpiedFunction<typeof RunnerJobService.findBy>;
  let count: jest.SpiedFunction<typeof RunnerJobService.countBy>;
  // What the reader may read: the jobs, and what each ran.
  let readable: Array<RunnerJob>;
  let canReadJobs: boolean;
  let canReadCommands: boolean;

  beforeEach(() => {
    readable = [job(1), job(2)];
    canReadJobs = true;
    canReadCommands = true;

    find = jest
      .spyOn(RunnerJobService, "findBy")
      .mockImplementation((async (args: {
        select: Record<string, unknown>;
      }): Promise<Array<RunnerJob>> => {
        if (!canReadJobs) {
          throw new NotAuthorizedException("You may not read Runner jobs.");
        }

        if (
          !canReadCommands &&
          (args.select["payload"] || args.select["script"])
        ) {
          throw new NotAuthorizedException(
            "You do not have permissions to select on - payload.",
          );
        }

        return readable.map((value: RunnerJob): RunnerJob => {
          const copy: RunnerJob = job(0);
          Object.assign(copy, value);

          if (!args.select["payload"]) {
            copy.payload = undefined;
          }

          return copy;
        });
      }) as never);
    count = jest
      .spyOn(RunnerJobService, "countBy")
      .mockImplementation((async (): Promise<PositiveNumber> => {
        if (!canReadJobs) {
          throw new NotAuthorizedException("You may not read Runner jobs.");
        }

        return new PositiveNumber(readable.length + 70);
      }) as never);
  });

  async function read(
    jobIds: Array<ObjectID> = [jobId(1), jobId(2), jobId(3)],
  ): Promise<AiActivityFailedCommandsRead> {
    return await AiActivityFailedCommands.read({
      projectId: PROJECT_ID,
      jobIds,
      props: READER,
      getSubject: (value: RunnerJob): AiActivitySubject | undefined => {
        return value.aiRunId?.toString() === RUN_ID.toString()
          ? SUBJECT
          : undefined;
      },
    });
  }

  test("reads, as the reader, the failed ones of the ids counted: how many, and the newest", async () => {
    const result: AiActivityFailedCommandsRead = await read();

    expect(result.count).toBe(72);
    expect(
      result.commands.map((command: AiActivityFailedCommand): string => {
        return command.id;
      }),
    ).toEqual([jobId(1).toString(), jobId(2).toString()]);
    expect(result.commands[0]!.subject).toEqual(SUBJECT);
    expect(result.commands[0]!.command).toBe("kubectl get pods -n shop # 1");

    for (const call of [find.mock.calls[0]![0], count.mock.calls[0]![0]]) {
      const args: {
        query: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      } = call as never;

      expect(args.props).toBe(READER);
      expect(args.query["projectId"]).toBe(PROJECT_ID);
      expect(args.query["status"]).toBe(RunnerJobStatus.Failed);
      expect(JSON.stringify(args.query["_id"])).toContain(jobId(3).toString());
    }

    const findArgs: {
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    } = find.mock.calls[0]![0] as never;

    expect(findArgs.select).toEqual({
      ...FAILED_COMMAND_SELECT,
      ...FAILED_COMMAND_TEXT_SELECT,
    });
    // Never what it printed.
    expect(findArgs.select["output"]).toBeUndefined();
    expect(findArgs.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(findArgs.limit).toBe(AI_ACTIVITY_INSIGHTS_MAX_FAILED_COMMANDS);
  });

  test("a reader who may read the job, not what it ran, reads it without that", async () => {
    canReadCommands = false;

    const result: AiActivityFailedCommandsRead = await read();

    expect(result.count).toBe(72);
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]!.command).toBeUndefined();
    expect(result.commands[0]!.exitCode).toBe(1);
    expect(result.commands[0]!.errorMessage).toContain("Forbidden");
    // Asked once with what it ran, then without it.
    expect(
      (find.mock.calls[1]![0] as { select: Record<string, unknown> }).select,
    ).toEqual(FAILED_COMMAND_SELECT);
  });

  test("a role that may not read Runner jobs reads none, and counts none", async () => {
    canReadJobs = false;

    expect(await read()).toEqual({ count: 0, commands: [] });
  });

  test("nothing failed: nothing is read", async () => {
    expect(await read([])).toEqual({ count: 0, commands: [] });
    expect(find).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  test("a failure that is not a refusal is not mistaken for one", async () => {
    find.mockRejectedValue(new BadDataException("database down") as never);

    await expect(read()).rejects.toBeInstanceOf(BadDataException);
  });

  test("a command whose incident or alert the reader may not read says nothing of it", async () => {
    readable = [job(1, { aiRunId: FIX_ID })];

    const result: AiActivityFailedCommandsRead = await read();

    expect(result.commands[0]!.subject).toBeUndefined();
  });
});
