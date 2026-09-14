import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../../../Server/Utils/Express";
import { JSONObject } from "../../../Types/JSON";
import MicrosoftTeamsAPI from "../../../Server/API/MicrosoftTeamsAPI";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";

/*
 * The bug this suite exists for was not in the routing, it was in the answer.
 *
 * /api/microsoft-bot/messages accepts POST only, because Azure Bot Service is
 * the only thing that ever calls it. Checking a messaging endpoint with a
 * browser or curl is the first thing a self-hosted admin does, and that check
 * is a GET — which fell through to the catch-all in StartServer and came back
 * "Page not found - /api/microsoft-bot/messages". True of the method, false of
 * the endpoint, and indistinguishable from a route that had been dropped from
 * the build. Admins filed regressions against the route while the real fault
 * (Azure could not reach the deployment at all) went untouched.
 *
 * So the assertions here are about the response being *diagnostic*: a 405 that
 * separates "wrong method" from "no such route", and a body that redirects the
 * next hour of debugging at the network path instead of OneUptime's routing
 * table. Content assertions look brittle; they are the feature.
 */

const MOCK_TEAMS_CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";
const MOCK_TEAMS_CLIENT_SECRET: string =
  "mock-teams-client-secret-that-must-never-be-echoed";

/*
 * Same lazy-getter shape as MicrosoftTeamsBotTestEndpoint.test.ts: the route
 * reads these at request time (named imports compile to property reads on the
 * module object), so getters let one loaded copy of the API module serve both
 * the configured and unconfigured cases.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const state: { clientId: string | null; clientSecret: string | null } = {
    clientId: "11111111-2222-3333-4444-555555555555",
    clientSecret: "mock-teams-client-secret-that-must-never-be-echoed",
  };

  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    setMockTeamsConfig: (
      clientId: string | null,
      clientSecret: string | null,
    ): void => {
      state.clientId = clientId;
      state.clientSecret = clientSecret;
    },
  };

  Object.defineProperty(mocked, "MicrosoftTeamsAppClientId", {
    get: (): string | null => {
      return state.clientId;
    },
  });

  Object.defineProperty(mocked, "MicrosoftTeamsAppClientSecret", {
    get: (): string | null => {
      return state.clientSecret;
    },
  });

  return mocked;
});

type SetMockTeamsConfigFunction = (
  clientId: string | null,
  clientSecret: string | null,
) => void;

const setTeamsConfig: SetMockTeamsConfigFunction = (
  clientId: string | null,
  clientSecret: string | null,
): void => {
  (
    jest.requireMock("../../../Server/EnvironmentConfig") as {
      setMockTeamsConfig: SetMockTeamsConfigFunction;
    }
  ).setMockTeamsConfig(clientId, clientSecret);
};

type ExpressRouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void> | void;

type ExpressRouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: ExpressRouteHandler }>;
  };
};

const MESSAGES_PATH: string = "/microsoft-bot/messages";

type FindRouteFunction = (
  path: string,
  method: string,
) => ExpressRouterLayer["route"] | undefined;

/*
 * Reads the router the API class actually builds, so the route wiring (path +
 * method) is under test rather than a hand-copied handler.
 */
const findRoute: FindRouteFunction = (
  path: string,
  method: string,
): ExpressRouterLayer["route"] | undefined => {
  const router: ExpressRouter = new MicrosoftTeamsAPI().getRouter();
  const layers: Array<ExpressRouterLayer> = (
    router as unknown as { stack: Array<ExpressRouterLayer> }
  ).stack;

  return layers.find((candidate: ExpressRouterLayer) => {
    return (
      candidate.route?.path === path &&
      candidate.route?.methods[method] === true
    );
  })?.route;
};

type GetMessagesGetHandlerFunction = () => ExpressRouteHandler;

const getMessagesGetHandler: GetMessagesGetHandlerFunction =
  (): ExpressRouteHandler => {
    const route: ExpressRouterLayer["route"] | undefined = findRoute(
      MESSAGES_PATH,
      "get",
    );

    if (!route) {
      throw new Error(
        `GET ${MESSAGES_PATH} is not registered on the MicrosoftTeamsAPI router`,
      );
    }

    expect(route.stack).toHaveLength(1);

    return route.stack[0]!.handle;
  };

type InvokedResponse = {
  statusCode: number;
  body: JSONObject;
  headers: Record<string, string>;
  sentAsCsv: boolean;
};

type CallMessagesGetFunction = (
  query?: Record<string, string>,
) => Promise<InvokedResponse>;

const callMessagesGet: CallMessagesGetFunction = async (
  query: Record<string, string> = {},
): Promise<InvokedResponse> => {
  const handler: ExpressRouteHandler = getMessagesGetHandler();

  const invoked: InvokedResponse = {
    statusCode: 0,
    body: {},
    headers: {},
    sentAsCsv: false,
  };

  const res: Partial<ExpressResponse> = {
    setHeader(name: string, value: string): ExpressResponse {
      invoked.headers[name.toLowerCase()] = value;
      return res as ExpressResponse;
    },
    status(statusCode: number): ExpressResponse {
      invoked.statusCode = statusCode;
      return res as ExpressResponse;
    },
    json(body: JSONObject): ExpressResponse {
      invoked.body = body;
      return res as ExpressResponse;
    },
    /*
     * Present but never expected to fire. Response.sendJsonObjectResponse
     * lands here for its ?output-type=csv branch, so a call to send() would
     * mean the handler went back through the helper that can rewrite a 405
     * into a 200.
     */
    send(body: unknown): ExpressResponse {
      invoked.sentAsCsv = true;
      invoked.body = body as JSONObject;
      return res as ExpressResponse;
    },
  } as unknown as Partial<ExpressResponse>;

  const req: Partial<ExpressRequest> = {
    query: query,
  };

  await handler(req as ExpressRequest, res as ExpressResponse);

  return invoked;
};

type JoinGuidanceFunction = (values: unknown) => string;

const joinGuidance: JoinGuidanceFunction = (values: unknown): string => {
  return (values as Array<string>).join(" | ").toLowerCase();
};

beforeEach(() => {
  setTeamsConfig(MOCK_TEAMS_CLIENT_ID, MOCK_TEAMS_CLIENT_SECRET);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("bot messaging endpoint route registration", () => {
  test("POST /microsoft-bot/messages is registered", () => {
    /*
     * The claim in the bug report was that this route had gone missing from
     * the build. It had not, and this is the assertion that keeps it that way.
     */
    expect(findRoute(MESSAGES_PATH, "post")).toBeDefined();
  });

  test("GET /microsoft-bot/messages is registered", () => {
    expect(findRoute(MESSAGES_PATH, "get")).toBeDefined();
  });

  test("the GET and POST handlers are different functions", () => {
    const getRoute: ExpressRouterLayer["route"] | undefined = findRoute(
      MESSAGES_PATH,
      "get",
    );
    const postRoute: ExpressRouterLayer["route"] | undefined = findRoute(
      MESSAGES_PATH,
      "post",
    );

    expect(getRoute?.stack[0]?.handle).not.toBe(postRoute?.stack[0]?.handle);
  });

  test("the diagnostic GET is not registered for POST", () => {
    const getRoute: ExpressRouterLayer["route"] | undefined = findRoute(
      MESSAGES_PATH,
      "get",
    );

    expect(getRoute?.methods["post"]).toBeFalsy();
  });

  test("GET /microsoft-bot/test is still registered alongside it", () => {
    expect(findRoute("/microsoft-bot/test", "get")).toBeDefined();
  });
});

/*
 * The hazard this change introduces is exactly one: a GET handler sitting on
 * the bot's own path. If it ever caught POSTs — someone "tidying" the pair into
 * a router.all, or registering the GET above the POST with a next() — every
 * Teams button tap and every chat installation event would be answered with a
 * 405 explaining that the endpoint wants POST, which is the funniest possible
 * way to break the integration and would look identical from inside Teams to
 * the outage this whole change is about.
 *
 * Inspecting route.methods cannot see that: findRoute already selects the layer
 * by method, and router.all() registers as `_all` rather than as each verb, so
 * the tidied-up version would not even be found. Only dispatching through the
 * real router settles it, so these drive router(req, res, next) directly and
 * watch which handler runs.
 */
describe("dispatching through the real router", () => {
  type DispatchResult = {
    processBotActivityCalls: number;
    statusCode: number;
    fellThrough: boolean;
  };

  type DispatchFunction = (method: string) => Promise<DispatchResult>;

  const dispatch: DispatchFunction = async (
    method: string,
  ): Promise<DispatchResult> => {
    const result: DispatchResult = {
      processBotActivityCalls: 0,
      statusCode: 0,
      fellThrough: false,
    };

    /*
     * Counted by hand rather than read off the spy: jest.spyOn's return type
     * varies across jest versions, and naming it would make this suite's
     * compilation depend on which one is installed. afterEach's
     * restoreAllMocks puts the real implementation back.
     */
    jest
      .spyOn(MicrosoftTeamsUtil, "processBotActivity")
      .mockImplementation(async (): Promise<void> => {
        result.processBotActivityCalls++;
        return undefined;
      });

    const router: ExpressRouter = new MicrosoftTeamsAPI().getRouter();

    const res: Partial<ExpressResponse> = {
      setHeader(): ExpressResponse {
        return res as ExpressResponse;
      },
      status(statusCode: number): ExpressResponse {
        result.statusCode = statusCode;
        return res as ExpressResponse;
      },
      json(): ExpressResponse {
        return res as ExpressResponse;
      },
      send(): ExpressResponse {
        return res as ExpressResponse;
      },
      end(): ExpressResponse {
        return res as ExpressResponse;
      },
    } as unknown as Partial<ExpressResponse>;

    const req: Record<string, unknown> = {
      method: method,
      url: MESSAGES_PATH,
      originalUrl: MESSAGES_PATH,
      baseUrl: "",
      query: {},
      headers: {},
      body: {
        type: "message",
        channelData: { tenant: { id: "tenant-id" } },
      },
    };

    await new Promise<void>((resolve: () => void) => {
      (router as unknown as (...args: Array<unknown>) => void)(
        req,
        res,
        (): void => {
          // next() means no route in this router matched the request.
          result.fellThrough = true;
          resolve();
        },
      );

      /*
       * Both handlers answer synchronously up to their first await, so a
       * macrotask hop is enough to let either finish before we assert.
       */
      setTimeout(resolve, 0);
    });

    jest.restoreAllMocks();

    return result;
  };

  test("a POST bot activity still reaches processBotActivity", async () => {
    const result: DispatchResult = await dispatch("POST");

    expect(result.processBotActivityCalls).toBe(1);
    expect(result.fellThrough).toBe(false);
  });

  test("a POST bot activity is never answered 405 by the diagnostic handler", async () => {
    const result: DispatchResult = await dispatch("POST");

    expect(result.statusCode).not.toBe(405);
  });

  test("a GET is answered 405 and never invokes processBotActivity", async () => {
    const result: DispatchResult = await dispatch("GET");

    expect(result.statusCode).toBe(405);
    expect(result.processBotActivityCalls).toBe(0);
    expect(result.fellThrough).toBe(false);
  });
});

describe("GET /microsoft-bot/messages", () => {
  test("responds 405, not 404", async () => {
    const response: InvokedResponse = await callMessagesGet();

    expect(response.statusCode).toBe(405);
    expect(response.statusCode).not.toBe(404);
  });

  test("sets Allow: POST", async () => {
    const response: InvokedResponse = await callMessagesGet();

    expect(response.headers["allow"]).toBe("POST");
  });

  test("advertises POST in the body as well as the header", async () => {
    const response: InvokedResponse = await callMessagesGet();
    const allow: Array<string> = response.body[
      "allow"
    ] as unknown as Array<string>;

    expect(Array.isArray(allow)).toBe(true);
    expect(allow).toEqual(["POST"]);
  });

  test("never presents itself as a not-found", async () => {
    /*
     * "Page not found" is what the old catch-all said, and saying it here
     * would put the admin straight back into believing the route is gone.
     *
     * It is banned from the fields that describe THIS response, not from the
     * whole body: ifYouGetA404InsteadOfThis quotes the catch-all's exact body
     * on purpose, because that quoted string is how an admin tells OneUptime's
     * own 404 (request arrived) from a proxy's 404 (request did not). Banning
     * the substring outright would forbid the one place it belongs.
     */
    const response: InvokedResponse = await callMessagesGet();

    const selfDescribingFields: Array<string> = [
      "status",
      "whatThisProves",
      "whatThisDoesNotProve",
      "nextStep",
    ];

    selfDescribingFields.forEach((field: string) => {
      const value: string = (response.body[field] as string).toLowerCase();
      expect(value).not.toContain("page not found");
      expect(value).not.toContain("not found -");
    });
  });

  test("quotes the catch-all's body only inside the 404 guidance", async () => {
    const response: InvokedResponse = await callMessagesGet();
    const on404: string = response.body["ifYouGetA404InsteadOfThis"] as string;

    expect(on404).toContain(
      '{"message":"Page not found - /api/microsoft-bot/messages"}',
    );
  });

  test("states the endpoint exists and takes POST only", async () => {
    const response: InvokedResponse = await callMessagesGet();
    const status: string = (response.body["status"] as string).toLowerCase();

    expect(status).toContain("exists");
    expect(status).toContain("post");
  });

  test("reports the messaging endpoint this deployment expects", async () => {
    const response: InvokedResponse = await callMessagesGet();
    const messagingEndpoint: string = response.body[
      "messagingEndpoint"
    ] as string;

    expect(typeof messagingEndpoint).toBe("string");
    expect(messagingEndpoint.endsWith("/microsoft-bot/messages")).toBe(true);
  });

  test("points at /microsoft-bot/test as the next step", async () => {
    const response: InvokedResponse = await callMessagesGet();
    const nextStep: string = response.body["nextStep"] as string;

    expect(nextStep).toContain("/microsoft-bot/test");
    expect(nextStep.toLowerCase()).toContain("bot id");
  });
});

describe("the response separates what a 405 proves from what it does not", () => {
  test("whatThisProves says the endpoint is registered and the request arrived", async () => {
    const response: InvokedResponse = await callMessagesGet();
    const proves: string = (
      response.body["whatThisProves"] as string
    ).toLowerCase();

    expect(proves).toContain("registered");
    expect(proves).toContain("not missing");
  });

  test("whatThisProves does not claim a 404 would have meant the request never arrived", async () => {
    /*
     * It said exactly that in an earlier draft, and it was false in the one
     * case that matters. OneUptime's own catch-all answers an unmatched GET
     * with 404 and the body {"message":"Page not found - <path>"} — 58 bytes
     * for this path, which is precisely the `404 58` the reporter of issue
     * #3488 pasted from their access log. Their request DID arrive. Shipping
     * "a 404 means it never arrived" inside the endpoint built to end that
     * misreading would have taught admins to distrust the one log line
     * proving their host was reachable.
     */
    const response: InvokedResponse = await callMessagesGet();
    const proves: string = (
      response.body["whatThisProves"] as string
    ).toLowerCase();

    expect(proves).not.toContain("never arrived");
    expect(proves).not.toContain("would have meant");
  });

  test("a 404 is explained by its body, not by its status code alone", async () => {
    const response: InvokedResponse = await callMessagesGet();
    const on404: string = (
      response.body["ifYouGetA404InsteadOfThis"] as string
    ).toLowerCase();

    expect(on404).toContain("body");
    expect(on404).toContain("page not found");
  });

  test("the 404 guidance says OneUptime's own JSON body means the request DID arrive", async () => {
    const response: InvokedResponse = await callMessagesGet();
    const on404: string = (
      response.body["ifYouGetA404InsteadOfThis"] as string
    ).toLowerCase();

    expect(on404).toContain("did arrive");
    expect(on404).toMatch(/post-only|post only/);
    expect(on404).toContain("/api");
  });

  test("the 404 guidance names the HTML error page as the opposite reading", async () => {
    /*
     * Both readings have to be present or the field just relocates the
     * original error: a proxy's own 404 really does mean the request never
     * reached OneUptime, and that is the case the admin must be able to tell
     * apart from theirs.
     */
    const response: InvokedResponse = await callMessagesGet();
    const on404: string = (
      response.body["ifYouGetA404InsteadOfThis"] as string
    ).toLowerCase();

    expect(on404).toContain("html");
    expect(on404).toMatch(/proxy|nginx|ingress|load balancer/);
    expect(on404).toContain("never reached oneuptime");
  });

  test("whatThisDoesNotProve names Azure Bot Service reachability", async () => {
    const response: InvokedResponse = await callMessagesGet();
    const doesNotProve: string = (
      response.body["whatThisDoesNotProve"] as string
    ).toLowerCase();

    expect(doesNotProve).toContain("azure bot service");
    expect(doesNotProve).toContain("reach");
  });

  test("the two claims are distinct fields, not one merged sentence", async () => {
    const response: InvokedResponse = await callMessagesGet();

    expect(typeof response.body["whatThisProves"]).toBe("string");
    expect(typeof response.body["whatThisDoesNotProve"]).toBe("string");
    expect(response.body["whatThisProves"]).not.toBe(
      response.body["whatThisDoesNotProve"],
    );
  });
});

describe("unable-to-reach-app guidance", () => {
  test("is a non-empty ordered list", async () => {
    const response: InvokedResponse = await callMessagesGet();
    const guidance: Array<string> = response.body[
      "ifTeamsSaysUnableToReachApp"
    ] as unknown as Array<string>;

    expect(Array.isArray(guidance)).toBe(true);
    expect(guidance.length).toBeGreaterThan(0);
  });

  test("leads with outbound alerts proving nothing about the bot endpoint", async () => {
    /*
     * This is the misreading that makes the integration look half-broken
     * rather than network-broken: alert cards post fine because OneUptime
     * calls Microsoft, and every inbound path is dead. It has to be first.
     */
    const response: InvokedResponse = await callMessagesGet();
    const guidance: Array<string> = response.body[
      "ifTeamsSaysUnableToReachApp"
    ] as unknown as Array<string>;

    const first: string = guidance[0]!.toLowerCase();

    expect(first).toContain("outbound");
    expect(first).toMatch(/prove(s)? nothing|no inbound access/);
  });

  test.each([
    ["the TLS chain requirement", ["publicly trusted certificate"]],
    ["public reachability of the host", ["private dns"]],
    [
      "grepping for the POST rather than the 404",
      ["post /api/microsoft-bot/messages"],
    ],
    ["the Azure Bot messaging endpoint setting", ["azure bot resource"]],
  ])("covers %s", async (_label: string, requiredFragments: Array<string>) => {
    const response: InvokedResponse = await callMessagesGet();
    const joined: string = joinGuidance(
      response.body["ifTeamsSaysUnableToReachApp"],
    );

    requiredFragments.forEach((fragment: string) => {
      expect(joined).toContain(fragment);
    });
  });

  test("explains why a failed TLS handshake leaves no trace in the access log", async () => {
    const response: InvokedResponse = await callMessagesGet();
    const joined: string = joinGuidance(
      response.body["ifTeamsSaysUnableToReachApp"],
    );

    expect(joined).toContain("access log");
    expect(joined).toMatch(/before oneuptime ever sees|never got through/);
  });

  test("names the three interactive paths that depend on inbound traffic", async () => {
    const response: InvokedResponse = await callMessagesGet();
    const joined: string = joinGuidance(
      response.body["ifTeamsSaysUnableToReachApp"],
    );

    expect(joined).toContain("card buttons");
    expect(joined).toContain("bot commands");
    expect(joined).toContain("chat registration");
  });
});

describe("the status code cannot be talked out of being 405", () => {
  test("?output-type=csv still returns 405 JSON", async () => {
    /*
     * Response.sendJsonObjectResponse answers this query parameter with a 200
     * and a CSV body regardless of the status code it was given. On an
     * endpoint whose entire value is its status code that would undo the fix,
     * so the handler writes the response itself.
     */
    const response: InvokedResponse = await callMessagesGet({
      "output-type": "csv",
    });

    expect(response.statusCode).toBe(405);
    expect(response.sentAsCsv).toBe(false);
    expect(response.body["status"]).toBeDefined();
  });

  test("an unrelated query parameter does not change the response", async () => {
    const withQuery: InvokedResponse = await callMessagesGet({
      foo: "bar",
    });

    expect(withQuery.statusCode).toBe(405);
    expect(withQuery.body["status"]).toBeDefined();
  });
});

describe("the diagnostic answer does not depend on Teams being configured", () => {
  test.each([
    ["client id missing", null, MOCK_TEAMS_CLIENT_SECRET],
    ["client secret missing", MOCK_TEAMS_CLIENT_ID, null],
    ["both missing", null, null],
    ["both empty strings", "", ""],
  ])(
    "still answers 405 with guidance when %s",
    async (
      _label: string,
      clientId: string | null,
      clientSecret: string | null,
    ) => {
      /*
       * An admin whose credentials are wrong still needs to be told the route
       * exists. Gating this response on configuration would put them back in
       * front of a 404-shaped answer at exactly the wrong moment.
       */
      setTeamsConfig(clientId, clientSecret);

      const response: InvokedResponse = await callMessagesGet();

      expect(response.statusCode).toBe(405);
      expect(response.headers["allow"]).toBe("POST");
      expect(response.body["status"]).toBeDefined();
      expect(
        (
          response.body[
            "ifTeamsSaysUnableToReachApp"
          ] as unknown as Array<string>
        ).length,
      ).toBeGreaterThan(0);
    },
  );
});

describe("secret handling", () => {
  test.each([
    ["fully configured", MOCK_TEAMS_CLIENT_ID, MOCK_TEAMS_CLIENT_SECRET],
    ["client id missing", null, MOCK_TEAMS_CLIENT_SECRET],
  ])(
    "never echoes the client secret (%s)",
    async (
      _label: string,
      clientId: string | null,
      clientSecret: string | null,
    ) => {
      setTeamsConfig(clientId, clientSecret);

      const response: InvokedResponse = await callMessagesGet();
      const serialized: string = JSON.stringify(response.body);

      expect(serialized).not.toContain(MOCK_TEAMS_CLIENT_SECRET);
      expect(serialized.toLowerCase()).not.toContain("clientsecret");
    },
  );

  test("does not echo the client id either — this route identifies the endpoint, not the bot", async () => {
    /*
     * /microsoft-bot/test is the place that returns botId, behind the same
     * deployment but as a deliberate answer to "which package should be
     * installed". This route is reachable by anyone who can reach the host,
     * so it stays about the endpoint.
     */
    const response: InvokedResponse = await callMessagesGet();

    expect(JSON.stringify(response.body)).not.toContain(MOCK_TEAMS_CLIENT_ID);
  });
});
