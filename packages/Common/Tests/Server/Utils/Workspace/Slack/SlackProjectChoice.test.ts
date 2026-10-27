import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackActionAnswer, {
  SlackAnswerDelivery,
  SlackAnswerPlace,
} from "../../../../../Server/Utils/Workspace/Slack/Actions/Answer";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import {
  SlackMessage,
  SlackMessageKind,
} from "../../../../../Server/Utils/Workspace/Slack/SlackAiConversations";
import SlackProjectChoice, {
  SlackHomeOfPerson,
  SlackProjectChoiceKind,
  SlackProjectChoicePress,
  SlackProjectChoiceRecord,
  SlackProjectChoiceRequest,
} from "../../../../../Server/Utils/Workspace/Slack/SlackProjectChoice";
import WorkspaceProjectResolver, {
  WorkspaceProjectChoice,
  WorkspaceProjectEvidence,
  WorkspaceProjectResolution,
} from "../../../../../Server/Utils/Workspace/WorkspaceProjectResolution";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * "WHICH PROJECT IS THIS FOR?"
 *
 * What somebody in several of a shared Slack workspace's projects is asked
 * when nothing their request carries tells which one it is about: a button
 * for each project, and the request recorded behind them, to be made again
 * in the one they choose - by them, once, for a project offered.
 */

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

const TEAM_ID: string = "T0AVEPOINT";
const DEANE: string = "U0DEANE";
const NITIN: string = "U0NITIN";

const PLATFORM: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000001");
const NONPRD: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000002");
const OTHER: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000003");

const CHOICES: Array<WorkspaceProjectChoice> = [
  { projectId: PLATFORM, name: "IRM Platform" },
  { projectId: NONPRD, name: "IRM Non-Prod" },
];

const RESPONSE_URL: string =
  "https://hooks.slack.com/commands/T0AVEPOINT/1760000000/cmdDef456";

const PLACE: SlackAnswerPlace = {
  projectAuthToken: "xoxb-platform",
  slackUserId: DEANE,
  slackChannelId: "C0GENERAL",
  responseUrl: RESPONSE_URL,
};

const COMMAND: SlackProjectChoiceRequest = {
  kind: SlackProjectChoiceKind.Press,
  payload: {
    command: "/oneuptime",
    text: "oncall",
    team_id: TEAM_ID,
    user_id: DEANE,
    channel_id: "C0GENERAL",
    response_url: RESPONSE_URL,
  },
};

interface InMemoryCache {
  store: Map<string, { value: string; expiresAt: number }>;
}

function cache(): InMemoryCache {
  return GlobalCache as unknown as InMemoryCache;
}

function resolution(
  memberProjectIds: Array<ObjectID>,
): WorkspaceProjectResolution {
  return {
    projectAuth: null,
    connections: [],
    isAmbiguous: true,
    decidedBy: null as WorkspaceProjectEvidence | null,
    memberProjectIds: memberProjectIds,
    isPersonConnected: memberProjectIds.length > 0,
  };
}

// What the person was asked, as answerWithBlocks was handed it.
interface Asked {
  place: SlackAnswerPlace;
  messageBlocks: Array<WorkspaceMessageBlock>;
  text: string;
}

function buttonsOf(
  messageBlocks: Array<WorkspaceMessageBlock>,
): Array<WorkspaceMessagePayloadButton> {
  return (
    messageBlocks.find((block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadButtons";
    }) as WorkspacePayloadButtons
  ).buttons;
}

let asked: Array<Asked>;

beforeEach(() => {
  asked = [];
  cache().store.clear();

  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
  jest
    .spyOn(WorkspaceProjectResolver, "getProjectChoices")
    .mockImplementation(async (projectIds: Array<ObjectID>) => {
      return projectIds.map((projectId: ObjectID): WorkspaceProjectChoice => {
        return CHOICES.find((choice: WorkspaceProjectChoice): boolean => {
          return choice.projectId.toString() === projectId.toString();
        })!;
      });
    });
  jest
    .spyOn(SlackActionAnswer, "answerWithBlocks")
    .mockImplementation(async (data: Asked) => {
      asked.push(data);
      return SlackAnswerDelivery.ResponseUrl;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Asks Deane which project, and gives back what the buttons carry.
async function askDeane(
  request: SlackProjectChoiceRequest = COMMAND,
): Promise<Array<SlackProjectChoicePress>> {
  const delivery: SlackAnswerDelivery | null = await SlackProjectChoice.offer({
    place: PLACE,
    teamId: TEAM_ID,
    slackUserId: DEANE,
    resolution: resolution([PLATFORM, NONPRD]),
    request: request,
  });

  expect(delivery).toBe(SlackAnswerDelivery.ResponseUrl);

  return buttonsOf(asked[asked.length - 1]!.messageBlocks).map(
    (button: WorkspaceMessagePayloadButton): SlackProjectChoicePress => {
      return SlackProjectChoice.readChoice(button.value)!;
    },
  );
}

describe("the buttons' ids and values", () => {
  test("an action id is the choice's, with or without its place", () => {
    expect(SlackProjectChoice.isChoiceActionId("ChooseProject")).toBe(true);
    expect(SlackProjectChoice.isChoiceActionId("ChooseProject:0")).toBe(true);
    expect(SlackProjectChoice.isChoiceActionId("ChooseProject:24")).toBe(true);
  });

  test("anything else is not", () => {
    for (const actionId of [
      "ChooseProjectX",
      "chooseproject:0",
      "AcknowledgeIncident",
      "",
      undefined,
      null,
      7,
      {},
    ]) {
      expect(SlackProjectChoice.isChoiceActionId(actionId)).toBe(false);
    }
  });

  test("a value names its project and a token", () => {
    const token: string = "A".repeat(43);

    expect(
      SlackProjectChoice.readChoice(`${NONPRD.toString()}:${token}`),
    ).toEqual({ projectId: NONPRD, token: token });
  });

  test("a value that is not one names nothing", () => {
    const token: string = "b".repeat(43);

    for (const value of [
      undefined,
      null,
      42,
      "",
      token,
      NONPRD.toString(),
      `${NONPRD.toString()}:`,
      `not-a-project:${token}`,
      `${NONPRD.toString()}:${"b".repeat(42)}`,
      `${NONPRD.toString()}:${"b".repeat(44)}`,
      `${NONPRD.toString()}:${"b".repeat(42)}=`,
      `${NONPRD.toString()}:${"b".repeat(21)}:${"b".repeat(21)}`,
      `${NONPRD.toString()}:${"b".repeat(42)}/`,
    ]) {
      expect(SlackProjectChoice.readChoice(value)).toBeNull();
    }
  });
});

describe("which presses are made again", () => {
  test("a command, a shortcut or a Home button that asks for a form, an incident, who is on call or a page", () => {
    for (const actionType of SlackProjectChoice.PRESSES_MADE_AGAIN) {
      for (const payloadType of [undefined, "shortcut", "block_actions"]) {
        expect(
          SlackProjectChoice.canMakeAgain({
            actionType: actionType,
            payloadType: payloadType,
            payload: {},
          }),
        ).toBe(true);
      }
    }

    expect(SlackProjectChoice.PRESSES_MADE_AGAIN).toEqual([
      SlackActionType.NewIncident,
      SlackActionType.ShowIncident,
      SlackActionType.NewScheduledMaintenance,
      SlackActionType.ShowOnCall,
      SlackActionType.PageSomeone,
    ]);
  });

  test("never a form's submission: its fields were filled in for one project", () => {
    expect(
      SlackProjectChoice.canMakeAgain({
        actionType: SlackActionType.NewIncident,
        payloadType: "view_submission",
        payload: {},
      }),
    ).toBe(false);
  });

  test("never a press that names a record, or none, or one with nothing to read again", () => {
    expect(
      SlackProjectChoice.canMakeAgain({
        actionType: SlackActionType.AcknowledgeIncident,
        payloadType: "block_actions",
        payload: {},
      }),
    ).toBe(false);
    expect(
      SlackProjectChoice.canMakeAgain({
        actionType: undefined,
        payloadType: undefined,
        payload: {},
      }),
    ).toBe(false);
    expect(
      SlackProjectChoice.canMakeAgain({
        actionType: SlackActionType.ShowOnCall,
        payloadType: undefined,
        payload: undefined,
      }),
    ).toBe(false);
  });
});

describe("what of a press is kept to read it again", () => {
  test("a slash command: who, where, the command, its text and where to answer - not its token or trigger", () => {
    expect(
      SlackProjectChoice.getPressPayload({
        token: "verification-token",
        team_id: TEAM_ID,
        team_domain: "avepoint",
        channel_id: "C0GENERAL",
        channel_name: "general",
        user_id: DEANE,
        user_name: "deane",
        command: "/oneuptime",
        text: "page @nitin the database is down",
        api_app_id: "A0IRM",
        response_url: RESPONSE_URL,
        trigger_id: "1760000000.trigger",
      }),
    ).toEqual({
      team_id: TEAM_ID,
      channel_id: "C0GENERAL",
      channel_name: "general",
      user_id: DEANE,
      user_name: "deane",
      command: "/oneuptime",
      text: "page @nitin the database is down",
      response_url: RESPONSE_URL,
    });
  });

  test("a shortcut: its kind, its callback, who and in which workspace", () => {
    expect(
      SlackProjectChoice.getPressPayload({
        type: "shortcut",
        token: "verification-token",
        action_ts: "1760000001.000300",
        team: { id: TEAM_ID, domain: "avepoint" },
        user: { id: DEANE, username: "deane", team_id: TEAM_ID },
        is_enterprise_install: false,
        callback_id: "/incident",
        trigger_id: "1760000000.trigger",
      }),
    ).toEqual({
      type: "shortcut",
      team: { id: TEAM_ID },
      user: { id: DEANE, username: "deane" },
      callback_id: "/incident",
    });
  });

  test("a button: its action and value, the menu item chosen, where - never the message's or the view's blocks", () => {
    expect(
      SlackProjectChoice.getPressPayload({
        type: "block_actions",
        user: { id: DEANE, username: "deane", name: "deane", team_id: TEAM_ID },
        team: { id: TEAM_ID },
        channel: { id: "C0GENERAL", name: "general" },
        container: {
          type: "message",
          is_ephemeral: true,
          thread_ts: "1760000000.000100",
          message_ts: "1760000000.000200",
        },
        message: {
          ts: "1760000000.000200",
          thread_ts: "1760000000.000100",
          blocks: [{ type: "section" }],
          text: "a message",
        },
        view: {
          id: "V0HOME",
          type: "home",
          callback_id: "",
          private_metadata: '{"oneuptime":1}',
          blocks: [{ type: "section" }],
          state: { values: {} },
        },
        response_url: RESPONSE_URL,
        actions: [
          {
            type: "button",
            action_id: "ShowOnCall",
            value: "",
            block_id: "home-buttons",
            text: { type: "plain_text", text: "Who's on call" },
          },
          {
            type: "overflow",
            action_id: "MoreActions",
            selected_option: {
              value: "ViewEditIncidentCustomFields:x",
              text: { type: "plain_text", text: "Edit" },
            },
          },
          "not an action",
          null,
        ],
      }),
    ).toEqual({
      type: "block_actions",
      user: { id: DEANE, username: "deane", name: "deane" },
      team: { id: TEAM_ID },
      channel: { id: "C0GENERAL", name: "general" },
      container: { is_ephemeral: true, thread_ts: "1760000000.000100" },
      message: { ts: "1760000000.000200", thread_ts: "1760000000.000100" },
      view: {
        type: "home",
        callback_id: "",
        private_metadata: '{"oneuptime":1}',
      },
      response_url: RESPONSE_URL,
      actions: [
        { action_id: "ShowOnCall", value: "" },
        {
          action_id: "MoreActions",
          selected_option: { value: "ViewEditIncidentCustomFields:x" },
        },
      ],
    });
  });

  test("fields of another shape are left behind", () => {
    expect(
      SlackProjectChoice.getPressPayload({
        command: 42 as unknown as string,
        text: { nested: true } as unknown as string,
        user: "U0DEANE" as unknown as JSONObject,
        actions: "ShowOnCall" as unknown as JSONObject,
      }),
    ).toEqual({});
  });
});

describe("the question", () => {
  test("asks which project, with a button named for each, in the order given", () => {
    const question: {
      messageBlocks: Array<WorkspaceMessageBlock>;
      text: string;
    } = SlackProjectChoice.getQuestion({
      token: "t".repeat(43),
      choices: CHOICES,
    });

    expect((question.messageBlocks[0] as WorkspacePayloadMarkdown).text).toBe(
      "**Which project is this for?** This Slack workspace is connected to more than one OneUptime project, and OneUptime can't tell which one you mean here.",
    );

    const buttons: Array<WorkspaceMessagePayloadButton> = buttonsOf(
      question.messageBlocks,
    );

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton): string => {
        return button.title;
      }),
    ).toEqual(["IRM Platform", "IRM Non-Prod"]);
    expect(
      buttons.map((button: WorkspaceMessagePayloadButton): string => {
        return button.value;
      }),
    ).toEqual([
      `${PLATFORM.toString()}:${"t".repeat(43)}`,
      `${NONPRD.toString()}:${"t".repeat(43)}`,
    ]);
    // Slack takes one action id once in a block.
    expect(
      buttons.map((button: WorkspaceMessagePayloadButton): string => {
        return button.actionId!;
      }),
    ).toEqual(["ChooseProject:0", "ChooseProject:1"]);
    expect(
      buttons.every((button: WorkspaceMessagePayloadButton): boolean => {
        return (
          SlackProjectChoice.isChoiceActionId(button.actionId) && !button.url
        );
      }),
    ).toBe(true);

    expect(question.text).toBe(
      "Which project is this for: IRM Platform or IRM Non-Prod? This Slack workspace is connected to more than one OneUptime project.",
    );
  });

  test("three projects are listed with commas, and the last with 'or'", () => {
    expect(
      SlackProjectChoice.getQuestion({
        token: "t".repeat(43),
        choices: [...CHOICES, { projectId: OTHER, name: "IRM Sandbox" }],
      }).text,
    ).toContain("IRM Platform, IRM Non-Prod or IRM Sandbox?");
  });

  test("a long name is cut to what a Slack button holds", () => {
    const longName: string = "Production ".repeat(10).trim();

    const title: string = buttonsOf(
      SlackProjectChoice.getQuestion({
        token: "t".repeat(43),
        choices: [
          { projectId: PLATFORM, name: longName },
          { projectId: NONPRD, name: "IRM Non-Prod" },
        ],
      }).messageBlocks,
    )[0]!.title;

    expect(title).toHaveLength(75);
    expect(title.endsWith("…")).toBe(true);
    expect(longName.startsWith(title.slice(0, -1))).toBe(true);
  });

  test("the product's own name, on a renamed installation", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    expect(
      (
        SlackProjectChoice.getQuestion({
          token: "t".repeat(43),
          choices: CHOICES,
        }).messageBlocks[0] as WorkspacePayloadMarkdown
      ).text,
    ).toContain(
      "connected to more than one Acme Status project, and Acme Status can't tell",
    );
  });
});

describe("asking", () => {
  test("asks where the request was made, and records it behind the buttons", async () => {
    const presses: Array<SlackProjectChoicePress> = await askDeane();

    expect(asked).toHaveLength(1);
    expect(asked[0]!.place).toEqual(PLACE);
    expect(
      presses.map((press: SlackProjectChoicePress): string => {
        return press.projectId.toString();
      }),
    ).toEqual([PLATFORM.toString(), NONPRD.toString()]);

    // One token behind every button, and only its hash is a key.
    expect(new Set(presses.map(tokenOfPress)).size).toBe(1);
    expect(cache().store.size).toBe(1);

    const [key, entry] = Array.from(cache().store.entries())[0]!;

    expect(key).toMatch(/^slack-project-choice-[0-9a-f]{64}$/);
    expect(key).not.toContain(presses[0]!.token);
    expect(entry.value).not.toContain(presses[0]!.token);
    // Thirty minutes, as long as Slack takes answers at the response_url.
    expect(entry.expiresAt - Date.now()).toBeGreaterThan(29 * 60 * 1000);
    expect(entry.expiresAt - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  test("each question has its own token", async () => {
    const first: Array<SlackProjectChoicePress> = await askDeane();
    const second: Array<SlackProjectChoicePress> = await askDeane();

    expect(first[0]!.token).not.toBe(second[0]!.token);
    expect(cache().store.size).toBe(2);
  });

  test("not asked of somebody in fewer than two of the projects", async () => {
    for (const memberProjectIds of [[], [NONPRD]]) {
      expect(
        await SlackProjectChoice.offer({
          place: PLACE,
          teamId: TEAM_ID,
          slackUserId: DEANE,
          resolution: resolution(memberProjectIds),
          request: COMMAND,
        }),
      ).toBeNull();
    }

    expect(asked).toEqual([]);
    expect(cache().store.size).toBe(0);
  });

  test("not asked of somebody in more projects than a row of buttons holds", async () => {
    const many: Array<ObjectID> = Array.from(
      { length: SlackProjectChoice.MAX_CHOICES + 1 },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );

    expect(
      await SlackProjectChoice.offer({
        place: PLACE,
        teamId: TEAM_ID,
        slackUserId: DEANE,
        resolution: resolution(many),
        request: COMMAND,
      }),
    ).toBeNull();
    expect(asked).toEqual([]);
  });

  test("as many as a row holds are asked", async () => {
    const many: Array<ObjectID> = Array.from(
      { length: SlackProjectChoice.MAX_CHOICES },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );

    jest
      .spyOn(WorkspaceProjectResolver, "getProjectChoices")
      .mockImplementation(async (projectIds: Array<ObjectID>) => {
        return projectIds.map(
          (projectId: ObjectID, index: number): WorkspaceProjectChoice => {
            return { projectId: projectId, name: `Project ${index}` };
          },
        );
      });

    expect(
      await SlackProjectChoice.offer({
        place: PLACE,
        teamId: TEAM_ID,
        slackUserId: DEANE,
        resolution: resolution(many),
        request: COMMAND,
      }),
    ).toBe(SlackAnswerDelivery.ResponseUrl);
    expect(buttonsOf(asked[0]!.messageBlocks)).toHaveLength(25);
  });

  test("not asked when a project cannot be named: every button is named", async () => {
    jest
      .spyOn(WorkspaceProjectResolver, "getProjectChoices")
      .mockResolvedValue(null);

    expect(
      await SlackProjectChoice.offer({
        place: PLACE,
        teamId: TEAM_ID,
        slackUserId: DEANE,
        resolution: resolution([PLATFORM, NONPRD]),
        request: COMMAND,
      }),
    ).toBeNull();
    expect(asked).toEqual([]);
    expect(cache().store.size).toBe(0);
  });

  test("not asked when the request cannot be recorded: the cache is down", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValueOnce(new Error("connection refused"));

    expect(
      await SlackProjectChoice.offer({
        place: PLACE,
        teamId: TEAM_ID,
        slackUserId: DEANE,
        resolution: resolution([PLATFORM, NONPRD]),
        request: COMMAND,
      }),
    ).toBeNull();
    expect(asked).toEqual([]);
  });

  test("not asked without the workspace or the person", async () => {
    for (const who of [
      { teamId: undefined, slackUserId: DEANE },
      { teamId: TEAM_ID, slackUserId: undefined },
      { teamId: "", slackUserId: DEANE },
    ]) {
      expect(
        await SlackProjectChoice.offer({
          place: PLACE,
          ...who,
          resolution: resolution([PLATFORM, NONPRD]),
          request: COMMAND,
        }),
      ).toBeNull();
    }

    expect(asked).toEqual([]);
  });
});

function tokenOfPress(press: SlackProjectChoicePress): string {
  return press.token;
}

describe("choosing", () => {
  test("the person who asked, choosing a project offered, spends the request: it comes back whole", async () => {
    const presses: Array<SlackProjectChoicePress> = await askDeane();

    const record: SlackProjectChoiceRecord | null =
      await SlackProjectChoice.take({
        press: presses[1]!,
        teamId: TEAM_ID,
        slackUserId: DEANE,
      });

    expect(record).toEqual({
      teamId: TEAM_ID,
      slackUserId: DEANE,
      choices: CHOICES,
      request: COMMAND,
    });
    expect(
      SlackProjectChoice.getChoice(record!, presses[1]!.projectId),
    ).toEqual(CHOICES[1]);
    expect(cache().store.size).toBe(0);
  });

  test("once: the other button, or the same one again, finds nothing", async () => {
    const presses: Array<SlackProjectChoicePress> = await askDeane();

    expect(
      await SlackProjectChoice.take({
        press: presses[0]!,
        teamId: TEAM_ID,
        slackUserId: DEANE,
      }),
    ).not.toBeNull();

    for (const press of presses) {
      expect(
        await SlackProjectChoice.take({
          press: press,
          teamId: TEAM_ID,
          slackUserId: DEANE,
        }),
      ).toBeNull();
    }
  });

  test("somebody else's press spends nothing: the person who asked can still choose", async () => {
    const presses: Array<SlackProjectChoicePress> = await askDeane();

    expect(
      await SlackProjectChoice.take({
        press: presses[1]!,
        teamId: TEAM_ID,
        slackUserId: NITIN,
      }),
    ).toBeNull();
    expect(
      await SlackProjectChoice.take({
        press: presses[1]!,
        teamId: "T0SOMEONEELSE",
        slackUserId: DEANE,
      }),
    ).toBeNull();
    expect(
      await SlackProjectChoice.take({
        press: presses[1]!,
        teamId: undefined,
        slackUserId: undefined,
      }),
    ).toBeNull();

    expect(cache().store.size).toBe(1);
    expect(
      await SlackProjectChoice.take({
        press: presses[1]!,
        teamId: TEAM_ID,
        slackUserId: DEANE,
      }),
    ).not.toBeNull();
  });

  test("a project that was not offered spends nothing", async () => {
    const presses: Array<SlackProjectChoicePress> = await askDeane();

    expect(
      await SlackProjectChoice.take({
        press: { projectId: OTHER, token: presses[0]!.token },
        teamId: TEAM_ID,
        slackUserId: DEANE,
      }),
    ).toBeNull();
    expect(cache().store.size).toBe(1);
  });

  test("a token never handed out finds nothing", async () => {
    await askDeane();

    expect(
      await SlackProjectChoice.take({
        press: { projectId: NONPRD, token: "x".repeat(43) },
        teamId: TEAM_ID,
        slackUserId: DEANE,
      }),
    ).toBeNull();
  });

  test("after thirty minutes the request is gone", async () => {
    const presses: Array<SlackProjectChoicePress> = await askDeane();

    for (const entry of cache().store.values()) {
      entry.expiresAt = Date.now() - 1;
    }

    expect(
      await SlackProjectChoice.take({
        press: presses[0]!,
        teamId: TEAM_ID,
        slackUserId: DEANE,
      }),
    ).toBeNull();
  });

  test("a stored request that is not one finds nothing", async () => {
    const presses: Array<SlackProjectChoicePress> = await askDeane();
    const key: string = Array.from(cache().store.keys())[0]!;

    for (const value of [
      "not json",
      "[]",
      "{}",
      JSON.stringify({
        teamId: TEAM_ID,
        slackUserId: DEANE,
        choices: [],
        request: { kind: "Press", payload: {} },
      }),
      JSON.stringify({
        teamId: TEAM_ID,
        slackUserId: DEANE,
        choices: [{ projectId: PLATFORM.toString(), name: "IRM Platform" }],
        request: { kind: "Unknown" },
      }),
      JSON.stringify({
        teamId: TEAM_ID,
        slackUserId: DEANE,
        choices: [{ projectId: "not-a-project", name: "IRM Platform" }],
        request: { kind: "Press", payload: {} },
      }),
      JSON.stringify({
        teamId: TEAM_ID,
        slackUserId: DEANE,
        choices: [{ projectId: PLATFORM.toString(), name: "" }],
        request: { kind: "Press", payload: {} },
      }),
      JSON.stringify({
        teamId: TEAM_ID,
        slackUserId: DEANE,
        choices: [{ projectId: PLATFORM.toString(), name: "IRM Platform" }],
        request: { kind: "Question", question: { question: "why?" } },
      }),
      JSON.stringify({
        teamId: TEAM_ID,
        slackUserId: DEANE,
        choices: [{ projectId: PLATFORM.toString(), name: "IRM Platform" }],
        request: {
          kind: "Message",
          message: { kind: "Shouted", teamId: TEAM_ID },
        },
      }),
    ]) {
      cache().store.set(key, {
        value: value,
        expiresAt: Date.now() + 60000,
      });

      expect(
        await SlackProjectChoice.take({
          press: presses[0]!,
          teamId: TEAM_ID,
          slackUserId: DEANE,
        }),
      ).toBeNull();
    }
  });

  test("a cache that cannot be read finds nothing, and does not throw", async () => {
    const presses: Array<SlackProjectChoicePress> = await askDeane();

    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValueOnce(new Error("connection refused"));

    expect(
      await SlackProjectChoice.take({
        press: presses[0]!,
        teamId: TEAM_ID,
        slackUserId: DEANE,
      }),
    ).toBeNull();
  });

  test("a question and a message for OneUptime AI come back as they were asked", async () => {
    const question: SlackProjectChoiceRequest = {
      kind: SlackProjectChoiceKind.Question,
      question: {
        question: "which monitors are down?",
        teamId: TEAM_ID,
        slackUserId: DEANE,
        channelId: "C0GENERAL",
        responseUrl: RESPONSE_URL,
        command: "/oneuptime",
      },
    };

    const message: SlackMessage = {
      kind: SlackMessageKind.DirectMessage,
      teamId: TEAM_ID,
      channelId: "D0DEANE",
      userId: DEANE,
      text: "is checkout healthy? *really*",
      ts: "1760000000.000500",
      threadTs: "1760000000.000400",
    };

    for (const request of [
      question,
      { kind: SlackProjectChoiceKind.Message, message: message },
    ] as Array<SlackProjectChoiceRequest>) {
      const presses: Array<SlackProjectChoicePress> = await askDeane(request);

      expect(
        (
          await SlackProjectChoice.take({
            press: presses[0]!,
            teamId: TEAM_ID,
            slackUserId: DEANE,
          })
        )?.request,
      ).toEqual(request);
    }
  });
});

describe("what the question becomes", () => {
  let replaced: Array<JSONObject>;

  beforeEach(() => {
    replaced = [];

    jest
      .spyOn(SlackUtil, "replaceMessageAtResponseUrl")
      .mockImplementation((async (data: JSONObject) => {
        replaced.push(data);
      }) as never);
  });

  test("once chosen: going ahead in the project, in its place", async () => {
    await SlackProjectChoice.answerChosen({
      responseUrl: "https://hooks.slack.com/actions/T0AVEPOINT/1/choice",
      projectName: "IRM Non-Prod",
    });

    expect(replaced).toEqual([
      {
        responseUrl: "https://hooks.slack.com/actions/T0AVEPOINT/1/choice",
        messageBlocks: [
          {
            _type: "WorkspacePayloadMarkdown",
            text: "Going ahead in **IRM Non-Prod**.",
          },
        ],
        text: "Going ahead in IRM Non-Prod.",
      },
    ]);
  });

  test("a project's name is text in it, never Markdown", async () => {
    await SlackProjectChoice.answerChosen({
      responseUrl: "https://hooks.slack.com/actions/T0AVEPOINT/1/choice",
      projectName: "*Prod* [team](https://evil.test)",
    });

    const text: string = (
      (replaced[0]!["messageBlocks"] as Array<JSONObject>)[0] as JSONObject
    )["text"] as string;

    expect(text).not.toContain("[team](https://evil.test)");
    expect(text).not.toContain("**Prod*");
  });

  test("nowhere to put it, or Slack refusing it, is no failure", async () => {
    await SlackProjectChoice.answerChosen({
      responseUrl: undefined,
      projectName: "IRM Non-Prod",
    });
    expect(replaced).toEqual([]);

    jest
      .spyOn(SlackUtil, "replaceMessageAtResponseUrl")
      .mockRejectedValueOnce(new Error("expired_url"));

    await expect(
      SlackProjectChoice.answerChosen({
        responseUrl: "https://hooks.slack.com/actions/T0AVEPOINT/1/choice",
        projectName: "IRM Non-Prod",
      }),
    ).resolves.toBeUndefined();
  });

  test("a press whose request is gone: told so, in the question's place", async () => {
    await SlackProjectChoice.answerGone({
      responseUrl: "https://hooks.slack.com/actions/T0AVEPOINT/1/choice",
      projectAuthToken: "xoxb-platform",
      triggerId: "1760000000.trigger",
      viewId: undefined,
    });

    expect(replaced).toHaveLength(1);
    expect(replaced[0]!["text"]).toBe(
      "This choice has expired, or was already made. Please try again.",
    );
  });

  test("a press whose request is gone, in a modal: told so in the modal", async () => {
    const shown: Array<JSONObject> = [];

    jest.spyOn(SlackUtil, "showMessageInModal").mockImplementation((async (
      data: JSONObject,
    ) => {
      shown.push(data);
    }) as never);

    await SlackProjectChoice.answerGone({
      responseUrl: undefined,
      projectAuthToken: "xoxb-platform",
      triggerId: "1760000000.trigger",
      viewId: "V0CHOICE",
    });

    expect(replaced).toEqual([]);
    expect(shown).toHaveLength(1);
    expect(shown[0]!["viewId"]).toBe("V0CHOICE");
    expect(shown[0]!["authToken"]).toBe("xoxb-platform");
    expect(JSON.stringify(shown[0]!["messageBlocks"])).toContain(
      "This choice has expired, or was already made.",
    );

    jest
      .spyOn(SlackUtil, "showMessageInModal")
      .mockRejectedValueOnce(new Error("not_found"));

    await expect(
      SlackProjectChoice.answerGone({
        responseUrl: undefined,
        projectAuthToken: "xoxb-platform",
        triggerId: "1760000000.trigger",
        viewId: "V0CHOICE",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("a conversation with OneUptime AI keeps its project", () => {
  const MESSAGE: SlackMessage = {
    kind: SlackMessageKind.DirectMessage,
    teamId: TEAM_ID,
    channelId: "D0DEANE",
    userId: DEANE,
    text: "is checkout healthy?",
    ts: "1760000000.000500",
  };

  test("a question at the top starts the thread it is answered in; a reply is in its thread", () => {
    expect(SlackProjectChoice.getConversationOf(MESSAGE)).toEqual({
      teamId: TEAM_ID,
      channelId: "D0DEANE",
      threadTs: "1760000000.000500",
      slackUserId: DEANE,
    });
    expect(
      SlackProjectChoice.getConversationOf({
        ...MESSAGE,
        ts: "1760000000.000900",
        threadTs: "1760000000.000500",
      }),
    ).toEqual(SlackProjectChoice.getConversationOf(MESSAGE));
  });

  test("remembered for the thread and its person, for as long as the conversation stays open", async () => {
    const conversation: ReturnType<
      typeof SlackProjectChoice.getConversationOf
    > = SlackProjectChoice.getConversationOf(MESSAGE);

    expect(
      await SlackProjectChoice.getConversationProject(conversation),
    ).toBeNull();

    await SlackProjectChoice.rememberConversationProject({
      conversation: conversation,
      projectId: NONPRD,
    });

    expect(
      (
        await SlackProjectChoice.getConversationProject(conversation)
      )?.toString(),
    ).toBe(NONPRD.toString());

    // Another thread, or another person in this one: not chosen there.
    expect(
      await SlackProjectChoice.getConversationProject({
        ...conversation,
        threadTs: "1760000000.000999",
      }),
    ).toBeNull();
    expect(
      await SlackProjectChoice.getConversationProject({
        ...conversation,
        slackUserId: NITIN,
      }),
    ).toBeNull();

    const entry: { value: string; expiresAt: number } = Array.from(
      cache().store.values(),
    )[0]!;

    expect(entry.expiresAt - Date.now()).toBeGreaterThan(
      6 * 24 * 60 * 60 * 1000,
    );
  });

  test("a cache that cannot be read or written remembers nothing, and does not throw", async () => {
    const conversation: ReturnType<
      typeof SlackProjectChoice.getConversationOf
    > = SlackProjectChoice.getConversationOf(MESSAGE);

    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      SlackProjectChoice.rememberConversationProject({
        conversation: conversation,
        projectId: NONPRD,
      }),
    ).resolves.toBeUndefined();

    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValueOnce(new Error("connection refused"));

    expect(
      await SlackProjectChoice.getConversationProject(conversation),
    ).toBeNull();
  });

  test("what is remembered that is not a project is none", async () => {
    const conversation: ReturnType<
      typeof SlackProjectChoice.getConversationOf
    > = SlackProjectChoice.getConversationOf(MESSAGE);

    await SlackProjectChoice.rememberConversationProject({
      conversation: conversation,
      projectId: NONPRD,
    });

    for (const entry of cache().store.values()) {
      entry.value = "not-a-project";
    }

    expect(
      await SlackProjectChoice.getConversationProject(conversation),
    ).toBeNull();
  });
});

/*
 * The project somebody chose for the app's Home tab with its Switch project
 * menu (SlackHome): kept for each person in each workspace, so their later
 * openings show it. Whether they may still see it is the Home's to read,
 * every time - what is kept here only says which they chose.
 */
describe("the project somebody chose for their Home", () => {
  const DEANE_HOME: SlackHomeOfPerson = { teamId: TEAM_ID, slackUserId: DEANE };

  test("remembered for the person in the workspace: theirs alone", async () => {
    expect(await SlackProjectChoice.getHomeProject(DEANE_HOME)).toBeNull();

    await SlackProjectChoice.rememberHomeProject({
      person: DEANE_HOME,
      projectId: NONPRD,
    });

    expect(
      (await SlackProjectChoice.getHomeProject(DEANE_HOME))?.toString(),
    ).toBe(NONPRD.toString());

    // Somebody else, or the same Slack user id in another workspace: nothing chosen.
    expect(
      await SlackProjectChoice.getHomeProject({
        teamId: TEAM_ID,
        slackUserId: NITIN,
      }),
    ).toBeNull();
    expect(
      await SlackProjectChoice.getHomeProject({
        teamId: "T0ELSEWHERE",
        slackUserId: DEANE,
      }),
    ).toBeNull();
  });

  test("choosing again replaces it", async () => {
    await SlackProjectChoice.rememberHomeProject({
      person: DEANE_HOME,
      projectId: NONPRD,
    });
    await SlackProjectChoice.rememberHomeProject({
      person: DEANE_HOME,
      projectId: PLATFORM,
    });

    expect(
      (await SlackProjectChoice.getHomeProject(DEANE_HOME))?.toString(),
    ).toBe(PLATFORM.toString());
    expect(cache().store.size).toBe(1);
  });

  test("kept for ninety days from when it was last kept", async () => {
    await SlackProjectChoice.rememberHomeProject({
      person: DEANE_HOME,
      projectId: NONPRD,
    });

    const entry: { value: string; expiresAt: number } = Array.from(
      cache().store.values(),
    )[0]!;
    const ninetyDays: number = 90 * 24 * 60 * 60 * 1000;

    expect(SlackProjectChoice.HOME_REMEMBERED_FOR_SECONDS).toBe(
      90 * 24 * 60 * 60,
    );
    expect(entry.expiresAt - Date.now()).toBeGreaterThan(ninetyDays - 60000);
    expect(entry.expiresAt - Date.now()).toBeLessThanOrEqual(ninetyDays);

    // Gone once that time has passed: the Home shows the first project again.
    entry.expiresAt = Date.now() - 1;

    expect(await SlackProjectChoice.getHomeProject(DEANE_HOME)).toBeNull();
  });

  test("kept under a key of its own, which names neither the workspace nor the person", async () => {
    await SlackProjectChoice.rememberHomeProject({
      person: DEANE_HOME,
      projectId: NONPRD,
    });

    const [key] = Array.from(cache().store.keys());

    expect(key!.startsWith("slack-project-choice-home-")).toBe(true);
    expect(key).not.toContain(TEAM_ID);
    expect(key).not.toContain(DEANE);
  });

  test("apart from a conversation's choice: neither is taken for the other", async () => {
    const conversation: ReturnType<
      typeof SlackProjectChoice.getConversationOf
    > = SlackProjectChoice.getConversationOf({
      kind: SlackMessageKind.DirectMessage,
      teamId: TEAM_ID,
      channelId: "D0DEANE",
      userId: DEANE,
      text: "is checkout healthy?",
      ts: "1760000000.000500",
    });

    await SlackProjectChoice.rememberConversationProject({
      conversation: conversation,
      projectId: NONPRD,
    });

    expect(await SlackProjectChoice.getHomeProject(DEANE_HOME)).toBeNull();

    await SlackProjectChoice.rememberHomeProject({
      person: DEANE_HOME,
      projectId: PLATFORM,
    });

    expect(
      (
        await SlackProjectChoice.getConversationProject(conversation)
      )?.toString(),
    ).toBe(NONPRD.toString());
    expect(
      (await SlackProjectChoice.getHomeProject(DEANE_HOME))?.toString(),
    ).toBe(PLATFORM.toString());
  });

  test("a cache that cannot be read or written remembers nothing, and does not throw", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      SlackProjectChoice.rememberHomeProject({
        person: DEANE_HOME,
        projectId: NONPRD,
      }),
    ).resolves.toBeUndefined();

    expect(cache().store.size).toBe(0);

    await SlackProjectChoice.rememberHomeProject({
      person: DEANE_HOME,
      projectId: NONPRD,
    });

    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValueOnce(new Error("connection refused"));

    expect(await SlackProjectChoice.getHomeProject(DEANE_HOME)).toBeNull();
  });

  test("what is kept that is not a project is none", async () => {
    await SlackProjectChoice.rememberHomeProject({
      person: DEANE_HOME,
      projectId: NONPRD,
    });

    for (const entry of cache().store.values()) {
      entry.value = "not-a-project";
    }

    expect(await SlackProjectChoice.getHomeProject(DEANE_HOME)).toBeNull();
  });
});
