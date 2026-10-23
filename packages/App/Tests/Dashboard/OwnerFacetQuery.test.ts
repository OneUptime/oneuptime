import {
  OWNER_CHIP_GROUPS,
  OWNER_KEY_PREFIX,
  buildOwnerFacetQuery,
  getOwnerChipOption,
  getOwnerKey,
  getPickedOwners,
  getResolvedOwnerChipOptions,
  mergeOwnerFacetIntoQuery,
  parseOwnerKey,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerFacetQuery";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import Includes from "Common/Types/BaseDatabase/Includes";
import OwnedBy, {
  MAX_OWNED_BY_IDS,
  OWNED_BY_QUERY_KEY,
  OwnedByMatch,
} from "Common/Types/BaseDatabase/OwnedBy";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THE OWNER CHIP PUTS IN A LIST'S QUERY (OwnerFacetQuery).
 *
 * The chip lists people and teams together; each pick is a key that says
 * which it is ("user:<id>", "team:<id>"). Under the chip's four operators the
 * query carries one filter, under "owners", that the server answers in the
 * list's own query:
 *
 *   is            -> the records one of the picks owns (AnyOf)
 *   is not        -> the records none of them owns (NoneOf)
 *   is empty      -> the records nobody owns (NoOwner)
 *   is not empty  -> the records someone owns (AnyOwner)
 *
 * The chip used to look the owners up itself and send the ids of the
 * records they own - ten thousand at most, the rest dropped - and its "is
 * empty" listed nothing while "is not empty" listed everything. A person
 * stands for themselves and a team for itself, as picked: no team is
 * expanded into its members, nor a person into their teams.
 */

const ADA: string = "0d4c9b2e-6a3f-4e1d-9b7a-2c5e8f1a3b60";
const GRACE: string = "1e5dac3f-7b40-4f2e-8c8b-3d6f9a2b4c71";
const SRE_TEAM: string = "2f6ebd40-8c51-4a3f-9d9c-4e7a0b3c5d82";
const PAYMENTS_TEAM: string = "3a7fce51-9d62-4b40-8eaa-5f8b1c4d6e93";

const user: (id: string) => string = (id: string): string => {
  return `user:${id}`;
};

const team: (id: string) => string = (id: string): string => {
  return `team:${id}`;
};

// What a filter says, as the API carries it.
const asJson: (ownedBy: OwnedBy | null) => JSONObject | null = (
  ownedBy: OwnedBy | null,
): JSONObject | null => {
  return ownedBy ? ownedBy.toJSON() : null;
};

describe("OwnerFacetQuery - the Owner chip's filter", () => {
  test("a pick's key says whether it is a person or a team", () => {
    expect(OWNER_KEY_PREFIX).toEqual({ user: "user:", team: "team:" });
    expect(parseOwnerKey(user(ADA))).toEqual({ kind: "user", id: ADA });
    expect(parseOwnerKey(team(SRE_TEAM))).toEqual({
      kind: "team",
      id: SRE_TEAM,
    });
    expect(parseOwnerKey(ADA)).toBeNull();
    expect(parseOwnerKey("group:x")).toBeNull();
    expect(getOwnerKey({ kind: "team", id: SRE_TEAM })).toBe(team(SRE_TEAM));
    expect(getOwnerKey(parseOwnerKey(user(GRACE))!)).toBe(user(GRACE));
  });

  test("is: the records one of the people or teams picked owns", () => {
    expect(
      asJson(
        buildOwnerFacetQuery({
          operator: "is",
          ownerKeys: [user(ADA), team(SRE_TEAM)],
        }),
      ),
    ).toEqual({
      _type: ObjectType.OwnedBy,
      match: OwnedByMatch.AnyOf,
      userIds: [ADA],
      teamIds: [SRE_TEAM],
    });
  });

  test("is, with a team only: the team, never its members", () => {
    const filter: OwnedBy = buildOwnerFacetQuery({
      operator: "is",
      ownerKeys: [team(SRE_TEAM)],
    })!;

    expect(filter.teamIds).toEqual([SRE_TEAM]);
    expect(filter.userIds).toEqual([]);
  });

  test("is, with a person only: the person, never their teams", () => {
    const filter: OwnedBy = buildOwnerFacetQuery({
      operator: "is",
      ownerKeys: [user(GRACE)],
    })!;

    expect(filter.userIds).toEqual([GRACE]);
    expect(filter.teamIds).toEqual([]);
  });

  test("is not: the records none of them owns", () => {
    expect(
      asJson(
        buildOwnerFacetQuery({
          operator: "is_not",
          ownerKeys: [team(SRE_TEAM), team(PAYMENTS_TEAM)],
        }),
      ),
    ).toEqual({
      _type: ObjectType.OwnedBy,
      match: OwnedByMatch.NoneOf,
      userIds: [],
      teamIds: [SRE_TEAM, PAYMENTS_TEAM],
    });
  });

  test.each([
    ["is_empty", OwnedByMatch.NoOwner],
    ["is_not_empty", OwnedByMatch.AnyOwner],
  ] as Array<[FilterOperator, OwnedByMatch]>)(
    "%s asks whether a record has owners at all, whatever was picked before",
    (operator: FilterOperator, match: OwnedByMatch) => {
      for (const ownerKeys of [[], [user(ADA), team(SRE_TEAM)]]) {
        expect(asJson(buildOwnerFacetQuery({ operator, ownerKeys }))).toEqual({
          _type: ObjectType.OwnedBy,
          match: match,
          userIds: [],
          teamIds: [],
        });
      }
    },
  );

  test.each(["is", "is_not"] as Array<FilterOperator>)(
    "%s with nobody picked filters nothing",
    (operator: FilterOperator) => {
      expect(buildOwnerFacetQuery({ operator, ownerKeys: [] })).toBeNull();
    },
  );

  test("a pick that names nobody - a hand-edited link, an old view - is left out, not refused", () => {
    expect(
      getPickedOwners([
        "user:not-a-uuid",
        "team:",
        "label:" + ADA,
        ADA,
        user(GRACE),
      ]),
    ).toEqual({ userIds: [GRACE], teamIds: [] });

    expect(
      buildOwnerFacetQuery({
        operator: "is",
        ownerKeys: ["user:not-a-uuid", "team:{{x}}"],
      }),
    ).toBeNull();
  });

  test("each person and team once", () => {
    expect(
      getPickedOwners([user(ADA), user(ADA), team(SRE_TEAM), team(SRE_TEAM)]),
    ).toEqual({ userIds: [ADA], teamIds: [SRE_TEAM] });
  });

  test(`no more than ${MAX_OWNED_BY_IDS} picks reach the filter, so a long link never breaks the page`, () => {
    const keys: Array<string> = Array.from(
      { length: MAX_OWNED_BY_IDS + 50 },
      (_value: unknown, index: number): string => {
        const id: string = ObjectID.generate().toString();
        return index % 2 === 0 ? user(id) : team(id);
      },
    );

    const filter: OwnedBy = buildOwnerFacetQuery({
      operator: "is",
      ownerKeys: keys,
    })!;

    expect(filter.userIds.length + filter.teamIds.length).toBe(
      MAX_OWNED_BY_IDS,
    );
  });

  describe("mergeOwnerFacetIntoQuery", () => {
    test("puts the filter under owners, beside the list's own query, which it does not change", () => {
      const base: Record<string, unknown> = {
        isArchived: false,
        _id: new Includes([ADA]),
      };

      const merged: Record<string, unknown> = mergeOwnerFacetIntoQuery({
        query: base,
        operator: "is",
        ownerKeys: [team(SRE_TEAM)],
      });

      expect(Object.keys(merged).sort()).toEqual(
        ["_id", "isArchived", OWNED_BY_QUERY_KEY].sort(),
      );
      expect(merged[OWNED_BY_QUERY_KEY]).toBeInstanceOf(OwnedBy);
      expect(merged["_id"]).toBe(base["_id"]);
      expect(base[OWNED_BY_QUERY_KEY]).toBeUndefined();
    });

    test("leaves the query as it was when the chip filters nothing", () => {
      const base: Record<string, unknown> = { isArchived: true };

      expect(
        mergeOwnerFacetIntoQuery({
          query: base,
          operator: "is",
          ownerKeys: [],
        }),
      ).toBe(base);
    });

    test("never narrows the records' ids itself: the server answers the owners", () => {
      const merged: Record<string, unknown> = mergeOwnerFacetIntoQuery({
        query: {},
        operator: "is_not",
        ownerKeys: [user(ADA)],
      });

      expect(merged["_id"]).toBeUndefined();
    });

    test("reaches the API as the server reads it", () => {
      const merged: Record<string, unknown> = mergeOwnerFacetIntoQuery({
        query: { isArchived: false },
        operator: "is",
        ownerKeys: [user(ADA), team(SRE_TEAM)],
      });

      const sent: JSONObject = JSON.parse(
        JSON.stringify(JSONFunctions.serialize(merged as JSONObject)),
      );

      expect(sent[OWNED_BY_QUERY_KEY]).toEqual({
        _type: "OwnedBy",
        match: "AnyOf",
        userIds: [ADA],
        teamIds: [SRE_TEAM],
      });

      const read: JSONObject = JSONFunctions.deserialize(sent) as JSONObject;

      expect(read[OWNED_BY_QUERY_KEY]).toBeInstanceOf(OwnedBy);
    });

    test("a table notices a change of owners (its query is compared as JSON)", () => {
      const ofSre: string = JSON.stringify(
        mergeOwnerFacetIntoQuery({
          query: {},
          operator: "is",
          ownerKeys: [team(SRE_TEAM)],
        }),
      );
      const ofPayments: string = JSON.stringify(
        mergeOwnerFacetIntoQuery({
          query: {},
          operator: "is",
          ownerKeys: [team(PAYMENTS_TEAM)],
        }),
      );
      const noneOfSre: string = JSON.stringify(
        mergeOwnerFacetIntoQuery({
          query: {},
          operator: "is_not",
          ownerKeys: [team(SRE_TEAM)],
        }),
      );

      expect(new Set([ofSre, ofPayments, noneOfSre]).size).toBe(3);
    });
  });

  /*
   * How the chip lists a person or a team: picked by the key the filter
   * reads, under People or Teams, and drawn as the Owners column draws them
   * (the option's `person`, which FilterChipDropdown hands to PeopleAvatar)
   * - not as initials on a colour of the chip's own, which gave Ada one
   * colour in the chip and another in the column under it, and drew a team
   * as a coloured circle like a person's.
   */
  describe("getOwnerChipOption", () => {
    test("a person: picked as user:<id>, under People, drawn as a person with their picture", () => {
      const option: FilterChipDropdownOption = getOwnerChipOption({
        kind: "user",
        id: ADA,
        name: "Ada Lovelace",
        hasProfilePicture: true,
      });

      expect(option).toEqual({
        value: user(ADA),
        label: "Ada Lovelace",
        group: "People",
        person: { kind: "user", userId: ADA, hasProfilePicture: true },
      });
      expect(parseOwnerKey(option.value)).toEqual({ kind: "user", id: ADA });
    });

    test("a team: picked as team:<id>, under Teams, drawn as a team - no user id, no picture", () => {
      const option: FilterChipDropdownOption = getOwnerChipOption({
        kind: "team",
        id: SRE_TEAM,
        name: "SRE",
        // A team has no picture, whatever it is handed.
        hasProfilePicture: true,
      });

      expect(option).toEqual({
        value: team(SRE_TEAM),
        label: "SRE",
        group: "Teams",
        person: { kind: "team", userId: undefined, hasProfilePicture: false },
      });
      expect(parseOwnerKey(option.value)).toEqual({
        kind: "team",
        id: SRE_TEAM,
      });
    });

    test("no initials, colour or icon of the chip's own: the person's avatar is the one thing drawn", () => {
      for (const option of [
        getOwnerChipOption({ kind: "user", id: GRACE, name: "Grace Hopper" }),
        getOwnerChipOption({
          kind: "team",
          id: PAYMENTS_TEAM,
          name: "Payments",
        }),
      ]) {
        expect(option.initials).toBeUndefined();
        expect(option.color).toBeUndefined();
        expect(option.icon).toBeUndefined();
        expect(option.person).toBeDefined();
      }
    });

    test("a person with no picture says so", () => {
      expect(
        getOwnerChipOption({ kind: "user", id: GRACE, name: "Grace Hopper" })
          .person,
      ).toEqual({ kind: "user", userId: GRACE, hasProfilePicture: false });
    });

    test("the headings are the owners picker's own, People then Teams", () => {
      expect(OWNER_CHIP_GROUPS).toEqual({ user: "People", team: "Teams" });
    });

    test("a picked option's key is the one the filter reads", () => {
      const options: Array<FilterChipDropdownOption> = [
        getOwnerChipOption({ kind: "user", id: ADA, name: "Ada Lovelace" }),
        getOwnerChipOption({ kind: "team", id: SRE_TEAM, name: "SRE" }),
      ];

      expect(
        buildOwnerFacetQuery({
          operator: "is",
          ownerKeys: options.map((option: FilterChipDropdownOption): string => {
            return option.value;
          }),
        })?.toJSON(),
      ).toEqual({
        _type: "OwnedBy",
        match: OwnedByMatch.AnyOf,
        userIds: [ADA],
        teamIds: [SRE_TEAM],
      });
    });
  });

  /*
   * The picks a link or a saved view brings back are named by looking them
   * up. One no longer in the project - a person removed, a team deleted -
   * used to be named by its key: the chip read "Owner · user:3a7f...". It is
   * named as the owners picker names it.
   */
  describe("getResolvedOwnerChipOptions", () => {
    const UNKNOWN: { user: string; team: string } = {
      user: "Unknown user",
      team: "Deleted team",
    };

    test("the people and teams found, each as the chip lists them", () => {
      const options: Array<FilterChipDropdownOption> =
        getResolvedOwnerChipOptions({
          picked: { userIds: [ADA], teamIds: [SRE_TEAM] },
          found: [
            { kind: "user", id: ADA, name: "Ada Lovelace" },
            { kind: "team", id: SRE_TEAM, name: "SRE" },
          ],
          unknownNames: UNKNOWN,
        });

      expect(options).toEqual([
        getOwnerChipOption({ kind: "user", id: ADA, name: "Ada Lovelace" }),
        getOwnerChipOption({ kind: "team", id: SRE_TEAM, name: "SRE" }),
      ]);
    });

    test("a pick no longer in the project is named as the picker names it, by the key it was picked by", () => {
      const options: Array<FilterChipDropdownOption> =
        getResolvedOwnerChipOptions({
          picked: { userIds: [ADA, GRACE], teamIds: [SRE_TEAM, PAYMENTS_TEAM] },
          found: [
            { kind: "user", id: ADA, name: "Ada Lovelace" },
            { kind: "team", id: SRE_TEAM, name: "SRE" },
          ],
          unknownNames: UNKNOWN,
        });

      expect(
        options.map((option: FilterChipDropdownOption): [string, string] => {
          return [option.value, option.label];
        }),
      ).toEqual([
        [user(ADA), "Ada Lovelace"],
        [team(SRE_TEAM), "SRE"],
        [user(GRACE), "Unknown user"],
        [team(PAYMENTS_TEAM), "Deleted team"],
      ]);

      // Still drawn as a person and as a team.
      expect(options[2]!.person).toEqual({
        kind: "user",
        userId: GRACE,
        hasProfilePicture: false,
      });
      expect(options[3]!.person?.kind).toBe("team");
      // Never the key as its name.
      for (const option of options) {
        expect(option.label).not.toContain(OWNER_KEY_PREFIX.user);
        expect(option.label).not.toContain(OWNER_KEY_PREFIX.team);
      }
    });

    test("a person found twice (two teams, one search) is listed once", () => {
      expect(
        getResolvedOwnerChipOptions({
          picked: { userIds: [ADA], teamIds: [] },
          found: [
            { kind: "user", id: ADA, name: "Ada Lovelace" },
            { kind: "user", id: ADA.toUpperCase(), name: "Ada Lovelace" },
          ],
          unknownNames: UNKNOWN,
        }),
      ).toHaveLength(1);
    });

    test("an id's case does not make a found pick unknown", () => {
      const options: Array<FilterChipDropdownOption> =
        getResolvedOwnerChipOptions({
          picked: { userIds: [ADA.toUpperCase()], teamIds: [] },
          found: [{ kind: "user", id: ADA, name: "Ada Lovelace" }],
          unknownNames: UNKNOWN,
        });

      expect(
        options.map((option: FilterChipDropdownOption): string => {
          return option.label;
        }),
      ).toEqual(["Ada Lovelace"]);
    });

    test("nothing picked, nothing to name", () => {
      expect(
        getResolvedOwnerChipOptions({
          picked: { userIds: [], teamIds: [] },
          found: [],
          unknownNames: UNKNOWN,
        }),
      ).toEqual([]);
    });
  });
});
