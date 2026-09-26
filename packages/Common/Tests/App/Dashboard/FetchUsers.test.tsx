import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, RenderResult, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * FetchUsers names the people a create wizard's review step lists - the owners
 * of a scheduled maintenance event or an alert episode, and the people under
 * each incident role. It used to list them from the User model by id, which
 * the server refuses for anyone but a master admin: a User is readable only by
 * that user, so a project owner reviewing their own choices read "You do not
 * have permission to access another user's User" instead of the names.
 *
 * It now looks the people up through TeamMember, the project-scoped link to
 * User the dashboard can list. These tests pin that request, that a person in
 * several teams is listed once, the order, and the error path.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import FetchUsers from "../../../../App/FeatureSet/Dashboard/src/Components/User/FetchUsers";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "3b1d7c2e-5f4a-4e6b-9c8d-7a6f5e4d3c2b";

// What the server says when the User model is listed by other users' ids.
const USER_MODEL_REFUSAL: string =
  "You do not have permission to access another user's User.";

const LOOKUP_FAILURE_MESSAGE: string = "Could not reach the server right now.";

type UserFixture = {
  id: string;
  name: string;
  email: string;
  // How many of the project's teams this person is in.
  teams: number;
};

const ZOE: UserFixture = {
  id: "55555555-5555-4555-8555-000000000001",
  name: "Zoe Adeyemi",
  email: "zoe@example.com",
  teams: 1,
};

const ALICE: UserFixture = {
  id: "55555555-5555-4555-8555-000000000002",
  name: "Alice Nakamura",
  email: "alice@example.com",
  teams: 3,
};

const MARCO: UserFixture = {
  id: "55555555-5555-4555-8555-000000000003",
  name: "Marco Rossi",
  email: "marco@example.com",
  teams: 1,
};

const USER_FIXTURES: Array<UserFixture> = [ZOE, ALICE, MARCO];

type ListRequest = {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
};

type ListAnswer = {
  data: Array<TeamMember>;
  count: number;
  skip: number;
  limit: number;
};

function teamMembersOf(fixture: UserFixture): Array<TeamMember> {
  return Array.from({ length: fixture.teams }, (): TeamMember => {
    const user: User = new User();
    user._id = fixture.id;
    user.name = new Name(fixture.name);
    user.email = new Email(fixture.email);

    const teamMember: TeamMember = new TeamMember();
    teamMember._id = ObjectID.generate().toString();
    teamMember.user = user;
    return teamMember;
  });
}

/*
 * Answers like the server would for a project owner: TeamMember rows by user
 * id, one per team, and a refusal for any list of the User model.
 */
async function answerList(request: ListRequest): Promise<ListAnswer> {
  if (request.modelType === User) {
    throw new Error(USER_MODEL_REFUSAL);
  }

  const userIdQuery: unknown = request.query["userId"];

  if (request.modelType !== TeamMember || !(userIdQuery instanceof Includes)) {
    return { data: [], count: 0, skip: 0, limit: 0 };
  }

  const ids: Array<string> = userIdQuery.values.map(
    (value: string | ObjectID | number): string => {
      return value.toString();
    },
  );

  const data: Array<TeamMember> = USER_FIXTURES.filter(
    (fixture: UserFixture): boolean => {
      return ids.includes(fixture.id);
    },
  ).flatMap(teamMembersOf);

  return { data: data, count: data.length, skip: 0, limit: data.length };
}

function idsOf(fixtures: Array<UserFixture>): Array<ObjectID> {
  return fixtures.map((fixture: UserFixture): ObjectID => {
    return new ObjectID(fixture.id);
  });
}

async function renderUsers(
  fixtures: Array<UserFixture>,
): Promise<RenderResult> {
  const result: RenderResult = render(<FetchUsers userIds={idsOf(fixtures)} />);

  await waitFor(() => {
    expect(result.queryByTestId("component-loader")).toBeNull();
  });

  return result;
}

describe("FetchUsers", () => {
  beforeEach(() => {
    getListMock.mockReset();
    getListMock.mockImplementation(answerList as never);

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("names the people even though the User model refuses to list them", async () => {
    const { container } = await renderUsers([ZOE, MARCO]);

    expect(container).toHaveTextContent(ZOE.name);
    expect(container).toHaveTextContent(MARCO.name);
    expect(container).not.toHaveTextContent(USER_MODEL_REFUSAL);
  });

  test("looks the people up once, through TeamMember in the current project, for exactly their ids", async () => {
    await renderUsers([ZOE, ALICE]);

    expect(getListMock).toHaveBeenCalledTimes(1);

    const request: ListRequest = getListMock.mock.calls[0]![0] as ListRequest;
    const userIdQuery: Includes = request.query["userId"] as Includes;

    expect(request.modelType).toBe(TeamMember);
    expect(String(request.query["projectId"])).toBe(PROJECT_ID);
    expect(
      userIdQuery.values
        .map((value: string | ObjectID | number): string => {
          return value.toString();
        })
        .sort(),
    ).toEqual([ZOE.id, ALICE.id].sort());
    expect(request.select).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({ _id: true, name: true, email: true }),
      }),
    );
  });

  test("lists a person in several teams once, and everyone by name", async () => {
    const { container } = await renderUsers([ZOE, ALICE, MARCO]);

    const text: string = container.textContent || "";

    expect(text.split(ALICE.name)).toHaveLength(2);
    expect(text.indexOf(ALICE.name)).toBeLessThan(text.indexOf(MARCO.name));
    expect(text.indexOf(MARCO.name)).toBeLessThan(text.indexOf(ZOE.name));
  });

  test("shows the error when the lookup fails", async () => {
    getListMock.mockImplementation((async (): Promise<ListAnswer> => {
      throw new Error(LOOKUP_FAILURE_MESSAGE);
    }) as never);

    const { container } = await renderUsers([ZOE]);

    expect(container).toHaveTextContent(LOOKUP_FAILURE_MESSAGE);
    expect(container).not.toHaveTextContent(ZOE.name);
  });
});
