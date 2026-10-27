import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Same botbuilder module factory as MicrosoftTeamsActionAnswer.test.ts: the
 * repo-wide manual mock does not expose everything MicrosoftTeams.ts
 * touches at import time.
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

jest.mock("../../../../../Server/Utils/Logger");

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

import type { Activity, TurnContext } from "botbuilder";
import type { Mock } from "jest-mock";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import {
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsPageActionType,
  MicrosoftTeamsProjectChoiceActionType,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import { MicrosoftTeamsHomeActionType } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsHome";
import MicrosoftTeamsProjectChoice, {
  MicrosoftTeamsConversationOfPerson,
  MicrosoftTeamsProjectChoiceKind,
  MicrosoftTeamsProjectChoiceRequest,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsProjectChoice";
import { MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import WorkspaceProjectChoiceStore, {
  WorkspaceProjectChoicePress,
  WorkspaceProjectChoiceRefusal,
  WorkspaceProjectChoiceTaken,
} from "../../../../../Server/Utils/Workspace/WorkspaceProjectChoiceStore";
import WorkspaceProjectResolver, {
  WorkspaceProjectChoice,
  WorkspaceProjectEvidence,
  WorkspaceProjectResolution,
} from "../../../../../Server/Utils/Workspace/WorkspaceProjectResolution";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * "WHICH PROJECT IS THIS FOR?" IN MICROSOFT TEAMS.
 *
 * In a Microsoft 365 organization connected to more than one project, a
 * request nothing ties to one of them is answered with a card that
 * mentions its sender and has a button for each project they are in; the
 * request is kept behind the buttons - by its token's hash, for thirty
 * minutes - and spent once, only by the person who made it, for a project
 * offered. These pin the card, what is kept of an activity, every way a
 * press can spend nothing, what the question becomes, and the project a
 * conversation with OneUptime AI keeps for its follow-ups. The flows
 * through the bot are in MicrosoftTeamsTenantResolution.test.ts and
 * MicrosoftTeamsProjectChoiceEndToEnd.test.ts.
 */

const TENANT: string = "4220aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DEANE_AAD: string = "00000000-0000-4000-8000-00000000dea1";
const NITIN_AAD: string = "00000000-0000-4000-8000-0000000000a2";
const PERSONAL_CHAT: string = "a:4220-personal-chat-deane";
const CHANNEL_THREAD: string = "19:ops-4220@thread.tacv2;messageid=1760000001";

const PLATFORM: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000001");
const NONPRD: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000002");
const OTHER: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000003");

const NAMES: Record<string, string> = {
  [PLATFORM.toString()]: "IRM Platform",
  [NONPRD.toString()]: "IRM Non-Prod",
  [OTHER.toString()]: "Sandbox",
};

const BOT: JSONObject = { id: "28:oneuptime-bot", name: "OneUptime" };
const DEANE: JSONObject = {
  id: "29:deane",
  name: "Deane Barker",
  aadObjectId: DEANE_AAD,
};
const NITIN: JSONObject = { id: "29:nitin", name: "Nitin", aadObjectId: NITIN_AAD };

const TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;

// A message typed to the bot, in Deane's chat with it or in a channel.
function message(
  text: string,
  options?: {
    from?: JSONObject | undefined;
    where?: "personal" | "channel" | undefined;
  },
): JSONObject {
  const inChannel: boolean = options?.where === "channel";

  return {
    type: "message",
    id: `msg-${ObjectID.generate().toString().substring(0, 8)}`,
    text: inChannel ? `<at>OneUptime</at> ${text}` : text,
    textFormat: "plain",
    locale: "en-US",
    localTimezone: "Europe/Oslo",
    rawLocalTimestamp: "2026-10-27T09:00:00.000+01:00",
    timestamp: "2026-10-27T08:00:00.000Z",
    serviceUrl: "https://smba.trafficmanager.net/emea/",
    channelId: "msteams",
    from: options?.from || DEANE,
    recipient: BOT,
    conversation: inChannel
      ? {
          id: CHANNEL_THREAD,
          conversationType: "channel",
          tenantId: TENANT,
          isGroup: true,
        }
      : { id: PERSONAL_CHAT, conversationType: "personal", tenantId: TENANT },
    channelData: inChannel
      ? {
          tenant: { id: TENANT },
          team: { id: "19:team-4220@thread.tacv2", name: "Operations" },
          channel: { id: "19:ops-4220@thread.tacv2", name: "ops" },
        }
      : { tenant: { id: TENANT } },
    entities: inChannel
      ? [{ type: "mention", text: "<at>OneUptime</at>", mentioned: BOT }]
      : [],
  };
}

// A press of a card's button: Teams sends it as a message with a value.
function press(
  value: JSONObject,
  options?: {
    from?: JSONObject | undefined;
    tenantId?: string | undefined;
    replyToId?: string | undefined;
  },
): JSONObject {
  return {
    ...message(""),
    text: undefined,
    from: options?.from || DEANE,
    replyToId: options?.replyToId || "question-card-1",
    channelData: { tenant: { id: options?.tenantId || TENANT } },
    value: value,
  };
}

interface FakeTurn {
  turnContext: TurnContext;
  sent: Array<Partial<Activity>>;
  updated: Array<Partial<Activity>>;
}

function turnOf(
  activity: JSONObject,
  options?: { refuseSends?: boolean | undefined },
): FakeTurn {
  const sent: Array<Partial<Activity>> = [];
  const updated: Array<Partial<Activity>> = [];

  const turnContext: TurnContext = {
    activity: activity,
    sendActivity: jest.fn(async (reply: Partial<Activity>) => {
      if (options?.refuseSends) {
        throw new Error("Microsoft Teams refused it");
      }

      sent.push(reply);
      return { id: `sent-${sent.length}` };
    }),
    updateActivity: jest.fn(async (reply: Partial<Activity>) => {
      updated.push(reply);
    }),
  } as unknown as TurnContext;

  return { turnContext, sent, updated };
}

function resolution(
  memberProjectIds: Array<ObjectID>,
  isAmbiguous: boolean = true,
): WorkspaceProjectResolution {
  const connections: Array<WorkspaceProjectAuthToken> = [
    PLATFORM,
    NONPRD,
    OTHER,
  ].map((projectId: ObjectID): WorkspaceProjectAuthToken => {
    const connection: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    connection.projectId = projectId;
    connection.workspaceProjectId = TENANT;
    return connection;
  });

  return {
    projectAuth: null,
    connections: connections,
    isAmbiguous: isAmbiguous,
    decidedBy: null as WorkspaceProjectEvidence | null,
    memberProjectIds: memberProjectIds,
    isPersonConnected: memberProjectIds.length > 0,
  };
}

function cardOf(activity: Partial<Activity> | undefined): JSONObject {
  const attachment: { contentType?: string; content?: unknown } | undefined =
    activity?.attachments?.[0];

  expect(attachment?.contentType).toBe(
    MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
  );

  return attachment!.content as JSONObject;
}

function buttonsOf(card: JSONObject): Array<JSONObject> {
  return (card["body"] as Array<JSONObject>)
    .filter((element: JSONObject): boolean => {
      return element["type"] === "ActionSet";
    })
    .flatMap((set: JSONObject): Array<JSONObject> => {
      return set["actions"] as Array<JSONObject>;
    });
}

function textOf(card: JSONObject): string {
  return String((card["body"] as Array<JSONObject>)[0]!["text"]);
}

// What each button of the card offered carries.
function pressesOf(card: JSONObject): Array<WorkspaceProjectChoicePress> {
  return buttonsOf(card).map(
    (button: JSONObject): WorkspaceProjectChoicePress => {
      return WorkspaceProjectChoiceStore.readChoice(
        (button["data"] as JSONObject)["actionValue"],
      )!;
    },
  );
}

function choiceValue(press: WorkspaceProjectChoicePress): JSONObject {
  return {
    action: MicrosoftTeamsProjectChoiceActionType.ChooseProject,
    actionValue: WorkspaceProjectChoiceStore.getChoiceValue(press),
  };
}

interface InMemoryCache {
  store: Map<string, { value: string; expiresAt: number }>;
}

function cache(): InMemoryCache {
  return GlobalCache as unknown as InMemoryCache;
}

// Asks Deane which project his request is for; the card he gets.
async function askDeane(
  activity: JSONObject = message("oncall"),
  kind: MicrosoftTeamsProjectChoiceKind = MicrosoftTeamsProjectChoiceKind.Message,
  isQuestion: boolean = false,
): Promise<JSONObject> {
  const turn: FakeTurn = turnOf(activity);

  expect(
    await MicrosoftTeamsProjectChoice.offer({
      turnContext: turn.turnContext,
      activity: activity,
      resolution: resolution([PLATFORM, NONPRD]),
      kind: kind,
      isQuestion: isQuestion,
    }),
  ).toBe(true);
  expect(turn.sent).toHaveLength(1);

  return cardOf(turn.sent[0]);
}

async function takeWith(
  value: JSONObject,
  options?: { from?: JSONObject; tenantId?: string },
): Promise<WorkspaceProjectChoiceTaken<MicrosoftTeamsProjectChoiceRequest>> {
  return await MicrosoftTeamsProjectChoice.take({
    activity: press(value, options),
    actionValue: value["actionValue"] as string | undefined,
  });
}

function refusalOf(
  taken: WorkspaceProjectChoiceTaken<MicrosoftTeamsProjectChoiceRequest>,
): string {
  return taken.isTaken ? "taken" : taken.refusal;
}

beforeEach(() => {
  cache().store.clear();

  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
  jest
    .spyOn(WorkspaceProjectResolver, "getProjectChoices")
    .mockImplementation(async (projectIds: Array<ObjectID>) => {
      return projectIds.map((projectId: ObjectID): WorkspaceProjectChoice => {
        return { projectId: projectId, name: NAMES[projectId.toString()]! };
      });
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the question", () => {
  test("mentions who asked, says why it asks, and has a button for each project, one under another, in the order given", async () => {
    const card: JSONObject = await askDeane();

    expect(textOf(card)).toBe(
      "<at>Deane Barker</at> **Which project is this for?** This Microsoft 365 organization is connected to more than one OneUptime project, and I can't tell which one you mean here.",
    );
    expect(card["msteams"]).toEqual({
      entities: [
        {
          type: "mention",
          text: "<at>Deane Barker</at>",
          mentioned: { id: "29:deane", name: "Deane Barker" },
        },
      ],
    });

    const sets: Array<JSONObject> = (card["body"] as Array<JSONObject>).slice(
      1,
    );

    expect(
      sets.map((set: JSONObject): unknown => {
        return [set["type"], set["spacing"], (set["actions"] as Array<JSONObject>).length];
      }),
    ).toEqual([
      ["ActionSet", undefined, 1],
      ["ActionSet", "Small", 1],
    ]);
    expect(
      buttonsOf(card).map((button: JSONObject): unknown => {
        return [button["type"], button["title"]];
      }),
    ).toEqual([
      ["Action.Submit", "IRM Platform"],
      ["Action.Submit", "IRM Non-Prod"],
    ]);
    // Nothing else to press: no links, no buttons in the card's own row.
    expect(card["actions"]).toBeUndefined();
  });

  test("each button names its project and one token, behind which only the token's hash is kept", async () => {
    const card: JSONObject = await askDeane();
    const presses: Array<WorkspaceProjectChoicePress> = pressesOf(card);

    for (const button of buttonsOf(card)) {
      expect(Object.keys(button["data"] as JSONObject).sort()).toEqual([
        "action",
        "actionValue",
      ]);
      expect((button["data"] as JSONObject)["action"]).toBe("choose-project");
    }

    expect(
      presses.map((choice: WorkspaceProjectChoicePress): string => {
        return choice.projectId.toString();
      }),
    ).toEqual([PLATFORM.toString(), NONPRD.toString()]);
    expect(presses[0]!.token).toMatch(TOKEN_PATTERN);
    expect(presses[1]!.token).toBe(presses[0]!.token);

    const [key, entry] = Array.from(cache().store.entries())[0]!;

    expect(key).toBe(
      `microsoft-teams-project-choice-${WorkspaceProjectChoiceStore.hash(presses[0]!.token)}`,
    );
    expect(entry.value).not.toContain(presses[0]!.token);
    expect(entry.expiresAt - Date.now()).toBeGreaterThan(29 * 60 * 1000);
    expect(entry.expiresAt - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  test("what a notification shows: the question and the projects", () => {
    const question: { card: JSONObject; summary: string } =
      MicrosoftTeamsProjectChoice.getQuestion({
        token: "A".repeat(43),
        choices: [
          { projectId: PLATFORM, name: "Production" },
          { projectId: NONPRD, name: "Staging" },
          { projectId: OTHER, name: "Development" },
        ],
      });

    expect(question.summary).toBe(
      "Which project is this for: Production, Staging or Development?",
    );
  });

  test("on an installation that has not been renamed, its sentence is the one the docs quote", () => {
    const question: { card: JSONObject; summary: string } =
      MicrosoftTeamsProjectChoice.getQuestion({
        token: "A".repeat(43),
        choices: [
          { projectId: PLATFORM, name: "IRM Platform" },
          { projectId: NONPRD, name: "IRM Non-Prod" },
        ],
      });

    expect(textOf(question.card)).toBe(
      `**Which project is this for?** ${WorkspaceProjectResolver.TEAMS_AMBIGUOUS_LEAD}, and I can't tell which one you mean here.`,
    );
  });

  test("a renamed installation's own name", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    const question: { card: JSONObject; summary: string } =
      MicrosoftTeamsProjectChoice.getQuestion({
        token: "A".repeat(43),
        choices: [
          { projectId: PLATFORM, name: "IRM Platform" },
          { projectId: NONPRD, name: "IRM Non-Prod" },
        ],
      });

    expect(textOf(question.card)).toContain(
      "connected to more than one Acme Status project",
    );
    expect(textOf(question.card)).not.toContain("OneUptime");
  });

  test("a long name is cut to what a button holds; the summary names it whole", () => {
    const long: string = `Acme Corporation Global Production Infrastructure ${"x".repeat(60)}`;
    const question: { card: JSONObject; summary: string } =
      MicrosoftTeamsProjectChoice.getQuestion({
        token: "A".repeat(43),
        choices: [
          { projectId: PLATFORM, name: long },
          { projectId: NONPRD, name: "Staging" },
        ],
      });

    const title: string = String(buttonsOf(question.card)[0]!["title"]);

    expect(title).toHaveLength(WorkspaceProjectChoiceStore.BUTTON_TITLE_MAX_LENGTH);
    expect(title.endsWith("…")).toBe(true);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
    expect(question.summary).toContain(long);
  });

  test("without anybody to mention, the question alone", () => {
    const question: { card: JSONObject; summary: string } =
      MicrosoftTeamsProjectChoice.getQuestion({
        token: "A".repeat(43),
        choices: [
          { projectId: PLATFORM, name: "IRM Platform" },
          { projectId: NONPRD, name: "IRM Non-Prod" },
        ],
        mention: null,
      });

    expect(textOf(question.card).startsWith("**Which project")).toBe(true);
    expect(question.card["msteams"]).toBeUndefined();
  });
});

describe("when it is asked, and when it is not", () => {
  test("as many projects as a card lists are asked; one more is not", async () => {
    const atMost: Array<ObjectID> = Array.from(
      { length: WorkspaceProjectChoiceStore.MAX_CHOICES },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );

    jest
      .spyOn(WorkspaceProjectResolver, "getProjectChoices")
      .mockImplementation(async (projectIds: Array<ObjectID>) => {
        return projectIds.map(
          (projectId: ObjectID, index: number): WorkspaceProjectChoice => {
            return { projectId: projectId, name: `Project ${index + 1}` };
          },
        );
      });

    const asked: FakeTurn = turnOf(message("oncall"));

    expect(
      await MicrosoftTeamsProjectChoice.offer({
        turnContext: asked.turnContext,
        activity: message("oncall"),
        resolution: resolution(atMost),
        kind: MicrosoftTeamsProjectChoiceKind.Message,
      }),
    ).toBe(true);
    expect(buttonsOf(cardOf(asked.sent[0]))).toHaveLength(25);

    const notAsked: FakeTurn = turnOf(message("oncall"));

    expect(
      await MicrosoftTeamsProjectChoice.offer({
        turnContext: notAsked.turnContext,
        activity: message("oncall"),
        resolution: resolution([...atMost, ObjectID.generate()]),
        kind: MicrosoftTeamsProjectChoiceKind.Message,
      }),
    ).toBe(false);
    expect(notAsked.sent).toEqual([]);
  });

  test("never of somebody in fewer than two of the projects", async () => {
    for (const memberProjectIds of [[], [NONPRD]]) {
      const turn: FakeTurn = turnOf(message("oncall"));

      expect(
        await MicrosoftTeamsProjectChoice.offer({
          turnContext: turn.turnContext,
          activity: message("oncall"),
          resolution: resolution(memberProjectIds),
          kind: MicrosoftTeamsProjectChoiceKind.Message,
        }),
      ).toBe(false);
      expect(turn.sent).toEqual([]);
    }

    expect(cache().store.size).toBe(0);
  });

  test("never without a resolution, an organization or a person", async () => {
    const noTenant: JSONObject = message("oncall");
    noTenant["channelData"] = {};
    noTenant["conversation"] = { id: PERSONAL_CHAT };

    const nobody: JSONObject = message("oncall", {
      from: { id: "29:deane", name: "Deane Barker" },
    });

    for (const [activity, given] of [
      [message("oncall"), undefined],
      [noTenant, resolution([PLATFORM, NONPRD])],
      [nobody, resolution([PLATFORM, NONPRD])],
    ] as Array<[JSONObject, WorkspaceProjectResolution | undefined]>) {
      const turn: FakeTurn = turnOf(activity);

      expect(
        await MicrosoftTeamsProjectChoice.offer({
          turnContext: turn.turnContext,
          activity: activity,
          resolution: given,
          kind: MicrosoftTeamsProjectChoiceKind.Message,
        }),
      ).toBe(false);
      expect(turn.sent).toEqual([]);
    }
  });

  test("not when a project cannot be named: every button is named", async () => {
    jest
      .spyOn(WorkspaceProjectResolver, "getProjectChoices")
      .mockResolvedValue(null);
    const turn: FakeTurn = turnOf(message("oncall"));

    expect(
      await MicrosoftTeamsProjectChoice.offer({
        turnContext: turn.turnContext,
        activity: message("oncall"),
        resolution: resolution([PLATFORM, NONPRD]),
        kind: MicrosoftTeamsProjectChoiceKind.Message,
      }),
    ).toBe(false);
    expect(turn.sent).toEqual([]);
    expect(cache().store.size).toBe(0);
  });

  test("not when the request cannot be kept: the cache is down, and the failure is logged", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValueOnce(new Error("connection refused"));
    const errors: Array<unknown> = [];
    jest.spyOn(logger, "error").mockImplementation((line: unknown) => {
      errors.push(line);
    });
    const turn: FakeTurn = turnOf(message("oncall"));

    expect(
      await MicrosoftTeamsProjectChoice.offer({
        turnContext: turn.turnContext,
        activity: message("oncall"),
        resolution: resolution([PLATFORM, NONPRD]),
        kind: MicrosoftTeamsProjectChoiceKind.Message,
      }),
    ).toBe(false);
    expect(turn.sent).toEqual([]);
    expect(errors[0]).toBe(
      "Could not record a Microsoft Teams request to ask its project of.",
    );
  });

  test("not when Teams refuses the card: the caller answers with text instead", async () => {
    const turn: FakeTurn = turnOf(message("oncall"), { refuseSends: true });

    expect(
      await MicrosoftTeamsProjectChoice.offer({
        turnContext: turn.turnContext,
        activity: message("oncall"),
        resolution: resolution([PLATFORM, NONPRD]),
        kind: MicrosoftTeamsProjectChoiceKind.Message,
      }),
    ).toBe(false);
  });
});

describe("what of the request is kept", () => {
  test("who sent it, where, its text and whom it mentions, its time zone - nothing else", () => {
    const activity: JSONObject = {
      ...message("page @Nawaz checkout is down", { where: "channel" }),
      attachments: [{ contentType: "text/html", content: "<p>secret</p>" }],
      importance: "urgent",
      channelData: {
        tenant: { id: TENANT },
        team: { id: "19:team@thread.tacv2", name: "Operations", aadGroupId: "g-1" },
        channel: { id: "19:ops@thread.tacv2", name: "ops" },
        settings: { selectedChannel: { id: "19:ops@thread.tacv2" } },
        eventType: "teamMemberAdded",
      },
      entities: [
        { type: "mention", text: "<at>OneUptime</at>", mentioned: BOT },
        {
          type: "mention",
          text: "<at>Nawaz</at>",
          mentioned: { id: "29:nawaz", name: "Nawaz", role: "user" },
        },
        {
          type: "clientInfo",
          locale: "en-US",
          country: "NO",
          platform: "Web",
          timezone: "Europe/Oslo",
        },
        { type: "https://schema.org/Message", "@type": "Message" },
      ],
    };

    expect(MicrosoftTeamsProjectChoice.getKeptActivity(activity)).toEqual({
      type: "message",
      id: activity["id"],
      text: "<at>OneUptime</at> page @Nawaz checkout is down",
      textFormat: "plain",
      locale: "en-US",
      localTimezone: "Europe/Oslo",
      rawLocalTimestamp: "2026-10-27T09:00:00.000+01:00",
      serviceUrl: "https://smba.trafficmanager.net/emea/",
      channelId: "msteams",
      from: DEANE,
      recipient: BOT,
      conversation: {
        id: CHANNEL_THREAD,
        conversationType: "channel",
        tenantId: TENANT,
        isGroup: true,
      },
      channelData: {
        tenant: { id: TENANT },
        team: { id: "19:team@thread.tacv2", name: "Operations", aadGroupId: "g-1" },
        channel: { id: "19:ops@thread.tacv2", name: "ops" },
      },
      entities: [
        {
          type: "mention",
          text: "<at>OneUptime</at>",
          mentioned: { id: "28:oneuptime-bot", name: "OneUptime" },
        },
        {
          type: "mention",
          text: "<at>Nawaz</at>",
          mentioned: { id: "29:nawaz", name: "Nawaz" },
        },
        {
          type: "clientInfo",
          locale: "en-US",
          country: "NO",
          platform: "Web",
          timezone: "Europe/Oslo",
        },
      ],
    });
  });

  test("of a press: the card it was made on and the button, never what a form around it held", () => {
    for (const value of [
      { action: "home-declare-incident", actionValue: "", incidentTitle: "x" },
      { data: { action: "home-declare-incident", actionValue: "" }, note: "x" },
      {
        action: {
          type: "Action.Submit",
          data: { action: "home-declare-incident", actionValue: "" },
        },
      },
    ]) {
      const kept: JSONObject = MicrosoftTeamsProjectChoice.getKeptActivity(
        press(value, { replyToId: "home-card-7" }),
      );

      expect(kept["value"]).toEqual({
        action: "home-declare-incident",
        actionValue: "",
      });
      expect(kept["replyToId"]).toBe("home-card-7");
    }

    expect(
      MicrosoftTeamsProjectChoice.getKeptActivity(press({ note: "x" }))[
        "value"
      ],
    ).toEqual({});
  });

  test("what was kept comes back as it was, with its kind and whether it is a question", async () => {
    const asked: JSONObject = message("which monitors are down?");
    const card: JSONObject = await askDeane(
      asked,
      MicrosoftTeamsProjectChoiceKind.Message,
      true,
    );

    const taken: WorkspaceProjectChoiceTaken<MicrosoftTeamsProjectChoiceRequest> =
      await takeWith(choiceValue(pressesOf(card)[1]!));

    expect(taken.isTaken).toBe(true);

    if (taken.isTaken) {
      expect(taken.record.request).toEqual({
        kind: MicrosoftTeamsProjectChoiceKind.Message,
        activity: MicrosoftTeamsProjectChoice.getKeptActivity(asked),
        isQuestion: true,
      });
      expect(taken.choice).toEqual({ projectId: NONPRD, name: "IRM Non-Prod" });
      expect(taken.record.workspaceId).toBe(TENANT);
      expect(taken.record.workspaceUserId).toBe(DEANE_AAD);
    }
  });
});

describe("a press of one of the buttons", () => {
  test("the person who asked, choosing a project offered: spent", async () => {
    const card: JSONObject = await askDeane();

    expect(refusalOf(await takeWith(choiceValue(pressesOf(card)[0]!)))).toBe(
      "taken",
    );
    expect(cache().store.size).toBe(0);
  });

  test("a second press - the other button, or the same again - spends nothing: gone", async () => {
    const card: JSONObject = await askDeane();
    const presses: Array<WorkspaceProjectChoicePress> = pressesOf(card);

    await takeWith(choiceValue(presses[0]!));

    for (const choice of presses) {
      expect(refusalOf(await takeWith(choiceValue(choice)))).toBe(
        WorkspaceProjectChoiceRefusal.Gone,
      );
    }
  });

  test("somebody else's press, in the same channel: not theirs, and Deane can still choose", async () => {
    const card: JSONObject = await askDeane(
      message("oncall", { where: "channel" }),
    );
    const value: JSONObject = choiceValue(pressesOf(card)[1]!);

    expect(refusalOf(await takeWith(value, { from: NITIN }))).toBe(
      WorkspaceProjectChoiceRefusal.NotTheirs,
    );
    expect(
      refusalOf(await takeWith(value, { tenantId: "another-tenant" })),
    ).toBe(WorkspaceProjectChoiceRefusal.NotTheirs);
    expect(cache().store.size).toBe(1);
    expect(refusalOf(await takeWith(value))).toBe("taken");
  });

  test("an edited press naming a project not offered spends nothing", async () => {
    const card: JSONObject = await askDeane();
    const token: string = pressesOf(card)[0]!.token;

    expect(
      refusalOf(
        await takeWith(choiceValue({ projectId: OTHER, token: token })),
      ),
    ).toBe(WorkspaceProjectChoiceRefusal.NotOffered);
    expect(cache().store.size).toBe(1);
  });

  test("past its thirty minutes: gone", async () => {
    const card: JSONObject = await askDeane();

    for (const entry of cache().store.values()) {
      entry.expiresAt = Date.now() - 1;
    }

    expect(refusalOf(await takeWith(choiceValue(pressesOf(card)[0]!)))).toBe(
      WorkspaceProjectChoiceRefusal.Gone,
    );
  });

  test("a value that is not one of the buttons': gone, and nothing read", async () => {
    await askDeane();
    const reads: number = (GlobalCache.getString as unknown as Mock).mock
      .calls
      .length;

    for (const actionValue of [
      undefined,
      "",
      "garbled",
      `${NONPRD.toString()}:short`,
      `not-a-project:${"A".repeat(43)}`,
    ]) {
      expect(
        refusalOf(
          await MicrosoftTeamsProjectChoice.take({
            activity: press({ action: "choose-project", actionValue }),
            actionValue: actionValue,
          }),
        ),
      ).toBe(WorkspaceProjectChoiceRefusal.Gone);
    }

    expect((GlobalCache.getString as unknown as Mock).mock.calls.length).toBe(
      reads,
    );
    expect(cache().store.size).toBe(1);
  });

  test("what each is told: somebody else's, that only the person who asked can choose; any other, that it is gone", () => {
    expect(
      MicrosoftTeamsProjectChoice.getRefusalAnswer(
        WorkspaceProjectChoiceRefusal.NotTheirs,
      ),
    ).toEqual({
      markdown:
        "Only the person who asked can choose which project this is for.",
      text: "Only the person who asked can choose which project this is for.",
    });

    for (const refusal of [
      WorkspaceProjectChoiceRefusal.Gone,
      WorkspaceProjectChoiceRefusal.NotOffered,
    ]) {
      expect(MicrosoftTeamsProjectChoice.getRefusalAnswer(refusal)).toEqual({
        markdown:
          "This choice has expired, or was already made. Please try again.",
        text: "This choice has expired, or was already made. Please try again.",
      });
    }
  });
});

describe("what the question becomes", () => {
  test("once chosen: going ahead in the project, in the question's place, still mentioning who asked", async () => {
    const turn: FakeTurn = turnOf(press({ action: "choose-project" }));

    await MicrosoftTeamsProjectChoice.answerChosen({
      turnContext: turn.turnContext,
      replyToId: "question-card-1",
      projectName: "IRM Non-Prod",
    });

    expect(turn.sent).toEqual([]);
    expect(turn.updated).toHaveLength(1);
    expect(turn.updated[0]!.id).toBe("question-card-1");
    expect(turn.updated[0]!.type).toBe("message");
    expect(turn.updated[0]!.summary).toBe("Going ahead in IRM Non-Prod.");

    const card: JSONObject = cardOf(turn.updated[0]);

    expect(textOf(card)).toBe(
      "<at>Deane Barker</at> Going ahead in **IRM Non-Prod**.",
    );
    expect(buttonsOf(card)).toEqual([]);
    expect(card["actions"]).toBeUndefined();
  });

  test("a project's name is text in it, never Markdown", async () => {
    const turn: FakeTurn = turnOf(press({ action: "choose-project" }));

    await MicrosoftTeamsProjectChoice.answerChosen({
      turnContext: turn.turnContext,
      replyToId: "question-card-1",
      projectName: "*Prod* [click](https://evil.test)",
    });

    const text: string = textOf(cardOf(turn.updated[0]));

    expect(text).not.toContain("[click](");
    expect(text).toContain("\\*Prod\\*");
  });

  test("nowhere to put it, or Teams refusing it, is no failure", async () => {
    const turn: FakeTurn = turnOf(press({ action: "choose-project" }));

    await MicrosoftTeamsProjectChoice.answerChosen({
      turnContext: turn.turnContext,
      replyToId: undefined,
      projectName: "IRM Non-Prod",
    });
    expect(turn.updated).toEqual([]);

    (
      turn.turnContext.updateActivity as unknown as Mock
    ).mockImplementationOnce(async () => {
      throw new Error("Not Found");
    });

    await expect(
      MicrosoftTeamsProjectChoice.answerChosen({
        turnContext: turn.turnContext,
        replyToId: "question-card-1",
        projectName: "IRM Non-Prod",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("which presses are made again once their project is chosen", () => {
  test("its own buttons, and a Home's - never a form's submission or a record's button", () => {
    expect(MicrosoftTeamsProjectChoice.isChoiceAction("choose-project")).toBe(
      true,
    );

    for (const actionType of Object.values(MicrosoftTeamsHomeActionType)) {
      expect(MicrosoftTeamsProjectChoice.canMakeAgain(actionType)).toBe(true);
      expect(MicrosoftTeamsProjectChoice.isChoiceAction(actionType)).toBe(
        false,
      );
    }

    for (const actionType of [
      MicrosoftTeamsIncidentActionType.SubmitNewIncident,
      MicrosoftTeamsIncidentActionType.AckIncident,
      MicrosoftTeamsPageActionType.SubmitPageSomeone,
      "SubmitNewScheduledMaintenance",
      MicrosoftTeamsProjectChoiceActionType.ChooseProject,
      "",
      undefined,
    ]) {
      expect(MicrosoftTeamsProjectChoice.canMakeAgain(actionType)).toBe(false);
    }
  });
});

describe("a conversation with OneUptime AI keeps the project chosen in it", () => {
  test("the conversation is the chat, or the channel post's thread, and its person", () => {
    expect(
      MicrosoftTeamsProjectChoice.getConversationOf(message("why?")),
    ).toEqual({
      tenantId: TENANT,
      conversationId: PERSONAL_CHAT,
      aadObjectId: DEANE_AAD,
    });
    expect(
      MicrosoftTeamsProjectChoice.getConversationOf(
        message("why?", { where: "channel" }),
      ),
    ).toEqual({
      tenantId: TENANT,
      conversationId: CHANNEL_THREAD,
      aadObjectId: DEANE_AAD,
    });

    const nobody: JSONObject = message("why?");
    nobody["from"] = { id: "29:x" };

    expect(MicrosoftTeamsProjectChoice.getConversationOf(nobody)).toBeNull();
  });

  test("remembered for an hour, for that conversation and that person alone", async () => {
    await MicrosoftTeamsProjectChoice.rememberConversationProject({
      activity: message("which monitors are down?"),
      projectId: NONPRD,
    });

    expect(
      (
        await MicrosoftTeamsProjectChoice.getConversationProject(
          message("and why?"),
        )
      )?.toString(),
    ).toBe(NONPRD.toString());

    // Another conversation, or another person in it: nothing chosen there.
    expect(
      await MicrosoftTeamsProjectChoice.getConversationProject(
        message("and why?", { where: "channel" }),
      ),
    ).toBeNull();
    expect(
      await MicrosoftTeamsProjectChoice.getConversationProject(
        message("and why?", { from: NITIN }),
      ),
    ).toBeNull();

    const [key, entry] = Array.from(cache().store.entries())[0]!;

    expect(key.startsWith("microsoft-teams-project-choice-conversation-")).toBe(
      true,
    );

    for (const named of [TENANT, PERSONAL_CHAT, DEANE_AAD]) {
      expect(key).not.toContain(named);
    }

    expect(MicrosoftTeamsProjectChoice.CONVERSATION_REMEMBERED_FOR_SECONDS).toBe(
      60 * 60,
    );
    expect(entry.expiresAt - Date.now()).toBeGreaterThan(59 * 60 * 1000);
    expect(entry.expiresAt - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);

    // An hour on, it is gone: a new question is asked again.
    entry.expiresAt = Date.now() - 1;

    expect(
      await MicrosoftTeamsProjectChoice.getConversationProject(
        message("and now?"),
      ),
    ).toBeNull();
  });

  test("the project of a follow-up: the connection remembered, while its person is still a member there", async () => {
    await MicrosoftTeamsProjectChoice.rememberConversationProject({
      activity: message("which monitors are down?"),
      projectId: NONPRD,
    });

    const found: WorkspaceProjectAuthToken | null =
      await MicrosoftTeamsProjectChoice.findConversationProject({
        activity: message("and why?"),
        resolution: resolution([PLATFORM, NONPRD]),
      });

    expect(found?.projectId?.toString()).toBe(NONPRD.toString());

    // No longer a member there: asked again.
    expect(
      await MicrosoftTeamsProjectChoice.findConversationProject({
        activity: message("and why?"),
        resolution: resolution([PLATFORM, OTHER]),
      }),
    ).toBeNull();

    // Told apart already, or not asked at all: nothing remembered is read.
    expect(
      await MicrosoftTeamsProjectChoice.findConversationProject({
        activity: message("and why?"),
        resolution: resolution([PLATFORM, NONPRD], false),
      }),
    ).toBeNull();
    expect(
      await MicrosoftTeamsProjectChoice.findConversationProject({
        activity: message("and why?"),
        resolution: undefined,
      }),
    ).toBeNull();

    // Another conversation: nothing chosen there.
    expect(
      await MicrosoftTeamsProjectChoice.findConversationProject({
        activity: message("and why?", { where: "channel" }),
        resolution: resolution([PLATFORM, NONPRD]),
      }),
    ).toBeNull();
  });

  test("a project the organization is no longer connected to is none", async () => {
    const gone: ObjectID = ObjectID.generate();

    await MicrosoftTeamsProjectChoice.rememberConversationProject({
      activity: message("which monitors are down?"),
      projectId: gone,
    });

    expect(
      await MicrosoftTeamsProjectChoice.findConversationProject({
        activity: message("and why?"),
        resolution: resolution([PLATFORM, NONPRD, gone]),
      }),
    ).toBeNull();
  });

  test("a cache that cannot be read or written remembers nothing, and nothing throws", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      MicrosoftTeamsProjectChoice.rememberConversationProject({
        activity: message("which monitors are down?"),
        projectId: NONPRD,
      }),
    ).resolves.toBeUndefined();
    expect(cache().store.size).toBe(0);

    await MicrosoftTeamsProjectChoice.rememberConversationProject({
      activity: message("which monitors are down?"),
      projectId: NONPRD,
    });

    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValueOnce(new Error("connection refused"));

    expect(
      await MicrosoftTeamsProjectChoice.findConversationProject({
        activity: message("and why?"),
        resolution: resolution([PLATFORM, NONPRD]),
      }),
    ).toBeNull();
  });

  test("an activity that names no conversation or person remembers nothing", async () => {
    const nobody: JSONObject = message("why?");
    nobody["from"] = { id: "29:x" };

    await MicrosoftTeamsProjectChoice.rememberConversationProject({
      activity: nobody,
      projectId: NONPRD,
    });

    expect(cache().store.size).toBe(0);
    expect(
      await MicrosoftTeamsProjectChoice.getConversationProject(nobody),
    ).toBeNull();
  });

  test("kept apart from the questions themselves: neither is taken for the other", async () => {
    const conversation: MicrosoftTeamsConversationOfPerson | null =
      MicrosoftTeamsProjectChoice.getConversationOf(message("why?"));

    expect(conversation).not.toBeNull();

    await askDeane(message("why?"), MicrosoftTeamsProjectChoiceKind.Message, true);
    await MicrosoftTeamsProjectChoice.rememberConversationProject({
      activity: message("why?"),
      projectId: NONPRD,
    });

    expect(cache().store.size).toBe(2);
    expect(
      Array.from(cache().store.keys()).filter((key: string): boolean => {
        return key.startsWith("microsoft-teams-project-choice-conversation-");
      }),
    ).toHaveLength(1);
  });
});
