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
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import WorkspaceLiveMessageKey from "../../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import QuietChannelsWorld, {
  DASHBOARD,
  JANE,
  NB_USER_2,
  NB_USER_3,
  NITIN,
  PROJECT_ID,
  RULE_FHIRST,
  RULE_SECOND,
  STATE_ACKNOWLEDGED,
  STATE_IDENTIFIED,
  STATE_RESOLVED,
  WORKSPACE_RULE_ID,
  FeedEntry,
} from "./QuietChannelsWorld";

// A feed entry that says a person was paged: "... paged **Nitin** at ...".
const PAGED_SOMEONE_PATTERN: RegExp = / paged \*\*/;

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
  /*
   * The request's top-level `text`: what a push notification, a preview or
   * a screen reader shows of the message. Undefined when it was not sent.
   */
  notification: string | undefined;
  blocks: Array<JSONObject>;
}

/*
 * A moment as Slack shows it in each reader's own time: "<!date^...^{time}|
 * 17:21 UTC>", from the run's clock (QuietChannelsWorld.clock).
 */
function slackTime(iso: string): string {
  const date: Date = new Date(iso);
  const clock: string = iso.slice(11, 16);

  return `<!date^${Math.floor(date.getTime() / 1000)}^{time}|${clock} UTC>`;
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
        notification:
          body["text"] === undefined ? undefined : String(body["text"]),
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

  /*
   * Rule "third": NB User 2 left the project - nobody is paged. Nobody is
   * on it to wait for, so the policy repeats at once (OnCallEmptyLevel):
   * rule "fhirst" pages Nitin again, the same minute.
   */
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
      expect.stringContaining("could not be added to this channel"),
      expect.stringContaining("PolicyX"),
      expect.stringContaining("paged nobody at third (Level 3 of 3)"),
      expect.stringContaining("State"),
      expect.stringContaining("State"),
    ]);

    /*
     * What each new message's notification says. The note, the run's
     * message and the alarm say what they are about - the alarm above all,
     * which is posted for somebody to act - and so do the record's own
     * messages now (WorkspaceNotificationText): they used to buzz phones
     * with "This content can't be displayed".
     */
    expect(
      posts.map((post: SlackRequest): string | undefined => {
        return post.notification;
      }),
    ).toEqual([
      "🚨 Incident INC-8 Created: testslack",
      "NB User 3 could not be added to this channel",
      "PolicyX is paging for Incident INC-8",
      "PolicyX paged nobody at third (Level 3 of 3) for Incident INC-8",
      "Nitin 👀 Changed Incident INC-8 State to Acknowledged",
      "Nitin ✅ Changed Incident INC-8 State to Resolved",
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
    expect(posts[1]!.text).toContain("|Connect Slack account>");

    // 3. The on-call run: posted as it began paging Nitin.
    expect(posts[2]!.text).toContain("is paging for");
    expect(posts[2]!.text).toContain("Incident INC-8");

    // 4. The alarm: rule "third" paged nobody.
    expect(posts[3]!.text).toContain("third (Level 3 of 3)");
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
    expect(last).toContain("SMS and email");
    expect(last).toContain("NB User 3");
    expect(last).toContain("paged once");
    expect(last).toContain("NB User 2");
    expect(last).toContain("not a member of this project");
    expect(updates[updates.length - 1]!.notification).toBe(
      "Nitin acknowledged Incident INC-8",
    );

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

    /*
     * Rule "fhirst" paged Nitin at 5:15 PM. When rule 2 comes is a moment
     * in each reader's own time - 5:21 PM - never "within 6 minutes", which
     * a message edited for half an hour cannot anchor.
     */
    await declareIncidentAndPage();
    let message: string = runMessage();
    expect(message).toContain("is paging for");
    expect(message).toContain(
      `fhirst (Level 1 of 3)*\u200b: if nobody acknowledges by ${slackTime("2026-10-08T17:21:00Z")}, second (Level 2 of 3) is next.`,
    );
    expect(message).toContain("Nitin*\u200b: paged once · by SMS and email");
    expect(message).not.toContain("not paged");
    expect(message).not.toContain("within");

    // Rule "second", at 5:21, paged NB User 3, and Nitin again.
    await world.escalate();
    message = runMessage();
    expect(message).toContain(
      `second (Level 2 of 3)*\u200b: if nobody acknowledges by ${slackTime("2026-10-08T17:28:00Z")}, third (Level 3 of 3) is next.`,
    );
    expect(message).toContain("Nitin*\u200b: paged twice · by SMS and email");
    expect(message).toContain(
      "NB User 3*\u200b: paged once · by SMS and email",
    );

    /*
     * Rule "third", at 5:28, reached nobody: NB User 2 left the project.
     * Nobody was on it to wait for, so at 5:28 too - not 5:35 - the policy
     * repeats from rule "fhirst" (OnCallEmptyLevel).
     */
    await world.escalate();
    message = runMessage();
    expect(message).toContain(
      `fhirst (Level 1 of 3)*\u200b, repeat 1 of 1: if nobody acknowledges by ${slackTime("2026-10-08T17:34:00Z")}, second (Level 2 of 3) is next.`,
    );
    expect(message).not.toContain("third (Level 3 of 3)*\u200b: if nobody");
    expect(message).toContain(
      "NB User 2*\u200b: not paged · not a member of this project",
    );
    expect(message).toContain("Nitin*\u200b: paged 3 times · by SMS and email");

    // Nitin acknowledged.
    await world.acknowledge(NITIN);
    message = runMessage();
    expect(headline({ text: message } as SlackRequest)).toContain(
      "acknowledged",
    );
    expect(message).toContain(", so ");
    expect(message).toContain("stopped paging");
    expect(message).toContain(
      "Nitin*\u200b: acknowledged · paged 3 times · by SMS and email",
    );
    expect(message).not.toContain("if nobody acknowledges");
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
      expect.stringContaining("paged nobody at third (Level 3 of 3)"),
    ]);
  });

  test("while the run escalates, the message says where it is and what is next", async () => {
    await declareIncidentAndPage();
    await world.escalate();

    const last: string = slack.updates()[slack.updates().length - 1]!.text;

    expect(last).toContain("is paging for");
    expect(last).toContain("second (Level 2 of 3)");
    expect(last).toContain(
      `if nobody acknowledges by ${slackTime("2026-10-08T17:28:00Z")}, third (Level 3 of 3) is next`,
    );
    // The first pass leaves the repeat to the last rule's next step.
    expect(last).not.toContain("repeat");
  });

  test("a run that ends with nobody acknowledging raises one more alarm, and its message says so", async () => {
    await declareIncidentAndPage();
    await escalateThroughTheScreenshots();
    // The repeat's last rules: "third" reaches nobody, and the run ends at once.
    await world.escalate();
    await world.escalate();

    // Every post after the run's own message is an alarm.
    const alarms: Array<SlackRequest> = slack.posts().slice(3);

    expect(alarms.map(headline)).toEqual([
      expect.stringContaining("paged nobody at third (Level 3 of 3)"),
      expect.stringContaining("Nobody has acknowledged"),
    ]);
    expect(alarms[1]!.text).toContain("Someone needs to take it");
    expect(alarms[1]!.notification).toBe(
      "Nobody has acknowledged Incident INC-8: someone needs to take it",
    );

    const last: string = slack.updates()[slack.updates().length - 1]!.text;
    expect(last).toContain("nobody acknowledged");
  });

  /*
   * A run's message is brought up to date after the run ends too - a page's
   * delivery finishing late. It used to read why the run ended from the
   * incident as it was then, so an incident acknowledged after the policy
   * gave up rewrote "nobody acknowledged" as "moved to Acknowledged, so the
   * policy stopped paging". Why it ended is in the run's own status message.
   */
  test("REGRESSION: a run that went through every rule still says so when the incident is acknowledged afterwards", async () => {
    await declareIncidentAndPage();
    await escalateThroughTheScreenshots();
    await world.escalate();
    await world.escalate();

    const postsBefore: number = slack.posts().length;
    const updatesBefore: number = slack.updates().length;

    // Somebody acknowledges the incident in OneUptime; a late delivery refreshes the run.
    world.recordAcknowledged = true;
    world.recordStateName = "Acknowledged";
    OnCallPolicyRunMessage.refresh(world.run!.id!);
    await world.settle();

    // Nothing to change: no edit, no new message.
    expect(slack.updates()).toHaveLength(updatesBefore);
    expect(slack.posts()).toHaveLength(postsBefore);

    const last: string = slack.updates()[slack.updates().length - 1]!.text;
    expect(last).toContain("went through every escalation rule");
    expect(last).not.toContain("moved to");
  });

  test("the incident acknowledged in OneUptime while the run escalates: the run's message says so, and no alarm is raised", async () => {
    await declareIncidentAndPage();
    await world.escalate();

    const postsBefore: number = slack.posts().length;

    await world.recordHandledElsewhere("Acknowledged");

    const last: SlackRequest = slack.updates()[slack.updates().length - 1]!;

    expect(headline(last)).toContain("moved to");
    expect(headline(last)).toContain("Acknowledged*\u200b, so");
    expect(headline(last)).toContain("stopped paging");
    expect(last.notification).toBe(
      "Incident INC-8 moved to Acknowledged, so PolicyX stopped paging",
    );
    // Somebody is on it: nothing new is posted.
    expect(slack.posts()).toHaveLength(postsBefore);
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

    /*
     * In the feed, the run's start once, in one sentence (OnCallFeedText).
     * Its own Started and Executing statuses add nothing: they said
     * "started paging" a second time and "is paging" a third.
     */
    const onCallFeed: Array<FeedEntry> = feedOf("OnCallPolicy");
    expect(
      onCallFeed.filter((entry: FeedEntry): boolean => {
        return entry.markdown.endsWith(" started paging.");
      }),
    ).toHaveLength(1);
    expect(
      onCallFeed.filter((entry: FeedEntry): boolean => {
        return entry.markdown.includes(" is paging.");
      }),
    ).toHaveLength(0);

    for (const entry of onCallFeed) {
      expect(entry.postsToWorkspace).toBe(false);
    }
  });

  test("'On-Call Alert Notification Sent to <person>', once per person per rule per repeat - and each of those twice", async () => {
    await world.startRun();
    await world.escalate();
    // Rule "third" pages nobody: the policy repeats from "fhirst" at once.
    await world.escalate();

    for (const post of slack.posts()) {
      expect(post.text).not.toContain("Notification Sent");
      expect(post.text).not.toContain("On-Call Alert");
    }

    // The feed records each page ONCE (the second write was a duplicate there too).
    const sent: Array<FeedEntry> = feedOf("OnCallPolicy").filter(
      (entry: FeedEntry): boolean => {
        return PAGED_SOMEONE_PATTERN.test(entry.markdown);
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
        return post.text.includes("could not be added to this channel");
      });

    expect(notes).toHaveLength(1);
    expect(slack.updates()).toHaveLength(0);

    // ... and the note comes right under the incident, not above it.
    expect(slack.posts().map(headline)).toEqual([
      expect.stringContaining("Incident INC-8 Created"),
      expect.stringContaining("NB User 3"),
    ]);
    expect(notes[0]!.text).toContain(
      "NB User 3*\u200b could not be added to this channel: they have not connected their Slack account to OneUptime yet, and it could not be found by their email address. Add them here yourself, or send them this link to connect in one click:",
    );

    /*
     * The link, as Slack shows it: the Slack settings page of whoever opens
     * it, which connects their account in one click.
     */
    const link: string | undefined = notes[0]!.text.match(
      /<(https:[^|>\s]+)\|Connect Slack account>/u,
    )?.[1];
    expect(link).toBeDefined();
    const url: URL = new URL(link!);
    expect(url.origin + url.pathname).toBe(
      `${DASHBOARD}/${PROJECT_ID.toString()}/user-settings/slack-integration`,
    );
    expect(Array.from(url.searchParams.entries())).toEqual([
      ["connectAccount", "true"],
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
    expect(note.text).toContain("could not be added to this channel");

    expect(slack.updates()).toHaveLength(1);
    expect(slack.updates()[0]!.ts).toBe(note.ts);
    expect(slack.updates()[0]!.text).toContain("NB User 3");
    expect(slack.updates()[0]!.text).toContain("NB User 2");
    expect(slack.updates()[0]!.notification).toBe(
      "NB User 3 and NB User 2 could not be added to this channel",
    );
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

    // The repeat reaches rule "third" again, and ends there: no second alarm.
    await world.escalate();
    await world.escalate();

    const nobodyPaged: Array<SlackRequest> = slack
      .posts()
      .filter((post: SlackRequest): boolean => {
        return post.text.includes("paged nobody at");
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

  test("a message saved as a note is not posted back into the channel it is in", async () => {
    await world.incidentNoteSavedFromChat({
      text: "Not sure what's happening here, is this triggered by something?",
      workspaceType: WorkspaceType.Slack,
      channelId: SLACK_INCIDENT_CHANNEL,
    });

    // The message is there already: nothing more is said in #inc-inc-8.
    expect(slack.requests).toEqual([]);
    // The note is in the incident's timeline all the same.
    expect(world.feed).toEqual([
      expect.objectContaining({ eventType: "PrivateNote" }),
    ]);
  });

  test("a message saved as a note from another channel is posted to the incident's", async () => {
    await world.incidentNoteSavedFromChat({
      text: "Not sure what's happening here, is this triggered by something?",
      workspaceType: WorkspaceType.Slack,
      channelId: "C0SOMEWHEREELSE",
    });

    expect(slack.posts()).toHaveLength(1);
    expect(slack.posts()[0]!.channel).toBe(SLACK_INCIDENT_CHANNEL);
    expect(slack.posts()[0]!.text).toContain(
      "📄 \u200B*Aidil Rahman*\u200B posted \u200B*private note*\u200B for this",
    );
  });

  test("a Microsoft Teams message's note is still posted in Slack", async () => {
    await world.incidentNoteSavedFromChat({
      text: "Rolled back.",
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelId: SLACK_INCIDENT_CHANNEL,
    });

    expect(slack.posts()).toHaveLength(1);
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

/*
 * THE MAINTAINER'S POLICY, IN ITS SLACK CHANNEL. "sg - irm" paged nobody at
 * Level 1 of 2 ("this escalation rule has no responders"), waited Level 1's
 * minutes, and only then paged Nitin Main at Level 2. Level 1 now holds no
 * wait (OnCallEmptyLevel): Nitin is paged the minute the run starts, and
 * the run's one message and the incident's feed say Level 1 was passed at
 * once.
 */
describe("a policy whose first level has nobody to page, in its Slack channel", () => {
  beforeEach(() => {
    world.repeatsAllowed = 0;
    world.rules = [
      {
        id: RULE_FHIRST,
        order: 1,
        name: "Level 1",
        escalateAfterInMinutes: 4,
        targets: [],
      },
      {
        id: RULE_SECOND,
        order: 2,
        name: "Level 2",
        escalateAfterInMinutes: 30,
        targets: [{ kind: "page", userId: NITIN }],
      },
    ];
  });

  // The run's message as it reads now: its last edit, else its post.
  function runMessage(): string {
    const updates: Array<SlackRequest> = slack.updates();

    if (updates.length > 0) {
      return updates[updates.length - 1]!.text;
    }

    return slack.posts().find((post: SlackRequest): boolean => {
      return headline(post).includes("is paging for");
    })!.text;
  }

  test("the run's one message is on Level 2 from the start, waiting Level 2's own minutes", async () => {
    await declareIncidentAndPage();
    await world.settle();

    const message: string = runMessage();

    expect(message).toContain("is paging for");
    expect(message).toContain(
      `Level 2 of 2*\u200b: if nobody acknowledges by ${slackTime("2026-10-08T17:45:00Z")}, paging stops.`,
    );
    expect(message).toContain("Nitin*\u200b: paged once · by SMS and email");
  });

  test("its list says Level 1 had nobody to page, so Level 2 was paged at once", async () => {
    await declareIncidentAndPage();
    await world.settle();

    expect(runMessage()).toContain(
      "Level 1 of 2: nobody to page, so Level 2 of 2 was paged at once",
    );
    expect(runMessage()).not.toContain("trying again");
  });

  test("the incident's feed: Level 1 passed at once, then Nitin paged - the same minute, nothing in between", async () => {
    await declareIncidentAndPage();
    await world.settle();

    const entries: Array<string> = feedOf("OnCallPolicy").map(
      (entry: FeedEntry): string => {
        return entry.markdown;
      },
    );
    const levelOne: number = entries.findIndex((markdown: string): boolean => {
      return markdown.includes(
        "paged nobody at **Level 1 of 2**: this escalation rule has no responders, so the next level was paged at once.",
      );
    });
    const nitin: number = entries.findIndex((markdown: string): boolean => {
      return PAGED_SOMEONE_PATTERN.test(markdown);
    });

    expect(levelOne).toBeGreaterThanOrEqual(0);
    expect(nitin).toBe(levelOne + 1);
    expect(entries[nitin]).toContain("at **Level 2 of 2**.");
    // Said once, in its own words: the step's message is not said again.
    expect(entries.join("\n")).not.toContain("Skipped because no users");
  });

  test("nothing asks the channel to page somebody: Level 2 already was", async () => {
    await declareIncidentAndPage();
    await world.settle();

    for (const post of slack.posts()) {
      expect(post.text).not.toContain("page someone or fix the policy");
    }

    // A level passed at once is said in the run's own message.
    expect(
      slack.posts().filter((post: SlackRequest): boolean => {
        return headline(post).includes("PolicyX");
      }),
    ).toHaveLength(1);
  });

  test("Nitin acknowledges: the run stops, as any run does", async () => {
    await declareIncidentAndPage();
    await world.acknowledge(NITIN);

    expect(runMessage()).toContain("stopped paging");
    expect(runMessage()).toContain(
      "Level 1 of 2: nobody to page, so Level 2 of 2 was paged at once",
    );
  });

  test("with Level 2 empty too, the run stops the minute it starts: one message says nobody was paged, and what to do", async () => {
    world.rules = [
      { ...world.rules[0]!, targets: [] },
      { ...world.rules[1]!, targets: [] },
    ];

    await declareIncidentAndPage();
    await world.settle();

    const message: string = runMessage();

    expect(headline({ text: message } as SlackRequest)).toContain(
      "could not reach anyone",
    );
    expect(message).toContain(
      "Level 1 of 2: nobody to page, so Level 2 of 2 was paged at once",
    );
    expect(message).toContain("Level 2 of 2: nobody to page");
    expect(world.run!.status).toBe("Execution Completed - No One Notified");
    expect(
      feedOf("OnCallPolicy").some((entry: FeedEntry): boolean => {
        return entry.markdown.includes(
          "This policy's owners should add responders to its escalation rules, or check who is on call in its schedules.",
        );
      }),
    ).toBe(true);
  });
});
