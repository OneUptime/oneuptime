import OnCallDutyPolicyScheduleLayer from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyScheduleLayerService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService, {
  CurrentOnCallInSchedule,
  NextInRotationInSchedule,
  ResolvedShiftSegments,
  ScheduleLayerProps,
  ScheduleLayerReads,
} from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyUserOverrideService from "../../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import logger from "../../../../Server/Utils/Logger";
import ScheduleLayersSnapshot, {
  ScheduleLayersSnapshotEntry,
  ScheduleLayersSnapshotStatement,
} from "../../../../Server/Utils/OnCall/ScheduleLayersSnapshot";
import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import EventInterval from "../../../../Types/Events/EventInterval";
import Recurring from "../../../../Types/Events/Recurring";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { LayerProps } from "../../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes from "../../../../Types/OnCallDutyPolicy/RestrictionTimes";
import {
  dailyRestriction,
  noRestriction,
  rotation,
} from "../../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock, SpyInstance } from "jest-mock";

/*
 * A SCHEDULE'S LAYERS AND THE PEOPLE IN THEM, READ AS ONE SNAPSHOT (#9316).
 *
 * Who a page goes to was worked out from three reads - the layers, their
 * people, then the schedule - and a save of the layers that committed
 * between two of them was seen half. ScheduleLayersSnapshot reads them in
 * one statement. These hold:
 *
 *   - the statement: one SELECT, the schedule joined to its layers, their
 *     people and their users, no deleted row, no lock, in priority and
 *     turn order, at most a cap of rows;
 *   - the rows it reads, made into the schedule, its layers (their
 *     rotation and restrictions as the model reads them) and their people;
 *   - many schedules read a batch at a time, never one split between two
 *     statements, however the cap falls;
 *   - the schedule service reading through it: one statement and none of
 *     the three reads, for a page, the next in rotation, the roster and the
 *     calendar feeds' resolver - and one read of a schedule shared by the
 *     lookups of one go.
 *
 * Postgres itself: ScheduleLayersSnapshotPostgres.
 */

jest.mock("../../../../Server/Utils/Logger");

const PROJECT: string = "0e931600-0000-4000-8000-000000000001";
const SCHEDULE: string = "0e931600-0000-4000-8000-000000000002";
const OTHER_SCHEDULE: string = "0e931600-0000-4000-8000-000000000003";
const EMPTY_SCHEDULE: string = "0e931600-0000-4000-8000-000000000004";
const WEEKDAYS: string = "0e931600-0000-4000-8000-0000000000a1";
const BACKUP: string = "0e931600-0000-4000-8000-0000000000a2";
const OTHER_LAYER: string = "0e931600-0000-4000-8000-0000000000a3";
const OTHER_BACKUP: string = "0e931600-0000-4000-8000-0000000000a4";
const ALEX: string = "0e931600-0000-4000-8000-0000000000b1";
const SAM: string = "0e931600-0000-4000-8000-0000000000b2";
const KIM: string = "0e931600-0000-4000-8000-0000000000b3";
const RIA: string = "0e931600-0000-4000-8000-0000000000b4";
const GONE: string = "0e931600-0000-4000-8000-0000000000b5";

type Row = Record<string, unknown>;

// What Postgres keeps in a JSON column: the value as its transformer writes it.
function stored(value: { toJSON: () => JSONObject }): JSONObject {
  return JSON.parse(JSON.stringify(value.toJSON())) as JSONObject;
}

// On the minute, as a layer's start and hand-off are kept.
const AN_HOUR_AGO: Date = new Date(
  Math.floor((Date.now() - 60 * 60 * 1000) / 60_000) * 60_000,
);
const CREATED_AT: Date = new Date("2026-01-02T03:04:05.000Z");
const UPDATED_AT: Date = new Date("2026-02-03T04:05:06.000Z");

// The columns of a schedule, as the statement names them.
function scheduleColumns(
  scheduleId: string,
  timezone: string | null = "UTC",
): Row {
  return {
    schedule_id: scheduleId,
    schedule_projectId: PROJECT,
    schedule_name: "Payments primary",
    schedule_timezone: timezone,
    schedule_shiftConfigVersion: 7,
    schedule_createdAt: CREATED_AT,
  };
}

// The columns of a layer, or none.
function layerColumns(
  layer: {
    id: string;
    name: string;
    order: number;
    restriction?: RestrictionTimes | undefined;
  } | null,
): Row {
  return {
    layer_id: layer?.id ?? null,
    layer_projectId: layer ? PROJECT : null,
    layer_order: layer?.order ?? null,
    layer_name: layer?.name ?? null,
    layer_description: layer ? `The ${layer.name} rotation` : null,
    layer_startsAt: layer ? AN_HOUR_AGO : null,
    layer_handOffTime: layer ? AN_HOUR_AGO : null,
    layer_rotation: layer ? stored(rotation(EventInterval.Day, 1)) : null,
    layer_restrictionTimes: layer
      ? stored(layer.restriction || noRestriction())
      : null,
    layer_updatedAt: layer ? UPDATED_AT : null,
  };
}

// The columns of a person in a layer, or none.
function personColumns(
  person: {
    id: string;
    userId: string;
    order: number;
    // Whether their user is there to read: not when it is deleted.
    userFound?: boolean | undefined;
  } | null,
): Row {
  return {
    layerUser_id: person?.id ?? null,
    layerUser_projectId: person ? PROJECT : null,
    layerUser_userId: person?.userId ?? null,
    layerUser_order: person?.order ?? null,
    layerUser_updatedAt: person ? UPDATED_AT : null,
    user_id: person && person.userFound !== false ? person.userId : null,
  };
}

// A person's row in a layer: an id of its own, from the layer's and the user's.
function personRowId(userId: string, layerId: string): string {
  return `0e931600-0000-4000-8001-00000000${layerId.slice(-2)}${userId.slice(-2)}`;
}

/*
 * The schedule as the statement reads it: Weekdays (Alex, Sam, Kim taking
 * turns of a day from an hour ago, office hours or round the clock) and,
 * below it, Backup (Ria) - one row for each person, in turn order.
 */
function scheduleRows(
  options: {
    scheduleId?: string | undefined;
    // The two layers' ids: a schedule's own.
    layerIds?: [string, string] | undefined;
    weekdays?: Array<string> | undefined;
    weekdaysRestriction?: RestrictionTimes | undefined;
    backup?: Array<string> | undefined;
    timezone?: string | null | undefined;
  } = {},
): Array<Row> {
  const scheduleId: string = options.scheduleId || SCHEDULE;
  const [weekdaysId, backupId]: [string, string] = options.layerIds || [
    WEEKDAYS,
    BACKUP,
  ];
  const rows: Array<Row> = [];

  for (const [layer, people] of [
    [
      {
        id: weekdaysId,
        name: "Weekdays",
        order: 1,
        restriction: options.weekdaysRestriction,
      },
      options.weekdays || [ALEX, SAM, KIM],
    ],
    [{ id: backupId, name: "Backup", order: 2 }, options.backup || [RIA]],
  ] as Array<[{ id: string; name: string; order: number }, Array<string>]>) {
    if (people.length === 0) {
      rows.push({
        ...scheduleColumns(
          scheduleId,
          options.timezone === undefined ? "UTC" : options.timezone,
        ),
        ...layerColumns(layer),
        ...personColumns(null),
      });
      continue;
    }

    people.forEach((userId: string, index: number) => {
      rows.push({
        ...scheduleColumns(
          scheduleId,
          options.timezone === undefined ? "UTC" : options.timezone,
        ),
        ...layerColumns(layer),
        ...personColumns({
          id: personRowId(userId, layer.id),
          userId: userId,
          order: index + 1,
        }),
      });
    });
  }

  return rows;
}

// The ids of the layers and each one's people, as a read worked them out.
function layersOf(
  layerProps: Array<LayerProps>,
): Array<{ layer: string; people: Array<string> }> {
  return layerProps.map((layer: LayerProps) => {
    return {
      layer: layer.layerName || "",
      people: layer.users.map((user: { id?: ObjectID | null }) => {
        return user.id?.toString() || "";
      }),
    };
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the statement", () => {
  const statement: ScheduleLayersSnapshotStatement =
    ScheduleLayersSnapshot.getStatement({
      scheduleIds: [SCHEDULE, OTHER_SCHEDULE],
      limit: 50,
    });
  const sql: string = statement.sql;

  test("is one SELECT: the schedules asked for, joined to their layers, the layers' people and their users", () => {
    expect(sql.startsWith("SELECT ")).toBe(true);
    // One statement, not several.
    expect(sql).not.toContain(";");
    expect(sql.match(/\bSELECT\b/g)).toHaveLength(1);

    expect(sql).toContain(
      `FROM "OnCallDutyPolicySchedule" AS "schedule" LEFT JOIN "OnCallDutyPolicyScheduleLayer" AS "layer" ON "layer"."onCallDutyPolicyScheduleId" = "schedule"."_id"`,
    );
    // A person by their layer and their schedule, as the reads before matched them.
    expect(sql).toContain(
      `LEFT JOIN "OnCallDutyPolicyScheduleLayerUser" AS "layerUser" ON "layerUser"."onCallDutyPolicyScheduleLayerId" = "layer"."_id" AND "layerUser"."onCallDutyPolicyScheduleId" = "schedule"."_id"`,
    );
    expect(sql).toContain(
      `LEFT JOIN "User" AS "user" ON "user"."_id" = "layerUser"."userId"`,
    );
    expect(sql).toContain(`WHERE "schedule"."_id" = ANY($1::uuid[])`);

    expect(statement.parameters).toEqual([[SCHEDULE, OTHER_SCHEDULE], 50]);
  });

  test("reads no row that is deleted - the schedule, a layer, a person, or their user", () => {
    for (const table of ["schedule", "layer", "layerUser", "user"]) {
      expect(sql).toContain(`"${table}"."deletedAt" IS NULL`);
    }
  });

  test("takes no lock: a save holds the schedule while it writes, and the read waits for nothing", () => {
    expect(sql).not.toMatch(
      /\bFOR\s+(UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)\b/i,
    );
    expect(sql).not.toMatch(/\bLOCK\b/i);
    expect(sql).not.toMatch(/\bNOWAIT\b|\bSKIP LOCKED\b/i);
  });

  test("reads each schedule's rows together: layers highest priority first, each one's people in turn order", () => {
    expect(sql).toContain(
      `ORDER BY "schedule"."_id" ASC, "layer"."order" ASC, "layer"."_id" ASC, "layerUser"."order" ASC, "layerUser"."_id" ASC`,
    );
  });

  test("reads at most the rows it is given - by default what the reads it replaces read at most between them", () => {
    expect(sql.endsWith("LIMIT $2")).toBe(true);
    expect(ScheduleLayersSnapshot.MAX_ROWS).toBe(2 * LIMIT_PER_PROJECT);
  });

  test("a read asks for one row past its cap, to know whether there was more", async () => {
    const asked: Array<Array<unknown>> = [];

    await ScheduleLayersSnapshot.read({
      scheduleIds: [new ObjectID(SCHEDULE)],
      query: async (
        _sql: string,
        parameters: Array<unknown>,
      ): Promise<unknown> => {
        asked.push(parameters);
        return [];
      },
    });

    expect(asked).toEqual([[[SCHEDULE], ScheduleLayersSnapshot.MAX_ROWS + 1]]);
  });

  test("reads each column a page, the roster and the calendar feeds work out who is on call from", () => {
    for (const column of [
      `"schedule"."projectId"`,
      `"schedule"."name"`,
      `"schedule"."timezone"`,
      `"schedule"."shiftConfigVersion"`,
      `"schedule"."createdAt"`,
      `"layer"."projectId"`,
      `"layer"."order"`,
      `"layer"."name"`,
      `"layer"."description"`,
      `"layer"."startsAt"`,
      `"layer"."handOffTime"`,
      `"layer"."rotation"`,
      `"layer"."restrictionTimes"`,
      `"layer"."updatedAt"`,
      `"layerUser"."projectId"`,
      `"layerUser"."userId"`,
      `"layerUser"."order"`,
      `"layerUser"."updatedAt"`,
    ]) {
      expect(sql).toContain(column);
    }
  });
});

describe("the rows read", () => {
  test("the schedule, as the model reads it", () => {
    const entry: ScheduleLayersSnapshotEntry =
      ScheduleLayersSnapshot.fromRows(scheduleRows()).get(SCHEDULE)!;

    expect(entry.schedule.id?.toString()).toBe(SCHEDULE);
    expect(entry.schedule.projectId?.toString()).toBe(PROJECT);
    expect(entry.schedule.name).toBe("Payments primary");
    expect(entry.schedule.timezone).toBe("UTC");
    expect(entry.schedule.shiftConfigVersion).toBe(7);
    expect(entry.schedule.createdAt).toEqual(CREATED_AT);
  });

  test("each layer once, however many people it has, with its rotation and restrictions as the model reads them", () => {
    const office: RestrictionTimes = dailyRestriction("09:00", "17:00", "UTC");
    const entry: ScheduleLayersSnapshotEntry = ScheduleLayersSnapshot.fromRows(
      scheduleRows({ weekdaysRestriction: office }),
    ).get(SCHEDULE)!;

    expect(
      entry.layers.map((layer: OnCallDutyPolicyScheduleLayer) => {
        return [layer.id?.toString(), layer.name, layer.order];
      }),
    ).toEqual([
      [WEEKDAYS, "Weekdays", 1],
      [BACKUP, "Backup", 2],
    ]);

    const weekdays: OnCallDutyPolicyScheduleLayer = entry.layers[0]!;

    expect(weekdays).toBeInstanceOf(OnCallDutyPolicyScheduleLayer);
    expect(weekdays.onCallDutyPolicyScheduleId?.toString()).toBe(SCHEDULE);
    expect(weekdays.projectId?.toString()).toBe(PROJECT);
    expect(weekdays.description).toBe("The Weekdays rotation");
    expect(weekdays.startsAt).toEqual(AN_HOUR_AGO);
    expect(weekdays.handOffTime).toEqual(AN_HOUR_AGO);
    expect(weekdays.updatedAt).toEqual(UPDATED_AT);

    expect(weekdays.rotation).toBeInstanceOf(Recurring);
    expect(weekdays.rotation?.toJSON()).toEqual(
      rotation(EventInterval.Day, 1).toJSON(),
    );
    expect(weekdays.restrictionTimes).toBeInstanceOf(RestrictionTimes);
    expect(weekdays.restrictionTimes?.toJSON()).toEqual(office.toJSON());
  });

  test("each person in their layer, in turn order, with their user", () => {
    const entry: ScheduleLayersSnapshotEntry =
      ScheduleLayersSnapshot.fromRows(scheduleRows()).get(SCHEDULE)!;

    expect(
      entry.layerUsers.map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
        return [
          layerUser.onCallDutyPolicyScheduleLayerId?.toString(),
          layerUser.userId?.toString(),
          layerUser.user?.id?.toString(),
          layerUser.order,
        ];
      }),
    ).toEqual([
      [WEEKDAYS, ALEX, ALEX, 1],
      [WEEKDAYS, SAM, SAM, 2],
      [WEEKDAYS, KIM, KIM, 3],
      [BACKUP, RIA, RIA, 1],
    ]);

    const alex: OnCallDutyPolicyScheduleLayerUser = entry.layerUsers[0]!;

    expect(alex).toBeInstanceOf(OnCallDutyPolicyScheduleLayerUser);
    expect(alex.id?.toString()).toBe(personRowId(ALEX, WEEKDAYS));
    expect(alex.onCallDutyPolicyScheduleId?.toString()).toBe(SCHEDULE);
    expect(alex.projectId?.toString()).toBe(PROJECT);
    expect(alex.updatedAt).toEqual(UPDATED_AT);
  });

  test("a person whose user is deleted is read without one, so they take no turn", () => {
    const rows: Array<Row> = scheduleRows({ weekdays: [ALEX], backup: [] });
    rows.splice(1, 0, {
      ...scheduleColumns(SCHEDULE),
      ...layerColumns({ id: WEEKDAYS, name: "Weekdays", order: 1 }),
      ...personColumns({
        id: personRowId(GONE, WEEKDAYS),
        userId: GONE,
        order: 2,
        userFound: false,
      }),
    });

    const entry: ScheduleLayersSnapshotEntry =
      ScheduleLayersSnapshot.fromRows(rows).get(SCHEDULE)!;

    expect(entry.layerUsers).toHaveLength(2);
    expect(entry.layerUsers[1]!.userId?.toString()).toBe(GONE);
    expect(entry.layerUsers[1]!.user).toBeUndefined();
  });

  test("a layer with nobody in it is read, with nobody; a schedule with no layers, with none", () => {
    const read: Map<string, ScheduleLayersSnapshotEntry> =
      ScheduleLayersSnapshot.fromRows([
        ...scheduleRows({ backup: [] }),
        {
          ...scheduleColumns(EMPTY_SCHEDULE),
          ...layerColumns(null),
          ...personColumns(null),
        },
      ]);

    const entry: ScheduleLayersSnapshotEntry = read.get(SCHEDULE)!;
    expect(
      entry.layers.map((layer: OnCallDutyPolicyScheduleLayer) => {
        return layer.name;
      }),
    ).toEqual(["Weekdays", "Backup"]);
    expect(
      entry.layerUsers.filter(
        (layerUser: OnCallDutyPolicyScheduleLayerUser) => {
          return (
            layerUser.onCallDutyPolicyScheduleLayerId?.toString() === BACKUP
          );
        },
      ),
    ).toEqual([]);

    const empty: ScheduleLayersSnapshotEntry = read.get(EMPTY_SCHEDULE)!;
    expect(empty.schedule.id?.toString()).toBe(EMPTY_SCHEDULE);
    expect(empty.layers).toEqual([]);
    expect(empty.layerUsers).toEqual([]);
  });

  test("a layer is kept once in each schedule whose rows name it - never taken for another schedule's", () => {
    const read: Map<string, ScheduleLayersSnapshotEntry> =
      ScheduleLayersSnapshot.fromRows([
        ...scheduleRows({ weekdays: [ALEX], backup: [RIA] }),
        ...scheduleRows({
          scheduleId: OTHER_SCHEDULE,
          weekdays: [KIM],
          backup: [SAM],
        }),
      ]);

    for (const scheduleId of [SCHEDULE, OTHER_SCHEDULE]) {
      expect(
        read
          .get(scheduleId)!
          .layers.map((layer: OnCallDutyPolicyScheduleLayer) => {
            return layer.name;
          }),
      ).toEqual(["Weekdays", "Backup"]);
    }
  });

  test("several schedules, each with its own layers, by id in lower case", () => {
    const read: Map<string, ScheduleLayersSnapshotEntry> =
      ScheduleLayersSnapshot.fromRows([
        ...scheduleRows(),
        {
          ...scheduleColumns(OTHER_SCHEDULE.toUpperCase(), null),
          ...layerColumns({ id: OTHER_LAYER, name: "Nights", order: 1 }),
          ...personColumns({
            id: personRowId(SAM, OTHER_LAYER),
            userId: SAM,
            order: 1,
          }),
        },
      ]);

    expect(Array.from(read.keys())).toEqual([SCHEDULE, OTHER_SCHEDULE]);

    const other: ScheduleLayersSnapshotEntry = read.get(OTHER_SCHEDULE)!;
    expect(other.schedule.timezone).toBeUndefined();
    expect(
      other.layers.map((layer: OnCallDutyPolicyScheduleLayer) => {
        return layer.name;
      }),
    ).toEqual(["Nights"]);
    expect(other.layerUsers).toHaveLength(1);
  });
});

/*
 * A stand-in for Postgres: the rows of each schedule it holds, read the way
 * the statement reads them - the schedules asked for, in id order, cut off
 * at the cap.
 */
function fakeDatabase(rowsBySchedule: Record<string, Array<Row>>): {
  query: (sql: string, parameters: Array<unknown>) => Promise<unknown>;
  asked: Array<Array<string>>;
} {
  const asked: Array<Array<string>> = [];

  return {
    asked: asked,
    query: async (
      _sql: string,
      parameters: Array<unknown>,
    ): Promise<unknown> => {
      const ids: Array<string> = (parameters[0] as Array<string>).slice();
      const limit: number = parameters[1] as number;
      asked.push(ids);

      return ids
        .slice()
        .sort()
        .flatMap((id: string) => {
          return rowsBySchedule[id] || [];
        })
        .slice(0, limit);
    },
  };
}

describe("many schedules", () => {
  const ROWS: Record<string, Array<Row>> = {
    [SCHEDULE]: scheduleRows(),
    [OTHER_SCHEDULE]: scheduleRows({
      scheduleId: OTHER_SCHEDULE,
      layerIds: [OTHER_LAYER, OTHER_BACKUP],
      weekdays: [KIM],
      backup: [ALEX, SAM],
    }),
    [EMPTY_SCHEDULE]: [
      {
        ...scheduleColumns(EMPTY_SCHEDULE),
        ...layerColumns(null),
        ...personColumns(null),
      },
    ],
  };

  function peopleOf(
    entry: ScheduleLayersSnapshotEntry | undefined,
  ): Array<string> {
    return (entry?.layerUsers || []).map(
      (layerUser: OnCallDutyPolicyScheduleLayerUser) => {
        return layerUser.userId?.toString() || "";
      },
    );
  }

  test("one statement for them all, each asked for once, whatever the case of its id", async () => {
    const database: ReturnType<typeof fakeDatabase> = fakeDatabase(ROWS);

    const read: Map<string, ScheduleLayersSnapshotEntry> =
      await ScheduleLayersSnapshot.read({
        scheduleIds: [
          new ObjectID(SCHEDULE),
          new ObjectID(OTHER_SCHEDULE.toUpperCase()),
          new ObjectID(SCHEDULE),
        ],
        query: database.query,
      });

    expect(database.asked).toEqual([[SCHEDULE, OTHER_SCHEDULE]]);
    expect(peopleOf(read.get(SCHEDULE))).toEqual([ALEX, SAM, KIM, RIA]);
    expect(peopleOf(read.get(OTHER_SCHEDULE))).toEqual([KIM, ALEX, SAM]);
  });

  test("a schedule that does not exist is not in what is read", async () => {
    const database: ReturnType<typeof fakeDatabase> = fakeDatabase(ROWS);

    const read: Map<string, ScheduleLayersSnapshotEntry> =
      await ScheduleLayersSnapshot.read({
        scheduleIds: [
          new ObjectID(SCHEDULE),
          new ObjectID("0e931600-0000-4000-8000-0000000000ff"),
        ],
        query: database.query,
      });

    expect(Array.from(read.keys())).toEqual([SCHEDULE]);
  });

  test("a batch at a time", async () => {
    const database: ReturnType<typeof fakeDatabase> = fakeDatabase(ROWS);

    const read: Map<string, ScheduleLayersSnapshotEntry> =
      await ScheduleLayersSnapshot.read({
        scheduleIds: [SCHEDULE, OTHER_SCHEDULE, EMPTY_SCHEDULE].map(
          (id: string) => {
            return new ObjectID(id);
          },
        ),
        query: database.query,
        schedulesPerStatement: 2,
      });

    expect(database.asked).toEqual([
      [SCHEDULE, OTHER_SCHEDULE],
      [EMPTY_SCHEDULE],
    ]);
    expect(read.size).toBe(3);
  });

  test("a statement stopped by its cap: the schedule it stopped in is read again, whole, by the next one - never cut", async () => {
    const database: ReturnType<typeof fakeDatabase> = fakeDatabase(ROWS);

    // The first stops two rows into the second schedule.
    const read: Map<string, ScheduleLayersSnapshotEntry> =
      await ScheduleLayersSnapshot.read({
        scheduleIds: [SCHEDULE, OTHER_SCHEDULE, EMPTY_SCHEDULE].map(
          (id: string) => {
            return new ObjectID(id);
          },
        ),
        query: database.query,
        maxRows: 6,
      });

    expect(database.asked).toEqual([
      [SCHEDULE, OTHER_SCHEDULE, EMPTY_SCHEDULE],
      [OTHER_SCHEDULE, EMPTY_SCHEDULE],
    ]);
    expect(peopleOf(read.get(SCHEDULE))).toEqual([ALEX, SAM, KIM, RIA]);
    expect(peopleOf(read.get(OTHER_SCHEDULE))).toEqual([KIM, ALEX, SAM]);
    expect(read.get(EMPTY_SCHEDULE)?.layers).toEqual([]);
  });

  test("a statement whose cap falls at the end of a schedule keeps it, and reads the next one whole", async () => {
    const database: ReturnType<typeof fakeDatabase> = fakeDatabase(ROWS);
    const error: SpyInstance<typeof logger.error> = jest.spyOn(logger, "error");

    // The first holds exactly the first schedule: four rows.
    const read: Map<string, ScheduleLayersSnapshotEntry> =
      await ScheduleLayersSnapshot.read({
        scheduleIds: [new ObjectID(SCHEDULE), new ObjectID(OTHER_SCHEDULE)],
        query: database.query,
        maxRows: 4,
      });

    expect(database.asked).toEqual([
      [SCHEDULE, OTHER_SCHEDULE],
      [OTHER_SCHEDULE],
    ]);
    expect(peopleOf(read.get(SCHEDULE))).toEqual([ALEX, SAM, KIM, RIA]);
    expect(peopleOf(read.get(OTHER_SCHEDULE))).toEqual([KIM, ALEX, SAM]);
    // A schedule as big as the cap is not more than it.
    expect(error).not.toHaveBeenCalled();
  });

  test("a schedule exactly as big as the cap, read on its own: whole, and nothing said", async () => {
    const database: ReturnType<typeof fakeDatabase> = fakeDatabase(ROWS);
    const error: SpyInstance<typeof logger.error> = jest.spyOn(logger, "error");

    const read: Map<string, ScheduleLayersSnapshotEntry> =
      await ScheduleLayersSnapshot.read({
        scheduleIds: [new ObjectID(SCHEDULE)],
        query: database.query,
        maxRows: 4,
      });

    expect(database.asked).toEqual([[SCHEDULE]]);
    expect(peopleOf(read.get(SCHEDULE))).toEqual([ALEX, SAM, KIM, RIA]);
    expect(error).not.toHaveBeenCalled();
  });

  test("rows that name no schedule end the read rather than ask again", async () => {
    const query: Mock<
      (sql: string, parameters: Array<unknown>) => Promise<unknown>
    > = jest.fn(async () => {
      return [{}, {}, {}] as unknown;
    });

    const read: Map<string, ScheduleLayersSnapshotEntry> =
      await ScheduleLayersSnapshot.read({
        scheduleIds: [new ObjectID(SCHEDULE)],
        query: query,
        maxRows: 1,
      });

    expect(read.size).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("one schedule bigger than the cap on its own: worked out from what one statement holds, and said so", async () => {
    const database: ReturnType<typeof fakeDatabase> = fakeDatabase(ROWS);
    const error: SpyInstance<typeof logger.error> = jest.spyOn(logger, "error");

    const read: Map<string, ScheduleLayersSnapshotEntry> =
      await ScheduleLayersSnapshot.read({
        scheduleIds: [new ObjectID(SCHEDULE), new ObjectID(OTHER_SCHEDULE)],
        query: database.query,
        maxRows: 2,
      });

    expect(peopleOf(read.get(SCHEDULE))).toEqual([ALEX, SAM]);
    expect(peopleOf(read.get(OTHER_SCHEDULE))).toEqual([KIM, ALEX]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(`on-call schedule ${SCHEDULE}`),
    );
  });

  test("nothing asked, nothing read; an answer that is not rows reads as none", async () => {
    const query: Mock<
      (sql: string, parameters: Array<unknown>) => Promise<unknown>
    > = jest.fn(async () => {
      return { rows: "not an array" } as unknown;
    });

    expect(
      (await ScheduleLayersSnapshot.read({ scheduleIds: [], query: query }))
        .size,
    ).toBe(0);
    expect(query).not.toHaveBeenCalled();

    expect(
      (
        await ScheduleLayersSnapshot.read({
          scheduleIds: [new ObjectID(SCHEDULE)],
          query: query,
        })
      ).size,
    ).toBe(0);
  });
});

/*
 * The schedule service reading through it, against the stand-in: the
 * statements it sends are counted, and the three reads it used to make
 * refuse to be made.
 */
describe("the schedule service reads a schedule's layers in one statement", () => {
  let database: ReturnType<typeof fakeDatabase>;
  let rows: Record<string, Array<Row>>;

  beforeEach(() => {
    rows = {
      [SCHEDULE]: scheduleRows(),
      [OTHER_SCHEDULE]: scheduleRows({
        scheduleId: OTHER_SCHEDULE,
        layerIds: [OTHER_LAYER, OTHER_BACKUP],
        weekdays: [KIM, SAM],
      }),
    };
    database = fakeDatabase(rows);

    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getRepository")
      .mockReturnValue({
        manager: {
          query: async (
            sql: string,
            parameters: Array<unknown>,
          ): Promise<unknown> => {
            return await database.query(sql, parameters);
          },
        },
      } as never);

    // The reads it used to make, one after another: never made now.
    const refused: () => Promise<never> = async (): Promise<never> => {
      throw new Error("The layers are read in one statement, not this one.");
    };
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerService, "findBy")
      .mockImplementation(refused as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockImplementation(refused as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findOneById")
      .mockImplementation(refused as never);

    // Nobody is away.
    jest
      .spyOn(OnCallDutyPolicyUserOverrideService, "findBy")
      .mockResolvedValue([] as never);
  });

  test("the layer props: the layers by priority, each one's people by turn, the schedule's timezone on each", async () => {
    const read: ScheduleLayerProps =
      await OnCallDutyPolicyScheduleService.getScheduleLayerProps({
        scheduleId: new ObjectID(SCHEDULE),
      });

    expect(database.asked).toEqual([[SCHEDULE]]);
    expect(layersOf(read.layerProps)).toEqual([
      { layer: "Weekdays", people: [ALEX, SAM, KIM] },
      { layer: "Backup", people: [RIA] },
    ]);
    expect(
      read.layerProps.map((layer: LayerProps) => {
        return [layer.layerId, layer.timezone];
      }),
    ).toEqual([
      [WEEKDAYS, "UTC"],
      [BACKUP, "UTC"],
    ]);
    expect(read.layerProps[0]!.rotation).toBeInstanceOf(Recurring);
    expect(read.layerProps[0]!.restrictionTimes).toBeInstanceOf(
      RestrictionTimes,
    );
    expect(read.layerProps[0]!.startDateTimeOfLayer).toEqual(AN_HOUR_AGO);
    expect(read.projectId?.toString()).toBe(PROJECT);
    expect(
      read.scheduleUserIds.map((userId: ObjectID) => {
        return userId.toString();
      }),
    ).toEqual([ALEX, SAM, KIM, RIA]);
  });

  test("a schedule with no timezone: the layers have none either, as before", async () => {
    rows[SCHEDULE] = scheduleRows({ timezone: null });

    const read: ScheduleLayerProps =
      await OnCallDutyPolicyScheduleService.getScheduleLayerProps({
        scheduleId: new ObjectID(SCHEDULE),
      });

    expect(
      read.layerProps.map((layer: LayerProps) => {
        return layer.timezone;
      }),
    ).toEqual([undefined, undefined]);
  });

  test("a schedule that does not exist: no layers, no project, nobody", async () => {
    const read: ScheduleLayerProps =
      await OnCallDutyPolicyScheduleService.getScheduleLayerProps({
        scheduleId: new ObjectID("0e931600-0000-4000-8000-0000000000ff"),
      });

    expect(read).toEqual({
      layerProps: [],
      projectId: null,
      scheduleUserIds: [],
    });
  });

  test("a page: who is on call, from one statement", async () => {
    const onCall: CurrentOnCallInSchedule | null =
      await OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule(
        new ObjectID(SCHEDULE),
      );

    expect(onCall?.userId.toString()).toBe(ALEX);
    expect(database.asked).toHaveLength(1);
  });

  test("the next in rotation, from one statement", async () => {
    const next: NextInRotationInSchedule | null =
      await OnCallDutyPolicyScheduleService.getNextInRotationInSchedule(
        new ObjectID(SCHEDULE),
      );

    expect(next?.onCallUserId.toString()).toBe(ALEX);
    expect(next?.nextUserId?.toString()).toBe(SAM);
    expect(database.asked).toHaveLength(1);
  });

  test("the lookups of one go share one read: who is on call and who is next, from one statement", async () => {
    const layerReads: ScheduleLayerReads = new Map<
      string,
      Promise<ScheduleLayerProps>
    >();

    const onCall: CurrentOnCallInSchedule | null =
      await OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule(
        new ObjectID(SCHEDULE),
        { layerReads: layerReads },
      );

    // A save lands now: Kim to the top.
    rows[SCHEDULE] = scheduleRows({ weekdays: [KIM, ALEX, SAM] });

    const next: NextInRotationInSchedule | null =
      await OnCallDutyPolicyScheduleService.getNextInRotationInSchedule(
        new ObjectID(SCHEDULE.toUpperCase()),
        { layerReads: layerReads },
      );

    expect(database.asked).toHaveLength(1);
    // Both from the layers as they were: Alex on call, Sam next - not Alex twice.
    expect(onCall?.userId.toString()).toBe(ALEX);
    expect(next?.onCallUserId.toString()).toBe(ALEX);
    expect(next?.nextUserId?.toString()).toBe(SAM);
    expect(Array.from(layerReads.keys())).toEqual([SCHEDULE]);

    // Asked again apart from that go: as they are now.
    const now: CurrentOnCallInSchedule | null =
      await OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule(
        new ObjectID(SCHEDULE),
      );
    expect(now?.userId.toString()).toBe(KIM);
    expect(database.asked).toHaveLength(2);
  });

  test("the roster: who is on call, who is next and since when, from one read of the layers", async () => {
    const roster: {
      currentUserId: ObjectID | null;
      rosterStartAt: Date | null;
      nextUserId: ObjectID | null;
    } =
      await OnCallDutyPolicyScheduleService.getCurrrentUserIdAndHandoffTimeInSchedule(
        new ObjectID(SCHEDULE),
      );

    expect(roster.currentUserId?.toString()).toBe(ALEX);
    expect(roster.nextUserId?.toString()).toBe(SAM);
    // Since the rotation began, an hour ago - not now, where the read is clamped.
    expect(roster.rosterStartAt?.getTime()).toBe(AN_HOUR_AGO.getTime());
    expect(database.asked).toEqual([[SCHEDULE]]);
  });

  test("the calendar feeds, my shifts and reminders: every schedule in one statement, beside the policies they are attached to", async () => {
    const attachments: SpyInstance<
      typeof OnCallDutyPolicyEscalationRuleScheduleService.findBy
    > = jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockResolvedValue([] as never);

    const resolved: Array<ResolvedShiftSegments> =
      await OnCallDutyPolicyScheduleService.getResolvedShiftSegmentsForSchedules(
        {
          scheduleIds: [new ObjectID(SCHEDULE), new ObjectID(OTHER_SCHEDULE)],
          windowStart: new Date(),
          windowEnd: new Date(Date.now() + 60 * 60 * 1000),
        },
      );

    expect(database.asked).toEqual([[SCHEDULE, OTHER_SCHEDULE]]);
    expect(attachments).toHaveBeenCalledTimes(1);
    expect(
      resolved.map((item: ResolvedShiftSegments) => {
        return [
          item.schedule.id,
          item.segments.map((segment: CalendarEvent) => {
            return segment.title;
          }),
          layersOf(item.layerProps),
        ];
      }),
    ).toEqual([
      [
        SCHEDULE,
        [ALEX],
        [
          { layer: "Weekdays", people: [ALEX, SAM, KIM] },
          { layer: "Backup", people: [RIA] },
        ],
      ],
      [
        OTHER_SCHEDULE,
        [KIM],
        [
          { layer: "Weekdays", people: [KIM, SAM] },
          { layer: "Backup", people: [RIA] },
        ],
      ],
    ]);
    // The schedule row is no part of when its shifts last changed.
    expect(resolved[0]!.lastModifiedAt).toEqual(UPDATED_AT);
    expect(resolved[0]!.schedule.shiftConfigVersion).toBe(7);
  });
});
