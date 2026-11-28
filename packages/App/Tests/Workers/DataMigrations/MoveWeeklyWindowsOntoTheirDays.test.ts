import MoveWeeklyWindowsOntoTheirDays, {
  FILL_IN_DAYS_SQL,
  MOVE_ONTO_DAYS_SQL,
  PAGE_SIZE,
  READ_LAYERS_SQL,
  StoredLayerRead,
  describeWindows,
  readStoredLayer,
} from "../../../FeatureSet/Workers/DataMigrations/MoveWeeklyWindowsOntoTheirDays";
import DataMigrations from "../../../FeatureSet/Workers/DataMigrations/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import OnCallDutyPolicyScheduleLayerService from "Common/Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import logger from "Common/Server/Utils/Logger";
import { OnCallShiftChangeReason } from "Common/Server/Utils/OnCall/OnCallShiftChangeListeners";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RestrictionTimes from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import { StoredWindowState } from "Common/Types/OnCallDutyPolicy/WeeklyWindowDays";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE WEEKLY WINDOWS STORED ON OTHER DAYS THAN THEY NAME (#11455), READ
 * AGAIN ONCE.
 *
 * What each stored layer comes to - filled in, moved onto its days, or left
 * as it pages to be checked - and what the migration sends for it: the
 * statement, the value it writes and the one the row must still hold, and
 * which schedules it tells. Its Postgres suite runs the statements.
 */

const WARSAW: string = "Europe/Warsaw";
const NEW_YORK: string = "America/New_York";

function dateTime(iso: string): JSONObject {
  return { _type: "DateTime", value: iso };
}

function weekly(windows: Array<JSONObject>, key?: string): JSONObject {
  return {
    _type: "RestrictionTimes",
    value: {
      [key || "restrictionType"]: "Weekly",
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: windows,
    },
  };
}

function windowsOf(stored: JSONObject | null): Array<JSONObject> {
  return ((stored!["value"] as JSONObject)["weeklyRestrictionTimes"] ||
    []) as Array<JSONObject>;
}

// "Monday 09:00": a stored time's weekday and time of day on a zone's clock.
function clockOf(value: unknown, zone: string): string {
  const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: zone,
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    },
  ).formatToParts(RestrictionTimes.readMoment(value)!);

  const part: (type: string) => string = (type: string): string => {
    return (
      parts.find((candidate: Intl.DateTimeFormatPart): boolean => {
        return candidate.type === type;
      })?.value || ""
    );
  };

  return `${part("weekday")} ${part("hour")}:${part("minute")}`;
}

// On its days in Warsaw: Monday 09:00 to 17:00.
const ON_ITS_DAYS: JSONObject = {
  startDay: "Monday",
  endDay: "Monday",
  startTime: dateTime("2026-01-05T08:00:00.000Z"),
  endTime: dateTime("2026-01-05T16:00:00.000Z"),
};

// The issue's: named Monday, dated on a Wednesday.
const DATED_WRONG: JSONObject = {
  startDay: "Monday",
  endDay: "Monday",
  startTime: dateTime("2026-01-07T08:00:00.000Z"),
  endTime: dateTime("2026-01-07T16:00:00.000Z"),
};

// Monday 01:00 to 09:00 set in Warsaw, read in New York: from Sunday 19:00.
const ANOTHER_ZONE: JSONObject = {
  startDay: "Monday",
  endDay: "Monday",
  startTime: dateTime("2026-01-05T00:00:00.000Z"),
  endTime: dateTime("2026-01-05T08:00:00.000Z"),
};

// Written without days.
const DAYS_LEFT_OUT: JSONObject = {
  startTime: dateTime("2026-01-09T16:00:00.000Z"),
  endTime: dateTime("2026-01-12T07:00:00.000Z"),
};

describe("readStoredLayer", () => {
  test("windows on their days: nothing to store", () => {
    const read: StoredLayerRead = readStoredLayer(
      weekly([ON_ITS_DAYS]),
      WARSAW,
    )!;

    expect(read.stored).toBeNull();
    expect(read.pagesOtherwise).toBe(false);
  });

  test("REGRESSION #11455: the issue's window is moved onto Monday, at its time of day, and pages otherwise from now on", () => {
    const read: StoredLayerRead = readStoredLayer(
      weekly([DATED_WRONG]),
      WARSAW,
    )!;

    expect(read.pagesOtherwise).toBe(true);
    expect(read.stored).toEqual({
      _type: "RestrictionTimes",
      value: {
        restrictionType: "Weekly",
        dayRestrictionTimes: null,
        weeklyRestrictionTimes: [
          {
            startDay: "Monday",
            endDay: "Monday",
            startTime: dateTime("2026-01-05T08:00:00.000Z"),
            endTime: dateTime("2026-01-05T16:00:00.000Z"),
          },
        ],
      },
    });
  });

  test("days left out are filled in, paging as before", () => {
    const read: StoredLayerRead = readStoredLayer(
      weekly([DAYS_LEFT_OUT]),
      WARSAW,
    )!;

    expect(read.pagesOtherwise).toBe(false);
    expect(windowsOf(read.stored)).toEqual([
      { ...DAYS_LEFT_OUT, startDay: "Friday", endDay: "Monday" },
    ]);
  });

  test("a window a change of zone moved is left as it pages, to be checked", () => {
    const read: StoredLayerRead = readStoredLayer(
      weekly([ANOTHER_ZONE]),
      NEW_YORK,
    )!;

    expect(read.stored).toBeNull();
    expect(read.pagesOtherwise).toBe(false);
    expect(read.repair.repairs[0]!.state).toBe(StoredWindowState.ToCheck);
  });

  test("one window of each: the moved and filled-in ones are stored, the others kept exactly", () => {
    const read: StoredLayerRead = readStoredLayer(
      weekly([ON_ITS_DAYS, DATED_WRONG, DAYS_LEFT_OUT]),
      WARSAW,
    )!;

    expect(read.pagesOtherwise).toBe(true);
    const windows: Array<JSONObject> = windowsOf(read.stored);
    expect(windows[0]).toEqual(ON_ITS_DAYS);
    expect(clockOf(windows[1]!["startTime"], WARSAW)).toBe("Monday 09:00");
    expect(windows[2]!["startDay"]).toBe("Friday");
  });

  test("the older spelling is read, and the layer stored with the type under its name", () => {
    const read: StoredLayerRead = readStoredLayer(
      weekly([DATED_WRONG], "restictionType"),
      WARSAW,
    )!;

    expect(read.pagesOtherwise).toBe(true);
    const value: JSONObject = read.stored!["value"] as JSONObject;
    expect(value["restrictionType"]).toBe("Weekly");
    expect("restictionType" in value).toBe(false);
  });

  test("a schedule without a zone is read on the server's clock (UTC here): a time some zone puts on its day is left", () => {
    expect(
      readStoredLayer(
        weekly([
          {
            startDay: "Monday",
            endDay: "Monday",
            startTime: dateTime("2026-01-04T23:30:00.000Z"),
            endTime: dateTime("2026-01-05T07:00:00.000Z"),
          },
        ]),
        null,
      )!.stored,
    ).toBeNull();

    const datedWrong: StoredLayerRead = readStoredLayer(
      weekly([DATED_WRONG]),
      null,
    )!;
    expect(datedWrong.pagesOtherwise).toBe(true);
    expect(clockOf(windowsOf(datedWrong.stored)[0]!["startTime"], "UTC")).toBe(
      "Monday 08:00",
    );
  });

  test("a restriction that is not Weekly, or no restriction this reads, is left alone", () => {
    for (const raw of [
      null,
      "Weekly",
      [],
      { _type: "Recurring", value: {} },
      { _type: "RestrictionTimes" },
      {
        _type: "RestrictionTimes",
        value: {
          restrictionType: "Daily",
          dayRestrictionTimes: {
            startTime: dateTime("2026-01-07T08:00:00.000Z"),
            endTime: dateTime("2026-01-07T16:00:00.000Z"),
          },
          weeklyRestrictionTimes: [DATED_WRONG],
        },
      },
      {
        _type: "RestrictionTimes",
        value: { restrictionType: "None", weeklyRestrictionTimes: [] },
      },
    ]) {
      expect(readStoredLayer(raw, WARSAW)).toBeNull();
    }
  });

  test("read again, what it stores has nothing more to store", () => {
    for (const windows of [
      [DATED_WRONG],
      [DAYS_LEFT_OUT],
      [ON_ITS_DAYS, DATED_WRONG, DAYS_LEFT_OUT],
    ]) {
      const read: StoredLayerRead = readStoredLayer(weekly(windows), WARSAW)!;
      expect(readStoredLayer(read.stored, WARSAW)!.stored).toBeNull();
    }
  });
});

describe("describeWindows", () => {
  test("each window in a state, by its place, with the days it names and falls on", () => {
    const read: StoredLayerRead = readStoredLayer(
      weekly([ON_ITS_DAYS, ANOTHER_ZONE, DATED_WRONG]),
      NEW_YORK,
    )!;

    // One layer can hold a window to check and one to move.
    expect(describeWindows(read.repair, StoredWindowState.ToCheck)).toBe(
      "#1 names Monday-Monday, its times fall on Sunday-Monday",
    );
    expect(describeWindows(read.repair, StoredWindowState.Agrees)).toBe(
      "#0 names Monday-Monday, its times fall on Monday-Monday",
    );
    expect(
      describeWindows(read.repair, StoredWindowState.MovedOntoItsDays),
    ).toBe("#2 names Monday-Monday, its times fall on Wednesday-Wednesday");

    const onlyToCheck: StoredLayerRead = readStoredLayer(
      weekly([ANOTHER_ZONE]),
      NEW_YORK,
    )!;
    expect(describeWindows(onlyToCheck.repair, StoredWindowState.ToCheck)).toBe(
      "#0 names Monday-Monday, its times fall on Sunday-Monday",
    );
  });
});

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

interface StoredLayerRow {
  id: string;
  projectId: string | null;
  scheduleId: string | null;
  restrictionTimes: unknown;
  timezone: string | null;
}

function stubRepository(data: {
  rows: Array<StoredLayerRow>;
  // Ids saved since they were read: their write finds nothing.
  savedSince?: Array<string>;
}): Array<Statement> {
  const statements: Array<Statement> = [];

  const query: jest.Mock = jest.fn(
    async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
      statements.push({ sql, parameters });

      if (sql === READ_LAYERS_SQL) {
        const after: string = parameters[0] as string;
        const limit: number = parameters[1] as number;

        return data.rows
          .filter((row: StoredLayerRow): boolean => {
            return row.id > after;
          })
          .sort((a: StoredLayerRow, b: StoredLayerRow): number => {
            return a.id < b.id ? -1 : 1;
          })
          .slice(0, limit);
      }

      const id: string = parameters[0] as string;
      const written: Array<{ id: string }> = (data.savedSince || []).includes(
        id,
      )
        ? []
        : [{ id: id }];

      return [written, written.length];
    },
  ) as unknown as jest.Mock;

  jest
    .spyOn(
      OnCallDutyPolicyScheduleLayerService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue({ manager: { query } } as never);

  return statements;
}

function id(index: number): string {
  return `11455222-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

describe("MoveWeeklyWindowsOntoTheirDays.migrate", () => {
  let refreshed: Array<string>;
  let propagated: Array<{ ids: Array<string>; reason: unknown }>;
  let infos: Array<string>;

  beforeEach(() => {
    refreshed = [];
    propagated = [];
    infos = [];

    jest.spyOn(logger, "info").mockImplementation(((message: unknown) => {
      infos.push(String(message));
    }) as never);
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);

    jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "refreshCurrentUserIdAndHandoffTimeInSchedule",
      )
      .mockImplementation((async (scheduleId: ObjectID) => {
        refreshed.push(scheduleId.toString());
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
      .mockImplementation((async (data: {
        scheduleIds: Array<ObjectID>;
        reason: unknown;
      }) => {
        propagated.push({
          ids: data.scheduleIds.map((scheduleId: ObjectID): string => {
            return scheduleId.toString();
          }),
          reason: data.reason,
        });
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("REGRESSION #11455: the issue's layer is moved onto its days with a new version, while it still holds what was read, and its schedule told once", async () => {
    const statements: Array<Statement> = stubRepository({
      rows: [
        {
          id: id(1),
          projectId: "project-1",
          scheduleId: "schedule-1",
          restrictionTimes: weekly([DATED_WRONG]),
          timezone: WARSAW,
        },
        {
          id: id(2),
          projectId: "project-1",
          scheduleId: "schedule-1",
          restrictionTimes: weekly([DATED_WRONG, ON_ITS_DAYS]),
          timezone: WARSAW,
        },
      ],
    });

    await new MoveWeeklyWindowsOntoTheirDays().migrate();

    const writes: Array<Statement> = statements.filter(
      (statement: Statement): boolean => {
        return statement.sql !== READ_LAYERS_SQL;
      },
    );

    expect(
      writes.map((statement: Statement) => {
        return statement.sql;
      }),
    ).toEqual([MOVE_ONTO_DAYS_SQL, MOVE_ONTO_DAYS_SQL]);
    expect(writes[0]!.parameters[0]).toBe(id(1));
    expect(
      clockOf(
        windowsOf(JSON.parse(writes[0]!.parameters[1] as string))[0]![
          "startTime"
        ],
        WARSAW,
      ),
    ).toBe("Monday 09:00");
    // Written only while the row holds what was read.
    expect(JSON.parse(writes[0]!.parameters[2] as string)).toEqual(
      weekly([DATED_WRONG]),
    );

    expect(refreshed).toEqual(["schedule-1"]);
    expect(propagated).toEqual([
      { ids: ["schedule-1"], reason: OnCallShiftChangeReason.LayerChanged },
    ]);
    expect(
      infos.some((line: string): boolean => {
        return line.includes(
          `moved the weekly windows of on-call schedule layer ${id(1)} (schedule schedule-1, project project-1) onto the days they name, in Europe/Warsaw: #0 names Monday-Monday, its times fall on Wednesday-Wednesday`,
        );
      }),
    ).toBe(true);
  });

  test("days filled in are written without a new version, and nobody is told", async () => {
    const statements: Array<Statement> = stubRepository({
      rows: [
        {
          id: id(1),
          projectId: "project-1",
          scheduleId: "schedule-1",
          restrictionTimes: weekly([DAYS_LEFT_OUT]),
          timezone: WARSAW,
        },
      ],
    });

    await new MoveWeeklyWindowsOntoTheirDays().migrate();

    const writes: Array<Statement> = statements.filter(
      (statement: Statement): boolean => {
        return statement.sql !== READ_LAYERS_SQL;
      },
    );
    expect(
      writes.map((statement: Statement) => {
        return statement.sql;
      }),
    ).toEqual([FILL_IN_DAYS_SQL]);
    expect(refreshed).toEqual([]);
    expect(propagated).toEqual([]);
  });

  test("a window to check is not written, and logged with what it names and pages on", async () => {
    const statements: Array<Statement> = stubRepository({
      rows: [
        {
          id: id(1),
          projectId: "project-1",
          scheduleId: "schedule-2",
          restrictionTimes: weekly([ANOTHER_ZONE]),
          timezone: NEW_YORK,
        },
      ],
    });

    await new MoveWeeklyWindowsOntoTheirDays().migrate();

    expect(
      statements.filter((statement: Statement): boolean => {
        return statement.sql !== READ_LAYERS_SQL;
      }),
    ).toEqual([]);
    expect(refreshed).toEqual([]);
    expect(
      infos.some((line: string): boolean => {
        return (
          line.includes(
            `layer ${id(1)} (schedule schedule-2, project project-1)`,
          ) &&
          line.includes(
            "in America/New_York, but on those days in another zone",
          ) &&
          line.includes(
            "#0 names Monday-Monday, its times fall on Sunday-Monday",
          )
        );
      }),
    ).toBe(true);
    expect(infos[infos.length - 1]).toContain(
      "0 layer(s) moved onto the days their weekly windows name, across 0 schedule(s); 0 layer(s) had their windows' days filled in, paging as before; 1 layer(s) have windows to check, left as they page.",
    );
  });

  test("a layer saved between the read and the write keeps the save, and nobody is told", async () => {
    stubRepository({
      rows: [
        {
          id: id(1),
          projectId: "project-1",
          scheduleId: "schedule-1",
          restrictionTimes: weekly([DATED_WRONG]),
          timezone: WARSAW,
        },
      ],
      savedSince: [id(1)],
    });

    await new MoveWeeklyWindowsOntoTheirDays().migrate();

    expect(refreshed).toEqual([]);
    expect(propagated).toEqual([]);
  });

  test("every page is read, on the layer's id, and each schedule told once however many of its layers moved", async () => {
    const rows: Array<StoredLayerRow> = [];

    for (let index: number = 1; index <= PAGE_SIZE + 3; index++) {
      rows.push({
        id: id(index),
        projectId: "project-1",
        scheduleId: index % 2 === 0 ? "schedule-even" : "schedule-odd",
        restrictionTimes: weekly([index % 3 === 0 ? DATED_WRONG : ON_ITS_DAYS]),
        timezone: WARSAW,
      });
    }

    const statements: Array<Statement> = stubRepository({ rows: rows });

    await new MoveWeeklyWindowsOntoTheirDays().migrate();

    const reads: Array<Statement> = statements.filter(
      (statement: Statement): boolean => {
        return statement.sql === READ_LAYERS_SQL;
      },
    );
    expect(
      reads.map((statement: Statement) => {
        return statement.parameters;
      }),
    ).toEqual([
      ["00000000-0000-0000-0000-000000000000", PAGE_SIZE],
      [id(PAGE_SIZE), PAGE_SIZE],
    ]);

    const moved: Array<string> = statements
      .filter((statement: Statement): boolean => {
        return statement.sql === MOVE_ONTO_DAYS_SQL;
      })
      .map((statement: Statement): string => {
        return statement.parameters[0] as string;
      });
    expect(moved).toEqual(
      rows
        .filter((_row: StoredLayerRow, index: number): boolean => {
          return (index + 1) % 3 === 0;
        })
        .map((row: StoredLayerRow): string => {
          return row.id;
        }),
    );

    expect(refreshed.sort()).toEqual(["schedule-even", "schedule-odd"]);
    expect(propagated).toHaveLength(2);
  });

  test("a schedule whose roster cannot be worked out now is still propagated", async () => {
    stubRepository({
      rows: [
        {
          id: id(1),
          projectId: null,
          scheduleId: "schedule-1",
          restrictionTimes: weekly([DATED_WRONG]),
          timezone: WARSAW,
        },
      ],
    });

    jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "refreshCurrentUserIdAndHandoffTimeInSchedule",
      )
      .mockRejectedValue(new Error("schedule deleted meanwhile") as never);

    await new MoveWeeklyWindowsOntoTheirDays().migrate();

    expect(propagated).toEqual([
      { ids: ["schedule-1"], reason: OnCallShiftChangeReason.LayerChanged },
    ]);
  });

  test("rolled back, nothing is undone", async () => {
    const statements: Array<Statement> = stubRepository({ rows: [] });

    await new MoveWeeklyWindowsOntoTheirDays().rollback();

    expect(statements).toEqual([]);
  });
});

describe("its place among the data migrations", () => {
  test("registered once, after the restriction type repair, before the two slots kept last", () => {
    const names: Array<string> = DataMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === "MoveWeeklyWindowsOntoTheirDays";
      }),
    ).toHaveLength(1);
    expect(names.indexOf("MoveWeeklyWindowsOntoTheirDays")).toBeGreaterThan(
      names.indexOf("RepairScheduleLayerRestrictionTypes"),
    );
    expect(names.indexOf("MoveWeeklyWindowsOntoTheirDays")).toBeLessThan(
      names.indexOf("BackfillIncidentCallTranscriptSignInAccount"),
    );
    expect(new MoveWeeklyWindowsOntoTheirDays().name).toBe(
      "MoveWeeklyWindowsOntoTheirDays",
    );
  });

  test("its statements read and write only the layers not deleted, and only while they hold what was read", () => {
    expect(READ_LAYERS_SQL).toContain('"layer"."deletedAt" IS NULL');
    expect(READ_LAYERS_SQL).toContain(
      'LEFT JOIN "OnCallDutyPolicySchedule" "schedule" ON "schedule"."_id" = "layer"."onCallDutyPolicyScheduleId"',
    );
    for (const sql of [FILL_IN_DAYS_SQL, MOVE_ONTO_DAYS_SQL]) {
      expect(sql).toContain('"deletedAt" IS NULL');
      expect(sql).toContain('"restrictionTimes" = $3::jsonb');
    }
    expect(MOVE_ONTO_DAYS_SQL).toContain('"version" = "version" + 1');
    expect(FILL_IN_DAYS_SQL).not.toContain('"version"');
  });
});
