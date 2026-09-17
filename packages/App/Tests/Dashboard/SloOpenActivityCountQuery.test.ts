import {
  getSloOpenAlertCountQuery,
  getSloOpenIncidentCountQuery,
  SloOpenActivityCountQueryInput,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/Utils/SloOpenActivityCountQuery";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The SLO side menu badges its Alerts and Incidents items with how many of
 * the records this SLO raised are still open. These are the queries behind
 * those badges.
 *
 * What they must get right:
 *   - count through the same `serviceLevelObjectives` relation the two tabs
 *     list, so a badge never disagrees with the list it links to (the tabs
 *     used to match on the burn-rate fingerprint instead);
 *   - count only unresolved states, so a badge means "look at this";
 *   - issue nothing until there is something meaningful to count
 *     (CountModelSideMenuItem sends no request for an undefined query).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SLO_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const CREATED_STATE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777771",
);
const ACKNOWLEDGED_STATE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777772",
);

function input(
  overrides: Partial<SloOpenActivityCountQueryInput> = {},
): SloOpenActivityCountQueryInput {
  return {
    projectId: PROJECT_ID,
    sloId: SLO_ID,
    unresolvedStateIds: [CREATED_STATE_ID, ACKNOWLEDGED_STATE_ID],
    ...overrides,
  };
}

function idsOf(value: unknown): Array<string> {
  expect(value).toBeInstanceOf(Includes);

  return ((value as Includes).values as Array<ObjectID>).map(
    (id: ObjectID): string => {
      return id.toString();
    },
  );
}

type QueryBuilder = (
  data: SloOpenActivityCountQueryInput,
) => Query<Incident> | Query<Alert> | undefined;

const BUILDERS: Array<[string, QueryBuilder, string]> = [
  ["incidents", getSloOpenIncidentCountQuery, "currentIncidentStateId"],
  ["alerts", getSloOpenAlertCountQuery, "currentAlertStateId"],
];

describe.each(BUILDERS)(
  "the open %s count",
  (_label: string, build: QueryBuilder, stateField: string) => {
    test("counts this SLO's records through the serviceLevelObjectives relation, over unresolved states only", () => {
      const query: Record<string, unknown> = build(input()) as Record<
        string,
        unknown
      >;

      expect(Object.keys(query).sort()).toEqual(
        ["projectId", "serviceLevelObjectives", stateField].sort(),
      );
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(idsOf(query["serviceLevelObjectives"])).toEqual([
        SLO_ID.toString(),
      ]);
      expect(idsOf(query[stateField])).toEqual([
        CREATED_STATE_ID.toString(),
        ACKNOWLEDGED_STATE_ID.toString(),
      ]);
    });

    test("never matches on the burn-rate fingerprint the tabs no longer use", () => {
      const query: Record<string, unknown> = build(input()) as Record<
        string,
        unknown
      >;

      expect(query["seriesFingerprint"]).toBeUndefined();
    });

    test("waits while the unresolved states are still loading", () => {
      expect(build(input({ unresolvedStateIds: null }))).toBeUndefined();
    });

    test("does not count in a project with no unresolved states", () => {
      expect(build(input({ unresolvedStateIds: [] }))).toBeUndefined();
    });

    test("does not count without a project to scope to", () => {
      expect(build(input({ projectId: null }))).toBeUndefined();
    });

    test("is the same value for the same inputs, so a re-render does not refetch", () => {
      /*
       * CountModelSideMenuItem refetches only when JSON.stringify of the
       * query changes; the menu rebuilds the object on every render.
       */
      expect(JSON.stringify(build(input()))).toBe(
        JSON.stringify(build(input())),
      );
    });

    test("a different SLO is a different count", () => {
      const otherSlo: ObjectID = new ObjectID(
        "88888888-8888-4888-8888-888888888888",
      );

      expect(JSON.stringify(build(input({ sloId: otherSlo })))).not.toBe(
        JSON.stringify(build(input())),
      );
    });
  },
);
