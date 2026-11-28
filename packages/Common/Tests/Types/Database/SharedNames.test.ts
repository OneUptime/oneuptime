import {
  SHARED_NAMES_ROUTE,
  SharedNameKind,
  getSharedNameRecordIds,
  getSharedNamesRoute,
  getSharedNamesRouteOfTable,
  isSharedNameKind,
  readSharedNamesAnswer,
  toSharedNamesAnswerJSON,
} from "../../../Types/Database/SharedNames";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH RECORDS OF A PROJECT SHARE A NAME: WHAT A LIST ASKS (#9746).
 *
 * Teams, labels (#9856), on-call policies and on-call schedules that
 * were named alike before their names were one record's each keep their
 * names; their lists mark them, from what GET /shared-names/:kind answers.
 * The route names each kind, and an answer reads back as it was written,
 * every id in lower case, anything that is not an answer as none.
 */

const TEAM_A: string = "aaaaaaaa-0000-4000-8000-000000000001";
const TEAM_B: string = "aaaaaaaa-0000-4000-8000-000000000002";
const TEAM_C: string = "aaaaaaaa-0000-4000-8000-000000000003";

describe("the route", () => {
  test("names each kind", () => {
    expect(SHARED_NAMES_ROUTE).toBe("/shared-names");
    expect(getSharedNamesRoute(SharedNameKind.Team)).toBe("/shared-names/team");
    expect(getSharedNamesRoute(SharedNameKind.Label)).toBe(
      "/shared-names/label",
    );
    expect(getSharedNamesRoute(SharedNameKind.OnCallPolicy)).toBe(
      "/shared-names/on-call-policy",
    );
    expect(getSharedNamesRoute(SharedNameKind.OnCallSchedule)).toBe(
      "/shared-names/on-call-schedule",
    );
  });

  test.each(["team", "label", "on-call-policy", "on-call-schedule"])(
    "%j is a kind",
    (kind: string) => {
      expect(isSharedNameKind(kind)).toBe(true);
    },
  );

  test.each(["labels", "Label", "Team", "", undefined, 3, "team "])(
    "%j is not",
    (kind: unknown) => {
      expect(isSharedNameKind(kind)).toBe(false);
    },
  );
});

describe("an answer", () => {
  test("reads back as it was written", () => {
    const groups: Array<Array<string>> = [[TEAM_A, TEAM_B], [TEAM_C]];

    expect(readSharedNamesAnswer(toSharedNamesAnswerJSON({ groups }))).toEqual({
      groups,
    });
  });

  test("holds every id in lower case", () => {
    expect(
      readSharedNamesAnswer({ groups: [[TEAM_A.toUpperCase(), TEAM_B]] }),
    ).toEqual({ groups: [[TEAM_A, TEAM_B]] });
  });

  test.each([
    [null],
    [undefined],
    ["groups"],
    [{}],
    [{ groups: "a" }],
    [{ groups: [[], [""], [3, null]] }],
  ])("that is not one reads as no groups: %j", (value: unknown) => {
    expect(readSharedNamesAnswer(value)).toEqual({ groups: [] });
  });

  test("keeps the ids of a group that are ids, and drops the rest", () => {
    expect(
      readSharedNamesAnswer({ groups: [[TEAM_A, 3, "", null, TEAM_B], "x"] }),
    ).toEqual({ groups: [[TEAM_A, TEAM_B]] });
  });

  test("marks every record of every group, once", () => {
    expect(
      Array.from(
        getSharedNameRecordIds({
          groups: [[TEAM_A, TEAM_B], [TEAM_C], [TEAM_A.toUpperCase()]],
        }),
      ),
    ).toEqual([TEAM_A, TEAM_B, TEAM_C]);
    expect(getSharedNameRecordIds({ groups: [] }).size).toBe(0);
  });
});

/*
 * The kinds Require Unique Names holds, asked for by their table's name
 * (#11021): their answer says when each record was made, by which a list
 * tells twins apart.
 */
describe("a kind Require Unique Names holds", () => {
  const MONITOR_A: string = "aaaaaaaa-0000-4000-8000-000000011021";
  const MONITOR_B: string = "bbbbbbbb-0000-4000-8000-000000011021";

  test("is asked for by its table's name, beside the four kinds", () => {
    expect(getSharedNamesRouteOfTable("Monitor")).toBe("/shared-names/Monitor");
    expect(getSharedNamesRouteOfTable("IncidentTemplate")).toBe(
      "/shared-names/IncidentTemplate",
    );
    expect(
      getSharedNamesRouteOfTable("Monitor").startsWith(SHARED_NAMES_ROUTE),
    ).toBe(true);
    // A name is one segment of the path, whatever it holds.
    expect(getSharedNamesRouteOfTable("a/b c")).toBe("/shared-names/a%2Fb%20c");
  });

  test("its answer says when each record was made, and reads back as it was written", () => {
    const answer: {
      groups: Array<Array<string>>;
      createdAt: Record<string, string>;
    } = {
      groups: [[MONITOR_A, MONITOR_B]],
      createdAt: {
        [MONITOR_A]: "2026-11-05T05:14:00.000Z",
        [MONITOR_B]: "2026-11-07T09:30:00.000Z",
      },
    };

    expect(toSharedNamesAnswerJSON(answer)).toEqual(answer);
    expect(readSharedNamesAnswer(toSharedNamesAnswerJSON(answer))).toEqual(
      answer,
    );
  });

  test("the four kinds' answer says nothing of dates, as it never did", () => {
    expect(toSharedNamesAnswerJSON({ groups: [[MONITOR_A]] })).toEqual({
      groups: [[MONITOR_A]],
    });
    expect(readSharedNamesAnswer({ groups: [[MONITOR_A]] })).toEqual({
      groups: [[MONITOR_A]],
    });
  });

  test("a date is kept by its id in lower case; anything else of it is dropped", () => {
    expect(
      readSharedNamesAnswer({
        groups: [[MONITOR_A, MONITOR_B]],
        createdAt: {
          [MONITOR_A.toUpperCase()]: "2026-11-05T05:14:00.000Z",
          [MONITOR_B]: 7,
          "": "2026-11-07T09:30:00.000Z",
          other: "",
        },
      }),
    ).toEqual({
      groups: [[MONITOR_A, MONITOR_B]],
      createdAt: { [MONITOR_A]: "2026-11-05T05:14:00.000Z" },
    });

    for (const createdAt of ["x", 3, ["2026"], null]) {
      expect(
        readSharedNamesAnswer({ groups: [[MONITOR_A]], createdAt: createdAt }),
      ).toEqual({ groups: [[MONITOR_A]] });
    }
  });
});
