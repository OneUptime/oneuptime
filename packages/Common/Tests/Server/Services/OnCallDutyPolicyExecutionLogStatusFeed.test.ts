import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A STATUS UPDATE OF ON-CALL EXECUTION LOGS REACHES THE FEED OF EVERY LOG
 * IT WROTE.
 *
 * When an execution log's status changes, the incident, alert or episode
 * that triggered it shows the new status in its feed. The logs are the ones
 * the update wrote (the ids the update path hands onUpdateSuccess), not the
 * one id its query may name: an update of several logs - one held to the
 * rows a check read, which names them by "any of" their ids - reaches the
 * feed of each.
 */

type OnUpdateSuccessFunction = (
  onUpdate: unknown,
  updatedItemIds: Array<ObjectID>,
) => Promise<unknown>;

const LOG_A: ObjectID = new ObjectID("6a000000-0000-4000-8000-00000000000a");
const LOG_B: ObjectID = new ObjectID("6a000000-0000-4000-8000-00000000000b");

function onUpdateSuccess(
  data: Record<string, unknown>,
  updatedItemIds: Array<ObjectID>,
): Promise<unknown> {
  const hook: OnUpdateSuccessFunction = (
    OnCallDutyPolicyExecutionLogService as unknown as {
      onUpdateSuccess: OnUpdateSuccessFunction;
    }
  ).onUpdateSuccess.bind(OnCallDutyPolicyExecutionLogService);

  return hook(
    {
      updateBy: {
        query: { status: OnCallDutyPolicyStatus.Started },
        data: data,
        props: { isRoot: true },
      },
      carryForward: null,
    },
    updatedItemIds,
  );
}

describe("OnCallDutyPolicyExecutionLogService: the feed lines of a status update", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads every execution log the update wrote, by its id", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(null as never) as unknown as jest.SpyInstance;

    await onUpdateSuccess({ status: OnCallDutyPolicyStatus.Completed }, [
      LOG_A,
      LOG_B,
    ]);

    expect(
      findOneById.mock.calls.map((call: Array<unknown>): string => {
        return String((call[0] as { id: ObjectID }).id);
      }),
    ).toEqual([LOG_A.toString(), LOG_B.toString()]);
  });

  test("reads no execution log when the update does not write the status", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(null as never) as unknown as jest.SpyInstance;

    await onUpdateSuccess({ statusMessage: "Still running" }, [LOG_A, LOG_B]);

    expect(findOneById).not.toHaveBeenCalled();
  });
});
