import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackApiError,
  OpenStackBudgetExceededError,
} from "../../../Utils/OpenStack/OpenStackCollectionErrors";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
  OpenStackRequestTimeoutError,
  OpenStackTransport,
} from "../../../Utils/OpenStack/OpenStackHttp";
import {
  OpenStackKeystoneSession,
  OpenStackToken,
  parseKeystoneToken,
} from "../../../Utils/OpenStack/OpenStackKeystone";
import OpenStackServiceClient, {
  MAX_PAGES_PER_LIST,
  OpenStackJsonAnswer,
  OpenStackListAnswer,
  SLOW_ANSWER_THRESHOLD_IN_MS,
  buildOpenStackQueryString,
  mapWithLimit,
} from "../../../Utils/OpenStack/OpenStackServiceClient";
import { FakeClock, createFakeClock } from "./Helpers/CollectorHarness";

/*
 * One service in one region, asked gently: every list paged by marker, nothing following
 * a URL an answer offers, a 429 given room, a slow answer given room too, and nothing
 * past the deadline.
 */

const BASE_URL: string = "https://nova.example.com/compute/v2.1";

function tokenOf(id: string): OpenStackToken {
  return parseKeystoneToken({ tokenId: id, body: { token: {} } });
}

interface Setup {
  client: OpenStackServiceClient;
  clock: FakeClock;
  requests: Array<OpenStackHttpRequest>;
  session: OpenStackKeystoneSession;
}

function setup(data: {
  transport: OpenStackTransport;
  deadlineInMs?: number | undefined;
  pageSize?: number | undefined;
  session?: OpenStackKeystoneSession | undefined;
  clock?: FakeClock | undefined;
}): Setup {
  const clock: FakeClock = data.clock || createFakeClock();
  const requests: Array<OpenStackHttpRequest> = [];

  const session: OpenStackKeystoneSession =
    data.session ||
    new OpenStackKeystoneSession({
      token: tokenOf("the-token"),
      isFresh: true,
      login: async (): Promise<OpenStackToken> => {
        return tokenOf("renewed");
      },
    });

  return {
    clock: clock,
    requests: requests,
    session: session,
    client: new OpenStackServiceClient({
      service: OpenStackServiceType.Compute,
      regionName: "RegionOne",
      baseUrl: BASE_URL,
      clock: clock,
      deadlineAt: clock.now() + (data.deadlineInMs ?? 600_000),
      session: session,
      userAgent: "test-agent",
      pageSize: data.pageSize,
      transport: async (
        request: OpenStackHttpRequest,
      ): Promise<OpenStackHttpResponse> => {
        requests.push(request);
        return await data.transport(request);
      },
    }),
  };
}

function ok(body: JSONObject): OpenStackHttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

function status(
  code: number,
  body: string = "",
  headers: Record<string, string> = {},
): OpenStackHttpResponse {
  return { status: code, headers: headers, body: body };
}

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }

  throw new Error("It was meant to fail.");
}

// A list of `count` items, paged the way Nova and Neutron page them.
function pagedList(count: number, key: string = "servers"): OpenStackTransport {
  const items: Array<JSONObject> = Array.from(
    { length: count },
    (_value: unknown, index: number): JSONObject => {
      return { id: `id-${index}` };
    },
  );

  return async (
    request: OpenStackHttpRequest,
  ): Promise<OpenStackHttpResponse> => {
    const url: globalThis.URL = new globalThis.URL(request.url);
    const limit: number = Number(url.searchParams.get("limit"));
    const marker: string | null = url.searchParams.get("marker");
    const start: number = marker
      ? items.findIndex((item: JSONObject): boolean => {
          return item["id"] === marker;
        }) + 1
      : 0;
    const page: Array<JSONObject> = items.slice(start, start + limit);

    return ok({
      [key]: page,
      [`${key}_links`]:
        start + limit < items.length || page.length === limit
          ? [
              {
                rel: "next",
                href: "http://internal-only.example:8774/v2.1/next",
              },
            ]
          : [],
    });
  };
}

describe("asking", () => {
  test("a GET under the service's URL, with its token and who is asking", async () => {
    const { client, requests } = setup({
      transport: async () => {
        return ok({ hello: "world" });
      },
    });

    client.headers = { "OpenStack-API-Version": "compute 2.87" };

    const answer: OpenStackJsonAnswer = await client.get({
      read: "services",
      path: "/os-services",
    });

    expect(answer.body).toEqual({ hello: "world" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "GET",
      url: `${BASE_URL}/os-services`,
      headers: {
        Accept: "application/json",
        "User-Agent": "test-agent",
        "X-Auth-Token": "the-token",
        "OpenStack-API-Version": "compute 2.87",
      },
    });
  });

  test("what answers without a token is sent none", async () => {
    const { client, requests } = setup({
      transport: async () => {
        return ok({});
      },
    });

    await client.get({
      read: "its versions",
      url: "https://nova.example.com/compute/",
      withoutToken: true,
    });

    expect(requests[0]?.url).toBe("https://nova.example.com/compute/");
    expect(requests[0]?.headers["X-Auth-Token"]).toBeUndefined();
  });

  test("a version document can come with 300 Multiple Choices", async () => {
    const { client } = setup({
      transport: async () => {
        return { ...ok({ versions: [] }), status: 300 };
      },
    });

    await expect(
      client.get({ read: "its versions", acceptsMultipleChoices: true }),
    ).resolves.toMatchObject({ body: { versions: [] } });
    await expect(client.get({ read: "services" })).rejects.toBeInstanceOf(
      OpenStackApiError,
    );
  });

  test("it says when the service's own clock says it answered", async () => {
    const { client } = setup({
      transport: async () => {
        return {
          ...ok({}),
          headers: { Date: "Wed, 04 Nov 2026 11:50:00 GMT" },
        };
      },
    });

    expect((await client.get({ read: "services" })).date).toBe(
      "Wed, 04 Nov 2026 11:50:00 GMT",
    );
  });

  test("a query is encoded, and a repeated field repeats", () => {
    expect(
      buildOpenStackQueryString({
        "changes-since": "2026-11-04T09:00:00Z",
        limit: 1000,
        fields: ["id", "router:external"],
        marker: undefined,
        nothing: null,
      }),
    ).toBe(
      "?changes-since=2026-11-04T09%3A00%3A00Z&limit=1000&fields=id&fields=router%3Aexternal",
    );
    expect(buildOpenStackQueryString({})).toBe("");
    expect(buildOpenStackQueryString(undefined)).toBe("");
  });
});

describe("what an answer means", () => {
  test.each([
    [403, "refused"],
    [404, "absent"],
    [429, "overloaded"],
    [502, "overloaded"],
    [503, "overloaded"],
    [504, "overloaded"],
    [500, "failing"],
    [400, "failing"],
    [418, "failing"],
  ])("%s is %s", async (code: number, kind: string) => {
    const { client } = setup({
      transport: async () => {
        return status(code);
      },
    });

    const error: OpenStackApiError = (await failureOf(
      client.get({ read: "services", path: "/os-services" }),
    )) as OpenStackApiError;

    expect(error).toBeInstanceOf(OpenStackApiError);
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(code);
    expect(error.message).toContain("Compute (Nova) in RegionOne");
  });

  test("it quotes what the service said, in whichever way it says it", async () => {
    const { client } = setup({
      transport: async () => {
        return status(
          403,
          JSON.stringify({
            forbidden: {
              message: "Policy doesn't allow os_compute_api:os-services:list",
              code: 403,
            },
          }),
        );
      },
    });

    expect(
      ((await failureOf(client.get({ read: "services" }))) as Error).message,
    ).toBe(
      "Compute (Nova) in RegionOne refused services (HTTP 403): Policy doesn't allow os_compute_api:os-services:list",
    );
  });

  test("a page of HTML from a proxy is not quoted", async () => {
    const { client } = setup({
      transport: async () => {
        return status(503, "<html><body>Service Unavailable</body></html>");
      },
    });

    expect(
      ((await failureOf(client.get({ read: "services" }))) as Error).message,
    ).toBe("Compute (Nova) in RegionOne answered services with HTTP 503.");
  });

  test("a 200 that is not JSON is not what this API sends", async () => {
    const { client } = setup({
      transport: async () => {
        return status(200, "<html>a login page</html>");
      },
    });

    const error: OpenStackApiError = (await failureOf(
      client.get({ read: "services" }),
    )) as OpenStackApiError;

    expect(error.kind).toBe("malformed");
    expect(error.message).toContain("something other than JSON");
  });
});

describe("a 401", () => {
  function keptSession(): {
    session: OpenStackKeystoneSession;
    logins: () => number;
  } {
    let logins: number = 0;

    return {
      logins: (): number => {
        return logins;
      },
      session: new OpenStackKeystoneSession({
        token: tokenOf("kept"),
        isFresh: false,
        login: async (): Promise<OpenStackToken> => {
          logins++;
          return tokenOf("renewed");
        },
      }),
    };
  }

  test("on a kept token logs in once and asks again with the new one", async () => {
    const { session, logins } = keptSession();

    const { client, requests } = setup({
      session: session,
      transport: async (request: OpenStackHttpRequest) => {
        return request.headers["X-Auth-Token"] === "renewed"
          ? ok({ services: [] })
          : status(401);
      },
    });

    await expect(client.get({ read: "services" })).resolves.toMatchObject({
      body: { services: [] },
    });
    expect(logins()).toBe(1);
    expect(
      requests.map((request: OpenStackHttpRequest) => {
        return request.headers["X-Auth-Token"];
      }),
    ).toEqual(["kept", "renewed"]);
  });

  test("on a token just bought is the path, and is refused without a login", async () => {
    const { client, requests } = setup({
      transport: async () => {
        return status(401);
      },
    });

    const error: OpenStackApiError = (await failureOf(
      client.get({ read: "users", path: "/users" }),
    )) as OpenStackApiError;

    expect(error.kind).toBe("refused");
    expect(error.status).toBe(401);
    expect(error.message).toContain("access rules");
    expect(requests).toHaveLength(1);
  });

  test("again after a new token is the path too, and next time costs no login", async () => {
    const { session, logins } = keptSession();

    const first: Setup = setup({
      session: session,
      transport: async () => {
        return status(401);
      },
    });

    const error: OpenStackApiError = (await failureOf(
      first.client.get({ read: "users" }),
    )) as OpenStackApiError;

    expect(error.kind).toBe("refused");
    expect(logins()).toBe(1);
    expect(first.requests).toHaveLength(2);
    expect(session.isKnownRefused("compute:users")).toBe(true);

    // The next collection, on the same kept token.
    const later: { session: OpenStackKeystoneSession; logins: () => number } = {
      logins: logins,
      session: new OpenStackKeystoneSession({
        token: session.getToken(),
        isFresh: false,
        login: async (): Promise<OpenStackToken> => {
          throw new Error("It must not log in again for this.");
        },
        refusedReads: session.getRefusedReads(),
      }),
    };

    const second: Setup = setup({
      session: later.session,
      transport: async () => {
        return status(401);
      },
    });

    await expect(second.client.get({ read: "users" })).rejects.toMatchObject({
      kind: "refused",
    });
    expect(second.requests).toHaveLength(1);
  });

  test("when logging in again fails, the read fails with why", async () => {
    const failure: Error = new Error("Keystone is down");

    const { client } = setup({
      session: new OpenStackKeystoneSession({
        token: tokenOf("kept"),
        isFresh: false,
        login: async (): Promise<OpenStackToken> => {
          throw failure;
        },
      }),
      transport: async () => {
        return status(401);
      },
    });

    expect(await failureOf(client.get({ read: "services" }))).toBe(failure);
  });
});

describe("being gentle", () => {
  test("a 429 is tried again as Retry-After says, and then works", async () => {
    let calls: number = 0;

    const { client, clock } = setup({
      transport: async () => {
        calls++;
        return calls === 1
          ? status(429, "", { "Retry-After": "7" })
          : ok({ fine: true });
      },
    });

    await expect(client.get({ read: "services" })).resolves.toMatchObject({
      body: { fine: true },
    });
    expect(clock.sleeps).toEqual([7000]);
    expect(calls).toBe(2);
  });

  test("a server error is tried three times in all, waiting longer each time", async () => {
    const { client, clock, requests } = setup({
      transport: async () => {
        return status(503);
      },
    });

    const error: OpenStackApiError = (await failureOf(
      client.get({ read: "services" }),
    )) as OpenStackApiError;

    expect(error.kind).toBe("overloaded");
    expect(requests).toHaveLength(3);
    expect(clock.sleeps).toEqual([750, 1500]);
  });

  test("a wait that would cross the deadline is not waited", async () => {
    const { client, clock, requests } = setup({
      deadlineInMs: 5000,
      transport: async () => {
        return status(429, "", { "Retry-After": "20" });
      },
    });

    const error: OpenStackApiError = (await failureOf(
      client.get({ read: "services" }),
    )) as OpenStackApiError;

    expect(error.kind).toBe("overloaded");
    expect(requests).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  test("a slow answer earns the service a pause as long as it took", async () => {
    let clock: FakeClock | null = null;

    const created: Setup = setup({
      transport: async () => {
        clock?.advance(SLOW_ANSWER_THRESHOLD_IN_MS + 1000);
        return ok({});
      },
    });

    clock = created.clock;

    await created.client.get({ read: "first" });
    expect(created.clock.sleeps).toEqual([]);

    await created.client.get({ read: "second" });
    expect(created.clock.sleeps).toEqual([SLOW_ANSWER_THRESHOLD_IN_MS + 1000]);
  });

  test("a quick answer earns no pause", async () => {
    const { client, clock } = setup({
      transport: async () => {
        return ok({});
      },
    });

    await client.get({ read: "first" });
    await client.get({ read: "second" });

    expect(clock.sleeps).toEqual([]);
  });

  test("nothing is asked once the deadline has passed", async () => {
    const created: Setup = setup({
      deadlineInMs: 1000,
      transport: async () => {
        return ok({});
      },
    });

    created.clock.advance(1001);

    expect(
      await failureOf(created.client.get({ read: "services" })),
    ).toBeInstanceOf(OpenStackBudgetExceededError);
    expect(created.requests).toHaveLength(0);
  });

  test("a request's own timeout is cut short by the deadline", async () => {
    const { client, requests } = setup({
      deadlineInMs: 2500,
      transport: async () => {
        return ok({});
      },
    });

    await client.get({ read: "services" });

    expect(requests[0]?.timeoutInMs).toBe(2500);
  });

  test("a pause that would cross the deadline gives up instead", async () => {
    let clock: FakeClock | null = null;

    const created: Setup = setup({
      deadlineInMs: SLOW_ANSWER_THRESHOLD_IN_MS + 2000,
      transport: async () => {
        clock?.advance(SLOW_ANSWER_THRESHOLD_IN_MS + 1000);
        return ok({});
      },
    });

    clock = created.clock;

    await created.client.get({ read: "first" });

    expect(
      await failureOf(created.client.get({ read: "second" })),
    ).toBeInstanceOf(OpenStackBudgetExceededError);
  });

  test("a timeout is not tried again: a struggling service gets no second helping", async () => {
    const { client, requests } = setup({
      transport: async (request: OpenStackHttpRequest) => {
        throw new OpenStackRequestTimeoutError(request.url, 60_000);
      },
    });

    expect(await failureOf(client.get({ read: "services" }))).toBeInstanceOf(
      OpenStackRequestTimeoutError,
    );
    expect(requests).toHaveLength(1);
  });

  test("a socket that closed while idle is tried once more, because nothing was asked yet", async () => {
    let calls: number = 0;

    const { client, requests } = setup({
      transport: async () => {
        calls++;

        if (calls === 1) {
          throw Object.assign(new Error("socket hang up"), {
            code: "ECONNRESET",
          });
        }

        return ok({ fine: true });
      },
    });

    await expect(client.get({ read: "services" })).resolves.toMatchObject({
      body: { fine: true },
    });
    expect(requests).toHaveLength(2);
  });

  test("a socket that keeps closing is a failure, not a loop", async () => {
    const { client, requests } = setup({
      transport: async () => {
        throw Object.assign(new Error("socket hang up"), {
          code: "ECONNRESET",
        });
      },
    });

    await expect(client.get({ read: "services" })).rejects.toThrow(
      "socket hang up",
    );
    expect(requests).toHaveLength(2);
  });
});

describe("paging", () => {
  test("every page by limit and marker, until the service says no more", async () => {
    const { client, requests } = setup({
      pageSize: 2,
      transport: pagedList(5),
    });

    const answer: OpenStackListAnswer = await client.list({
      read: "servers",
      path: "/servers/detail",
      key: "servers",
      paging: "links",
      query: { all_tenants: "1" },
    });

    expect(
      answer.items.map((item: JSONObject) => {
        return item["id"];
      }),
    ).toEqual(["id-0", "id-1", "id-2", "id-3", "id-4"]);
    expect(answer.pageCount).toBe(3);

    expect(
      requests.map((request: OpenStackHttpRequest) => {
        return new globalThis.URL(request.url).search;
      }),
    ).toEqual([
      "?all_tenants=1&limit=2",
      "?all_tenants=1&limit=2&marker=id-1",
      "?all_tenants=1&limit=2&marker=id-3",
    ]);
  });

  test("it never follows the URL an answer offers: a token would go with it", async () => {
    const { client, requests } = setup({
      pageSize: 2,
      transport: pagedList(3),
    });

    await client.list({
      read: "servers",
      path: "/servers/detail",
      key: "servers",
      paging: "links",
    });

    for (const request of requests) {
      expect(request.url.startsWith(BASE_URL)).toBe(true);
      expect(request.url).not.toContain("internal-only");
    }
  });

  test("a last page that is exactly full costs one more question, as the service offered", async () => {
    const { client, requests } = setup({
      pageSize: 2,
      transport: pagedList(4),
    });

    const answer: OpenStackListAnswer = await client.list({
      read: "servers",
      path: "/servers/detail",
      key: "servers",
      paging: "links",
    });

    expect(answer.items).toHaveLength(4);
    expect(requests).toHaveLength(3);
  });

  test("a service that ignores limit answers it all at once, which reads as one page", async () => {
    const { client, requests } = setup({
      pageSize: 2,
      transport: async () => {
        return ok({
          agents: Array.from(
            { length: 10 },
            (_value: unknown, index: number): JSONObject => {
              return { id: `a${index}` };
            },
          ),
        });
      },
    });

    const answer: OpenStackListAnswer = await client.list({
      read: "agents",
      path: "/agents",
      key: "agents",
      paging: "links",
    });

    expect(answer.items).toHaveLength(10);
    expect(requests).toHaveLength(1);
  });

  test("a clamped page is paged on by the service's word, not by counting", async () => {
    // Nova's osapi_max_limit can be lower than the limit asked for.
    let calls: number = 0;

    const { client, requests } = setup({
      pageSize: 1000,
      transport: async () => {
        calls++;

        return ok(
          calls === 1
            ? {
                servers: [{ id: "a" }, { id: "b" }],
                servers_links: [{ rel: "next", href: "x" }],
              }
            : { servers: [{ id: "c" }] },
        );
      },
    });

    const answer: OpenStackListAnswer = await client.list({
      read: "servers",
      path: "/servers/detail",
      key: "servers",
      paging: "links",
    });

    expect(answer.items).toHaveLength(3);
    expect(
      new globalThis.URL(requests[1]!.url).searchParams.get("marker"),
    ).toBe("b");
  });

  test("Glance says more with `next`", async () => {
    let calls: number = 0;

    const { client, requests } = setup({
      pageSize: 1,
      transport: async () => {
        calls++;

        return ok(
          calls === 1
            ? { images: [{ id: "i1" }], next: "/v2/images?marker=i1" }
            : { images: [{ id: "i2" }] },
        );
      },
    });

    const answer: OpenStackListAnswer = await client.list({
      read: "images",
      path: "/images",
      key: "images",
      paging: "next",
    });

    expect(answer.items).toHaveLength(2);
    expect(requests[1]?.url).toBe(`${BASE_URL}/images?limit=1&marker=i1`);
  });

  test("a list that does not page is not sent a limit it may refuse", async () => {
    const { client, requests } = setup({
      transport: async () => {
        return ok({ services: [] });
      },
    });

    await client.list({
      read: "services",
      path: "/os-services",
      key: "services",
      paging: "none",
    });

    expect(requests[0]?.url).toBe(`${BASE_URL}/os-services`);
  });

  test("Keystone cutting a list at its list_limit is said out loud", async () => {
    const { client } = setup({
      transport: async () => {
        return ok({ projects: [{ id: "p" }], truncated: true });
      },
    });

    expect(
      (
        await client.list({
          read: "projects",
          path: "/projects",
          key: "projects",
          paging: "none",
        })
      ).isTruncated,
    ).toBe(true);
  });

  test("the time of the first page is what a later incremental read starts from", async () => {
    let calls: number = 0;

    const { client } = setup({
      pageSize: 1,
      transport: async () => {
        calls++;

        return {
          status: 200,
          headers: {
            date:
              calls === 1
                ? "Wed, 04 Nov 2026 11:50:00 GMT"
                : "Wed, 04 Nov 2026 11:59:00 GMT",
          },
          body: JSON.stringify(
            calls === 1
              ? { servers: [{ id: "a" }], servers_links: [{ rel: "next" }] }
              : { servers: [] },
          ),
        };
      },
    });

    expect(
      (
        await client.list({
          read: "servers",
          path: "/servers/detail",
          key: "servers",
          paging: "links",
        })
      ).date,
    ).toBe("Wed, 04 Nov 2026 11:50:00 GMT");
  });

  test("an answer without the list is not what this API sends", async () => {
    const { client } = setup({
      transport: async () => {
        return ok({ somethingElse: [] });
      },
    });

    const error: OpenStackApiError = (await failureOf(
      client.list({
        read: "servers",
        path: "/servers/detail",
        key: "servers",
        paging: "links",
      }),
    )) as OpenStackApiError;

    expect(error.kind).toBe("malformed");
    expect(error.message).toContain("without a list of servers");
  });

  test("a service that offers the same page for ever is stopped", async () => {
    const { client, requests } = setup({
      pageSize: 1,
      transport: async () => {
        return ok({
          servers: [{ id: "same" }],
          servers_links: [{ rel: "next" }],
        });
      },
    });

    const error: OpenStackApiError = (await failureOf(
      client.list({
        read: "servers",
        path: "/servers/detail",
        key: "servers",
        paging: "links",
      }),
    )) as OpenStackApiError;

    expect(error.kind).toBe("malformed");
    expect(error.message).toContain("kept offering another page");
    expect(requests).toHaveLength(2);
  });

  test("a service that pages for ever is stopped too", async () => {
    let calls: number = 0;

    const { client, requests } = setup({
      pageSize: 1,
      transport: async () => {
        calls++;

        return ok({
          servers: [{ id: `id-${calls}` }],
          servers_links: [{ rel: "next" }],
        });
      },
    });

    const error: OpenStackApiError = (await failureOf(
      client.list({
        read: "servers",
        path: "/servers/detail",
        key: "servers",
        paging: "links",
      }),
    )) as OpenStackApiError;

    expect(error.kind).toBe("malformed");
    expect(requests).toHaveLength(MAX_PAGES_PER_LIST);
  });

  test("a page with no id to page on is stopped rather than guessed at", async () => {
    const { client } = setup({
      pageSize: 1,
      transport: async () => {
        return ok({
          servers: [{ name: "no id" }],
          servers_links: [{ rel: "next" }],
        });
      },
    });

    await expect(
      client.list({
        read: "servers",
        path: "/servers/detail",
        key: "servers",
        paging: "links",
      }),
    ).rejects.toMatchObject({ kind: "malformed" });
  });

  test("a million items on one page do not overflow anything", async () => {
    const huge: Array<JSONObject> = Array.from(
      { length: 200_000 },
      (_value: unknown, index: number): JSONObject => {
        return { id: index };
      },
    );

    const { client } = setup({
      transport: async () => {
        return ok({ servers: huge });
      },
    });

    expect(
      (
        await client.list({
          read: "servers",
          path: "/servers/detail",
          key: "servers",
          paging: "none",
        })
      ).items,
    ).toHaveLength(200_000);
  });
});

describe("doing a few things at once", () => {
  test("no more at once than it was told, and each one once", async () => {
    let running: number = 0;
    let most: number = 0;
    const seen: Array<number> = [];

    await mapWithLimit(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      3,
      async (item: number): Promise<void> => {
        running++;
        most = Math.max(most, running);
        await new Promise<void>((resolve: () => void) => {
          setImmediate(resolve);
        });
        seen.push(item);
        running--;
      },
    );

    expect(most).toBe(3);
    expect(
      [...seen].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("nothing to do is nothing to do", async () => {
    await expect(
      mapWithLimit([], 3, async (): Promise<void> => {
        throw new Error("Nothing should run.");
      }),
    ).resolves.toBeUndefined();
  });
});
