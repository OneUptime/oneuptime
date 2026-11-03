import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "ASK IN ANOTHER PROJECT", AND FEEDBACK THAT NAMES ITS PROJECT, END TO END.
 *
 * One Microsoft 365 organization connected to several OneUptime projects,
 * and Deane, a member of two or more. A question nothing ties to a project
 * asks him which; its answer, and its follow-ups' for an hour, end with
 * "Answered in IRM Non-Prod, the project you chose for this conversation."
 * A chat has no threads, so a question asked later may have meant another
 * project: in his chat with the bot, such an answer offers "Ask in another
 * project" by the compose box - a Teams suggested action, which says those
 * words for him - and anywhere he can say them. The question is asked again
 * in his other project at once, or, with more than one other, he is asked
 * which. 👍 or 👎 on such an answer reaches the operator with the project it
 * was answered in, whoever gives it.
 *
 * Through the REAL botbuilder stack against a fake Bot Connector, with the
 * real serializer's entity model (so the AI label the answer carries is
 * what Teams receives, beside its suggested action), and the real answer
 * around the assistant: only the model, the projects' rows and memberships
 * are stubbed.
 */

jest.mock("botbuilder", () => {
  return (
    jest.requireActual("../../../Helpers/RealBotbuilder") as {
      loadRealBotbuilder: (fromFile: string) => unknown;
    }
  ).loadRealBotbuilder(__filename);
});

/*
 * The Bot Connector's mappers, from where that botbuilder loads them: what
 * MicrosoftTeamsAiAnswer lets keep an entity's properties is the model the
 * real serializer writes the answer's AI label with.
 */
jest.mock("botframework-connector/lib/connectorApi/models/mappers", () => {
  const nodeModuleBuiltin: typeof import("module") =
    typeof process.getBuiltinModule === "function"
      ? process.getBuiltinModule("module")
      : Object.getPrototypeOf(jest.requireActual("module"));

  return nodeModuleBuiltin.createRequire(__filename)(
    "botframework-connector/lib/connectorApi/models/mappers",
  );
});

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
    NotificationSlackWebhookOnAiFeedback: "https://hooks.slack.test/feedback",
  };
});

// Where the bot keeps a question's request, its conversation's project, and claims.
jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("../../API/WorkspaceOAuthTestHelpers") as Record<
        string,
        () => unknown
      >
    )["createInMemoryGlobalCache"]!(),
  };
});

import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsAiAnswer from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsAiAnswer";
import MicrosoftTeamsProjectChoice from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsProjectChoice";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceAiRefusal from "../../../../Server/Utils/Workspace/WorkspaceAiRefusal";
import WorkspaceProjectResolver from "../../../../Server/Utils/Workspace/WorkspaceProjectResolution";
import ObservabilityAssistant from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import OperatorSlackNotice from "../../../../Server/Utils/OperatorSlackNotice";
import AIService from "../../../../Server/Services/AIService";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import ProjectService from "../../../../Server/Services/ProjectService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../../Server/Utils/Logger";
import Project from "../../../../Models/DatabaseModels/Project";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  ConnectorCall,
  Delivery,
  FakeBotConnector,
  cardOf,
  deliverToBot,
  postsOf,
  startFakeBotConnector,
  submitsOf,
  textOfCard,
} from "../../../Helpers/FakeBotConnector";
import { CloudAdapter, ConfigurationBotFrameworkAuthentication } from "botbuilder";

type CachedAdapterSlot = { cachedAdapter: CloudAdapter | null };

const TENANT_ID: string = "7d4e0000-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PLATFORM: ObjectID = new ObjectID("f6000000-0000-4000-8000-000000000001");
const NONPRD: ObjectID = new ObjectID("f6000000-0000-4000-8000-000000000002");
const SANDBOX: ObjectID = new ObjectID("f6000000-0000-4000-8000-000000000003");
const DEANES_MEMBER: ObjectID = new ObjectID(
  "f6000000-0000-4000-8000-0000000000d1",
);
const NAMES: Record<string, string> = {
  [PLATFORM.toString()]: "IRM Platform",
  [NONPRD.toString()]: "IRM Non-Prod",
  [SANDBOX.toString()]: "IRM Sandbox",
};

const BOT: JSONObject = { id: "28:oneuptime-bot-app-id", name: "OneUptime" };
const DEANE: JSONObject = {
  id: "29:1deane",
  name: "Deane Barker",
  aadObjectId: "00000000-0000-4000-8000-00000000dea1",
};
const PRIYA: JSONObject = {
  id: "29:1priya",
  name: "Priya",
  aadObjectId: "00000000-0000-4000-8000-0000000000b3",
};
const PERSONAL_CONVERSATION_ID: string = "a:7d4e-deane-personal-chat";
const GROUP_CHAT_ID: string = "19:7d4e-ops-chat@thread.v2";

const AI_LABEL: JSONObject = {
  type: "https://schema.org/Message",
  "@type": "Message",
  "@context": "https://schema.org",
  additionalType: ["AIGeneratedContent"],
};
const ASK_IN_ANOTHER_PROJECT: JSONObject = {
  type: "imBack",
  title: "Ask in another project",
  value: "Ask in another project",
};

let connector: FakeBotConnector;
let activityNumber: number = 0;
let connected: Array<ObjectID>;
let memberOf: Array<ObjectID>;
let asked: Array<{ projectId: string; question: string }>;
let notices: Array<{ projectId: string | null; text: string }>;
let loggedErrors: Array<string>;

function idsOf(value: unknown): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  if (value instanceof ObjectID || typeof value === "string") {
    return [value.toString().toLowerCase()];
  }

  const parameters: JSONObject | undefined = (
    value as { objectLiteralParameters?: JSONObject }
  ).objectLiteralParameters;

  return Object.values(parameters || {})
    .flatMap((entry: unknown): Array<unknown> => {
      return Array.isArray(entry) ? entry : [entry];
    })
    .map((entry: unknown): string => {
      return String(entry).toLowerCase();
    });
}

function nextActivityId(label: string): string {
  activityNumber++;
  return `7d4e-${label}-${activityNumber}-${ObjectID.generate().toString().substring(0, 8)}`;
}

function message(
  text: string,
  options?: {
    from?: JSONObject | undefined;
    where?: "personal" | "group" | undefined;
  },
): JSONObject {
  const inGroup: boolean = options?.where === "group";

  return {
    type: "message",
    id: nextActivityId("message"),
    timestamp: "2026-11-03T09:00:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: options?.from || DEANE,
    conversation: inGroup
      ? {
          conversationType: "groupChat",
          tenantId: TENANT_ID,
          id: GROUP_CHAT_ID,
          isGroup: true,
        }
      : {
          conversationType: "personal",
          tenantId: TENANT_ID,
          id: PERSONAL_CONVERSATION_ID,
        },
    recipient: BOT,
    textFormat: "plain",
    locale: "en-US",
    text: inGroup ? `<at>OneUptime</at> ${text}` : text,
    entities: inGroup
      ? [{ type: "mention", text: "<at>OneUptime</at>", mentioned: BOT }]
      : [],
    channelData: { tenant: { id: TENANT_ID } },
  };
}

function press(
  value: JSONObject,
  replyToId: string,
  options?: {
    from?: JSONObject | undefined;
    where?: "personal" | "group" | undefined;
  },
): JSONObject {
  const pressed: JSONObject = message("", options);

  delete pressed["text"];
  pressed["entities"] = [];
  pressed["value"] = value;
  pressed["replyToId"] = replyToId;

  return pressed;
}

// 👍 or 👎 on one of the bot's messages, as Teams sends it.
function feedback(
  messageId: string,
  options?: {
    from?: JSONObject | undefined;
    where?: "personal" | "group" | undefined;
  },
): JSONObject {
  const sent: JSONObject = message("", options);

  delete sent["text"];
  sent["type"] = "invoke";
  sent["name"] = "message/submitAction";
  sent["entities"] = [];
  sent["replyToId"] = messageId;
  sent["value"] = {
    actionName: "feedback",
    actionValue: {
      reaction: "dislike",
      feedback: JSON.stringify({ feedbackText: "Wrong project." }),
    },
  };

  return sent;
}

async function deliver(activity: JSONObject): Promise<Delivery> {
  return await deliverToBot(connector, activity);
}

// The answer of a delivery: its message, not a card or typing.
function answerOf(delivery: Delivery): ConnectorCall {
  const answers: Array<ConnectorCall> = postsOf(delivery).filter(
    (call: ConnectorCall): boolean => {
      return (
        call.activity["type"] === "message" &&
        !call.activity["attachments"] &&
        Boolean(call.activity["text"])
      );
    },
  );

  expect(answers).toHaveLength(1);

  return answers[0]!;
}

function answeredIn(name: string): string {
  return `_Answered in **${name}**, the project you chose for this conversation._`;
}

// Asks, and chooses `projectName` when asked which: the answer's delivery.
async function askAndChoose(
  question: string,
  projectName: string,
  options?: { where?: "personal" | "group" | undefined },
): Promise<Delivery> {
  const asking: Delivery = await deliver(message(question, options));
  const card: ConnectorCall = postsOf(asking)[0]!;
  const choice: JSONObject | undefined = submitsOf(cardOf(card)).find(
    (submit: JSONObject): boolean => {
      return submit["title"] === projectName;
    },
  );

  expect(choice).toBeDefined();

  return await deliver(
    press(choice!["data"] as JSONObject, card.messageId!, options),
  );
}

beforeAll(async () => {
  connector = await startFakeBotConnector();
});

afterAll(async () => {
  await connector.close();
});

beforeEach(() => {
  connector.calls.splice(0);
  (GlobalCache as unknown as { store: Map<string, unknown> }).store.clear();
  connected = [PLATFORM, NONPRD];
  memberOf = [PLATFORM, NONPRD];
  asked = [];
  notices = [];

  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter =
    new CloudAdapter(new ConfigurationBotFrameworkAuthentication({}));

  jest
    .spyOn(
      MicrosoftTeamsUtil as unknown as {
        captureChatFromBotActivity: () => Promise<void>;
      },
      "captureChatFromBotActivity",
    )
    .mockResolvedValue(undefined);
  jest
    .spyOn(MicrosoftTeamsUtil, "captureTeamFromBotActivity")
    .mockResolvedValue(undefined);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockImplementation((async () => {
      return connected.map((projectId: ObjectID): WorkspaceProjectAuthToken => {
        const row: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
        row.projectId = projectId;
        row.workspaceProjectId = TENANT_ID;
        row.authToken = "app-token";
        return row;
      });
    }) as never);

  // Deane's Teams account is connected in every project; Priya's in none.
  const linksMatching: (query: JSONObject) => Array<WorkspaceUserAuthToken> = (
    query: JSONObject,
  ): Array<WorkspaceUserAuthToken> => {
    if (query["workspaceUserId"] !== DEANE["aadObjectId"]) {
      return [];
    }

    const projectIds: Array<string> = idsOf(query["projectId"]);

    return connected
      .filter((projectId: ObjectID): boolean => {
        return (
          projectIds.length === 0 || projectIds.includes(projectId.toString())
        );
      })
      .map((projectId: ObjectID): WorkspaceUserAuthToken => {
        const link: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
        link.projectId = projectId;
        link.userId = DEANES_MEMBER;
        return link;
      });
  };

  jest
    .spyOn(WorkspaceUserAuthTokenService, "findBy")
    .mockImplementation((async (args: { query: JSONObject }) => {
      return linksMatching(args.query);
    }) as never);
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockImplementation((async (args: { query: JSONObject }) => {
      return linksMatching(args.query)[0] || null;
    }) as never);
  jest
    .spyOn(WorkspaceActionAuthorization, "isProjectMember")
    .mockImplementation((async (data: { projectId: ObjectID }) => {
      return memberOf.some((projectId: ObjectID): boolean => {
        return projectId.toString() === data.projectId.toString();
      });
    }) as never);
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation((async (data: { projectId: ObjectID }) => {
      return {
        userId: DEANES_MEMBER,
        tenantId: data.projectId,
      } as DatabaseCommonInteractionProps;
    }) as never);
  jest.spyOn(ProjectService, "findBy").mockImplementation((async (args: {
    query: JSONObject;
  }) => {
    return idsOf(args.query["_id"]).map((id: string): Project => {
      const project: Project = new Project();
      project.id = new ObjectID(id);
      project.name = NAMES[id]!;
      return project;
    });
  }) as never);
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async (args: {
    id: ObjectID;
  }) => {
    const project: Project = new Project();
    project.id = args.id;
    project.name = NAMES[args.id.toString()]!;
    return project;
  }) as never);
  jest
    .spyOn(WorkspaceProjectResolver, "findProjectsOfChannel")
    .mockResolvedValue([]);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.example.com"));

  // OneUptime AI's answer, as the real reply around it is written.
  jest
    .spyOn(
      MicrosoftTeamsUtil as unknown as {
        getConversationHistoryTurns: () => Promise<Array<unknown>>;
      },
      "getConversationHistoryTurns",
    )
    .mockResolvedValue([]);
  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
  jest.spyOn(AIService, "getReachedProjectDailyLimit").mockResolvedValue(null);
  jest.spyOn(WorkspaceAiRefusal, "getCreditsRefusal").mockResolvedValue(null);
  jest
    .spyOn(ObservabilityAssistant, "answerQuestion")
    .mockImplementation((async (request: {
      projectId: ObjectID;
      question: string;
    }) => {
      asked.push({
        projectId: request.projectId.toString(),
        question: request.question,
      });

      return {
        contentInMarkdown: `Two monitors are down in ${NAMES[request.projectId.toString()]}.`,
        citations: [],
        totalTokens: 10,
        llmCallCount: 1,
        toolCallCount: 0,
      };
    }) as never);

  // What the operator is told of feedback.
  jest
    .spyOn(OperatorSlackNotice, "post")
    .mockImplementation((async (data: {
      text: string;
      projectId?: ObjectID | null;
    }) => {
      notices.push({
        projectId: data.projectId ? data.projectId.toString() : null,
        text: data.text,
      });
    }) as never);

  loggedErrors = [];
  jest.spyOn(logger, "error").mockImplementation((line: unknown) => {
    loggedErrors.push(String(line));
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter = null;
  jest.restoreAllMocks();
});

describe("an answer given in the project Deane chose offers to ask it in another", () => {
  test("in his chat with the bot: the answer ends with where it was answered, keeps Teams' AI label and feedback, and offers 'Ask in another project' by the compose box", async () => {
    const chosen: Delivery = await askAndChoose(
      "which monitors are down?",
      "IRM Non-Prod",
    );
    const answer: ConnectorCall = answerOf(chosen);

    expect(String(answer.activity["text"])).toContain(
      answeredIn("IRM Non-Prod"),
    );
    // What Teams receives: the label, the feedback buttons, the suggested action - and no attachment.
    expect(answer.activity["entities"]).toEqual([AI_LABEL]);
    expect(
      (answer.activity["channelData"] as JSONObject)["feedbackLoop"],
    ).toEqual({ type: "default" });
    expect(answer.activity["suggestedActions"]).toEqual({
      actions: [ASK_IN_ANOTHER_PROJECT],
    });
    expect(answer.activity["attachments"]).toBeUndefined();
    expect(loggedErrors).toEqual([]);
  });

  test("a follow-up answered from the conversation's memory offers it too", async () => {
    await askAndChoose("which monitors are down?", "IRM Non-Prod");

    const followUp: ConnectorCall = answerOf(
      await deliver(message("and why is checkout slow?")),
    );

    expect(String(followUp.activity["text"])).toContain(
      answeredIn("IRM Non-Prod"),
    );
    expect(followUp.activity["suggestedActions"]).toEqual({
      actions: [ASK_IN_ANOTHER_PROJECT],
    });
  });

  test("an answer nobody chose a project for - Deane in one of the projects - offers nothing, and names none", async () => {
    memberOf = [PLATFORM];

    const answer: ConnectorCall = answerOf(
      await deliver(message("which monitors are down?")),
    );

    expect(String(answer.activity["text"])).not.toContain("Answered in");
    expect(answer.activity["suggestedActions"]).toBeUndefined();
    expect(answer.activity["entities"]).toEqual([AI_LABEL]);
  });

  test("in a group chat, where only who mentions the bot is answered: no suggested action - the answer still says where it was answered", async () => {
    const chosen: Delivery = await askAndChoose(
      "which monitors are down?",
      "IRM Non-Prod",
      { where: "group" },
    );
    const answer: ConnectorCall = answerOf(chosen);

    expect(String(answer.activity["text"])).toContain(
      answeredIn("IRM Non-Prod"),
    );
    expect(answer.activity["suggestedActions"]).toBeUndefined();
  });
});

describe("'Ask in another project'", () => {
  test("tapped, with one other project: the question is asked there at once - its answer says so, and his follow-ups go there", async () => {
    await askAndChoose("which monitors are down?", "IRM Non-Prod");

    // The suggested action says its words as Deane: a message from him.
    const again: Delivery = await deliver(message("Ask in another project"));
    const answer: ConnectorCall = answerOf(again);

    expect(String(answer.activity["text"])).toContain(
      "Two monitors are down in IRM Platform.",
    );
    expect(String(answer.activity["text"])).toContain(
      answeredIn("IRM Platform"),
    );
    // No question which project: there was one other.
    expect(
      postsOf(again).filter((call: ConnectorCall): boolean => {
        return Boolean(call.activity["attachments"]);
      }),
    ).toEqual([]);
    expect(answer.activity["suggestedActions"]).toEqual({
      actions: [ASK_IN_ANOTHER_PROJECT],
    });

    const followUp: ConnectorCall = answerOf(
      await deliver(message("any open incidents?")),
    );

    expect(String(followUp.activity["text"])).toContain(
      answeredIn("IRM Platform"),
    );
    expect(asked).toEqual([
      { projectId: NONPRD.toString(), question: "which monitors are down?" },
      { projectId: PLATFORM.toString(), question: "which monitors are down?" },
      { projectId: PLATFORM.toString(), question: "any open incidents?" },
    ]);
    expect(loggedErrors).toEqual([]);
  });

  test("said in any case, with punctuation, or after 'ask' with the bot mentioned in a group chat: the same", async () => {
    await askAndChoose("which monitors are down?", "IRM Non-Prod", {
      where: "group",
    });

    const again: ConnectorCall = answerOf(
      await deliver(message("ask in ANOTHER project?", { where: "group" })),
    );

    expect(String(again.activity["text"])).toContain(
      answeredIn("IRM Platform"),
    );
    expect(again.conversationId).toBe(GROUP_CHAT_ID);
  });

  test("with more than one other project: asked which of them, quoting the question and where it was answered - and asked again in the one he chooses", async () => {
    connected = [PLATFORM, NONPRD, SANDBOX];
    memberOf = [PLATFORM, NONPRD, SANDBOX];

    await askAndChoose("which monitors are down?", "IRM Non-Prod");

    const which: Delivery = await deliver(message("Ask in another project"));
    const card: ConnectorCall = postsOf(which)[0]!;

    expect(postsOf(which)).toHaveLength(1);
    expect(textOfCard(card)).toBe(
      '<at>Deane Barker</at> **Which project should I ask it in?**\nYou asked "which monitors are down?" in **IRM Non-Prod**.',
    );
    expect(card.activity["summary"]).toBe(
      "Which project should I ask it in: IRM Platform or IRM Sandbox?",
    );
    expect(
      submitsOf(cardOf(card)).map((submit: JSONObject): unknown => {
        return submit["title"];
      }),
    ).toEqual(["IRM Platform", "IRM Sandbox"]);

    const sandbox: JSONObject = submitsOf(cardOf(card)).find(
      (submit: JSONObject): boolean => {
        return submit["title"] === "IRM Sandbox";
      },
    )!["data"] as JSONObject;

    const chosen: Delivery = await deliver(press(sandbox, card.messageId!));

    expect(textOfCard(chosen.calls[0])).toBe(
      "<at>Deane Barker</at> Going ahead in **IRM Sandbox**.",
    );
    expect(String(answerOf(chosen).activity["text"])).toContain(
      answeredIn("IRM Sandbox"),
    );
    expect(asked[asked.length - 1]).toEqual({
      projectId: SANDBOX.toString(),
      question: "which monitors are down?",
    });
  });

  test("with no question of his kept here - none asked, or the hour gone by: told so, and asked nothing", async () => {
    const said: Delivery = await deliver(message("Ask in another project"));

    expect(postsOf(said)).toHaveLength(1);
    expect(textOfCard(postsOf(said)[0])).toBe(
      `<at>Deane Barker</at> ${MicrosoftTeamsProjectChoice.NO_QUESTION_TO_ASK_AGAIN_TEXT}`,
    );
    expect(asked).toEqual([]);

    await askAndChoose("which monitors are down?", "IRM Non-Prod");

    // An hour without a question: the conversation's choice, and its question, are gone.
    (GlobalCache as unknown as { store: Map<string, unknown> }).store.clear();

    const later: Delivery = await deliver(message("Ask in another project"));

    expect(textOfCard(postsOf(later)[0])).toContain(
      MicrosoftTeamsProjectChoice.NO_QUESTION_TO_ASK_AGAIN_TEXT,
    );
    expect(asked).toHaveLength(1);
  });

  test("removed from his other project since: told there is nowhere else to ask it", async () => {
    await askAndChoose("which monitors are down?", "IRM Non-Prod");

    memberOf = [NONPRD];

    const said: Delivery = await deliver(message("Ask in another project"));

    expect(textOfCard(postsOf(said)[0])).toBe(
      `<at>Deane Barker</at> ${MicrosoftTeamsProjectChoice.NO_OTHER_PROJECT_TEXT}`,
    );
    expect(asked).toHaveLength(1);
  });

  test("somebody else's question is never theirs to ask again: Priya, in the same group chat, has none kept", async () => {
    await askAndChoose("which monitors are down?", "IRM Non-Prod", {
      where: "group",
    });

    const said: Delivery = await deliver(
      message("Ask in another project", { from: PRIYA, where: "group" }),
    );

    expect(textOfCard(postsOf(said)[0])).toBe(
      `<at>Priya</at> ${MicrosoftTeamsProjectChoice.NO_QUESTION_TO_ASK_AGAIN_TEXT}`,
    );
    expect(asked).toHaveLength(1);
  });

  test("in an organization connected to one project, the words are a question like any other", async () => {
    connected = [PLATFORM];

    const answer: ConnectorCall = answerOf(
      await deliver(message("Ask in another project")),
    );

    expect(String(answer.activity["text"])).toContain(
      "Two monitors are down in IRM Platform.",
    );
    expect(asked).toEqual([
      { projectId: PLATFORM.toString(), question: "in another project" },
    ]);
  });
});

describe("👍 or 👎 on an answer reaches the operator with the project it was answered in", () => {
  test("on an answer given in the project Deane chose: its project, though nothing the feedback carries tells it", async () => {
    const chosen: Delivery = await askAndChoose(
      "which monitors are down?",
      "IRM Non-Prod",
    );
    const answer: ConnectorCall = answerOf(chosen);

    const given: Delivery = await deliver(feedback(answer.messageId!));

    expect(given.httpStatus).toBe(200);
    expect(given.calls).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.projectId).toBe(NONPRD.toString());
    expect(notices[0]!.text).toContain("IRM Non-Prod");
  });

  test("on the earlier answer after a later one went to another project: each answer keeps its own", async () => {
    const first: ConnectorCall = answerOf(
      await askAndChoose("which monitors are down?", "IRM Non-Prod"),
    );
    const second: ConnectorCall = answerOf(
      await deliver(message("Ask in another project")),
    );

    await deliver(feedback(first.messageId!));
    await deliver(feedback(second.messageId!));

    expect(
      notices.map((notice: { projectId: string | null }): unknown => {
        return notice.projectId;
      }),
    ).toEqual([NONPRD.toString(), PLATFORM.toString()]);
  });

  test("given by somebody else in a group chat, who chose nothing: still the answer's project", async () => {
    const answer: ConnectorCall = answerOf(
      await askAndChoose("which monitors are down?", "IRM Non-Prod", {
        where: "group",
      }),
    );

    await deliver(feedback(answer.messageId!, { from: PRIYA, where: "group" }));

    expect(notices[0]!.projectId).toBe(NONPRD.toString());
  });

  test("on an answer the bot kept nothing for - sent before this change - by its asker within the hour: the project he chose for the conversation", async () => {
    await askAndChoose("which monitors are down?", "IRM Non-Prod");

    await deliver(feedback("1762160000000"));

    expect(notices[0]!.projectId).toBe(NONPRD.toString());
  });

  test("on such an answer, by somebody who chose no project there: reported without one, as before", async () => {
    await deliver(
      feedback("1762160000000", { from: PRIYA, where: "group" }),
    );

    expect(notices).toHaveLength(1);
    expect(notices[0]!.projectId).toBeNull();
  });

  test("the answer's project is kept apart from any other answer's: one per message, in its conversation", async () => {
    const answer: ConnectorCall = answerOf(
      await askAndChoose("which monitors are down?", "IRM Non-Prod"),
    );

    expect(
      await MicrosoftTeamsAiAnswer.getAnswerProject({
        activity: message(""),
        messageId: answer.messageId!,
      }),
    ).toEqual(NONPRD);
    expect(
      await MicrosoftTeamsAiAnswer.getAnswerProject({
        activity: message(""),
        messageId: "some-other-message",
      }),
    ).toBeNull();
    expect(
      await MicrosoftTeamsAiAnswer.getAnswerProject({
        activity: message("", { where: "group" }),
        messageId: answer.messageId!,
      }),
    ).toBeNull();
  });
});
