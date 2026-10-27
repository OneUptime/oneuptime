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
import http from "http";
import type { Mock } from "jest-mock";
import type { AddressInfo } from "net";

/*
 * "WHICH PROJECT IS THIS FOR?" IN MICROSOFT TEAMS, END TO END.
 *
 * One Microsoft 365 organization connected to two OneUptime projects, IRM
 * Platform and IRM Non-Prod, and Deane, a member of both, in his chat with
 * the bot - where no channel tells which project he means. These run what
 * he types and presses through the REAL botbuilder stack, as
 * MicrosoftTeamsCommandsEndToEnd does:
 *
 *   fake Express req -> MicrosoftTeamsUtil.processBotActivity
 *     -> real CloudAdapter -> real TeamsActivityHandler
 *     -> the bot's handlers -> real TurnContext (sends, updates, its hooks)
 *     -> real ConnectorClient -> HTTP -> a fake Bot Connector on 127.0.0.1
 *
 * and pin what the Bot Connector is sent: the card that asks, the card
 * edited in place to what he chose, the answer read in that project as his
 * member there, the form that carries the project it was opened for and is
 * submitted there, a question's follow-ups, a Home whose buttons keep its
 * project - and the short line every other press gets: somebody else's, a
 * second one, Teams delivering one twice. The projects' rows, names and
 * memberships are the only things stubbed, with what each reader reads.
 */

jest.mock("botbuilder", () => {
  return (
    jest.requireActual("../../../Helpers/RealBotbuilder") as {
      loadRealBotbuilder: (fromFile: string) => unknown;
    }
  ).loadRealBotbuilder(__filename);
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
  };
});

// Where the bot keeps a question's request, and Teams' redelivery claims.
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
import MicrosoftTeamsAuthAction from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import { MicrosoftTeamsIncidentActionType } from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import { DRAWN_FOR_PROJECT_ID_FIELD } from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardProject";
import { MicrosoftTeamsHomeActionType } from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsHome";
import MicrosoftTeamsProjectChoice from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsProjectChoice";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceHome, {
  WorkspaceHomeView,
} from "../../../../Server/Utils/Workspace/WorkspaceHome";
import WorkspaceOnCallNow from "../../../../Server/Utils/Workspace/WorkspaceOnCallNow";
import WorkspaceProjectResolver from "../../../../Server/Utils/Workspace/WorkspaceProjectResolution";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../../Server/Utils/Logger";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceOpenRecordKind from "../../../../Types/Workspace/WorkspaceOpenRecordKind";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TeamsActivityHandler,
  TurnContext,
} from "botbuilder";

// ---- A fake Bot Connector: records every activity the bot sends ----

const ACTIVITIES_PATH: RegExp =
  /^\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/;

interface ConnectorCall {
  method: "POST" | "PUT" | "DELETE";
  conversationId: string;
  // A reply's activity, or the activity changed or removed.
  activityId: string | null;
  // The id the Bot Connector gave a new message.
  messageId: string | null;
  activity: JSONObject;
}

interface FakeBotConnector {
  serviceUrl: string;
  calls: Array<ConnectorCall>;
  close: () => Promise<void>;
}

async function startFakeBotConnector(): Promise<FakeBotConnector> {
  let messageNumber: number = 0;

  const fake: FakeBotConnector = {
    serviceUrl: "",
    calls: [],
    close: async (): Promise<void> => {
      return undefined;
    },
  };

  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      let bodyText: string = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        bodyText += chunk;
      });
      req.on("end", () => {
        const path: string = (req.url || "/").split("?")[0] || "/";
        const match: RegExpExecArray | null = ACTIVITIES_PATH.exec(path);
        const method: string = req.method || "";

        if (
          !match ||
          (method !== "POST" && method !== "PUT" && method !== "DELETE")
        ) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: "NotFound" } }));
          return;
        }

        const messageId: string | null =
          method === "POST" ? `msg-${++messageNumber}` : null;

        fake.calls.push({
          method: method as ConnectorCall["method"],
          conversationId: decodeURIComponent(match[1] || ""),
          activityId: match[2] ? decodeURIComponent(match[2]) : null,
          messageId: messageId,
          activity: bodyText ? (JSON.parse(bodyText) as JSONObject) : {},
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: messageId || decodeURIComponent(match[2] || ""),
          }),
        );
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  fake.serviceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  fake.close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  };

  return fake;
}

// ---- What Teams gets back for the activity it posted ----

class RecordingResponse {
  public statusCode: number | null = null;
  public headersSent: boolean = false;

  public status(code: number): this {
    this.statusCode = code;
    return this;
  }

  public send(): this {
    this.headersSent = true;
    return this;
  }

  public json(): this {
    this.headersSent = true;
    return this;
  }

  public end(): this {
    this.headersSent = true;
    return this;
  }

  public header(): this {
    return this;
  }

  public setHeader(): this {
    return this;
  }
}

type CachedAdapterSlot = { cachedAdapter: CloudAdapter | null };

// ---- The organization, its two projects, and the people in it ----

const TENANT_ID: string = "7a1e0000-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PLATFORM: ObjectID = new ObjectID("f3000000-0000-4000-8000-000000000001");
const NONPRD: ObjectID = new ObjectID("f3000000-0000-4000-8000-000000000002");
const NAMES: Record<string, string> = {
  [PLATFORM.toString()]: "IRM Platform",
  [NONPRD.toString()]: "IRM Non-Prod",
};
const DEANES_MEMBER: ObjectID = new ObjectID(
  "f3000000-0000-4000-8000-0000000000d1",
);

const BOT: JSONObject = { id: "28:oneuptime-bot-app-id", name: "OneUptime" };
const DEANE: JSONObject = {
  id: "29:1deane",
  name: "Deane Barker",
  aadObjectId: "00000000-0000-4000-8000-00000000dea1",
};
const NITIN: JSONObject = {
  id: "29:1nitin",
  name: "Nitin",
  aadObjectId: "00000000-0000-4000-8000-0000000000a2",
};
const PERSONAL_CONVERSATION_ID: string = "a:7a1e-deane-personal-chat";
const CHANNEL_THREAD_ID: string = "19:general-7a1e@thread.tacv2;messageid=101";
const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";

const QUESTION: string =
  "**Which project is this for?** This Microsoft 365 organization is connected to more than one OneUptime project, and I can't tell which one you mean here.";

let connector: FakeBotConnector;
let activityNumber: number = 0;
let memberOf: Array<ObjectID>;
let loggedErrors: Array<string>;

function nextActivityId(label: string): string {
  activityNumber++;
  return `7a1e-${label}-${activityNumber}-${ObjectID.generate().toString().substring(0, 8)}`;
}

// What somebody types: in Deane's chat with the bot, or in a channel post.
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
    id: nextActivityId("message"),
    timestamp: "2026-10-27T09:00:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: options?.from || DEANE,
    conversation: inChannel
      ? {
          conversationType: "channel",
          tenantId: TENANT_ID,
          id: CHANNEL_THREAD_ID,
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
    text: inChannel ? `<at>OneUptime</at> ${text}` : text,
    entities: inChannel
      ? [{ type: "mention", text: "<at>OneUptime</at>", mentioned: BOT }]
      : [],
    channelData: inChannel
      ? {
          tenant: { id: TENANT_ID },
          team: { id: "19:team-7a1e@thread.tacv2", name: "Operations" },
          channel: { id: "19:general-7a1e@thread.tacv2", name: "General" },
        }
      : { tenant: { id: TENANT_ID } },
  };
}

/*
 * A press of a card's Action.Submit, as Teams sends it: a message with the
 * button's data - and whatever the card's inputs hold - as its value, in
 * reply to the card.
 */
function press(
  value: JSONObject,
  replyToId: string,
  options?: {
    from?: JSONObject | undefined;
    where?: "personal" | "channel" | undefined;
    id?: string | undefined;
  },
): JSONObject {
  const pressed: JSONObject = message("", options);

  delete pressed["text"];
  pressed["entities"] = [];
  pressed["value"] = value;
  pressed["replyToId"] = replyToId;

  if (options?.id) {
    pressed["id"] = options.id;
  }

  return pressed;
}

interface Delivery {
  httpStatus: number | null;
  calls: Array<ConnectorCall>;
}

async function deliver(activity: JSONObject): Promise<Delivery> {
  const first: number = connector.calls.length;
  const res: RecordingResponse = new RecordingResponse();

  await MicrosoftTeamsUtil.processBotActivity(
    {
      method: "POST",
      headers: {},
      body: JSON.parse(JSON.stringify(activity)),
    } as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
  );

  return { httpStatus: res.statusCode, calls: connector.calls.slice(first) };
}

function posts(delivery: Delivery): Array<ConnectorCall> {
  return delivery.calls.filter((call: ConnectorCall): boolean => {
    return call.method === "POST";
  });
}

function cardOf(call: ConnectorCall | undefined): JSONObject {
  const attachment: JSONObject | undefined = (
    call?.activity["attachments"] as Array<JSONObject> | undefined
  )?.[0];

  expect(attachment?.["contentType"]).toBe(
    "application/vnd.microsoft.card.adaptive",
  );

  return attachment!["content"] as JSONObject;
}

function textOf(call: ConnectorCall | undefined): string {
  return ((cardOf(call)["body"] as Array<JSONObject>) || [])
    .filter((element: JSONObject): boolean => {
      return element["type"] === "TextBlock";
    })
    .map((element: JSONObject): string => {
      return String(element["text"]);
    })
    .join("\n");
}

// Every Action.Submit of a card, wherever it is on it.
function submitsOf(element: unknown): Array<JSONObject> {
  if (Array.isArray(element)) {
    return element.flatMap(submitsOf);
  }

  if (!element || typeof element !== "object") {
    return [];
  }

  const object: JSONObject = element as JSONObject;

  return [
    ...(object["type"] === "Action.Submit" ? [object] : []),
    ...Object.values(object).flatMap(submitsOf),
  ];
}

// The question Deane was asked: the title and the data of each button.
function choicesOf(
  call: ConnectorCall | undefined,
): Array<{ title: string; data: JSONObject }> {
  expect(textOf(call)).toContain(QUESTION);

  return submitsOf(cardOf(call)).map(
    (submit: JSONObject): { title: string; data: JSONObject } => {
      return {
        title: String(submit["title"]),
        data: submit["data"] as JSONObject,
      };
    },
  );
}

function buttonOf(call: ConnectorCall | undefined, title: string): JSONObject {
  const choice: { title: string; data: JSONObject } | undefined = choicesOf(
    call,
  ).find((candidate: { title: string }): boolean => {
    return candidate.title === title;
  });

  expect(choice).toBeDefined();

  return choice!.data;
}

// Asks the way Deane does; the delivery, and the card that asks which.
async function ask(
  text: string,
  options?: { where?: "personal" | "channel" | undefined },
): Promise<{ delivery: Delivery; question: ConnectorCall }> {
  const delivery: Delivery = await deliver(message(text, options));

  expect(delivery.httpStatus).toBe(200);
  expect(posts(delivery)).toHaveLength(1);

  return { delivery, question: posts(delivery)[0]! };
}

// ---- Lifecycle ----

let readsOnCall: Array<ObjectID>;
let membersRead: Array<ObjectID>;

beforeAll(async () => {
  connector = await startFakeBotConnector();
});

afterAll(async () => {
  await connector.close();
});

beforeEach(() => {
  connector.calls.splice(0);
  (GlobalCache as unknown as { store: Map<string, unknown> }).store.clear();
  memberOf = [PLATFORM, NONPRD];
  readsOnCall = [];
  membersRead = [];

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

  // The organization's two connections, IRM Platform first.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockImplementation((async () => {
      return [PLATFORM, NONPRD].map(
        (projectId: ObjectID): WorkspaceProjectAuthToken => {
          const row: WorkspaceProjectAuthToken =
            new WorkspaceProjectAuthToken();
          row.projectId = projectId;
          row.workspaceProjectId = TENANT_ID;
          row.authToken = "app-token";
          return row;
        },
      );
    }) as never);

  // Deane's account is connected in both; Nitin's in neither.
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findBy")
    .mockImplementation((async (args: { query: JSONObject }) => {
      if (args.query["workspaceUserId"] !== DEANE["aadObjectId"]) {
        return [];
      }

      return [PLATFORM, NONPRD].map(
        (projectId: ObjectID): WorkspaceUserAuthToken => {
          const link: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
          link.projectId = projectId;
          link.userId = DEANES_MEMBER;
          return link;
        },
      );
    }) as never);
  jest
    .spyOn(WorkspaceActionAuthorization, "isProjectMember")
    .mockImplementation((async (data: { projectId: ObjectID }) => {
      return memberOf.some((projectId: ObjectID): boolean => {
        return projectId.toString() === data.projectId.toString();
      });
    }) as never);
  jest.spyOn(ProjectService, "findBy").mockImplementation((async () => {
    return Object.entries(NAMES).map((entry: [string, string]): Project => {
      const project: Project = new Project();
      project.id = new ObjectID(entry[0]);
      project.name = entry[1];
      return project;
    });
  }) as never);

  // #general: a channel neither project owns or posts to.
  jest
    .spyOn(WorkspaceProjectResolver, "findProjectsOfChannel")
    .mockResolvedValue([]);

  // Whatever is read, is read as Deane's member in that project.
  jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockResolvedValue(DEANES_MEMBER);
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation((async (data: { projectId: ObjectID }) => {
      membersRead.push(data.projectId);
      return {
        userId: DEANES_MEMBER,
        tenantId: data.projectId,
      } as DatabaseCommonInteractionProps;
    }) as never);
  jest
    .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
    .mockResolvedValue(undefined);

  // Who is on call, as the project read says it.
  jest
    .spyOn(WorkspaceOnCallNow, "getOnCallNowAnswer")
    .mockImplementation((async (data: { projectId: ObjectID }) => {
      readsOnCall.push(data.projectId);
      const name: string = NAMES[data.projectId.toString()] || "?";
      return {
        markdown: `On call in ${name}: Priya`,
        text: `On call in ${name}: Priya`,
      };
    }) as never);

  // The incident form's lists: one severity.
  jest
    .spyOn(MicrosoftTeamsIncidentActions, "getNewIncidentFormChoices")
    .mockResolvedValue({
      severities: {
        choices: [
          {
            title: "Critical",
            value: "f3000000-0000-4000-8000-0000000000c1",
          },
        ],
        totalCount: 1,
      },
      monitors: { choices: [], totalCount: 0 },
      monitorStatuses: { choices: [], totalCount: 0 },
      labels: { choices: [], totalCount: 0 },
      onCallDutyPolicies: { choices: [], totalCount: 0 },
    });

  jest.spyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(() => {
    return Promise.resolve(URL.fromString(DASHBOARD_URL));
  });

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

// ---- Tests ----

describe("harness: the real botbuilder stack", () => {
  test("botbuilder is the real package, not Common's stub, with the hooks a turn's cards are marked through", () => {
    expect(typeof CloudAdapter.prototype.process).toBe("function");
    expect(typeof TeamsActivityHandler.prototype.run).toBe("function");
    expect(typeof TurnContext.prototype.onSendActivities).toBe("function");
    expect(typeof TurnContext.prototype.onUpdateActivity).toBe("function");
  });
});

describe("Deane types 'oncall' in his chat with the bot", () => {
  test("he is asked which project: one card that mentions him, a button for each of his projects, one under another - nothing read in either", async () => {
    const { delivery, question } = await ask("oncall");

    expect(delivery.calls).toHaveLength(1);
    expect(question.conversationId).toBe(PERSONAL_CONVERSATION_ID);
    expect(textOf(question)).toBe(`<at>Deane Barker</at> ${QUESTION}`);
    expect(question.activity["summary"]).toBe(
      "Which project is this for: IRM Platform or IRM Non-Prod?",
    );
    expect((cardOf(question)["msteams"] as JSONObject)["entities"]).toEqual([
      {
        type: "mention",
        text: "<at>Deane Barker</at>",
        mentioned: { id: DEANE["id"], name: "Deane Barker" },
      },
    ]);
    expect(
      (cardOf(question)["body"] as Array<JSONObject>).map(
        (element: JSONObject): unknown => {
          return element["type"];
        },
      ),
    ).toEqual(["TextBlock", "ActionSet", "ActionSet"]);
    expect(
      choicesOf(question).map(
        (choice: { title: string; data: JSONObject }): unknown => {
          return [choice.title, choice.data["action"]];
        },
      ),
    ).toEqual([
      ["IRM Platform", "choose-project"],
      ["IRM Non-Prod", "choose-project"],
    ]);
    // The question names no project of its own: it is not a card of one.
    expect(
      choicesOf(question).every((choice: { data: JSONObject }): boolean => {
        return choice.data[DRAWN_FOR_PROJECT_ID_FIELD] === undefined;
      }),
    ).toBe(true);
    expect(readsOnCall).toEqual([]);
    expect(loggedErrors).toEqual([]);
  });

  test("he presses IRM Non-Prod: the card becomes what he chose, in place, and who is on call there is read as his member there", async () => {
    const { question } = await ask("oncall");

    const chosen: Delivery = await deliver(
      press(buttonOf(question, "IRM Non-Prod"), question.messageId!),
    );

    expect(chosen.httpStatus).toBe(200);
    expect(
      chosen.calls.map((call: ConnectorCall): unknown => {
        return [call.method, call.method === "PUT" ? call.activityId : null];
      }),
    ).toEqual([
      ["PUT", question.messageId],
      ["POST", null],
    ]);
    expect(textOf(chosen.calls[0])).toBe(
      "<at>Deane Barker</at> Going ahead in **IRM Non-Prod**.",
    );
    expect(chosen.calls[0]!.activity["summary"]).toBe(
      "Going ahead in IRM Non-Prod.",
    );
    expect(submitsOf(cardOf(chosen.calls[0]))).toEqual([]);

    expect(textOf(chosen.calls[1])).toBe(
      "<at>Deane Barker</at> On call in IRM Non-Prod: Priya",
    );
    expect(chosen.calls[1]!.conversationId).toBe(PERSONAL_CONVERSATION_ID);
    expect(readsOnCall.map(String)).toEqual([NONPRD.toString()]);
    expect(membersRead.map(String)).toEqual([NONPRD.toString()]);
    expect(loggedErrors).toEqual([]);
  });

  test("a second press - the other button, or the same again - is told the choice is gone, and reads nothing", async () => {
    const { question } = await ask("oncall");

    await deliver(
      press(buttonOf(question, "IRM Non-Prod"), question.messageId!),
    );

    for (const title of ["IRM Platform", "IRM Non-Prod"]) {
      const again: Delivery = await deliver(
        press(buttonOf(question, title), question.messageId!),
      );

      expect(again.httpStatus).toBe(200);
      expect(
        again.calls.map((call: ConnectorCall): string => {
          return call.method;
        }),
      ).toEqual(["POST"]);
      expect(textOf(again.calls[0])).toBe(
        `<at>Deane Barker</at> ${MicrosoftTeamsProjectChoice.GONE_TEXT}`,
      );
    }

    expect(readsOnCall.map(String)).toEqual([NONPRD.toString()]);
  });

  test("Teams delivering his press twice - it does, after a slow answer - makes it once", async () => {
    const { question } = await ask("oncall");
    const pressId: string = nextActivityId("press");
    const pressed: JSONObject = press(
      buttonOf(question, "IRM Platform"),
      question.messageId!,
      { id: pressId },
    );

    const first: Delivery = await deliver(pressed);
    const redelivered: Delivery = await deliver(pressed);

    expect(first.calls).toHaveLength(2);
    expect(redelivered.httpStatus).toBe(200);
    expect(redelivered.calls).toEqual([]);
    expect(readsOnCall.map(String)).toEqual([PLATFORM.toString()]);
  });
});

describe("in a channel, where anyone can press a card's button", () => {
  test("Nitin pressing Deane's button is told only Deane can choose - nothing is read, the card stays - and Deane still can", async () => {
    const { question } = await ask("oncall", { where: "channel" });

    expect(question.conversationId).toBe(CHANNEL_THREAD_ID);

    const nitins: Delivery = await deliver(
      press(buttonOf(question, "IRM Non-Prod"), question.messageId!, {
        from: NITIN,
        where: "channel",
      }),
    );

    expect(
      nitins.calls.map((call: ConnectorCall): string => {
        return call.method;
      }),
    ).toEqual(["POST"]);
    expect(textOf(nitins.calls[0])).toBe(
      `<at>Nitin</at> ${MicrosoftTeamsProjectChoice.NOT_THEIRS_TEXT}`,
    );
    expect(nitins.calls[0]!.conversationId).toBe(CHANNEL_THREAD_ID);
    expect(readsOnCall).toEqual([]);

    const deanes: Delivery = await deliver(
      press(buttonOf(question, "IRM Non-Prod"), question.messageId!, {
        where: "channel",
      }),
    );

    expect(deanes.calls[0]!.method).toBe("PUT");
    expect(readsOnCall.map(String)).toEqual([NONPRD.toString()]);
  });
});

describe("a form opened in the project Deane chose carries it, and is submitted there", () => {
  test("'incident Checkout is down': choose IRM Platform, the form's button names IRM Platform, and the incident is declared there, as him", async () => {
    const { question } = await ask("incident Checkout is down");

    const chosen: Delivery = await deliver(
      press(buttonOf(question, "IRM Platform"), question.messageId!),
    );
    const form: ConnectorCall = posts(chosen)[0]!;

    expect(textOf(form)).toContain("Create New Incident");
    expect(
      submitsOf(cardOf(form)).map((submit: JSONObject): unknown => {
        return submit["data"];
      }),
    ).toEqual([
      {
        action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
        [DRAWN_FOR_PROJECT_ID_FIELD]: PLATFORM.toString(),
      },
    ]);

    const created: Incident = new Incident();
    created.id = ObjectID.generate();
    jest.spyOn(IncidentService, "create").mockResolvedValue(created);
    const createSpy: Mock = IncidentService.create as unknown as Mock;

    // Teams sends the button's data with what the form's inputs hold.
    const submitted: Delivery = await deliver(
      press(
        {
          ...(submitsOf(cardOf(form))[0]!["data"] as JSONObject),
          incidentTitle: "Checkout is down",
          incidentDescription: "Customers cannot pay.",
          incidentSeverity: "f3000000-0000-4000-8000-0000000000c1",
        },
        form.messageId!,
      ),
    );

    expect(submitted.httpStatus).toBe(200);
    expect(createSpy).toHaveBeenCalledTimes(1);

    const createdWith: {
      data: Incident;
      props: DatabaseCommonInteractionProps;
    } = createSpy.mock.calls[0]![0] as unknown as {
      data: Incident;
      props: DatabaseCommonInteractionProps;
    };

    expect(createdWith.data.projectId?.toString()).toBe(PLATFORM.toString());
    expect(createdWith.data.title).toBe("Checkout is down");
    expect(createdWith.props).toEqual({
      userId: DEANES_MEMBER,
      tenantId: PLATFORM,
    });
    // Not asked again: confirmed, and the form removed.
    expect(
      submitted.calls.map((call: ConnectorCall): string => {
        return call.method;
      }),
    ).toEqual(["POST", "DELETE"]);
    expect(String(submitted.calls[0]!.activity["text"])).toBe(
      `✅ Incident created successfully!\n\nView incident: ${DASHBOARD_URL}/${PLATFORM.toString()}/incidents/${created.id!.toString()}`,
    );
    expect(submitted.calls[1]!.activityId).toBe(form.messageId);
    expect(loggedErrors).toEqual([]);
  });
});

describe("a question for OneUptime AI keeps the project chosen for its follow-ups", () => {
  test("asked which, answered in IRM Non-Prod - and the follow-up in his chat too, without asking again", async () => {
    const answered: Array<{ projectId: string; question: string }> = [];
    jest
      .spyOn(
        MicrosoftTeamsUtil as unknown as {
          answerObservabilityQuestion: (data: {
            turnContext: TurnContext;
            projectId: ObjectID;
            question: string;
          }) => Promise<void>;
        },
        "answerObservabilityQuestion",
      )
      .mockImplementation(
        async (data: {
          turnContext: TurnContext;
          projectId: ObjectID;
          question: string;
        }) => {
          answered.push({
            projectId: data.projectId.toString(),
            question: data.question,
          });
          await data.turnContext.sendActivity(
            `Answered in ${NAMES[data.projectId.toString()]}`,
          );
        },
      );

    const { question } = await ask("which monitors are down?");

    expect(answered).toEqual([]);

    const chosen: Delivery = await deliver(
      press(buttonOf(question, "IRM Non-Prod"), question.messageId!),
    );

    expect(chosen.calls[0]!.method).toBe("PUT");
    expect(chosen.calls[1]!.activity["text"]).toBe("Answered in IRM Non-Prod");

    const followUp: Delivery = await deliver(
      message("and why is checkout slow?"),
    );

    expect(
      followUp.calls.map((call: ConnectorCall): unknown => {
        return call.activity["text"];
      }),
    ).toEqual(["Answered in IRM Non-Prod"]);
    expect(answered).toEqual([
      { projectId: NONPRD.toString(), question: "which monitors are down?" },
      { projectId: NONPRD.toString(), question: "and why is checkout slow?" },
    ]);

    // A command is not a follow-up: asked again.
    const command: Delivery = await deliver(message("oncall"));

    expect(choicesOf(posts(command)[0])).toHaveLength(2);
  });
});

describe("the Home, drawn for the project Deane chose, keeps it on its buttons", () => {
  test("'home': choose IRM Non-Prod, its Home's buttons name it, and Refresh draws it again there, in place, without asking", async () => {
    jest.spyOn(WorkspaceHome, "read").mockImplementation((async (data: {
      projectId: ObjectID;
    }) => {
      const view: WorkspaceHomeView = {
        projectName: NAMES[data.projectId.toString()] || null,
        firstName: "Deane",
        onCall: null,
        incidents: {
          kind: WorkspaceOpenRecordKind.Incidents,
          list: null,
          refused: false,
          failed: true,
        },
        alerts: {
          kind: WorkspaceOpenRecordKind.Alerts,
          list: null,
          refused: false,
          failed: true,
        },
        dashboardLink: null,
        readAt: new Date("2026-10-27T09:00:00.000Z"),
      };

      return view;
    }) as never);

    const { question } = await ask("home");
    const chosen: Delivery = await deliver(
      press(buttonOf(question, "IRM Non-Prod"), question.messageId!),
    );
    const home: ConnectorCall = posts(chosen)[0]!;

    expect(textOf(home)).toContain("IRM Non-Prod");

    const buttons: Array<JSONObject> = submitsOf(cardOf(home));

    expect(
      buttons.map((submit: JSONObject): unknown => {
        return (submit["data"] as JSONObject)["action"];
      }),
    ).toEqual(
      expect.arrayContaining([
        MicrosoftTeamsHomeActionType.DeclareIncident,
        MicrosoftTeamsHomeActionType.Refresh,
      ]),
    );

    for (const submit of buttons) {
      expect((submit["data"] as JSONObject)[DRAWN_FOR_PROJECT_ID_FIELD]).toBe(
        NONPRD.toString(),
      );
    }

    const refresh: JSONObject = buttons.find((submit: JSONObject): boolean => {
      return (
        (submit["data"] as JSONObject)["action"] ===
        MicrosoftTeamsHomeActionType.Refresh
      );
    })!["data"] as JSONObject;

    const refreshed: Delivery = await deliver(press(refresh, home.messageId!));

    expect(
      refreshed.calls.map((call: ConnectorCall): unknown => {
        return [call.method, call.activityId];
      }),
    ).toEqual([["PUT", home.messageId]]);
    expect(textOf(refreshed.calls[0])).toContain("IRM Non-Prod");
    // Drawn again in place, its buttons still name the project.
    for (const submit of submitsOf(cardOf(refreshed.calls[0]))) {
      expect((submit["data"] as JSONObject)[DRAWN_FOR_PROJECT_ID_FIELD]).toBe(
        NONPRD.toString(),
      );
    }
  });
});

describe("the Home that welcomes somebody in one of the organization's projects", () => {
  test("adding the app for himself: his Home, whose buttons name its project - read without asking, pressed without asking", async () => {
    memberOf = [PLATFORM];
    jest.spyOn(WorkspaceHome, "read").mockImplementation((async (data: {
      projectId: ObjectID;
    }) => {
      return {
        projectName: NAMES[data.projectId.toString()] || null,
        firstName: "Deane",
        onCall: null,
        incidents: {
          kind: WorkspaceOpenRecordKind.Incidents,
          list: null,
          refused: false,
          failed: true,
        },
        alerts: {
          kind: WorkspaceOpenRecordKind.Alerts,
          list: null,
          refused: false,
          failed: true,
        },
        dashboardLink: null,
        readAt: new Date("2026-10-27T09:00:00.000Z"),
      } as WorkspaceHomeView;
    }) as never);

    const added: JSONObject = {
      ...message(""),
      type: "conversationUpdate",
      membersAdded: [{ id: BOT["id"] }],
    };
    delete added["text"];

    const welcome: Delivery = await deliver(added);
    const home: ConnectorCall = posts(welcome)[0]!;

    expect(welcome.httpStatus).toBe(200);
    expect(textOf(home)).toContain("IRM Platform");
    expect(submitsOf(cardOf(home)).length).toBeGreaterThan(0);

    for (const submit of submitsOf(cardOf(home))) {
      expect((submit["data"] as JSONObject)[DRAWN_FOR_PROJECT_ID_FIELD]).toBe(
        PLATFORM.toString(),
      );
    }

    // Who's on call, pressed on it: answered for IRM Platform.
    const whoIsOnCall: JSONObject = submitsOf(cardOf(home)).find(
      (submit: JSONObject): boolean => {
        return (
          (submit["data"] as JSONObject)["action"] ===
          MicrosoftTeamsHomeActionType.WhoIsOnCall
        );
      },
    )!["data"] as JSONObject;

    const pressed: Delivery = await deliver(
      press(whoIsOnCall, home.messageId!),
    );

    expect(textOf(posts(pressed)[0])).toBe(
      "<at>Deane Barker</at> On call in IRM Platform: Priya",
    );
  });
});

describe("when the card cannot be offered, the answer that names the projects stays", () => {
  test("the cache that keeps a question's request is down: the text answer, mentioning Deane, its first words the ones the docs quote", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValueOnce(new Error("connection refused"));

    const delivery: Delivery = await deliver(message("oncall"));

    expect(delivery.httpStatus).toBe(200);
    expect(posts(delivery)).toHaveLength(1);
    expect(textOf(posts(delivery)[0])).toBe(
      `<at>Deane Barker</at> ${WorkspaceProjectResolver.TEAMS_AMBIGUOUS_LEAD}, so I can't tell which one you mean here. You're in **IRM Platform** and **IRM Non-Prod**: try it again in a channel of the project you mean, such as one of its incident channels.`,
    );
    expect(submitsOf(cardOf(posts(delivery)[0]))).toEqual([]);
    expect(readsOnCall).toEqual([]);
    expect(loggedErrors).toContain(
      "Could not record a Microsoft Teams request to ask its project of.",
    );
  });

  test("somebody in only one of the projects is never asked: answered there", async () => {
    memberOf = [PLATFORM];

    const delivery: Delivery = await deliver(message("oncall"));

    expect(textOf(posts(delivery)[0])).toBe(
      "<at>Deane Barker</at> On call in IRM Platform: Priya",
    );
    expect(readsOnCall.map(String)).toEqual([PLATFORM.toString()]);
  });
});
