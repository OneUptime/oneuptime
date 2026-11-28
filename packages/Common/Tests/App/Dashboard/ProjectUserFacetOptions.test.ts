import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  TEAM_MEMBERS_RELATION,
  buildTeamMemberFilter,
  loadProjectUserOptions,
  resolveProjectUserOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ProjectUserFacetOptions";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { buildFacetColumnQuery } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import { ResourceFacet } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import LinkedTo, {
  LINKED_TO_QUERY_KEY,
  LinkedToMatch,
} from "../../../Types/BaseDatabase/LinkedTo";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { getPeopleInitials } from "../../../UI/Components/PeoplePicker/PeopleAvatar";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * The project members a Users or Teams facet offers (the "User", "Member"
 * and "Created By" chips): each one's initials are the ones their avatar
 * draws everywhere else (PeopleAvatar, Utils/NameInitials) - read from
 * the letters of their name, or of their address when they have no name.
 * It kept a copy of the avatar's old rule, which drew "S(" for a name
 * ending in brackets.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

interface Member {
  id: string;
  name?: string;
  email: string;
}

const MEMBERS: Array<Member> = [
  {
    id: "0000000e-0000-4000-8000-000000000001",
    name: "Ada Byron Lovelace",
    email: "ada@acme-commerce.example",
  },
  {
    id: "0000000e-0000-4000-8000-000000000002",
    name: "Priya Nair (SOC, EMEA)",
    email: "priya@acme-commerce.example",
  },
  {
    // No name: the facet labels them by their address.
    id: "0000000e-0000-4000-8000-000000000003",
    email: "jane.doe@acme-commerce.example",
  },
  {
    id: "0000000e-0000-4000-8000-000000000004",
    name: "🚀 Rocket Team Lead",
    email: "lead@acme-commerce.example",
  },
];

function teamMemberOf(member: Member): TeamMember {
  const user: User = new User();
  user._id = member.id;

  if (member.name) {
    user.name = new Name(member.name);
  }

  user.email = new Email(member.email);

  const teamMember: TeamMember = new TeamMember();
  teamMember.user = user;

  return teamMember;
}

let rows: Array<TeamMember> = [];

beforeEach(() => {
  rows = MEMBERS.map(teamMemberOf);
  jest.spyOn(ModelAPI, "getList").mockImplementation(async () => {
    return { data: rows, count: rows.length, skip: 0, limit: 50 } as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function initialsByLabel(
  options: Array<FilterChipDropdownOption>,
): Record<string, string | undefined> {
  const found: Record<string, string | undefined> = {};

  for (const option of options) {
    found[option.label] = option.initials;
  }

  return found;
}

describe("a project member offered by a Users or Teams facet", () => {
  test("is drawn with the initials of their name's words", async () => {
    const options: Array<FilterChipDropdownOption> =
      await loadProjectUserOptions(PROJECT_ID, "");

    expect(initialsByLabel(options)).toEqual({
      "Ada Byron Lovelace": "AL",
      // What the name says in brackets is left out: never "P)".
      "Priya Nair (SOC, EMEA)": "PN",
      // Someone with no name, by the part of their address before the @.
      "jane.doe@acme-commerce.example": "JD",
      // An emoji is never an initial.
      "🚀 Rocket Team Lead": "RL",
    });
  });

  test("has the initials their avatar draws everywhere else", async () => {
    const options: Array<FilterChipDropdownOption> =
      await resolveProjectUserOptions(
        PROJECT_ID,
        MEMBERS.map((member: Member): string => {
          return member.id;
        }),
      );

    expect(options).toHaveLength(MEMBERS.length);

    for (const option of options) {
      expect(option.initials).toBe(getPeopleInitials(option.label));
    }
  });

  test("is offered once, however many teams they are on", async () => {
    rows = [...MEMBERS.map(teamMemberOf), ...MEMBERS.map(teamMemberOf)];

    const options: Array<FilterChipDropdownOption> =
      await loadProjectUserOptions(PROJECT_ID, "a");

    expect(
      options.map((option: FilterChipDropdownOption): string => {
        return option.value;
      }),
    ).toEqual(
      MEMBERS.map((member: Member): string => {
        return member.id;
      }),
    );
  });
});

describe("the people a saved Member or Created By chip holds, named again (#11211)", () => {
  test("each is named from one membership of their own, however many teams anyone is on", async () => {
    /*
     * The first person is on so many teams that a read of everyone's
     * memberships at once - the first 10,000 - held only theirs.
     */
    const reads: Array<{ query: Record<string, unknown>; limit: number }> = [];

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
      query: Record<string, unknown>;
      limit: number;
    }) => {
      reads.push({ query: data.query, limit: data.limit });

      const userId: string = String(data.query["userId"]);
      const member: Member | undefined = MEMBERS.find(
        (candidate: Member): boolean => {
          return candidate.id === userId;
        },
      );

      return {
        data: member ? [teamMemberOf(member)] : [],
        count: member ? 10_050 : 0,
        skip: 0,
        limit: data.limit,
      };
    }) as never);

    const options: Array<FilterChipDropdownOption> =
      await resolveProjectUserOptions(
        PROJECT_ID,
        MEMBERS.map((member: Member): string => {
          return member.id;
        }),
      );

    expect(
      options.map((option: FilterChipDropdownOption): string => {
        return option.value;
      }),
    ).toEqual(
      MEMBERS.map((member: Member): string => {
        return member.id;
      }),
    );
    expect(reads).toHaveLength(MEMBERS.length);

    for (const read of reads) {
      expect(read.limit).toBe(1);
      expect(read.query["projectId"]).toBe(PROJECT_ID);
      expect(read.query["userId"]).toBeInstanceOf(ObjectID);
    }
  });

  test("a person picked twice is read once, and a value that is no id is never sent", async () => {
    const reads: Array<Record<string, unknown>> = [];

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
      query: Record<string, unknown>;
    }) => {
      reads.push(data.query);
      return { data: [], count: 0, skip: 0, limit: 1 };
    }) as never);

    await resolveProjectUserOptions(PROJECT_ID, [
      MEMBERS[0]!.id,
      MEMBERS[0]!.id,
      "not-an-id",
      "",
    ]);

    expect(reads).toHaveLength(1);
    expect(String(reads[0]!["userId"])).toBe(MEMBERS[0]!.id);

    reads.length = 0;

    expect(await resolveProjectUserOptions(PROJECT_ID, ["nobody"])).toEqual([]);
    expect(reads).toHaveLength(0);
  });

  test("someone no longer in the project reads as nobody, and the rest are named", async () => {
    jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
      query: Record<string, unknown>;
    }) => {
      const userId: string = String(data.query["userId"]);

      return {
        data: userId === MEMBERS[1]!.id ? [teamMemberOf(MEMBERS[1]!)] : [],
        count: 0,
        skip: 0,
        limit: 1,
      };
    }) as never);

    const options: Array<FilterChipDropdownOption> =
      await resolveProjectUserOptions(PROJECT_ID, [
        "0000000e-0000-4000-8000-0000000000ff",
        MEMBERS[1]!.id,
      ]);

    expect(
      options.map((option: FilterChipDropdownOption): string => {
        return option.label;
      }),
    ).toEqual(["Priya Nair (SOC, EMEA)"]);
  });

  test("many picked are named ten at a time, every one of them", async () => {
    let inFlight: number = 0;
    let mostInFlight: number = 0;
    const named: Array<string> = [];

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
      query: Record<string, unknown>;
    }) => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await Promise.resolve();
      inFlight--;

      const userId: string = String(data.query["userId"]);
      named.push(userId);

      return {
        data: [
          teamMemberOf({
            id: userId,
            name: `Person ${userId}`,
            email: "x@y.z",
          }),
        ],
        count: 1,
        skip: 0,
        limit: 1,
      };
    }) as never);

    const userIds: Array<string> = Array.from(
      { length: 25 },
      (_: unknown, index: number): string => {
        return `0000000f-0000-4000-8000-${String(index).padStart(12, "0")}`;
      },
    );

    const options: Array<FilterChipDropdownOption> =
      await resolveProjectUserOptions(PROJECT_ID, userIds);

    expect(options).toHaveLength(25);
    expect(named.sort()).toEqual([...userIds].sort());
    expect(mostInFlight).toBeLessThanOrEqual(10);
  });
});

describe("the Teams list's Member chip, as the list's own query (#11211)", () => {
  test("'is': the teams one of the people picked is in, through their memberships", () => {
    const filter: LinkedTo | null = buildTeamMemberFilter(
      [MEMBERS[0]!.id, MEMBERS[1]!.id],
      "is",
    );

    expect(filter).toBeInstanceOf(LinkedTo);
    expect(filter!.match).toBe(LinkedToMatch.AnyOf);
    expect(filter!.relations).toEqual({
      [TEAM_MEMBERS_RELATION]: [MEMBERS[0]!.id, MEMBERS[1]!.id],
    });
    expect(TEAM_MEMBERS_RELATION).toBe("members");
  });

  test("'is not': the teams none of them is in", () => {
    expect(buildTeamMemberFilter([MEMBERS[0]!.id], "is_not")!.match).toBe(
      LinkedToMatch.NoneOf,
    );
  });

  test("nobody picked, or nothing that is an id, filters nothing", () => {
    expect(buildTeamMemberFilter([], "is")).toBeNull();
    expect(buildTeamMemberFilter(["not-an-id"], "is_not")).toBeNull();
  });

  test("reads nothing first: the server answers it", () => {
    const getList: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ModelAPI,
      "getList",
    );

    buildTeamMemberFilter([MEMBERS[0]!.id], "is");

    expect(getList).not.toHaveBeenCalled();
  });

  test("the chip writes it under linkedTo, as it crosses the wire", () => {
    const facet: ResourceFacet = {
      key: "member",
      label: "Member",
      isMultiSelect: true,
      supportedOperators: ["is", "is_not"],
      loadOptions: loadProjectUserOptions,
      resolveOptions: resolveProjectUserOptions,
      toLinkedTo: buildTeamMemberFilter,
    };

    const written: ReturnType<typeof buildFacetColumnQuery> =
      buildFacetColumnQuery({
        facet: facet,
        operator: "is",
        values: [MEMBERS[2]!.id],
        existingValue: undefined,
      });

    expect(written?.field).toBe(LINKED_TO_QUERY_KEY);

    const sent: JSONObject = JSONFunctions.deserialize(
      JSON.parse(
        JSON.stringify(
          JSONFunctions.serialize({
            [LINKED_TO_QUERY_KEY]: written!.value,
          } as unknown as JSONObject),
        ),
      ) as JSONObject,
    );

    expect((sent[LINKED_TO_QUERY_KEY] as LinkedTo).relations).toEqual({
      members: [MEMBERS[2]!.id],
    });
  });
});
