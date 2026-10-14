import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService, {
  StatusEventDeleteCarryForward,
} from "../../../Server/Services/MonitorStatusTimelineService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import {
  OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
  ONLY_STATUS_EVENT_MESSAGE,
} from "../../../Utils/Monitor/MonitorStatusEventDelete";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";

/*
 * ONE STATUS EVENT OF A MONITOR DELETED BY ITS ID, THROUGH THE SERVICE'S
 * HOOKS.
 *
 *   - onBeforeDelete reads the event (held to it), how many the monitor has
 *     and the events either side, and refuses the only event and the oldest
 *     one while it covers part of the last 90 days - writing nothing;
 *   - otherwise it writes nothing either: it hands onDeleteSuccess the event
 *     before, which runs on over the deleted time once the event is gone -
 *     never when the delete removed nothing - and only that one event moves
 *     (deleting an event in the middle used to move the next one back too,
 *     so the two covered the deleted span twice);
 *   - then the monitor's current status is its newest event's again.
 *
 * Reads and writes are stubbed. The same paths on real rows are in
 * StateTimelineRowsKeptPostgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000002",
);
const EVENT_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-00000000000e");
const BEFORE_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-00000000000b",
);
const AFTER_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-00000000000a");
const STATUS_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000005",
);

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const daysAgo: (days: number) => Date = (days: number): Date => {
  return new Date(Date.now() - days * DAY_IN_MS);
};

interface Hooks {
  onBeforeDelete: (
    deleteBy: DeleteBy<MonitorStatusTimeline>,
  ) => Promise<OnDelete<MonitorStatusTimeline>>;
  onDeleteSuccess: (
    onDelete: OnDelete<MonitorStatusTimeline>,
    deletedIds: Array<ObjectID>,
  ) => Promise<OnDelete<MonitorStatusTimeline>>;
}

const hooks: Hooks = MonitorStatusTimelineService as unknown as Hooks;

function event(
  id: ObjectID,
  startsAt: Date,
  endsAt: Date | null,
): MonitorStatusTimeline {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row._id = id.toString();
  row.monitorId = MONITOR_ID;
  row.projectId = PROJECT_ID;
  row.monitorStatusId = STATUS_ID;
  row.startsAt = startsAt;
  row.endsAt = endsAt as Date;
  return row;
}

function deleteOfOne(
  props: DatabaseCommonInteractionProps = { isRoot: true },
): DeleteBy<MonitorStatusTimeline> {
  return {
    query: { _id: EVENT_ID.toString() },
    props: props,
    limit: 1,
    skip: 0,
  } as unknown as DeleteBy<MonitorStatusTimeline>;
}

interface World {
  findOneBy: jest.SpyInstance;
  updateOneById: jest.SpyInstance;
  monitorUpdate: jest.SpyInstance;
  bridge: jest.SpyInstance;
}

/*
 * The monitor's events as the hook reads them: the one deleted, the one
 * before it, the one after it, and how many there are.
 */
function world(data: {
  deleted: MonitorStatusTimeline | null;
  before: MonitorStatusTimeline | null;
  after: MonitorStatusTimeline | null;
  count: number;
  newestAfterDelete?: MonitorStatusTimeline | undefined;
}): World {
  jest
    .spyOn(MonitorStatusTimelineService, "findOneRowAndHoldDeleteToIt")
    .mockResolvedValue({ row: data.deleted, deletesMore: false } as never);

  jest
    .spyOn(MonitorStatusTimelineService, "countBy")
    .mockResolvedValue(new PositiveNumber(data.count) as never);

  const findOneBy: jest.SpyInstance = jest
    .spyOn(MonitorStatusTimelineService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: JSONObject;
    }): Promise<MonitorStatusTimeline | null> => {
      // The event before names the deleted one as the id it is not.
      if (findOneBy.query["_id"]) {
        return data.before;
      }

      // The event after starts later; the newest is asked with no bound.
      if (findOneBy.query["startsAt"]) {
        return data.after;
      }

      return data.newestAfterDelete || null;
    }) as never);

  return {
    findOneBy,
    updateOneById: jest
      .spyOn(MonitorStatusTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never),
    monitorUpdate: jest
      .spyOn(MonitorService, "updateOneBy")
      .mockResolvedValue(1 as never),
    bridge: jest
      .spyOn(NetworkSiteService, "onMonitorStatusChanged")
      .mockResolvedValue(undefined as never),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("onBeforeDelete refuses, writing nothing, when no event is left to take the time", () => {
  test("the monitor's only event", async () => {
    const stubs: World = world({
      deleted: event(EVENT_ID, daysAgo(365), null),
      before: null,
      after: null,
      count: 1,
    });

    await expect(hooks.onBeforeDelete(deleteOfOne())).rejects.toThrow(
      new BadDataException(ONLY_STATUS_EVENT_MESSAGE),
    );

    expect(stubs.updateOneById).not.toHaveBeenCalled();
    expect(stubs.monitorUpdate).not.toHaveBeenCalled();
  });

  test("the oldest event, while it covers part of the last 90 days", async () => {
    const stubs: World = world({
      deleted: event(EVENT_ID, daysAgo(365), daysAgo(20)),
      before: null,
      after: event(AFTER_ID, daysAgo(20), null),
      count: 2,
    });

    await expect(hooks.onBeforeDelete(deleteOfOne())).rejects.toThrow(
      new BadDataException(OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE),
    );

    expect(stubs.updateOneById).not.toHaveBeenCalled();
  });
});

describe("one event that can go", () => {
  test("in the middle: the event before it runs on to the next one's start, once it is gone, and no other event moves", async () => {
    const after: MonitorStatusTimeline = event(AFTER_ID, daysAgo(2), null);
    const stubs: World = world({
      deleted: event(EVENT_ID, daysAgo(3), daysAgo(2)),
      before: event(BEFORE_ID, daysAgo(10), daysAgo(3)),
      after: after,
      count: 3,
      newestAfterDelete: after,
    });

    const onDelete: OnDelete<MonitorStatusTimeline> =
      await hooks.onBeforeDelete(deleteOfOne());

    // Nothing moves before the delete.
    expect(stubs.updateOneById).not.toHaveBeenCalled();
    expect(onDelete.carryForward as StatusEventDeleteCarryForward).toEqual({
      monitorId: MONITOR_ID,
      eventId: new ObjectID(EVENT_ID.toString()),
      previousRunsOn: { previousId: BEFORE_ID, endsAt: after.startsAt },
    });

    await hooks.onDeleteSuccess(onDelete, [EVENT_ID]);

    expect(stubs.updateOneById).toHaveBeenCalledTimes(1);
    expect(stubs.updateOneById.mock.calls[0]![0]).toEqual({
      id: BEFORE_ID,
      data: { endsAt: after.startsAt },
      props: { isRoot: true },
    });
  });

  test("the newest: the event before it is the current status again, on the monitor too", async () => {
    const before: MonitorStatusTimeline = event(
      BEFORE_ID,
      daysAgo(10),
      daysAgo(1),
    );
    const stubs: World = world({
      deleted: event(EVENT_ID, daysAgo(1), null),
      before: before,
      after: null,
      count: 2,
      newestAfterDelete: before,
    });

    const onDelete: OnDelete<MonitorStatusTimeline> =
      await hooks.onBeforeDelete(deleteOfOne());

    await hooks.onDeleteSuccess(onDelete, [EVENT_ID]);

    // Written as null, not left out: it runs on.
    expect(stubs.updateOneById.mock.calls[0]![0]).toEqual({
      id: BEFORE_ID,
      data: { endsAt: null },
      props: { isRoot: true },
    });

    expect(stubs.monitorUpdate).toHaveBeenCalledTimes(1);
    expect(stubs.monitorUpdate.mock.calls[0]![0]).toMatchObject({
      query: { _id: MONITOR_ID.toString() },
      data: { currentMonitorStatusId: STATUS_ID },
    });
    expect(stubs.bridge).toHaveBeenCalledTimes(1);
  });

  test("the oldest, over before the last 90 days: no event moves, the history starts later", async () => {
    const after: MonitorStatusTimeline = event(AFTER_ID, daysAgo(100), null);
    const stubs: World = world({
      deleted: event(EVENT_ID, daysAgo(365), daysAgo(100)),
      before: null,
      after: after,
      count: 2,
      newestAfterDelete: after,
    });

    const onDelete: OnDelete<MonitorStatusTimeline> =
      await hooks.onBeforeDelete(deleteOfOne());

    expect(
      (onDelete.carryForward as StatusEventDeleteCarryForward).previousRunsOn,
    ).toBeNull();

    await hooks.onDeleteSuccess(onDelete, [EVENT_ID]);

    expect(stubs.updateOneById).not.toHaveBeenCalled();
    // The monitor's current status is read again all the same.
    expect(stubs.monitorUpdate).toHaveBeenCalledTimes(1);
  });

  test("a teammate's delete is judged the same way", async () => {
    const after: MonitorStatusTimeline = event(AFTER_ID, daysAgo(2), null);
    world({
      deleted: event(EVENT_ID, daysAgo(3), daysAgo(2)),
      before: event(BEFORE_ID, daysAgo(10), daysAgo(3)),
      after: after,
      count: 3,
    });

    const onDelete: OnDelete<MonitorStatusTimeline> =
      await hooks.onBeforeDelete(
        deleteOfOne({
          tenantId: PROJECT_ID,
          userId: ObjectID.generate(),
        }),
      );

    expect(
      (onDelete.carryForward as StatusEventDeleteCarryForward).previousRunsOn,
    ).toEqual({ previousId: BEFORE_ID, endsAt: after.startsAt });
  });
});

describe("onDeleteSuccess moves nothing unless the event is gone", () => {
  test("a delete that removed nothing - refused after the hook, or the row already gone - leaves every event where it was", async () => {
    const stubs: World = world({
      deleted: event(EVENT_ID, daysAgo(3), daysAgo(2)),
      before: event(BEFORE_ID, daysAgo(10), daysAgo(3)),
      after: event(AFTER_ID, daysAgo(2), null),
      count: 3,
    });

    const onDelete: OnDelete<MonitorStatusTimeline> =
      await hooks.onBeforeDelete(deleteOfOne());

    for (const deletedIds of [[], [AFTER_ID]]) {
      await hooks.onDeleteSuccess(onDelete, deletedIds);
    }

    expect(stubs.updateOneById).not.toHaveBeenCalled();
    expect(stubs.monitorUpdate).not.toHaveBeenCalled();
  });

  test("a delete by query, which carries nothing forward, moves nothing", async () => {
    const stubs: World = world({
      deleted: null,
      before: null,
      after: null,
      count: 3,
    });

    await hooks.onDeleteSuccess(
      {
        deleteBy: deleteOfOne(),
        carryForward: null,
      } as OnDelete<MonitorStatusTimeline>,
      [EVENT_ID, AFTER_ID],
    );

    expect(stubs.updateOneById).not.toHaveBeenCalled();
    expect(stubs.monitorUpdate).not.toHaveBeenCalled();
  });

  test("matches the deleted id whatever case either is written in", async () => {
    const before: MonitorStatusTimeline = event(
      BEFORE_ID,
      daysAgo(10),
      daysAgo(1),
    );
    const stubs: World = world({
      deleted: event(EVENT_ID, daysAgo(1), null),
      before: before,
      after: null,
      count: 2,
      newestAfterDelete: before,
    });

    const onDelete: OnDelete<MonitorStatusTimeline> =
      await hooks.onBeforeDelete(deleteOfOne());

    await hooks.onDeleteSuccess(onDelete, [
      new ObjectID(EVENT_ID.toString().toUpperCase()),
    ]);

    expect(stubs.updateOneById).toHaveBeenCalledTimes(1);
  });
});

describe("an event named by its id that the delete does not reach", () => {
  test("is not read further, and nothing is carried forward", async () => {
    const stubs: World = world({
      deleted: null,
      before: null,
      after: null,
      count: 3,
    });

    const onDelete: OnDelete<MonitorStatusTimeline> =
      await hooks.onBeforeDelete(deleteOfOne());

    expect(onDelete.carryForward).toBeNull();
    expect(stubs.findOneBy).not.toHaveBeenCalled();
  });
});
