import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * MonitorService.refreshMonitorCurrentStatus copies the status of the open
 * MonitorStatusTimeline row (endsAt IS NULL) onto the monitor's
 * currentMonitorStatusId. The monitor overview's refresh-status call and the
 * KeepCurrentStateConsistent worker both reach it.
 *
 * The bug this pins: the open row used to be read with an UNSORTED
 * findOneBy. When a race on the write path left two open rows (the orphan
 * case), whichever one the database returned was written back as the
 * monitor's status, so an old orphan could overwrite the real current
 * status. The method now asks for at most two open rows, newest first, and
 * writes only when exactly one comes back. Several open rows is left to the
 * reconciler, which closes the stale ones before it refreshes.
 *
 * Everything below the service boundary is spied - no database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const DEGRADED_STATUS_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

interface CapturedFindBy {
  query: {
    monitorId?: ObjectID | undefined;
    endsAt?: FindOperator<unknown> | undefined;
  };
  select: Record<string, unknown>;
  sort?: Record<string, unknown> | undefined;
  limit?: number | undefined;
  skip?: number | undefined;
  props: { isRoot?: boolean | undefined };
}

function openRow(data: {
  id: string;
  monitorStatusId: ObjectID;
}): MonitorStatusTimeline {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row.id = new ObjectID(data.id);
  row.monitorId = MONITOR_ID;
  row.projectId = PROJECT_ID;
  row.monitorStatusId = data.monitorStatusId;
  return row;
}

function fakeMonitor(currentMonitorStatusId: ObjectID): Monitor {
  return {
    id: MONITOR_ID,
    _id: MONITOR_ID.toString(),
    projectId: PROJECT_ID,
    currentMonitorStatusId: currentMonitorStatusId,
  } as unknown as Monitor;
}

describe("MonitorService.refreshMonitorCurrentStatus", () => {
  let findOpenRows: jest.SpyInstance;
  let findOneOpenRow: jest.SpyInstance;
  let monitorWrite: jest.SpyInstance;
  let bridge: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitor(OPERATIONAL_STATUS_ID));
    findOpenRows = jest
      .spyOn(MonitorStatusTimelineService, "findBy")
      .mockResolvedValue([]);
    // The old unsorted lookup. Nothing should reach it any more.
    findOneOpenRow = jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(null);
    monitorWrite = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1);
    bridge = jest
      .spyOn(NetworkSiteService, "onMonitorStatusChanged")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does nothing when there is no open row", async () => {
    findOpenRows.mockResolvedValue([]);

    await expect(
      MonitorService.refreshMonitorCurrentStatus(MONITOR_ID),
    ).resolves.toBeUndefined();

    expect(findOpenRows).toHaveBeenCalledTimes(1);
    expect(monitorWrite).not.toHaveBeenCalled();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("writes the status when exactly one open row differs", async () => {
    findOpenRows.mockResolvedValue([
      openRow({
        id: "11111111-1111-4111-8111-111111111111",
        monitorStatusId: OFFLINE_STATUS_ID,
      }),
    ]);

    await MonitorService.refreshMonitorCurrentStatus(MONITOR_ID);

    expect(monitorWrite).toHaveBeenCalledTimes(1);

    const write: {
      id: ObjectID;
      data: { currentMonitorStatusId: ObjectID };
      props: { isRoot?: boolean };
    } = monitorWrite.mock.calls[0]![0] as {
      id: ObjectID;
      data: { currentMonitorStatusId: ObjectID };
      props: { isRoot?: boolean };
    };

    expect(write.id.toString()).toBe(MONITOR_ID.toString());
    expect(write.data.currentMonitorStatusId.toString()).toBe(
      OFFLINE_STATUS_ID.toString(),
    );
    expect(write.props.isRoot).toBe(true);

    // The id moved, so the devices bound to the monitor are re-stamped.
    expect(bridge).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when two open rows exist (orphan)", async () => {
    /*
     * Newest first, as the query asks. Even the newest row is not trusted
     * while an orphan is open next to it: the reconciler decides which one
     * is real, and only then is the refresh safe.
     */
    findOpenRows.mockResolvedValue([
      openRow({
        id: "11111111-1111-4111-8111-111111111111",
        monitorStatusId: OFFLINE_STATUS_ID,
      }),
      openRow({
        id: "33333333-3333-4333-8333-333333333333",
        monitorStatusId: DEGRADED_STATUS_ID,
      }),
    ]);

    await expect(
      MonitorService.refreshMonitorCurrentStatus(MONITOR_ID),
    ).resolves.toBeUndefined();

    expect(monitorWrite).not.toHaveBeenCalled();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("writes nothing when the single open row already matches", async () => {
    findOpenRows.mockResolvedValue([
      openRow({
        id: "11111111-1111-4111-8111-111111111111",
        monitorStatusId: OPERATIONAL_STATUS_ID,
      }),
    ]);

    await MonitorService.refreshMonitorCurrentStatus(MONITOR_ID);

    expect(monitorWrite).not.toHaveBeenCalled();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("writes nothing when the single open row has no status id", async () => {
    const row: MonitorStatusTimeline = new MonitorStatusTimeline();
    row.id = new ObjectID("11111111-1111-4111-8111-111111111111");
    row.monitorId = MONITOR_ID;
    findOpenRows.mockResolvedValue([row]);

    await MonitorService.refreshMonitorCurrentStatus(MONITOR_ID);

    expect(monitorWrite).not.toHaveBeenCalled();
  });

  it("asks for open rows sorted by startsAt descending with limit 2", async () => {
    await MonitorService.refreshMonitorCurrentStatus(MONITOR_ID);

    expect(findOpenRows).toHaveBeenCalledTimes(1);

    const args: CapturedFindBy = findOpenRows.mock
      .calls[0]![0] as CapturedFindBy;

    expect(args.query.monitorId?.toString()).toBe(MONITOR_ID.toString());

    // QueryHelper.isNull() is a Raw operator that renders "IS NULL".
    const endsAt: FindOperator<unknown> | undefined = args.query.endsAt;
    expect(endsAt).toBeInstanceOf(FindOperator);
    expect(endsAt!.type).toBe("raw");
    expect(endsAt!.getSql?.('"endsAt"')).toBe('("endsAt" IS NULL)');

    expect(args.sort).toEqual({ startsAt: SortOrder.Descending });
    expect(args.limit).toBe(2);
    expect(args.skip).toBe(0);
    expect(args.props.isRoot).toBe(true);
    expect(args.select["monitorStatusId"]).toBe(true);
    expect(args.select["projectId"]).toBe(true);

    expect(findOneOpenRow).not.toHaveBeenCalled();
  });
});
