import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  loadProjectUserOptions,
  resolveProjectUserOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ProjectUserFacetOptions";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
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
