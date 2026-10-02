import { describe, expect, test } from "@jest/globals";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import ObjectID from "../../../../Types/ObjectID";
import {
  addToPeoplePickerValue,
  countPeoplePickerValue,
  getPeoplePickerKinds,
  getPeoplePickerOptionKey,
  getPeoplePickerValueKeys,
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  PeoplePickerValue,
  readPeoplePickerFormValue,
  removeFromPeoplePickerValue,
  toPeoplePickerFormValues,
  toPeoplePickerIds,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

/*
 * The people picker's plain data. A form value holds whatever put it there -
 * the picker's own id strings, ObjectIDs from a page's initial values,
 * related rows from a fetched record, a dropdown's options - and the picker
 * must read every one of them as the same ids, or an untouched owners field
 * would save something other than what it shows.
 */

const ADA: string = "0000000e-0000-4000-8000-000000000001";
const BOB: string = "0000000e-0000-4000-8000-000000000002";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";
const DATABASE: string = "0000000b-0000-4000-8000-000000000002";

const OWNERS: PeoplePickerFieldConfig = {
  kinds: [
    { kind: PeoplePickerKind.User, valueKey: "ownerUsers" },
    { kind: PeoplePickerKind.Team, valueKey: "ownerTeams" },
  ],
};

describe("toPeoplePickerIds", () => {
  test("reads id strings as they are, trimmed", () => {
    expect(toPeoplePickerIds([ADA, ` ${BOB} `])).toEqual([ADA, BOB]);
  });

  test("reads ObjectIDs", () => {
    expect(toPeoplePickerIds([new ObjectID(ADA), new ObjectID(BOB)])).toEqual(
      [ADA, BOB],
    );
  });

  test("reads related rows by their _id, whether a string or an ObjectID", () => {
    const team: Team = new Team();
    team._id = PLATFORM;

    expect(
      toPeoplePickerIds([team, { _id: new ObjectID(DATABASE) }, { _id: BOB }]),
    ).toEqual([PLATFORM, DATABASE, BOB]);
  });

  test("reads a dropdown's options by their value", () => {
    expect(
      toPeoplePickerIds([
        { value: ADA, label: "Ada" },
        { value: BOB, label: "Bob" },
      ]),
    ).toEqual([ADA, BOB]);
  });

  test("names each id once, in the order first given", () => {
    expect(toPeoplePickerIds([BOB, ADA, BOB, new ObjectID(ADA)])).toEqual([
      BOB,
      ADA,
    ]);
  });

  test("reads a single value as a list of one", () => {
    expect(toPeoplePickerIds(ADA)).toEqual([ADA]);
    expect(toPeoplePickerIds(new ObjectID(BOB))).toEqual([BOB]);
  });

  test("reads nothing as no ids", () => {
    expect(toPeoplePickerIds(undefined)).toEqual([]);
    expect(toPeoplePickerIds(null)).toEqual([]);
    expect(toPeoplePickerIds("")).toEqual([]);
    expect(toPeoplePickerIds([])).toEqual([]);
  });

  test("skips what names no id", () => {
    expect(
      toPeoplePickerIds([ADA, "", "   ", null, undefined, 7, {}, { _id: "" }]),
    ).toEqual([ADA]);
  });
});

describe("a picker field's form values", () => {
  test("its kinds and the form values it writes, in its order", () => {
    expect(getPeoplePickerKinds(OWNERS)).toEqual([
      PeoplePickerKind.User,
      PeoplePickerKind.Team,
    ]);
    expect(getPeoplePickerValueKeys(OWNERS)).toEqual([
      "ownerUsers",
      "ownerTeams",
    ]);
  });

  test("reads each kind's picks from its own form value", () => {
    const user: User = new User();
    user._id = BOB;

    expect(
      readPeoplePickerFormValue(OWNERS, {
        title: "Checkout is failing",
        ownerUsers: [new ObjectID(ADA), user],
        ownerTeams: [PLATFORM],
      }),
    ).toEqual({
      [PeoplePickerKind.User]: [ADA, BOB],
      [PeoplePickerKind.Team]: [PLATFORM],
    });
  });

  test("reads a form with no picks yet as no picks of any kind", () => {
    expect(readPeoplePickerFormValue(OWNERS, {})).toEqual({
      [PeoplePickerKind.User]: [],
      [PeoplePickerKind.Team]: [],
    });
    expect(readPeoplePickerFormValue(OWNERS, undefined)).toEqual({
      [PeoplePickerKind.User]: [],
      [PeoplePickerKind.Team]: [],
    });
  });

  test("writes each kind back to its form value, every kind every time", () => {
    expect(
      toPeoplePickerFormValues(OWNERS, {
        [PeoplePickerKind.Team]: [PLATFORM, DATABASE],
      }),
    ).toEqual({
      ownerUsers: [],
      ownerTeams: [PLATFORM, DATABASE],
    });
  });

  test("a value written and read back is the same value", () => {
    const value: PeoplePickerValue = {
      [PeoplePickerKind.User]: [ADA],
      [PeoplePickerKind.Team]: [DATABASE],
    };

    expect(
      readPeoplePickerFormValue(OWNERS, toPeoplePickerFormValues(OWNERS, value)),
    ).toEqual(value);
  });

  test("keeps a burn rate rule's alert owners in its own columns", () => {
    const alertOwners: PeoplePickerFieldConfig = {
      kinds: [
        { kind: PeoplePickerKind.User, valueKey: "alertOwnerUsers" },
        { kind: PeoplePickerKind.Team, valueKey: "alertOwnerTeams" },
      ],
    };

    expect(
      toPeoplePickerFormValues(alertOwners, {
        [PeoplePickerKind.User]: [ADA],
        [PeoplePickerKind.Team]: [PLATFORM],
      }),
    ).toEqual({ alertOwnerUsers: [ADA], alertOwnerTeams: [PLATFORM] });
  });
});

describe("picking and unpicking", () => {
  test("adds a pick once, and leaves the other kinds alone", () => {
    const start: PeoplePickerValue = {
      [PeoplePickerKind.User]: [ADA],
      [PeoplePickerKind.Team]: [PLATFORM],
    };

    const once: PeoplePickerValue = addToPeoplePickerValue(
      start,
      PeoplePickerKind.User,
      BOB,
    );

    expect(once).toEqual({
      [PeoplePickerKind.User]: [ADA, BOB],
      [PeoplePickerKind.Team]: [PLATFORM],
    });
    // Never the same pick twice; the same value back, so nothing re-renders.
    expect(addToPeoplePickerValue(once, PeoplePickerKind.User, BOB)).toBe(
      once,
    );
    // The value it was given is not changed.
    expect(start[PeoplePickerKind.User]).toEqual([ADA]);
  });

  test("adds the first pick of a kind the value has no list for", () => {
    expect(addToPeoplePickerValue({}, PeoplePickerKind.Team, PLATFORM)).toEqual(
      { [PeoplePickerKind.Team]: [PLATFORM] },
    );
  });

  test("takes a pick away, and only that one", () => {
    expect(
      removeFromPeoplePickerValue(
        {
          [PeoplePickerKind.User]: [ADA, BOB],
          [PeoplePickerKind.Team]: [PLATFORM],
        },
        PeoplePickerKind.User,
        ADA,
      ),
    ).toEqual({
      [PeoplePickerKind.User]: [BOB],
      [PeoplePickerKind.Team]: [PLATFORM],
    });
  });

  test("counts the picks of every kind", () => {
    expect(countPeoplePickerValue({})).toBe(0);
    expect(
      countPeoplePickerValue({
        [PeoplePickerKind.User]: [ADA, BOB],
        [PeoplePickerKind.Team]: [PLATFORM],
      }),
    ).toBe(3);
  });
});

describe("a pick's key", () => {
  test("is its kind and its id", () => {
    expect(getPeoplePickerOptionKey(PeoplePickerKind.Team, PLATFORM)).toBe(
      `team:${PLATFORM}`,
    );
  });

  test("tells kinds apart: a person and a team never share a key", () => {
    expect(getPeoplePickerOptionKey(PeoplePickerKind.User, ADA)).not.toBe(
      getPeoplePickerOptionKey(PeoplePickerKind.Team, ADA),
    );
  });

  test("ignores the case of the id, as the server does", () => {
    expect(
      getPeoplePickerOptionKey(PeoplePickerKind.User, ADA.toUpperCase()),
    ).toBe(getPeoplePickerOptionKey(PeoplePickerKind.User, ADA));
  });
});
