import { afterEach, describe, expect, jest, test } from "@jest/globals";
import AlertEpisodeStateTimelineService from "../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  ONLY_STATE_DELETE_MESSAGES,
  StateTimelineRecord,
} from "../../../Utils/StateTimeline/StateTimelineRowDelete";

/*
 * ONE ROW OF AN INCIDENT'S, ALERT'S, SCHEDULED MAINTENANCE EVENT'S OR
 * EPISODE'S STATE TIMELINE, DELETED BY ITS ID, THROUGH THE SERVICE'S HOOK.
 *
 *   - the record's only state is refused, in the words the Status Timeline
 *     pages' locked Delete says (ONLY_STATE_DELETE_MESSAGES), writing nothing;
 *   - the newest state: the one before it runs on to where it ended (open:
 *     current again);
 *   - a state in the middle: the one before it runs on to the next one's
 *     start, and the next one keeps its start. (It used to be moved back to
 *     the deleted one's start as well, so the two covered that time twice.)
 *   - the oldest state: nothing moves.
 *
 * Reads and writes are stubbed: what is asserted is which rows the hook
 * moves, and where to.
 */

const RECORD_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000001",
);
const ROW_ID: ObjectID = new ObjectID("7a000000-0000-4000-8000-00000000000e");
const BEFORE_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-00000000000b",
);
const AFTER_ID: ObjectID = new ObjectID("7a000000-0000-4000-8000-00000000000a");

const AT_ONE: Date = new Date("2026-10-01T10:00:00.000Z");
const AT_TWO: Date = new Date("2026-10-01T11:00:00.000Z");
const AT_THREE: Date = new Date("2026-10-01T12:00:00.000Z");
const AT_FOUR: Date = new Date("2026-10-01T13:00:00.000Z");

interface StateTimelineService {
  findOneRowAndHoldDeleteToIt: (...args: Array<unknown>) => Promise<unknown>;
  countBy: (...args: Array<unknown>) => Promise<unknown>;
  findOneBy: (...args: Array<unknown>) => Promise<unknown>;
  updateOneById: (...args: Array<unknown>) => Promise<unknown>;
  onBeforeDelete: (deleteBy: DeleteBy<never>) => Promise<OnDelete<never>>;
}

interface TimelineCase {
  name: string;
  service: StateTimelineService;
  record: StateTimelineRecord;
  // The column naming the record a row belongs to.
  recordColumn: string;
}

const CASES: Array<TimelineCase> = [
  {
    name: "IncidentStateTimelineService",
    service: IncidentStateTimelineService as unknown as StateTimelineService,
    record: StateTimelineRecord.Incident,
    recordColumn: "incidentId",
  },
  {
    name: "AlertStateTimelineService",
    service: AlertStateTimelineService as unknown as StateTimelineService,
    record: StateTimelineRecord.Alert,
    recordColumn: "alertId",
  },
  {
    name: "ScheduledMaintenanceStateTimelineService",
    service:
      ScheduledMaintenanceStateTimelineService as unknown as StateTimelineService,
    record: StateTimelineRecord.ScheduledMaintenance,
    recordColumn: "scheduledMaintenanceId",
  },
  {
    name: "IncidentEpisodeStateTimelineService",
    service:
      IncidentEpisodeStateTimelineService as unknown as StateTimelineService,
    record: StateTimelineRecord.IncidentEpisode,
    recordColumn: "incidentEpisodeId",
  },
  {
    name: "AlertEpisodeStateTimelineService",
    service:
      AlertEpisodeStateTimelineService as unknown as StateTimelineService,
    record: StateTimelineRecord.AlertEpisode,
    recordColumn: "alertEpisodeId",
  },
];

type RowFunction = (
  timelineCase: TimelineCase,
  id: ObjectID,
  startsAt: Date,
  endsAt: Date | null,
) => JSONObject;

const row: RowFunction = (
  timelineCase: TimelineCase,
  id: ObjectID,
  startsAt: Date,
  endsAt: Date | null,
): JSONObject => {
  return {
    _id: id.toString(),
    id: id,
    [timelineCase.recordColumn]: RECORD_ID,
    startsAt: startsAt,
    endsAt: endsAt,
  } as unknown as JSONObject;
};

interface Writes {
  updates: Array<{ id: string; data: JSONObject }>;
}

type WorldFunction = (
  timelineCase: TimelineCase,
  data: {
    deleted: JSONObject;
    before: JSONObject | null;
    after: JSONObject | null;
    count: number;
  },
) => Writes;

const world: WorldFunction = (
  timelineCase: TimelineCase,
  data: {
    deleted: JSONObject;
    before: JSONObject | null;
    after: JSONObject | null;
    count: number;
  },
): Writes => {
  const writes: Writes = { updates: [] };
  const service: StateTimelineService = timelineCase.service;

  jest
    .spyOn(service, "findOneRowAndHoldDeleteToIt")
    .mockResolvedValue({ row: data.deleted, deletesMore: false } as never);
  jest
    .spyOn(service, "countBy")
    .mockResolvedValue(new PositiveNumber(data.count) as never);
  jest.spyOn(service, "findOneBy").mockImplementation((async (findOneBy: {
    query: JSONObject;
  }): Promise<JSONObject | null> => {
    // The state before names the deleted row as the id it is not.
    if (findOneBy.query["_id"]) {
      return data.before;
    }

    return data.after;
  }) as never);
  jest.spyOn(service, "updateOneById").mockImplementation((async (updateBy: {
    id: ObjectID;
    data: JSONObject;
  }): Promise<void> => {
    writes.updates.push({
      id: updateBy.id.toString(),
      data: updateBy.data,
    });
  }) as never);

  return writes;
};

const deleteOfOne: () => DeleteBy<never> = (): DeleteBy<never> => {
  return {
    query: { _id: ROW_ID.toString() },
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  } as unknown as DeleteBy<never>;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(CASES)("$name", (timelineCase: TimelineCase) => {
  test("refuses the record's only state, in the words the page's lock says, writing nothing", async () => {
    const writes: Writes = world(timelineCase, {
      deleted: row(timelineCase, ROW_ID, AT_ONE, null),
      before: null,
      after: null,
      count: 1,
    });

    await expect(
      timelineCase.service.onBeforeDelete(deleteOfOne()),
    ).rejects.toThrow(
      new BadDataException(ONLY_STATE_DELETE_MESSAGES[timelineCase.record]),
    );
    expect(writes.updates).toEqual([]);
  });

  test("a state in the middle: the one before runs on to the next one's start, which stays where it was", async () => {
    const writes: Writes = world(timelineCase, {
      deleted: row(timelineCase, ROW_ID, AT_TWO, AT_THREE),
      before: row(timelineCase, BEFORE_ID, AT_ONE, AT_TWO),
      after: row(timelineCase, AFTER_ID, AT_THREE, null),
      count: 3,
    });

    await timelineCase.service.onBeforeDelete(deleteOfOne());

    expect(writes.updates).toEqual([
      { id: BEFORE_ID.toString(), data: { endsAt: AT_THREE } },
    ]);
    // The next state is never moved back over the deleted one's time.
    expect(
      writes.updates.some((update: { id: string }): boolean => {
        return update.id === AFTER_ID.toString();
      }),
    ).toBe(false);
  });

  test("the newest state: the one before runs on to where it ended, so it is current again", async () => {
    const writes: Writes = world(timelineCase, {
      deleted: row(timelineCase, ROW_ID, AT_THREE, null),
      before: row(timelineCase, BEFORE_ID, AT_TWO, AT_THREE),
      after: null,
      count: 2,
    });

    await timelineCase.service.onBeforeDelete(deleteOfOne());

    expect(writes.updates).toEqual([
      { id: BEFORE_ID.toString(), data: { endsAt: null } },
    ]);
  });

  test("the oldest state: nothing moves", async () => {
    const writes: Writes = world(timelineCase, {
      deleted: row(timelineCase, ROW_ID, AT_ONE, AT_TWO),
      before: null,
      after: row(timelineCase, AFTER_ID, AT_TWO, AT_FOUR),
      count: 2,
    });

    await timelineCase.service.onBeforeDelete(deleteOfOne());

    expect(writes.updates).toEqual([]);
  });
});
