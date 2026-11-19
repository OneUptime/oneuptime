import {
  SHARED_NAMES_ROUTE,
  SharedNameKind,
  getSharedNameRecordIds,
  getSharedNamesRoute,
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
