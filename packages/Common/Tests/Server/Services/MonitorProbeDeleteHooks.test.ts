import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { getJestSpyOn } from "../../Spy";
import {
  readsOfRowsCallerMayWrite,
  stubRowsCallerMayDelete,
} from "../TestingUtils/RowsCallerMayWrite";

/*
 * https://github.com/OneUptime/oneuptime/issues/2899
 *
 * Monitor > Probes can now remove a probe from a monitor - previously it could
 * only add one, so a probe attached by mistake was permanent.
 *
 * Removing one changes the same aggregate that adding one or toggling
 * isEnabled changes: Monitor.isNoProbeEnabledOnThisMonitor (the "Probes Not
 * Enabled" banner on the monitor page, and the owner notification behind it).
 * MonitorProbeService had create and update hooks for that and no delete hook,
 * so deleting the last probe left the monitor still claiming it was watched.
 *
 * The monitorIds have to be read *before* the delete - afterwards the rows are
 * gone - which is what these tests pin.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

type MakeDeleteByFunction = (
  query: Record<string, unknown>,
) => DeleteBy<MonitorProbe>;

const makeDeleteBy: MakeDeleteByFunction = (
  query: Record<string, unknown>,
): DeleteBy<MonitorProbe> => {
  return {
    query: query as any,
    limit: 10,
    skip: 0,
    props: { isRoot: false },
  } as DeleteBy<MonitorProbe>;
};

type MakeRowFunction = (monitorId: ObjectID | undefined) => MonitorProbe;

const makeRow: MakeRowFunction = (
  monitorId: ObjectID | undefined,
): MonitorProbe => {
  const monitorProbe: MonitorProbe = new MonitorProbe(ObjectID.generate());

  if (monitorId) {
    monitorProbe.monitorId = monitorId;
  }

  return monitorProbe;
};

/*
 * onBeforeDelete / onDeleteSuccess are protected: DatabaseService is what calls
 * them. Reaching them directly is the only way to test them without a database.
 */
type CallOnBeforeDeleteFunction = (
  deleteBy: DeleteBy<MonitorProbe>,
) => Promise<OnDelete<MonitorProbe>>;

const callOnBeforeDelete: CallOnBeforeDeleteFunction = (
  deleteBy: DeleteBy<MonitorProbe>,
): Promise<OnDelete<MonitorProbe>> => {
  return (MonitorProbeService as any).onBeforeDelete(deleteBy);
};

type CallOnDeleteSuccessFunction = (
  onDelete: OnDelete<MonitorProbe>,
) => Promise<OnDelete<MonitorProbe>>;

const callOnDeleteSuccess: CallOnDeleteSuccessFunction = (
  onDelete: OnDelete<MonitorProbe>,
): Promise<OnDelete<MonitorProbe>> => {
  return (MonitorProbeService as any).onDeleteSuccess(onDelete, []);
};

describe("MonitorProbeService delete hooks", () => {
  let refreshedMonitorIds: Array<string> = [];
  let findByCalls: Array<any> = [];
  let rowsToReturn: Array<MonitorProbe> = [];

  beforeEach(() => {
    refreshedMonitorIds = [];
    findByCalls = [];
    rowsToReturn = [];

    getJestSpyOn(MonitorProbeService, "findBy").mockImplementation(
      async (findBy: any): Promise<Array<MonitorProbe>> => {
        findByCalls.push(findBy);
        return rowsToReturn;
      },
    );
    // The rows the caller may delete: the ones the delete matches.
    stubRowsCallerMayDelete(MonitorProbeService, () => {
      return rowsToReturn;
    });

    getJestSpyOn(
      MonitorService,
      "refreshMonitorProbeStatus",
    ).mockImplementation(async (monitorId: any): Promise<void> => {
      refreshedMonitorIds.push(monitorId.toString());
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("onBeforeDelete", () => {
    it("carries forward the monitors whose rows are about to disappear", async () => {
      rowsToReturn = [makeRow(MONITOR_ID)];

      const onDelete: OnDelete<MonitorProbe> = await callOnBeforeDelete(
        makeDeleteBy({ monitorId: MONITOR_ID }),
      );

      expect(
        (onDelete.carryForward.monitorIds as Array<ObjectID>).map(
          (id: ObjectID) => {
            return id.toString();
          },
        ),
      ).toEqual([MONITOR_ID.toString()]);
    });

    it("reads the rows the caller may delete, then the delete's own among them", async () => {
      const row: MonitorProbe = makeRow(MONITOR_ID);
      rowsToReturn = [row];
      const query: Record<string, unknown> = { monitorId: MONITOR_ID };

      await callOnBeforeDelete(makeDeleteBy(query));

      // The rows the caller may delete, read with the delete's own query.
      expect(readsOfRowsCallerMayWrite(MonitorProbeService)[0]!.query).toEqual(
        query,
      );

      // The delete's rows among them.
      expect(findByCalls).toHaveLength(1);
      expect(findByCalls[0].query).toEqual({
        monitorId: MONITOR_ID,
        _id: row._id,
      });
      expect(findByCalls[0].select).toEqual({ monitorId: true, _id: true });
    });

    it("reads the delete's rows as root, among those the caller may delete", async () => {
      rowsToReturn = [makeRow(MONITOR_ID)];

      await callOnBeforeDelete(makeDeleteBy({ monitorId: MONITOR_ID }));

      expect(findByCalls[0].props.isRoot).toBe(true);
    });

    it("reads the rows the caller may delete in the delete's own window, so a bulk delete is covered", async () => {
      const deleteBy: DeleteBy<MonitorProbe> = makeDeleteBy({
        monitorId: MONITOR_ID,
      });
      deleteBy.limit = 250;
      deleteBy.skip = 10;

      await callOnBeforeDelete(deleteBy);

      const read: { limit: number; skip: number } =
        readsOfRowsCallerMayWrite(MonitorProbeService)[0]!;
      expect(read.limit).toBe(250);
      expect(read.skip).toBe(10);
    });

    it("holds the delete to the rows it read, so it removes no row it did not see", async () => {
      const row: MonitorProbe = makeRow(MONITOR_ID);
      rowsToReturn = [row];
      const deleteBy: DeleteBy<MonitorProbe> = makeDeleteBy({
        monitorId: MONITOR_ID,
      });

      const onDelete: OnDelete<MonitorProbe> =
        await callOnBeforeDelete(deleteBy);

      expect(onDelete.deleteBy).toBe(deleteBy);
      expect((deleteBy.query as Record<string, unknown>)["_id"]).toBe(row._id);
      expect(deleteBy.limit).toBe(1);
      expect(deleteBy.skip).toBe(0);
    });

    it("drops rows with no monitorId rather than carrying an undefined forward", async () => {
      rowsToReturn = [makeRow(undefined), makeRow(MONITOR_ID)];

      const onDelete: OnDelete<MonitorProbe> = await callOnBeforeDelete(
        makeDeleteBy({}),
      );

      expect(onDelete.carryForward.monitorIds).toHaveLength(1);
    });

    it("carries nothing forward when the delete matches nothing", async () => {
      rowsToReturn = [];

      const onDelete: OnDelete<MonitorProbe> = await callOnBeforeDelete(
        makeDeleteBy({ monitorId: MONITOR_ID }),
      );

      expect(onDelete.carryForward.monitorIds).toEqual([]);
      // Nothing the caller may delete: nothing is read again.
      expect(findByCalls).toHaveLength(0);
    });
  });

  describe("onDeleteSuccess", () => {
    it("refreshes the monitor, so the 'Probes Not Enabled' banner appears", async () => {
      await callOnDeleteSuccess({
        deleteBy: makeDeleteBy({ monitorId: MONITOR_ID }),
        carryForward: { monitorIds: [MONITOR_ID] },
      });

      expect(refreshedMonitorIds).toEqual([MONITOR_ID.toString()]);
    });

    it("refreshes every monitor a bulk delete touched", async () => {
      await callOnDeleteSuccess({
        deleteBy: makeDeleteBy({}),
        carryForward: { monitorIds: [MONITOR_ID, OTHER_MONITOR_ID] },
      });

      expect(refreshedMonitorIds).toEqual([
        MONITOR_ID.toString(),
        OTHER_MONITOR_ID.toString(),
      ]);
    });

    it("refreshes a monitor once even when several of its rows went", async () => {
      /*
       * Removing three probes from one monitor is one aggregate to recompute,
       * and refreshMonitorProbeStatus writes to the monitor and can notify its
       * owners.
       */
      await callOnDeleteSuccess({
        deleteBy: makeDeleteBy({ monitorId: MONITOR_ID }),
        carryForward: { monitorIds: [MONITOR_ID, MONITOR_ID, MONITOR_ID] },
      });

      expect(refreshedMonitorIds).toEqual([MONITOR_ID.toString()]);
    });

    it("does nothing when nothing was carried forward", async () => {
      await callOnDeleteSuccess({
        deleteBy: makeDeleteBy({}),
        carryForward: { monitorIds: [] },
      });

      expect(refreshedMonitorIds).toEqual([]);
    });

    it("survives a carryForward that never ran onBeforeDelete", async () => {
      // props.ignoreHooks makes DatabaseService pass carryForward: [].
      await callOnDeleteSuccess({
        deleteBy: makeDeleteBy({}),
        carryForward: [],
      });

      expect(refreshedMonitorIds).toEqual([]);
    });

    it("does not turn a failed status refresh into a failed delete", async () => {
      /*
       * The rows are already gone by the time this runs. Throwing here would
       * report a 500 for a delete that actually succeeded.
       */
      jest.restoreAllMocks();
      getJestSpyOn(
        MonitorService,
        "refreshMonitorProbeStatus",
      ).mockImplementation(async (): Promise<void> => {
        throw new Error("refresh exploded");
      });

      await expect(
        callOnDeleteSuccess({
          deleteBy: makeDeleteBy({ monitorId: MONITOR_ID }),
          carryForward: { monitorIds: [MONITOR_ID] },
        }),
      ).resolves.toBeDefined();
    });
  });
});
