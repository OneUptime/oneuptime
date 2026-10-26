import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { IncidentFeedEventType } from "../../../../../Models/DatabaseModels/IncidentFeed";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import QuietChannelsWorld, {
  FeedEntry,
  JANE,
  NB_USER_3,
  NITIN,
  PRIMARY_COVER,
  RULE_FHIRST,
  RULE_SECOND,
  RULE_THIRD,
  RuleScript,
  STATE_IDENTIFIED,
  WORKSPACE_RULE_ID,
} from "./QuietChannelsWorld";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * THE BACKUP FROM THE SAME ROTATION, IN AN INCIDENT'S SLACK CHANNEL.
 *
 * The ladder a customer asked for: Level 1 pages whoever is on call in
 * "Primary cover" (Nitin), Level 2 the next person in its rotation (NB User
 * 3), Level 3 the Platform team's Jane. The incident runs through
 * OneUptime's real services, workspace layer and SlackUtil against a fake
 * Slack API (QuietChannelsWorld holds the database in memory), and the run's
 * one message and the incident's feed say who the backup was, and why. When
 * nobody is next in the rotation, the run's alarm says that.
 */

const SLACK_INCIDENT_CHANNEL: string = "C0INC9";

interface SlackRequest {
  method: string;
  ts: string;
  text: string;
  notification: string | undefined;
}

// The Slack API, as far as posting goes, recording every call.
class FakeSlack {
  public requests: Array<SlackRequest> = [];
  private nextTs: number = 1;

  public install(): void {
    jest.spyOn(API, "post").mockImplementation((async (data: {
      url: { toString: () => string };
      data: JSONObject;
    }): Promise<HTTPResponse<JSONObject>> => {
      const method: string = data.url.toString().split("/api/")[1] || "";
      const body: JSONObject = data.data || {};
      const blocks: Array<JSONObject> =
        (body["blocks"] as Array<JSONObject> | undefined) || [];

      let ts: string = String(body["ts"] || "");
      let answer: JSONObject = { ok: true };

      if (method === "conversations.info") {
        answer = {
          ok: true,
          channel: { id: body["channel"], name: "inc-inc-9" },
        };
      } else if (method === "conversations.members") {
        answer = {
          ok: true,
          members: ["B0BOT"],
          response_metadata: { next_cursor: "" },
        };
      } else if (method === "chat.postMessage") {
        ts = `1760000000.${String(this.nextTs++).padStart(6, "0")}`;
        answer = { ok: true, ts: ts, channel: body["channel"] };
      } else if (method === "chat.update") {
        answer = { ok: true, ts: ts, channel: body["channel"] };
      }

      this.requests.push({
        method: method,
        ts: ts,
        text: blocks
          .map((block: JSONObject): string => {
            return String(
              (block["text"] as JSONObject | undefined)?.["text"] || "",
            );
          })
          .join("\n"),
        notification:
          body["text"] === undefined ? undefined : String(body["text"]),
      });

      return {
        jsonData: answer,
        data: answer,
      } as unknown as HTTPResponse<JSONObject>;
    }) as never);
  }

  public posts(): Array<SlackRequest> {
    return this.requests.filter((request: SlackRequest): boolean => {
      return request.method === "chat.postMessage";
    });
  }

  // The run's message as it reads now: its last edit, else its post.
  public runMessage(): string {
    const runPost: SlackRequest | undefined = this.posts().find(
      (post: SlackRequest): boolean => {
        return (post.notification || "").includes("is paging for");
      },
    );

    const edits: Array<SlackRequest> = this.requests.filter(
      (request: SlackRequest): boolean => {
        return request.method === "chat.update" && request.ts === runPost?.ts;
      },
    );

    return (edits[edits.length - 1] || runPost)?.text || "";
  }
}

function ladder(levelTwo: RuleScript["targets"]): Array<RuleScript> {
  return [
    {
      id: RULE_FHIRST,
      order: 1,
      name: "Level 1",
      escalateAfterInMinutes: 5,
      targets: [{ kind: "page", userId: NITIN, scheduleId: PRIMARY_COVER }],
    },
    {
      id: RULE_SECOND,
      order: 2,
      name: "Level 2",
      escalateAfterInMinutes: 5,
      targets: levelTwo,
    },
    {
      id: RULE_THIRD,
      order: 3,
      name: "Platform",
      escalateAfterInMinutes: 5,
      targets: [{ kind: "page", userId: JANE }],
    },
  ];
}

let slack: FakeSlack;
let world: QuietChannelsWorld;

beforeEach(() => {
  slack = new FakeSlack();
  slack.install();

  world = new QuietChannelsWorld({
    workspaces: [WorkspaceType.Slack],
    channels: {
      slack: {
        id: SLACK_INCIDENT_CHANNEL,
        name: "inc-inc-9",
        workspaceType: WorkspaceType.Slack,
        notificationRuleId: WORKSPACE_RULE_ID.toString(),
      },
    },
  });
  world.repeatsAllowed = 0;
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function declareAndPage(): Promise<void> {
  await world.channelCreated([NITIN, NB_USER_3, JANE]);
  await world.incidentCreated();
  await world.incidentState({
    to: STATE_IDENTIFIED,
    name: "Identified",
    isFirst: true,
  });
  await world.startRun();
}

function onCallFeed(): Array<string> {
  return world.feed
    .filter((entry: FeedEntry): boolean => {
      return entry.eventType === IncidentFeedEventType.OnCallPolicy;
    })
    .map((entry: FeedEntry): string => {
      return entry.markdown;
    });
}

describe("Level 2 pages the next person in the Primary cover rotation", () => {
  beforeEach(() => {
    world.rules = ladder([
      {
        kind: "page",
        userId: NB_USER_3,
        scheduleId: PRIMARY_COVER,
        isNextInRotation: true,
      },
    ]);
  });

  test("the run's one message names the backup and why they were paged", async () => {
    await declareAndPage();
    await world.escalate();
    await world.settle();

    const message: string = slack.runMessage();

    expect(message).toContain("Nitin");
    expect(message).toContain(
      "(next in the Primary cover rotation): paged once · by SMS and email",
    );
    // Nitin was paged as on call, not as anybody's backup.
    expect(message).not.toContain("Nitin* (next in");
    expect(message).toContain("Level 2 of 3");
  });

  test("the incident's feed says the same: next in the Primary cover rotation", async () => {
    await declareAndPage();
    await world.escalate();
    await world.settle();

    const feed: Array<string> = onCallFeed();

    /*
     * Each level as the Escalate dialog names it: a level named after its
     * place ("Level 2") is named by its place alone, with the count.
     */
    expect(
      feed.some((markdown: string): boolean => {
        return (
          markdown.includes(
            "at **Level 2 of 3** (next in the **Primary cover** rotation).",
          ) && markdown.includes("NB User 3")
        );
      }),
    ).toBe(true);
    expect(
      feed.some((markdown: string): boolean => {
        return markdown.includes(
          "at **Level 1 of 3** (schedule **Primary cover**).",
        );
      }),
    ).toBe(true);
    expect(feed.join("\n")).not.toContain("escalation rule");
  });

  test("no alarm is raised: every level so far reached somebody", async () => {
    await declareAndPage();
    await world.escalate();
    await world.settle();

    expect(
      slack.posts().some((post: SlackRequest): boolean => {
        return (post.notification || "").includes("paged nobody");
      }),
    ).toBe(false);
  });
});

describe("nobody is next in the Primary cover rotation", () => {
  beforeEach(() => {
    world.rules = ladder([{ kind: "nobodyNext", scheduleId: PRIMARY_COVER }]);
  });

  test("the run's message says so, and one alarm says why Level 2 reached nobody", async () => {
    await declareAndPage();
    await world.escalate();
    await world.settle();

    // Slack's bold is set off by zero-width spaces.
    expect(slack.runMessage()).toContain(
      "Nobody was next in the \u{200B}*Primary cover*\u{200B} rotation",
    );
    expect(slack.runMessage()).not.toContain("Nobody was on call");

    const alarms: Array<SlackRequest> = slack
      .posts()
      .filter((post: SlackRequest): boolean => {
        return (post.notification || "").includes("paged nobody");
      });

    expect(alarms).toHaveLength(1);
    expect(alarms[0]!.notification).toBe(
      "PolicyX paged nobody at Level 2 of 3 for Incident INC-8",
    );
    expect(alarms[0]!.text).toContain(
      "(nobody was next in the Primary cover rotation)",
    );
  });

  test("the incident's feed says nobody was next - not that nobody was on call", async () => {
    await declareAndPage();
    await world.escalate();
    await world.settle();

    expect(
      onCallFeed().some((markdown: string): boolean => {
        return markdown.includes(
          "paged nobody at **Level 2 of 3**: nobody was next in the **Primary cover** rotation.",
        );
      }),
    ).toBe(true);
  });

  test("Level 3 pages the team next, as the ladder says", async () => {
    await declareAndPage();
    await world.escalate();
    await world.escalate();
    await world.settle();

    expect(slack.runMessage()).toContain("Jane");
  });
});
