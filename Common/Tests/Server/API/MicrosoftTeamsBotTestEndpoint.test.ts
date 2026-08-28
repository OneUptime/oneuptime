import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../../../Server/Utils/Express";
import { JSONObject } from "../../../Types/JSON";
import MicrosoftTeamsAPI from "../../../Server/API/MicrosoftTeamsAPI";

const MOCK_TEAMS_CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";
const MOCK_TEAMS_CLIENT_SECRET: string =
  "mock-teams-client-secret-that-must-never-be-echoed";

/*
 * The route reads the client id / secret from EnvironmentConfig at request
 * time (TypeScript compiles the named imports down to property reads on the
 * module object), so backing them with lazy getters lets a single loaded copy
 * of the API module serve both the happy path and the two "not configured"
 * branches. The mutable holder lives inside the mock factory because the
 * factory is hoisted above every module-scope declaration in this file.
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

type SetTeamsConfigFunction = (
  clientId: string | null,
  clientSecret: string | null,
) => void;

type SetMockTeamsConfigFunction = (
  clientId: string | null,
  clientSecret: string | null,
) => void;

const setTeamsConfig: SetTeamsConfigFunction = (
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

type GetBotTestHandlerFunction = () => ExpressRouteHandler;

/*
 * Reaches into the router built by the API class itself, so this test covers
 * the real route wiring (path + method) and not just a hand-copied handler.
 */
const getBotTestHandler: GetBotTestHandlerFunction =
  (): ExpressRouteHandler => {
    const router: ExpressRouter = new MicrosoftTeamsAPI().getRouter();
    const layers: Array<ExpressRouterLayer> = (
      router as unknown as { stack: Array<ExpressRouterLayer> }
    ).stack;

    const layer: ExpressRouterLayer | undefined = layers.find(
      (candidate: ExpressRouterLayer) => {
        return (
          candidate.route?.path === "/microsoft-bot/test" &&
          candidate.route?.methods["get"] === true
        );
      },
    );

    if (!layer || !layer.route) {
      throw new Error(
        "GET /microsoft-bot/test is not registered on the MicrosoftTeamsAPI router",
      );
    }

    const handlers: Array<{ handle: ExpressRouteHandler }> = layer.route.stack;
    expect(handlers).toHaveLength(1);

    return handlers[0]!.handle;
  };

type InvokedResponse = {
  statusCode: number;
  body: JSONObject;
};

type CallBotTestFunction = () => Promise<InvokedResponse>;

const callBotTest: CallBotTestFunction = async (): Promise<InvokedResponse> => {
  const handler: ExpressRouteHandler = getBotTestHandler();

  const invoked: InvokedResponse = {
    statusCode: 0,
    body: {},
  };

  const res: Partial<ExpressResponse> = {
    status(statusCode: number): ExpressResponse {
      invoked.statusCode = statusCode;
      return res as ExpressResponse;
    },
    send(body: JSONObject): ExpressResponse {
      invoked.body = body;
      return res as ExpressResponse;
    },
  } as unknown as Partial<ExpressResponse>;

  const req: Partial<ExpressRequest> = {
    query: {},
  };

  await handler(req as ExpressRequest, res as ExpressResponse);

  return invoked;
};

type JoinStringsFunction = (values: unknown) => string;

const joinStrings: JoinStringsFunction = (values: unknown): string => {
  return (values as Array<string>).join(" | ").toLowerCase();
};

describe("GET /microsoft-bot/test", () => {
  beforeEach(() => {
    setTeamsConfig(MOCK_TEAMS_CLIENT_ID, MOCK_TEAMS_CLIENT_SECRET);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("when the client id and secret are configured", () => {
    test("responds 200", async () => {
      const response: InvokedResponse = await callBotTest();
      expect(response.statusCode).toBe(200);
    });

    test("reports clientId and botId, both equal to the configured client id", async () => {
      const response: InvokedResponse = await callBotTest();
      expect(response.body["clientId"]).toBe(MOCK_TEAMS_CLIENT_ID);
      expect(response.body["botId"]).toBe(MOCK_TEAMS_CLIENT_ID);
    });

    test("does NOT claim the Bot Framework endpoint is configured", async () => {
      const response: InvokedResponse = await callBotTest();
      const status: string = response.body["status"] as string;
      expect(status).not.toBe("Bot Framework endpoint is configured");
      expect(status.toLowerCase()).not.toContain(
        "bot framework endpoint is configured",
      );
    });

    test("status says the check does not confirm the integration works", async () => {
      const response: InvokedResponse = await callBotTest();
      const status: string = (response.body["status"] as string).toLowerCase();
      expect(status).toContain("does not confirm");
      expect(status).toContain("integration works");
    });

    test("messagingEndpoint ends with /microsoft-bot/messages", async () => {
      const response: InvokedResponse = await callBotTest();
      const messagingEndpoint: string = response.body[
        "messagingEndpoint"
      ] as string;
      expect(typeof messagingEndpoint).toBe("string");
      expect(messagingEndpoint.endsWith("/microsoft-bot/messages")).toBe(true);
    });

    test("verified is a non-empty array naming both Teams environment variables", async () => {
      const response: InvokedResponse = await callBotTest();
      const verified: Array<string> = response.body[
        "verified"
      ] as unknown as Array<string>;
      expect(Array.isArray(verified)).toBe(true);
      expect(verified.length).toBeGreaterThan(0);

      const joined: string = joinStrings(verified);
      expect(joined).toContain("microsoft_teams_app_client_id");
      expect(joined).toContain("microsoft_teams_app_client_secret");
    });

    test("notVerified is a non-empty array", async () => {
      const response: InvokedResponse = await callBotTest();
      const notVerified: Array<string> = response.body[
        "notVerified"
      ] as unknown as Array<string>;
      expect(Array.isArray(notVerified)).toBe(true);
      expect(notVerified.length).toBeGreaterThan(0);
    });

    test.each([
      ["the Azure Bot resource existing", ["azure bot", "exists"]],
      ["the Teams channel being enabled", ["teams channel", "enabled"]],
      [
        "the installed Teams app package belonging to this deployment",
        ["installed", "this deployment"],
      ],
    ])(
      "notVerified explicitly disclaims %s",
      async (_label: string, requiredFragments: Array<string>) => {
        const response: InvokedResponse = await callBotTest();
        const notVerified: Array<string> = response.body[
          "notVerified"
        ] as unknown as Array<string>;

        const match: string | undefined = notVerified.find((entry: string) => {
          const lowered: string = entry.toLowerCase();
          return requiredFragments.every((fragment: string) => {
            return lowered.includes(fragment);
          });
        });

        expect(match).toBeDefined();
      },
    );

    test("nextStep names the client id and tells the admin to compare it against the installed app's bot id", async () => {
      const response: InvokedResponse = await callBotTest();
      const nextStep: string = response.body["nextStep"] as string;
      expect(typeof nextStep).toBe("string");
      expect(nextStep).toContain(MOCK_TEAMS_CLIENT_ID);

      const lowered: string = nextStep.toLowerCase();
      expect(lowered).toContain("bot id");
      expect(lowered).toContain("microsoft teams");
    });
  });

  describe("when the configuration is missing", () => {
    test("client id unset responds with an error and leaks no status or botId", async () => {
      setTeamsConfig(null, MOCK_TEAMS_CLIENT_SECRET);

      const response: InvokedResponse = await callBotTest();

      expect(typeof response.body["error"]).toBe("string");
      expect(response.body["error"]).toBe(
        "Microsoft Teams App Client ID not configured",
      );
      expect(response.body["status"]).toBeUndefined();
      expect(response.body["botId"]).toBeUndefined();
      expect(response.body["clientId"]).toBeUndefined();
      expect(response.body["messagingEndpoint"]).toBeUndefined();
      expect(response.body["nextStep"]).toBeUndefined();
    });

    test("client secret unset responds with an error", async () => {
      setTeamsConfig(MOCK_TEAMS_CLIENT_ID, null);

      const response: InvokedResponse = await callBotTest();

      expect(typeof response.body["error"]).toBe("string");
      expect(response.body["error"]).toBe(
        "Microsoft Teams App Client Secret not configured",
      );
      expect(response.body["status"]).toBeUndefined();
      expect(response.body["botId"]).toBeUndefined();
    });

    test("an empty-string client id is treated as unset", async () => {
      setTeamsConfig("", MOCK_TEAMS_CLIENT_SECRET);

      const response: InvokedResponse = await callBotTest();

      expect(response.body["error"]).toBe(
        "Microsoft Teams App Client ID not configured",
      );
    });
  });

  describe("secret handling", () => {
    test.each([
      ["fully configured", MOCK_TEAMS_CLIENT_ID, MOCK_TEAMS_CLIENT_SECRET],
      ["client id missing", null, MOCK_TEAMS_CLIENT_SECRET],
      ["client secret missing", MOCK_TEAMS_CLIENT_ID, null],
    ])(
      "never echoes the client secret (%s)",
      async (
        _label: string,
        clientId: string | null,
        clientSecret: string | null,
      ) => {
        setTeamsConfig(clientId, clientSecret);

        const response: InvokedResponse = await callBotTest();
        const serialized: string = JSON.stringify(response.body);

        expect(serialized).not.toContain(MOCK_TEAMS_CLIENT_SECRET);
        expect(serialized.toLowerCase()).not.toContain("clientsecret");
      },
    );
  });
});
