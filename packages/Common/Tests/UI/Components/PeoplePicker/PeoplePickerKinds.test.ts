import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * What the people picker asks the server, per kind. People are looked up
 * through the project's team members - the User model is readable only by
 * that user - so a person in three teams must still be one row, and a
 * search must match a name OR an email. Picks a form starts with are only
 * ids, and are looked up by id in one request per kind.
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

import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import {
  getPeoplePickerKindDefinition,
  getPeoplePickerOptionsFromModels,
  PEOPLE_PICKER_KIND_DEFINITIONS,
  PEOPLE_PICKER_SEARCH_LIMIT,
  PeoplePickerKindDefinition,
  pickModelsByIds,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerKinds";
import {
  PeoplePickerKind,
  PeoplePickerOption,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const BOB: string = "0000000e-0000-4000-8000-000000000002";
const NONAME: string = "0000000e-0000-4000-8000-000000000003";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";
const DATABASE: string = "0000000b-0000-4000-8000-000000000002";

function makeUser(data: {
  id: string;
  name?: string;
  email?: string;
  hasPicture?: boolean;
}): User {
  const user: User = new User();
  user._id = data.id;

  if (data.name) {
    user.name = new Name(data.name);
  }

  if (data.email) {
    user.email = new Email(data.email);
  }

  if (data.hasPicture) {
    user.profilePictureId = ObjectID.generate();
  }

  return user;
}

function member(user: User): TeamMember {
  const row: TeamMember = new TeamMember();
  row.user = user;
  return row;
}

function makeTeam(id: string, name: string): Team {
  const team: Team = new Team();
  team._id = id;
  team.name = name;
  return team;
}

function listResult(data: Array<unknown>): {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data, count: data.length, skip: 0, limit: data.length };
}

const USERS: PeoplePickerKindDefinition = getPeoplePickerKindDefinition(
  PeoplePickerKind.User,
);
const TEAMS: PeoplePickerKindDefinition = getPeoplePickerKindDefinition(
  PeoplePickerKind.Team,
);

describe("the kinds the picker offers", () => {
  test("are people and teams, each defined once", () => {
    expect(Object.keys(PEOPLE_PICKER_KIND_DEFINITIONS).sort()).toEqual(
      Object.values(PeoplePickerKind).sort(),
    );

    for (const kind of Object.values(PeoplePickerKind)) {
      expect(getPeoplePickerKindDefinition(kind).kind).toBe(kind);
    }
  });

  test("are headed People and Teams in the search list", () => {
    expect(USERS.groupTitle).toBe("People");
    expect(TEAMS.groupTitle).toBe("Teams");
  });

  test("tag a team, so it never reads as a person, and not a person", () => {
    expect(TEAMS.tag).toBe("Team");
    expect(USERS.tag).toBeUndefined();
  });

  test("draw a person as a person and a team as a group", () => {
    expect(USERS.avatar).toEqual({ type: "person" });
    expect(TEAMS.avatar).toEqual({ type: "group" });
  });

  test("name a pick that is gone for what it was", () => {
    expect(USERS.unknownName).toBe("Unknown user");
    expect(TEAMS.unknownName).toBe("Deleted team");
  });

  test("select what a chip shows from a related row", () => {
    expect(USERS.relationSelect).toEqual({
      _id: true,
      name: true,
      email: true,
      profilePictureId: true,
    });
    expect(TEAMS.relationSelect).toEqual({ _id: true, name: true });
  });

  test("search the search limit at a time", () => {
    expect(PEOPLE_PICKER_SEARCH_LIMIT).toBe(25);
  });
});

describe("searching people", () => {
  beforeEach(() => {
    getListMock.mockReset();
  });

  test("lists the project's team members when nothing is typed", async () => {
    getListMock.mockResolvedValue(
      listResult([member(makeUser({ id: ADA, name: "Ada Lovelace" }))]),
    );

    await USERS.search({
      projectId: PROJECT_ID,
      searchText: "  ",
      limit: 25,
    });

    expect(getListMock).toHaveBeenCalledTimes(1);

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.modelType).toBe(TeamMember);
    expect(request.query).toEqual({ projectId: PROJECT_ID });
    expect(request.limit).toBe(25);
    expect(request.select).toEqual({
      _id: true,
      user: { _id: true, name: true, email: true, profilePictureId: true },
    });
  });

  test("matches what is typed against the name and against the email", async () => {
    getListMock.mockResolvedValue(listResult([]));

    await USERS.search({
      projectId: PROJECT_ID,
      searchText: " ada ",
      limit: 25,
    });

    const queries: Array<any> = getListMock.mock.calls.map(
      (call: Array<any>) => {
        return call[0].query;
      },
    );

    expect(queries).toHaveLength(2);
    expect(queries[0].projectId).toBe(PROJECT_ID);
    expect(queries[0].user.name).toBeInstanceOf(Search);
    expect(queries[0].user.name.toString()).toBe("ada");
    expect(queries[1].user.email).toBeInstanceOf(Search);
    expect(queries[1].user.email.toString()).toBe("ada");
  });

  test("lists a person once, however many teams or matches they turn up in", async () => {
    const ada: User = makeUser({
      id: ADA,
      name: "Ada Lovelace",
      email: "ada@example.com",
    });

    getListMock.mockResolvedValue(listResult([member(ada), member(ada)]));

    const options: Array<PeoplePickerOption> = await USERS.search({
      projectId: PROJECT_ID,
      searchText: "ada",
      limit: 25,
    });

    expect(
      options.map((option: PeoplePickerOption): string => {
        return option.id;
      }),
    ).toEqual([ADA]);
  });

  test("sorts people by name, falling back to their email, and keeps the email to show", async () => {
    getListMock.mockResolvedValue(
      listResult([
        member(makeUser({ id: BOB, name: "bob Smith", email: "b@x.io" })),
        member(makeUser({ id: NONAME, email: "carol@example.com" })),
        member(
          makeUser({
            id: ADA,
            name: "Ada Lovelace",
            email: "ada@example.com",
            hasPicture: true,
          }),
        ),
      ]),
    );

    const options: Array<PeoplePickerOption> = await USERS.search({
      projectId: PROJECT_ID,
      searchText: "",
      limit: 25,
    });

    expect(options).toEqual([
      {
        kind: PeoplePickerKind.User,
        id: ADA,
        name: "Ada Lovelace",
        description: "ada@example.com",
        userId: ADA,
        hasProfilePicture: true,
      },
      {
        kind: PeoplePickerKind.User,
        id: BOB,
        name: "bob Smith",
        description: "b@x.io",
        userId: BOB,
        hasProfilePicture: false,
      },
      {
        kind: PeoplePickerKind.User,
        id: NONAME,
        name: "carol@example.com",
        description: "carol@example.com",
        userId: NONAME,
        hasProfilePicture: false,
      },
    ]);
  });

  test("skips a team member whose user did not come back", async () => {
    getListMock.mockResolvedValue(listResult([new TeamMember()]));

    await expect(
      USERS.search({ projectId: PROJECT_ID, searchText: "", limit: 25 }),
    ).resolves.toEqual([]);
  });
});

describe("looking people up by id", () => {
  beforeEach(() => {
    getListMock.mockReset();
  });

  test("asks for exactly those people, in one request", async () => {
    getListMock.mockResolvedValue(
      listResult([member(makeUser({ id: ADA, name: "Ada Lovelace" }))]),
    );

    const options: Array<PeoplePickerOption> = await USERS.getByIds({
      projectId: PROJECT_ID,
      ids: [ADA, BOB],
    });

    expect(getListMock).toHaveBeenCalledTimes(1);

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.modelType).toBe(TeamMember);
    expect(request.query.projectId).toBe(PROJECT_ID);
    expect(request.query.userId).toBeInstanceOf(Includes);
    expect((request.query.userId as Includes).values).toEqual([ADA, BOB]);
    expect(request.limit).toBe(LIMIT_PER_PROJECT);
    // Only who was found: the picker marks the rest as unknown.
    expect(options.map((option: PeoplePickerOption) => option.id)).toEqual([
      ADA,
    ]);
  });

  test("asks nothing for no ids", async () => {
    await expect(
      USERS.getByIds({ projectId: PROJECT_ID, ids: [] }),
    ).resolves.toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("teams", () => {
  beforeEach(() => {
    getListMock.mockReset();
  });

  test("are searched by name, in name order", async () => {
    getListMock.mockResolvedValue(
      listResult([makeTeam(DATABASE, "Database"), makeTeam(PLATFORM, "Platform")]),
    );

    const options: Array<PeoplePickerOption> = await TEAMS.search({
      projectId: PROJECT_ID,
      searchText: "a",
      limit: 25,
    });

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.modelType).toBe(Team);
    expect(request.query.projectId).toBe(PROJECT_ID);
    expect(request.query.name).toBeInstanceOf(Search);
    expect(request.query.name.toString()).toBe("a");
    expect(request.sort).toEqual({ name: SortOrder.Ascending });
    expect(request.select).toEqual({ _id: true, name: true });
    expect(options).toEqual([
      { kind: PeoplePickerKind.Team, id: DATABASE, name: "Database" },
      { kind: PeoplePickerKind.Team, id: PLATFORM, name: "Platform" },
    ]);
  });

  test("are all listed when nothing is typed", async () => {
    getListMock.mockResolvedValue(listResult([]));

    await TEAMS.search({ projectId: PROJECT_ID, searchText: "", limit: 25 });

    expect(getListMock.mock.calls[0]![0].query).toEqual({
      projectId: PROJECT_ID,
    });
  });

  test("are looked up by id in one request", async () => {
    getListMock.mockResolvedValue(listResult([makeTeam(PLATFORM, "Platform")]));

    await TEAMS.getByIds({ projectId: PROJECT_ID, ids: [PLATFORM, DATABASE] });

    const request: any = getListMock.mock.calls[0]![0];

    expect(request.modelType).toBe(Team);
    expect(request.query._id).toBeInstanceOf(Includes);
    expect((request.query._id as Includes).values).toEqual([
      PLATFORM,
      DATABASE,
    ]);
  });
});

describe("related rows a record already holds", () => {
  beforeEach(() => {
    getListMock.mockReset();
  });

  test("become options without asking the server", () => {
    const ada: User = makeUser({
      id: ADA,
      name: "Ada Lovelace",
      email: "ada@example.com",
    });

    expect(
      getPeoplePickerOptionsFromModels([
        { kind: PeoplePickerKind.User, models: [ada, ada] },
        { kind: PeoplePickerKind.Team, models: [makeTeam(PLATFORM, "Platform")] },
      ]),
    ).toEqual([
      {
        kind: PeoplePickerKind.User,
        id: ADA,
        name: "Ada Lovelace",
        description: "ada@example.com",
        userId: ADA,
        hasProfilePicture: false,
      },
      { kind: PeoplePickerKind.Team, id: PLATFORM, name: "Platform" },
    ]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("read a single row, or none, as a list", () => {
    expect(
      getPeoplePickerOptionsFromModels([
        { kind: PeoplePickerKind.Team, models: makeTeam(PLATFORM, "Platform") },
        { kind: PeoplePickerKind.User, models: undefined },
      ]),
    ).toEqual([{ kind: PeoplePickerKind.Team, id: PLATFORM, name: "Platform" }]);
  });

  test("skip a row with no id", () => {
    expect(
      getPeoplePickerOptionsFromModels([
        { kind: PeoplePickerKind.Team, models: [new Team()] },
      ]),
    ).toEqual([]);
  });

  test("are picked out of a list by id, in the list's order, without case", () => {
    const teams: Array<Team> = [
      makeTeam(PLATFORM, "Platform"),
      makeTeam(DATABASE, "Database"),
    ];

    expect(
      pickModelsByIds(teams, [new ObjectID(DATABASE), PLATFORM.toUpperCase()]),
    ).toEqual(teams);
    expect(pickModelsByIds(teams, [DATABASE])).toEqual([teams[1]]);
    expect(pickModelsByIds(teams, undefined)).toEqual([]);
  });
});
