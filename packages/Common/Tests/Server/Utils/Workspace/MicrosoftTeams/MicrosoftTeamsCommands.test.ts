import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import URL from "../../../../../Types/API/URL";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import MicrosoftTeamsHome from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsHome";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

import type { TurnContext } from "botbuilder";
import MicrosoftTeamsCommands, {
  MICROSOFT_TEAMS_LIST_COMMANDS_IN_HELP,
  MicrosoftTeamsListCommand,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCommands";
import MicrosoftTeamsAuthAction from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import OnCallDutyPolicyScheduleService from "../../../../../Server/Services/OnCallDutyPolicyScheduleService";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import logger from "../../../../../Server/Utils/Logger";
import WorkspaceCommands, {
  WorkspaceCommandName,
} from "../../../../../Server/Utils/Workspace/WorkspaceCommands";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * The words typed to the Microsoft Teams bot: Slack's words after /oneuptime
 * (WorkspaceCommands) and Teams' own four lists. These pin how Teams' lists
 * are told from a question, what the bot says when it cannot tell who sent
 * "oncall" or cannot check them, and the welcome card's commands.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "f0000000-0000-4000-8000-000000000001",
);

afterEach(() => {
  jest.restoreAllMocks();
});

interface FakeTurn {
  turnContext: TurnContext;
  replies: Array<unknown>;
}

function fakeTurn(activity: JSONObject): FakeTurn {
  const replies: Array<unknown> = [];

  return {
    turnContext: {
      activity: activity,
      sendActivity: async (reply: unknown): Promise<{ id: string }> => {
        replies.push(reply);
        return { id: `reply-${replies.length}` };
      },
    } as unknown as TurnContext,
    replies: replies,
  };
}

function oncallActivity(from: JSONObject): JSONObject {
  return {
    type: "message",
    id: "1760000000001",
    text: "oncall",
    from: from,
    conversation: { conversationType: "personal", id: "a:1chat" },
    channelData: { tenant: { id: "t-1" } },
    serviceUrl: "https://smba.trafficmanager.net/amer/",
  };
}

describe("MicrosoftTeamsCommands.getListCommand: Teams' own lists, matched exactly", () => {
  test.each([
    ["show active incidents", MicrosoftTeamsListCommand.ActiveIncidents],
    ["active incidents", MicrosoftTeamsListCommand.ActiveIncidents],
    ["show active alerts", MicrosoftTeamsListCommand.ActiveAlerts],
    ["active alerts", MicrosoftTeamsListCommand.ActiveAlerts],
    [
      "show scheduled maintenance",
      MicrosoftTeamsListCommand.ScheduledMaintenance,
    ],
    ["scheduled maintenance", MicrosoftTeamsListCommand.ScheduledMaintenance],
    ["show ongoing maintenance", MicrosoftTeamsListCommand.OngoingMaintenance],
    ["ongoing maintenance", MicrosoftTeamsListCommand.OngoingMaintenance],
    ["  Show Active Incidents  ", MicrosoftTeamsListCommand.ActiveIncidents],
  ])("%j is %s", (text: string, command: MicrosoftTeamsListCommand) => {
    expect(MicrosoftTeamsCommands.getListCommand(text)).toBe(command);
  });

  test.each([
    "show active incidents in eu-west-1",
    "show me active incidents",
    "incidents",
    "maintenance",
    "help",
    "",
  ])(
    "%j is no list: it is read as Slack reads the words, or a question",
    (text: string) => {
      expect(MicrosoftTeamsCommands.getListCommand(text)).toBeNull();
    },
  );

  test("the lists' first words are no command Slack's /oneuptime takes", () => {
    for (const command of Object.values(MicrosoftTeamsListCommand)) {
      expect(WorkspaceCommands.parse(command).command).toBeNull();
    }
  });

  test("the help names every list, two a line", () => {
    expect(
      MICROSOFT_TEAMS_LIST_COMMANDS_IN_HELP.flatMap(
        (extra: { usages: Array<string> }): Array<string> => {
          return extra.usages;
        },
      ).sort(),
    ).toEqual(Object.values(MicrosoftTeamsListCommand).sort());
  });
});

describe("MicrosoftTeamsCommands.getManifestCommands: what Teams suggests after @OneUptime", () => {
  test("the words Slack's /oneuptime takes, then Teams' own lists, then help - each a sentence", () => {
    const commands: Array<JSONObject> =
      MicrosoftTeamsCommands.getManifestCommands();

    expect(
      commands.map((command: JSONObject): unknown => {
        return command["title"];
      }),
    ).toEqual([
      WorkspaceCommandName.Incident,
      WorkspaceCommandName.Maintenance,
      WorkspaceCommandName.OnCall,
      WorkspaceCommandName.Page,
      WorkspaceCommandName.Ask,
      MicrosoftTeamsListCommand.ActiveIncidents,
      MicrosoftTeamsListCommand.ActiveAlerts,
      MicrosoftTeamsListCommand.ScheduledMaintenance,
      MicrosoftTeamsListCommand.OngoingMaintenance,
      WorkspaceCommandName.Help,
    ]);

    for (const command of commands) {
      const description: string = command["description"] as string;
      expect(description.charAt(0)).toBe(description.charAt(0).toUpperCase());
      expect(description.endsWith(".")).toBe(true);
    }
  });

  test("a command that opens a form says a title may follow it; page says who and what follow it; the others say what they do", () => {
    const descriptions: Record<string, string> = {};

    for (const command of MicrosoftTeamsCommands.getManifestCommands()) {
      descriptions[command["title"] as string] = command[
        "description"
      ] as string;
    }

    expect(descriptions["incident"]).toBe(
      "Declare an incident. Type a title after it.",
    );
    expect(descriptions["maintenance"]).toBe(
      "Schedule maintenance. Type a title after it.",
    );
    expect(descriptions["oncall"]).toBe("See who is on call right now.");
    expect(descriptions["page"]).toBe(
      "Page a person, a team or whoever is on call. Mention who, then type a message.",
    );
    expect(descriptions["help"]).toBe("List every command.");
  });
});

describe("MicrosoftTeamsCommands.getBotName: the name to @mention the bot by", () => {
  function turnTo(recipient: unknown): TurnContext {
    return {
      activity: { type: "message", recipient: recipient },
    } as unknown as TurnContext;
  }

  test("the name the message was sent to, as Teams shows the bot", () => {
    expect(
      MicrosoftTeamsCommands.getBotName(
        turnTo({ id: "28:bot", name: "OneUptime" }),
      ),
    ).toBe("OneUptime");
  });

  test("without the characters a card's Markdown would read", () => {
    expect(
      MicrosoftTeamsCommands.getBotName(
        turnTo({ id: "28:bot", name: "  One*Uptime_  [bot] " }),
      ),
    ).toBe("OneUptime bot");
  });

  test.each([undefined, null, {}, { id: "28:bot" }, { name: 42 }])(
    "a message that names no bot (%j): empty, and the help names the product",
    (recipient: unknown) => {
      const turnContext: TurnContext = turnTo(recipient);

      expect(MicrosoftTeamsCommands.getBotName(turnContext)).toBe("");
      expect(
        MicrosoftTeamsCommands.getHelpAnswer(
          MicrosoftTeamsCommands.getBotName(turnContext),
        ).markdown.split("\n")[0],
      ).toBe(
        "👋 **Here's what I can do.** In a channel or a group chat, mention @OneUptime first.",
      );
    },
  );
});

describe("MicrosoftTeamsCommands.authorizeSender, for 'oncall'", () => {
  test("a message that names nobody: said so, logged as a warning, nothing read", async () => {
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined;
      });
    const lookup: SpyInstance<
      typeof MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId
    > = jest.spyOn(
      MicrosoftTeamsAuthAction,
      "getOneUptimeUserIdFromTeamsUserId",
    );
    const turn: FakeTurn = fakeTurn(
      oncallActivity({ id: "29:1someone", name: "Someone" }),
    );

    await MicrosoftTeamsCommands.handleOnCallCommand({
      turnContext: turn.turnContext,
      activity: turn.turnContext.activity as unknown as JSONObject,
      projectId: PROJECT_ID,
    });

    expect(turn.replies).toEqual([
      "Sorry, I couldn't tell who sent this message, so I can't show who is on call. Please try again.",
    ]);
    expect(warn).toHaveBeenCalledWith(
      "A Microsoft Teams oncall command arrived without the sender's AAD object id",
      { projectId: PROJECT_ID.toString() },
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  test("the account cannot be checked just now: said so, and logged by the command it is", async () => {
    const errorLog: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockRejectedValue(new Error("Connection terminated unexpectedly"));
    const read: SpyInstance<typeof OnCallDutyPolicyScheduleService.findBy> =
      jest.spyOn(OnCallDutyPolicyScheduleService, "findBy");
    const turn: FakeTurn = fakeTurn(
      oncallActivity({
        id: "29:1someone",
        name: "Someone",
        aadObjectId: "a0000000-0000-4000-8000-000000000001",
      }),
    );

    await MicrosoftTeamsCommands.handleOnCallCommand({
      turnContext: turn.turnContext,
      activity: turn.turnContext.activity as unknown as JSONObject,
      projectId: PROJECT_ID,
    });

    expect(turn.replies).toEqual([
      "Sorry, I couldn't show who is on call because OneUptime could not check your account just now. Please try again in a minute.",
    ]);
    expect(String(errorLog.mock.calls[0]?.[0])).toBe(
      "Could not check the Microsoft Teams sender of an oncall command: Error: Connection terminated unexpectedly",
    );
    expect(read).not.toHaveBeenCalled();
  });

  test("the create commands' sender check reads as it always did", async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined;
    });
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockRejectedValue(new Error("must not be read"));
    const turn: FakeTurn = fakeTurn(
      oncallActivity({ id: "29:1someone", name: "Someone" }),
    );

    expect(
      await MicrosoftTeamsCommands.authorizeSender({
        turnContext: turn.turnContext,
        activity: turn.turnContext.activity as unknown as JSONObject,
        projectId: PROJECT_ID,
        does: "open the form to create an incident",
        commandName: "create",
        connect: { purpose: "declare an incident", command: "incident" },
      }),
    ).toBeNull();
    expect(turn.replies).toEqual([
      "Sorry, I couldn't tell who sent this message, so I can't open the form to create an incident. Please try again.",
    ]);
  });

  test("the product's name in the wording is the one the installation goes by", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockRejectedValue(new Error("down"));
    const turn: FakeTurn = fakeTurn(
      oncallActivity({
        id: "29:1someone",
        name: "Someone",
        aadObjectId: "a0000000-0000-4000-8000-000000000001",
      }),
    );

    await MicrosoftTeamsCommands.handleOnCallCommand({
      turnContext: turn.turnContext,
      activity: turn.turnContext.activity as unknown as JSONObject,
      projectId: PROJECT_ID,
    });

    expect(turn.replies).toEqual([
      "Sorry, I couldn't show who is on call because Acme Ops could not check your account just now. Please try again in a minute.",
    ]);
  });
});

/*
 * The hello a team or a group chat gets when the app is added to it
 * (MicrosoftTeamsHome.getTeamWelcome): what OneUptime does there and where
 * its notifications are set up, in the words Slack's channel hello says. It
 * used to be a long card: getting-started steps for a workspace that was
 * often set up already, every command, a support sentence and three buttons
 * that cut off on a phone, linked to OneUptime Cloud whatever the server.
 */
describe("the welcome a team or a group chat gets", () => {
  async function welcome(data: {
    projectId: ObjectID | null;
    isConnected: boolean;
    isPersonal?: boolean | undefined;
  }): Promise<{ card: JSONObject; summary: string }> {
    return await MicrosoftTeamsHome.getTeamWelcome(data);
  }

  function texts(card: JSONObject): Array<string> {
    return (card["body"] as Array<JSONObject>).map(
      (element: JSONObject): string => {
        return String(element["text"]);
      },
    );
  }

  const PROJECT: ObjectID = new ObjectID(
    "b0000000-0000-4000-8000-000000000001",
  );

  beforeEach(() => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://status.acme.test/dashboard"));
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("connected: two short lines - how to reach it, where notifications are set up - and one button", async () => {
    const { card, summary } = await welcome({
      projectId: PROJECT,
      isConnected: true,
    });

    expect(texts(card)).toEqual([
      "👋 **Hi, I'm Acme Ops.** @mention me with a question about your incidents, monitors, logs and traces, or with **help** to see what I can do: declare an incident, page someone, see who is on call.",
      "To post incidents, alerts or scheduled maintenance to a team's channels, add a notification rule in Acme Ops under **Incidents → Workspace → Microsoft Teams**.",
    ]);
    expect(card["actions"]).toEqual([
      {
        type: "Action.OpenUrl",
        title: "Set up notifications",
        url: `https://status.acme.test/dashboard/${PROJECT.toString()}/incidents/workspace-connection-microsoft-teams`,
      },
    ]);
    expect(summary).toBe(
      "Hi, I'm Acme Ops. @mention me with a question, or with help.",
    );
  });

  test("an organization connected to no project: who connects it, and the way to the product", async () => {
    const { card } = await welcome({ projectId: null, isConnected: false });

    expect(texts(card)[1]).toBe(
      // No article before the product's name: "a Acme Ops project admin" read wrong.
      "To get started, a project admin connects your organization in Acme Ops, under **Project Settings → Workspace → Microsoft Teams**.",
    );
    expect(card["actions"]).toEqual([
      {
        type: "Action.OpenUrl",
        title: "Open Acme Ops",
        url: "https://status.acme.test/dashboard",
      },
    ]);
  });

  test("an organization connected to several projects: where notifications are set up, without a project to link to", async () => {
    const { card } = await welcome({ projectId: null, isConnected: true });

    expect(texts(card)[1]).toContain("add a notification rule in Acme Ops");
    expect((card["actions"] as Array<JSONObject>)[0]!["title"]).toBe(
      "Open Acme Ops",
    );
  });

  test("a personal chat needs nobody to mention - nor does its notification", async () => {
    const { card, summary } = await welcome({
      projectId: null,
      isConnected: false,
      isPersonal: true,
    });

    expect(texts(card)[0]).toBe(
      "👋 **Hi, I'm Acme Ops.** Ask me a question about your incidents, monitors, logs and traces, or type **help** to see what I can do: declare an incident, page someone, see who is on call.",
    );
    expect(summary).toBe("Hi, I'm Acme Ops. Ask me a question, or type help.");
  });

  test("no server address: no button, never a link to OneUptime Cloud", async () => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockRejectedValue(new Error("no host"));

    const { card } = await welcome({ projectId: PROJECT, isConnected: true });

    expect(card["actions"]).toBeUndefined();
    expect(JSON.stringify(card)).not.toContain("oneuptime.com");
    expect(JSON.stringify(card)).not.toContain("support@");
  });

  test("no table and no command list a phone cannot fit; never 'create incident'", async () => {
    const { card } = await welcome({ projectId: PROJECT, isConnected: true });

    expect(
      (card["body"] as Array<JSONObject>).some((element: JSONObject) => {
        return element["type"] === "FactSet";
      }),
    ).toBe(false);
    expect(JSON.stringify(card).toLowerCase()).not.toContain("create incident");
    expect(texts(card)).toHaveLength(2);
  });
});
