import MonitorNetworkDevice from "../../../Models/DatabaseModels/MonitorNetworkDevice";
import MonitorNetworkDeviceService from "../../../Server/Services/MonitorNetworkDeviceService";
import FindBy from "../../../Server/Types/Database/FindBy";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * MonitorNetworkDeviceService.findMonitorIdsWatching: which Network Device
 * monitors watch some devices, read by the device from the table Postgres
 * keeps from every monitor's steps (MonitorNetworkDevicePostgres pins the
 * triggers and runs this against a real database). A device's poll and its
 * traps ask it through NetworkDeviceWalkUtil.findMonitorsWatchingDevices,
 * and the device page's Monitors card through
 * NetworkDeviceWatchingMonitorsAPI (OneUptime issue #8101), which used to
 * list every Network Device monitor of the project in the browser instead.
 *
 * QueryHelper.any and QueryHelper.greaterThan are replaced with sentinels so
 * a query says what it asked for. `jest` is the global one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000008101",
);
const DEVICE_ID: string = "dd000000-0000-4000-8000-000000008101";
const OTHER_DEVICE_ID: string = "dd000000-0000-4000-8000-000000008102";

type AnyQuery = { __in: Array<string> };
type AfterQuery = { __after: string };

let findBySpy: jest.SpyInstance;

function row(monitorId: ObjectID, id?: ObjectID): MonitorNetworkDevice {
  const link: MonitorNetworkDevice = new MonitorNetworkDevice(
    id || ObjectID.generate(),
  );
  link.monitorId = monitorId;
  link.networkDeviceId = new ObjectID(DEVICE_ID);
  link.projectId = PROJECT_ID;
  return link;
}

function asked(callIndex: number): FindBy<MonitorNetworkDevice> {
  return findBySpy.mock.calls[callIndex]![0] as FindBy<MonitorNetworkDevice>;
}

beforeEach(() => {
  jest.spyOn(QueryHelper, "any").mockImplementation(((
    values: Array<string | ObjectID>,
  ): AnyQuery => {
    return {
      __in: values.map((value: string | ObjectID): string => {
        return value.toString();
      }),
    };
  }) as never);
  jest.spyOn(QueryHelper, "greaterThan").mockImplementation(((
    value: ObjectID,
  ): AfterQuery => {
    return { __after: value.toString() };
  }) as never);
  findBySpy = jest
    .spyOn(MonitorNetworkDeviceService, "findBy")
    .mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorNetworkDeviceService.findMonitorIdsWatching", () => {
  test("an empty device list asks nothing", async () => {
    await expect(
      MonitorNetworkDeviceService.findMonitorIdsWatching({
        projectId: PROJECT_ID,
        deviceIds: [],
      }),
    ).resolves.toEqual([]);

    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("asks for the devices' rows in the project, as root, by row id, a page at a time, for the monitor ids only", async () => {
    await MonitorNetworkDeviceService.findMonitorIdsWatching({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
    });

    expect(findBySpy).toHaveBeenCalledTimes(1);

    const findBy: FindBy<MonitorNetworkDevice> = asked(0);
    const query: JSONObject = findBy.query as unknown as JSONObject;

    expect((query["projectId"] as unknown as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((query["networkDeviceId"] as unknown as AnyQuery).__in).toEqual([
      DEVICE_ID,
      OTHER_DEVICE_ID,
    ]);
    // The first page starts at the beginning.
    expect(query["_id"]).toBeUndefined();
    expect(findBy.select).toEqual({ _id: true, monitorId: true });
    expect((findBy.sort as unknown as JSONObject)["_id"]).toBe(
      SortOrder.Ascending,
    );
    expect(findBy.limit).toBe(LIMIT_MAX);
    expect(findBy.skip).toBe(0);
    expect(findBy.props.isRoot).toBe(true);
  });

  test("answers the monitors the rows name, each once, in the order they were read", async () => {
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();
    findBySpy.mockResolvedValue([row(first), row(second), row(first)]);

    await expect(
      MonitorNetworkDeviceService.findMonitorIdsWatching({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
      }),
    ).resolves.toEqual([first.toString(), second.toString()]);
  });

  test("a row with no monitor names none", async () => {
    const watching: ObjectID = ObjectID.generate();
    const orphan: MonitorNetworkDevice = new MonitorNetworkDevice(
      ObjectID.generate(),
    );
    findBySpy.mockResolvedValue([orphan, row(watching)]);

    await expect(
      MonitorNetworkDeviceService.findMonitorIdsWatching({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID],
      }),
    ).resolves.toEqual([watching.toString()]);
  });

  test("a full page asks for the next one after its last row, and every row's monitor is answered", async () => {
    const lastRowId: ObjectID = ObjectID.generate();
    const fullPage: Array<MonitorNetworkDevice> = Array.from(
      { length: LIMIT_MAX },
      (_value: unknown, index: number): MonitorNetworkDevice => {
        return row(
          ObjectID.generate(),
          index === LIMIT_MAX - 1 ? lastRowId : undefined,
        );
      },
    );
    const straggler: ObjectID = ObjectID.generate();

    findBySpy.mockImplementation(
      async (
        findBy: FindBy<MonitorNetworkDevice>,
      ): Promise<Array<MonitorNetworkDevice>> => {
        return (findBy.query as unknown as JSONObject)["_id"]
          ? [row(straggler)]
          : fullPage;
      },
    );

    const monitorIds: Array<string> =
      await MonitorNetworkDeviceService.findMonitorIdsWatching({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID],
      });

    expect(findBySpy).toHaveBeenCalledTimes(2);
    expect(
      (asked(1).query as unknown as JSONObject)["_id"] as unknown as AfterQuery,
    ).toEqual({ __after: lastRowId.toString() });
    // The second page asks about the same devices in the same project.
    expect(
      (
        (asked(1).query as unknown as JSONObject)[
          "networkDeviceId"
        ] as unknown as AnyQuery
      ).__in,
    ).toEqual([DEVICE_ID]);
    expect(monitorIds).toHaveLength(LIMIT_MAX + 1);
    expect(monitorIds[LIMIT_MAX]).toBe(straggler.toString());
  });

  test("a page short of the limit is the last one", async () => {
    findBySpy.mockResolvedValue([row(ObjectID.generate())]);

    await MonitorNetworkDeviceService.findMonitorIdsWatching({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID],
    });

    expect(findBySpy).toHaveBeenCalledTimes(1);
  });
});
