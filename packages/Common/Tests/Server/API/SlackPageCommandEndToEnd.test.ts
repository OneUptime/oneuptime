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
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceLiveMessageKey, {
  WorkspaceLiveMessagePageRecordType,
} from "../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceLiveMessage from "../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import OnCallPageService, {
  OnCallPageRecordType,
  OnCallPageRequest,
  OnCallPageResult,
} from "../../../Server/Services/OnCallPageService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { OnCallDirectPageRun } from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import QuietChannelsWorld, {
  ALERT_ID,
  DASHBOARD,
  JANE,
  NITIN,
  PROJECT_ID,
  STATE_ACKNOWLEDGED,
  WORKSPACE_RULE_ID,
} from "../Utils/Workspace/LiveMessages/QuietChannelsWorld";

jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/Middleware/SlackAuthorization", () => {
  return {
    __esModule: true,
    default: {
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

/*
 * CUSTOMER FEEDBACK #4, THE WHOLE WAY: "How can we manually trigger a page
 * to someone -- e.g. /oneuptime page @nawaz some-message?"
 *
 * Jane runs `/oneuptime page @nitin The checkout API is throwing 500s` in
 * #ops. Everything from Slack's request to the requests OneUptime sends
 * Slack is the real code - the SlackAPI router, the command's reading, who
 * @nitin is, WorkspacePage, the place kept for the page's alert, the
 * execution log service's direct page and its hooks, the run's live message
 * and SlackUtil - with the database in memory (QuietChannelsWorld). Only the
 * call that would create the alert (OnCallPageService) is the world's: it
 * starts the direct page about the world's alert, as the service would
 * about the alert it creates.
 *
 * What Jane sees: "📟 Paging Nitin…" only to her, at once; then, in #ops,
 * the page's one message - who is paging, for which alert, what about, who
 * was paged and how - edited in place when Nitin acknowledges.
 */

const OPS: string = "C0OPS";
const ALERT_CHANNEL: string = "C0ALERT12";
const RESPONSE_URL: string =
  "https://hooks.slack.com/commands/T0WORKSPACE/1760000000/e2ePage";
const TITLE: string = "The checkout API is throwing 500s";
const ALERT_URL: string = `${DASHBOARD}/${PROJECT_ID.toString()}/alerts/${ALERT_ID.toString()}`;
const ALERT_IN_SLACK: string = `*<${ALERT_URL}|Alert AL-12>*`;
const ZERO_WIDTH_SPACE: string = String.fromCharCode(0x200b);

interface SlackRequest {
  url: string;
  method: string;
  channel: string;
  ts: string;
  text: string;
  notification: string | undefined;
}

let world: QuietChannelsWorld;
let requests: Array<SlackRequest>;
// The form views.open was sent, when one was.
let openedView: JSONObject | null;
let pageRequests: Array<OnCallPageRequest>;
let started: OnCallDirectPageRun | null;

interface RoutePort {
  port: number;
  close: () => Promise<void>;
}

async function startSlackApp(): Promise<RoutePort> {
  const SlackAPI: { new (): { getRouter: () => express.Router } } = (
    (await import("../../../Server/API/SlackAPI")) as unknown as {
      default: { new (): { getRouter: () => express.Router } };
    }
  ).default;

  const app: express.Express = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use("/api", new SlackAPI().getRouter());

  const server: http.Server = http.createServer(app);

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

function postCommand(port: number, text: string): Promise<number> {
  const payload: string = new globalThis.URLSearchParams({
    team_id: "T0WORKSPACE",
    channel_id: OPS,
    channel_name: "ops",
    user_id: "U0JANE",
    user_name: "jane",
    command: "/oneuptime",
    text: text,
    response_url: RESPONSE_URL,
    trigger_id: "1760000000.trigger",
  }).toString();

  return new Promise<number>(
    (resolve: (status: number) => void, reject: (error: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: "/api/slack/command",
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "content-length": Buffer.byteLength(payload),
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
      request.write(payload);
      request.end();
    },
  );
}

function installFakeSlack(): void {
  let nextTs: number = 1;

  jest.spyOn(API, "post").mockImplementation((async (data: {
    url: { toString: () => string };
    data: JSONObject;
  }): Promise<HTTPResponse<JSONObject>> => {
    const url: string = data.url.toString();
    const method: string = url.split("/api/")[1] || url;
    const body: JSONObject = data.data || {};
    const channel: string = String(body["channel"] || "");
    const blocks: Array<JSONObject> =
      (body["blocks"] as Array<JSONObject> | undefined) || [];

    let ts: string = String(body["ts"] || "");
    let answer: JSONObject = { ok: true };

    if (method === "views.open") {
      openedView = body["view"] as JSONObject;
    }

    switch (method) {
      case "conversations.info":
        answer = {
          ok: true,
          channel: {
            id: channel,
            name: channel === OPS ? "ops" : "oneuptime-alert-12",
          },
        };
        break;
      case "conversations.members":
        answer = {
          ok: true,
          members: ["B0BOT"],
          response_metadata: { next_cursor: "" },
        };
        break;
      case "chat.postMessage":
        ts = `1760000000.${String(nextTs++).padStart(6, "0")}`;
        answer = { ok: true, ts: ts, channel: channel };
        break;
      default:
        break;
    }

    requests.push({
      url: url,
      method: method,
      channel: channel,
      ts: ts,
      text: blocks
        .map((block: JSONObject): string => {
          return String(
            (block["text"] as JSONObject | undefined)?.["text"] || "",
          );
        })
        .join("\n")
        .split(ZERO_WIDTH_SPACE)
        .join(""),
      notification:
        body["text"] === undefined ? undefined : String(body["text"]),
    });

    return {
      jsonData: answer,
      data: answer,
    } as unknown as HTTPResponse<JSONObject>;
  }) as never);
}

function lines(request: SlackRequest | undefined): Array<string> {
  return (request?.text || "").split("\n").filter((line: string): boolean => {
    return line.trim().length > 0;
  });
}

function pageMessageIn(channel: string): SlackRequest | undefined {
  const posted: SlackRequest | undefined = requests.find(
    (request: SlackRequest): boolean => {
      return (
        request.method === "chat.postMessage" &&
        request.channel === channel &&
        request.text.indexOf("See every step") !== -1
      );
    },
  );

  if (!posted) {
    return undefined;
  }

  const edits: Array<SlackRequest> = requests.filter(
    (request: SlackRequest): boolean => {
      return (
        request.method === "chat.update" &&
        request.channel === channel &&
        request.ts === posted.ts
      );
    },
  );

  return edits[edits.length - 1] || posted;
}

async function settled(): Promise<void> {
  for (let wait: number = 0; wait < 300; wait++) {
    if (pageMessageIn(OPS)) {
      break;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }

  await world.settle();
}

let app: RoutePort;

beforeAll(async () => {
  app = await startSlackApp();
}, 600000);

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  requests = [];
  pageRequests = [];
  started = null;
  openedView = null;

  world = new QuietChannelsWorld({
    workspaces: [WorkspaceType.Slack],
    channels: {
      slack: {
        id: ALERT_CHANNEL,
        name: "oneuptime-alert-12",
        workspaceType: WorkspaceType.Slack,
        notificationRuleId: WORKSPACE_RULE_ID.toString(),
      },
    },
  });
  world.runFor = "alert";
  world.recordStateName = "Created";
  world.recordTitle = TITLE;
  world.install();
  installFakeSlack();

  (
    jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
      default: { store: Map<string, unknown> };
    }
  ).default.store.clear();

  // The Slack workspace is the project's.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
    .mockImplementation((async () => {
      const projectAuth: WorkspaceProjectAuthToken =
        new WorkspaceProjectAuthToken();
      projectAuth.projectId = PROJECT_ID;
      projectAuth.workspaceType = WorkspaceType.Slack;
      projectAuth.authToken = "xoxb-project";
      projectAuth.miscData = { botUserId: "B0BOT" } as never;
      return projectAuth;
    }) as never);

  // The workspace's one connection, as WorkspaceProjectResolution reads them.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockImplementation((async () => {
      const projectAuth: WorkspaceProjectAuthToken =
        new WorkspaceProjectAuthToken();
      projectAuth.projectId = PROJECT_ID;
      projectAuth.workspaceType = WorkspaceType.Slack;
      projectAuth.authToken = "xoxb-project";
      projectAuth.miscData = { botUserId: "B0BOT" } as never;
      return [projectAuth];
    }) as never);

  // Jane's Slack account is connected; so is Nitin's.
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockImplementation((async () => {
      const token: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
      token.userId = JANE;
      token.authToken = "xoxp-jane";
      return token;
    }) as never);
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findBy")
    .mockImplementation((async () => {
      const token: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
      token.workspaceUserId = "U0NITIN";
      token.userId = NITIN;
      return [token];
    }) as never);

  // Jane is a member who may page: her permissions have their own suites.
  const janeProps: DatabaseCommonInteractionProps = {
    userId: JANE,
    tenantId: PROJECT_ID,
  };
  jest
    .spyOn(WorkspaceActionAuthorization, "isProjectMember")
    .mockResolvedValue(true);
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue(janeProps);
  jest
    .spyOn(WorkspaceActionAuthorization, "authorize")
    .mockResolvedValue(janeProps);
  jest
    .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");

  /*
   * #ops is no incident's or alert's own channel: no record lists it among
   * its channels (WorkspacePageAbout.findChannelRecord asks, for real), so
   * a page there is about something new.
   */
  jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);
  jest.spyOn(AlertService, "findOneBy").mockResolvedValue(null);

  /*
   * The page about something new: the world's alert, paged about directly,
   * as the person who asked - what OnCallPageService does once it has
   * created the alert.
   */
  jest
    .spyOn(OnCallPageService, "page")
    .mockImplementation(async (request: OnCallPageRequest) => {
      pageRequests.push(request);

      started = await world.startDirectPage({
        targets: { userIds: request.targets.userIds || [] },
        startedBy: { userId: request.props.userId },
      });

      const result: OnCallPageResult = {
        record: {
          type: OnCallPageRecordType.Alert,
          id: ALERT_ID,
          label: "Alert AL-12",
          title: request.about.newAlert!.title,
          url: URL.fromString(ALERT_URL),
          isNew: true,
        },
        paged: [
          {
            userId: NITIN,
            name: "Nitin",
            email: null,
            teamName: null,
            scheduleName: null,
            coveringForName: null,
          },
        ],
        startedPolicies: [],
        notPaged: [],
        isAnyonePaged: true,
        directPageExecutionLogId: started.executionLogId,
        summary: "Paged Nitin about Alert AL-12.",
      };

      return result;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Jane: /oneuptime page @nitin The checkout API is throwing 500s, in #ops", () => {
  beforeEach(async () => {
    expect(await postCommand(app.port, `page <@U0NITIN|nitin> ${TITLE}`)).toBe(
      200,
    );

    await settled();
  });

  test("first, only to Jane: 'Paging Nitin about a new alert…' - #ops is no record's own channel", () => {
    const first: SlackRequest = requests.find((request: SlackRequest) => {
      return request.url === RESPONSE_URL;
    })!;

    expect(first.text.trim()).toBe("📟 Paging *Nitin* about a new alert…");
    expect(first.notification).toBe("Paging Nitin about a new alert…");
  });

  test("the page is about a new alert titled by her message, paging Nitin, as Jane, waiting briefly for its channels", () => {
    expect(pageRequests).toHaveLength(1);
    expect(pageRequests[0]!.targets).toEqual({ userIds: [NITIN] });
    expect(pageRequests[0]!.about).toEqual({
      newAlert: {
        title: TITLE,
        rootCause: "Created by **Jane Doe** from Slack to page people.",
      },
    });
    expect(pageRequests[0]!.props.userId).toEqual(JANE);
    expect(pageRequests[0]!.maxWaitForRecordInMs).toBe(5000);
  });

  test("#ops is kept as the place the alert was paged from", () => {
    expect(
      world.liveMessages
        .forKey(
          WorkspaceLiveMessageKey.forOnCallPageRequest(
            WorkspaceLiveMessagePageRecordType.Alert,
            ALERT_ID,
          ),
        )
        .map((row: WorkspaceLiveMessage) => {
          return [row.channelId, row.channelName, row.messageId];
        }),
    ).toEqual([[OPS, "ops", ""]]);
  });

  test("#ops gets the page's one message: Jane paging for the alert, what about, and who was paged how", () => {
    expect(lines(pageMessageIn(OPS))).toEqual([
      `📟 *Jane Doe* is paging for ${ALERT_IN_SLACK}`,
      `“${TITLE}”`,
      "•   *Nitin*: paged once · by SMS and email",
      expect.stringContaining("|See every step in OneUptime>"),
    ]);
    expect(pageMessageIn(OPS)!.notification).toBe(
      `Jane Doe is paging for Alert AL-12: ${TITLE}`,
    );
  });

  test("and nothing else is said to Jane: the channel shows it", () => {
    expect(
      requests.filter((request: SlackRequest): boolean => {
        return request.url === RESPONSE_URL;
      }),
    ).toHaveLength(1);
  });

  test("the alert's own channel gets the run's message too, as any page of the alert", () => {
    expect(pageMessageIn(ALERT_CHANNEL)).toBeDefined();
    expect(pageMessageIn(ALERT_CHANNEL)!.text).not.toContain(TITLE);
  });

  describe("and Nitin acknowledges", () => {
    beforeEach(async () => {
      await world.acknowledge(NITIN);
      await world.alertState({
        to: STATE_ACKNOWLEDGED,
        name: "Acknowledged",
        isFirst: false,
      });
      await world.settle();
    });

    test("#ops's message is edited in place: Nitin acknowledged - still saying what the page was about", () => {
      const message: SlackRequest = pageMessageIn(OPS)!;

      expect(message.method).toBe("chat.update");
      expect(lines(message).slice(0, 3)).toEqual([
        // Jane's page stopped: Jane did not stop it. Nitin answered it.
        `✅ *Nitin* acknowledged the page for ${ALERT_IN_SLACK}, so paging stopped`,
        `“${TITLE}”`,
        "•   *Nitin*: acknowledged · paged once · by SMS and email",
      ]);
    });

    test("still one page message in #ops", () => {
      expect(
        requests.filter((request: SlackRequest): boolean => {
          return (
            request.method === "chat.postMessage" &&
            request.channel === OPS &&
            request.text.indexOf("See every step") !== -1
          );
        }),
      ).toHaveLength(1);
      expect(started).not.toBeNull();
    });
  });
});

describe("with no message: the form, and nobody is paged", () => {
  test("/oneuptime page @nitin opens the Page someone form with Nitin picked", async () => {
    // The form lists the project's people (its own suites list the rest).
    jest
      .spyOn(WorkspaceActionAuthorization, "findReadable")
      .mockImplementation((async (data: { service: unknown }) => {
        if (data.service !== TeamMemberService) {
          return [];
        }

        const member: TeamMember = new TeamMember();
        member.userId = NITIN;
        const user: User = new User();
        user.id = NITIN;
        user.name = "Nitin" as never;
        member.user = user;
        return [member];
      }) as never);

    await postCommand(app.port, "page <@U0NITIN|nitin>");

    for (let wait: number = 0; wait < 300; wait++) {
      if (
        requests.some((request: SlackRequest): boolean => {
          return request.method === "views.open";
        })
      ) {
        break;
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 10);
      });
    }

    expect(
      requests.map((request: SlackRequest): string => {
        return request.method;
      }),
    ).toEqual(["views.open"]);
    expect(pageRequests).toEqual([]);
    expect(ObjectID.isValidUUID(NITIN.toString())).toBe(true);
    // Nitin is picked already: only the message is left to write.
    expect(openedView!["callback_id"]).toBe("SubmitPageSomeone");
    expect(JSON.stringify(openedView)).toContain(
      `"initial_options":[{"text":{"type":"plain_text","text":"Nitin"},"value":"user:${NITIN.toString()}"}]`,
    );
  });
});
