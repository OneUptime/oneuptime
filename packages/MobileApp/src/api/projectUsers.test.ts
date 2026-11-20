import apiClient from "./client";
import {
  TEAM_PEOPLE_READ_LIMIT,
  fetchProjectUsers,
  fetchTeamNames,
  fetchTeamPeople,
  type TeamPeople,
} from "./projectUsers";
import { describe, expect, test, beforeEach } from "@jest/globals";
import type { ProjectUserItem } from "./types";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(async () => {
        return { data: { data: [] } };
      }),
    },
  };
});

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

function member(
  userId: string,
  name: string,
  email: string,
): Record<string, unknown> {
  return {
    _id: `member-${userId}`,
    user: {
      _id: userId,
      name: { _type: "Name", value: name },
      email: { _type: "Email", value: email },
    },
  };
}

/*
 * The list behind the "route my pages to" picker. Two properties matter more
 * than the shape: one person must appear once no matter how many teams they
 * are on (a duplicated row is a picker that looks broken), and somebody who
 * has never accepted their invitation must not appear at all - routing pages
 * to an account that has never signed in is a silent drop.
 */

describe("fetchProjectUsers", () => {
  beforeEach(() => {
    postSpy().mockClear();
    postSpy().mockResolvedValue({ data: { data: [] } } as never);
  });

  test("asks only for members who accepted their invitation", async () => {
    await fetchProjectUsers("project-1");

    const calls: Array<Array<unknown>> = postSpy().mock.calls;
    const body: { query: Record<string, unknown> } = calls[
      calls.length - 1
    ]![1] as { query: Record<string, unknown> };

    expect(body.query["hasAcceptedInvitation"]).toBe(true);
  });

  test("scopes to the project with the tenant header", async () => {
    await fetchProjectUsers("project-1");

    const calls: Array<Array<unknown>> = postSpy().mock.calls;
    const config: { headers: Record<string, string> } = calls[
      calls.length - 1
    ]![2] as { headers: Record<string, string> };

    expect(config.headers["tenantid"]).toBe("project-1");
  });

  test("deduplicates a person who sits on several teams", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          member("user-1", "Ada Lovelace", "ada@example.com"),
          member("user-1", "Ada Lovelace", "ada@example.com"),
          member("user-2", "Priya Rao", "priya@example.com"),
        ],
      },
    } as never);

    const users: ProjectUserItem[] = await fetchProjectUsers("project-1");

    expect(
      users.map((user: ProjectUserItem) => {
        return user.userId;
      }),
    ).toEqual(["user-1", "user-2"]);
  });

  test("unwraps serialized names and emails", async () => {
    postSpy().mockResolvedValue({
      data: { data: [member("user-1", "Ada Lovelace", "ada@example.com")] },
    } as never);

    const users: ProjectUserItem[] = await fetchProjectUsers("project-1");

    expect(users[0]).toEqual({
      userId: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  test("sorts by display name so the picker is scannable", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          member("user-2", "Priya Rao", "priya@example.com"),
          member("user-1", "Ada Lovelace", "ada@example.com"),
        ],
      },
    } as never);

    const users: ProjectUserItem[] = await fetchProjectUsers("project-1");

    expect(
      users.map((user: ProjectUserItem) => {
        return user.name;
      }),
    ).toEqual(["Ada Lovelace", "Priya Rao"]);
  });

  test("falls back to the email when a member has no name set", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          {
            _id: "member-1",
            user: {
              _id: "user-1",
              email: { _type: "Email", value: "z@x.com" },
            },
          },
          member("user-2", "Ada", "ada@example.com"),
        ],
      },
    } as never);

    const users: ProjectUserItem[] = await fetchProjectUsers("project-1");

    // "Ada" sorts before "z@x.com" when the nameless row falls back to email.
    expect(users[0]?.name).toBe("Ada");
    expect(users[1]?.name).toBe("");
    expect(users[1]?.email).toBe("z@x.com");
  });

  test("skips rows whose user could not be read", async () => {
    postSpy().mockResolvedValue({
      data: { data: [{ _id: "member-1" }, { _id: "member-2", user: {} }] },
    } as never);

    await expect(fetchProjectUsers("project-1")).resolves.toEqual([]);
  });
});

/*
 * #9883: the people of the teams someone who manages their own team's
 * user overrides may name - for the pickers (who), and for the locks on
 * the overrides naming anybody else (who is in which team).
 */
describe("fetchTeamPeople", () => {
  beforeEach(() => {
    postSpy().mockClear();
    postSpy().mockResolvedValue({ data: { data: [] } } as never);
  });

  function teamMember(
    teamId: string,
    userId: string,
    name: string,
  ): Record<string, unknown> {
    return {
      _id: `member-${teamId}-${userId}`,
      teamId: teamId,
      userId: userId,
      user: {
        _id: userId,
        name: { _type: "Name", value: name },
        email: { _type: "Email", value: `${name.toLowerCase()}@example.com` },
      },
    };
  }

  function lastRequest(): {
    url: string;
    body: Record<string, unknown>;
    config: { headers: Record<string, string> };
  } {
    const calls: Array<Array<unknown>> = postSpy().mock.calls;
    const call: Array<unknown> = calls[calls.length - 1]!;

    return {
      url: call[0] as string,
      body: call[1] as Record<string, unknown>,
      config: call[2] as { headers: Record<string, string> },
    };
  }

  test("asks for the accepted members of those teams only, in the project", async () => {
    await fetchTeamPeople("project-1", ["team-payments", "team-mobile"]);

    const request: ReturnType<typeof lastRequest> = lastRequest();

    expect(request.url).toBe(
      `/api/team-member/get-list?skip=0&limit=${TEAM_PEOPLE_READ_LIMIT}`,
    );
    expect(request.body["query"]).toEqual({
      teamId: { _type: "Includes", value: ["team-payments", "team-mobile"] },
      hasAcceptedInvitation: true,
    });
    expect(request.body["select"]).toEqual({
      _id: true,
      teamId: true,
      userId: true,
      user: { _id: true, name: true, email: true },
    });
    expect(request.config.headers["tenantid"]).toBe("project-1");
  });

  test("lists each person once, by name, whatever the case of their id, and says who is in which team", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          teamMember("team-payments", "user-sam", "Sam"),
          teamMember("team-payments", "user-ada", "Ada"),
          teamMember("TEAM-MOBILE", "USER-SAM", "Sam"),
        ],
        count: 3,
      },
    } as never);

    const people: TeamPeople = await fetchTeamPeople("project-1", [
      "team-payments",
      "team-mobile",
    ]);

    expect(
      people.users.map((user: ProjectUserItem): string => {
        return user.userId;
      }),
    ).toEqual(["user-ada", "user-sam"]);
    expect(people.membersByTeam).toEqual(
      new Map<string, Set<string>>([
        ["team-payments", new Set<string>(["user-sam", "user-ada"])],
        ["team-mobile", new Set<string>(["user-sam"])],
      ]),
    );
  });

  test("one person in two teams is listed once", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          teamMember("team-payments", "user-sam", "Sam"),
          teamMember("team-mobile", "user-sam", "Sam"),
        ],
        count: 2,
      },
    } as never);

    const people: TeamPeople = await fetchTeamPeople("project-1", [
      "team-payments",
      "team-mobile",
    ]);

    expect(people.users).toEqual([
      { userId: "user-sam", name: "Sam", email: "sam@example.com" },
    ]);
  });

  test("a read cut short knows who it listed, but not who is in which team", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [teamMember("team-payments", "user-sam", "Sam")],
        count: 1500,
      },
    } as never);

    const people: TeamPeople = await fetchTeamPeople("project-1", [
      "team-payments",
    ]);

    expect(people.users).toHaveLength(1);
    expect(people.membersByTeam).toBeNull();
  });

  test("no team to ask about asks nothing, and names nobody", async () => {
    await expect(fetchTeamPeople("project-1", [])).resolves.toEqual({
      users: [],
      membersByTeam: new Map<string, Set<string>>(),
    });
    expect(postSpy()).not.toHaveBeenCalled();
  });

  test("a failed read is thrown, never read as nobody", async () => {
    postSpy().mockRejectedValue(new Error("Network Error") as never);

    await expect(
      fetchTeamPeople("project-1", ["team-payments"]),
    ).rejects.toThrow("Network Error");
  });
});

describe("fetchTeamNames", () => {
  beforeEach(() => {
    postSpy().mockClear();
    postSpy().mockResolvedValue({ data: { data: [] } } as never);
  });

  test("asks for those teams' names, by name, in the project", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          { _id: "team-mobile", name: "Mobile" },
          { _id: "team-payments", name: " Payments " },
          { _id: "team-nameless", name: "" },
        ],
      },
    } as never);

    await expect(
      fetchTeamNames("project-1", ["team-payments", "team-mobile"]),
    ).resolves.toEqual(["Mobile", "Payments"]);

    const calls: Array<Array<unknown>> = postSpy().mock.calls;
    const call: Array<unknown> = calls[calls.length - 1]!;

    expect(call[0]).toBe("/api/team/get-list?skip=0&limit=2");
    expect(call[1]).toEqual({
      query: {
        _id: { _type: "Includes", value: ["team-payments", "team-mobile"] },
      },
      select: { _id: true, name: true },
      sort: { name: "ASC" },
    });
    expect((call[2] as { headers: Record<string, string> }).headers).toEqual({
      tenantid: "project-1",
    });
  });

  test("no team names none, and asks nothing", async () => {
    await expect(fetchTeamNames("project-1", [])).resolves.toEqual([]);
    expect(postSpy()).not.toHaveBeenCalled();
  });
});
