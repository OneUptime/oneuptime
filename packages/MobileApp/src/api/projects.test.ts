import apiClient from "./client";
import { fetchProjects } from "./projects";
import type { ListResponse, ProjectItem } from "./types";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The one request in this app that is SUPPOSED to reach across tenants.
 *
 * Every other list endpoint names a single project in a `tenantid` header and
 * gets that project's rows back. This one asks "which projects does this user
 * belong to at all", a question no single project can answer, so it carries
 * `is-multi-tenant-query: true` and no tenant at all. The two headers are one
 * keystroke apart in effect and opposite in meaning: adding a tenantid here
 * would return only the project the app happened to name and quietly hide
 * every other project the responder is on call for - and since the project
 * list is what the whole app pivots on, that reads to the user as "my other
 * projects are gone" rather than as a bug in one request.
 *
 * The rest of this file is about `resolveId`. OneUptime serialises an ObjectID
 * as { _type: "ObjectID", value: "uuid" }, and the shared axios instance
 * already unwraps that in a response interceptor - so in production these rows
 * usually arrive with plain strings and `resolveId` is the second line of
 * defence. It is worth testing anyway, because the client mock here removes
 * the interceptor exactly as a future refactor of the interceptor might, and
 * because `_id` is what every subsequent request's tenantid is built from: an
 * id that stays an object does not fail loudly, it becomes a header nothing
 * matches.
 */

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(async () => {
        return { data: { data: [], count: 0, skip: 0, limit: 100 } };
      }),
    },
  };
});

/*
 * A project row as the SERVER may phrase it, which is not the same shape as
 * the ProjectItem callers get back: here `_id` and `slug` are each either a
 * plain string or an ObjectID envelope, and either may be missing entirely.
 */
interface RawProjectRow {
  _id?: string | { _type?: string; value?: string };
  name?: string;
  slug?: string | { _type?: string; value?: string };
  requireSsoForLogin?: boolean;
}

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

function lastCall(): Array<unknown> {
  const calls: Array<Array<unknown>> = postSpy().mock.calls;

  return calls[calls.length - 1]!;
}

function lastUrl(): string {
  return lastCall()[0] as string;
}

function lastBody(): Record<string, unknown> {
  return lastCall()[1] as Record<string, unknown>;
}

function lastHeaders(): Record<string, string> {
  const config: { headers?: Record<string, string> } = lastCall()[2] as {
    headers?: Record<string, string>;
  };

  return config.headers ?? {};
}

function lastSelect(): Record<string, unknown> {
  return lastBody()["select"] as Record<string, unknown>;
}

/**
 * Answer the next call with these rows wrapped in the pagination envelope the
 * list endpoints always send, so a test only has to state the part it is
 * about.
 */
function respondWith(
  rows: Array<RawProjectRow>,
  envelope: Partial<Omit<ListResponse<unknown>, "data">> = {},
): void {
  postSpy().mockResolvedValue({
    data: { data: rows, count: rows.length, skip: 0, limit: 100, ...envelope },
  } as never);
}

describe("fetchProjects addresses the request to every tenant at once", () => {
  beforeEach(() => {
    respondWith([]);
  });

  test("posts to the project list endpoint asking for the first hundred", async () => {
    await fetchProjects();

    expect(lastUrl()).toBe("/api/project/get-list?skip=0&limit=100");
  });

  test("marks the request as a multi-tenant query", async () => {
    /*
     * Without this header the API answers within whatever tenant it can infer
     * and the responder sees a short project list - or none.
     */
    await fetchProjects();

    expect(lastHeaders()["is-multi-tenant-query"]).toBe("true");
  });

  test("sends no tenantid, which would narrow the answer to one project", async () => {
    /*
     * Checked case-insensitively: axios preserves whatever casing the caller
     * wrote, so a `tenantId` slipped in by a future edit would be just as
     * effective at hiding the other projects as a lowercase one, and an
     * exact-key assertion would not notice it.
     */
    await fetchProjects();

    const headerNames: Array<string> = Object.keys(lastHeaders()).map(
      (name: string) => {
        return name.toLowerCase();
      },
    );

    expect(headerNames).not.toContain("tenantid");
  });

  test("filters on nothing, so no project is left out of the list", async () => {
    await fetchProjects();

    expect(lastBody()["query"]).toEqual({});
  });

  test("asks for the fields a project is identified by", async () => {
    await fetchProjects();

    expect(lastSelect()["_id"]).toBe(true);
    expect(lastSelect()["name"]).toBe(true);
    expect(lastSelect()["slug"]).toBe(true);
  });

  test("asks for requireSsoForLogin, the flag that decides whether to call a project at all", async () => {
    /*
     * The on-call hook skips projects that require SSO until the responder has
     * a token for them. If this field stops being selected it arrives
     * undefined, every SSO-protected project looks unprotected, and the app
     * fires requests at them that come back 406.
     */
    await fetchProjects();

    expect(lastSelect()["requireSsoForLogin"]).toBe(true);
  });

  test("sorts by name so the picker is not in insertion order", async () => {
    await fetchProjects();

    expect(lastBody()["sort"]).toEqual({ name: "ASC" });
  });
});

describe("fetchProjects resolves the ids the API sends back", () => {
  beforeEach(() => {
    respondWith([]);
  });

  test("passes a plain string id and slug straight through", async () => {
    respondWith([
      { _id: "project-1", name: "Acme Production", slug: "acme-production" },
    ]);

    const response: ListResponse<ProjectItem> = await fetchProjects();

    expect(response.data[0]!._id).toBe("project-1");
    expect(response.data[0]!.slug).toBe("acme-production");
  });

  test("unwraps an ObjectID envelope into the bare id", async () => {
    respondWith([
      {
        _id: {
          _type: "ObjectID",
          value: "df8c9f1e-0000-4000-8000-000000000001",
        },
        name: "Acme Production",
        slug: "acme-production",
      },
    ]);

    const response: ListResponse<ProjectItem> = await fetchProjects();

    expect(response.data[0]!._id).toBe("df8c9f1e-0000-4000-8000-000000000001");
  });

  test("unwraps the envelope for the slug as well as the id", async () => {
    /*
     * The slug is enveloped by the same serialiser as the id, and an earlier
     * shape of this code unwrapped only the id - which is the kind of asymmetry
     * that survives review because the id, the field everything else keys off,
     * looks right.
     */
    respondWith([
      {
        _id: "project-1",
        name: "Acme Production",
        slug: { _type: "ObjectID", value: "acme-production" },
      },
    ]);

    const response: ListResponse<ProjectItem> = await fetchProjects();

    expect(response.data[0]!.slug).toBe("acme-production");
  });

  test("resolves an absent id to an empty string rather than undefined", async () => {
    /*
     * An empty string is a value callers can compare and reject; undefined
     * stringifies into the word "undefined" the moment it is interpolated into
     * a header or a route, which then looks like a real - and wrong - project.
     */
    respondWith([{ name: "Nameless", slug: "nameless" }]);

    const response: ListResponse<ProjectItem> = await fetchProjects();

    expect(response.data[0]!._id).toBe("");
  });

  test("resolves an absent slug to an empty string", async () => {
    respondWith([{ _id: "project-1", name: "Acme Production" }]);

    const response: ListResponse<ProjectItem> = await fetchProjects();

    expect(response.data[0]!.slug).toBe("");
  });

  test("never hands back the envelope object itself when it carries no value", async () => {
    /*
     * A `_type` with no `value` is a malformed row. The guarantee worth
     * holding is only that callers still receive a STRING - `_id` gets
     * interpolated into a tenantid header and compared against stored SSO
     * tokens, and an object in that position misbehaves in both places. What
     * exact string a malformed row collapses to is deliberately not pinned
     * here; see the concern raised alongside this file.
     */
    respondWith([
      {
        _id: { _type: "ObjectID" },
        name: "Malformed",
        slug: { _type: "ObjectID" },
      },
    ]);

    const response: ListResponse<ProjectItem> = await fetchProjects();

    expect(typeof response.data[0]!._id).toBe("string");
    expect(typeof response.data[0]!.slug).toBe("string");
  });

  test("resolves each row on its own, so one odd row does not spoil the others", async () => {
    /*
     * A response can mix shapes: a project created by an older service may
     * serialise its id differently from one created yesterday, and the list
     * still has to arrive whole.
     */
    respondWith([
      { _id: "project-1", name: "Plain", slug: "plain" },
      {
        _id: { _type: "ObjectID", value: "project-2" },
        name: "Enveloped",
        slug: { _type: "ObjectID", value: "enveloped" },
      },
      { name: "Idless", slug: "idless" },
    ]);

    const response: ListResponse<ProjectItem> = await fetchProjects();

    expect(
      response.data.map((project: ProjectItem) => {
        return project._id;
      }),
    ).toEqual(["project-1", "project-2", ""]);
  });

  test("carries the name and the SSO requirement through untouched", async () => {
    respondWith([
      {
        _id: "project-1",
        name: "Acme Production",
        slug: "acme-production",
        requireSsoForLogin: true,
      },
    ]);

    const response: ListResponse<ProjectItem> = await fetchProjects();

    expect(response.data[0]!.name).toBe("Acme Production");
    expect(response.data[0]!.requireSsoForLogin).toBe(true);
  });

  test("a project the API says nothing about is not treated as SSO-protected", async () => {
    /*
     * Defaulting an unstated flag to "protected" would strand the project
     * behind an SSO prompt that its server never asked for, with no way past
     * it from the app.
     */
    respondWith([
      { _id: "project-1", name: "Acme Production", slug: "acme-production" },
    ]);

    const response: ListResponse<ProjectItem> = await fetchProjects();

    expect(response.data[0]!.requireSsoForLogin).toBeFalsy();
  });
});

describe("fetchProjects keeps the pagination envelope it was given", () => {
  beforeEach(() => {
    respondWith([]);
  });

  test("returns the server's count, skip and limit alongside the rows", async () => {
    /*
     * Only `data` is rewritten; the envelope is the caller's only way of
     * telling "these are all the projects" from "these are the first hundred
     * of them", so it has to survive the remapping intact - note the count
     * here exceeds the number of rows, which is exactly that case.
     */
    respondWith(
      [{ _id: "project-1", name: "Acme Production", slug: "acme-production" }],
      { count: 137, skip: 0, limit: 100 },
    );

    const response: ListResponse<ProjectItem> = await fetchProjects();

    expect(response.count).toBe(137);
    expect(response.skip).toBe(0);
    expect(response.limit).toBe(100);
    expect(response.data).toHaveLength(1);
  });

  test("a user who belongs to no projects gets an empty list, not a failure", async () => {
    /*
     * The real state of a freshly invited account, and the state the project
     * provider renders its empty screen from - it must not arrive as a thrown
     * error, which that provider swallows into a silent blank list.
     */
    respondWith([], { count: 0 });

    const response: ListResponse<ProjectItem> = await fetchProjects();

    expect(response.data).toEqual([]);
    expect(response.count).toBe(0);
  });
});
