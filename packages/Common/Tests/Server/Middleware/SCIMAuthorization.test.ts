import { afterEach, describe, expect, jest, test } from "@jest/globals";
import SCIMMiddleware from "../../../Server/Middleware/SCIMAuthorization";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import StatusPageSCIMService from "../../../Server/Services/StatusPageSCIMService";
import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "../../../Models/DatabaseModels/StatusPageSCIM";
import BadRequestException from "../../../Types/Exception/BadRequestException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";

/*
 * This middleware is the entire authentication boundary for SCIM. Everything
 * behind it creates, updates and DEPROVISIONS users in a project, driven by an
 * identity provider that OneUptime never sees the inside of - so a caller that
 * gets past this gate can delete a customer's staff.
 *
 * The gate is one lookup, and the shape of that lookup is the security
 * property. The bearer token is part of the QUERY, not something compared
 * afterwards: a valid SCIM configuration id presented with the wrong token
 * matches no row, so there is no code path on which a correct id and an
 * incorrect token can meet. Tests that check "wrong token is rejected" against
 * a stubbed lookup would prove nothing about that, so the assertions below are
 * on the QUERY the middleware issues.
 *
 * The other half is Express 4 mechanics. This is an async middleware, and
 * Express 4 does not catch a rejected promise from one - a throw here would
 * hang the request rather than answer it. Every failure has to arrive through
 * next(err), and the middleware must never reject.
 */

const SCIM_ID: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TOKEN: string = "the-identity-provider-secret";

interface FindSpy {
  mock: { calls: Array<Array<unknown>> };
}

type BuildRequestFunction = (data?: {
  params?: Record<string, string>;
  authorization?: string | undefined;
  noHeaders?: boolean;
}) => OneUptimeRequest;

const buildRequest: BuildRequestFunction = (data?: {
  params?: Record<string, string>;
  authorization?: string | undefined;
  noHeaders?: boolean;
}): OneUptimeRequest => {
  const headers: Record<string, string> = {};

  if (data?.authorization !== undefined) {
    headers["authorization"] = data.authorization;
  }

  return {
    params: data?.params ?? { projectScimId: SCIM_ID },
    headers: data?.noHeaders ? undefined : headers,
    method: "GET",
    url: "/scim/v2/Users",
  } as unknown as OneUptimeRequest;
};

type RunFunction = (req: OneUptimeRequest) => Promise<unknown>;

const run: RunFunction = async (req: OneUptimeRequest): Promise<unknown> => {
  let passedToNext: unknown = "NEVER-CALLED";

  await SCIMMiddleware.isAuthorizedSCIMRequest(
    req as unknown as ExpressRequest,
    {} as ExpressResponse,
    (err?: unknown): void => {
      passedToNext = err;
    },
  );

  return passedToNext;
};

type StubProjectFunction = (config: ProjectSCIM | null) => FindSpy;

const stubProjectLookup: StubProjectFunction = (
  config: ProjectSCIM | null,
): FindSpy => {
  return jest
    .spyOn(ProjectSCIMService, "findOneBy")
    .mockResolvedValue(config as never) as unknown as FindSpy;
};

type StubStatusPageFunction = (config: StatusPageSCIM | null) => FindSpy;

const stubStatusPageLookup: StubStatusPageFunction = (
  config: StatusPageSCIM | null,
): FindSpy => {
  return jest
    .spyOn(StatusPageSCIMService, "findOneBy")
    .mockResolvedValue(config as never) as unknown as FindSpy;
};

type BuildProjectConfigFunction = () => ProjectSCIM;

const buildProjectConfig: BuildProjectConfigFunction = (): ProjectSCIM => {
  const config: ProjectSCIM = new ProjectSCIM();
  config.id = new ObjectID(SCIM_ID);
  config.projectId = PROJECT_ID;
  config.autoProvisionUsers = true;
  config.autoDeprovisionUsers = false;

  return config;
};

type BuildStatusPageConfigFunction = () => StatusPageSCIM;

const buildStatusPageConfig: BuildStatusPageConfigFunction =
  (): StatusPageSCIM => {
    const config: StatusPageSCIM = new StatusPageSCIM();
    config.id = new ObjectID(SCIM_ID);
    config.projectId = PROJECT_ID;
    config.statusPageId = STATUS_PAGE_ID;

    return config;
  };

describe("a request with no usable credential never reaches a lookup", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("refuses a route that carries no SCIM id", async () => {
    const projectSpy: FindSpy = stubProjectLookup(buildProjectConfig());
    const statusPageSpy: FindSpy = stubStatusPageLookup(null);

    const err: unknown = await run(
      buildRequest({ params: {}, authorization: `Bearer ${TOKEN}` }),
    );

    expect(err).toBeInstanceOf(BadRequestException);
    expect(projectSpy.mock.calls.length).toBe(0);
    expect(statusPageSpy.mock.calls.length).toBe(0);
  });

  test("refuses a request with no Authorization header at all", async () => {
    const projectSpy: FindSpy = stubProjectLookup(buildProjectConfig());

    const err: unknown = await run(buildRequest());

    expect(err).toBeInstanceOf(NotAuthorizedException);
    expect(projectSpy.mock.calls.length).toBe(0);
  });

  test("refuses a request with no headers object whatsoever", async () => {
    stubProjectLookup(buildProjectConfig());

    expect(await run(buildRequest({ noHeaders: true }))).toBeInstanceOf(
      NotAuthorizedException,
    );
  });

  test("refuses an empty Authorization header", async () => {
    stubProjectLookup(buildProjectConfig());

    expect(await run(buildRequest({ authorization: "" }))).toBeInstanceOf(
      NotAuthorizedException,
    );
  });

  /*
   * The scheme is required. A raw token pasted into the header - the mistake
   * every identity-provider configuration screen invites - must be refused
   * rather than quietly treated as a credential.
   */
  test("refuses a bare token with no Bearer scheme", async () => {
    const projectSpy: FindSpy = stubProjectLookup(buildProjectConfig());

    expect(await run(buildRequest({ authorization: TOKEN }))).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(projectSpy.mock.calls.length).toBe(0);
  });

  test("refuses a different auth scheme carrying the same token", async () => {
    stubProjectLookup(buildProjectConfig());

    expect(
      await run(buildRequest({ authorization: `Basic ${TOKEN}` })),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  /*
   * "bearer" lowercase is what several HTTP clients emit. It is not accepted
   * here, and that is worth recording rather than discovering: the refusal is
   * a 401 an operator can act on, whereas silently accepting it would make
   * the scheme check decorative.
   */
  test("requires the scheme spelled with a capital B", async () => {
    stubProjectLookup(buildProjectConfig());

    expect(
      await run(buildRequest({ authorization: `bearer ${TOKEN}` })),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("refuses the scheme with nothing after it", async () => {
    stubProjectLookup(buildProjectConfig());

    expect(
      await run(buildRequest({ authorization: "Bearer " })),
    ).toBeInstanceOf(NotAuthorizedException);
  });
});

describe("the lookup itself is the security boundary", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The token is a query TERM. That is the whole property: there is no branch
   * on which a correct id and an incorrect token can meet, because a wrong
   * token simply matches no row. A refactor that read the row by id and
   * compared the token afterwards would still pass a "wrong token is
   * rejected" test while introducing a timing oracle and a place to get the
   * comparison wrong.
   */
  test("queries on the id AND the token together", async () => {
    const spy: FindSpy = stubProjectLookup(buildProjectConfig());

    await run(buildRequest({ authorization: `Bearer ${TOKEN}` }));

    const query: Record<string, unknown> = (
      spy.mock.calls[0]![0] as Record<string, Record<string, unknown>>
    )["query"]!;

    expect(String(query["_id"])).toBe(SCIM_ID);
    expect(query["bearerToken"]).toBe(TOKEN);
  });

  test("passes the token through verbatim, without trimming or decoding it", async () => {
    const spy: FindSpy = stubProjectLookup(buildProjectConfig());

    await run(buildRequest({ authorization: "Bearer  spaced+token/=" }));

    const query: Record<string, unknown> = (
      spy.mock.calls[0]![0] as Record<string, Record<string, unknown>>
    )["query"]!;

    expect(query["bearerToken"]).toBe(" spaced+token/=");
  });

  /*
   * The SCIM caller holds no OneUptime permissions of its own - it is an
   * identity provider, not a project member - so the lookup has to run as
   * root. Anything narrower would find no configuration and lock out every
   * correctly configured customer.
   */
  test("reads as root, because the caller holds no project permissions", async () => {
    const spy: FindSpy = stubProjectLookup(buildProjectConfig());

    await run(buildRequest({ authorization: `Bearer ${TOKEN}` }));

    expect((spy.mock.calls[0]![0] as Record<string, unknown>)["props"]).toEqual(
      { isRoot: true },
    );
  });

  test("never selects the bearer token back out of the row", async () => {
    const spy: FindSpy = stubProjectLookup(buildProjectConfig());

    await run(buildRequest({ authorization: `Bearer ${TOKEN}` }));

    const select: Record<string, unknown> = (
      spy.mock.calls[0]![0] as Record<string, Record<string, unknown>>
    )["select"]!;

    expect(select["bearerToken"]).toBeUndefined();
  });

  test("refuses when no configuration matches the id and token", async () => {
    stubProjectLookup(null);
    stubStatusPageLookup(null);

    const err: unknown = await run(
      buildRequest({ authorization: `Bearer ${TOKEN}` }),
    );

    expect(err).toBeInstanceOf(NotAuthorizedException);
  });

  test("the refusal does not disclose whether the id or the token was wrong", async () => {
    stubProjectLookup(null);
    stubStatusPageLookup(null);

    const err: unknown = await run(
      buildRequest({ authorization: `Bearer ${TOKEN}` }),
    );

    expect((err as Error).message).toBe(
      "Invalid bearer token or SCIM configuration not found",
    );
  });
});

describe("a project SCIM caller that authenticates", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is let through with no error", async () => {
    stubProjectLookup(buildProjectConfig());

    expect(
      await run(buildRequest({ authorization: `Bearer ${TOKEN}` })),
    ).toBeUndefined();
  });

  test("carries its project, its configuration and its type onward", async () => {
    stubProjectLookup(buildProjectConfig());

    const req: OneUptimeRequest = buildRequest({
      authorization: `Bearer ${TOKEN}`,
    });

    await run(req);

    const data: Record<string, unknown> =
      req.bearerTokenData as unknown as Record<string, unknown>;

    expect(data["type"]).toBe("project-scim");
    expect(String(data["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(data["projectScimId"])).toBe(SCIM_ID);
    expect(data["scimConfig"]).toBeInstanceOf(ProjectSCIM);
  });

  test("does not go on to try the status page lookup", async () => {
    stubProjectLookup(buildProjectConfig());
    const statusPageSpy: FindSpy = stubStatusPageLookup(
      buildStatusPageConfig(),
    );

    await run(buildRequest({ authorization: `Bearer ${TOKEN}` }));

    expect(statusPageSpy.mock.calls.length).toBe(0);
  });
});

describe("a status page SCIM caller that authenticates", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is reached only after the project lookup misses", async () => {
    stubProjectLookup(null);
    const statusPageSpy: FindSpy = stubStatusPageLookup(
      buildStatusPageConfig(),
    );

    const err: unknown = await run(
      buildRequest({
        params: { statusPageScimId: SCIM_ID },
        authorization: `Bearer ${TOKEN}`,
      }),
    );

    expect(err).toBeUndefined();
    expect(statusPageSpy.mock.calls.length).toBe(1);
  });

  test("carries its status page and its type onward", async () => {
    stubProjectLookup(null);
    stubStatusPageLookup(buildStatusPageConfig());

    const req: OneUptimeRequest = buildRequest({
      params: { statusPageScimId: SCIM_ID },
      authorization: `Bearer ${TOKEN}`,
    });

    await run(req);

    const data: Record<string, unknown> =
      req.bearerTokenData as unknown as Record<string, unknown>;

    expect(data["type"]).toBe("status-page-scim");
    expect(String(data["statusPageId"])).toBe(STATUS_PAGE_ID.toString());
    expect(String(data["statusPageScimId"])).toBe(SCIM_ID);
    expect(data["projectId"]).toBeDefined();
  });

  test("is looked up on the id and the token together too", async () => {
    stubProjectLookup(null);
    const spy: FindSpy = stubStatusPageLookup(buildStatusPageConfig());

    await run(
      buildRequest({
        params: { statusPageScimId: SCIM_ID },
        authorization: `Bearer ${TOKEN}`,
      }),
    );

    const query: Record<string, unknown> = (
      spy.mock.calls[0]![0] as Record<string, Record<string, unknown>>
    )["query"]!;

    expect(String(query["_id"])).toBe(SCIM_ID);
    expect(query["bearerToken"]).toBe(TOKEN);
  });

  test("also reads as root", async () => {
    stubProjectLookup(null);
    const spy: FindSpy = stubStatusPageLookup(buildStatusPageConfig());

    await run(
      buildRequest({
        params: { statusPageScimId: SCIM_ID },
        authorization: `Bearer ${TOKEN}`,
      }),
    );

    expect((spy.mock.calls[0]![0] as Record<string, unknown>)["props"]).toEqual(
      { isRoot: true },
    );
  });
});

describe("Express 4 does not catch a rejected async middleware", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * So every failure has to arrive through next(err). A middleware that threw
   * would leave the request hanging until the client gave up, which reads to
   * an identity provider as a timeout rather than as a rejected credential -
   * and identity providers retry timeouts.
   */
  test("a database failure is handed to next, not thrown", async () => {
    jest
      .spyOn(ProjectSCIMService, "findOneBy")
      .mockRejectedValue(new Error("connection refused") as never);

    const err: unknown = await run(
      buildRequest({ authorization: `Bearer ${TOKEN}` }),
    );

    expect((err as Error).message).toBe("connection refused");
  });

  test("a failure in the status page lookup is handed to next too", async () => {
    stubProjectLookup(null);
    jest
      .spyOn(StatusPageSCIMService, "findOneBy")
      .mockRejectedValue(new Error("clickhouse is unhappy") as never);

    const err: unknown = await run(
      buildRequest({
        params: { statusPageScimId: SCIM_ID },
        authorization: `Bearer ${TOKEN}`,
      }),
    );

    expect((err as Error).message).toBe("clickhouse is unhappy");
  });

  test("the middleware itself never rejects", async () => {
    jest
      .spyOn(ProjectSCIMService, "findOneBy")
      .mockRejectedValue(new Error("boom") as never);

    await expect(
      SCIMMiddleware.isAuthorizedSCIMRequest(
        buildRequest({
          authorization: `Bearer ${TOKEN}`,
        }) as unknown as ExpressRequest,
        {} as ExpressResponse,
        (): void => {},
      ),
    ).resolves.toBeUndefined();
  });

  test("next is called exactly once on the refusal path", async () => {
    stubProjectLookup(null);
    stubStatusPageLookup(null);

    let calls: number = 0;

    await SCIMMiddleware.isAuthorizedSCIMRequest(
      buildRequest({
        authorization: `Bearer ${TOKEN}`,
      }) as unknown as ExpressRequest,
      {} as ExpressResponse,
      (): void => {
        calls++;
      },
    );

    expect(calls).toBe(1);
  });

  test("next is called exactly once on the success path", async () => {
    stubProjectLookup(buildProjectConfig());

    let calls: number = 0;

    await SCIMMiddleware.isAuthorizedSCIMRequest(
      buildRequest({
        authorization: `Bearer ${TOKEN}`,
      }) as unknown as ExpressRequest,
      {} as ExpressResponse,
      (): void => {
        calls++;
      },
    );

    expect(calls).toBe(1);
  });
});
