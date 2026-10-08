import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../Models/DatabaseModels/Project";
import SlackAPI from "../../../../Server/API/SlackAPI";
import AIService from "../../../../Server/Services/AIService";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ObservabilityAssistant, {
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIIncidentPostmortemRunner from "../../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import { PostIncidentStatusUpdateTool } from "../../../../Server/Utils/AI/Toolbox/AIActionTools";
import { CreateIncidentTool } from "../../../../Server/Utils/AI/Toolbox/IncidentWriteTools";
import {
  CreateAlertNoteTool,
  CreateIncidentNoteTool,
} from "../../../../Server/Utils/AI/Toolbox/NoteWriteTools";
import { ToolContext } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import logger from "../../../../Server/Utils/Logger";
import MicrosoftTeamsAuthAction from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { renderAsDashboard } from "../../../Utils/Markdown/DashboardMarkdownRenderer";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { Lexer, Token, Tokens, marked } from "marked";

// Where an HTML tag starts.
const HTML_TAG_START_PATTERN: RegExp = /<\/?[A-Za-z]/;
// The addresses the hostile values bring.
const VALUE_ADDRESS_PATTERN: RegExp = /^https:\/\/(?:evil|tracker)\.example/;

/*
 * WHERE OneUptime AI'S TEXT ENTERS FEEDS AND CHATS.
 *
 * The model writes from telemetry - log lines, span attributes, an
 * incident's timeline - and telemetry can carry text meant to steer what it
 * writes. Everywhere its Markdown is stored or posted:
 *
 *   - an investigation's analysis (AIInvestigationEngine.buildBrandedMarkdown:
 *     the subject's feed, its internal note, its Slack and Teams channels);
 *   - a drafted postmortem (IncidentPostmortemRunner: the incident, its feed);
 *   - the notes, status updates and incident descriptions its tools write
 *     (create_incident_note, create_alert_note, post_incident_status_update,
 *     create_incident);
 *   - its answers in Slack and Microsoft Teams;
 *
 * it keeps the formatting the model wrote, but nothing in it acts on its
 * own: no Slack mention notifies anybody, no image is fetched, no link's
 * words hide where it goes, and no HTML tag is read.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();
const ALERT_ID: ObjectID = ObjectID.generate();

// What a log line the model read could steer it into writing.
const STEERED: string = [
  "## Summary",
  "",
  "The **checkout** service ran out of database connections.",
  "",
  "- `max_connections` is 100",
  "- the deploy doubled the workers",
  "",
  "<!channel> please [approve the fix](https://evil.example/login) <@U0123ABC>",
  "",
  '![status](https://tracker.example/p.png) <a href="https://evil.example/a">Open</a> <img src="https://tracker.example/q.png">',
  "",
  "```sql",
  "SHOW max_connections;",
  "```",
].join("\n");

// The parts of STEERED the model wrote on purpose.
const FORMATTING: Array<string> = [
  "heading",
  "strong",
  "list",
  "codespan",
  "code",
];

const SLACK_MENTION_PATTERN: RegExp = /<[!@#][A-Za-z0-9]/;

function tokensOf(markdown: string): Array<Token> {
  const tokens: Array<Token> = [];

  marked.walkTokens(
    new Lexer({ gfm: true }).lex(markdown),
    (token: Token): void => {
      tokens.push(token);
    },
  );

  return tokens;
}

function withoutJoiners(text: string): string {
  return text.split("\u2060").join("");
}

/*
 * The text keeps its formatting and acts on nothing: no image, no HTML tag,
 * no link to an address it brought (a link whose words are its address is a
 * bare address, which shows where it goes), and no Slack mention - in
 * marked, the dashboard's parser and Slack's conversion alike.
 */
function expectKeptAndInert(markdown: string): void {
  const tokens: Array<Token> = tokensOf(markdown);
  const types: Array<string> = tokens.map((token: Token): string => {
    return token.type;
  });

  for (const type of FORMATTING) {
    expect(types).toContain(type);
  }

  expect(
    tokens
      .filter((token: Token): boolean => {
        if (token.type === "image") {
          return true;
        }

        if (token.type === "html") {
          return HTML_TAG_START_PATTERN.test(token.raw);
        }

        if (token.type === "link") {
          const link: Tokens.Link = token as Tokens.Link;
          return (
            VALUE_ADDRESS_PATTERN.test(link.href) &&
            !link.href.startsWith(
              link.text.replace(/&quot;/g, '"').replace(/&gt;/g, ">"),
            )
          );
        }

        return false;
      })
      .map((token: Token): string => {
        return token.raw;
      }),
  ).toEqual([]);

  const html: string = renderAsDashboard([markdown])[0]!;

  expect(html).not.toMatch(/<img/);
  expect(html).not.toMatch(/>approve the fix<\/a>|>Open<\/a>/);

  expect(SlackUtil.convertMarkdownToSlackRichText(markdown)).not.toMatch(
    SLACK_MENTION_PATTERN,
  );

  // Every word the model wrote is still there to read.
  expect(withoutJoiners(markdown)).toContain(
    "please [approve the fix](https://evil.example/login)",
  );
}

function citation(label: string): AIChatCitation {
  return {
    id: "C1",
    toolName: "query_logs",
    label: label,
    rowCount: 3,
    queryArguments: {},
  };
}

function assistantResult(
  overrides: Partial<ObservabilityAssistantResult> = {},
): ObservabilityAssistantResult {
  return {
    contentInMarkdown: STEERED,
    citations: [citation("<!here> [Logs](https://evil.example/logs)")],
    totalTokens: 100,
    llmCallCount: 1,
    toolCallCount: 1,
    modelName: "gpt-4.1-mini",
    ...overrides,
  };
}

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { isRoot: true, userId: USER_ID },
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("An investigation's analysis", () => {
  test("keeps the model's formatting, and nothing in it acts on its own", () => {
    const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      assistantResult(),
      STEERED,
    );

    expectKeptAndInert(markdown);
  });

  test("a citation's label and the model's name are text", () => {
    const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      assistantResult({
        modelName: "gpt <!channel> [x](https://evil.example/m)",
      }),
      "**Summary** — the pool ran dry [C1].",
    );

    expect(markdown).toContain(
      "- **[C1]** \\<\u2060!here> \\[Logs\\](https://evil.example/logs) — 3 row(s)",
    );
    expect(markdown).toContain(
      "using gpt \\<\u2060!channel> \\[x\\](https://evil.example/m).",
    );
    expect(SlackUtil.convertMarkdownToSlackRichText(markdown)).not.toMatch(
      SLACK_MENTION_PATTERN,
    );
    // The analysis's own citation markers are still there.
    expect(markdown).toContain("the pool ran dry [C1].");
  });
});

describe("OneUptime AI's answers in chat", () => {
  test("Slack: the answer keeps its formatting, and nothing in it or its sources acts on its own", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue({ userId: USER_ID, tenantId: PROJECT_ID } as never);
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(assistantResult() as never);

    const answer: string = await (
      SlackAPI as unknown as {
        getAiOpsAnswerMarkdown: (data: {
          projectId: ObjectID;
          userId: ObjectID;
          question: string;
        }) => Promise<string>;
      }
    ).getAiOpsAnswerMarkdown({
      projectId: PROJECT_ID,
      userId: USER_ID,
      question: "Why is checkout failing?",
    });

    expectKeptAndInert(answer);
    expect(answer).toContain(
      "• \\<\u2060!here> \\[Logs\\](https://evil.example/logs) (3 rows)",
    );
  });

  test("Microsoft Teams: the reply keeps its formatting, and nothing in it or its sources acts on its own", async () => {
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(USER_ID);
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue({ userId: USER_ID, tenantId: PROJECT_ID } as never);
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
    jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue(null as never);
    jest
      .spyOn(
        MicrosoftTeamsUtil as unknown as {
          getConversationHistoryTurns: () => Promise<Array<JSONObject>>;
        },
        "getConversationHistoryTurns",
      )
      .mockResolvedValue([]);
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(assistantResult() as never);

    const sent: Array<string> = [];

    await (
      MicrosoftTeamsUtil as unknown as {
        answerObservabilityQuestion: (data: {
          activity: JSONObject;
          turnContext: unknown;
          projectId: ObjectID;
          question: string;
        }) => Promise<void>;
      }
    ).answerObservabilityQuestion({
      activity: { from: { aadObjectId: "aad-user-1" } },
      turnContext: {
        sendActivity: async (text: string): Promise<void> => {
          sent.push(text);
        },
      },
      projectId: PROJECT_ID,
      question: "Why is checkout failing?",
    });

    // The acknowledgement, then the answer.
    const reply: string = sent[sent.length - 1]!;

    expectKeptAndInert(reply);
    expect(reply).toContain(
      "• \\<\u2060!here> \\[Logs\\](https://evil.example/logs) (3 rows)",
    );
  });
});

// The reply the Teams bot posts for an answer.
async function teamsReplyFor(
  result: ObservabilityAssistantResult,
): Promise<string> {
  jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockResolvedValue(USER_ID);
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue({ userId: USER_ID, tenantId: PROJECT_ID } as never);
  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
  jest
    .spyOn(AIService, "getReachedProjectDailyLimit")
    .mockResolvedValue(null as never);
  jest
    .spyOn(
      MicrosoftTeamsUtil as unknown as {
        getConversationHistoryTurns: () => Promise<Array<JSONObject>>;
      },
      "getConversationHistoryTurns",
    )
    .mockResolvedValue([]);
  jest
    .spyOn(ObservabilityAssistant, "answerQuestion")
    .mockResolvedValue(result as never);

  const sent: Array<string> = [];

  await (
    MicrosoftTeamsUtil as unknown as {
      answerObservabilityQuestion: (data: {
        activity: JSONObject;
        turnContext: unknown;
        projectId: ObjectID;
        question: string;
      }) => Promise<void>;
    }
  ).answerObservabilityQuestion({
    activity: { from: { aadObjectId: "aad-user-1" } },
    turnContext: {
      sendActivity: async (text: string): Promise<void> => {
        sent.push(text);
      },
    },
    projectId: PROJECT_ID,
    question: "Why is checkout failing?",
  });

  return sent[sent.length - 1]!;
}

describe("OneUptime AI's answers in Microsoft Teams, in code", () => {
  /*
   * Teams reads HTML in a bot's Markdown message, fenced code included, so
   * a tag the model put in a code block would be an element there - an
   * image fetched when the reply is read. Every tag in the reply is broken
   * with an invisible word joiner; the code reads as the model wrote it.
   */
  test("a tag in the answer's fenced code is shown as its characters", async () => {
    const code: string =
      '<img src="https://tracker.example/q.png"> <b>bold</b> </code>';

    const reply: string = await teamsReplyFor(
      assistantResult({
        contentInMarkdown: [
          "The page embeds the tracker:",
          "",
          "```html",
          code,
          "```",
        ].join("\n"),
        citations: [citation('`docker ps -a` on Docker host "web-1"')],
      }),
    );

    expect(reply).not.toMatch(/<[A-Za-z/!]/);
    expect(withoutJoiners(reply)).toContain(code);
    // A command in a citation's label stays code.
    expect(reply).toContain('• `docker ps -a` on Docker host "web-1" (3 rows)');
  });
});

describe("Notes, status updates and incidents OneUptime AI writes", () => {
  test("create_incident_note stores the note with its formatting, acting on nothing", async () => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.incidentNumber = 42;
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);
    const create: SpyInstance<typeof IncidentInternalNoteService.create> = jest
      .spyOn(IncidentInternalNoteService, "create")
      .mockResolvedValue(new IncidentInternalNote() as never);

    await CreateIncidentNoteTool.execute(
      { incidentId: INCIDENT_ID.toString(), note: STEERED },
      ctx,
    );

    const note: string = (
      (create.mock.calls[0]![0] as unknown as JSONObject)[
        "data"
      ] as IncidentInternalNote
    ).note!;
    expectKeptAndInert(note);
  });

  test("create_alert_note stores the note with its formatting, acting on nothing", async () => {
    const alert: Alert = new Alert();
    alert._id = ALERT_ID.toString();
    alert.alertNumber = 9;
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);
    const create: SpyInstance<typeof AlertInternalNoteService.create> = jest
      .spyOn(AlertInternalNoteService, "create")
      .mockResolvedValue(new AlertInternalNote() as never);

    await CreateAlertNoteTool.execute(
      { alertId: ALERT_ID.toString(), note: STEERED },
      ctx,
    );

    const note: string = (
      (create.mock.calls[0]![0] as unknown as JSONObject)[
        "data"
      ] as AlertInternalNote
    ).note!;
    expectKeptAndInert(note);
  });

  test("post_incident_status_update posts the update with its formatting, acting on nothing", async () => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.incidentNumber = 42;
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);
    const create: SpyInstance<typeof IncidentPublicNoteService.create> = jest
      .spyOn(IncidentPublicNoteService, "create")
      .mockResolvedValue(new IncidentPublicNote() as never);

    await PostIncidentStatusUpdateTool.execute(
      { incidentId: INCIDENT_ID.toString(), note: STEERED },
      ctx,
    );

    const note: string = (
      (create.mock.calls[0]![0] as unknown as JSONObject)[
        "data"
      ] as IncidentPublicNote
    ).note!;
    expectKeptAndInert(note);
  });

  test("create_incident stores the description with its formatting, acting on nothing; the title is plain text", async () => {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = ObjectID.generate().toString();
    severity.name = "SEV1";
    severity.order = 1;
    jest
      .spyOn(IncidentSeverityService, "findBy")
      .mockResolvedValue([severity] as never);

    const created: Incident = new Incident();
    created._id = INCIDENT_ID.toString();
    created.incidentNumber = 42;
    const create: SpyInstance<typeof IncidentService.create> = jest
      .spyOn(IncidentService, "create")
      .mockResolvedValue(created as never);

    await CreateIncidentTool.execute(
      { title: "Checkout down", description: STEERED },
      ctx,
    );

    const incident: Incident = (
      create.mock.calls[0]![0] as unknown as JSONObject
    )["data"] as Incident;
    expectKeptAndInert(incident.description!);
    expect(incident.title).toBe("Checkout down");
  });
});

describe("A postmortem OneUptime AI drafts", () => {
  beforeEach(() => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: PROJECT_ID,
      enableAi: true,
      enableAutomaticPostmortemDraft: true,
    } as unknown as Project);
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(new LlmProvider());
    jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      id: INCIDENT_ID,
      incidentNumber: 42,
      postmortemNote: undefined,
    } as unknown as Incident);
    jest
      .spyOn(IncidentService, "generatePostmortemFromAI")
      .mockResolvedValue(STEERED);
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
  });

  test("is saved and previewed in the feed with its formatting, acting on nothing", async () => {
    const update: SpyInstance<typeof IncidentService.updateOneById> = jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const feed: SpyInstance<typeof IncidentFeedService.createIncidentFeedItem> =
      jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(undefined as never);

    await AIIncidentPostmortemRunner.draftPostmortemOnResolve({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });

    const saved: string = (
      (update.mock.calls[0]![0] as unknown as JSONObject)["data"] as JSONObject
    )["postmortemNote"] as string;
    const preview: string = (feed.mock.calls[0]![0] as unknown as JSONObject)[
      "moreInformationInMarkdown"
    ] as string;

    expectKeptAndInert(saved);
    expectKeptAndInert(preview);
  });
});
