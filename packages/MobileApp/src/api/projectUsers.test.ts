import apiClient from "./client";
import { fetchProjectUsers } from "./projectUsers";
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
