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
import Incident from "../../../Models/DatabaseModels/Incident";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentService from "../../../Server/Services/IncidentService";
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

    expect(texts[0]).toBe("👋 Hi Alice");
    expect(texts[1]).toContain("Here's what is happening in");
    expect(texts[1]).toContain("Acme Production");
    expect(texts[2]).toContain("Your on-call");
    expect(texts[2]).toContain(
      `🟢 You're on call in <${DASHBOARD_URL}/${PROJECT_ID.toString()}/on-call-duty/schedules/${PRIMARY.id!.toString()}|Primary> until <!date^${Math.floor(HANDOFF.getTime() / 1000)}^{date_short_pretty}|`,
    );
    expect(texts[3]).toContain("Open incidents");
    expect(texts[3]).toContain(
      `<${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/${CHECKOUT.id!.toString()}|INC-12>`,
    );
    expect(texts[3]).toContain("Checkout is down · Critical · Identified");
    expect(texts[4]).toContain("No open alerts.");

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

    // When it was drawn, in each reader's own time, and the commands.
    expect(texts[texts.length - 1]).toContain("Updated at <!date^");
    expect(texts[texts.length - 1]).toContain("/oneuptime help");

    // Read with Alice's own permissions, never as OneUptime.
    expect(onCallReads[0]!["props"]).toEqual(PROPS);
    expect(incidentReads[0]!["props"]).toEqual(PROPS);
  });

  test("the Messages tab opened: nothing drawn", async () => {
    await deliverEvent(openHome(ALICE, "messages"));
    await settle();

    expect(slackCalls).toEqual([]);
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
      "👋 OneUptime",
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
