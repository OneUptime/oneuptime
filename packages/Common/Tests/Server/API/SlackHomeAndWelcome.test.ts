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
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Name from "../../../Types/Name";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import Incident from "../../../Models/DatabaseModels/Incident";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import SlackHome from "../../../Server/Utils/Workspace/Slack/SlackHome";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceMessageTime from "../../../Server/Utils/Workspace/WorkspaceMessageTime";
import {
  httpRequest,
  ProbeResponse,
  RunningApp,
  startApp,
} from "./WorkspaceOAuthTestHelpers";

/*
 * THE ONEUPTIME APP'S HOME TAB IN SLACK, AND ITS HELLO IN A CHANNEL.
 *
 * Opening the OneUptime app in Slack showed an empty Home ("This is the
 * very beginning of your direct message history") and nothing about what is
 * going on; inviting it to a channel showed "OneUptime joined" and nothing
 * about what it does there. Now:
 *
 *   - app_home_opened draws the person's Home with views.publish: their
 *     on-call shifts, the open incidents and alerts they may see, and
 *     buttons to declare an incident, page someone, schedule maintenance or
 *     see who is on call - or, not connected yet, one button to connect.
 *   - member_joined_channel, for the app's bot added by a person, posts one
 *     short hello: what it does, and where notifications are set up.
 *   - app_home_opened for the Messages tab, the first time each person
 *     opens it, posts a short welcome in the app's direct messages with
 *     them: what OneUptime does in Slack, and how to start (Slack's
 *     Marketplace review asks for it).
 *   - The Home's buttons, pressed, open the forms and answer in a modal
 *     (the Home has no channel to answer in).
 *
 * Through the real router (/api/slack/events and /api/slack/interactive),
 * the real authorization, the real Home and lists, against a recorded Slack:
 * every request OneUptime makes is pinned. Only the database reads are
 * stubbed.
 */

jest.mock("../../../Server/Middleware/SlackAuthorization", () => {
  return {
    __esModule: true,
    default: {
      // The signature check has its own tests; these drive what follows it.
      isAuthorizedSlackRequest: (
        _req: unknown,
        _res: unknown,
        next: () => void,
      ): void => {
        next();
      },
    },
  };
});

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("./WorkspaceOAuthTestHelpers") as {
        createInMemoryGlobalCache: () => unknown;
      }
    ).createInMemoryGlobalCache(),
  };
});

jest.setTimeout(60000);

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const TEAM_ID: string = "T0ACME";
const ONEUPTIME: string = "U0ONEUPTIME";
const ALICE: string = "U0ALICE";
const CAROL: string = "U0CAROL";
const OPS: string = "C0OPS";
const PROJECT_ID: ObjectID = new ObjectID(
  "d0000000-0000-4000-8000-000000000001",
);
const ALICE_ID: ObjectID = new ObjectID("d0000000-0000-4000-8000-0000000000a1");
const SLACK_PROJECT_TOKEN: string = "xoxb-project-token";
const NOW: Date = new Date("2026-10-08T17:15:00.000Z");
const HANDOFF: Date = new Date("2026-10-10T09:00:00.000Z");

// Slack's own: a zero-width space around a bold span it draws.
const ZWSP: string = "\u{200B}";

const PROPS: DatabaseCommonInteractionProps = {
  userId: ALICE_ID,
  tenantId: PROJECT_ID,
};

interface SlackCall {
  method: string;
  data: JSONObject;
}

let app: RunningApp;
let slackCalls: Array<SlackCall> = [];
let refusals: Map<string, string> = new Map();
let linked: Map<string, ObjectID> = new Map();
let workspaceConnected: boolean = true;
let errorLines: Array<string> = [];
let clockOffsetInMs: number = 0;
const realDateNow: () => number = Date.now.bind(Date);

const PRIMARY: OnCallDutyPolicySchedule = (() => {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = new ObjectID("d0000000-0000-4000-8000-0000000000c1");
  schedule.name = "Primary";
  schedule.rosterHandoffAt = HANDOFF;
  return schedule;
})();

const CHECKOUT: Incident = (() => {
  const incident: Incident = new Incident();
  incident.id = new ObjectID("d0000000-0000-4000-8000-0000000000e1");
  incident.incidentNumber = 12;
  incident.incidentNumberWithPrefix = "INC-12";
  incident.title = "Checkout is down";
  incident.incidentSeverity = { name: "Critical" } as never;
  incident.currentIncidentState = { name: "Identified" } as never;
  incident.declaredAt = NOW;
  return incident;
})();

let onCallReads: Array<JSONObject> = [];
let incidentReads: Array<JSONObject> = [];

function answerSlack(method: string): JSONObject {
  const refusal: string | undefined = refusals.get(method);

  if (refusal) {
    return { ok: false, error: refusal };
  }

  if (method === "chat.postMessage") {
    return { ok: true, channel: OPS, ts: "1760000000.000900" };
  }

  return { ok: true };
}

let eventNumber: number = 0;

function eventCallback(event: JSONObject): JSONObject {
  eventNumber++;

  return {
    token: "verification-token",
    team_id: TEAM_ID,
    api_app_id: "A0ONEUPTIME",
    event: event,
    type: "event_callback",
    event_id: `Ev0HOME${String(eventNumber).padStart(4, "0")}`,
    event_time: 1760000000 + eventNumber,
  };
}

function deliverEvent(
  payload: JSONObject,
  headers: Record<string, string> = {},
): Promise<ProbeResponse> {
  return httpRequest({
    port: app.port,
    method: "POST",
    path: "/api/slack/events",
    headers: headers,
    body: payload,
    timeoutMs: 20000,
  });
}

function press(payload: JSONObject): Promise<ProbeResponse> {
  return httpRequest({
    port: app.port,
    method: "POST",
    path: "/api/slack/interactive",
    body: { payload: JSON.stringify(payload) },
    timeoutMs: 20000,
  });
}

// A button of the Home tab, pressed: Slack names the view, and no channel.
function homeButton(actionId: string, user: string = ALICE): JSONObject {
  return {
    type: "block_actions",
    user: { id: user, username: "alice", name: "Alice" },
    team: { id: TEAM_ID },
    container: { type: "view", view_id: "V0HOME" },
    view: {
      id: "V0HOME",
      type: "home",
      blocks: [],
      private_metadata: "",
      callback_id: "",
      state: { values: {} },
    },
    trigger_id: "1760000000.home-trigger",
    actions: [{ action_id: actionId, type: "button" }],
  };
}

function openHome(user: string, tab: string = "home"): JSONObject {
  return eventCallback({
    type: "app_home_opened",
    user: user,
    channel: `D${user.substring(1)}`,
    tab: tab,
    event_ts: "1760000000.000100",
  });
}

async function until(
  condition: () => boolean,
  what: string,
  attempts: number = 400,
): Promise<void> {
  for (let attempt: number = 0; attempt < attempts; attempt++) {
    if (condition()) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error(`Waited in vain for ${what}`);
}

// Gives what OneUptime does after its 200 the time to do it.
async function settle(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 150);
  });
}

function calls(method: string): Array<SlackCall> {
  return slackCalls.filter((call: SlackCall): boolean => {
    return call.method === method;
  });
}

function publishedBlocks(index: number = 0): Array<JSONObject> {
  const call: SlackCall = calls("views.publish")[index]!;
  return (call.data["view"] as JSONObject)["blocks"] as Array<JSONObject>;
}

function blockTexts(blocks: Array<JSONObject>): Array<string> {
  return blocks
    .filter((block: JSONObject): boolean => {
      return block["type"] === "section" || block["type"] === "header";
    })
    .map((block: JSONObject): string => {
      return String((block["text"] as JSONObject)["text"]);
    });
}

function buttonsOf(blocks: Array<JSONObject>): Array<JSONObject> {
  return blocks
    .filter((block: JSONObject): boolean => {
      return block["type"] === "actions";
    })
    .flatMap((block: JSONObject): Array<JSONObject> => {
      return block["elements"] as Array<JSONObject>;
    });
}

beforeAll(async () => {
  const SlackAPI: any = (await import("../../../Server/API/SlackAPI")).default;

  app = await startApp([new SlackAPI().getRouter()]);
}, 600000);

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  slackCalls = [];
  refusals = new Map();
  linked = new Map([[ALICE, ALICE_ID]]);
  workspaceConnected = true;
  errorLines = [];
  onCallReads = [];
  incidentReads = [];
  clockOffsetInMs = 0;
  (
    jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
      default: { store: Map<string, unknown> };
    }
  ).default.store.clear();

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return realDateNow() + clockOffsetInMs;
  });

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
    .mockImplementation((async () => {
      if (!workspaceConnected) {
        return null;
      }

      const projectAuth: WorkspaceProjectAuthToken =
        new WorkspaceProjectAuthToken();
      projectAuth.projectId = PROJECT_ID;
      projectAuth.authToken = SLACK_PROJECT_TOKEN;
      projectAuth.miscData = { botUserId: ONEUPTIME } as never;
      return projectAuth;
    }) as never);
  // The workspace's connections, as WorkspaceProjectResolution reads them.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockImplementation((async (...args: Array<unknown>) => {
      const projectAuth: unknown = await (
        WorkspaceProjectAuthTokenService.findOneBy as unknown as (
          ...args: Array<unknown>
        ) => Promise<unknown>
      )(...args);
      return projectAuth ? [projectAuth] : [];
    }) as never);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async () => {
      const projectAuth: WorkspaceProjectAuthToken =
        new WorkspaceProjectAuthToken();
      projectAuth.projectId = PROJECT_ID;
      projectAuth.authToken = SLACK_PROJECT_TOKEN;
      return projectAuth;
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
      userAuth.authToken = "xoxp-user-token";
      return userAuth;
    }) as never);
  jest
    .spyOn(WorkspaceActionAuthorization, "isProjectMember")
    .mockResolvedValue(true);
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue(PROPS);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD_URL));
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");

  // What the Home reads.
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const project: Project = new Project();
    project.name = "Acme Production";
    return project;
  }) as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    const user: User = new User();
    user.name = new Name("Alice Admin");
    return user;
  }) as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "findBy")
    .mockImplementation((async (findBy: JSONObject) => {
      onCallReads.push(findBy);
      const query: JSONObject = findBy["query"] as JSONObject;
      // Alice is on call in Primary; she is next in none.
      return query["nextUserIdOnRoster"] ? [] : [PRIMARY];
    }) as never);
  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue([ObjectID.generate()]);
  jest.spyOn(IncidentService, "findBy").mockImplementation((async (
    findBy: JSONObject,
  ) => {
    incidentReads.push(findBy);
    return [CHECKOUT];
  }) as never);
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([ObjectID.generate()]);
  jest.spyOn(AlertService, "findBy").mockResolvedValue([]);

  // Slack: every request is recorded, and answered as Slack would.
  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: URL;
    data: JSONObject;
  }) => {
    const method: string = options.url.toString().split("/api/").pop() || "";
    slackCalls.push({ method: method, data: options.data });
    return new HTTPResponse<JSONObject>(200, answerSlack(method), {});
  }) as never);

  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);
  jest.spyOn(logger, "error").mockImplementation(((line: unknown) => {
    errorLines.push(String(line));
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Home tab, opened", () => {
  test("a connected member: their on-call shift, the open incidents and alerts, and four buttons - one views.publish for them", async () => {
    const response: ProbeResponse = await deliverEvent(openHome(ALICE));

    expect(response.status).toBe(200);
    await until((): boolean => {
      return calls("views.publish").length === 1;
    }, "the Home drawn");

    const publish: SlackCall = calls("views.publish")[0]!;
    expect(publish.data["user_id"]).toBe(ALICE);
    expect((publish.data["view"] as JSONObject)["type"]).toBe("home");

    const blocks: Array<JSONObject> = publishedBlocks();
    const texts: Array<string> = blockTexts(blocks);

    // What you can do first, under the greeting; then each part, titled.
    expect(
      blocks.map((block: JSONObject): unknown => {
        return block["type"];
      }),
    ).toEqual([
      "header",
      "section",
      "actions",
      "divider",
      "section",
      "section",
      "divider",
      "section",
      "section",
      "section",
      "divider",
      "context",
    ]);

    expect(texts[0]).toBe("👋 Hi Alice");
    expect(texts[1]).toContain("Here's what is happening in");
    expect(texts[1]).toContain("Acme Production");
    expect(texts[2]).toBe(`📟 ${ZWSP}*Your on-call*${ZWSP}\n`);
    expect(texts[3]).toContain(
      `🟢 You're on call in <${DASHBOARD_URL}/${PROJECT_ID.toString()}/on-call-duty/schedules/${PRIMARY.id!.toString()}|Primary> until <!date^${Math.floor(HANDOFF.getTime() / 1000)}^{date_short_pretty}|`,
    );
    expect(texts[4]).toBe(`🚨 ${ZWSP}*Open incidents*${ZWSP}\n`);
    expect(texts[5]).toContain(
      `<${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/${CHECKOUT.id!.toString()}|INC-12>`,
    );
    expect(texts[5]).toContain("Checkout is down · Critical · Identified");
    // The rest of what is open: Active Incidents, not every incident.
    expect(texts[5]).toContain(
      `<${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/unresolved|See every open incident in OneUptime>`,
    );
    expect(texts[6]).toContain("No open alerts.");

    // Declare incident first and filled; no button carries an empty value.
    const buttons: Array<JSONObject> = buttonsOf(blocks);
    expect(
      buttons.map((button: JSONObject): unknown => {
        return [
          button["action_id"],
          (button["text"] as JSONObject)["text"],
          button["style"],
        ];
      }),
    ).toEqual([
      ["/incident", "🚨 Declare incident", "primary"],
      ["PageSomeone", "📟 Page someone", undefined],
      ["/maintenance", "🛠️ Schedule maintenance", undefined],
      ["ShowOnCall", "👥 Who's on call", undefined],
    ]);
    for (const button of buttons) {
      expect(button["value"]).toBeUndefined();
    }

    // When it was drawn, in each reader's own time, and the commands: small.
    const footer: JSONObject = blocks[blocks.length - 1]!;
    const footerText: string = String(
      ((footer["elements"] as Array<JSONObject>)[0] as JSONObject)["text"],
    );
    expect(
      ((footer["elements"] as Array<JSONObject>)[0] as JSONObject)["type"],
    ).toBe("mrkdwn");
    expect(footerText).toContain("Updated at <!date^");
    expect(footerText).toContain("/oneuptime help");

    // Read with Alice's own permissions, never as OneUptime.
    expect(onCallReads[0]!["props"]).toEqual(PROPS);
    expect(incidentReads[0]!["props"]).toEqual(PROPS);
  });

  test("the Messages tab opened: nothing drawn", async () => {
    await deliverEvent(openHome(ALICE, "messages"));
    await until((): boolean => {
      return calls("chat.postMessage").length === 1;
    }, "the welcome posted");
    await settle();

    expect(calls("views.publish")).toEqual([]);
  });

  test("the Home tab opened: drawn, and nobody welcomed", async () => {
    await deliverEvent(openHome(ALICE));
    await until((): boolean => {
      return calls("views.publish").length === 1;
    }, "the Home drawn");
    await settle();

    expect(calls("chat.postMessage")).toEqual([]);
  });

  test("somebody not connected: why the Home is empty, and one button that connects them - nothing about the project read", async () => {
    await deliverEvent(openHome(CAROL));
    await until((): boolean => {
      return calls("views.publish").length === 1;
    }, "the Home drawn");

    const blocks: Array<JSONObject> = publishedBlocks();

    expect(blockTexts(blocks)).toEqual([
      "👋 Welcome to OneUptime",
      `🔗 ${ZWSP}*Connect your Slack account*${ZWSP} to see your on-call shifts and the open incidents and alerts here, and to declare incidents and page people from Slack. It takes one click.\n`,
    ]);

    const buttons: Array<JSONObject> = buttonsOf(blocks);
    expect(buttons).toHaveLength(1);
    expect((buttons[0]!["text"] as JSONObject)["text"]).toBe(
      "Connect Slack account",
    );
    expect(buttons[0]!["style"]).toBe("primary");

    const link: globalThis.URL = new globalThis.URL(String(buttons[0]!["url"]));
    expect(`${link.origin}${link.pathname}`).toBe(
      `${DASHBOARD_URL}/${PROJECT_ID.toString()}/user-settings/slack-integration`,
    );
    expect(link.searchParams.get("connectAccount")).toBe("true");

    expect(onCallReads).toEqual([]);
    expect(incidentReads).toEqual([]);
  });

  test("somebody no longer a member: told so, and shown nothing", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockRejectedValue(
        new NotAuthorizedException(
          WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
        ),
      );

    await deliverEvent(openHome(ALICE));
    await until((): boolean => {
      return calls("views.publish").length === 1;
    }, "the Home drawn");

    expect(blockTexts(publishedBlocks())).toEqual([
      "👋 Hi there",
      "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.\n",
    ]);
    expect(incidentReads).toEqual([]);
  });

  test("a workspace connected to no project: nothing drawn, nothing asked of Slack", async () => {
    workspaceConnected = false;

    await deliverEvent(openHome(ALICE));
    await settle();

    expect(slackCalls).toEqual([]);
  });

  test("opened twice in a moment: drawn once; ten seconds on, drawn again", async () => {
    await deliverEvent(openHome(ALICE));
    await deliverEvent(openHome(ALICE));
    await until((): boolean => {
      return calls("views.publish").length >= 1;
    }, "the Home drawn");
    await settle();

    expect(calls("views.publish")).toHaveLength(1);

    clockOffsetInMs += 11 * 1000;

    await deliverEvent(openHome(ALICE));
    await until((): boolean => {
      return calls("views.publish").length === 2;
    }, "the Home drawn again");
  });

  test("Slack refuses the view: logged, never thrown - Slack had its 200", async () => {
    refusals.set("views.publish", "invalid_blocks");

    const response: ProbeResponse = await deliverEvent(openHome(ALICE));

    expect(response.status).toBe(200);
    await until((): boolean => {
      return errorLines.includes("Could not draw a Slack Home tab.");
    }, "the refusal logged");
  });

  test("somebody who just connected: their Home is drawn, so the tab they connected from fills in", async () => {
    await SlackHome.refreshAfterConnect({
      projectId: PROJECT_ID,
      slackUserId: ALICE,
    });

    expect(calls("views.publish")).toHaveLength(1);
    expect(calls("views.publish")[0]!.data["user_id"]).toBe(ALICE);
    expect(blockTexts(publishedBlocks())[0]).toBe("👋 Hi Alice");
  });
});

describe("the Home's buttons: the forms open, and answers come in a modal", () => {
  test("Declare incident opens the New Incident form, its title empty", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "authorize")
      .mockResolvedValue(PROPS);
    jest
      .spyOn(WorkspaceActionAuthorization, "findReadable")
      .mockResolvedValue([] as never);

    const response: ProbeResponse = await press(homeButton("/incident"));

    expect(response.status).toBe(200);
    await until((): boolean => {
      return calls("views.open").length === 1;
    }, "the form opened");

    const view: JSONObject = calls("views.open")[0]!.data["view"] as JSONObject;
    expect(calls("views.open")[0]!.data["trigger_id"]).toBe(
      "1760000000.home-trigger",
    );
    expect(view["callback_id"]).toBe("SubmitNewIncident");
    expect(JSON.stringify(view["blocks"])).toContain('"initial_value":""');
  });

  test("a press refused - a role that may not declare - is told so in a modal, not a direct message", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "authorize")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permission to declare an incident in this project.",
        ),
      );

    await press(homeButton("/incident"));
    await until((): boolean => {
      return calls("views.open").length === 1;
    }, "the refusal shown");

    expect(JSON.stringify(calls("views.open")[0]!.data["view"])).toContain(
      "You do not have permission to declare an incident in this project.",
    );
    expect(calls("chat.postMessage")).toEqual([]);
  });

  test("Who's on call answers in a modal - the Home has no channel to answer in", async () => {
    await press(homeButton("ShowOnCall"));
    await until((): boolean => {
      return calls("views.open").length === 1;
    }, "the answer shown");

    const view: JSONObject = calls("views.open")[0]!.data["view"] as JSONObject;
    expect(view["type"]).toBe("modal");
    expect(JSON.stringify(view["blocks"])).toContain("On call now");
    // Never a direct message or an ephemeral message in a channel.
    expect(calls("chat.postMessage")).toEqual([]);
    expect(calls("chat.postEphemeral")).toEqual([]);
  });

  test("a press from somebody not connected: asked to connect, in a modal", async () => {
    await press(homeButton("ShowOnCall", CAROL));
    await until((): boolean => {
      return calls("views.open").length === 1;
    }, "the prompt shown");

    expect(JSON.stringify(calls("views.open")[0]!.data["view"])).toContain(
      "Connect your Slack account to see who is on call",
    );
    expect(calls("chat.postMessage")).toEqual([]);
  });
});

describe("a welcome in the Messages tab, the first time somebody opens it", () => {
  function openMessages(user: string): JSONObject {
    return openHome(user, "messages");
  }

  function welcomes(): Array<SlackCall> {
    return calls("chat.postMessage");
  }

  test("the first open: one welcome, in the app's direct messages with them - what OneUptime does in Slack, and how to start", async () => {
    const response: ProbeResponse = await deliverEvent(openMessages(ALICE));

    expect(response.status).toBe(200);
    await until((): boolean => {
      return welcomes().length === 1;
    }, "the welcome posted");

    const post: SlackCall = welcomes()[0]!;
    // Slack delivers a message to a person's id to the app's direct messages.
    expect(post.data["channel"]).toBe(ALICE);
    expect(post.data["thread_ts"]).toBeUndefined();
    // What a notification of it says.
    expect(post.data["text"]).toBe(
      "Hi, I'm OneUptime. Type /oneuptime help to see what I can do, or send me a question here.",
    );

    const blocks: Array<JSONObject> = post.data["blocks"] as Array<JSONObject>;
    expect(blockTexts(blocks)).toEqual([
      `👋 ${ZWSP}*Hi, I'm OneUptime.*${ZWSP} I post your incidents, alerts and scheduled maintenance in Slack, page whoever is on call, and let you acknowledge, resolve and add notes without leaving Slack.\n`,
      `Here's how to start:\n\n•   Type \`/oneuptime help\` to see the commands: declare an incident, page someone or see who is on call.\n•   Open the ${ZWSP}*Home*${ZWSP} tab for your on-call shifts and the open incidents and alerts.\n•   Send me a message here to ask OneUptime AI about your incidents, monitors, logs and traces.\n`,
    ]);
    // Alice's account is connected: nothing to connect.
    expect(buttonsOf(blocks)).toEqual([]);

    // Who was welcomed is kept, never read back from the conversation.
    expect(
      slackCalls.map((call: SlackCall): string => {
        return call.method;
      }),
    ).toEqual(["chat.postMessage"]);
  });

  test("opened again - at once, or a month on: no second welcome", async () => {
    await deliverEvent(openMessages(ALICE));
    await deliverEvent(openMessages(ALICE));
    await until((): boolean => {
      return welcomes().length >= 1;
    }, "the welcome posted");
    await settle();

    clockOffsetInMs += 31 * 24 * 60 * 60 * 1000;

    await deliverEvent(openMessages(ALICE));
    await settle();

    expect(welcomes()).toHaveLength(1);
  });

  test("Slack's retry of the open: one welcome", async () => {
    const open: JSONObject = openMessages(ALICE);

    await deliverEvent(open);
    await deliverEvent(open, { "x-slack-retry-num": "1" });
    await deliverEvent(open, { "x-slack-retry-num": "2" });
    await until((): boolean => {
      return welcomes().length >= 1;
    }, "the welcome posted");
    await settle();

    expect(welcomes()).toHaveLength(1);
  });

  test("each person is welcomed of their own", async () => {
    await deliverEvent(openMessages(ALICE));
    await deliverEvent(openMessages(CAROL));
    await until((): boolean => {
      return welcomes().length === 2;
    }, "both welcomes posted");

    expect(
      welcomes()
        .map((call: SlackCall): unknown => {
          return call.data["channel"];
        })
        .sort(),
    ).toEqual([ALICE, CAROL]);
  });

  test("somebody not connected: asked to connect, with the Home's Connect button", async () => {
    await deliverEvent(openMessages(CAROL));
    await until((): boolean => {
      return welcomes().length === 1;
    }, "the welcome posted");

    const blocks: Array<JSONObject> = welcomes()[0]!.data[
      "blocks"
    ] as Array<JSONObject>;

    expect(blockTexts(blocks)[2]).toBe(
      `🔗 ${ZWSP}*Connect your Slack account*${ZWSP} first, so OneUptime can act as you, with your permissions in the project. It takes one click.\n`,
    );

    const buttons: Array<JSONObject> = buttonsOf(blocks);
    expect(buttons).toHaveLength(1);
    expect((buttons[0]!["text"] as JSONObject)["text"]).toBe(
      "Connect Slack account",
    );
    expect(buttons[0]!["style"]).toBe("primary");

    const link: globalThis.URL = new globalThis.URL(String(buttons[0]!["url"]));
    expect(`${link.origin}${link.pathname}`).toBe(
      `${DASHBOARD_URL}/${PROJECT_ID.toString()}/user-settings/slack-integration`,
    );
    expect(link.searchParams.get("connectAccount")).toBe("true");
  });

  test("the Home opened first does not count: the Messages tab's first open is still welcomed", async () => {
    await deliverEvent(openHome(ALICE));
    await until((): boolean => {
      return calls("views.publish").length === 1;
    }, "the Home drawn");

    await deliverEvent(openMessages(ALICE));
    await until((): boolean => {
      return welcomes().length === 1;
    }, "the welcome posted");
  });

  test("Slack refuses the welcome: logged, never thrown - Slack had its 200 - and the next open welcomes", async () => {
    refusals.set("chat.postMessage", "channel_not_found");

    const response: ProbeResponse = await deliverEvent(openMessages(ALICE));

    expect(response.status).toBe(200);
    await until((): boolean => {
      return errorLines.includes(
        "Could not welcome somebody to the Slack app's Messages tab.",
      );
    }, "the refusal logged");

    // It reached nobody, so it does not count.
    refusals.delete("chat.postMessage");

    await deliverEvent(openMessages(ALICE));
    await until((): boolean => {
      return welcomes().length === 2;
    }, "the welcome posted on the next open");

    // The one Slack refused, the one it took - and none after.
    await deliverEvent(openMessages(ALICE));
    await settle();

    expect(welcomes()).toHaveLength(2);
  });

  test("a workspace connected to no project: nobody welcomed, nothing asked of Slack", async () => {
    workspaceConnected = false;

    const response: ProbeResponse = await deliverEvent(openMessages(ALICE));

    expect(response.status).toBe(200);
    await settle();

    expect(slackCalls).toEqual([]);
  });
});

describe("a hello in a channel somebody adds the app to", () => {
  function joined(data: {
    user: string;
    inviter?: string | undefined;
    channel?: string | undefined;
  }): JSONObject {
    const event: JSONObject = {
      type: "member_joined_channel",
      user: data.user,
      channel: data.channel || OPS,
      channel_type: "C",
      team: TEAM_ID,
      event_ts: "1760000000.000300",
    };

    if (data.inviter) {
      event["inviter"] = data.inviter;
    }

    return eventCallback(event);
  }

  test("added by a person: one short hello in the channel, with where notifications are set up", async () => {
    const response: ProbeResponse = await deliverEvent(
      joined({ user: ONEUPTIME, inviter: ALICE }),
    );

    expect(response.status).toBe(200);
    await until((): boolean => {
      return calls("chat.postMessage").length === 1;
    }, "the hello posted");

    const post: SlackCall = calls("chat.postMessage")[0]!;
    expect(post.data["channel"]).toBe(OPS);
    expect(post.data["thread_ts"]).toBeUndefined();
    // What a notification of it says.
    expect(post.data["text"]).toBe(
      "Hi, I'm OneUptime. Mention me with a question, or type /oneuptime help.",
    );

    const blocks: Array<JSONObject> = post.data["blocks"] as Array<JSONObject>;
    expect(blockTexts(blocks)).toEqual([
      `👋 ${ZWSP}*Hi, I'm OneUptime.*${ZWSP} @mention me with a question about your incidents, monitors, logs and traces, or type \`/oneuptime help\` to declare an incident, page someone or see who is on call.\n`,
      `To post incidents, alerts or scheduled maintenance here, add a notification rule in OneUptime under ${ZWSP}*Incidents → Workspace → Slack*${ZWSP}.\n`,
    ]);

    const buttons: Array<JSONObject> = buttonsOf(blocks);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!["action_id"]).toBe("OpenInOneUptime");
    expect(buttons[0]!["url"]).toBe(
      `${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/workspace-connection-slack`,
    );
  });

  test("the app joined by itself (a channel it created, or one it posts in): no hello", async () => {
    await deliverEvent(joined({ user: ONEUPTIME }));
    await deliverEvent(joined({ user: ONEUPTIME, inviter: ONEUPTIME }));
    await settle();

    expect(slackCalls).toEqual([]);
  });

  test("a person joined, not the app: no hello", async () => {
    await deliverEvent(joined({ user: CAROL, inviter: ALICE }));
    await settle();

    expect(slackCalls).toEqual([]);
  });

  test("told twice, or retried by Slack: one hello", async () => {
    await deliverEvent(joined({ user: ONEUPTIME, inviter: ALICE }));
    await deliverEvent(joined({ user: ONEUPTIME, inviter: ALICE }));
    await deliverEvent(joined({ user: ONEUPTIME, inviter: ALICE }), {
      "x-slack-retry-num": "1",
    });
    await until((): boolean => {
      return calls("chat.postMessage").length >= 1;
    }, "the hello posted");
    await settle();

    expect(calls("chat.postMessage")).toHaveLength(1);
  });

  test("another channel gets its own hello", async () => {
    await deliverEvent(joined({ user: ONEUPTIME, inviter: ALICE }));
    await deliverEvent(
      joined({ user: ONEUPTIME, inviter: ALICE, channel: "C0OTHER" }),
    );
    await until((): boolean => {
      return calls("chat.postMessage").length === 2;
    }, "both hellos posted");
  });

  test("the link to OneUptime is acknowledged and asks for nothing, connected or not", async () => {
    const response: ProbeResponse = await press({
      type: "block_actions",
      user: { id: CAROL, username: "carol", name: "Carol" },
      team: { id: TEAM_ID },
      channel: { id: OPS, name: "ops" },
      container: { type: "message", channel_id: OPS },
      message: { ts: "1760000000.000900" },
      response_url: "https://hooks.slack.com/actions/T0ACME/1/abc",
      trigger_id: "1760000000.trigger",
      actions: [{ action_id: "OpenInOneUptime", type: "button" }],
    });

    expect(response.status).toBe(200);
    await settle();
    expect(slackCalls).toEqual([]);
  });

  test("the time a Home is drawn reads in each reader's own clock", () => {
    // The footer's moment is a Slack date once drawn.
    expect(
      WorkspaceMessageTime.toSlack(WorkspaceMessageTime.time(NOW).toString()),
    ).toContain(`<!date^${Math.floor(NOW.getTime() / 1000)}^{time}|17:15 UTC>`);
  });
});

/*
 * A SLACK WORKSPACE CONNECTED TO MORE THAN ONE PROJECT.
 *
 * The Home and the hellos used to be drawn for whichever of the workspace's
 * connections a lookup returned first: somebody connected only in the other
 * project saw a Home asking them to connect, and the Home's buttons acted in
 * that project too. Now the Home shows the project the person is in
 * (WorkspaceProjectResolution) and carries it, so its buttons act there.
 */
describe("a workspace connected to more than one project", () => {
  const OTHER_PROJECT: ObjectID = new ObjectID(
    "d0000000-0000-4000-8000-0000000000ee",
  );

  function connection(projectId: ObjectID): WorkspaceProjectAuthToken {
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.projectId = projectId;
    projectAuth.authToken = SLACK_PROJECT_TOKEN;
    projectAuth.miscData = { botUserId: ONEUPTIME } as never;
    return projectAuth;
  }

  beforeEach(() => {
    // The other project was connected first: the one a lookup returned first.
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([connection(OTHER_PROJECT), connection(PROJECT_ID)]);

    // Who is connected in which project: Alice in this one only.
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockImplementation((async (findBy: {
        query: { workspaceUserId: string };
      }) => {
        const userId: ObjectID | undefined = linked.get(
          findBy.query.workspaceUserId,
        );

        if (!userId) {
          return [];
        }

        const link: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
        link.projectId = PROJECT_ID;
        link.userId = userId;
        return [link];
      }) as never);

    // No record owns the channels, and no project has posted in them.
    for (const service of [
      IncidentEpisodeService,
      AlertEpisodeService,
      ScheduledMaintenanceService,
    ] as unknown as Array<{ findBy: () => Promise<unknown> }>) {
      jest.spyOn(service, "findBy").mockResolvedValue([] as never);
    }

    jest
      .spyOn(WorkspaceNotificationLogService, "findOneBy")
      .mockResolvedValue(null);
  });

  test("the Home shows the project the person is in, and carries it for its buttons", async () => {
    await deliverEvent(openHome(ALICE));
    await until((): boolean => {
      return calls("views.publish").length === 1;
    }, "the Home drawn");

    const view: JSONObject = calls("views.publish")[0]!.data[
      "view"
    ] as JSONObject;

    expect(JSON.parse(view["private_metadata"] as string)).toEqual({
      oneuptime: 1,
      value: "",
      projectId: PROJECT_ID.toString(),
    });
    // Her Home, read in her project.
    expect(blockTexts(publishedBlocks()).join("\n")).toContain(
      "Acme Production",
    );
    expect(onCallReads.length).toBeGreaterThan(0);
  });

  test("somebody connected in neither: where to connect - no one project's Connect button", async () => {
    await deliverEvent(openHome(CAROL));
    await until((): boolean => {
      return calls("views.publish").length === 1;
    }, "the Home drawn");

    const blocks: Array<JSONObject> = publishedBlocks();

    expect(buttonsOf(blocks)).toEqual([]);
    expect(blockTexts(blocks).join("\n")).toContain(
      "User Settings → Workspace → Slack",
    );
    // No button, so no "one click" promised.
    expect(blockTexts(blocks).join("\n")).not.toContain("one click");
    expect(JSON.stringify(blocks)).not.toContain(DASHBOARD_URL);
  });

  test("the hello in a channel nothing ties to a project, added by somebody in neither: no one project's rules linked", async () => {
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);

    await deliverEvent(
      eventCallback({
        type: "member_joined_channel",
        user: ONEUPTIME,
        channel: "C0NEWCHANNEL",
        channel_type: "C",
        team: TEAM_ID,
        inviter: CAROL,
        event_ts: "1760000000.000300",
      }),
    );
    await until((): boolean => {
      return calls("chat.postMessage").length === 1;
    }, "the hello posted");

    const blocks: Array<JSONObject> = calls("chat.postMessage")[0]!.data[
      "blocks"
    ] as Array<JSONObject>;

    expect(blockTexts(blocks)[1]).toContain("Incidents → Workspace → Slack");
    expect(buttonsOf(blocks)).toEqual([]);
  });

  test("the hello, added by somebody in one of the projects: that project's rules linked", async () => {
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);

    await deliverEvent(
      eventCallback({
        type: "member_joined_channel",
        user: ONEUPTIME,
        channel: "C0NEWCHANNEL",
        channel_type: "C",
        team: TEAM_ID,
        inviter: ALICE,
        event_ts: "1760000000.000301",
      }),
    );
    await until((): boolean => {
      return calls("chat.postMessage").length === 1;
    }, "the hello posted");

    const buttons: Array<JSONObject> = buttonsOf(
      calls("chat.postMessage")[0]!.data["blocks"] as Array<JSONObject>,
    );

    expect(buttons).toHaveLength(1);
    expect(buttons[0]!["url"]).toBe(
      `${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/workspace-connection-slack`,
    );
  });

  test("a press of the Home's button acts in the project the Home carries", async () => {
    const button: JSONObject = homeButton("ShowOnCall");
    (button["view"] as JSONObject)["private_metadata"] = JSON.stringify({
      oneuptime: 1,
      value: "",
      projectId: PROJECT_ID.toString(),
    });

    await press(button);
    await until((): boolean => {
      return calls("views.open").length === 1;
    }, "the answer opened");

    const getMemberProps: unknown =
      WorkspaceActionAuthorization.getProjectMemberProps;
    const projectIds: Array<string> = (
      getMemberProps as { mock: { calls: Array<Array<unknown>> } }
    ).mock.calls.map((call: Array<unknown>): string => {
      return String((call[0] as { projectId: ObjectID }).projectId);
    });

    expect(projectIds).toEqual([PROJECT_ID.toString()]);
  });
});

/*
 * SOMEBODY IN SEVERAL OF A SHARED WORKSPACE'S PROJECTS: SWITCH PROJECT.
 *
 * A company connects one Slack workspace to several OneUptime projects, and
 * its people are members of more than one of them. The Home showed each of
 * them only the first of their projects, with no way to see another. Now
 * the Home of somebody connected as a member in two or more of them has a
 * Switch project menu beside the line that names the project, listing their
 * others by name. Choosing one draws the Home again for it, and their later
 * openings show it while they are still a member there - otherwise the
 * first of their projects. Nobody with one project sees anything new, and
 * the menu never offers - nor a press ever draws - a project where the
 * Slack account is not connected to a current member.
 *
 * Through the real router and Home, against a recorded Slack: who is
 * connected where, and who is a member of which project, are stood in for.
 */
describe("a person in several of the workspace's projects: Switch project", () => {
  const PRODUCTION: ObjectID = new ObjectID(
    "d2000000-0000-4000-8000-000000000001",
  );
  const STAGING: ObjectID = new ObjectID(
    "d2000000-0000-4000-8000-000000000002",
  );
  const SANDBOX: ObjectID = new ObjectID(
    "d2000000-0000-4000-8000-000000000003",
  );
  // Connected to the workspace too; Alice's Slack account is not connected there.
  const FINANCE: ObjectID = new ObjectID(
    "d2000000-0000-4000-8000-000000000004",
  );
  // A project of another Slack workspace, where Alice is in two projects too.
  const ELSEWHERE_TEAM_ID: string = "T0ELSEWHERE";
  const LAB: ObjectID = new ObjectID("d2000000-0000-4000-8000-000000000005");
  const STUDIO: ObjectID = new ObjectID("d2000000-0000-4000-8000-000000000006");

  const BOB: string = "U0BOB";
  const DAVE: string = "U0DAVE";
  const ERIN: string = "U0ERIN";
  const BOB_ID: ObjectID = new ObjectID("d2000000-0000-4000-8000-0000000000b0");
  const DAVE_ID: ObjectID = new ObjectID(
    "d2000000-0000-4000-8000-0000000000d0",
  );
  const ERIN_ID: ObjectID = new ObjectID(
    "d2000000-0000-4000-8000-0000000000e0",
  );

  const NAMES: Record<string, string> = {
    [PRODUCTION.toString()]: "Acme Production",
    [STAGING.toString()]: "Acme Staging",
    [SANDBOX.toString()]: "Acme Sandbox",
    [FINANCE.toString()]: "Acme Finance",
    [LAB.toString()]: "Elsewhere Lab",
    [STUDIO.toString()]: "Elsewhere Studio",
  };

  const USERS: Record<string, ObjectID> = {
    [ALICE]: ALICE_ID,
    [BOB]: BOB_ID,
    [DAVE]: DAVE_ID,
    [ERIN]: ERIN_ID,
  };

  interface Link {
    teamId: string;
    slackUserId: string;
    projectId: ObjectID;
  }

  let connectionsByTeam: Record<string, Array<ObjectID>>;
  let links: Array<Link>;
  // "<user id> <project id>" of each current membership.
  let members: Set<string>;
  let memberPropsReads: Array<string>;
  let namesReadable: boolean;
  // Projects an administrator blocked: their members are refused there.
  let blocked: Set<string>;

  function memberKey(userId: ObjectID, projectId: ObjectID | string): string {
    return `${userId.toString()} ${projectId.toString().toLowerCase()}`;
  }

  // The ids a query's value names: an id, or QueryHelper.any's values.
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

  function connectionOf(
    projectId: ObjectID,
    teamId: string,
  ): WorkspaceProjectAuthToken {
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.projectId = projectId;
    projectAuth.workspaceProjectId = teamId;
    projectAuth.authToken = `xoxb-${projectId.toString().substring(0, 8)}`;
    projectAuth.miscData = { botUserId: ONEUPTIME } as never;
    return projectAuth;
  }

  function linksMatching(query: JSONObject): Array<WorkspaceUserAuthToken> {
    const projectIds: Array<string> = idsOf(query["projectId"]);
    const workspaceUserIds: Array<string> = idsOf(query["workspaceUserId"]);

    return links
      .filter((link: Link): boolean => {
        return (
          workspaceUserIds.includes(link.slackUserId.toLowerCase()) &&
          (projectIds.length === 0 ||
            projectIds.includes(link.projectId.toString().toLowerCase()))
        );
      })
      .map((link: Link): WorkspaceUserAuthToken => {
        const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
        userAuth.projectId = link.projectId;
        userAuth.userId = USERS[link.slackUserId]!;
        userAuth.workspaceUserId = link.slackUserId;
        userAuth.authToken = "xoxp-user-token";
        return userAuth;
      });
  }

  beforeEach(() => {
    connectionsByTeam = {
      // In the order they were connected: Production first.
      [TEAM_ID]: [PRODUCTION, STAGING, SANDBOX, FINANCE],
      [ELSEWHERE_TEAM_ID]: [LAB, STUDIO],
    };
    links = [
      ...[PRODUCTION, STAGING, SANDBOX].map((projectId: ObjectID): Link => {
        return { teamId: TEAM_ID, slackUserId: ALICE, projectId: projectId };
      }),
      { teamId: TEAM_ID, slackUserId: BOB, projectId: STAGING },
      { teamId: TEAM_ID, slackUserId: DAVE, projectId: PRODUCTION },
      { teamId: TEAM_ID, slackUserId: DAVE, projectId: STAGING },
      ...[PRODUCTION, STAGING, SANDBOX].map((projectId: ObjectID): Link => {
        return { teamId: TEAM_ID, slackUserId: ERIN, projectId: projectId };
      }),
      { teamId: ELSEWHERE_TEAM_ID, slackUserId: ALICE, projectId: LAB },
      { teamId: ELSEWHERE_TEAM_ID, slackUserId: ALICE, projectId: STUDIO },
    ];
    members = new Set<string>([
      memberKey(ALICE_ID, PRODUCTION),
      memberKey(ALICE_ID, STAGING),
      memberKey(ALICE_ID, SANDBOX),
      memberKey(ALICE_ID, LAB),
      memberKey(ALICE_ID, STUDIO),
      memberKey(BOB_ID, STAGING),
      // Dave was removed from Acme Staging; his account is still connected there.
      memberKey(DAVE_ID, PRODUCTION),
      memberKey(ERIN_ID, PRODUCTION),
      memberKey(ERIN_ID, STAGING),
      memberKey(ERIN_ID, SANDBOX),
    ]);
    memberPropsReads = [];
    namesReadable = true;
    blocked = new Set<string>();

    // The workspaces' connections, oldest first, as the resolver reads them.
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockImplementation((async (findBy: { query: JSONObject }) => {
        const teamId: string = String(findBy.query["workspaceProjectId"]);

        return (connectionsByTeam[teamId] || []).map(
          (projectId: ObjectID): WorkspaceProjectAuthToken => {
            return connectionOf(projectId, teamId);
          },
        );
      }) as never);
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockImplementation((async (getProjectAuth: { projectId: ObjectID }) => {
        for (const [teamId, projectIds] of Object.entries(connectionsByTeam)) {
          if (
            projectIds.some((projectId: ObjectID): boolean => {
              return (
                projectId.toString() === getProjectAuth.projectId.toString()
              );
            })
          ) {
            return connectionOf(getProjectAuth.projectId, teamId);
          }
        }

        return null;
      }) as never);

    // Who connected which Slack account in which project.
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockImplementation((async (findBy: { query: JSONObject }) => {
        return linksMatching(findBy.query);
      }) as never);
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockImplementation((async (findOneBy: { query: JSONObject }) => {
        return linksMatching(findOneBy.query)[0] || null;
      }) as never);

    // Who is a member of which project, now.
    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockImplementation((async (data: {
        userId: ObjectID;
        projectId: ObjectID;
      }) => {
        return members.has(memberKey(data.userId, data.projectId));
      }) as never);
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation((async (data: {
        userId: ObjectID;
        projectId: ObjectID;
      }) => {
        memberPropsReads.push(data.projectId.toString());

        if (!members.has(memberKey(data.userId, data.projectId))) {
          throw new NotAuthorizedException(
            WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
          );
        }

        if (blocked.has(data.projectId.toString())) {
          throw new NotAuthorizedException(ExceptionMessages.ProjectBlocked);
        }

        return { userId: data.userId, tenantId: data.projectId };
      }) as never);

    // The projects' names: for the line that names one, and for the menu.
    jest
      .spyOn(ProjectService, "findOneById")
      .mockImplementation((async (findOneById: { id: ObjectID }) => {
        const project: Project = new Project();
        project.name = NAMES[findOneById.id.toString()]!;
        return project;
      }) as never);
    jest.spyOn(ProjectService, "findBy").mockImplementation((async (findBy: {
      query: JSONObject;
    }) => {
      if (!namesReadable) {
        throw new Error("connection refused");
      }

      return idsOf(findBy.query["_id"]).map((id: string): Project => {
        const project: Project = new Project();
        project.id = new ObjectID(id);
        project.name = NAMES[id]!;
        return project;
      });
    }) as never);

    // No record owns a channel, and no project has posted in one.
    for (const service of [
      IncidentEpisodeService,
      AlertEpisodeService,
      ScheduledMaintenanceService,
    ] as unknown as Array<{ findBy: () => Promise<unknown> }>) {
      jest.spyOn(service, "findBy").mockResolvedValue([] as never);
    }

    jest
      .spyOn(WorkspaceNotificationLogService, "findOneBy")
      .mockResolvedValue(null);
  });

  function openHomeIn(teamId: string, user: string): JSONObject {
    const event: JSONObject = openHome(user);
    event["team_id"] = teamId;
    return event;
  }

  /*
   * What Slack posts when an option of the Home's Switch project menu is
   * chosen: the Home view, which carries the project it shows, and the
   * menu's chosen option.
   */
  function switchTo(data: {
    value: unknown;
    shown: ObjectID;
    user?: string | undefined;
    teamId?: string | undefined;
  }): JSONObject {
    // Any value a press may carry, as Slack would post it.
    const payload: Record<string, unknown> = {
      type: "block_actions",
      user: {
        id: data.user || ALICE,
        username: "alice",
        name: "Alice",
        team_id: data.teamId || TEAM_ID,
      },
      api_app_id: "A0ONEUPTIME",
      team: { id: data.teamId || TEAM_ID },
      container: { type: "view", view_id: "V0HOME" },
      trigger_id: "1760000000.home-trigger",
      view: {
        id: "V0HOME",
        type: "home",
        blocks: [],
        private_metadata: JSON.stringify({
          oneuptime: 1,
          value: "",
          projectId: data.shown.toString(),
        }),
        callback_id: "",
        state: { values: {} },
      },
      actions: [
        {
          type: "static_select",
          action_id: "SwitchHomeProject",
          block_id: `SwitchHomeProject:${data.shown.toString()}`,
          selected_option: {
            text: { type: "plain_text", text: "a project", emoji: true },
            value: data.value,
          },
          placeholder: {
            type: "plain_text",
            text: "Switch project",
            emoji: true,
          },
          action_ts: "1760000001.000300",
        },
      ],
    };

    return payload as JSONObject;
  }

  interface DrawnHome {
    projectId: string;
    projectLine: string;
    // The menu's options, by name and value; null without a menu.
    menu: Array<{ name: string; value: string }> | null;
    menuBlockId: string | null;
    // The text the menu is drawn beside.
    menuBeside: string | null;
    texts: Array<string>;
    json: string;
  }

  // The Home drawn last: the project it carries, its line and its menu.
  function lastHome(): DrawnHome {
    const publishes: Array<SlackCall> = calls("views.publish");
    const view: JSONObject = publishes[publishes.length - 1]!.data[
      "view"
    ] as JSONObject;
    const blocks: Array<JSONObject> = view["blocks"] as Array<JSONObject>;
    const withMenus: Array<JSONObject> = blocks.filter(
      (block: JSONObject): boolean => {
        return Boolean(block["accessory"]);
      },
    );

    expect(withMenus.length).toBeLessThanOrEqual(1);

    const line: JSONObject | undefined = blocks.find(
      (block: JSONObject): boolean => {
        return (
          block["type"] === "section" &&
          String((block["text"] as JSONObject)["text"]).includes(
            "Here's what is happening in",
          )
        );
      },
    );
    // The menu: beside the project's line, or beside why the project was refused.
    const menuBlock: JSONObject | undefined = withMenus[0];
    const accessory: JSONObject | undefined = menuBlock?.["accessory"] as
      | JSONObject
      | undefined;

    return {
      projectId: String(
        JSON.parse(view["private_metadata"] as string)["projectId"],
      ),
      projectLine: line
        ? String((line["text"] as JSONObject)["text"])
            .split(ZWSP)
            .join("")
        : "",
      menu: accessory
        ? (accessory["options"] as Array<JSONObject>).map(
            (option: JSONObject): { name: string; value: string } => {
              return {
                name: String((option["text"] as JSONObject)["text"]),
                value: String(option["value"]),
              };
            },
          )
        : null,
      menuBlockId: accessory ? String(menuBlock!["block_id"]) : null,
      menuBeside: menuBlock
        ? String((menuBlock["text"] as JSONObject)["text"])
            .split(ZWSP)
            .join("")
        : null,
      texts: blockTexts(blocks).map((text: string): string => {
        return text.split(ZWSP).join("");
      }),
      json: JSON.stringify(view),
    };
  }

  // The names a menu lists.
  function namesIn(home: DrawnHome): Array<string> | null {
    return home.menu
      ? home.menu.map((option: { name: string }): string => {
          return option.name;
        })
      : null;
  }

  async function opened(
    user: string = ALICE,
    teamId: string = TEAM_ID,
  ): Promise<DrawnHome> {
    const count: number = calls("views.publish").length;

    expect((await deliverEvent(openHomeIn(teamId, user))).status).toBe(200);
    await until((): boolean => {
      return calls("views.publish").length === count + 1;
    }, "the Home drawn");

    return lastHome();
  }

  async function switched(data: {
    value: unknown;
    shown: ObjectID;
    user?: string | undefined;
    teamId?: string | undefined;
  }): Promise<DrawnHome> {
    const count: number = calls("views.publish").length;

    expect((await press(switchTo(data))).status).toBe(200);
    await until((): boolean => {
      return calls("views.publish").length === count + 1;
    }, "the Home drawn again");

    return lastHome();
  }

  // Lets the ten seconds pass in which opening the Home again draws nothing.
  function later(): void {
    clockOffsetInMs += 11 * 1000;
  }

  // What is kept of the project chosen for a Home, by its cache key.
  function rememberedHomes(): Array<{ value: string; expiresAt: number }> {
    const store: Map<string, { value: string; expiresAt: number }> = (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { store: Map<string, { value: string; expiresAt: number }> };
      }
    ).default.store;

    return Array.from(store.entries())
      .filter(([key]: [string, unknown]): boolean => {
        return key.startsWith("slack-project-choice-home-");
      })
      .map(([, entry]: [string, { value: string; expiresAt: number }]) => {
        return entry;
      });
  }

  const REFUSED: string =
    "⚠️ You can't switch to that project: you're no longer a member of it, or your Slack account isn't connected there.\n";

  test("Alice, a member in three of the four projects: the first one's Home, with Switch project beside its name, listing her other two - never the one she is not connected in", async () => {
    const home: DrawnHome = await opened();

    expect(home.projectId).toBe(PRODUCTION.toString());
    expect(home.projectLine).toBe(
      "Here's what is happening in *Acme Production*.\n",
    );
    expect(home.menu).toEqual([
      { name: "Acme Staging", value: STAGING.toString() },
      { name: "Acme Sandbox", value: SANDBOX.toString() },
    ]);
    expect(home.menuBlockId).toBe(`SwitchHomeProject:${PRODUCTION.toString()}`);
    expect(home.menuBeside).toBe(home.projectLine);
    expect(home.json).not.toContain("Acme Finance");
    expect(home.json).not.toContain(FINANCE.toString());

    // The select itself, as Slack draws it beside the line.
    const view: JSONObject = calls("views.publish")[0]!.data[
      "view"
    ] as JSONObject;
    const line: JSONObject = (view["blocks"] as Array<JSONObject>)[1]!;
    const accessory: JSONObject = line["accessory"] as JSONObject;

    expect(accessory["type"]).toBe("static_select");
    expect(accessory["action_id"]).toBe("SwitchHomeProject");
    expect((accessory["placeholder"] as JSONObject)["text"]).toBe(
      "Switch project",
    );
    expect(accessory["initial_option"]).toBeUndefined();

    // The rest of the Home, as anybody's: the buttons right under it.
    expect(
      (view["blocks"] as Array<JSONObject>).map(
        (block: JSONObject): unknown => {
          return block["type"];
        },
      ),
    ).toEqual([
      "header",
      "section",
      "actions",
      "divider",
      "section",
      "section",
      "divider",
      "section",
      "section",
      "section",
      "divider",
      "context",
    ]);

    // Read as Alice, in Acme Production.
    expect(memberPropsReads).toEqual([PRODUCTION.toString()]);
    expect(String((onCallReads[0]!["props"] as JSONObject)["tenantId"])).toBe(
      PRODUCTION.toString(),
    );
  });

  test("Bob, in one of the projects: his project's Home, and no menu - nothing new", async () => {
    const home: DrawnHome = await opened(BOB);

    expect(home.projectId).toBe(STAGING.toString());
    expect(home.projectLine).toContain("Acme Staging");
    expect(home.menu).toBeNull();
    expect(home.json).not.toContain("static_select");
    expect(home.json).not.toContain("SwitchHomeProject");
  });

  test("Dave, connected in two projects but a member of one: that one, and no menu - never the project he was removed from", async () => {
    const home: DrawnHome = await opened(DAVE);

    expect(home.projectId).toBe(PRODUCTION.toString());
    expect(home.menu).toBeNull();
    expect(home.json).not.toContain("Acme Staging");
  });

  test("a workspace connected to one project: no menu, and no choice is ever looked up", async () => {
    connectionsByTeam[TEAM_ID] = [PRODUCTION];

    // The in-memory cache keeps the calls of every test: these are this one's.
    const cache: { getString: { mock: { calls: Array<Array<unknown>> } } } = (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { getString: { mock: { calls: Array<Array<unknown>> } } };
      }
    ).default;
    const callsBefore: number = cache.getString.mock.calls.length;

    const home: DrawnHome = await opened();

    expect(home.projectId).toBe(PRODUCTION.toString());
    expect(home.menu).toBeNull();
    expect(
      cache.getString.mock.calls
        .slice(callsBefore)
        .filter((call: Array<unknown>): boolean => {
          return call[0] === "slack-project-choice-home";
        }),
    ).toEqual([]);
  });

  test("choosing Acme Staging: Slack is answered at once, and the Home is drawn again for it - its lists read as Alice there, its buttons carrying it, the menu listing her others", async () => {
    await opened();
    onCallReads = [];
    memberPropsReads = [];

    const home: DrawnHome = await switched({
      value: STAGING.toString(),
      shown: PRODUCTION,
    });

    expect(home.projectId).toBe(STAGING.toString());
    expect(home.projectLine).toBe(
      "Here's what is happening in *Acme Staging*.\n",
    );
    expect(namesIn(home)).toEqual(["Acme Production", "Acme Sandbox"]);
    expect(home.menuBlockId).toBe(`SwitchHomeProject:${STAGING.toString()}`);
    // Switched as asked: nothing to explain.
    expect(home.texts).not.toContain(REFUSED);

    expect(memberPropsReads).toEqual([STAGING.toString()]);
    expect(onCallReads.length).toBeGreaterThan(0);
    for (const read of onCallReads) {
      expect(String((read["props"] as JSONObject)["tenantId"])).toBe(
        STAGING.toString(),
      );
      expect(String((read["props"] as JSONObject)["userId"])).toBe(
        ALICE_ID.toString(),
      );
    }

    // Drawn for Alice, with the workspace's token, as Slack has it.
    const publish: SlackCall = calls("views.publish")[1]!;
    expect(publish.data["user_id"]).toBe(ALICE);
    expect(calls("views.open")).toEqual([]);
    expect(calls("chat.postMessage")).toEqual([]);
  });

  test("the choice is remembered: her next opening shows Acme Staging, and her choice after that, Acme Sandbox", async () => {
    await opened();
    await switched({ value: STAGING.toString(), shown: PRODUCTION });

    later();
    const next: DrawnHome = await opened();

    expect(next.projectId).toBe(STAGING.toString());
    expect(namesIn(next)).toEqual(["Acme Production", "Acme Sandbox"]);

    await switched({ value: SANDBOX.toString(), shown: STAGING });

    later();
    expect((await opened()).projectId).toBe(SANDBOX.toString());

    // One choice kept for her in this workspace, the last.
    expect(rememberedHomes()).toHaveLength(1);
    expect(rememberedHomes()[0]!.value).toBe(SANDBOX.toString());
  });

  test("kept for each person in each workspace: Erin, in the same three, still sees the first; Alice's Home elsewhere is her own", async () => {
    await opened();
    await switched({ value: STAGING.toString(), shown: PRODUCTION });

    expect((await opened(ERIN)).projectId).toBe(PRODUCTION.toString());

    const elsewhere: DrawnHome = await opened(ALICE, ELSEWHERE_TEAM_ID);

    expect(elsewhere.projectId).toBe(LAB.toString());
    expect(namesIn(elsewhere)).toEqual(["Elsewhere Studio"]);
    // Nothing of this workspace's projects there.
    expect(elsewhere.json).not.toContain("Acme");
  });

  test("kept while she goes on opening it: each opening keeps it for ninety days again", async () => {
    await opened();
    await switched({ value: STAGING.toString(), shown: PRODUCTION });

    const ninetyDays: number = 90 * 24 * 60 * 60 * 1000;
    const keptAt: number = rememberedHomes()[0]!.expiresAt;

    expect(keptAt - Date.now()).toBeGreaterThan(ninetyDays - 60000);

    // Sixty days on, she opens it: kept for ninety days from then.
    clockOffsetInMs += 60 * 24 * 60 * 60 * 1000;

    expect((await opened()).projectId).toBe(STAGING.toString());
    expect(rememberedHomes()[0]!.expiresAt - Date.now()).toBeGreaterThan(
      ninetyDays - 60000,
    );
    expect(rememberedHomes()[0]!.expiresAt).toBeGreaterThan(keptAt);
  });

  test("removed from the project she chose: her next opening falls back to the first, the menu listing only what she is still in", async () => {
    await opened();
    await switched({ value: STAGING.toString(), shown: PRODUCTION });

    members.delete(memberKey(ALICE_ID, STAGING));
    memberPropsReads = [];

    later();
    const home: DrawnHome = await opened();

    expect(home.projectId).toBe(PRODUCTION.toString());
    expect(namesIn(home)).toEqual(["Acme Sandbox"]);
    expect(home.json).not.toContain("Acme Staging");
    // Nothing read in the project she left.
    expect(memberPropsReads).toEqual([PRODUCTION.toString()]);
    // An opening is not a switch: nothing to explain.
    expect(home.texts).not.toContain(REFUSED);
  });

  test("removed from all but one: the first project she is still in, and no menu", async () => {
    await opened();
    await switched({ value: SANDBOX.toString(), shown: PRODUCTION });

    members.delete(memberKey(ALICE_ID, SANDBOX));
    members.delete(memberKey(ALICE_ID, PRODUCTION));

    later();
    const home: DrawnHome = await opened();

    expect(home.projectId).toBe(STAGING.toString());
    expect(home.menu).toBeNull();
  });

  test("her Slack account disconnected in the project she chose: the first project again", async () => {
    await opened();
    await switched({ value: STAGING.toString(), shown: PRODUCTION });

    links = links.filter((link: Link): boolean => {
      return !(
        link.slackUserId === ALICE &&
        link.projectId.toString() === STAGING.toString()
      );
    });

    later();
    const home: DrawnHome = await opened();

    expect(home.projectId).toBe(PRODUCTION.toString());
    expect(namesIn(home)).toEqual(["Acme Sandbox"]);
  });

  test("the project she chose disconnected from the workspace: the first project again", async () => {
    await opened();
    await switched({ value: SANDBOX.toString(), shown: PRODUCTION });

    connectionsByTeam[TEAM_ID] = [PRODUCTION, STAGING, FINANCE];

    later();
    const home: DrawnHome = await opened();

    expect(home.projectId).toBe(PRODUCTION.toString());
    expect(namesIn(home)).toEqual(["Acme Staging"]);
  });

  test("taken back into the project she chose: shown again - her choice still stands", async () => {
    await opened();
    await switched({ value: STAGING.toString(), shown: PRODUCTION });

    members.delete(memberKey(ALICE_ID, STAGING));
    later();
    expect((await opened()).projectId).toBe(PRODUCTION.toString());

    members.add(memberKey(ALICE_ID, STAGING));
    later();
    expect((await opened()).projectId).toBe(STAGING.toString());
  });

  test("removed from a project after the menu was drawn, then choosing it: told she can't switch, her Home stays where it was - nothing of it read, nothing remembered", async () => {
    await opened();

    members.delete(memberKey(ALICE_ID, STAGING));
    memberPropsReads = [];

    const home: DrawnHome = await switched({
      value: STAGING.toString(),
      shown: PRODUCTION,
    });

    expect(home.projectId).toBe(PRODUCTION.toString());
    expect(home.texts[1]).toBe(REFUSED);
    expect(home.projectLine).toContain("Acme Production");
    expect(namesIn(home)).toEqual(["Acme Sandbox"]);
    expect(memberPropsReads).toEqual([PRODUCTION.toString()]);
    expect(rememberedHomes()).toEqual([]);
  });

  test("a press she could not have made - a project she is not connected in, one of another workspace, none at all - draws nothing of it: her Home as it opens, saying she can't switch, and nothing remembered", async () => {
    await opened();
    await switched({ value: SANDBOX.toString(), shown: PRODUCTION });

    for (const value of [
      FINANCE.toString(),
      LAB.toString(),
      ObjectID.generate().toString(),
      "not-a-project",
      "",
      42,
    ]) {
      memberPropsReads = [];

      const home: DrawnHome = await switched({ value: value, shown: SANDBOX });

      // Her Home as it opens: the project she chose last.
      expect({ value, projectId: home.projectId }).toEqual({
        value,
        projectId: SANDBOX.toString(),
      });
      expect(home.texts[1]).toBe(REFUSED);
      expect(memberPropsReads).toEqual([SANDBOX.toString()]);
      expect(home.json).not.toContain("Acme Finance");
      expect(home.json).not.toContain("Elsewhere");
      expect(
        rememberedHomes().map((entry: { value: string }) => {
          return entry.value;
        }),
      ).toEqual([SANDBOX.toString()]);
    }
  });

  test("a press naming another workspace's project, sent as from that workspace's Home, never mixes the two: drawn as the press's own workspace opens", async () => {
    await opened(ALICE, ELSEWHERE_TEAM_ID);

    const home: DrawnHome = await switched({
      value: STAGING.toString(),
      shown: LAB,
      teamId: ELSEWHERE_TEAM_ID,
    });

    expect(home.projectId).toBe(LAB.toString());
    expect(home.texts[1]).toBe(REFUSED);
    expect(home.json).not.toContain("Acme");
  });

  test("Bob, in one project, sending a press for another: his one project's Home, told he can't switch, and no menu", async () => {
    const home: DrawnHome = await switched({
      value: PRODUCTION.toString(),
      shown: STAGING,
      user: BOB,
    });

    expect(home.projectId).toBe(STAGING.toString());
    expect(home.texts[1]).toBe(REFUSED);
    expect(home.menu).toBeNull();
    expect(home.json).not.toContain("Acme Production");
    expect(rememberedHomes()).toEqual([]);
  });

  test("somebody connected in none of the projects, sending a press: told where to connect - no project drawn, nothing remembered", async () => {
    const home: DrawnHome = await switched({
      value: PRODUCTION.toString(),
      shown: PRODUCTION,
      user: CAROL,
    });

    expect(home.texts.join("\n")).toContain(
      "User Settings → Workspace → Slack",
    );
    expect(home.menu).toBeNull();
    expect(memberPropsReads).toEqual([]);
    expect(onCallReads).toEqual([]);
    expect(rememberedHomes()).toEqual([]);
  });

  test("the project her Home opens on is refused - blocked by an administrator: told why, with the menu of her others beside it, so she is never stuck there", async () => {
    await opened();
    await switched({ value: STAGING.toString(), shown: PRODUCTION });

    blocked.add(STAGING.toString());

    later();
    const readsBefore: number = onCallReads.length;
    const home: DrawnHome = await opened();

    expect(home.projectId).toBe(STAGING.toString());
    expect(home.texts).toContain(`${ExceptionMessages.ProjectBlocked}\n`);
    expect(home.menuBeside).toBe(`${ExceptionMessages.ProjectBlocked}\n`);
    expect(namesIn(home)).toEqual(["Acme Production", "Acme Sandbox"]);
    // Nothing of the blocked project is shown.
    expect(home.json).not.toContain("Here's what is happening");
    expect(onCallReads).toHaveLength(readsBefore);

    const away: DrawnHome = await switched({
      value: PRODUCTION.toString(),
      shown: STAGING,
    });

    expect(away.projectId).toBe(PRODUCTION.toString());
    expect(away.projectLine).toContain("Acme Production");
    expect(namesIn(away)).toEqual(["Acme Staging", "Acme Sandbox"]);

    later();
    expect((await opened()).projectId).toBe(PRODUCTION.toString());
  });

  test("the projects cannot be named: the Home of the first, with no menu - never a nameless option", async () => {
    namesReadable = false;

    const home: DrawnHome = await opened();

    expect(home.projectId).toBe(PRODUCTION.toString());
    expect(home.projectLine).toContain("Acme Production");
    expect(home.menu).toBeNull();
  });

  test("the cache is down: the Home of the first project; choosing still draws the one chosen, which her next opening cannot keep", async () => {
    interface CacheMethod {
      getMockImplementation: () => unknown;
      mockImplementation: (implementation: never) => unknown;
    }

    // The in-memory cache's own methods, put back once this is done.
    const cache: { getString: CacheMethod; setString: CacheMethod } = (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { getString: CacheMethod; setString: CacheMethod };
      }
    ).default;
    const realGetString: (...args: Array<unknown>) => Promise<unknown> =
      cache.getString.getMockImplementation() as (
        ...args: Array<unknown>
      ) => Promise<unknown>;
    const realSetString: (...args: Array<unknown>) => Promise<unknown> =
      cache.setString.getMockImplementation() as (
        ...args: Array<unknown>
      ) => Promise<unknown>;

    // Only what keeps a Home's project fails: the rest of the cache is up.
    for (const [method, real] of [
      [cache.getString, realGetString],
      [cache.setString, realSetString],
    ] as Array<[CacheMethod, (...args: Array<unknown>) => Promise<unknown>]>) {
      method.mockImplementation((async (
        namespace: string,
        ...rest: Array<unknown>
      ) => {
        if (namespace === "slack-project-choice-home") {
          throw new Error("connection refused");
        }

        return await real(namespace, ...rest);
      }) as never);
    }

    try {
      expect((await opened()).projectId).toBe(PRODUCTION.toString());
      expect(
        (await switched({ value: STAGING.toString(), shown: PRODUCTION }))
          .projectId,
      ).toBe(STAGING.toString());

      later();
      expect((await opened()).projectId).toBe(PRODUCTION.toString());
      expect(rememberedHomes()).toEqual([]);
    } finally {
      cache.getString.mockImplementation(realGetString as never);
      cache.setString.mockImplementation(realSetString as never);
    }
  });

  test("a long project name: cut in the menu to what Slack takes, named in full on the Home it chooses", async () => {
    const longName: string =
      `Acme Staging ${"for the payments platform ".repeat(4)}`.trim();
    NAMES[STAGING.toString()] = longName;

    try {
      const home: DrawnHome = await opened();
      const option: string = namesIn(home)![0]!;

      expect(longName.length).toBeGreaterThan(75);
      expect(option.length).toBeLessThanOrEqual(75);
      expect(option.endsWith("…")).toBe(true);

      const switchedHome: DrawnHome = await switched({
        value: STAGING.toString(),
        shown: PRODUCTION,
      });

      expect(switchedHome.projectLine).toContain(longName);
    } finally {
      NAMES[STAGING.toString()] = "Acme Staging";
    }
  });

  test("Slack refusing the Home drawn again: logged, never thrown - Slack had its 200", async () => {
    await opened();
    refusals.set("views.publish", "invalid_blocks");

    expect(
      (await press(switchTo({ value: STAGING.toString(), shown: PRODUCTION })))
        .status,
    ).toBe(200);
    await until((): boolean => {
      return errorLines.includes(
        "Could not switch a Slack Home to another project.",
      );
    }, "the refusal logged");
  });

  test("the Home's buttons, once switched, act in the project it now shows", async () => {
    await opened();
    await switched({ value: STAGING.toString(), shown: PRODUCTION });

    const publishes: Array<SlackCall> = calls("views.publish");
    const view: JSONObject = publishes[publishes.length - 1]!.data[
      "view"
    ] as JSONObject;
    const button: JSONObject = homeButton("ShowOnCall");
    (button["view"] as JSONObject)["private_metadata"] =
      view["private_metadata"];

    memberPropsReads = [];

    await press(button);
    await until((): boolean => {
      return calls("views.open").length === 1;
    }, "the answer opened");

    expect(memberPropsReads.length).toBeGreaterThan(0);
    for (const projectId of memberPropsReads) {
      expect(projectId).toBe(STAGING.toString());
    }
  });

  test("just connected in Acme Sandbox: the Home shows it, with the menu of her others, and her next opening too", async () => {
    await SlackHome.refreshAfterConnect({
      projectId: SANDBOX,
      slackUserId: ALICE,
    });

    const home: DrawnHome = lastHome();

    expect(home.projectId).toBe(SANDBOX.toString());
    expect(namesIn(home)).toEqual(["Acme Production", "Acme Staging"]);
    expect(home.texts).not.toContain(REFUSED);

    expect((await opened()).projectId).toBe(SANDBOX.toString());
  });

  test("just connected, but not a member of the project: told so there - the menu of no other project, nothing remembered", async () => {
    members.delete(memberKey(ALICE_ID, FINANCE));
    links.push({ teamId: TEAM_ID, slackUserId: ALICE, projectId: FINANCE });

    await SlackHome.refreshAfterConnect({
      projectId: FINANCE,
      slackUserId: ALICE,
    });

    const home: DrawnHome = lastHome();

    expect(home.projectId).toBe(FINANCE.toString());
    expect(home.texts).toContain(
      `${WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE}\n`,
    );
    expect(home.menu).toBeNull();
    expect(rememberedHomes()).toEqual([]);
  });
});
