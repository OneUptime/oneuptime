import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceLiveMessage from "../../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import { ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES } from "../../../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import WorkspaceLiveMessageKey, {
  WorkspaceLiveMessageDestinationType,
  WorkspaceLiveMessagePageRecordType,
} from "../../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import ObjectID from "../../../../../Types/ObjectID";
import QuietChannelsWorld, {
  ALERT_ID,
  DASHBOARD,
  JANE,
  NITIN,
  PROJECT_ID,
  SEC,
  STATE_ACKNOWLEDGED,
  WORKSPACE_RULE_ID,
} from "./QuietChannelsWorld";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A PAGE FROM A CHAT, SHOWN WHERE IT WAS ASKED FOR - END TO END.
 *
 * `/oneuptime page @nitin The checkout API is throwing 500s`, run by Jane in
 * #ops, pages Nitin about a new alert. The alert's messages go where its
 * rules say - here, a channel of its own - and #ops, where Jane asked, is
 * kept as a page request place of the alert. Every run of the alert keeps
 * its message there too: the same message, with what the page is about
 * under its first line, edited as the run goes, and its own alarms.
 *
 * The run goes through OneUptime's real code - the execution log service's
 * startDirectPage and its hooks, the escalation rule service, the timeline,
 * the run's live message and SlackUtil - against a fake Slack API that
 * records every request (QuietChannelsWorld has the database in memory).
 */

const ALERT_CHANNEL: string = "C0ALERT12";
const OPS: string = "C0OPS";
const TITLE: string = "The checkout API is throwing 500s";

const ALERT_URL: string = `${DASHBOARD}/${PROJECT_ID.toString()}/alerts/${ALERT_ID.toString()}`;
const ALERT_IN_SLACK: string = `*<${ALERT_URL}|Alert AL-12>*`;

const ZERO_WIDTH_SPACE: string = String.fromCharCode(0x200b);

interface SlackRequest {
  method: string;
  channel: string;
  ts: string;
  text: string;
  notification: string | undefined;
}

class FakeSlack {
  public requests: Array<SlackRequest> = [];
  // Channels the app may not post in: a private channel it is not in.
  public refusedChannels: Set<string> = new Set<string>();
  private nextTs: number = 1;

  public install(): void {
    jest.spyOn(API, "post").mockImplementation((async (data: {
      url: { toString: () => string };
      data: JSONObject;
    }): Promise<HTTPResponse<JSONObject>> => {
      const method: string = data.url.toString().split("/api/")[1] || "";
      const body: JSONObject = data.data || {};
      const channel: string = String(body["channel"] || "");
      const blocks: Array<JSONObject> =
        (body["blocks"] as Array<JSONObject> | undefined) || [];

      let ts: string = String(body["ts"] || "");
      let answer: JSONObject = { ok: true };

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
          if (this.refusedChannels.has(channel)) {
            answer = { ok: false, error: "not_in_channel" };
            break;
          }

          ts = `1760000000.${String(this.nextTs++).padStart(6, "0")}`;
          answer = { ok: true, ts: ts, channel: channel };
          break;
        case "chat.update":
          answer = { ok: true, ts: ts, channel: channel };
          break;
        default:
          break;
      }

      this.requests.push({
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

  public posts(channel: string): Array<SlackRequest> {
    return this.requests.filter((request: SlackRequest): boolean => {
      return (
        request.method === "chat.postMessage" &&
        request.channel === channel &&
        request.ts !== ""
      );
    });
  }

  public updates(channel: string): Array<SlackRequest> {
    return this.requests.filter((request: SlackRequest): boolean => {
      return request.method === "chat.update" && request.channel === channel;
    });
  }

  // A channel's page message as it stands: its last edit, or the post.
  public pageMessageNow(channel: string): SlackRequest | undefined {
    const posted: SlackRequest | undefined = this.posts(channel).find(
      (post: SlackRequest): boolean => {
        return post.text.indexOf("See every step in OneUptime") !== -1;
      },
    );

    if (!posted) {
      return undefined;
    }

    const edits: Array<SlackRequest> = this.updates(channel).filter(
      (update: SlackRequest): boolean => {
        return update.ts === posted.ts;
      },
    );

    return edits[edits.length - 1] || posted;
  }
}

let slack: FakeSlack;
let world: QuietChannelsWorld;

function lines(request: SlackRequest | undefined): Array<string> {
  return (request?.text || "").split("\n").filter((line: string): boolean => {
    return line.trim().length > 0;
  });
}

// Jane asked in `channelId`: the alert keeps it as a page request place.
function keepPlace(channelId: string): void {
  const place: WorkspaceLiveMessage = new WorkspaceLiveMessage();
  place.id = ObjectID.generate();
  place.projectId = PROJECT_ID;
  place.workspaceType = WorkspaceType.Slack;
  place.messageKey = WorkspaceLiveMessageKey.forOnCallPageRequest(
    WorkspaceLiveMessagePageRecordType.Alert,
    ALERT_ID,
  );
  place.destinationType = WorkspaceLiveMessageDestinationType.Channel;
  place.channelId = channelId;
  place.messageId = "";
  place.messageData = { pagedByUserId: JANE.toString() };
  world.liveMessages.rows.push(place);
}

// The run's own rows, where it keeps a message.
function runRows(): Array<WorkspaceLiveMessage> {
  return world.liveMessages.forKey(
    WorkspaceLiveMessageKey.forOnCallPolicyRun(world.run!.id!),
  );
}

beforeEach(() => {
  slack = new FakeSlack();
  slack.install();

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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Jane pages Nitin from #ops", () => {
  beforeEach(async () => {
    keepPlace(OPS);

    await world.startDirectPage({
      targets: { userIds: [NITIN] },
      startedBy: { userId: JANE },
    });
  });

  test("#ops gets the page's one message, with what the page is about under its first line", () => {
    const message: SlackRequest | undefined = slack.pageMessageNow(OPS);

    expect(lines(message)).toEqual([
      `📟 *Jane Doe* is paging for ${ALERT_IN_SLACK}`,
      `“${TITLE}”`,
      "•   *Nitin*: paged once · by SMS and email",
      expect.stringContaining("|See every step in OneUptime>"),
    ]);
    expect(slack.posts(OPS)).toHaveLength(1);
  });

  test("its notification says who is paging, for what, and why", () => {
    expect(slack.posts(OPS)[0]!.notification).toBe(
      `Jane Doe is paging for Alert AL-12: ${TITLE}`,
    );
  });

  test("the alert's own channel gets the run's message as it always did: no title, the alert's message above says it", () => {
    expect(lines(slack.pageMessageNow(ALERT_CHANNEL))).toEqual([
      `📟 *Jane Doe* is paging for ${ALERT_IN_SLACK}`,
      "•   *Nitin*: paged once · by SMS and email",
      expect.stringContaining("|See every step in OneUptime>"),
    ]);
    expect(slack.posts(ALERT_CHANNEL)).toHaveLength(1);
  });

  test("the run keeps both messages: one where the alert's messages go, one at the place, marked", () => {
    const rows: Array<WorkspaceLiveMessage> = runRows();

    expect(
      rows.map((row: WorkspaceLiveMessage) => {
        return [row.channelId, row.messageData?.isPageRequestPlace === true];
      }),
    ).toEqual([
      [ALERT_CHANNEL, false],
      [OPS, true],
    ]);
    expect(OnCallPolicyRunMessage.isAtPageRequestPlace(rows[1]!)).toBe(true);
    expect(OnCallPolicyRunMessage.isAtPageRequestPlace(rows[0]!)).toBe(false);
  });

  test("a change to the run that changes nothing it says edits nothing, and posts nothing again", async () => {
    const before: number = slack.requests.length;

    await OnCallPolicyRunMessage.syncRun(world.run!.id!);

    expect(slack.posts(OPS)).toHaveLength(1);
    expect(slack.posts(ALERT_CHANNEL)).toHaveLength(1);
    expect(
      slack.requests.slice(before).filter((request: SlackRequest) => {
        return request.method === "chat.postMessage";
      }),
    ).toEqual([]);
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

    test("#ops's message is edited in place to say who acknowledged - still saying what the page was about", () => {
      const message: SlackRequest | undefined = slack.pageMessageNow(OPS);

      expect(message!.method).toBe("chat.update");
      expect(lines(message).slice(0, 3)).toEqual([
        // Jane's page stopped: Jane did not stop it. Nitin answered it.
        `✅ *Nitin* acknowledged the page for ${ALERT_IN_SLACK}, so paging stopped`,
        `“${TITLE}”`,
        "•   *Nitin*: acknowledged · paged once · by SMS and email",
      ]);
      expect(message!.notification).toBe(
        `Nitin acknowledged the page for Alert AL-12: ${TITLE}`,
      );
    });

    test("every change in #ops was an edit of its one message", () => {
      const posted: SlackRequest = slack.posts(OPS)[0]!;

      for (const update of slack.updates(OPS)) {
        expect(update.ts).toBe(posted.ts);
      }

      expect(
        slack.posts(OPS).filter((post: SlackRequest): boolean => {
          return post.text.indexOf("See every step") !== -1;
        }),
      ).toHaveLength(1);
    });

    test("no alarm anywhere: somebody is on it", () => {
      for (const channel of [OPS, ALERT_CHANNEL]) {
        expect(
          slack.posts(channel).filter((post: SlackRequest): boolean => {
            return post.text.indexOf("⚠️") === 0;
          }),
        ).toEqual([]);
      }
    });
  });

  describe("and nobody acknowledges", () => {
    beforeEach(async () => {
      expect(
        await world.directPageTick(
          ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES,
        ),
      ).toBe(true);
    });

    test("the alarm is raised where Jane asked too - once - so she reads that nobody took it where she paged", () => {
      const alarms: Array<SlackRequest> = slack
        .posts(OPS)
        .filter((post: SlackRequest): boolean => {
          return post.text.indexOf("⚠️ Nobody has acknowledged") === 0;
        });

      expect(alarms).toHaveLength(1);
      expect(alarms[0]!.text.trim()).toBe(
        `⚠️ Nobody has acknowledged ${ALERT_IN_SLACK}. *Jane Doe* paged Nitin, and paging has stopped. Someone needs to take it.`,
      );
      expect(alarms[0]!.notification).toBe(
        "Nobody has acknowledged Alert AL-12: someone needs to take it",
      );
    });

    test("and where the alert's messages go, once, as before", () => {
      expect(
        slack.posts(ALERT_CHANNEL).filter((post: SlackRequest): boolean => {
          return post.text.indexOf("⚠️ Nobody has acknowledged") === 0;
        }),
      ).toHaveLength(1);
    });

    test("a later change raises it nowhere again", async () => {
      await OnCallPolicyRunMessage.syncRun(world.run!.id!);

      for (const channel of [OPS, ALERT_CHANNEL]) {
        expect(
          slack.posts(channel).filter((post: SlackRequest): boolean => {
            return post.text.indexOf("⚠️ Nobody has acknowledged") === 0;
          }),
        ).toHaveLength(1);
      }
    });

    test("#ops's message says nobody acknowledged, with what the page was about", () => {
      expect(lines(slack.pageMessageNow(OPS)).slice(0, 2)).toEqual([
        `⚠️ *Jane Doe* paged for ${ALERT_IN_SLACK} and nobody acknowledged`,
        `“${TITLE}”`,
      ]);
    });
  });
});

describe("Jane pages from the alert's own channel", () => {
  test("the run is posted there once: the place is where the alert's messages go already", async () => {
    keepPlace(ALERT_CHANNEL);

    await world.startDirectPage({
      targets: { userIds: [NITIN] },
      startedBy: { userId: JANE },
    });

    expect(
      slack.posts(ALERT_CHANNEL).filter((post: SlackRequest): boolean => {
        return post.text.indexOf("See every step") !== -1;
      }),
    ).toHaveLength(1);
    expect(runRows()).toHaveLength(1);
    expect(runRows()[0]!.messageData?.isPageRequestPlace).toBeUndefined();
  });
});

describe("Jane pages whoever is on call in sec, where nobody is", () => {
  beforeEach(async () => {
    keepPlace(OPS);

    await world.startDirectPage({
      targets: { onCallScheduleIds: [SEC] },
      startedBy: { userId: JANE },
    });
  });

  test("#ops's one message says the page reached nobody, why, and what to do - with what it was about", () => {
    expect(lines(slack.pageMessageNow(OPS))).toEqual([
      `⚠️ *Jane Doe* could not reach anyone for ${ALERT_IN_SLACK}`,
      `“${TITLE}”`,
      "•   Nobody was on call in schedule *sec*",
      "Check who is on call, or page someone yourself.",
      expect.stringContaining("|See every step in OneUptime>"),
    ]);
  });

  test("and no alarm follows it, there or in the alert's channel: the message says it already", async () => {
    await world.settle();
    await OnCallPolicyRunMessage.syncRun(world.run!.id!);

    for (const channel of [OPS, ALERT_CHANNEL]) {
      expect(
        slack.posts(channel).filter((post: SlackRequest): boolean => {
          return post.text.indexOf("⚠️ Nobody was paged") === 0;
        }),
      ).toEqual([]);
    }
  });
});

describe("a place the app may not post in - a private channel it is not in", () => {
  test("nothing is kept for it, the alert's channel still gets the run, and the next change tries again", async () => {
    slack.refusedChannels.add(OPS);
    keepPlace(OPS);

    await world.startDirectPage({
      targets: { userIds: [NITIN] },
      startedBy: { userId: JANE },
    });

    expect(
      runRows().map((row: WorkspaceLiveMessage) => {
        return row.channelId;
      }),
    ).toEqual([ALERT_CHANNEL]);
    expect(slack.pageMessageNow(ALERT_CHANNEL)).toBeDefined();

    // Once the app is in the channel, the next change posts it there.
    slack.refusedChannels.delete(OPS);
    await OnCallPolicyRunMessage.syncRun(world.run!.id!);

    expect(slack.pageMessageNow(OPS)).toBeDefined();
    expect(runRows()).toHaveLength(2);
  });
});

describe("a run of a record nobody paged from a chat", () => {
  test("is told only where the record's messages go: no place, no title", async () => {
    await world.startDirectPage({
      targets: { userIds: [NITIN] },
      startedBy: { userId: JANE },
    });

    expect(slack.posts(OPS)).toEqual([]);
    expect(runRows()).toHaveLength(1);
    expect(slack.pageMessageNow(ALERT_CHANNEL)!.text).not.toContain(TITLE);
  });
});
