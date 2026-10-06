import StatusPageVisibilityQuery, {
  VISIBLE_UNLESS_PRIVATE_SQL,
} from "../../../../Server/Utils/StatusPage/StatusPageVisibilityQuery";
import {
  applyIncidentSelfPrivacyFilter,
  getIncidentSelfPrivacyRaw,
} from "../../../../Server/Utils/Incident/IncidentPrivacyFilter";
import { getIncidentEpisodeSelfPrivacyRaw } from "../../../../Server/Utils/IncidentEpisode/IncidentEpisodePrivacyFilter";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * StatusPageVisibilityQuery is the SQL form of the one rule that decides
 * whether a status page shows an incident or an incident episode: Visible on
 * Status Page on, and not private. Status pages read as root, so the
 * services' own privacy filters let every row through; the rule has to be in
 * the query itself, applied before LIMIT cuts a list.
 *
 * "Not private" is what the public may see - the privacy filters' anonymous
 * form, the clause public dashboards add too - `isPrivate IS NULL OR
 * isPrivate = FALSE`.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

function sqlOf(operator: unknown, alias: string): string {
  const findOperator: FindOperator<unknown> = operator as FindOperator<unknown>;

  expect(findOperator).toBeInstanceOf(FindOperator);
  expect(findOperator.getSql).toBeDefined();

  return findOperator.getSql!(alias);
}

// The SQL of each part of a clause that may be combined with And().
function sqlOfParts(operator: unknown, alias: string): Array<string> {
  const findOperator: FindOperator<unknown> = operator as FindOperator<unknown>;

  if (findOperator.type === "and") {
    return (findOperator.value as unknown as Array<FindOperator<unknown>>).map(
      (part: FindOperator<unknown>): string => {
        return part.getSql ? part.getSql(alias) : `${part.type}`;
      },
    );
  }

  return [sqlOf(operator, alias)];
}

const NOT_PRIVATE_SQL: string = `("Incident"."isPrivate" IS NULL OR "Incident"."isPrivate" = FALSE)`;

describe("StatusPageVisibilityQuery.shownIncidents", () => {
  test("keeps a query to incidents visible on status pages that are not private", () => {
    const query: Dictionary<unknown> = StatusPageVisibilityQuery.shownIncidents(
      {
        projectId: PROJECT_ID,
      },
    ) as Dictionary<unknown>;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["isVisibleOnStatusPage"]).toBe(true);
    expect(sqlOf(query["isPrivate"], `"Incident"."isPrivate"`)).toBe(
      NOT_PRIVATE_SQL,
    );
  });

  test("is the clause anyone outside the project reads incidents by", () => {
    const query: Dictionary<unknown> = StatusPageVisibilityQuery.shownIncidents(
      {},
    ) as Dictionary<unknown>;

    expect(sqlOf(query["isPrivate"], "x")).toBe(
      sqlOf(getIncidentSelfPrivacyRaw({}), "x"),
    );
    expect(sqlOf(query["isPrivate"], "x")).toBe(
      sqlOf(
        (applyIncidentSelfPrivacyFilter({}, {}) as Dictionary<unknown>)[
          "isPrivate"
        ],
        "x",
      ),
    );
  });

  test("a query that asks for hidden incidents still gets only visible ones", () => {
    const query: Dictionary<unknown> = StatusPageVisibilityQuery.shownIncidents(
      {
        isVisibleOnStatusPage: false,
      },
    ) as Dictionary<unknown>;

    expect(query["isVisibleOnStatusPage"]).toBe(true);
  });

  test("a query's own condition on isPrivate is kept, and both apply", () => {
    const query: Dictionary<unknown> = StatusPageVisibilityQuery.shownIncidents(
      {
        isPrivate: true,
      },
    ) as Dictionary<unknown>;

    const parts: Array<string> = sqlOfParts(query["isPrivate"], "x");

    expect(parts).toHaveLength(2);
    expect(parts).toContain("(x IS NULL OR x = FALSE)");
  });

  test("does not change the query it is given", () => {
    const input: Dictionary<unknown> = { projectId: PROJECT_ID };

    StatusPageVisibilityQuery.shownIncidents(input);

    expect(input).toEqual({ projectId: PROJECT_ID });
  });
});

describe("StatusPageVisibilityQuery.notPrivateIncidents", () => {
  test("leaves out private incidents, and does not ask for visibility", () => {
    const query: Dictionary<unknown> =
      StatusPageVisibilityQuery.notPrivateIncidents({
        projectId: PROJECT_ID,
      }) as Dictionary<unknown>;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["isVisibleOnStatusPage"]).toBeUndefined();
    expect(sqlOf(query["isPrivate"], `"Incident"."isPrivate"`)).toBe(
      NOT_PRIVATE_SQL,
    );
  });

  test("does not change the query it is given", () => {
    const input: Dictionary<unknown> = { projectId: PROJECT_ID };

    StatusPageVisibilityQuery.notPrivateIncidents(input);

    expect(input).toEqual({ projectId: PROJECT_ID });
  });
});

describe("StatusPageVisibilityQuery.shownEpisodes", () => {
  test("keeps a query to episodes visible on status pages that are not private", () => {
    const query: Dictionary<unknown> = StatusPageVisibilityQuery.shownEpisodes({
      projectId: PROJECT_ID,
    }) as Dictionary<unknown>;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["isVisibleOnStatusPage"]).toBe(true);
    expect(sqlOf(query["isPrivate"], "x")).toBe("(x IS NULL OR x = FALSE)");
    expect(sqlOf(query["isPrivate"], "x")).toBe(
      sqlOf(getIncidentEpisodeSelfPrivacyRaw({}), "x"),
    );
  });

  test("a query that asks for hidden episodes still gets only visible ones", () => {
    const query: Dictionary<unknown> = StatusPageVisibilityQuery.shownEpisodes({
      isVisibleOnStatusPage: false,
    }) as Dictionary<unknown>;

    expect(query["isVisibleOnStatusPage"]).toBe(true);
  });

  test("does not change the query it is given", () => {
    const input: Dictionary<unknown> = { projectId: PROJECT_ID };

    StatusPageVisibilityQuery.shownEpisodes(input);

    expect(input).toEqual({ projectId: PROJECT_ID });
  });
});

/*
 * A scheduled maintenance event is shown on a status page only while its
 * Visible on Status Page switch is on - read by its id as much as in a list.
 */
describe("StatusPageVisibilityQuery.shownScheduledMaintenance", () => {
  test("keeps a query to events visible on status pages", () => {
    const query: Dictionary<unknown> =
      StatusPageVisibilityQuery.shownScheduledMaintenance({
        projectId: PROJECT_ID,
        _id: "20000000-0000-4000-8000-000000000001",
      }) as Dictionary<unknown>;

    expect(query).toEqual({
      projectId: PROJECT_ID,
      _id: "20000000-0000-4000-8000-000000000001",
      isVisibleOnStatusPage: true,
    });
  });

  test("a query that asks for hidden events, or for any, still gets only visible ones", () => {
    for (const isVisibleOnStatusPage of [false, null, undefined]) {
      const query: Dictionary<unknown> =
        StatusPageVisibilityQuery.shownScheduledMaintenance({
          isVisibleOnStatusPage: isVisibleOnStatusPage as never,
        }) as Dictionary<unknown>;

      expect(query["isVisibleOnStatusPage"]).toBe(true);
    }
  });

  test("does not change the query it is given", () => {
    const input: Dictionary<unknown> = { projectId: PROJECT_ID };

    StatusPageVisibilityQuery.shownScheduledMaintenance(input);

    expect(input).toEqual({ projectId: PROJECT_ID });
  });
});

/*
 * An announcement is shown on a status page only once the time it is shown
 * from has come: never earlier, by its id as much as in a list.
 */
describe("StatusPageVisibilityQuery.shownAnnouncements", () => {
  const NOW: Date = new Date("2026-10-06T12:00:00.000Z");
  const SINCE: Date = new Date("2026-09-22T12:00:00.000Z");

  interface TimeCondition {
    sql: string;
    values: Array<unknown>;
  }

  // A time condition's SQL on column x, and the times it is bound to.
  function timeConditionOf(operator: unknown): TimeCondition {
    const findOperator: FindOperator<unknown> =
      operator as FindOperator<unknown>;

    expect(findOperator).toBeInstanceOf(FindOperator);

    return {
      sql: findOperator.getSql!("x"),
      values: Object.values(
        (findOperator.objectLiteralParameters as Record<string, unknown>) ||
          {},
      ),
    };
  }

  test("by its id: any time up to now, so one scheduled for later is left out", () => {
    const query: Dictionary<unknown> =
      StatusPageVisibilityQuery.shownAnnouncements(
        {
          _id: "30000000-0000-4000-8000-000000000001",
          projectId: PROJECT_ID,
        },
        { now: NOW },
      ) as Dictionary<unknown>;

    expect(query["_id"]).toBe("30000000-0000-4000-8000-000000000001");
    expect(query["projectId"]).toBe(PROJECT_ID);

    const shownFrom: TimeCondition = timeConditionOf(
      query["showAnnouncementAt"],
    );

    expect(shownFrom.sql).toMatch(/^\(x <= :[A-Za-z0-9]+\)$/);
    expect(shownFrom.values).toEqual([NOW]);
  });

  test("in a list that shows them for so long: from then up to now", () => {
    const query: Dictionary<unknown> =
      StatusPageVisibilityQuery.shownAnnouncements(
        { projectId: PROJECT_ID },
        { since: SINCE, now: NOW },
      ) as Dictionary<unknown>;

    const shownFrom: TimeCondition = timeConditionOf(
      query["showAnnouncementAt"],
    );

    expect(shownFrom.sql).toMatch(
      /^\(x >= :[A-Za-z0-9]+ and x <= :[A-Za-z0-9]+\)$/,
    );
    expect(shownFrom.values).toEqual([SINCE, NOW]);
  });

  test("a time the query asks for itself is replaced: never later than now", () => {
    const query: Dictionary<unknown> =
      StatusPageVisibilityQuery.shownAnnouncements(
        {
          showAnnouncementAt: new Date("2030-01-01T00:00:00.000Z") as never,
        },
        { now: NOW },
      ) as Dictionary<unknown>;

    expect(timeConditionOf(query["showAnnouncementAt"]).values).toEqual([
      NOW,
    ]);
  });

  test("keeps the rest of the query, and does not change the one it is given", () => {
    const input: Dictionary<unknown> = {
      projectId: PROJECT_ID,
      endAnnouncementAt: "kept",
    };

    const query: Dictionary<unknown> =
      StatusPageVisibilityQuery.shownAnnouncements(input, {
        now: NOW,
      }) as Dictionary<unknown>;

    expect(query["endAnnouncementAt"]).toBe("kept");
    expect(input).toEqual({ projectId: PROJECT_ID, endAnnouncementAt: "kept" });
  });
});

/*
 * What an update writes in SQL to keep the rule on every row
 * (DatabaseService.getRowWriteSql): Visible on Status Page, turned on by a
 * write that leaves Private as stored, is stored on only while the row is
 * not private - decided by the database in the row's own write, on the row
 * as it is then. StatusPageVisibilityWritePostgres runs it against Postgres.
 */
describe("StatusPageVisibilityQuery.getRowWriteSql", () => {
  test("is Private, as the row holds it, never set counting as not private", () => {
    expect(VISIBLE_UNLESS_PRIVATE_SQL).toBe(`("isPrivate" IS NOT TRUE)`);
  });

  test.each([
    ["on", { isVisibleOnStatusPage: true }],
    ["on, with another column", { isVisibleOnStatusPage: true, title: "x" }],
  ] as Array<[string, Record<string, unknown>]>)(
    "a write that turns Visible on Status Page %s and leaves Private as stored writes it in SQL",
    (_label: string, written: Record<string, unknown>) => {
      expect(StatusPageVisibilityQuery.getRowWriteSql(written)).toEqual({
        isVisibleOnStatusPage: VISIBLE_UNLESS_PRIVATE_SQL,
      });
    },
  );

  test.each([
    ["turns it off", { isVisibleOnStatusPage: false }],
    ["writes Private with it", { isVisibleOnStatusPage: true, isPrivate: false }],
    [
      "makes the record private (stored off with it)",
      { isVisibleOnStatusPage: false, isPrivate: true },
    ],
    ["writes neither switch", { title: "Checkout errors" }],
    ["writes nothing", {}],
  ] as Array<[string, Record<string, unknown>]>)(
    "a write that %s writes its values as they are",
    (_label: string, written: Record<string, unknown>) => {
      expect(StatusPageVisibilityQuery.getRowWriteSql(written)).toEqual({});
    },
  );

  test("no write, nothing to write", () => {
    expect(StatusPageVisibilityQuery.getRowWriteSql(undefined)).toEqual({});
    expect(StatusPageVisibilityQuery.getRowWriteSql(null)).toEqual({});
  });
});
