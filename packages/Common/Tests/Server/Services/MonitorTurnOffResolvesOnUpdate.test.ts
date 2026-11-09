import * as fs from "fs";
import * as path from "path";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorService from "../../../Server/Services/MonitorService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import MonitorTurnedOff from "../../../Server/Utils/Monitor/MonitorTurnedOff";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  RowsCallerMayWriteRead,
  stubRowsCallerMayWrite,
} from "../TestingUtils/RowsCallerMayWrite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TURNING MONITORING OFF RESOLVES WHAT THE MONITOR WOULD HAVE RESOLVED, ON
 * EVERY PATH THAT TURNS IT OFF (issue #6400).
 *
 * The monitor's own switch, a list's Disable, a monitor group's Turn off
 * monitoring, the API, Terraform, a workflow and Microsoft Teams all turn
 * monitoring off with one write: disableActiveMonitoring: true. So
 * MonitorService itself notices the monitors an update really turns off -
 * read before the write, from the rows the update writes - and once it is
 * saved hands each to MonitorTurnedOff, which resolves the incidents and
 * alerts that monitor would have resolved itself.
 *
 * A monitor that is off already turns nothing off: writing the switch back
 * as it is resolves nothing. A failure to resolve is logged and never fails
 * the save.
 *
 * The real onBeforeUpdate runs, and what it carries forward goes to the
 * real onUpdateSuccess; the database and MonitorTurnedOff are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-0e0e-4aaa-8bbb-000000000002");
const CHECKED: string = "0193c0de-0e0e-4aaa-8bbb-0000000000a1";
const ALREADY_OFF: string = "0193c0de-0e0e-4aaa-8bbb-0000000000a2";
const ALSO_CHECKED: string = "0193c0de-0e0e-4aaa-8bbb-0000000000a3";

interface StoredMonitor {
  id: string;
  name: string;
  disableActiveMonitoring: boolean;
}

let storedMonitors: Array<StoredMonitor> = [];

let reads: MockFunction;
let resolves: MockFunction;
let feed: MockFunction;
let errors: MockFunction;

type OnBeforeUpdate = (
  updateBy: UpdateBy<Monitor>,
) => Promise<OnUpdate<Monitor>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<Monitor>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<Monitor>>;

const hooks: {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
} = MonitorService as unknown as {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
};

// The stored monitors a read matches: by its _id (one, or an IN), or all.
function matching(query: Dictionary<unknown>): Array<StoredMonitor> {
  const id: unknown = query["_id"];

  if (typeof id === "string" || id instanceof ObjectID) {
    return storedMonitors.filter((monitor: StoredMonitor): boolean => {
      return monitor.id === id.toString().toLowerCase();
    });
  }

  const asked: { objectLiteralParameters?: Dictionary<unknown> } | undefined =
    id as { objectLiteralParameters?: Dictionary<unknown> } | undefined;

  if (asked?.objectLiteralParameters) {
    const ids: Array<string> = (
      Object.values(asked.objectLiteralParameters) as Array<Array<unknown>>
    )
      .flat()
      .map((value: unknown): string => {
        return String(value).toLowerCase();
      });

    return storedMonitors.filter((monitor: StoredMonitor): boolean => {
      return ids.includes(monitor.id);
    });
  }

  return storedMonitors;
}

function rowOf(record: StoredMonitor, select: Dictionary<unknown>): Monitor {
  const row: Monitor = new Monitor();
  row._id = record.id;
  row.projectId = PROJECT_ID;

  if (select["name"]) {
    row.name = record.name;
  }

  if (select["disableActiveMonitoring"]) {
    row.disableActiveMonitoring = record.disableActiveMonitoring;
  }

  return row;
}

function editor(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };
}

beforeEach(() => {
  storedMonitors = [
    { id: CHECKED, name: "Checkout API", disableActiveMonitoring: false },
    { id: ALREADY_OFF, name: "Legacy API", disableActiveMonitoring: true },
    { id: ALSO_CHECKED, name: "Search API", disableActiveMonitoring: false },
  ];

  stubProjectDirectory({});

  reads = getJestMockFunction();
  reads.mockImplementation(
    async (findBy: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
    }): Promise<Array<Monitor>> => {
      return matching(findBy.query).map((record: StoredMonitor): Monitor => {
        return rowOf(record, findBy.select);
      });
    },
  );
  jest.spyOn(MonitorService, "findBy").mockImplementation(reads as never);

  stubRowsCallerMayWrite(MonitorService, (read: RowsCallerMayWriteRead) => {
    return matching(read.query as Dictionary<unknown>).map(
      (record: StoredMonitor) => {
        return { _id: record.id };
      },
    );
  });

  jest.spyOn(MonitorService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
    select: Dictionary<unknown>;
  }): Promise<Monitor | null> => {
    const record: StoredMonitor | undefined = storedMonitors.find(
      (monitor: StoredMonitor): boolean => {
        return monitor.id === data.id.toString();
      },
    );

    return record ? rowOf(record, { ...data.select, name: true }) : null;
  }) as never);

  jest
    .spyOn(MonitorService, "getMonitorLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/monitor") as never,
    );

  feed = getJestMockFunction();
  feed.mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockImplementation(feed as never);

  resolves = getJestMockFunction();
  resolves.mockResolvedValue({
    resolvedIncidentIds: [],
    resolvedAlertIds: [],
  } as never);
  jest
    .spyOn(MonitorTurnedOff, "resolveWhatItWouldHaveResolved")
    .mockImplementation(resolves as never);

  errors = getJestMockFunction();
  jest.spyOn(logger, "error").mockImplementation(errors as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function runBeforeUpdate(
  data: Dictionary<unknown>,
  options: {
    ids?: Array<string>;
    props?: DatabaseCommonInteractionProps;
  } = {},
): Promise<OnUpdate<Monitor>> {
  const ids: Array<string> = options.ids || [CHECKED];

  return await hooks.onBeforeUpdate({
    query: (ids.length === 1
      ? { _id: ids[0] }
      : {}) as UpdateBy<Monitor>["query"],
    data: data as UpdateBy<Monitor>["data"],
    props: options.props || editor(),
    limit: ids.length === 1 ? 1 : 100,
    skip: 0,
  });
}

// The whole update as DatabaseService runs it, around the write.
async function runUpdate(
  data: Dictionary<unknown>,
  options: {
    ids?: Array<string>;
    props?: DatabaseCommonInteractionProps;
    updatedIds?: Array<string>;
  } = {},
): Promise<OnUpdate<Monitor>> {
  const onUpdate: OnUpdate<Monitor> = await runBeforeUpdate(data, options);

  return await hooks.onUpdateSuccess(
    onUpdate,
    (options.updatedIds || options.ids || [CHECKED]).map(
      (id: string): ObjectID => {
        return new ObjectID(id);
      },
    ),
  );
}

function resolvedMonitorIds(): Array<string> {
  return resolves.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { monitorId: ObjectID }).monitorId.toString();
  });
}

describe("what onBeforeUpdate notices", () => {
  test("a monitor the update turns off is carried forward", async () => {
    const onUpdate: OnUpdate<Monitor> = await runBeforeUpdate({
      disableActiveMonitoring: true,
    });

    expect(onUpdate.carryForward).toEqual({ monitorIdsTurnedOff: [CHECKED] });
  });

  test("it reads only the switch, of the rows the update writes", async () => {
    await runBeforeUpdate({ disableActiveMonitoring: true });

    expect(reads).toHaveBeenCalledTimes(1);
    const findBy: { select: Dictionary<unknown> } = reads.mock.calls[0]![0] as {
      select: Dictionary<unknown>;
    };
    expect(findBy.select).toEqual({ _id: true, disableActiveMonitoring: true });
  });

  test("a monitor that is off already is not: writing the switch back turns nothing off", async () => {
    const onUpdate: OnUpdate<Monitor> = await runBeforeUpdate(
      { disableActiveMonitoring: true },
      { ids: [ALREADY_OFF] },
    );

    expect(onUpdate.carryForward).toBeNull();
  });

  test("a bulk Disable over monitors some of which are off carries forward only those it turns off", async () => {
    const onUpdate: OnUpdate<Monitor> = await runBeforeUpdate(
      { disableActiveMonitoring: true },
      { ids: [CHECKED, ALREADY_OFF, ALSO_CHECKED] },
    );

    expect(
      [
        ...((onUpdate.carryForward as { monitorIdsTurnedOff: Array<string> })
          .monitorIdsTurnedOff || []),
      ].sort(),
    ).toEqual([CHECKED, ALSO_CHECKED].sort());
  });

  test.each([
    ["turning monitoring on", { disableActiveMonitoring: false }],
    [
      "an edit that leaves the switch alone",
      { isAllProbesDisconnectedFromThisMonitor: false },
    ],
  ])(
    "%s reads nothing for it and carries nothing",
    async (_name: string, data: Dictionary<unknown>) => {
      const onUpdate: OnUpdate<Monitor> = await runBeforeUpdate(
        data as Dictionary<unknown>,
      );

      expect(reads).not.toHaveBeenCalled();
      expect(onUpdate.carryForward).toBeNull();
    },
  );

  test("a rename that also turns monitoring off carries both: the feed's values and the monitor turned off", async () => {
    const onUpdate: OnUpdate<Monitor> = await runBeforeUpdate({
      name: "Checkout API v2",
      disableActiveMonitoring: true,
    });

    const carryForward: {
      valuesBeforeUpdate?: Dictionary<unknown>;
      monitorIdsTurnedOff?: Array<string>;
    } = onUpdate.carryForward as {
      valuesBeforeUpdate?: Dictionary<unknown>;
      monitorIdsTurnedOff?: Array<string>;
    };

    expect(Object.keys(carryForward.valuesBeforeUpdate || {})).toEqual([
      CHECKED,
    ]);
    expect(carryForward.monitorIdsTurnedOff).toEqual([CHECKED]);
  });
});

describe("what onUpdateSuccess resolves", () => {
  test("each monitor turned off, credited to whoever turned it off", async () => {
    await runUpdate({ disableActiveMonitoring: true });

    expect(resolves).toHaveBeenCalledTimes(1);
    expect(resolves).toHaveBeenCalledWith({
      monitorId: new ObjectID(CHECKED),
      turnedOffByUserId: USER_ID,
    });
  });

  test("a bulk Disable resolves for the monitors it turned off, and not for one that was off already", async () => {
    await runUpdate(
      { disableActiveMonitoring: true },
      { ids: [CHECKED, ALREADY_OFF, ALSO_CHECKED] },
    );

    expect(resolvedMonitorIds().sort()).toEqual([CHECKED, ALSO_CHECKED].sort());
  });

  test("writing the switch back as it is resolves nothing", async () => {
    await runUpdate({ disableActiveMonitoring: true }, { ids: [ALREADY_OFF] });

    expect(resolves).not.toHaveBeenCalled();
  });

  test("turning monitoring on resolves nothing", async () => {
    await runUpdate({ disableActiveMonitoring: false });

    expect(resolves).not.toHaveBeenCalled();
  });

  test("turned off by OneUptime itself - a policy, a workflow as root - it is credited to nobody", async () => {
    await runUpdate(
      { disableActiveMonitoring: true },
      { props: { isRoot: true, tenantId: PROJECT_ID } },
    );

    expect(resolves).toHaveBeenCalledWith({
      monitorId: new ObjectID(CHECKED),
      turnedOffByUserId: undefined,
    });
  });

  test("only a monitor the update wrote: one read but not written is left alone", async () => {
    await runUpdate(
      { disableActiveMonitoring: true },
      { ids: [CHECKED, ALSO_CHECKED], updatedIds: [ALSO_CHECKED] },
    );

    expect(resolvedMonitorIds()).toEqual([ALSO_CHECKED]);
  });

  test("a failure to resolve is logged and does not fail the save; the next monitor is still resolved", async () => {
    resolves.mockImplementation((async (data: { monitorId: ObjectID }) => {
      if (data.monitorId.toString() === CHECKED) {
        throw new Error("database is down");
      }
      return { resolvedIncidentIds: [], resolvedAlertIds: [] };
    }) as never);

    await expect(
      runUpdate(
        { disableActiveMonitoring: true },
        { ids: [CHECKED, ALSO_CHECKED] },
      ),
    ).resolves.toBeDefined();

    expect(resolvedMonitorIds().sort()).toEqual([CHECKED, ALSO_CHECKED].sort());
    expect(errors).toHaveBeenCalled();
  });

  test("a rename that also turns monitoring off still writes its feed line", async () => {
    await runUpdate({ name: "Checkout API v2", disableActiveMonitoring: true });

    expect(resolves).toHaveBeenCalledTimes(1);
    expect(feed).toHaveBeenCalledTimes(1);
  });
});

/*
 * Every path that turns monitoring off writes the same column through
 * MonitorService, so they all reach the hooks above. The monitor group's
 * Turn off monitoring is one of them (MonitorGroupService), and so is
 * Microsoft Teams' Disable Monitoring action.
 */
describe("the hook is the one place", () => {
  test("MonitorService hands every monitor it turned off to MonitorTurnedOff", () => {
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "../../../Server/Services/MonitorService.ts"),
      "utf8",
    );

    expect(source).toContain(
      "await MonitorTurnedOff.resolveWhatItWouldHaveResolved({",
    );
    expect(source).toContain("await this.findMonitorIdsTurnedOff(updateBy)");
  });
});
