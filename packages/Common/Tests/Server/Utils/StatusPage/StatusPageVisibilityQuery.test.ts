import StatusPageVisibilityQuery from "../../../../Server/Utils/StatusPage/StatusPageVisibilityQuery";
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
