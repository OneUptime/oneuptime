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
import { AddressInfo } from "net";
import express from "express";
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectCompletion, {
  WorkspaceConnectCompletionResult,
} from "../../../Server/Utils/Workspace/WorkspaceConnectCompletion";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestRecord,
} from "../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspaceReactionNote, {
  WorkspaceNoteResource,
  WorkspaceNoteResourceType,
} from "../../../Server/Utils/Workspace/WorkspaceReactionNote";
import { ConnectRequestOutcome } from "../../../Types/Workspace/ConnectCallback";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubReadableParents } from "../TestingUtils/ReadableParents";
import { mockProjectStates } from "../TestingUtils/Services/ProjectStatesHelper";

/*
 * A PINNED SLACK MESSAGE, SAVED AS A NOTE, END TO END.
 *
 * The customer's screenshot: Aidil asked in #inc-inc-8 "Not sure what's
 * happening here, is this triggered by something?" and Nitin pinned it. The
 * note was saved as Nitin's, at the time Nitin pinned it, as bare text, and
 * the channel got a reply with a link preview of OneUptime, the note posted
 * back into it, and Nitin an email - three copies of what was already
 * there.
 *
 * Now the note is Aidil's words, filed when he wrote them, saved by Nitin,
 * formatted as Slack showed them; the channel gets one short confirmation
 * in the message's thread, with no link preview; and the note's timeline
 * entry is not posted back into the channel.
 *
 * These post what Slack posts to /api/slack/events - pin_added, and
 * reaction_added for a 📌 or a 📣 - through the real router, the real note
 * services' create over in-memory tables, and the real Connect request and
 * completion (in an in-memory cache). Slack is a small fake that keeps the
 * channel's messages, answers what OneUptime reads, and records every
 * request, which these pin.
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
  const cache: {
    store: Map<string, unknown>;
  } = (
    jest.requireActual("./WorkspaceOAuthTestHelpers") as {
      createInMemoryGlobalCache: () => { store: Map<string, unknown> };
    }
  ).createInMemoryGlobalCache();

  return {
    __esModule: true,
    default: {
      ...cache,
      deleteKey: async (namespace: string, key: string): Promise<void> => {
        cache.store.delete(`${namespace}-${key}`);
      },
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

jest.setTimeout(60000);

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const TEAM_ID: string = "T0ACME";
const INC_CHANNEL: string = "C0INC8";
const SLACK_PROJECT_TOKEN: string = "xoxb-project-token";

// Nitin is connected; Aidil, who wrote the message, and Carol are not.
const NITIN: string = "U0NITIN";
const AIDIL: string = "U0AIDIL";
const CAROL: string = "U0CAROL";

const PROJECT_ID: ObjectID = new ObjectID(
  "d4724000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "d4724000-0000-4000-8000-000000000002",
);
const NITIN_ID: ObjectID = new ObjectID("d4724000-0000-4000-8000-0000000000a1");
const AIDIL_ID: ObjectID = new ObjectID("d4724000-0000-4000-8000-0000000000a2");
const CAROL_ID: ObjectID = new ObjectID("d4724000-0000-4000-8000-0000000000a3");

const INCIDENT_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;

// Slack's own: a zero-width space around a bold span it draws.
const ZWSP: string = "\u{200B}";

const PRIVATE_CONFIRMATION: string = `✅ Saved as a ${ZWSP}*private note*${ZWSP} on <${INCIDENT_LINK}|Incident INC-8>.`;
const PUBLIC_CONFIRMATION: string = `✅ Saved as a ${ZWSP}*public note*${ZWSP} on <${INCIDENT_LINK}|Incident INC-8>. It is shown on the status page.`;

// ---- Slack, as much of it as OneUptime reads and writes ----

interface SlackCall {
  method: string;
  data: JSONObject;
}

// The channel's messages at its top, and each thread's replies, by ts.
let channelMessages: Array<JSONObject> = [];
let replies: Map<string, Array<JSONObject>> = new Map();
let slackCalls: Array<SlackCall> = [];
let messageNumber: number = 0;

const SLACK_NAMES: Record<string, string> = {
  [NITIN]: "Nitin",
  [AIDIL]: "Aidil Rahman",
  [CAROL]: "Carol Diaz",
};

const READ_METHODS: Array<string> = [
  "conversations.history",
  "conversations.replies",
  "conversations.info",
  "users.info",
];

function writes(): Array<SlackCall> {
  return slackCalls.filter((call: SlackCall): boolean => {
    return !READ_METHODS.includes(call.method);
  });
}

function answerSlack(method: string, data: JSONObject): JSONObject {
  if (method === "conversations.history") {
    const found: Array<JSONObject> = channelMessages.filter(
      (message: JSONObject): boolean => {
        return message["ts"] === data["latest"];
      },
    );
    return { ok: true, messages: found };
  }

  if (method === "conversations.replies") {
    for (const [parentTs, thread] of replies.entries()) {
      const parent: JSONObject | undefined = channelMessages.find(
        (message: JSONObject): boolean => {
          return message["ts"] === parentTs;
        },
      );
      const reply: JSONObject | undefined = thread.find(
        (message: JSONObject): boolean => {
          return message["ts"] === data["ts"];
        },
      );

      if (parent && reply) {
        // The thread's parent comes first, whatever the bounds.
        return { ok: true, messages: [parent, reply] };
      }
    }

    return { ok: false, error: "thread_not_found" };
  }

  if (method === "users.info") {
    const name: string | undefined = SLACK_NAMES[String(data["user"])];

    return name
      ? {
          ok: true,
          user: {
            id: data["user"],
            name: name.toLowerCase(),
            profile: { display_name: name, real_name: name },
          },
        }
      : { ok: false, error: "user_not_found" };
  }

  if (method === "conversations.info") {
    return { ok: true, channel: { id: data["channel"], name: "inc-inc-8" } };
  }

  if (method === "chat.postMessage") {
    messageNumber++;
    return {
      ok: true,
      channel: data["channel"],
      ts: `1791460000.${String(messageNumber).padStart(6, "0")}`,
    };
  }

  return { ok: true };
}

// A message somebody wrote in #inc-inc-8, `minutesAgo` minutes ago.
function wrote(data: {
  user: string;
  minutesAgo: number;
  blocks?: Array<JSONObject> | undefined;
  text?: string | undefined;
  inThreadOf?: string | undefined;
}): string {
  const postedAt: number = Date.now() - data.minutesAgo * 60 * 1000;
  const ts: string = `${Math.floor(postedAt / 1000)}.000${String(++messageNumber).padStart(3, "0")}`;
  const text: string =
    data.text ||
    "Not sure what's happening here, is this triggered by something?";

  const message: JSONObject = {
    type: "message",
    user: data.user,
    ts: ts,
    text: text,
    team: TEAM_ID,
    blocks: data.blocks || [
      {
        type: "rich_text",
        block_id: "b1",
        elements: [
          {
            type: "rich_text_section",
            elements: [{ type: "text", text: text }],
          },
        ],
      },
    ],
  };

  if (data.inThreadOf) {
    message["thread_ts"] = data.inThreadOf;
    replies.set(data.inThreadOf, [
      ...(replies.get(data.inThreadOf) || []),
      message,
    ]);
  } else {
    channelMessages.push(message);
  }

  return ts;
}

// ---- The events, as Slack posts them ----

let eventNumber: number = 0;

function eventCallback(event: JSONObject): JSONObject {
  eventNumber++;

  return {
    token: "verification-token",
    team_id: TEAM_ID,
    api_app_id: "A0ONEUPTIME",
    event: event,
    type: "event_callback",
    event_id: `Ev04724${String(eventNumber).padStart(4, "0")}`,
    event_time: 1791460000 + eventNumber,
  };
}

function pinned(by: string, messageTs: string): JSONObject {
  return eventCallback({
    type: "pin_added",
    user: by,
    channel_id: INC_CHANNEL,
    item: {
      type: "message",
      channel: INC_CHANNEL,
      created: 1791460000,
      created_by: by,
      message: { ts: messageTs },
    },
    event_ts: "1791460000.000100",
  });
}

function reacted(by: string, reaction: string, messageTs: string): JSONObject {
  return eventCallback({
    type: "reaction_added",
    user: by,
    reaction: reaction,
    item_user: AIDIL,
    item: { type: "message", channel: INC_CHANNEL, ts: messageTs },
    event_ts: "1791460000.000200",
  });
}

interface RoutePort {
  port: number;
  close: () => Promise<void>;
}

let app: RoutePort;

async function startSlackApp(): Promise<RoutePort> {
  const SlackAPI: { new (): { getRouter: () => express.Router } } = (
    (await import("../../../Server/API/SlackAPI")) as unknown as {
      default: { new (): { getRouter: () => express.Router } };
    }
  ).default;

  const server: http.Server = http.createServer(
    express().use(express.json()).use("/api", new SlackAPI().getRouter()),
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

function deliver(payload: JSONObject): Promise<number> {
  const body: string = JSON.stringify(payload);

  return new Promise<number>(
    (resolve: (status: number) => void, reject: (error: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: app.port,
          path: "/api/slack/events",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
        },
        (response: http.IncomingMessage) => {
          response.resume();
          response.on("end", () => {
            resolve(response.statusCode || 0);
          });
        },
      );

      request.on("error", reject);
      request.write(body);
      request.end();
    },
  );
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let attempt: number = 0; attempt < 500; attempt++) {
    if (condition()) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error(`Waited in vain for ${what}`);
}

// Slack is answered at once; what follows runs after - wait for it to settle.
async function settle(): Promise<void> {
  let seen: number = -1;

  for (let attempt: number = 0; attempt < 30; attempt++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });

    const now: number =
      slackCalls.length + privateNotes.inserts.length + feed.length;

    if (now === seen) {
      return;
    }

    seen = now;
  }
}

// ---- Who may do what, and OneUptime's records ----

let linked: Map<string, ObjectID> = new Map();
let privateNotes: InMemoryTable;
let publicNotes: InMemoryTable;
let feed: Array<JSONObject> = [];

function userPermission(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
  };
}

// A member of the project who may post notes on incidents.
function memberProps(userId: ObjectID): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      Permission.IncidentMember,
    ].map(userPermission),
  };

  return {
    userId: userId,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

const ONEUPTIME_NAMES: Record<string, string> = {
  [NITIN_ID.toString()]: "Nitin Kumar",
  [AIDIL_ID.toString()]: "Aidil Rahman (OneUptime)",
  [CAROL_ID.toString()]: "Carol Diaz",
};

beforeAll(async () => {
  app = await startSlackApp();
}, 600000);

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  channelMessages = [];
  replies = new Map();
  slackCalls = [];
  feed = [];
  linked = new Map([[NITIN, NITIN_ID]]);
  (
    jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
      default: { store: Map<string, unknown> };
    }
  ).default.store.clear();

  mockProjectStates();
  stubProjectDirectory({});
  stubReadableParents();

  const projectAuth: () => WorkspaceProjectAuthToken =
    (): WorkspaceProjectAuthToken => {
      const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      token.projectId = PROJECT_ID;
      token.authToken = SLACK_PROJECT_TOKEN;
      token.workspaceProjectId = TEAM_ID;
      token.workspaceType = WorkspaceType.Slack;
      return token;
    };

  getJestSpyOn(WorkspaceProjectAuthTokenService, "findBy").mockImplementation(
    (async () => {
      return [projectAuth()];
    }) as never,
  );
  getJestSpyOn(
    WorkspaceProjectAuthTokenService,
    "findOneBy",
  ).mockImplementation((async () => {
    return projectAuth();
  }) as never);
  getJestSpyOn(
    WorkspaceProjectAuthTokenService,
    "getProjectAuth",
  ).mockImplementation((async () => {
    return projectAuth();
  }) as never);

  getJestSpyOn(WorkspaceUserAuthTokenService, "findOneBy").mockImplementation(
    (async (options: { query: { workspaceUserId: string } }) => {
      const userId: ObjectID | undefined = linked.get(
        options.query.workspaceUserId,
      );

      if (!userId) {
        return null;
      }

      const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
      userAuth.userId = userId;
      return userAuth;
    }) as never,
  );

  // The channel is #inc-inc-8, OneUptime's channel for Incident INC-8.
  getJestSpyOn(
    WorkspaceReactionNote,
    "resolveResourceForChannel",
  ).mockImplementation((async (data: {
    channelId: string;
  }): Promise<WorkspaceNoteResource | null> => {
    return data.channelId === INC_CHANNEL
      ? {
          resourceType: WorkspaceNoteResourceType.Incident,
          resourceId: INCIDENT_ID,
          projectId: PROJECT_ID,
        }
      : null;
  }) as never);

  // Every member here may post notes on the incident.
  getJestSpyOn(WorkspaceActionAuthorization, "authorize").mockImplementation(
    (async (data: { userId: ObjectID }) => {
      return memberProps(data.userId);
    }) as never,
  );

  privateNotes = useInMemoryTable(IncidentInternalNoteService, []);
  publicNotes = useInMemoryTable(IncidentPublicNoteService, []);

  for (const service of [
    IncidentInternalNoteService,
    IncidentPublicNoteService,
  ]) {
    getJestSpyOn(service as never, "getAttachmentsMarkdown").mockResolvedValue(
      "" as never,
    );
  }

  getJestSpyOn(IncidentService, "findOneBy").mockResolvedValue(null);
  getJestSpyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
    number: 8,
    numberWithPrefix: "INC-8",
  });
  getJestSpyOn(IncidentService, "getIncidentLinkInDashboard").mockResolvedValue(
    URL.fromString(INCIDENT_LINK),
  );

  // The incident's timeline: each entry, as the feed service is asked to write it.
  getJestSpyOn(
    IncidentFeedService,
    "createIncidentFeedItem",
  ).mockImplementation((async (data: JSONObject) => {
    feed.push(data);
  }) as never);

  getJestSpyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    const name: string | undefined = ONEUPTIME_NAMES[data.id.toString()];

    if (!name) {
      return null;
    }

    const user: User = new User();
    user.name = new Name(name);
    return user;
  }) as never);

  getJestSpyOn(DatabaseConfig, "getDashboardUrl").mockResolvedValue(
    URL.fromString(DASHBOARD_URL),
  );
  getJestSpyOn(ProductBrandingText, "getProductName").mockReturnValue(
    "OneUptime",
  );

  // Slack: every request is recorded, and answered as Slack would.
  getJestSpyOn(API, "post").mockImplementation((async (options: {
    url: URL;
    data: JSONObject;
  }) => {
    const method: string = options.url.toString().split("/api/").pop() || "";
    slackCalls.push({ method: method, data: options.data });
    return new HTTPResponse<JSONObject>(
      200,
      answerSlack(method, options.data),
      {},
    );
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a pinned Slack message, saved as a note", () => {
  test("the screenshot: Aidil's words, filed when he wrote them, saved by Nitin, confirmed once with no preview", async () => {
    const messageTs: string = wrote({ user: AIDIL, minutesAgo: 90 });

    expect(await deliver(pinned(NITIN, messageTs))).toBe(200);
    await until((): boolean => {
      return writes().length >= 1;
    }, "the confirmation");
    await settle();

    // One note: Aidil's words, saved by Nitin, filed when Aidil wrote them.
    expect(privateNotes.inserts).toHaveLength(1);
    const note: StoredRow = privateNotes.inserts[0]!;
    const postedAt: Date = new Date(Number(messageTs.split(".")[0]) * 1000);

    expect(note["note"]).toBe(
      "Not sure what's happening here, is this triggered by something?",
    );
    expect(String(note["createdByUserId"])).toBe(NITIN_ID.toString());
    expect(note["postedAt"]).toEqual(postedAt);
    expect(note["postedFromSlackMessageId"]).toBe(
      `${INC_CHANNEL}:${messageTs}`,
    );
    expect(note["savedFromChatMessage"]).toEqual({
      workspaceType: WorkspaceType.Slack,
      authorName: "Aidil Rahman",
      postedAt: postedAt.toISOString(),
    });

    // Its timeline entry: whose words, via Slack, added by Nitin - not back in #inc-inc-8.
    expect(feed).toHaveLength(1);
    expect(feed[0]!["feedInfoInMarkdown"]).toBe(
      `📄 **Aidil Rahman** posted **private note** for this [Incident INC-8](${INCIDENT_LINK}) via Slack (note added by Nitin Kumar):\n\nNot sure what's happening here, is this triggered by something?`,
    );
    expect(feed[0]!["postedAt"]).toEqual(postedAt);
    expect(
      (feed[0]!["workspaceNotification"] as JSONObject)["exceptChannel"],
    ).toEqual({ workspaceType: WorkspaceType.Slack, channelId: INC_CHANNEL });

    // Slack: the message read, its author named, and one reply - nothing else.
    expect(
      slackCalls.map((call: SlackCall): string => {
        return call.method;
      }),
    ).toEqual(["conversations.history", "users.info", "chat.postMessage"]);
    expect(writes()[0]!.data).toEqual({
      channel: INC_CHANNEL,
      thread_ts: messageTs,
      text: PRIVATE_CONFIRMATION,
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  test("pinned, then given a 📌 too, then pinned again: one note, one confirmation", async () => {
    const messageTs: string = wrote({ user: AIDIL, minutesAgo: 5 });

    await deliver(pinned(NITIN, messageTs));
    await until((): boolean => {
      return writes().length >= 1;
    }, "the confirmation");
    await deliver(reacted(NITIN, "pushpin", messageTs));
    await deliver(pinned(NITIN, messageTs));
    await settle();

    expect(privateNotes.inserts).toHaveLength(1);
    expect(feed).toHaveLength(1);
    expect(writes()).toHaveLength(1);
  });

  test("a 📣 saves a public note: on the status page, said so, published now", async () => {
    const messageTs: string = wrote({
      user: AIDIL,
      minutesAgo: 30,
      text: "Database failover complete; error rates are back to normal.",
    });

    await deliver(reacted(NITIN, "mega", messageTs));
    await until((): boolean => {
      return writes().length >= 1;
    }, "the confirmation");
    await settle();

    expect(privateNotes.inserts).toHaveLength(0);
    expect(publicNotes.inserts).toHaveLength(1);
    const note: StoredRow = publicNotes.inserts[0]!;

    expect(note["note"]).toBe(
      "Database failover complete; error rates are back to normal.",
    );
    // Published now: when the status page's readers saw it.
    expect((note["postedAt"] as Date).getTime()).toBeGreaterThan(
      Date.now() - 60 * 1000,
    );
    expect(note["savedFromChatMessage"]).toEqual({
      workspaceType: WorkspaceType.Slack,
      authorName: "Aidil Rahman",
      postedAt: new Date(Number(messageTs.split(".")[0]) * 1000).toISOString(),
    });
    expect(String(feed[0]!["feedInfoInMarkdown"])).toContain(
      "posted **public note** for this [Incident INC-8]",
    );
    expect(writes()).toHaveLength(1);
    expect(writes()[0]!.data["text"]).toBe(PUBLIC_CONFIRMATION);
  });

  test("a message pinned days after it was written is filed when it was written", async () => {
    const messageTs: string = wrote({ user: AIDIL, minutesAgo: 3 * 24 * 60 });

    await deliver(pinned(NITIN, messageTs));
    await until((): boolean => {
      return privateNotes.inserts.length >= 1;
    }, "the note");
    await settle();

    const postedAt: Date = privateNotes.inserts[0]!["postedAt"] as Date;

    expect(Date.now() - postedAt.getTime()).toBeGreaterThan(
      3 * 24 * 60 * 60 * 1000 - 60 * 1000,
    );
    expect(feed[0]!["postedAt"]).toEqual(postedAt);
  });

  test("a reply in a thread is read from the thread, and confirmed under its parent", async () => {
    const parentTs: string = wrote({
      user: NITIN,
      minutesAgo: 20,
      text: "What changed in the last deploy?",
    });
    const replyTs: string = wrote({
      user: AIDIL,
      minutesAgo: 10,
      text: "The connection pool size, from 50 to 5.",
      inThreadOf: parentTs,
    });

    await deliver(reacted(NITIN, "pushpin", replyTs));
    await until((): boolean => {
      return writes().length >= 1;
    }, "the confirmation");
    await settle();

    expect(privateNotes.inserts[0]!["note"]).toBe(
      "The connection pool size, from 50 to 5.",
    );
    expect(
      slackCalls
        .map((call: SlackCall): string => {
          return call.method;
        })
        .slice(0, 2),
    ).toEqual(["conversations.history", "conversations.replies"]);
    expect(writes()[0]!.data["thread_ts"]).toBe(parentTs);
  });

  test("a message by a connected member is theirs by their OneUptime name, and formatted as Slack showed it", async () => {
    linked.set(AIDIL, AIDIL_ID);

    const messageTs: string = wrote({
      user: AIDIL,
      minutesAgo: 15,
      text: "*Root cause:* pool size <@U0NITIN>",
      blocks: [
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                { type: "text", text: "Root cause:", style: { bold: true } },
                { type: "text", text: " pool size, cc " },
                { type: "user", user_id: NITIN },
                { type: "text", text: " - see " },
                {
                  type: "link",
                  url: "https://wiki.example.com/rca",
                  text: "the RCA",
                },
              ],
            },
          ],
        },
      ],
    });

    await deliver(pinned(NITIN, messageTs));
    await until((): boolean => {
      return writes().length >= 1;
    }, "the confirmation");
    await settle();

    expect(privateNotes.inserts[0]!["note"]).toBe(
      "**Root cause:** pool size, cc @Nitin - see [the RCA](https://wiki.example.com/rca)",
    );
    expect(privateNotes.inserts[0]!["savedFromChatMessage"]).toEqual({
      workspaceType: WorkspaceType.Slack,
      authorName: "Aidil Rahman (OneUptime)",
      authorUserId: AIDIL_ID.toString(),
      postedAt: new Date(Number(messageTs.split(".")[0]) * 1000).toISOString(),
    });
    expect(String(feed[0]!["feedInfoInMarkdown"])).toContain(
      "📄 **Aidil Rahman (OneUptime)** posted **private note**",
    );
  });

  test("Nitin pinning his own message: no 'note added by'", async () => {
    linked.set(NITIN, NITIN_ID);
    const messageTs: string = wrote({
      user: NITIN,
      minutesAgo: 2,
      text: "Rolling back now.",
    });

    await deliver(pinned(NITIN, messageTs));
    await until((): boolean => {
      return feed.length >= 1;
    }, "the timeline entry");
    await settle();

    expect(feed[0]!["feedInfoInMarkdown"]).toBe(
      `📄 **Nitin Kumar** posted **private note** for this [Incident INC-8](${INCIDENT_LINK}) via Slack:\n\nRolling back now.`,
    );
  });
});

describe("somebody not connected who pins a message", () => {
  test("is asked once, only they see it; connecting saves the message, as theirs, confirmed once", async () => {
    const messageTs: string = wrote({ user: AIDIL, minutesAgo: 40 });

    await deliver(pinned(CAROL, messageTs));
    await until((): boolean => {
      return writes().length >= 1;
    }, "the Connect prompt");
    // Again, and with a 📌: asked once for the message.
    await deliver(pinned(CAROL, messageTs));
    await deliver(reacted(CAROL, "pushpin", messageTs));
    await settle();

    expect(privateNotes.inserts).toHaveLength(0);
    expect(writes()).toHaveLength(1);

    const prompt: SlackCall = writes()[0]!;

    expect(prompt.method).toBe("chat.postEphemeral");
    expect(prompt.data["channel"]).toBe(INC_CHANNEL);
    expect(prompt.data["user"]).toBe(CAROL);
    expect(prompt.data["text"]).toBe(
      "Connect your Slack account to save this message as a private note on this incident",
    );

    const blocks: string = JSON.stringify(prompt.data["blocks"]);

    expect(blocks).toContain(
      "Connect your Slack account to save this message as a private note on this incident.",
    );
    expect(blocks).toContain(
      "It takes one click, and OneUptime saves it for you as soon as you're connected.",
    );

    // The button carries the save: the token in its link.
    const token: string = /connect=([A-Za-z0-9_-]{43})/.exec(blocks)![1]!;
    const request: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.take(token);

    expect(request!.workspaceUserId).toBe(CAROL);
    expect(request!.pendingAction!.message).toEqual({
      channelId: INC_CHANNEL,
      messageId: messageTs,
    });

    // Carol connects: the message is saved as she would have saved it.
    linked.set(CAROL, CAROL_ID);
    slackCalls = [];

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request!,
        userId: CAROL_ID,
      });

    expect(result).toEqual({
      outcome: ConnectRequestOutcome.Done,
      answer: {
        markdown: `✅ **Your Slack account is connected to OneUptime.** You saved the message as a private note on **[Incident INC-8](${INCIDENT_LINK})**.`,
        text: "Your Slack account is connected to OneUptime. You saved the message as a private note on Incident INC-8",
      },
    });

    expect(privateNotes.inserts).toHaveLength(1);
    expect(String(privateNotes.inserts[0]!["createdByUserId"])).toBe(
      CAROL_ID.toString(),
    );
    expect(String(feed[0]!["feedInfoInMarkdown"])).toContain(
      "via Slack (note added by Carol Diaz):",
    );
    expect(writes()).toHaveLength(1);
    expect(writes()[0]!.data).toEqual({
      channel: INC_CHANNEL,
      thread_ts: messageTs,
      text: PRIVATE_CONFIRMATION,
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  test("a message saved by somebody else meanwhile is not saved again when they connect", async () => {
    const messageTs: string = wrote({ user: AIDIL, minutesAgo: 40 });

    await deliver(pinned(CAROL, messageTs));
    await until((): boolean => {
      return writes().length >= 1;
    }, "the Connect prompt");

    const token: string = /connect=([A-Za-z0-9_-]{43})/.exec(
      JSON.stringify(writes()[0]!.data["blocks"]),
    )![1]!;

    // Nitin pins it meanwhile.
    await deliver(pinned(NITIN, messageTs));
    await until((): boolean => {
      return privateNotes.inserts.length >= 1;
    }, "Nitin's note");
    await settle();

    linked.set(CAROL, CAROL_ID);

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: (await WorkspaceConnectRequest.take(token))!,
        userId: CAROL_ID,
      });

    expect(result.outcome).toBe(ConnectRequestOutcome.Answered);
    expect(result.answer.text).toBe(
      "Your Slack account is connected to OneUptime. This message is already saved as a note on Incident INC-8",
    );
    expect(privateNotes.inserts).toHaveLength(1);
  });
});
