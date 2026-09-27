import DiscordAPI from "../../../Server/API/DiscordAPI";
import PublicDashboardRateLimit, {
  PublicDashboardRateLimitOutcome,
} from "../../../Server/Middleware/PublicDashboardRateLimit";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import { DiscordPreparedInteraction } from "../../../Server/Utils/Workspace/Discord/DiscordInteractionDispatcher";
import DiscordInteractionSignature from "../../../Server/Utils/Workspace/Discord/DiscordInteractionSignature";
import { DiscordInteractionKind } from "../../../Server/Utils/Workspace/Discord/Actions/Types";
import { JSONObject } from "../../../Types/JSON";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    DiscordAppClientId: "111111111111111111",
    DiscordAppClientSecret: "test-client-secret",
    DiscordAppPublicKey: "a".repeat(64),
    DiscordBotToken: "test-bot-token",
  };
});

jest.mock(
  "../../../Server/Utils/Workspace/Discord/DiscordInteractionDispatcher",
  () => {
    const prepare: jest.Mock = jest.fn();
    const commandPayloads: jest.Mock = jest.fn().mockReturnValue([]);
    const Dispatcher: jest.Mock = jest.fn().mockImplementation(() => {
      return { prepare, commandPayloads };
    });
    return {
      __esModule: true,
      default: Dispatcher,
      mockPrepare: prepare,
      mockCommandPayloads: commandPayloads,
    };
  },
);

jest.mock("../../../Server/Utils/Workspace/Discord/Actions/Incident", () => {
  return { DiscordIncidentActionModule: { handlers: [], family: "incident" } };
});
jest.mock("../../../Server/Utils/Workspace/Discord/Actions/Alert", () => {
  return { DiscordAlertActionModule: { handlers: [], family: "alert" } };
});
jest.mock(
  "../../../Server/Utils/Workspace/Discord/Actions/IncidentEpisode",
  () => {
    return {
      DiscordIncidentEpisodeActionModule: {
        handlers: [],
        family: "incident-episode",
      },
    };
  },
);
jest.mock(
  "../../../Server/Utils/Workspace/Discord/Actions/AlertEpisode",
  () => {
    return {
      DiscordAlertEpisodeActionModule: {
        handlers: [],
        family: "alert-episode",
      },
    };
  },
);
jest.mock(
  "../../../Server/Utils/Workspace/Discord/Actions/ScheduledMaintenance",
  () => {
    return {
      DiscordScheduledMaintenanceActionModule: {
        handlers: [],
        family: "scheduled-maintenance",
      },
    };
  },
);
jest.mock("../../../Server/Utils/Workspace/Discord/Actions/Monitor", () => {
  return { DiscordMonitorActionModule: { handlers: [], family: "monitor" } };
});

const APPLICATION_ID: string = "111111111111111111";
const INTERACTION_ID: string = "222222222222222222";
const GUILD_ID: string = "333333333333333333";
const DISCORD_USER_ID: string = "444444444444444444";

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void> | void;

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RouteHandler }>;
  };
};

type DispatcherMock = {
  default: jest.Mock;
  mockPrepare: jest.Mock;
  mockCommandPayloads: jest.Mock;
};

function dispatcherMock(): DispatcherMock {
  return jest.requireMock(
    "../../../Server/Utils/Workspace/Discord/DiscordInteractionDispatcher",
  ) as DispatcherMock;
}

function getInteractionHandler(): RouteHandler {
  const router: ExpressRouter = new DiscordAPI().getRouter();
  const layer: RouterLayer | undefined = (
    router as unknown as { stack: Array<RouterLayer> }
  ).stack.find((candidate: RouterLayer): boolean => {
    return (
      candidate.route?.path === "/discord/interactions" &&
      candidate.route.methods["post"] === true
    );
  });
  if (!layer?.route) {
    throw new Error("POST /discord/interactions is not registered");
  }
  expect(layer.route.stack).toHaveLength(1);
  return layer.route.stack[0]!.handle;
}

function interaction(type: number): JSONObject {
  return {
    id: INTERACTION_ID,
    application_id: APPLICATION_ID,
    token: "signed-token",
    type,
    guild_id: GUILD_ID,
    member: { user: { id: DISCORD_USER_ID } },
    data: {},
  };
}

async function invoke(type: number): Promise<{
  body: JSONObject;
  statusCode: number;
  json: jest.Mock;
}> {
  const payload: JSONObject = interaction(type);
  const req: Partial<OneUptimeRequest> = {
    rawBody: JSON.stringify(payload),
    headers: {
      "x-signature-ed25519": "signature",
      "x-signature-timestamp": "1234567890",
    },
    path: "/discord/interactions",
  };
  const result: { body: JSONObject; statusCode: number } = {
    body: {},
    statusCode: 200,
  };
  const res: Partial<ExpressResponse> = {};
  res.status = jest.fn((statusCode: number): ExpressResponse => {
    result.statusCode = statusCode;
    return res as ExpressResponse;
  });
  const json: jest.Mock = jest.fn((body: JSONObject): ExpressResponse => {
    result.body = body;
    return res as ExpressResponse;
  });
  res.json = json;
  await getInteractionHandler()(
    req as OneUptimeRequest,
    res as ExpressResponse,
  );
  return { ...result, json };
}

describe("Discord signed interaction route", () => {
  beforeEach((): void => {
    jest.clearAllMocks();
    jest.spyOn(DiscordInteractionSignature, "verify").mockReturnValue(true);
    jest.spyOn(PublicDashboardRateLimit, "consume").mockResolvedValue({
      outcome: PublicDashboardRateLimitOutcome.Allowed,
    });
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("preserves signed PING without invoking the dispatcher", async (): Promise<void> => {
    const response: { body: JSONObject; statusCode: number } = await invoke(1);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ type: 1 });
    expect(dispatcherMock().mockPrepare).not.toHaveBeenCalled();
  });

  test.each([
    DiscordInteractionKind.ApplicationCommand,
    DiscordInteractionKind.MessageComponent,
    DiscordInteractionKind.ApplicationCommandAutocomplete,
    DiscordInteractionKind.ModalSubmit,
  ])(
    "routes signed interaction type %s through the dispatcher",
    async (type: DiscordInteractionKind): Promise<void> => {
      const prepared: DiscordPreparedInteraction = {
        initialResponse: { type: 4, data: { content: `type-${type}` } },
      };
      dispatcherMock().mockPrepare.mockResolvedValueOnce(prepared);
      const response: { body: JSONObject; statusCode: number } =
        await invoke(type);
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual(prepared.initialResponse);
      expect(dispatcherMock().mockPrepare).toHaveBeenCalledWith(
        interaction(type),
      );
    },
  );

  test("sends the initial response before starting unawaited deferred work", async (): Promise<void> => {
    let release: (() => void) | undefined;
    const blocked: Promise<void> = new Promise((resolve: () => void): void => {
      release = resolve;
    });
    const runAfterResponse: jest.Mock = jest.fn(async (): Promise<void> => {
      await blocked;
    });
    dispatcherMock().mockPrepare.mockResolvedValueOnce({
      initialResponse: { type: 5, data: { flags: 64 } },
      runAfterResponse,
    });

    const response: { json: jest.Mock } = await invoke(
      DiscordInteractionKind.MessageComponent,
    );
    expect(response.json).toHaveBeenCalledTimes(1);
    expect(runAfterResponse).toHaveBeenCalledTimes(1);
    expect(response.json.mock.invocationCallOrder[0] as number).toBeLessThan(
      runAfterResponse.mock.invocationCallOrder[0] as number,
    );
    release!();
    await blocked;
  });

  test("does not start background work when the dispatcher has no continuation", async (): Promise<void> => {
    dispatcherMock().mockPrepare.mockResolvedValueOnce({
      initialResponse: { type: 4, data: { content: "done" } },
    });
    await invoke(DiscordInteractionKind.ModalSubmit);
    expect(dispatcherMock().mockPrepare).toHaveBeenCalledTimes(1);
  });

  test("rejects unsupported interaction types before the dispatcher", async (): Promise<void> => {
    const response: { body: JSONObject; statusCode: number } =
      await invoke(999);
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "Discord interaction is not supported.",
    });
    expect(dispatcherMock().mockPrepare).not.toHaveBeenCalled();
  });

  test("constructs one lazy dispatcher with the responder and operations modules", async (): Promise<void> => {
    dispatcherMock().mockPrepare.mockResolvedValueOnce({
      initialResponse: { type: 4, data: { content: "done" } },
    });
    await invoke(DiscordInteractionKind.ApplicationCommand);
    expect(dispatcherMock().default).toHaveBeenCalledTimes(1);
    const modules: unknown = dispatcherMock().default.mock.calls[0]![0].modules;
    expect(modules).toEqual([
      (
        jest.requireMock(
          "../../../Server/Utils/Workspace/Discord/Actions/Incident",
        ) as { DiscordIncidentActionModule: unknown }
      ).DiscordIncidentActionModule,
      (
        jest.requireMock(
          "../../../Server/Utils/Workspace/Discord/Actions/Alert",
        ) as { DiscordAlertActionModule: unknown }
      ).DiscordAlertActionModule,
      (
        jest.requireMock(
          "../../../Server/Utils/Workspace/Discord/Actions/IncidentEpisode",
        ) as { DiscordIncidentEpisodeActionModule: unknown }
      ).DiscordIncidentEpisodeActionModule,
      (
        jest.requireMock(
          "../../../Server/Utils/Workspace/Discord/Actions/AlertEpisode",
        ) as { DiscordAlertEpisodeActionModule: unknown }
      ).DiscordAlertEpisodeActionModule,
      (
        jest.requireMock(
          "../../../Server/Utils/Workspace/Discord/Actions/ScheduledMaintenance",
        ) as { DiscordScheduledMaintenanceActionModule: unknown }
      ).DiscordScheduledMaintenanceActionModule,
      (
        jest.requireMock(
          "../../../Server/Utils/Workspace/Discord/Actions/Monitor",
        ) as { DiscordMonitorActionModule: unknown }
      ).DiscordMonitorActionModule,
    ]);
  });

  test("constructing the router remains safe when Discord is disabled", (): void => {
    expect((): ExpressRouter => {
      return new DiscordAPI().getRouter();
    }).not.toThrow();
    expect(dispatcherMock().default).not.toHaveBeenCalled();
  });
});
