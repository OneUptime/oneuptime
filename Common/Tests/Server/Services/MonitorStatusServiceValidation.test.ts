import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * MonitorStatusService's create/update/delete lifecycle guards keep the
 * priority column - which the UI treats as an ordered, gapless insert slot -
 * consistent, and stop callers from corrupting it. None of these guards had
 * direct coverage; these tests pin them without a database.
 */

const PROJECT_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const STATUS_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

describe("MonitorStatusService.onBeforeCreate", () => {
  let rearrangeMock: MockFunction;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    rearrangeMock = getJestMockFunction();
    rearrangeMock.mockImplementation(() => {
      return Promise.resolve();
    });
    // rearrangePriority is private and hits the DB; stub it out.
    jest
      .spyOn(
        MonitorStatusService as unknown as {
          rearrangePriority: () => Promise<void>;
        },
        "rearrangePriority",
      )
      .mockImplementation(rearrangeMock as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const runOnBeforeCreate: (status: MonitorStatus) => Promise<void> = async (
    status: MonitorStatus,
  ): Promise<void> => {
    const createBy: CreateBy<MonitorStatus> = {
      data: status,
      props: { isRoot: true },
    } as CreateBy<MonitorStatus>;

    await (
      MonitorStatusService as unknown as {
        onBeforeCreate: (c: CreateBy<MonitorStatus>) => Promise<unknown>;
      }
    ).onBeforeCreate(createBy);
  };

  test("rejects a status created without a priority", async () => {
    const status: MonitorStatus = new MonitorStatus();
    status.projectId = PROJECT_ID;

    await expect(runOnBeforeCreate(status)).rejects.toThrow(BadDataException);
    await expect(runOnBeforeCreate(status)).rejects.toThrow(
      "Monitor Status priority is required",
    );
  });

  test("rejects a status created without a projectId", async () => {
    const status: MonitorStatus = new MonitorStatus();
    status.priority = 1;

    await expect(runOnBeforeCreate(status)).rejects.toThrow(
      "Monitor Status projectId is required",
    );
  });

  test("inserts the new priority slot (increasePriority = true) before create", async () => {
    const status: MonitorStatus = new MonitorStatus();
    status.priority = 5;
    status.projectId = PROJECT_ID;

    await runOnBeforeCreate(status);

    expect(rearrangeMock).toHaveBeenCalledTimes(1);
    const args: Array<unknown> = rearrangeMock.mock.calls[0]!;
    expect((args[0] as number)).toBe(5);
    expect((args[1] as ObjectID).toString()).toBe(PROJECT_ID.toString());
    // The third argument requests an upward shift to open the insert slot.
    expect(args[2]).toBe(true);
  });
});

describe("MonitorStatusService.onBeforeUpdate", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const runOnBeforeUpdate: (
    data: Partial<MonitorStatus>,
    isRoot: boolean,
  ) => Promise<unknown> = (
    data: Partial<MonitorStatus>,
    isRoot: boolean,
  ): Promise<unknown> => {
    const updateBy: UpdateBy<MonitorStatus> = {
      data: data,
      query: { _id: STATUS_ID.toString() },
      props: { isRoot: isRoot },
    } as unknown as UpdateBy<MonitorStatus>;

    return (
      MonitorStatusService as unknown as {
        onBeforeUpdate: (u: UpdateBy<MonitorStatus>) => Promise<unknown>;
      }
    ).onBeforeUpdate(updateBy);
  };

  test("rejects a non-root priority update (priority is immutable to tenants)", async () => {
    await expect(runOnBeforeUpdate({ priority: 3 }, false)).rejects.toThrow(
      "Monitor Status priority should not be updated",
    );
  });

  test("allows a root priority update (migrations / rearrange run as root)", async () => {
    await expect(
      runOnBeforeUpdate({ priority: 3 }, true),
    ).resolves.toBeDefined();
  });

  test("allows a non-root update that does not touch priority", async () => {
    await expect(
      runOnBeforeUpdate({ name: "Renamed" }, false),
    ).resolves.toBeDefined();
  });
});

describe("MonitorStatusService.onBeforeDelete", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rejects a non-root delete that does not target a specific _id", async () => {
    const deleteBy: DeleteBy<MonitorStatus> = {
      query: {},
      props: { isRoot: false },
    } as DeleteBy<MonitorStatus>;

    await expect(
      (
        MonitorStatusService as unknown as {
          onBeforeDelete: (d: DeleteBy<MonitorStatus>) => Promise<unknown>;
        }
      ).onBeforeDelete(deleteBy),
    ).rejects.toThrow("_id should be present when deleting Monitor Status");
  });
});
