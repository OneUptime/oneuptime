import RunnerJobService from "../../../Server/Services/RunnerJobService";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OwnChangeRecorder from "../../../Server/Utils/Telemetry/ChangeDetection/OwnChangeRecorder";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * RunnerJobService.submitResult and the changes OneUptime AI makes: a
 * result stored for a fix command (origin AiRemediation) is handed to
 * OwnChangeRecorder, which records the change; an investigation's read, a
 * runbook step, or a result that was not ours to write is not. The origin
 * comes back from the UPDATE itself, so deciding costs no extra query.
 */

const JOB_ID: ObjectID = new ObjectID("7a1c3e50-0000-4000-8000-000000000001");
const AGENT_ID: ObjectID = new ObjectID("7a1c3e50-0000-4000-8000-000000000002");

describe("RunnerJobService.submitResult records OneUptime AI's own changes", () => {
  let returned: Array<Record<string, unknown>>;
  let sqls: Array<string>;
  let recordSpy: jest.SpiedFunction<
    typeof OwnChangeRecorder.recordAiCommandResult
  >;

  beforeEach(() => {
    returned = [];
    sqls = [];
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: jest.fn().mockImplementation(async (sql: unknown) => {
        sqls.push(String(sql));
        return [returned, returned.length];
      }),
    } as never);
    recordSpy = jest
      .spyOn(OwnChangeRecorder, "recordAiCommandResult")
      .mockImplementation(() => {
        return undefined;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function submit(): Promise<boolean> {
    return await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output: "deployment.apps/api restarted",
      exitCode: 0,
    });
  }

  it("reads the job's origin back from the same UPDATE", async () => {
    returned = [{ _id: JOB_ID.toString(), origin: RunnerJobOrigin.Runbook }];

    await submit();

    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain('RETURNING "_id", "origin"');
  });

  it("hands a fix command's result to the recorder", async () => {
    returned = [
      { _id: JOB_ID.toString(), origin: RunnerJobOrigin.AiRemediation },
    ];

    await expect(submit()).resolves.toBe(true);

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(JOB_ID);
  });

  it.each([
    ["an investigation's read", RunnerJobOrigin.AiInvestigation],
    ["a runbook step", RunnerJobOrigin.Runbook],
  ])("does not for %s", async (_name: string, origin: RunnerJobOrigin) => {
    returned = [{ _id: JOB_ID.toString(), origin }];

    await expect(submit()).resolves.toBe(true);

    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("does not when the result was not ours to write", async () => {
    returned = [];

    await expect(submit()).resolves.toBe(false);

    expect(recordSpy).not.toHaveBeenCalled();
  });
});
