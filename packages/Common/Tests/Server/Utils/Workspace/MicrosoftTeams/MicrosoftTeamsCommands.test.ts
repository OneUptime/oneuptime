import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
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

describe("the welcome card a new installation gets", () => {
  function welcomeCard(): JSONObject {
    return (
      MicrosoftTeamsUtil as unknown as {
        buildWelcomeAdaptiveCard: () => JSONObject;
      }
    ).buildWelcomeAdaptiveCard();
  }

  test("lists the commands the manifest suggests - incident, maintenance, oncall, ask, the lists, help - never 'create incident'", () => {
    const factSet: JSONObject | undefined = (
      welcomeCard()["body"] as Array<JSONObject>
    ).find((element: JSONObject): boolean => {
      return element["type"] === "FactSet";
    });

    expect(factSet?.["facts"]).toEqual(
      MicrosoftTeamsCommands.getManifestCommands().map(
        (command: JSONObject): JSONObject => {
          return {
            title: command["title"],
            value: command["description"],
          };
        },
      ),
    );
    expect(JSON.stringify(welcomeCard())).not.toContain("create incident");
  });

  test("says how to reach the bot in a channel, and where the project connects Microsoft Teams", () => {
    const texts: Array<string> = (welcomeCard()["body"] as Array<JSONObject>)
      .filter((element: JSONObject): boolean => {
        return element["type"] === "TextBlock";
      })
      .map((element: JSONObject): string => {
        return String(element["text"]);
      });

    expect(texts).toContain(
      "Type them in a chat with OneUptime, or after @OneUptime in a channel or a group chat. Anything else is a question for OneUptime AI.",
    );
    expect(texts.join("\n")).toContain(
      "**Project Settings → Workspace → Microsoft Teams**",
    );
  });
});
