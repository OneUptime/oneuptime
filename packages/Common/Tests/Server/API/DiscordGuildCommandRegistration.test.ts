import DiscordAPI from "../../../Server/API/DiscordAPI";
import DiscordBindingService from "../../../Server/Services/DiscordBindingService";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../../../Server/Utils/Express";
import DiscordClient from "../../../Server/Utils/Workspace/Discord/DiscordClient";
import DiscordOAuth from "../../../Server/Utils/Workspace/Discord/DiscordOAuth";
import WorkspaceOAuthState, {
  WorkspaceOAuthFlow,
  WorkspaceOAuthStateRecord,
} from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

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
    const commandPayloads: jest.Mock = jest.fn();
    const Dispatcher: jest.Mock = jest.fn().mockImplementation(() => {
      return { commandPayloads };
    });
    return {
      __esModule: true,
      default: Dispatcher,
      mockCommandPayloads: commandPayloads,
    };
  },
);

const APPLICATION_ID: string = "111111111111111111";
const GUILD_ID: string = "333333333333333333";
const BOT_USER_ID: string = "444444444444444444";
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const PROJECT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const COMMANDS: JSONArray = [
  {
    type: 1,
    name: "incident-note",
    description: "Add a note to an incident",
  },
];

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

function getCallbackHandler(path: string): RouteHandler {
  const router: ExpressRouter = new DiscordAPI().getRouter();
  const layer: RouterLayer | undefined = (
    router as unknown as { stack: Array<RouterLayer> }
  ).stack.find((candidate: RouterLayer): boolean => {
    return (
      candidate.route?.path === path && candidate.route.methods["get"] === true
    );
  });
  if (!layer?.route) {
    throw new Error(`GET ${path} is not registered`);
  }
  expect(layer.route.stack).toHaveLength(1);
  return layer.route.stack[0]!.handle;
}

function state(flow: WorkspaceOAuthFlow): WorkspaceOAuthStateRecord {
  return {
    flow,
    projectId: PROJECT_ID,
    userId: USER_ID,
    workspaceProjectId: GUILD_ID,
    bindingSnapshot: "a".repeat(64),
  };
}

async function invoke(path: string): Promise<jest.Mock> {
  const req: Partial<ExpressRequest> = {
    query: { state: "opaque-state", code: "oauth-code", guild_id: GUILD_ID },
  };
  const redirect: jest.Mock = jest.fn();
  const res: Partial<ExpressResponse> = { redirect };
  await getCallbackHandler(path)(req as ExpressRequest, res as ExpressResponse);
  return redirect;
}

describe("Discord guild command registration", () => {
  beforeEach((): void => {
    jest.clearAllMocks();
    (
      jest.requireMock(
        "../../../Server/Utils/Workspace/Discord/DiscordInteractionDispatcher",
      ) as { mockCommandPayloads: jest.Mock }
    ).mockCommandPayloads.mockReturnValue(COMMANDS);
    jest.spyOn(DiscordAPI, "authorizeActor").mockResolvedValue();
    jest
      .spyOn(WorkspaceOAuthState, "consume")
      .mockResolvedValue(state(WorkspaceOAuthFlow.DiscordInstall));
    jest.spyOn(DiscordOAuth, "exchange").mockResolvedValue({
      access_token: "oauth-access-token",
      guild: { id: GUILD_ID },
    });
    jest
      .spyOn(DiscordOAuth, "identify")
      .mockResolvedValue({ id: "777777777777777777" });
    jest.spyOn(DiscordOAuth, "assertInstaller").mockResolvedValue();
    jest.spyOn(DiscordOAuth, "assertUserMembership").mockResolvedValue();
    jest.spyOn(DiscordOAuth, "guildContext").mockResolvedValue({
      guild: { id: GUILD_ID, name: "Test guild" },
      bot: { id: BOT_USER_ID },
    } as never);
    jest.spyOn(DiscordBindingService, "install").mockResolvedValue();
    jest.spyOn(DiscordBindingService, "link").mockResolvedValue();
    jest.spyOn(DiscordClient, "upsertGuildCommands").mockResolvedValue();
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("upserts dispatcher-owned commands before persisting an install", async (): Promise<void> => {
    const redirect: jest.Mock = await invoke("/discord/oauth/install");
    expect(DiscordClient.upsertGuildCommands).toHaveBeenCalledWith({
      authToken: "test-bot-token",
      applicationId: APPLICATION_ID,
      guildId: GUILD_ID,
      commands: COMMANDS,
    });
    expect(
      (DiscordClient.upsertGuildCommands as jest.Mock).mock
        .invocationCallOrder[0] as number,
    ).toBeLessThan(
      (DiscordBindingService.install as jest.Mock).mock
        .invocationCallOrder[0] as number,
    );
    expect(redirect).toHaveBeenCalledWith(
      expect.stringContaining("?success=true"),
    );
  });

  test("does not persist a binding when command registration fails", async (): Promise<void> => {
    (DiscordClient.upsertGuildCommands as jest.Mock).mockRejectedValueOnce(
      new Error("Discord rejected command registration"),
    );
    const redirect: jest.Mock = await invoke("/discord/oauth/install");
    expect(DiscordBindingService.install).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining("?error="));
  });

  test("does not register guild commands while linking a user", async (): Promise<void> => {
    (WorkspaceOAuthState.consume as jest.Mock).mockResolvedValueOnce(
      state(WorkspaceOAuthFlow.DiscordUserSignIn),
    );
    await invoke("/discord/oauth/user");
    expect(DiscordClient.upsertGuildCommands).not.toHaveBeenCalled();
    expect(DiscordBindingService.link).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({ id: "777777777777777777" }),
      }),
    );
  });
});
