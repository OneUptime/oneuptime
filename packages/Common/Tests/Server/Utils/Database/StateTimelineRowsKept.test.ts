import StateTimelineRowsKept, {
  BoundRowsKept,
  RowsKeptOnDeleteRule,
} from "../../../../Server/Utils/Database/StateTimelineRowsKept";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  KEPT_STATUS_HISTORY_DAYS,
  ROWS_KEPT_ON_DELETE_BY_QUERY,
} from "../../../../Types/StateTimeline/RowsKeptOnDelete";
import { describe, expect, test } from "@jest/globals";

/*
 * The rows of a state timeline a delete by query leaves, as the SQL
 * DatabaseService narrows the delete with. What the SQL keeps on real rows -
 * open, closed, tied, orphaned, deleted, at the boundary - is proved against
 * Postgres in StateTimelineRowsKeptPostgres; this pins its shape, its
 * parameters and what it refuses to write.
 */

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

const ruleFor: (tableName: string) => RowsKeptOnDeleteRule = (
  tableName: string,
): RowsKeptOnDeleteRule => {
  return StateTimelineRowsKept.forTable(tableName, {
    now: (): Date => {
      return NOW;
    },
  });
};

// The parameter a binding names, as the SQL writes it.
const PARAMETER_NAME: RegExp = /^keptHistoryFrom[A-Za-z]{10}$/;

describe("StateTimelineRowsKept.forTable", () => {
  test("has a rule for every state timeline, carrying its words", () => {
    for (const [tableName, kept] of Object.entries(
      ROWS_KEPT_ON_DELETE_BY_QUERY,
    )) {
      const rule: RowsKeptOnDeleteRule = ruleFor(tableName);

      expect(rule.tableName).toBe(tableName);
      expect(rule.kept).toBe(kept);
    }
  });

  test("refuses a table that is not a state timeline", () => {
    expect(() => {
      StateTimelineRowsKept.forTable("Monitor");
    }).toThrow(BadDataException);
  });

  test("binds the oldest moment of the kept history, 90 days before now, for a status timeline", () => {
    const bound: BoundRowsKept = ruleFor("MonitorStatusTimeline").bind();
    const names: Array<string> = Object.keys(bound.parameters);

    expect(names.length).toBe(1);
    expect(names[0]!).toMatch(PARAMETER_NAME);

    const from: Date = bound.parameters[names[0]!] as Date;
    expect(NOW.getTime() - from.getTime()).toBe(
      KEPT_STATUS_HISTORY_DAYS * 24 * 60 * 60 * 1000,
    );
  });

  test("reads the clock when it binds, not when it is made", () => {
    let now: Date = new Date("2026-01-01T00:00:00.000Z");

    const rule: RowsKeptOnDeleteRule = StateTimelineRowsKept.forTable(
      "MonitorStatusTimeline",
      {
        now: (): Date => {
          return now;
        },
      },
    );

    const first: BoundRowsKept = rule.bind();
    now = new Date("2026-06-01T00:00:00.000Z");
    const second: BoundRowsKept = rule.bind();

    expect(Object.values(first.parameters)[0]).not.toEqual(
      Object.values(second.parameters)[0],
    );
  });

  test("names the parameter afresh each binding, so two in one statement never share a name", () => {
    const rule: RowsKeptOnDeleteRule = ruleFor("NetworkSiteStatusTimeline");
    const names: Set<string> = new Set<string>();

    for (let index: number = 0; index < 20; index++) {
      names.add(Object.keys(rule.bind().parameters)[0]!);
    }

    expect(names.size).toBe(20);
  });

  test("binds nothing for a timeline that keeps its current row alone", () => {
    for (const tableName of [
      "IncidentStateTimeline",
      "AlertStateTimeline",
      "ScheduledMaintenanceStateTimeline",
      "IncidentEpisodeStateTimeline",
      "AlertEpisodeStateTimeline",
    ]) {
      expect(ruleFor(tableName).bind().parameters).toEqual({});
    }
  });
});

describe("the SQL of a row that stays", () => {
  test("for a status timeline: a live row that is current, or not over before the kept history", () => {
    const bound: BoundRowsKept = ruleFor("MonitorStatusTimeline").bind();
    const parameter: string = Object.keys(bound.parameters)[0]!;
    const sql: string = bound.sqlForRowKept('"MonitorStatusTimeline"');

    expect(sql).toBe(
      `("MonitorStatusTimeline"."deletedAt" IS NULL AND NOT (CASE WHEN "MonitorStatusTimeline"."endsAt" IS NOT NULL ` +
        `THEN ("MonitorStatusTimeline"."endsAt" <= :${parameter} AND EXISTS (SELECT 1 FROM "MonitorStatusTimeline" AS "rowKeptOnDeleteLater" WHERE "rowKeptOnDeleteLater"."monitorId" = "MonitorStatusTimeline"."monitorId" AND "rowKeptOnDeleteLater"."deletedAt" IS NULL AND "rowKeptOnDeleteLater"."startsAt" >= "MonitorStatusTimeline"."startsAt" AND ("rowKeptOnDeleteLater"."startsAt", COALESCE("rowKeptOnDeleteLater"."endsAt", CAST('infinity' AS timestamptz)), "rowKeptOnDeleteLater"."_id") > ("MonitorStatusTimeline"."startsAt", COALESCE("MonitorStatusTimeline"."endsAt", CAST('infinity' AS timestamptz)), "MonitorStatusTimeline"."_id"))) ` +
        `ELSE EXISTS (SELECT 1 FROM "MonitorStatusTimeline" AS "rowKeptOnDeleteLater" WHERE "rowKeptOnDeleteLater"."monitorId" = "MonitorStatusTimeline"."monitorId" AND "rowKeptOnDeleteLater"."deletedAt" IS NULL AND "rowKeptOnDeleteLater"."startsAt" >= "MonitorStatusTimeline"."startsAt" AND ("rowKeptOnDeleteLater"."startsAt", COALESCE("rowKeptOnDeleteLater"."endsAt", CAST('infinity' AS timestamptz)), "rowKeptOnDeleteLater"."_id") > ("MonitorStatusTimeline"."startsAt", COALESCE("MonitorStatusTimeline"."endsAt", CAST('infinity' AS timestamptz)), "MonitorStatusTimeline"."_id") AND "rowKeptOnDeleteLater"."startsAt" <= :${parameter}) END))`,
    );
  });

  test("for an incident-like timeline: a live row no row of its record comes after", () => {
    const sql: string = ruleFor("IncidentStateTimeline")
      .bind()
      .sqlForRowKept('"IncidentStateTimeline"');

    expect(sql).toBe(
      `("IncidentStateTimeline"."deletedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "IncidentStateTimeline" AS "rowKeptOnDeleteLater" WHERE "rowKeptOnDeleteLater"."incidentId" = "IncidentStateTimeline"."incidentId" AND "rowKeptOnDeleteLater"."deletedAt" IS NULL AND "rowKeptOnDeleteLater"."startsAt" >= "IncidentStateTimeline"."startsAt" AND ("rowKeptOnDeleteLater"."startsAt", COALESCE("rowKeptOnDeleteLater"."endsAt", CAST('infinity' AS timestamptz)), "rowKeptOnDeleteLater"."_id") > ("IncidentStateTimeline"."startsAt", COALESCE("IncidentStateTimeline"."endsAt", CAST('infinity' AS timestamptz)), "IncidentStateTimeline"."_id")))`,
    );
  });

  test("reads each table by its own record column", () => {
    for (const [tableName, kept] of Object.entries(
      ROWS_KEPT_ON_DELETE_BY_QUERY,
    )) {
      const sql: string = ruleFor(tableName).bind().sqlForRowKept('"t"');

      expect(sql).toContain(`FROM "${tableName}" AS "rowKeptOnDeleteLater"`);
      expect(sql).toContain(
        `"rowKeptOnDeleteLater"."${kept.parentColumn}" = "t"."${kept.parentColumn}"`,
      );
    }
  });

  test("writes only a quoted plain alias for the row, never text it is handed", () => {
    const bound: BoundRowsKept = ruleFor("MonitorStatusTimeline").bind();

    for (const row of [
      "MonitorStatusTimeline",
      '"Monitor"; DROP TABLE "Project"; --"',
      '"a"."b"',
      '""',
      '"1abc"',
    ]) {
      expect(() => {
        bound.sqlForRowKept(row);
      }).toThrow(BadDataException);
    }
  });

  test("writes only plain names for the table, the record column and the parameter", () => {
    const sqlFor: (data: {
      tableName: string;
      parentColumn: string;
      historyFromParameter: string | null;
    }) => string = (data: {
      tableName: string;
      parentColumn: string;
      historyFromParameter: string | null;
    }): string => {
      return StateTimelineRowsKept.sqlForRowKept({ ...data, row: '"t"' });
    };

    expect(() => {
      sqlFor({
        tableName: 'X" CASCADE; --',
        parentColumn: "monitorId",
        historyFromParameter: null,
      });
    }).toThrow(BadDataException);
    expect(() => {
      sqlFor({
        tableName: "MonitorStatusTimeline",
        parentColumn: "monitor Id",
        historyFromParameter: null,
      });
    }).toThrow(BadDataException);
    expect(() => {
      sqlFor({
        tableName: "MonitorStatusTimeline",
        parentColumn: "monitorId",
        historyFromParameter: "from; DELETE",
      });
    }).toThrow(BadDataException);
  });
});
