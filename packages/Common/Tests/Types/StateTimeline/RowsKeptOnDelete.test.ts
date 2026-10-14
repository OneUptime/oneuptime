import {
  describeRowsKeptByDelete,
  describeRowsKeptOnDelete,
  getRowsKeptOnDelete,
  KEPT_STATUS_HISTORY_DAYS,
  ROWS_KEPT_ON_DELETE_BY_QUERY,
  RowsKeptOnDelete,
} from "../../../Types/StateTimeline/RowsKeptOnDelete";
import { describe, expect, test } from "@jest/globals";

/*
 * What a delete by query keeps of each state timeline, and the words a
 * workflow step's help and its run's log say it in. The rule itself, as
 * SQL, is StateTimelineRowsKept's; what DatabaseService does with it is
 * pinned in DeleteByQueryKeepsStateTimelineRows.
 */

describe("the state timelines a delete by query keeps rows of", () => {
  test("lists every state timeline, each by the column naming its record", () => {
    const parents: Record<string, string> = {};

    for (const [tableName, kept] of Object.entries(
      ROWS_KEPT_ON_DELETE_BY_QUERY,
    )) {
      parents[tableName] = kept.parentColumn;
    }

    expect(parents).toEqual({
      MonitorStatusTimeline: "monitorId",
      NetworkSiteStatusTimeline: "siteId",
      IncidentStateTimeline: "incidentId",
      AlertStateTimeline: "alertId",
      ScheduledMaintenanceStateTimeline: "scheduledMaintenanceId",
      IncidentEpisodeStateTimeline: "incidentEpisodeId",
      AlertEpisodeStateTimeline: "alertEpisodeId",
    });
  });

  test("keeps the history in effect only for the status timelines readers draw as continuous history", () => {
    const withHistory: Array<string> = Object.entries(
      ROWS_KEPT_ON_DELETE_BY_QUERY,
    )
      .filter(([, kept]: [string, RowsKeptOnDelete]): boolean => {
        return kept.keepsHistoryInEffect;
      })
      .map(([tableName]: [string, RowsKeptOnDelete]): string => {
        return tableName;
      })
      .sort();

    expect(withHistory).toEqual([
      "MonitorStatusTimeline",
      "NetworkSiteStatusTimeline",
    ]);
  });

  test("lets one row go by its id only where a person corrects the timeline by hand", () => {
    expect(
      ROWS_KEPT_ON_DELETE_BY_QUERY["NetworkSiteStatusTimeline"]!
        .oneRowByIdCanGo,
    ).toBe(false);

    for (const [tableName, kept] of Object.entries(
      ROWS_KEPT_ON_DELETE_BY_QUERY,
    )) {
      if (tableName !== "NetworkSiteStatusTimeline") {
        expect({ tableName, oneRowByIdCanGo: kept.oneRowByIdCanGo }).toEqual({
          tableName,
          oneRowByIdCanGo: true,
        });
      }
    }
  });

  test("says the kept history's length in the words of the status timelines, and nowhere else", () => {
    for (const [tableName, kept] of Object.entries(
      ROWS_KEPT_ON_DELETE_BY_QUERY,
    )) {
      expect({
        tableName,
        namesTheDays: kept.whatStays.includes(
          `last ${KEPT_STATUS_HISTORY_DAYS} days`,
        ),
      }).toEqual({ tableName, namesTheDays: kept.keepsHistoryInEffect });

      // "current" always: the record's current row is what every timeline keeps.
      expect(kept.whatStays).toContain("current");
    }
  });

  test("keeps 90 days", () => {
    expect(KEPT_STATUS_HISTORY_DAYS).toBe(90);
  });
});

describe("getRowsKeptOnDelete", () => {
  test("answers a listed table's rule", () => {
    expect(getRowsKeptOnDelete("MonitorStatusTimeline")).toBe(
      ROWS_KEPT_ON_DELETE_BY_QUERY["MonitorStatusTimeline"],
    );
  });

  test("answers null for any other table, an empty name, or none", () => {
    for (const tableName of [
      "Monitor",
      "Incident",
      "monitorstatustimeline",
      "",
      null,
      undefined,
      // Not an entry, though every object has it.
      "toString",
      "constructor",
      "__proto__",
    ]) {
      expect(getRowsKeptOnDelete(tableName)).toBeNull();
    }
  });
});

describe("the words", () => {
  test("say the rule as one clause, with its reason when it has one", () => {
    expect(
      describeRowsKeptOnDelete(
        ROWS_KEPT_ON_DELETE_BY_QUERY["MonitorStatusTimeline"]!,
      ),
    ).toBe(
      "a delete by query leaves each monitor's current status, and every status event that covers part of the last 90 days, so status pages never show a monitor grey",
    );

    expect(
      describeRowsKeptOnDelete(
        ROWS_KEPT_ON_DELETE_BY_QUERY["AlertStateTimeline"]!,
      ),
    ).toBe("a delete by query leaves each alert's current state");
  });

  test("say in a run's log how many stayed, in the model's names, and how to delete one", () => {
    expect(
      describeRowsKeptByDelete({
        count: 3,
        kept: ROWS_KEPT_ON_DELETE_BY_QUERY["MonitorStatusTimeline"]!,
        one: "Monitor Status Event",
        many: "Monitor Status Events",
      }),
    ).toBe(
      "Kept 3 Monitor Status Events: a delete by query leaves each monitor's current status, and every status event that covers part of the last 90 days, so status pages never show a monitor grey. To delete one specific Monitor Status Event, query it by its ID.",
    );
  });

  test("name one row in the singular", () => {
    expect(
      describeRowsKeptByDelete({
        count: 1,
        kept: ROWS_KEPT_ON_DELETE_BY_QUERY["IncidentStateTimeline"]!,
        one: "Incident State Timeline",
        many: "Incident State Timelines",
      }),
    ).toBe(
      "Kept 1 Incident State Timeline: a delete by query leaves each incident's current state, so status pages always show it. To delete one specific Incident State Timeline, query it by its ID.",
    );
  });

  test("offer no delete by ID where one row by its id is held to the same rule", () => {
    expect(
      describeRowsKeptByDelete({
        count: 2,
        kept: ROWS_KEPT_ON_DELETE_BY_QUERY["NetworkSiteStatusTimeline"]!,
        one: "Network Site Status Event",
        many: "Network Site Status Events",
      }),
    ).toBe(
      "Kept 2 Network Site Status Events: a delete by query leaves each site's current status, and every status event that covers part of the last 90 days, so a site's uptime never loses its data.",
    );
  });
});
