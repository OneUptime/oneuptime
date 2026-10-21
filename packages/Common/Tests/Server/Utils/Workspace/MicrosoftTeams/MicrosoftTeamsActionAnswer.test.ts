import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Same botbuilder module factory as MicrosoftTeamsAccountNotLinked.test.ts:
 * the repo-wide manual mock does not expose TeamsInfo or
 * MessageFactory.attachment, both of which MicrosoftTeams.ts touches at
 * import time.
 */
jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: {
      text: jest.fn(),
      attachment: jest.fn((attachment: unknown) => {
        return { type: "message", attachments: [attachment] };
      }),
    },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: {
      getMembers: jest.fn(),
      getPagedMembers: jest.fn(),
    },
  };
});

import type { TurnContext } from "botbuilder";
import type { SpyInstance } from "jest-mock";
import logger from "../../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import {
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsScheduledMaintenanceActionType,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsActionAnswer from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsActionAnswer";
import MicrosoftTeamsConnectPrompt from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsConnectPrompt";
import { WorkspaceAnswer } from "../../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import {
  WorkspaceConnectRequestAgainKind,
  WorkspacePendingActionKind,
} from "../../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import { WorkspaceEventType } from "../../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

/*
 * A PRESS IN MICROSOFT TEAMS IS ANSWERED WHERE IT WAS MADE, TO WHOEVER MADE
 * IT.
 *
 * Microsoft Teams has no message only one person sees, so the answer to a
 * card's button is a small card in the same conversation that mentions the
 * person who pressed - Teams notifies them, and everybody else reading the
 * thread sees who it is for. These pin that card, the name it mentions
 * (whatever the person set, made safe for a mention and the card's
 * Markdown), and what each button asks to be connected for.
 */

const ANSWER: WorkspaceAnswer = {
  markdown:
    "🔗 **Connect your Microsoft Teams account to acknowledge this incident.** It takes one click, and OneUptime acknowledges it for you as soon as you're connected.",
  text: "Connect your Microsoft Teams account to acknowledge this incident",
};

const CONNECT_URL: string =
  "https://oneuptime.test/dashboard/p/user-settings/microsoft-teams-integration?connect=abc";

beforeEach(() => {
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MicrosoftTeamsActionAnswer.getMentionName", () => {
  test.each([
    ["a plain name", "Nitin Kumar", "Nitin Kumar"],
    ["a name that would close the mention", "Ann</at><at>Bob", "Ann/atatBob"],
    ["Markdown in a name", "**boss** [docs](x)", "boss docs(x)"],
    ["a name on several lines", "Ann\n\n  Lee", "Ann Lee"],
    ["only characters a mention cannot hold", "<**>", ""],
    ["not a name at all", 42, ""],
  ])("%s", (_name: string, input: unknown, expected: string) => {
    expect(MicrosoftTeamsActionAnswer.getMentionName(input)).toBe(expected);
  });

  test("a name longer than a hundred characters is cut", () => {
    expect(
      MicrosoftTeamsActionAnswer.getMentionName("A".repeat(150)),
    ).toHaveLength(100);
  });
});

describe("MicrosoftTeamsActionAnswer.buildCard", () => {
  test("mentions who pressed, says the answer, and carries the Connect button", () => {
    expect(
      MicrosoftTeamsActionAnswer.buildCard({
        answer: ANSWER,
        mention: { id: "29:nitin", name: "Nitin" },
        connectUrl: URL.fromString(CONNECT_URL),
      }),
    ).toEqual({
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: `<at>Nitin</at> ${ANSWER.markdown}`,
          wrap: true,
        },
      ],
      actions: [
        {
          type: "Action.OpenUrl",
          title: "Connect Microsoft Teams account",
          url: CONNECT_URL,
          style: "positive",
        },
      ],
      msteams: {
        entities: [
          {
            type: "mention",
            text: "<at>Nitin</at>",
            mentioned: { id: "29:nitin", name: "Nitin" },
          },
        ],
      },
    });
  });

  test("with nobody to mention and nothing to connect, it is the answer alone", () => {
    expect(MicrosoftTeamsActionAnswer.buildCard({ answer: ANSWER })).toEqual({
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [{ type: "TextBlock", text: ANSWER.markdown, wrap: true }],
    });
  });
});

describe("MicrosoftTeamsActionAnswer.reply", () => {
  function turnFrom(from: JSONObject | undefined): {
    turnContext: TurnContext;
    sent: Array<JSONObject>;
  } {
    const sent: Array<JSONObject> = [];

    return {
      sent: sent,
      turnContext: {
        activity: { from: from },
        sendActivity: async (activity: JSONObject): Promise<{ id: string }> => {
          sent.push(activity);
          return { id: "reply-1" };
        },
      } as unknown as TurnContext,
    };
  }

  test("replies in the conversation of the press, mentioning who pressed, with a notification that says what it is", async () => {
    const turn: { turnContext: TurnContext; sent: Array<JSONObject> } =
      turnFrom({ id: "29:nitin", name: "Nitin", aadObjectId: "aad-1" });

    const delivered: boolean = await MicrosoftTeamsActionAnswer.reply({
      turnContext: turn.turnContext,
      answer: ANSWER,
      connectUrl: URL.fromString(CONNECT_URL),
    });

    expect(delivered).toBe(true);
    expect(turn.sent).toHaveLength(1);
    expect(turn.sent[0]!["summary"]).toBe(ANSWER.text);

    const attachments: Array<JSONObject> = turn.sent[0]![
      "attachments"
    ] as Array<JSONObject>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!["contentType"]).toBe(
      "application/vnd.microsoft.card.adaptive",
    );
    expect(
      (
        (attachments[0]!["content"] as JSONObject)["body"] as Array<JSONObject>
      )[0]!["text"],
    ).toBe(`<at>Nitin</at> ${ANSWER.markdown}`);
  });

  test("a reply Teams refuses is logged, never thrown: the turn must not fail into a redelivery", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {});

    const delivered: boolean = await MicrosoftTeamsActionAnswer.reply({
      turnContext: {
        activity: {},
        sendActivity: async (): Promise<never> => {
          throw new Error("BotNotInConversationRoster");
        },
      } as unknown as TurnContext,
      answer: ANSWER,
    });

    expect(delivered).toBe(false);
  });
});

describe("MicrosoftTeamsActionAnswer.sendToPlace", () => {
  test("answers a press recorded earlier in its conversation, mentioning who made it", async () => {
    const send: SpyInstance<typeof MicrosoftTeamsUtil.sendCardToConversation> =
      jest
        .spyOn(MicrosoftTeamsUtil, "sendCardToConversation")
        .mockResolvedValue(undefined);

    await expect(
      MicrosoftTeamsActionAnswer.sendToPlace({
        place: {
          serviceUrl: "https://smba.trafficmanager.net/amer/",
          conversationId: "19:c@thread.tacv2;messageid=1",
          conversationType: "channel",
          tenantId: "tenant-1",
          userTeamsId: "29:nitin",
          userName: "Nitin",
        },
        answer: ANSWER,
      }),
    ).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith({
      conversationId: "19:c@thread.tacv2;messageid=1",
      conversationType: "channel",
      tenantId: "tenant-1",
      serviceUrl: "https://smba.trafficmanager.net/amer/",
      card: MicrosoftTeamsActionAnswer.buildCard({
        answer: ANSWER,
        mention: { id: "29:nitin", name: "Nitin" },
      }),
      summary: ANSWER.text,
    });
  });

  test("a conversation that takes no answer any more: false, and logged", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "sendCardToConversation")
      .mockRejectedValue(new Error("Forbidden"));
    jest.spyOn(logger, "error").mockImplementation(() => {});

    await expect(
      MicrosoftTeamsActionAnswer.sendToPlace({
        place: {
          serviceUrl: "https://smba.trafficmanager.net/amer/",
          conversationId: "19:c@thread.tacv2",
        },
        answer: ANSWER,
      }),
    ).resolves.toBe(false);
  });
});

describe("MicrosoftTeamsConnectPrompt.describe", () => {
  const RECORD_ID: string = "d1000000-0000-4000-8000-000000000001";

  test.each([
    [
      MicrosoftTeamsIncidentActionType.AckIncident,
      "acknowledge this incident",
      WorkspacePendingActionKind.Acknowledge,
      WorkspaceEventType.Incident,
    ],
    [
      MicrosoftTeamsIncidentActionType.ResolveIncident,
      "resolve this incident",
      WorkspacePendingActionKind.Resolve,
      WorkspaceEventType.Incident,
    ],
    [
      MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing,
      "mark this scheduled maintenance event as ongoing",
      WorkspacePendingActionKind.MarkAsOngoing,
      WorkspaceEventType.ScheduledMaintenance,
    ],
    [
      MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete,
      "mark this scheduled maintenance event as complete",
      WorkspacePendingActionKind.MarkAsComplete,
      WorkspaceEventType.ScheduledMaintenance,
    ],
  ])(
    "%s: asks to %s, and keeps the press to finish",
    (
      actionType: string,
      purpose: string,
      kind: WorkspacePendingActionKind,
      eventType: WorkspaceEventType,
    ) => {
      const description: ReturnType<
        typeof MicrosoftTeamsConnectPrompt.describe
      > = MicrosoftTeamsConnectPrompt.describe({
        actionType: actionType,
        actionValue: RECORD_ID,
      });

      expect(description.purpose).toBe(purpose);
      expect(description.pendingAction!.kind).toBe(kind);
      expect(description.pendingAction!.eventType).toBe(eventType);
      expect(description.pendingAction!.eventId.toString()).toBe(RECORD_ID);
    },
  );

  test("a form's button: asks for what the form does, and to press the button again", () => {
    expect(
      MicrosoftTeamsConnectPrompt.describe({
        actionType: MicrosoftTeamsIncidentActionType.ViewAddIncidentNote,
        actionValue: RECORD_ID,
      }),
    ).toEqual({
      purpose: "add a note to this incident",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Button,
        label: "Add Note",
      },
    });
  });

  test("a form to create something: to type its command again, as the word Slack's /oneuptime takes too", () => {
    expect(
      MicrosoftTeamsConnectPrompt.describe({
        actionType: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
      }),
    ).toEqual({
      purpose: "declare an incident",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Command,
        label: "incident",
      },
    });
    expect(
      MicrosoftTeamsConnectPrompt.describe({
        actionType:
          MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
      }),
    ).toEqual({
      purpose: "create a scheduled maintenance event",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Command,
        label: "maintenance",
      },
    });
  });

  test("a button no table knows asks only to connect", () => {
    expect(
      MicrosoftTeamsConnectPrompt.describe({ actionType: "SomethingNew" }),
    ).toEqual({ purpose: "use OneUptime from Microsoft Teams" });
  });
});

describe("MicrosoftTeamsConnectPrompt.getPlace", () => {
  function activity(serviceUrl: string): JSONObject {
    return {
      serviceUrl: serviceUrl,
      from: { id: "29:nitin", name: "Nitin", aadObjectId: "aad-1" },
      conversation: {
        id: "19:c@thread.tacv2;messageid=1",
        conversationType: "channel",
      },
      channelData: { tenant: { id: "tenant-1" } },
    };
  }

  test("keeps the conversation of the press and who made it, to answer there later", () => {
    expect(
      MicrosoftTeamsConnectPrompt.getPlace(
        activity("https://smba.trafficmanager.net/amer/"),
      ),
    ).toEqual({
      serviceUrl: "https://smba.trafficmanager.net/amer/",
      conversationId: "19:c@thread.tacv2;messageid=1",
      conversationType: "channel",
      tenantId: "tenant-1",
      userTeamsId: "29:nitin",
      userName: "Nitin",
    });
  });

  test.each([
    ["a host that is not Microsoft's", "https://evil.test/amer/"],
    [
      "Microsoft's host only in the path",
      "https://evil.test/smba.trafficmanager.net/",
    ],
    ["plain http", "http://smba.trafficmanager.net/amer/"],
  ])(
    "keeps nothing when the Bot Connector is %s",
    (_name: string, url: string) => {
      expect(
        MicrosoftTeamsConnectPrompt.getPlace(activity(url)),
      ).toBeUndefined();
    },
  );
});

/*
 * #4768: a question to OneUptime AI from an account not connected is
 * prompted once in a conversation (MicrosoftTeamsConnectPrompt.promptOnce):
 * a channel's thread, a group chat or a personal chat, for the person who
 * asked, in their organization.
 */
describe("MicrosoftTeamsConnectPrompt.getConversation", () => {
  test("a channel's thread: the thread, by its conversation id, and the person by their Microsoft Entra object id", () => {
    expect(
      MicrosoftTeamsConnectPrompt.getConversation({
        from: { id: "29:carol", name: "Carol", aadObjectId: "aad-carol" },
        conversation: {
          id: "19:ops@thread.tacv2;messageid=1760000000000",
          conversationType: "channel",
        },
        channelData: { tenant: { id: "tenant-1" } },
      }),
    ).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceId: "tenant-1",
      conversationId: "19:ops@thread.tacv2;messageid=1760000000000",
      workspaceUserId: "aad-carol",
    });
  });

  test("a personal chat names its tenant on the conversation", () => {
    expect(
      MicrosoftTeamsConnectPrompt.getConversation({
        from: { id: "29:carol", aadObjectId: "aad-carol" },
        conversation: {
          id: "a:personal-chat",
          conversationType: "personal",
          tenantId: "tenant-2",
        },
      }),
    ).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceId: "tenant-2",
      conversationId: "a:personal-chat",
      workspaceUserId: "aad-carol",
    });
  });

  test("two threads of one channel are two conversations", () => {
    function inThread(root: string): JSONObject {
      return {
        from: { id: "29:carol", aadObjectId: "aad-carol" },
        conversation: { id: `19:ops@thread.tacv2;messageid=${root}` },
        channelData: { tenant: { id: "tenant-1" } },
      };
    }

    expect(
      MicrosoftTeamsConnectPrompt.getConversation(inThread("1")),
    ).not.toEqual(MicrosoftTeamsConnectPrompt.getConversation(inThread("2")));
  });

  test("a sender with no Microsoft Entra object id is told apart by their Teams id; an activity naming nothing names nothing", () => {
    expect(
      MicrosoftTeamsConnectPrompt.getConversation({
        from: { id: "29:guest" },
        conversation: { id: "19:chat@thread.v2" },
      }),
    ).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceId: "",
      conversationId: "19:chat@thread.v2",
      workspaceUserId: "29:guest",
    });
    expect(MicrosoftTeamsConnectPrompt.getConversation({})).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceId: "",
      conversationId: "",
      workspaceUserId: "",
    });
  });
});
