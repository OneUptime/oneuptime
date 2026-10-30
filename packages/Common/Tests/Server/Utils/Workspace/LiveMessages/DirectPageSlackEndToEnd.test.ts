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
import { ALREADY_PAGED_TIMELINE_MESSAGE } from "../../../../../Types/OnCallDutyPolicy/AlreadyPagedTimelineMessage";
import { ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES } from "../../../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import OnCallDutyExecutionLogTimelineStatus from "../../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import { OnCallDirectPageRun } from "../../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallPolicyRunMessage, {
  OnCallPolicyRunReading,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import QuietChannelsWorld, {
  DASHBOARD,
  FeedEntry,
  INCIDENT_ID,
  JANE,
  NB_USER_2,
  NB_USER_3,
  NITIN,
  PAGING_WORKFLOW_ID,
  PRIMARY_COVER,
  PROJECT_ID,
  SEC,
  STATE_ACKNOWLEDGED,
  STATE_IDENTIFIED,
  TEAM_NOBODY_JOINED,
  TEAM_PLATFORM,
  WORKSPACE_RULE_ID,
} from "./QuietChannelsWorld";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * WHAT A DIRECT PAGE SHOWS IN AN INCIDENT'S SLACK CHANNEL AND FEED, END TO
 * END.
 *
 * A workflow's Page Users, Page a Team and Page Whoever Is On Call steps
 * page people with no on-call policy behind the page. Here such a page runs
 * through OneUptime's real code - the execution log service's
 * startDirectPage and its create and update hooks, the escalation rule
 * service's paging of the page's targets, the timeline's hooks, the feed,
 * the run's live message, the workspace layer and SlackUtil - against a
 * fake Slack API that records every request (QuietChannelsWorld has the
 * database in memory, and stands in for each person's notification rules
 * going out).
 *
 * What it must come to: ONE message in the channel for the page, posted
 * once the page's one pass over the people it names is done - so its first
 * post, and the notification of it, already say what the page came to -
 * and edited after that; naming the workflow where a policy's run names the
 * policy, and no escalation rule; a new message only when somebody has to
 * act; and in the incident's feed one entry for everybody paged and every
 * target that reached nobody.
 */

const SLACK_INCIDENT_CHANNEL: string = "C0INC8";

const WORKFLOW_URL: string = `${DASHBOARD}/${PROJECT_ID.toString()}/workflows/${PAGING_WORKFLOW_ID.toString()}/builder`;
const INCIDENT_URL: string = `${DASHBOARD}/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;

// The workflow and the incident as Slack is sent them: bold links.
const WORKFLOW_IN_SLACK: string = `*<${WORKFLOW_URL}|Page the on-call engineer>*`;
const INCIDENT_IN_SLACK: string = `*<${INCIDENT_URL}|Incident INC-8>*`;

/*
 * The zero-width space Slack's bold and links are wrapped in, which says
 * nothing: taken out of what Slack was sent before it is compared.
 */
const ZERO_WIDTH_SPACE: string = String.fromCharCode(0x200b);

interface SlackRequest {
  method: string;
  channel: string;
  ts: string;
  // Set when a message is posted as a reply in another message's thread.
  threadTs: string;
  text: string;
  // The request's top-level text: what a notification shows of the message.
  notification: string | undefined;
}

// The Slack API, as far as OneUptime's posting goes, recording every call.
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
          answer = { ok: true, ts: ts, channel: body["channel"] };
          break;
        default:
          break;
      }

      this.requests.push({
        method: method,
        channel: String(body["channel"] || ""),
        ts: ts,
        threadTs: String(body["thread_ts"] || ""),
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

// A message's first line: what a person scanning the channel reads.
function headline(request: SlackRequest): string {
  return request.text.split("\n")[0]!;
}

// The message's list: one line a person or a target.
function listOf(request: SlackRequest): Array<string> {
  return request.text.split("\n").filter((textLine: string): boolean => {
    return textLine.indexOf("•") === 0;
  });
}

// The page's own message: the one post that is neither the incident nor an alarm.
function pageMessages(): Array<SlackRequest> {
  return slack.posts().filter((post: SlackRequest): boolean => {
    return post.text.indexOf("See every step in OneUptime") !== -1;
  });
}

// The message as it stands now: its last edit, or the post if it was never edited.
function pageMessageNow(): SlackRequest {
  const posted: SlackRequest = pageMessages()[0]!;
  const edits: Array<SlackRequest> = slack
    .updates()
    .filter((update: SlackRequest): boolean => {
      return update.ts === posted.ts;
    });

  return edits[edits.length - 1] || posted;
}

function onCallFeed(): Array<string> {
  return world.feed
    .filter((entry: FeedEntry): boolean => {
      return entry.eventType === "OnCallPolicy";
    })
    .map((entry: FeedEntry): string => {
      return entry.markdown;
    });
}

async function declareIncident(): Promise<void> {
  await world.incidentCreated();
  await world.incidentState({
    to: STATE_IDENTIFIED,
    name: "Identified",
    isFirst: true,
  });
}

describe("a workflow pages a person, two teams and two schedules about an incident", () => {
  let started: OnCallDirectPageRun;

  beforeEach(async () => {
    await declareIncident();

    /*
     * NB User 3 and NB User 2 are named themselves - NB User 2 has left the
     * project. Team Platform is Nitin and Jane; nobody has joined Night
     * Shift. Nitin is on call in Primary cover as well; nobody is on call
     * in sec.
     */
    started = await world.startDirectPage({
      targets: {
        userIds: [NB_USER_3, NB_USER_2],
        teamIds: [TEAM_PLATFORM, TEAM_NOBODY_JOINED],
        onCallScheduleIds: [PRIMARY_COVER, SEC],
      },
    });
  });

  test("the channel gets ONE message for the page, after the incident's own", () => {
    expect(slack.posts().map(headline)).toEqual([
      expect.stringContaining("Incident INC-8 Created"),
      `📟 Workflow ${WORKFLOW_IN_SLACK} is paging for ${INCIDENT_IN_SLACK}`,
    ]);
    expect(pageMessages()).toHaveLength(1);
    expect(pageMessages()[0]!.channel).toBe(SLACK_INCIDENT_CHANNEL);
    // A message of its own, not a reply in a thread.
    expect(pageMessages()[0]!.threadTs).toBe("");
  });

  test("it is posted once the page has gone through everybody it names: the first post already lists them all", () => {
    const posted: SlackRequest = pageMessages()[0]!;

    /*
     * Posted at the page's first step instead, the message said "is paging"
     * over one name and was edited five times in the same second.
     */
    expect(headline(posted)).toBe(
      `📟 Workflow ${WORKFLOW_IN_SLACK} is paging for ${INCIDENT_IN_SLACK}`,
    );
    expect(listOf(posted)).toEqual([
      "•   *Nitin* (member of Platform): paged once · by SMS and email",
      "•   *Jane Doe* (member of Platform): paged once · by SMS and email",
      "•   *NB User 3*: paged once · by SMS and email",
      "•   Team *Night Shift* has no members",
      "•   *NB User 2*: not paged · not a member of this project",
      "•   Nobody was on call in schedule *sec*",
    ]);
    // Nothing had to be put right afterwards.
    expect(slack.updates()).toEqual([]);
  });

  test("it names the workflow, as a link to it, where a policy's run names the policy", () => {
    expect(headline(pageMessageNow())).toBe(
      `📟 Workflow ${WORKFLOW_IN_SLACK} is paging for ${INCIDENT_IN_SLACK}`,
    );
    expect(pageMessageNow().text).not.toContain("PolicyX");
    expect(pageMessageNow().text).not.toContain("on-call-duty/policies");
  });

  test("it never says which escalation rule it is on: a direct page has none", () => {
    for (const request of [...pageMessages(), ...slack.updates()]) {
      expect(request.text).not.toContain("scalation rule");
      expect(request.text).not.toContain("if nobody acknowledges");
    }
  });

  test("it lists everybody once - who was paged and how, then who was not and why", () => {
    expect(listOf(pageMessageNow())).toEqual([
      "•   *Nitin* (member of Platform): paged once · by SMS and email",
      "•   *Jane Doe* (member of Platform): paged once · by SMS and email",
      "•   *NB User 3*: paged once · by SMS and email",
      "•   Team *Night Shift* has no members",
      "•   *NB User 2*: not paged · not a member of this project",
      "•   Nobody was on call in schedule *sec*",
    ]);
  });

  test("it links to the run's own page, where every step is", () => {
    expect(pageMessageNow().text).toContain(
      `<${DASHBOARD}/${PROJECT_ID.toString()}/on-call-duty/execution-logs/${started.executionLogId.toString()}|See every step in OneUptime>`,
    );
  });

  test("its notification says who is paging for what, in plain text", () => {
    expect(pageMessages()[0]!.notification).toBe(
      "Workflow Page the on-call engineer is paging for Incident INC-8",
    );
  });

  test("it raises no alarm while people are being paged", () => {
    expect(slack.posts()).toHaveLength(2);
  });

  test("what came of it is handed back: three people paged, three targets that reached nobody", () => {
    expect(
      started.outcome.paged.map(
        (person: { userId: { toString(): string } }) => {
          return person.userId.toString();
        },
      ),
    ).toEqual([NITIN, JANE, NB_USER_3].map(String));
    expect(started.outcome.notPaged).toHaveLength(3);
    expect(started.outcome.hadScheduleGap).toBe(true);
  });

  test("the run is a direct page: no policy, in the incident's project, started by the workflow", () => {
    expect(world.run!.onCallDutyPolicyId).toBeUndefined();
    expect(world.run!.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(world.run!.triggeredByIncidentId!.toString()).toBe(
      INCIDENT_ID.toString(),
    );
    expect(world.run!.triggeredByWorkflowId!.toString()).toBe(
      PAGING_WORKFLOW_ID.toString(),
    );
    expect(world.run!.triggeredByWorkflowName).toBe(
      "Page the on-call engineer",
    );
    expect(world.run!.status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(world.run!.statusMessage).toBe("3 people were paged.");
  });

  test("no line of its timeline names a policy or an escalation rule", () => {
    expect(world.steps.length).toBeGreaterThan(0);

    for (const step of world.steps) {
      expect(step.onCallDutyPolicyId).toBeUndefined();
      expect(step.onCallDutyPolicyEscalationRuleId).toBeUndefined();
      expect(step.onCallDutyPolicyExecutionLogId!.toString()).toBe(
        started.executionLogId.toString(),
      );
      expect(step.triggeredByIncidentId!.toString()).toBe(
        INCIDENT_ID.toString(),
      );
    }
  });

  test("the incident's feed has one entry for everybody paged and every target that reached nobody", () => {
    expect(onCallFeed()).toEqual([
      "Workflow **Page the on-call engineer** paged **Nitin**, as a member of **Platform**.\n\nAlert Sent.",
      "Workflow **Page the on-call engineer** paged **Jane Doe**, as a member of **Platform**.\n\nAlert Sent.",
      "Workflow **Page the on-call engineer** paged nobody: team **Night Shift** has no members.",
      "Workflow **Page the on-call engineer** paged **NB User 3**.\n\nAlert Sent.",
      "Workflow **Page the on-call engineer** did not page **NB User 2**.\n\nSkipped because this user is not a member of the project.",
      "Workflow **Page the on-call engineer** paged nobody: nobody was on call in schedule **sec**.",
    ]);
  });

  test("Nitin, on call in Primary cover as well, is paged once - and the feed does not say he was not", () => {
    // The run's own page keeps the line for the second time he was named.
    const second: Array<OnCallDutyPolicyExecutionLogTimeline> =
      world.steps.filter(
        (step: OnCallDutyPolicyExecutionLogTimeline): boolean => {
          return step.statusMessage === ALREADY_PAGED_TIMELINE_MESSAGE;
        },
      );

    expect(second).toHaveLength(1);
    expect(second[0]!.alertSentToUserId!.toString()).toBe(NITIN.toString());
    expect(second[0]!.status).toBe(
      OnCallDutyExecutionLogTimelineStatus.Skipped,
    );

    expect(
      onCallFeed().filter((markdown: string): boolean => {
        return markdown.indexOf("**Nitin**") !== -1;
      }),
    ).toHaveLength(1);
    expect(onCallFeed().join("\n")).not.toContain("did not page **Nitin**");
  });

  test("no feed entry of the page goes to chat: the one message is how the channel hears of it", () => {
    for (const entry of world.feed) {
      if (entry.eventType === "OnCallPolicy") {
        expect(entry.postsToWorkspace).toBe(false);
      }
    }
  });

  test("the feed names no policy and no escalation rule", () => {
    for (const markdown of onCallFeed()) {
      expect(markdown).not.toContain("n-call policy");
      expect(markdown).not.toContain("escalation rule");
    }
  });

  describe("and Nitin acknowledges his page", () => {
    beforeEach(async () => {
      await world.acknowledge(NITIN);
      await world.incidentState({
        to: STATE_ACKNOWLEDGED,
        name: "Acknowledged",
        isFirst: false,
        by: NITIN,
      });
      await world.settle();
    });

    test("the page's message is edited to say who acknowledged, and that the workflow stopped paging", () => {
      expect(headline(pageMessageNow())).toBe(
        `✅ *Nitin* acknowledged ${INCIDENT_IN_SLACK}, so workflow ${WORKFLOW_IN_SLACK} stopped paging`,
      );
      expect(listOf(pageMessageNow())[0]).toBe(
        "•   *Nitin* (member of Platform): acknowledged · paged once · by SMS and email",
      );
    });

    test("everything after the first post is an edit of that one message", () => {
      const posted: SlackRequest = pageMessages()[0]!;

      expect(slack.updates().length).toBeGreaterThan(0);

      for (const update of slack.updates()) {
        expect(update.ts).toBe(posted.ts);
        expect(update.channel).toBe(SLACK_INCIDENT_CHANNEL);
      }

      expect(pageMessages()).toHaveLength(1);
    });

    test("no alarm is raised: somebody is on it", () => {
      expect(pageMessages()).toHaveLength(1);
      expect(
        slack.posts().filter((post: SlackRequest): boolean => {
          return post.text.indexOf("⚠️") === 0 || post.text.indexOf("❌") === 0;
        }),
      ).toEqual([]);
    });

    test("the feed says he acknowledged the page from the workflow", () => {
      expect(onCallFeed()).toContain(
        "**Nitin** acknowledged the page from workflow **Page the on-call engineer**.\n\nIncident acknowledged by Nitin.",
      );
    });
  });

  describe("and the incident is acknowledged some other way", () => {
    beforeEach(async () => {
      await world.recordHandledElsewhere("Acknowledged");
    });

    test("the page's message says the incident moved on, so the workflow stopped paging", () => {
      expect(headline(pageMessageNow())).toBe(
        `✅ ${INCIDENT_IN_SLACK} moved to *Acknowledged*, so workflow ${WORKFLOW_IN_SLACK} stopped paging`,
      );
      expect(pageMessages()).toHaveLength(1);
    });

    test("the feed says why the workflow stopped paging", () => {
      expect(onCallFeed()[onCallFeed().length - 1]).toBe(
        "Workflow **Page the on-call engineer** stopped paging because the incident is acknowledged or resolved.",
      );
    });
  });

  describe("and nobody acknowledges", () => {
    test("a minute in, with every page sent, nothing is said yet: nobody could have acknowledged", async () => {
      const postsBefore: number = slack.posts().length;

      expect(await world.directPageTick(1)).toBe(false);
      expect(
        await world.directPageTick(
          ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES - 1,
        ),
      ).toBe(false);
      expect(world.run!.status).toBe(OnCallDutyPolicyStatus.Executing);
      expect(slack.posts()).toHaveLength(postsBefore);
      expect(headline(pageMessageNow())).toContain("is paging for");
    });

    test("after the wait, while a page is still going out, the run stays open and nothing is said", async () => {
      world.pagesStillOut = 1;

      const postsBefore: number = slack.posts().length;

      expect(
        await world.directPageTick(
          ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES * 3,
        ),
      ).toBe(false);
      expect(world.run!.status).toBe(OnCallDutyPolicyStatus.Executing);
      expect(slack.posts()).toHaveLength(postsBefore);
      expect(headline(pageMessageNow())).toContain("is paging for");
    });

    test("once it has waited and every page has sent all it had to, the message says nobody acknowledged and ONE alarm asks somebody to take it", async () => {
      expect(
        await world.directPageTick(
          ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES,
        ),
      ).toBe(true);

      expect(headline(pageMessageNow())).toBe(
        `⚠️ Workflow ${WORKFLOW_IN_SLACK} paged for ${INCIDENT_IN_SLACK} and nobody acknowledged`,
      );

      const alarms: Array<SlackRequest> = slack
        .posts()
        .filter((post: SlackRequest): boolean => {
          return post.text.indexOf("⚠️ Nobody has acknowledged") === 0;
        });

      expect(alarms).toHaveLength(1);
      expect(alarms[0]!.text).toContain(
        `⚠️ Nobody has acknowledged ${INCIDENT_IN_SLACK}. Workflow ${WORKFLOW_IN_SLACK} paged Platform (Nitin and Jane Doe) and NB User 3, and has stopped paging. Someone needs to take it.`,
      );
      expect(alarms[0]!.notification).toBe(
        "Nobody has acknowledged Incident INC-8: someone needs to take it",
      );
      expect(alarms[0]!.text).not.toContain("escalation rule");

      expect(onCallFeed()[onCallFeed().length - 1]).toBe(
        "Workflow **Page the on-call engineer** stopped paging: nobody acknowledged.",
      );
    });

    test("the alarm is raised once, however often the run is looked at again", async () => {
      await world.directPageTick(
        ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES,
      );
      await world.directPageTick(
        ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES + 1,
      );
      await world.settle();

      expect(
        slack.posts().filter((post: SlackRequest): boolean => {
          return post.text.indexOf("⚠️ Nobody has acknowledged") === 0;
        }),
      ).toHaveLength(1);
    });
  });
});

describe("a page that reaches nobody", () => {
  const BACK_ON: Date = new Date("2026-10-17T09:00:00.000Z");

  beforeEach(async () => {
    await declareIncident();

    // Jane is away until the 17th with nobody named to cover for her.
    world.away[JANE.toString()] = { coverUserId: null, endsAt: BACK_ON };

    await world.startDirectPage({
      targets: {
        userIds: [JANE, NB_USER_2],
        teamIds: [TEAM_NOBODY_JOINED],
        onCallScheduleIds: [SEC],
      },
    });
  });

  test("is still a run, ended at once, with why on its timeline", () => {
    expect(world.run!.status).toBe(
      OnCallDutyPolicyStatus.CompletedWithNoNotifications,
    );
    expect(world.run!.statusMessage).toBe("Nobody was paged.");
    expect(world.steps).toHaveLength(4);
    expect(world.deliveries).toEqual([]);
  });

  test("its one message says the workflow could not reach anyone, and lists why", () => {
    expect(pageMessages()).toHaveLength(1);
    expect(headline(pageMessageNow())).toBe(
      `⚠️ Workflow ${WORKFLOW_IN_SLACK} could not reach anyone for ${INCIDENT_IN_SLACK}`,
    );

    const list: Array<string> = listOf(pageMessageNow());

    expect(list).toHaveLength(4);
    expect(list[0]).toBe("•   Team *Night Shift* has no members");
    expect(list[1]!.indexOf("•   *Jane Doe*: not paged · away until ")).toBe(0);
    expect(list[2]).toBe(
      "•   *NB User 2*: not paged · not a member of this project",
    );
    expect(list[3]).toBe("•   Nobody was on call in schedule *sec*");
  });

  /*
   * The page is over the moment it starts: nobody was paged. The channel is
   * told so ONCE, by the page's own message. It used to be told twice in
   * the same second - the message, posted at the page's first step as "is
   * paging" and edited at once, and then an alarm that gave the same four
   * reasons over again.
   */
  test("the channel is told once: the page's message is new, so no alarm is raised on top of it", () => {
    // The incident's own message, and the page's.
    expect(slack.posts()).toHaveLength(2);
    expect(pageMessages()).toHaveLength(1);
    expect(
      slack.posts().filter((post: SlackRequest): boolean => {
        return post.text.indexOf("⚠️ Nobody was paged") === 0;
      }),
    ).toEqual([]);
  });

  /*
   * No alarm follows the message, so what an alarm ends with - what to do
   * next - is in the message itself: after the reasons, before the link.
   */
  test("with no alarm to say it, the message itself says what to do next - once", () => {
    const whatToDo: string = "Check who is on call, or page someone yourself.";
    const lines: Array<string> = pageMessageNow()
      .text.split("\n")
      .filter((textLine: string): boolean => {
        return textLine.trim().length > 0;
      });

    expect(
      lines.filter((textLine: string): boolean => {
        return textLine === whatToDo;
      }),
    ).toHaveLength(1);

    const at: number = lines.indexOf(whatToDo);

    expect(lines[at - 1]).toBe("•   Nobody was on call in schedule *sec*");
    expect(lines[at + 1]!.indexOf("See every step in OneUptime")).not.toBe(-1);
    expect(lines).toHaveLength(at + 2);

    // Nowhere else in the channel: the incident's own message has none.
    for (const post of slack.posts()) {
      if (post.ts !== pageMessageNow().ts) {
        expect(post.text).not.toContain(whatToDo);
      }
    }
  });

  test('its first post already says the workflow could not reach anyone: it never said "is paging"', () => {
    const posted: SlackRequest = pageMessages()[0]!;

    expect(headline(posted)).toBe(
      `⚠️ Workflow ${WORKFLOW_IN_SLACK} could not reach anyone for ${INCIDENT_IN_SLACK}`,
    );
    expect(listOf(posted)).toHaveLength(4);
    // Posted as it stands: nothing edits it.
    expect(slack.updates()).toEqual([]);

    for (const request of slack.requests) {
      expect(request.text).not.toContain("is paging for");
    }
  });

  test("its notification says nobody could be reached - not that somebody is being paged", () => {
    expect(pageMessages()[0]!.notification).toBe(
      "Workflow Page the on-call engineer could not reach anyone for Incident INC-8",
    );

    for (const post of slack.posts()) {
      expect(post.notification || "").not.toContain("is paging");
    }
  });

  test("it is not said again, however often the run is looked at afterwards", async () => {
    await world.directPageTick(1);
    await world.directPageTick(ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES);
    await world.settle();

    expect(slack.posts()).toHaveLength(2);
    expect(pageMessages()).toHaveLength(1);
  });

  test("when Jane is back is a moment Slack shows in each reader's own time", () => {
    const seconds: number = Math.floor(BACK_ON.getTime() / 1000);

    expect(pageMessageNow().text).toContain(`<!date^${seconds}^`);
    expect(pageMessageNow().text).not.toContain("09:00 UTC,");
  });

  test("the feed says why for each target, and that the workflow paged nobody", () => {
    expect(onCallFeed()).toEqual([
      "Workflow **Page the on-call engineer** paged nobody: team **Night Shift** has no members.",
      "Workflow **Page the on-call engineer** did not page **Jane Doe**.\n\nAway until `2026-10-17T09:00:00.000Z`, and nobody is named to cover for them.",
      "Workflow **Page the on-call engineer** did not page **NB User 2**.\n\nSkipped because this user is not a member of the project.",
      "Workflow **Page the on-call engineer** paged nobody: nobody was on call in schedule **sec**.",
      "Workflow **Page the on-call engineer** paged nobody.",
    ]);
  });
});

/*
 * WHEN THE PAGE'S MESSAGE IS FIRST POSTED.
 *
 * A direct page pages everybody it names in one pass: its run is "started"
 * while that goes on, "executing" once somebody was paged, and over at once
 * when nobody was. Each step of the pass asks for the message to be brought
 * up to date, and the message is not posted for any of them: it waits for
 * the pass to end, so that its first post - and the one notification people
 * get of it - says what the page came to.
 */
describe("when a direct page's message is first posted", () => {
  test.each([
    [OnCallDutyPolicyStatus.Scheduled, false],
    [OnCallDutyPolicyStatus.Started, false],
    [OnCallDutyPolicyStatus.Executing, true],
    [OnCallDutyPolicyStatus.Completed, true],
    [OnCallDutyPolicyStatus.CompletedWithNoNotifications, true],
    [OnCallDutyPolicyStatus.Error, true],
  ])(
    "with its run %s, it has something to post: %s",
    async (status: OnCallDutyPolicyStatus, expected: boolean) => {
      await declareIncident();
      await world.startDirectPage({ targets: { userIds: [NITIN] } });

      // The run as it stands at that point of the page, steps and all.
      world.run!.status = status;

      const reading: OnCallPolicyRunReading | null =
        await OnCallPolicyRunMessage.readRun(world.run!.id!);

      expect(reading).not.toBeNull();
      expect(reading!.run.directPage).toBeDefined();
      expect(reading!.hasStarted).toBe(expected);
    },
  );

  test("a pass still under way - its steps written, its paging begun - is not posted yet", async () => {
    await declareIncident();
    await world.startDirectPage({
      targets: { userIds: [NITIN], teamIds: [TEAM_PLATFORM] },
    });

    // Back to the middle of the pass: the run "started", the steps there.
    world.run!.status = OnCallDutyPolicyStatus.Started;

    expect(world.steps.length).toBeGreaterThan(0);
    expect(world.run!.lastEscalationRuleExecutedAt).toBeDefined();

    const reading: OnCallPolicyRunReading | null =
      await OnCallPolicyRunMessage.readRun(world.run!.id!);

    expect(reading!.hasStarted).toBe(false);
  });

  test("an on-call policy's run is posted as it always was: once its first rule is under way", async () => {
    await declareIncident();
    await world.startRun();

    const reading: OnCallPolicyRunReading | null =
      await OnCallPolicyRunMessage.readRun(world.run!.id!);

    expect(reading!.run.directPage).toBeUndefined();
    expect(reading!.hasStarted).toBe(true);
    expect(world.run!.lastExecutedEscalationRuleId).toBeDefined();
  });
});

describe("a page somebody covers", () => {
  test("the person covering is paged in place of the one who is away, and the message says so", async () => {
    await declareIncident();

    world.away[NB_USER_3.toString()] = {
      coverUserId: JANE,
      endsAt: new Date("2026-10-17T09:00:00.000Z"),
    };

    const started: OnCallDirectPageRun = await world.startDirectPage({
      targets: { userIds: [NB_USER_3] },
    });

    expect(started.outcome.paged).toHaveLength(1);
    expect(started.outcome.paged[0]!.userId.toString()).toBe(JANE.toString());
    expect(started.outcome.paged[0]!.coveringForUserId!.toString()).toBe(
      NB_USER_3.toString(),
    );
    expect(listOf(pageMessageNow())).toEqual([
      "•   *Jane Doe* (covering for NB User 3): paged once · by SMS and email",
    ]);
    expect(onCallFeed()).toEqual([
      "Workflow **Page the on-call engineer** paged **Jane Doe**.\n\nThey are covering for NB User 3 (a user override).\n\nAlert Sent.",
    ]);
  });
});

describe("a page a person started", () => {
  test("names the person where a workflow's page names the workflow", async () => {
    await declareIncident();

    await world.startDirectPage({
      targets: { userIds: [NITIN] },
      startedBy: { userId: JANE },
    });

    expect(world.run!.triggeredByUserId!.toString()).toBe(JANE.toString());
    expect(world.run!.triggeredByWorkflowId).toBeUndefined();
    expect(headline(pageMessageNow())).toBe(
      `📟 *Jane Doe* is paging for ${INCIDENT_IN_SLACK}`,
    );
    expect(pageMessages()[0]!.notification).toBe(
      "Jane Doe is paging for Incident INC-8",
    );
    expect(onCallFeed()).toEqual([
      "**Jane Doe** paged **Nitin**.\n\nAlert Sent.",
    ]);
  });
});

describe("a page about an alert", () => {
  test("is the alert's run: its message names the alert, and its entries go to the alert's feed", async () => {
    world.runFor = "alert";

    await world.alertCreated();
    await world.startDirectPage({ targets: { userIds: [NITIN] } });

    expect(world.run!.triggeredByAlertId).toBeDefined();
    expect(world.run!.triggeredByIncidentId).toBeUndefined();
    expect(headline(pageMessageNow())).toContain("is paging for");
    expect(headline(pageMessageNow())).toContain("|Alert AL-12>*");
    expect(pageMessages()[0]!.notification).toBe(
      "Workflow Page the on-call engineer is paging for Alert AL-12",
    );

    const entries: Array<FeedEntry> = world.feed.filter(
      (entry: FeedEntry): boolean => {
        return entry.eventType === "OnCallPolicy";
      },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.record).toBe("alert");
    expect(entries[0]!.markdown).toBe(
      "Workflow **Page the on-call engineer** paged **Nitin**.\n\nAlert Sent.",
    );
  });
});
