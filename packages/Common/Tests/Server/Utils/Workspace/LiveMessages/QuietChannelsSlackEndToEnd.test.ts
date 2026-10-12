import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceLiveMessageKey from "../../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import QuietChannelsWorld, {
  JANE,
  NB_USER_2,
  NB_USER_3,
  NITIN,
  STATE_ACKNOWLEDGED,
  STATE_IDENTIFIED,
  STATE_RESOLVED,
  WORKSPACE_RULE_ID,
  FeedEntry,
} from "./QuietChannelsWorld";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * WHAT AN INCIDENT CHANNEL IN SLACK SHOWS, END TO END.
 *
 * The maintainer's two screenshots of #inc-inc-8: under "Incident INC-8
 * Created" came "Changed Incident INC-8 State to Identified" (said twice),
 * then "On Call Policy Started Executing", "Status Updated ... Started", an
 * "On-Call Alert Notification Sent to Nitin" paragraph, "NB User 3 cannot be
 * invited ...", "Status Updated ... Executing" - and over the next twenty
 * minutes a "Notification Sent to <person>" paragraph for every person, on
 * every rule, on every repeat, each one twice, "cannot be invited" again,
 * and two "Skipped" paragraphs.
 *
 * Here the same incident runs through OneUptime's real services, workspace
 * layer and SlackUtil, against a fake Slack API that records every request
 * (QuietChannelsWorld has the database in memory). The channel now gets
 * one message per event: the incident first, then the one note about who
 * could not be added, the on-call run's one message (edited as the run
 * goes), one alarm when a step reached nobody, and each later state change.
 * Every request is checked: how many, in which order, what it says.
 */

const SLACK_INCIDENT_CHANNEL: string = "C0INC8";

interface SlackRequest {
  method: string;
  channel: string;
  ts: string;
  // Set when a message is posted as a reply in another message's thread.
  threadTs: string;
  text: string;
  blocks: Array<JSONObject>;
}

// The Slack API, as far as OneUptime's posting goes, recording every call.
class FakeSlack {
  public requests: Array<SlackRequest> = [];
  // What Slack answers the next chat.update with, when it refuses it.
  public refuseNextUpdateWith: string | null = null;
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

      switch (method) {
        case "conversations.info":
          answer = {
            ok: true,
            channel: { id: body["channel"], name: "inc-inc-8" },
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
          ts = `1760000000.${String(this.nextTs++).padStart(6, "0")}`;
          answer = { ok: true, ts: ts, channel: body["channel"] };
          break;
        case "chat.update":
          if (this.refuseNextUpdateWith) {
            answer = { ok: false, error: this.refuseNextUpdateWith };
            this.refuseNextUpdateWith = null;
          } else {
            answer = { ok: true, ts: ts, channel: body["channel"] };
          }
          break;
        default:
          break;
      }

      this.requests.push({
        method: method,
        channel: String(body["channel"] || ""),
        ts: ts,
        threadTs: String(body["thread_ts"] || ""),
        text: FakeSlack.textOf(blocks),
        blocks: blocks,
      });

      return {
        jsonData: answer,
        data: answer,
      } as unknown as HTTPResponse<JSONObject>;
    }) as never);
  }

  // A message's blocks as text: sections, headers, and buttons as [titles].
  public static textOf(blocks: Array<JSONObject>): string {
    return blocks
      .map((block: JSONObject): string => {
        if (block["type"] === "actions") {
          return `[${((block["elements"] as Array<JSONObject>) || [])
            .map((element: JSONObject): string => {
              return String((element["text"] as JSONObject)?.["text"] || "");
            })
            .join("] [")}]`;
        }

        if (block["type"] === "divider") {
          return "---";
        }

        return String(
          (block["text"] as JSONObject | undefined)?.["text"] || "",
        );
      })
      .join("\n");
  }

  public posts(): Array<SlackRequest> {
    return this.requests.filter((request: SlackRequest): boolean => {
      return request.method === "chat.postMessage";
    });
  }

  public updates(): Array<SlackRequest> {
    return this.requests.filter((request: SlackRequest): boolean => {
      return request.method === "chat.update";
    });
  }
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
        name: "inc-inc-8",
        workspaceType: WorkspaceType.Slack,
        notificationRuleId: WORKSPACE_RULE_ID.toString(),
      },
    },
  });
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// A post's first line: what a person scanning the channel reads.
function headline(request: SlackRequest): string {
  return request.text.split("\n")[0]!;
}

function feedOf(eventType: string): Array<FeedEntry> {
  return world.feed.filter((entry: FeedEntry): boolean => {
    return entry.eventType === eventType;
  });
}

async function declareIncidentAndPage(): Promise<void> {
  // The incident's channel is created and its people invited.
  await world.channelCreated([NITIN, NB_USER_3]);
  await world.incidentCreated();
  await world.incidentState({
    to: STATE_IDENTIFIED,
    name: "Identified",
    isFirst: true,
  });

  // PolicyX: rule "fhirst" pages Nitin, who is invited to the channel.
  await world.startRun();
  await world.invitedToRecordChannels([NITIN]);
}

async function escalateThroughTheScreenshots(): Promise<void> {
  // Rule "second": NB User 3 and Nitin. NB User 3 is invited again.
  await world.escalate();
  await world.invitedToRecordChannels([NB_USER_3, NITIN]);

  // Rule "third": NB User 2 left the project - nobody is paged.
  await world.escalate();

  // Nobody acknowledged: the policy repeats, rule "fhirst" pages Nitin again.
  await world.escalate();
}

describe("an incident from declared to resolved, in its Slack channel", () => {
  test("one message per event, in order - not the dozens in the screenshots", async () => {
    await declareIncidentAndPage();
    await escalateThroughTheScreenshots();
    await world.acknowledge(NITIN);
    await world.incidentState({
      to: STATE_ACKNOWLEDGED,
      name: "Acknowledged",
      isFirst: false,
      by: NITIN,
    });
    await world.incidentState({
      to: STATE_RESOLVED,
      name: "Resolved",
      isFirst: false,
      by: NITIN,
    });
    await world.settle();

    const posts: Array<SlackRequest> = slack.posts();

    expect(posts.map(headline)).toEqual([
      expect.stringContaining("Incident INC-8 Created"),
      expect.stringContaining("Not everyone could be added to this channel"),
      expect.stringContaining("PolicyX"),
      expect.stringContaining("Nobody was paged for"),
      expect.stringContaining("State"),
      expect.stringContaining("State"),
    ]);

    // Every message went to the incident's channel, as a message of its own.
    for (const post of posts) {
      expect(post.channel).toBe(SLACK_INCIDENT_CHANNEL);
      expect(post.threadTs).toBe("");
    }

    // Nothing but posts and edits of the run's message reached Slack's chat API.
    expect(
      slack.requests
        .filter((request: SlackRequest): boolean => {
          return request.method.startsWith("chat.");
        })
        .every((request: SlackRequest): boolean => {
          return (
            request.method === "chat.postMessage" ||
            (request.method === "chat.update" && request.ts === posts[2]!.ts)
          );
        }),
    ).toBe(true);

    // 1. The incident - the channel opens on it: its state, severity, buttons.
    expect(posts[0]!.text).toContain("Incident State");
    expect(posts[0]!.text).toContain("Identified");
    expect(posts[0]!.text).toContain("Acknowledge Incident");

    // 2. Who could not be added - once, naming NB User 3 and how to fix it.
    expect(posts[1]!.text).toContain("NB User 3");
    expect(posts[1]!.text).toContain("User Settings → Slack");

    // 3. The on-call run: posted as it began paging Nitin.
    expect(posts[2]!.text).toContain("is paging for");
    expect(posts[2]!.text).toContain("Incident INC-8");

    // 4. The alarm: rule "third" paged nobody.
    expect(posts[3]!.text).toContain("escalation rule 3 of 3 (third)");
    expect(posts[3]!.text).toContain("NB User 2: not a member of this project");

    // 5 and 6. The later state changes, with who made them.
    expect(posts[4]!.text).toContain("Nitin");
    expect(posts[4]!.text).toContain("Acknowledged");
    expect(posts[5]!.text).toContain("Resolved");
  });

  test("the on-call run is ONE message, edited in place as it escalates, repeats and is acknowledged", async () => {
    await declareIncidentAndPage();

    const runPost: SlackRequest = slack.posts()[2]!;
    expect(headline(runPost)).toContain("PolicyX");

    await escalateThroughTheScreenshots();
    await world.acknowledge(NITIN);

    const updates: Array<SlackRequest> = slack.updates();

    expect(updates.length).toBeGreaterThan(0);

    // Every edit is of the run's message, in its channel.
    for (const update of updates) {
      expect(update.ts).toBe(runPost.ts);
      expect(update.channel).toBe(SLACK_INCIDENT_CHANNEL);
    }

    // What it says at the end: who acknowledged, who was paged, who was not.
    const last: string = updates[updates.length - 1]!.text;
    expect(last).toContain("Nitin");
    expect(last).toContain("acknowledged");
    expect(last).toContain("stopped paging");
    expect(last).toContain("paged 3 times");
    expect(last).toContain("SMS, email");
    expect(last).toContain("NB User 3");
    expect(last).toContain("paged once");
    expect(last).toContain("NB User 2");
    expect(last).toContain("not a member of this project");

    // And it is kept: one message for the run, in one channel.
    const kept: Array<unknown> = world.liveMessages.rows.filter(
      (row: { messageKey?: string }): boolean => {
        return Boolean(
          row.messageKey?.startsWith(
            WorkspaceLiveMessageKey.forOnCallPolicyRun(
              ObjectID.generate(),
            ).split(":")[0]!,
          ),
        );
      },
    );
    expect(kept).toHaveLength(1);
  });

  test("after each step of the screenshots' run, its one message says exactly where the run is", async () => {
    // What the run's message says now: its last edit, else its post.
    const runMessage: () => string = (): string => {
      const updates: Array<SlackRequest> = slack.updates();

      if (updates.length > 0) {
        return updates[updates.length - 1]!.text;
      }

      return slack.posts().find((post: SlackRequest): boolean => {
        return headline(post).includes("is paging for");
      })!.text;
    };

    // Rule "fhirst" paged Nitin.
    await declareIncidentAndPage();
    let message: string = runMessage();
    expect(message).toContain("is paging for");
    expect(message).toContain(
      "Escalation rule 1 of 3 (fhirst)*\u200b · repeats once if nobody acknowledges",
    );
    expect(message).toContain("Nitin*\u200b: paged once · by SMS, email");
    expect(message).toContain(
      "If nobody acknowledges within 6 minutes, escalation rule 2 of 3 (second) is next.",
    );
    expect(message).not.toContain("Not paged");

    // Rule "second" paged NB User 3, and Nitin again.
    await world.escalate();
    message = runMessage();
    expect(message).toContain("Escalation rule 2 of 3 (second)");
    expect(message).toContain("Nitin*\u200b: paged twice · by SMS, email");
    expect(message).toContain("NB User 3*\u200b: paged once · by SMS, email");
    expect(message).toContain(
      "If nobody acknowledges within 7 minutes, escalation rule 3 of 3 (third) is next.",
    );

    // Rule "third" reached nobody: NB User 2 left the project.
    await world.escalate();
    message = runMessage();
    expect(message).toContain("Escalation rule 3 of 3 (third)");
    expect(message).toContain("Not paged");
    expect(message).toContain("NB User 2*\u200b: not a member of this project");
    expect(message).toContain(
      "If nobody acknowledges within 7 minutes, the policy starts again from escalation rule 1.",
    );

    // Nobody acknowledged: the policy repeats from rule "fhirst".
    await world.escalate();
    message = runMessage();
    expect(message).toContain(
      "Escalation rule 1 of 3 (fhirst)*\u200b · repeat 1 of 1",
    );
    expect(message).toContain("Nitin*\u200b: paged 3 times · by SMS, email");

    // Nitin acknowledged.
    await world.acknowledge(NITIN);
    message = runMessage();
    expect(headline({ text: message } as SlackRequest)).toContain(
      "acknowledged",
    );
    expect(message).toContain("stopped paging");
    expect(message).toContain(
      "Nitin*\u200b: acknowledged ✅ · paged 3 times · by SMS, email",
    );
    expect(message).not.toContain("If nobody acknowledges");
    expect(message).toContain("See every step in OneUptime");

    // All of it in the one message, posted once; the alarm is the only other post naming the policy.
    expect(
      slack
        .posts()
        .filter((post: SlackRequest): boolean => {
          return headline(post).includes("PolicyX");
        })
        .map(headline),
    ).toEqual([
      expect.stringContaining("is paging for"),
      expect.stringContaining("Nobody was paged for"),
    ]);
  });

  test("while the run escalates, the message says where it is and what is next", async () => {
    await declareIncidentAndPage();
    await world.escalate();

    const last: string = slack.updates()[slack.updates().length - 1]!.text;

    expect(last).toContain("is paging for");
    expect(last).toContain("Escalation rule 2 of 3 (second)");
    expect(last).toContain("repeats once if nobody acknowledges");
    expect(last).toContain("escalation rule 3 of 3 (third) is next");
    expect(last).toContain("within 7 minutes");
  });

  test("a run that ends with nobody acknowledging raises one more alarm, and its message says so", async () => {
    await declareIncidentAndPage();
    await escalateThroughTheScreenshots();
    // The repeat's last rules, then the end of the run.
    await world.escalate();
    await world.escalate();
    await world.escalate();

    const alarms: Array<SlackRequest> = slack
      .posts()
      .filter((post: SlackRequest): boolean => {
        return post.text.includes("Nobody");
      });

    expect(alarms.map(headline)).toEqual([
      expect.stringContaining("Nobody was paged for"),
      expect.stringContaining("Nobody has acknowledged"),
    ]);
    expect(alarms[1]!.text).toContain("Someone needs to take it");

    const last: string = slack.updates()[slack.updates().length - 1]!.text;
    expect(last).toContain("nobody acknowledged");
  });
});

describe("REGRESSION: each duplicate in the screenshots, one by one", () => {
  test("'Changed Incident INC-8 State to Identified' under the message that already says 'Incident State: Identified'", async () => {
    await world.incidentCreated();
    await world.incidentState({
      to: STATE_IDENTIFIED,
      name: "Identified",
      isFirst: true,
    });

    expect(slack.posts()).toHaveLength(1);
    expect(slack.posts()[0]!.text).toContain("Incident INC-8 Created");

    // The feed still has it.
    expect(feedOf("IncidentStateChanged")).toHaveLength(1);
    expect(feedOf("IncidentStateChanged")[0]!.postsToWorkspace).toBe(false);
  });

  test("'On Call Policy Started Executing' and 'Status Updated ... Started / Executing' are gone from the channel, kept in the feed", async () => {
    await world.startRun();

    for (const post of slack.posts()) {
      expect(post.text).not.toContain("On Call Policy");
      expect(post.text).not.toContain("Status Updated");
    }

    const onCallFeed: Array<FeedEntry> = feedOf("OnCallPolicy");
    expect(
      onCallFeed.some((entry: FeedEntry): boolean => {
        return entry.markdown.includes("On Call Policy Started Executing");
      }),
    ).toBe(true);
    expect(
      onCallFeed.filter((entry: FeedEntry): boolean => {
        return entry.markdown.includes("Status Updated");
      }),
    ).toHaveLength(2);

    for (const entry of onCallFeed) {
      expect(entry.postsToWorkspace).toBe(false);
    }
  });

  test("'On-Call Alert Notification Sent to <person>', once per person per rule per repeat - and each of those twice", async () => {
    await world.startRun();
    await world.escalate();
    await world.escalate();
    await world.escalate();

    for (const post of slack.posts()) {
      expect(post.text).not.toContain("Notification Sent");
      expect(post.text).not.toContain("On-Call Alert");
    }

    // The feed records each page ONCE (the second write was a duplicate there too).
    const sent: Array<FeedEntry> = feedOf("OnCallPolicy").filter(
      (entry: FeedEntry): boolean => {
        return entry.markdown.includes("Notification Sent to");
      },
    );
    expect(
      sent.map((entry: FeedEntry): string => {
        return entry.markdown.includes("Nitin") ? "Nitin" : "NB User 3";
      }),
    ).toEqual(["Nitin", "NB User 3", "Nitin", "Nitin"]);
  });

  test("'NB User 3 cannot be invited to the channel ...' once at creation and again every time NB User 3 is paged", async () => {
    await world.channelCreated([NITIN, NB_USER_3]);

    // Nothing is said while the channel is set up...
    expect(slack.posts()).toHaveLength(0);

    await world.incidentCreated();
    await world.invitedToRecordChannels([NB_USER_3]);
    await world.invitedToRecordChannels([NB_USER_3, NITIN]);

    const notes: Array<SlackRequest> = slack
      .posts()
      .filter((post: SlackRequest): boolean => {
        return post.text.includes("Not everyone could be added");
      });

    expect(notes).toHaveLength(1);
    expect(slack.updates()).toHaveLength(0);

    // ... and the note comes right under the incident, not above it.
    expect(slack.posts().map(headline)).toEqual([
      expect.stringContaining("Incident INC-8 Created"),
      expect.stringContaining("Not everyone could be added"),
    ]);

    for (const post of slack.posts()) {
      expect(post.text).not.toContain("cannot be invited");
    }

    // Nitin, who is connected, was invited; NB User 3 was not.
    expect(world.invites[0]).toEqual({
      channelNames: ["inc-inc-8"],
      userIds: ["U0NITIN"],
    });
  });

  test("somebody else who cannot be added later is added to the same note, edited in place", async () => {
    world.members.add(NB_USER_2.toString());

    await world.channelCreated([NB_USER_3]);
    await world.incidentCreated();
    await world.invitedToRecordChannels([NB_USER_2]);

    // The incident, then the note; the note is edited, not posted again.
    expect(slack.posts()).toHaveLength(2);
    const note: SlackRequest = slack.posts()[1]!;
    expect(note.text).toContain("Not everyone could be added");

    expect(slack.updates()).toHaveLength(1);
    expect(slack.updates()[0]!.ts).toBe(note.ts);
    expect(slack.updates()[0]!.text).toContain("NB User 3");
    expect(slack.updates()[0]!.text).toContain("NB User 2");
  });

  test("a channel everybody could be added to gets no note at all", async () => {
    await world.channelCreated([NITIN, JANE]);
    await world.incidentCreated();
    await world.invitedToRecordChannels([NITIN]);

    expect(slack.posts().map(headline)).toEqual([
      expect.stringContaining("Incident INC-8 Created"),
    ]);
    expect(world.invites[0]).toEqual({
      channelNames: ["inc-inc-8"],
      userIds: ["U0NITIN", "U0JANE"],
    });
  });

  test("two 'On-Call Alert Skipped' paragraphs for one rule that paged nobody: one alarm, once per run", async () => {
    await world.startRun();
    await world.escalate();
    await world.escalate();

    // The repeat reaches rule "third" again: no second alarm.
    await world.escalate();
    await world.escalate();
    await world.escalate();

    const nobodyPaged: Array<SlackRequest> = slack
      .posts()
      .filter((post: SlackRequest): boolean => {
        return post.text.includes("Nobody was paged");
      });

    expect(nobodyPaged).toHaveLength(1);

    for (const post of slack.posts()) {
      expect(post.text).not.toContain("On-Call Alert Skipped");
    }
  });
});

describe("an edit Slack refuses", () => {
  test("message_not_found - somebody deleted the run's message: it is posted again, and edited there from then on", async () => {
    await world.startRun();

    const first: SlackRequest = slack.posts()[0]!;
    slack.refuseNextUpdateWith = "message_not_found";

    await world.escalate();

    const runPosts: Array<SlackRequest> = slack
      .posts()
      .filter((post: SlackRequest): boolean => {
        return headline(post).includes("PolicyX");
      });

    expect(runPosts).toHaveLength(2);
    expect(runPosts[1]!.ts).not.toBe(first.ts);

    await world.escalate();

    const lastUpdate: SlackRequest =
      slack.updates()[slack.updates().length - 1]!;
    expect(lastUpdate.ts).toBe(runPosts[1]!.ts);
  });

  test("any other refusal - the channel was archived - posts nothing new; the next change tries the edit again", async () => {
    await world.startRun();

    slack.refuseNextUpdateWith = "is_archived";
    const updatesBefore: number = slack.updates().length;

    await world.escalate();

    const runPosts: Array<SlackRequest> = slack
      .posts()
      .filter((post: SlackRequest): boolean => {
        return headline(post).includes("PolicyX");
      });

    expect(runPosts).toHaveLength(1);
    // The refused edit, then the edits after it, all of the one message.
    expect(slack.updates().length).toBeGreaterThan(updatesBefore + 1);
    for (const update of slack.updates()) {
      expect(update.ts).toBe(runPosts[0]!.ts);
    }
  });
});

describe("what still reaches the channel as it always did", () => {
  test("a note is posted, with who wrote it", async () => {
    await world.incidentNote("Restarted the primary database.", JANE);

    expect(slack.posts()).toHaveLength(1);
    expect(slack.posts()[0]!.text).toContain("Jane Doe");
    expect(slack.posts()[0]!.text).toContain("Restarted the primary database.");
  });
});

describe("an alert, in its Slack channel", () => {
  beforeEach(() => {
    world.runFor = "alert";
    world.recordStateName = "Created";
  });

  test("created, first state, on-call, owners notified, acknowledged: four messages, the run's edited in place", async () => {
    await world.alertCreated();
    await world.alertState({
      to: STATE_IDENTIFIED,
      name: "Created",
      isFirst: true,
    });
    await world.startRun();
    await world.escalate();
    await world.alertOwnersNotified();
    await world.acknowledge(NITIN);
    await world.alertState({
      to: STATE_ACKNOWLEDGED,
      name: "Acknowledged",
      isFirst: false,
    });
    await world.settle();

    expect(slack.posts().map(headline)).toEqual([
      expect.stringContaining("Alert AL-12 Created"),
      expect.stringContaining("PolicyX"),
      expect.stringContaining("State"),
    ]);

    // The run's message names the alert.
    expect(slack.posts()[1]!.text).toContain("Alert AL-12");

    // That the owners were told stays in the alert's feed.
    expect(
      world.feed.filter((entry: FeedEntry): boolean => {
        return entry.eventType === "OwnerNotificationSent";
      }),
    ).toEqual([
      expect.objectContaining({ record: "alert", postsToWorkspace: false }),
    ]);

    const last: string = slack.updates()[slack.updates().length - 1]!.text;
    expect(last).toContain("acknowledged");
    expect(last).toContain("Alert AL-12");
  });
});

describe("a scheduled maintenance event, in its Slack channel", () => {
  test("created, first state, ongoing, subscribers notified, a note: three messages", async () => {
    await world.maintenanceCreated();
    await world.maintenanceState("Scheduled", true);
    await world.maintenanceState("Ongoing", false);
    await world.maintenanceSubscribersNotified();
    await world.maintenanceNote("The upgrade has started.");

    expect(slack.posts().map(headline)).toEqual([
      expect.stringContaining("Scheduled Maintenance SM-3 Created"),
      expect.stringContaining("Ongoing"),
      expect.stringContaining("public note"),
    ]);

    // The event's first state and its subscribers' notice stay in its feed.
    expect(
      world.feed
        .filter((entry: FeedEntry): boolean => {
          return !entry.postsToWorkspace;
        })
        .map((entry: FeedEntry): string => {
          return entry.eventType;
        }),
    ).toEqual([
      "ScheduledMaintenanceStateChanged",
      "SubscriberNotificationSent",
    ]);

    // Nothing is edited for a maintenance event: it has no on-call run.
    expect(slack.updates()).toHaveLength(0);
  });
});
