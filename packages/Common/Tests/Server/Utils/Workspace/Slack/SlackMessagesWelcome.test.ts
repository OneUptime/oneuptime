import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import SlackMessagesWelcome, {
  SlackMessagesTabOpen,
  SlackMessagesWelcomeMessage,
} from "../../../../../Server/Utils/Workspace/Slack/SlackMessagesWelcome";
import WorkspaceHome from "../../../../../Server/Utils/Workspace/WorkspaceHome";
import URL from "../../../../../Types/API/URL";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * A WELCOME IN THE APP'S MESSAGES TAB, THE FIRST TIME SOMEBODY OPENS IT.
 *
 * Slack's review of the OneUptime app for the Slack Marketplace: "Please
 * ensure that you are using the app_home_opened event to send a welcome
 * message the first time any user opens the 'Messages' tab." Opening it
 * showed an empty conversation. Now the first open of each person - a Slack
 * user of a Slack team - gets a short welcome there: what OneUptime does in
 * Slack, and how to start. Never a second one, whether they open the tab
 * again or Slack tells of one open twice; and who was welcomed is kept in
 * the cache, never read back from the conversation.
 */

jest.mock("../../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("../../../API/WorkspaceOAuthTestHelpers") as Record<
        string,
        () => unknown
      >
    )["createInMemoryGlobalCache"]!(),
  };
});

const TEAM_ID: string = "T0ACME";
const ALICE: string = "U0ALICE";
const CAROL: string = "U0CAROL";
const PROJECT_ID: ObjectID = new ObjectID(
  "f0000000-0000-4000-8000-000000000001",
);
const ALICE_ID: ObjectID = new ObjectID("f0000000-0000-4000-8000-0000000000a1");
const SLACK_PROJECT_TOKEN: string = "xoxb-project-token";
const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const CONNECT_URL: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/user-settings/slack-integration?connectAccount=true`;

// A key of this module's in the cache: its namespace, then a SHA-256 digest.
const WELCOME_KEY: RegExp = /^slack-messages-tab-welcome-[0-9a-f]{64}$/;

const HELLO: string =
  "👋 **Hi, I'm OneUptime.** I post your incidents, alerts and scheduled maintenance in Slack, page whoever is on call, and let you acknowledge, resolve and add notes without leaving Slack.";
const HOW_TO_START: string = [
  "Here's how to start:",
  "- Type `/oneuptime help` to see the commands: declare an incident, page someone or see who is on call.",
  "- Open the **Home** tab for your on-call shifts and the open incidents and alerts.",
  "- Send me a message here to ask OneUptime AI about your incidents, monitors, logs and traces.",
].join("\n");
const CONNECT_FIRST: string =
  "🔗 **Connect your Slack account** first, so OneUptime can act as you, with your permissions in the project. It takes one click.";
const NOTIFICATION: string =
  "Hi, I'm OneUptime. Type /oneuptime help to see what I can do, or send me a question here.";

let workspaceConnected: boolean = true;
let linked: Map<string, ObjectID> = new Map();
let sent: Array<{
  authToken: string;
  workspaceUserId: string;
  messageBlocks: Array<WorkspaceMessageBlock>;
  text?: string | undefined;
}> = [];
let projectReads: number = 0;

function open(
  slackUserId: string = ALICE,
  teamId: string = TEAM_ID,
): SlackMessagesTabOpen {
  return { teamId: teamId, slackUserId: slackUserId };
}

function store(): Map<string, { value: string; expiresAt: number }> {
  return (
    GlobalCache as unknown as {
      store: Map<string, { value: string; expiresAt: number }>;
    }
  ).store;
}

function markdownOf(blocks: Array<WorkspaceMessageBlock>): Array<string> {
  return blocks
    .filter((block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadMarkdown";
    })
    .map((block: WorkspaceMessageBlock): string => {
      return (block as WorkspacePayloadMarkdown).text;
    });
}

function buttonsOf(
  blocks: Array<WorkspaceMessageBlock>,
): Array<WorkspaceMessagePayloadButton> {
  return blocks
    .filter((block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadButtons";
    })
    .flatMap(
      (block: WorkspaceMessageBlock): Array<WorkspaceMessagePayloadButton> => {
        return (block as WorkspacePayloadButtons).buttons;
      },
    );
}

beforeEach(() => {
  store().clear();
  (GlobalCache.setStringIfNotExists as unknown as jest.Mock).mockClear();
  workspaceConnected = true;
  linked = new Map([[ALICE, ALICE_ID]]);
  sent = [];
  projectReads = 0;

  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD_URL));
  // The workspace's connections (WorkspaceProjectResolution reads them all).
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockImplementation((async () => {
      projectReads++;

      if (!workspaceConnected) {
        return [];
      }

      const projectAuth: WorkspaceProjectAuthToken =
        new WorkspaceProjectAuthToken();
      projectAuth.projectId = PROJECT_ID;
      projectAuth.authToken = SLACK_PROJECT_TOKEN;
      return [projectAuth];
    }) as never);
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockImplementation((async (options: {
      query: { workspaceUserId: string };
    }) => {
      const userId: ObjectID | undefined = linked.get(
        options.query.workspaceUserId,
      );

      if (!userId) {
        return null;
      }

      const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
      userAuth.userId = userId;
      return userAuth;
    }) as never);
  jest
    .spyOn(SlackUtil, "sendDirectMessageToUser")
    .mockImplementation((async (data: {
      authToken: string;
      workspaceUserId: string;
      messageBlocks: Array<WorkspaceMessageBlock>;
      text?: string | undefined;
    }) => {
      sent.push(data);
    }) as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SlackMessagesWelcome.handleMessagesTabOpened", () => {
  test("the first open welcomes the person in the app's direct messages with them, with the project's bot token", async () => {
    expect(await SlackMessagesWelcome.handleMessagesTabOpened(open())).toBe(
      true,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]!.authToken).toBe(SLACK_PROJECT_TOKEN);
    // Slack delivers a message to a person's id to the app's direct messages.
    expect(sent[0]!.workspaceUserId).toBe(ALICE);
    expect(sent[0]!.text).toBe(NOTIFICATION);
    expect(markdownOf(sent[0]!.messageBlocks)).toEqual([HELLO, HOW_TO_START]);
  });

  test("every later open says nothing: a person is welcomed once", async () => {
    await SlackMessagesWelcome.handleMessagesTabOpened(open());

    expect(await SlackMessagesWelcome.handleMessagesTabOpened(open())).toBe(
      false,
    );
    expect(await SlackMessagesWelcome.handleMessagesTabOpened(open())).toBe(
      false,
    );

    // A day, a month on: still once.
    const now: number = Date.now();
    const clock: jest.SpyInstance = jest.spyOn(Date, "now");

    clock.mockReturnValue(now + 24 * 60 * 60 * 1000);
    expect(await SlackMessagesWelcome.handleMessagesTabOpened(open())).toBe(
      false,
    );

    clock.mockReturnValue(now + 31 * 24 * 60 * 60 * 1000);
    expect(await SlackMessagesWelcome.handleMessagesTabOpened(open())).toBe(
      false,
    );

    expect(sent).toHaveLength(1);
  });

  test("an open Slack tells of twice at once - a retry - welcomes once", async () => {
    const answers: Array<boolean> = await Promise.all([
      SlackMessagesWelcome.handleMessagesTabOpened(open()),
      SlackMessagesWelcome.handleMessagesTabOpened(open()),
    ]);

    expect(answers.sort()).toEqual([false, true]);
    expect(sent).toHaveLength(1);
  });

  test("a later open asks nothing of the database: only the cache is read", async () => {
    await SlackMessagesWelcome.handleMessagesTabOpened(open());

    expect(projectReads).toBe(1);

    await SlackMessagesWelcome.handleMessagesTabOpened(open());
    await SlackMessagesWelcome.handleMessagesTabOpened(open());

    expect(projectReads).toBe(1);
  });

  test("each person, in each workspace, is welcomed once of their own", async () => {
    await SlackMessagesWelcome.handleMessagesTabOpened(open(ALICE));
    await SlackMessagesWelcome.handleMessagesTabOpened(open(CAROL));
    await SlackMessagesWelcome.handleMessagesTabOpened(open(ALICE, "T0OTHER"));

    expect(
      sent.map((message: { workspaceUserId: string }): string => {
        return message.workspaceUserId;
      }),
    ).toEqual([ALICE, CAROL, ALICE]);
  });

  test("somebody whose Slack account is not connected is asked to connect, with the Home's Connect button", async () => {
    await SlackMessagesWelcome.handleMessagesTabOpened(open(CAROL));

    expect(markdownOf(sent[0]!.messageBlocks)).toEqual([
      HELLO,
      HOW_TO_START,
      CONNECT_FIRST,
    ]);

    const buttons: Array<WorkspaceMessagePayloadButton> = buttonsOf(
      sent[0]!.messageBlocks,
    );

    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.title).toBe("Connect Slack account");
    expect(buttons[0]!.actionId).toBe(WorkspaceHome.CONNECT_ACTION_ID);
    expect(buttons[0]!.isPrimary).toBe(true);
    // Their own Slack settings, which never expire: the welcome stays.
    expect(buttons[0]!.url!.toString()).toBe(CONNECT_URL);
  });

  test("somebody connected: no Connect button", async () => {
    await SlackMessagesWelcome.handleMessagesTabOpened(open(ALICE));

    expect(buttonsOf(sent[0]!.messageBlocks)).toEqual([]);
  });

  test("a welcome Slack refuses is logged, never thrown - and the next open says it", async () => {
    const errorLines: Array<string> = [];

    jest.spyOn(logger, "error").mockImplementation(((line: unknown) => {
      errorLines.push(String(line));
    }) as never);
    (
      SlackUtil.sendDirectMessageToUser as unknown as jest.Mock
    ).mockImplementationOnce(async () => {
      throw new Error("Error from Slack channel_not_found");
    });

    await expect(
      SlackMessagesWelcome.handleMessagesTabOpened(open()),
    ).resolves.toBe(false);
    expect(errorLines).toContain(
      "Could not welcome somebody to the Slack app's Messages tab.",
    );

    // It reached nobody, so it does not count.
    expect(await SlackMessagesWelcome.handleMessagesTabOpened(open())).toBe(
      true,
    );
    expect(sent).toHaveLength(1);
    expect(await SlackMessagesWelcome.handleMessagesTabOpened(open())).toBe(
      false,
    );
  });

  test("a database that cannot be read is logged, never thrown - and the next open says it", async () => {
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    (
      WorkspaceProjectAuthTokenService.findBy as unknown as jest.Mock
    ).mockImplementationOnce(async () => {
      throw new Error('relation "WorkspaceProjectAuthToken" does not exist');
    });

    await expect(
      SlackMessagesWelcome.handleMessagesTabOpened(open()),
    ).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      "Could not welcome somebody to the Slack app's Messages tab.",
    );

    expect(await SlackMessagesWelcome.handleMessagesTabOpened(open())).toBe(
      true,
    );
  });

  test("a workspace connected to no project: nobody welcomed, nothing sent - and the first open once it is connected welcomes", async () => {
    workspaceConnected = false;

    expect(await SlackMessagesWelcome.handleMessagesTabOpened(open())).toBe(
      false,
    );
    expect(sent).toEqual([]);

    workspaceConnected = true;

    expect(await SlackMessagesWelcome.handleMessagesTabOpened(open())).toBe(
      true,
    );
    expect(sent).toHaveLength(1);
  });

  /*
   * The cache's methods are the in-memory cache's own mocks, which
   * restoreAllMocks leaves as they are: each failure is for one call.
   */
  test("a cache that cannot be read welcomes nobody, reads nothing more and throws nothing - a welcome on every open would be worse", async () => {
    (GlobalCache.setStringIfNotExists as unknown as jest.Mock)
      .mockRejectedValueOnce(new Error("Cache is not connected"))
      .mockRejectedValueOnce(new Error("Cache is not connected"));

    await expect(
      SlackMessagesWelcome.handleMessagesTabOpened(open()),
    ).resolves.toBe(false);
    await expect(
      SlackMessagesWelcome.handleMessagesTabOpened(open()),
    ).resolves.toBe(false);

    expect(sent).toEqual([]);
    expect(projectReads).toBe(0);
  });

  test("a claim the cache will not give back throws nothing", async () => {
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    (
      GlobalCache.deleteKeyIfValue as unknown as jest.Mock
    ).mockRejectedValueOnce(new Error("Cache is not connected"));
    (
      SlackUtil.sendDirectMessageToUser as unknown as jest.Mock
    ).mockImplementationOnce(async () => {
      throw new Error("Error from Slack ratelimited");
    });

    await expect(
      SlackMessagesWelcome.handleMessagesTabOpened(open()),
    ).resolves.toBe(false);
  });

  test("an open that names no workspace or no person is nobody's: nothing read, nothing kept", async () => {
    expect(
      await SlackMessagesWelcome.handleMessagesTabOpened(open(ALICE, "")),
    ).toBe(false);
    expect(await SlackMessagesWelcome.handleMessagesTabOpened(open(""))).toBe(
      false,
    );

    expect(store().size).toBe(0);
    expect(projectReads).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe("who was welcomed, as the cache keeps it", () => {
  test("for good: ten years", async () => {
    expect(SlackMessagesWelcome.WELCOMED_FOR_SECONDS).toBe(
      10 * 365 * 24 * 60 * 60,
    );

    await SlackMessagesWelcome.handleMessagesTabOpened(open());

    expect(GlobalCache.setStringIfNotExists).toHaveBeenCalledWith(
      "slack-messages-tab-welcome",
      SlackMessagesWelcome.getKey(open()),
      expect.any(String),
      { expiresInSeconds: 10 * 365 * 24 * 60 * 60 },
    );
  });

  test("the cache names nobody: its key is a digest of who", async () => {
    await SlackMessagesWelcome.handleMessagesTabOpened(open());

    const keys: Array<string> = Array.from(store().keys());

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(WELCOME_KEY);
    expect(keys[0]).not.toContain(ALICE);
    expect(keys[0]).not.toContain(TEAM_ID);
  });

  test("ids that would run together as text are told apart", () => {
    expect(
      SlackMessagesWelcome.getKey({ teamId: "T0A", slackUserId: "CME" }),
    ).not.toBe(
      SlackMessagesWelcome.getKey({ teamId: "T0", slackUserId: "ACME" }),
    );
  });
});

describe("SlackMessagesWelcome.getWelcome", () => {
  test("somebody connected: what OneUptime does in Slack, and how to start", () => {
    const welcome: SlackMessagesWelcomeMessage =
      SlackMessagesWelcome.getWelcome({
        isConnected: true,
        connectUrl: CONNECT_URL,
      });

    expect(markdownOf(welcome.blocks)).toEqual([HELLO, HOW_TO_START]);
    expect(buttonsOf(welcome.blocks)).toEqual([]);
    expect(welcome.text).toBe(NOTIFICATION);
  });

  test("somebody not connected, with no dashboard address for the button: told where to connect in OneUptime", () => {
    const welcome: SlackMessagesWelcomeMessage =
      SlackMessagesWelcome.getWelcome({ isConnected: false, connectUrl: null });

    expect(markdownOf(welcome.blocks)).toEqual([
      HELLO,
      HOW_TO_START,
      CONNECT_FIRST,
      "In OneUptime, go to **User Settings → Workspace → Slack** and press **Connect my account with Slack**.",
    ]);
    expect(buttonsOf(welcome.blocks)).toEqual([]);
  });

  test("names the product as the server is branded", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    const welcome: SlackMessagesWelcomeMessage =
      SlackMessagesWelcome.getWelcome({
        isConnected: false,
        connectUrl: CONNECT_URL,
      });
    const markdown: Array<string> = markdownOf(welcome.blocks);

    expect(markdown[0]).toContain("**Hi, I'm Acme Status.**");
    expect(markdown[1]).toContain("to ask Acme Status AI about");
    expect(markdown[2]).toContain("so Acme Status can act as you");
    expect(welcome.text).toBe(
      "Hi, I'm Acme Status. Type /oneuptime help to see what I can do, or send me a question here.",
    );
    expect(JSON.stringify(welcome)).not.toContain("OneUptime");
  });
});
