import RunbookExecutionService from "../../../Server/Services/RunbookExecutionService";
import OwnChangeRecorder from "../../../Server/Utils/Telemetry/ChangeDetection/OwnChangeRecorder";
import RunbookExecutionStatus from "../../../Types/Runbook/RunbookExecutionStatus";
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
 * RunbookExecutionService hands every update that finishes a runbook
 * execution to OwnChangeRecorder, which records the runbook as a change
 * once. Updates that leave it running are not handed over.
 */

type OnUpdateSuccess = (
  onUpdate: unknown,
  updatedItemIds: Array<ObjectID>,
) => Promise<unknown>;

function onUpdateSuccess(): OnUpdateSuccess {
  return (
    RunbookExecutionService as unknown as { onUpdateSuccess: OnUpdateSuccess }
  ).onUpdateSuccess.bind(RunbookExecutionService);
}

function update(data: Record<string, unknown>): unknown {
  return {
    updateBy: { query: {}, data, props: { isRoot: true } },
    carryForward: undefined,
  };
}

describe("RunbookExecutionService records finished runbooks as changes", () => {
  let recordSpy: jest.SpiedFunction<
    typeof OwnChangeRecorder.recordRunbookExecutions
  >;

  beforeEach(() => {
    recordSpy = jest
      .spyOn(OwnChangeRecorder, "recordRunbookExecutions")
      .mockImplementation(() => {
        return undefined;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    RunbookExecutionStatus.Completed,
    RunbookExecutionStatus.Failed,
    RunbookExecutionStatus.Cancelled,
  ])(
    "hands over the executions an update to %s finished",
    async (status: RunbookExecutionStatus) => {
      const ids: Array<ObjectID> = [ObjectID.generate(), ObjectID.generate()];
      const onUpdate: unknown = update({ status, completedAt: new Date() });

      await expect(onUpdateSuccess()(onUpdate, ids)).resolves.toBe(onUpdate);

      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(recordSpy).toHaveBeenCalledWith(ids);
    },
  );

  it.each([
    [
      "a status that leaves it running",
      { status: RunbookExecutionStatus.Running },
    ],
    [
      "a status that waits for a person",
      { status: RunbookExecutionStatus.WaitingForManualStep },
    ],
    ["an update of its steps alone", { stepExecutions: [] }],
  ])(
    "does not for %s",
    async (_name: string, data: Record<string, unknown>) => {
      await onUpdateSuccess()(update(data), [ObjectID.generate()]);

      expect(recordSpy).not.toHaveBeenCalled();
    },
  );
});
