import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  FIRST_RESPONDER_KEYS,
  FirstResponderIds,
  countFirstResponders,
  getEmptyFirstResponderIds,
  readFirstResponderIds,
} from "../../../Types/OnCallDutyPolicy/FirstResponders";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO GETS PAGED FIRST, AS THE SERVER READS IT.
 *
 * Create On-Call Policy sends the people its new policy pages first as misc
 * data: lists of ids under the keys an escalation rule's own create takes
 * (onCallSchedules, teams, users). readFirstResponderIds is the one place
 * those lists are read, before anything is saved:
 *
 *   - nobody to page (nothing sent, or only empty lists) is null: the policy
 *     is created without a rule, exactly as before;
 *   - the ids arrive as strings from the dashboard, as ObjectIDs from the
 *     API's deserializer, or as ObjectID JSON from a caller inside the
 *     server - all read the same, each once, without case;
 *   - anything else under those keys is refused, naming the key: a caller who
 *     asked for someone to be paged must not get a policy that pages nobody.
 */

const SCHEDULE_ID: string = "11111111-aaaa-4aaa-8aaa-111111111111";
const TEAM_ID: string = "22222222-bbbb-4bbb-8bbb-222222222222";
const SECOND_TEAM_ID: string = "23232323-bbbb-4bbb-8bbb-232323232323";
const USER_ID: string = "33333333-cccc-4ccc-8ccc-333333333333";

function read(miscDataProps: unknown): FirstResponderIds | null {
  return readFirstResponderIds(miscDataProps as JSONObject);
}

function refusal(miscDataProps: unknown): string {
  try {
    read(miscDataProps);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected the first responders to be refused.");
}

describe("the keys", () => {
  test("are an escalation rule's own, schedules first, then teams, then people", () => {
    expect(FIRST_RESPONDER_KEYS).toEqual(["onCallSchedules", "teams", "users"]);
  });

  test("an empty set has every key and nobody in it", () => {
    const empty: FirstResponderIds = getEmptyFirstResponderIds();

    expect(empty).toEqual({ onCallSchedules: [], teams: [], users: [] });
    expect(countFirstResponders(empty)).toBe(0);

    // A fresh set each time: filling one does not fill the next.
    empty.teams.push(TEAM_ID);
    expect(getEmptyFirstResponderIds().teams).toEqual([]);
  });

  test("counts every responder of every kind", () => {
    expect(
      countFirstResponders({
        onCallSchedules: [SCHEDULE_ID],
        teams: [TEAM_ID, SECOND_TEAM_ID],
        users: [USER_ID],
      }),
    ).toBe(4);
  });
});

describe("nobody to page", () => {
  test.each([
    ["no misc data", undefined],
    ["null misc data", null],
    ["empty misc data", {}],
    ["misc data that is a list", [TEAM_ID]],
    ["misc data that is text", "teams"],
    ["only other misc data", { ownerUsers: [USER_ID], probes: [TEAM_ID] }],
    ["only empty lists", { onCallSchedules: [], teams: [], users: [] }],
    ["one empty list", { teams: [] }],
    ["keys set to null", { onCallSchedules: null, teams: null, users: null }],
  ] as Array<[string, unknown]>)(
    "%s reads as nobody",
    (_label: string, miscDataProps: unknown) => {
      expect(read(miscDataProps)).toBeNull();
    },
  );
});

describe("somebody to page", () => {
  test("reads the dashboard's id strings, per kind", () => {
    expect(
      read({
        onCallSchedules: [SCHEDULE_ID],
        teams: [TEAM_ID],
        users: [USER_ID],
      }),
    ).toEqual({
      onCallSchedules: [SCHEDULE_ID],
      teams: [TEAM_ID],
      users: [USER_ID],
    });
  });

  test("one kind is enough; the others are empty", () => {
    expect(read({ users: [USER_ID] })).toEqual({
      onCallSchedules: [],
      teams: [],
      users: [USER_ID],
    });
  });

  test("reads ObjectIDs, as the API's deserializer hands them over", () => {
    expect(
      read({
        teams: [new ObjectID(TEAM_ID)],
        users: [new ObjectID(USER_ID)],
      }),
    ).toEqual({ onCallSchedules: [], teams: [TEAM_ID], users: [USER_ID] });
  });

  test("reads ObjectID JSON, as a caller inside the server may pass it on", () => {
    expect(
      read({
        onCallSchedules: [new ObjectID(SCHEDULE_ID).toJSON()],
      }),
    ).toEqual({ onCallSchedules: [SCHEDULE_ID], teams: [], users: [] });
  });

  test("lists each id once, compared without case, in the order picked", () => {
    expect(
      read({
        teams: [SECOND_TEAM_ID, TEAM_ID.toUpperCase(), TEAM_ID, SECOND_TEAM_ID],
      })?.teams,
    ).toEqual([SECOND_TEAM_ID, TEAM_ID]);
  });

  test("trims ids and keeps them lower case", () => {
    expect(read({ users: [`  ${USER_ID.toUpperCase()}  `] })?.users).toEqual([
      USER_ID,
    ]);
  });

  test("does not read the same id across kinds as one", () => {
    // Odd but harmless: each kind is its own list of join rows.
    expect(read({ teams: [TEAM_ID], users: [TEAM_ID] })).toEqual({
      onCallSchedules: [],
      teams: [TEAM_ID],
      users: [TEAM_ID],
    });
  });

  test("does not change the misc data it reads", () => {
    const miscDataProps: JSONObject = {
      teams: [TEAM_ID.toUpperCase(), TEAM_ID],
    };

    read(miscDataProps);

    expect(miscDataProps).toEqual({ teams: [TEAM_ID.toUpperCase(), TEAM_ID] });
  });
});

describe("what is refused", () => {
  test.each([
    ["onCallSchedules", SCHEDULE_ID, "on-call schedule"],
    ["teams", { id: TEAM_ID }, "team"],
    ["users", 42, "user"],
  ] as Array<[string, unknown, string]>)(
    "%s that is not a list",
    (key: string, value: unknown, name: string) => {
      expect(refusal({ [key]: value })).toBe(
        `${key} must be a list of ${name} ids.`,
      );
    },
  );

  test.each([
    ["text that is not an id", "payments-team"],
    ["an empty string", ""],
    ["a number", 7],
    ["null", null],
    ["an object without an id", { name: "Payments" }],
    ["a list", [TEAM_ID]],
    ["an id that is almost one", `${TEAM_ID}0`],
  ] as Array<[string, unknown]>)(
    "a list holding %s",
    (_label: string, entry: unknown) => {
      expect(refusal({ teams: [TEAM_ID, entry] })).toContain(
        "teams must be a list of team ids.",
      );
    },
  );

  test("says which entry is not an id", () => {
    expect(refusal({ users: ["alex@example.com"] })).toBe(
      'users must be a list of user ids. "alex@example.com" is not one.',
    );
  });

  test("an ObjectID that holds no id", () => {
    expect(refusal({ users: [new ObjectID("not-an-id")] })).toBe(
      'users must be a list of user ids. "not-an-id" is not one.',
    );
  });

  test("a bad list refuses the whole set, even next to good ones", () => {
    expect(() => {
      read({ teams: [TEAM_ID], users: "everyone" });
    }).toThrow(BadDataException);
  });
});
