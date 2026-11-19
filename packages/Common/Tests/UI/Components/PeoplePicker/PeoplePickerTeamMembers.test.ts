import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A PEOPLE PICKER KEPT TO SOME TEAMS' PEOPLE (issue #9733): a user
 * override's "Who is away?" and "Who covers?", for a reader whose
 * permission reaches the people of their own team only
 * (PeoplePickerFieldConfig.onlyMembersOfTeamIds). Its search asks for the
 * accepted members of those teams alone - an invitation not accepted yet is
 * no membership, as the server counts it - and no team asks for nobody.
 * Every other search, and the look-up of a pick by id, is as it was.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Search from "../../../../Types/BaseDatabase/Search";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import {
  PEOPLE_PICKER_SEARCH_LIMIT,
  PeoplePickerKindDefinition,
  getPeoplePickerKindDefinition,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerKinds";
import {
  PeoplePickerKind,
  PeoplePickerOption,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const PROJECT_ID: ObjectID = new ObjectID(
  "9733e000-0000-4000-8000-000000000001",
);
const PAYMENTS: string = "9733e000-0000-4000-8000-0000000000f1";
const MOBILE: string = "9733e000-0000-4000-8000-0000000000f2";
const ADA: string = "9733e000-0000-4000-8000-0000000000a1";

const users: PeoplePickerKindDefinition = getPeoplePickerKindDefinition(
  PeoplePickerKind.User,
);

const teams: PeoplePickerKindDefinition = getPeoplePickerKindDefinition(
  PeoplePickerKind.Team,
);

function memberNamed(id: string, name: string): TeamMember {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);

  const member: TeamMember = new TeamMember();
  member.user = user;
  return member;
}

// The queries the reads asked with.
function queriesAsked(): Array<Record<string, unknown>> {
  return getListMock.mock.calls.map((call: Array<any>) => {
    return call[0].query as Record<string, unknown>;
  });
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    return {
      data: [memberNamed(ADA, "Ada Lovelace")],
      count: 1,
      skip: 0,
      limit: PEOPLE_PICKER_SEARCH_LIMIT,
    };
  });
});

describe("a search kept to some teams' people", () => {
  test("asks for those teams' accepted members, in the project", async () => {
    const found: Array<PeoplePickerOption> = await users.search({
      projectId: PROJECT_ID,
      searchText: "",
      limit: PEOPLE_PICKER_SEARCH_LIMIT,
      onlyMembersOfTeamIds: [PAYMENTS, MOBILE],
    });

    expect(
      found.map((option: PeoplePickerOption) => {
        return option.id;
      }),
    ).toEqual([ADA]);

    const [query] = queriesAsked();

    expect(query!["projectId"]).toEqual(PROJECT_ID);
    expect(query!["teamId"]).toBeInstanceOf(Includes);
    expect((query!["teamId"] as Includes).values).toEqual([PAYMENTS, MOBILE]);
    expect(query!["hasAcceptedInvitation"]).toBe(true);
    expect(getListMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ modelType: TeamMember }),
    );
  });

  test("a search by name or email is kept to them too: both of its queries", async () => {
    await users.search({
      projectId: PROJECT_ID,
      searchText: "ada",
      limit: PEOPLE_PICKER_SEARCH_LIMIT,
      onlyMembersOfTeamIds: [PAYMENTS],
    });

    const asked: Array<Record<string, unknown>> = queriesAsked();

    expect(asked).toHaveLength(2);

    for (const query of asked) {
      expect((query["teamId"] as Includes).values).toEqual([PAYMENTS]);
      expect(query["hasAcceptedInvitation"]).toBe(true);
      expect(
        ((query["user"] as Record<string, unknown>)["name"] ||
          (query["user"] as Record<string, unknown>)["email"]) instanceof
          Search,
      ).toBe(true);
    }
  });

  test("no team offers nobody, and asks nothing", async () => {
    const found: Array<PeoplePickerOption> = await users.search({
      projectId: PROJECT_ID,
      searchText: "",
      limit: PEOPLE_PICKER_SEARCH_LIMIT,
      onlyMembersOfTeamIds: [],
    });

    expect(found).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("everything else is as it was", () => {
  test("a search kept to no teams asks for every member of the project, invitations included", async () => {
    await users.search({
      projectId: PROJECT_ID,
      searchText: "",
      limit: PEOPLE_PICKER_SEARCH_LIMIT,
    });

    const [query] = queriesAsked();

    expect(query).toEqual({ projectId: PROJECT_ID });
  });

  test("teams are offered as ever: the filter is about people", async () => {
    await teams.search({
      projectId: PROJECT_ID,
      searchText: "",
      limit: PEOPLE_PICKER_SEARCH_LIMIT,
      onlyMembersOfTeamIds: [PAYMENTS],
    });

    const [query] = queriesAsked();

    expect(query).toEqual({ projectId: PROJECT_ID });
  });

  test("a pick already made is looked up by its id, whoever's team it is in", async () => {
    await users.getByIds({ projectId: PROJECT_ID, ids: [ADA] });

    const [query] = queriesAsked();

    expect(query!["teamId"]).toBeUndefined();
    expect((query!["userId"] as Includes).values).toEqual([ADA]);
  });
});
