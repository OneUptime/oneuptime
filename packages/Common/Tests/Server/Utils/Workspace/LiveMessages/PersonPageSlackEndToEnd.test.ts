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
import { ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES } from "../../../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import { isOnCallPersonPage } from "../../../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import OnCallDutyPolicyStatus from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import QuietChannelsWorld, {
  DASHBOARD,
  INCIDENT_ID,
  JANE,
  NITIN,
  PAGING_WORKFLOW_ID,
  PROJECT_ID,
  STATE_ACKNOWLEDGED,
  STATE_IDENTIFIED,
  TEAM_PLATFORM,
  WORKSPACE_RULE_ID,
} from "./QuietChannelsWorld";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * PAGING SOMEBODY FROM AN INCIDENT'S OWN CHANNEL, END TO END (block 31).
 *
 * The maintainer's screenshot: in #irm-nonprdinc-18, `/oneuptime page`
 * made Alert ALT-16 and ALT-18 to page people, and a paged team showed only
 * its members. Now Jane pages Team Platform from INC-8's own channel, with
 * a message: the page is about INC-8 (no alert), its run is ONE message in
 * the incident's channel that quotes her message and names the team on
 * each of its people, and - as a page a person asked for (OnCallPersonPage)
 * - it ends saying the page went unanswered, not that the incident needs
 * taking, when somebody else is on the incident by then.
 *
 * Everything from the run to Slack's API is OneUptime's real code - the
 * execution log service's startDirectPage and its hooks, the escalation
 * rule service paging the team, the run's live message and its view, the
 * workspace layer and SlackUtil - with the database in memory
 * (QuietChannelsWorld) and a fake Slack that records every request.
 */

const SLACK_INCIDENT_CHANNEL: string = "C0INC8";
const MESSAGE: string = "Can you check the database?";

const INCIDENT_URL: string = `${DASHBOARD}/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;
const INCIDENT_IN_SLACK: string = `*<${INCIDENT_URL}|Incident INC-8>*`;

const ZERO_WIDTH_SPACE: string = String.fromCharCode(0x200b);

interface SlackRequest {
  method: string;
  channel: string;
  ts: string;
  text: string;
  notification: string | undefined;
}

let requests: Array<SlackRequest>;
let world: QuietChannelsWorld;

function installFakeSlack(): void {
  let nextTs: number = 1;

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
        ts = `1760000000.${String(nextTs++).padStart(6, "0")}`;
        answer = { ok: true, ts: ts, channel: body["channel"] };
        break;
      default:
        break;
    }

    requests.push({
      method: method,
      channel: String(body["channel"] || ""),
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

function posts(): Array<SlackRequest> {
  return requests.filter((request: SlackRequest): boolean => {
    return request.method === "chat.postMessage";
  });
}

// The page's one message, as it stands now: its last edit, or its post.
function pageMessageNow(): SlackRequest {
  const posted: Array<SlackRequest> = posts().filter(
    (post: SlackRequest): boolean => {
      return post.text.indexOf("See every step in OneUptime") !== -1;
    },
  );

  expect(posted).toHaveLength(1);

  const edits: Array<SlackRequest> = requests.filter(
    (request: SlackRequest): boolean => {
      return request.method === "chat.update" && request.ts === posted[0]!.ts;
    },
  );

  return edits[edits.length - 1] || posted[0]!;
}

function lines(request: SlackRequest): Array<string> {
  return request.text.split("\n").filter((line: string): boolean => {
    return line.trim().length > 0;
  });
}

function alarms(): Array<SlackRequest> {
  return posts().filter((post: SlackRequest): boolean => {
    return post.text.indexOf("⚠️ Nobody") === 0;
  });
}

beforeEach(async () => {
  requests = [];
  installFakeSlack();

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
  world.runFor = "incident";
  world.install();

  await world.incidentCreated();
  await world.incidentState({
    to: STATE_IDENTIFIED,
    name: "Identified",
    isFirst: true,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function janePagesPlatform(): Promise<void> {
  await world.startDirectPage({
    targets: { teamIds: [TEAM_PLATFORM] },
    startedBy: { userId: JANE },
    pageMessage: MESSAGE,
  });
}

describe("Jane pages Team Platform from INC-8's own channel, with a message", () => {
  beforeEach(async () => {
    await janePagesPlatform();
  });

  test("the run is the incident's - no alert - and a page a person asked for, carrying her message", () => {
    expect(world.run!.triggeredByIncidentId!.toString()).toBe(
      INCIDENT_ID.toString(),
    );
    expect(world.run!.triggeredByAlertId).toBeUndefined();
    expect(world.run!.pageMessage).toBe(MESSAGE);
    expect(isOnCallPersonPage(world.run!)).toBe(true);
  });

  test("the incident's channel gets ONE message: Jane paging for the incident, her message, and the team on each of its people", () => {
    const message: SlackRequest = pageMessageNow();

    expect(message.channel).toBe(SLACK_INCIDENT_CHANNEL);
    expect(lines(message)).toEqual([
      `📟 *Jane Doe* is paging for ${INCIDENT_IN_SLACK}`,
      `“${MESSAGE}”`,
      expect.stringMatching(
        /^•\s+\*Nitin\* \(member of Platform\): paged once/,
      ),
      expect.stringMatching(
        /^•\s+\*Jane Doe\* \(member of Platform\): paged once/,
      ),
      expect.stringContaining("|See every step in OneUptime>"),
    ]);
  });

  test("its notification says who is paging for what, and her message", () => {
    expect(pageMessageNow().notification).toBe(
      `Jane Doe is paging for Incident INC-8: ${MESSAGE}`,
    );
  });

  test("Nitin answers: the message says so, still with her message", async () => {
    await world.acknowledge(NITIN);
    await world.settle();

    expect(lines(pageMessageNow()).slice(0, 2)).toEqual([
      `✅ *Nitin* acknowledged ${INCIDENT_IN_SLACK}, so paging stopped`,
      `“${MESSAGE}”`,
    ]);
    expect(alarms()).toEqual([]);
  });
});

describe("a person's page that nobody it paged answers", () => {
  test("about an incident somebody else is on: the page went unanswered - one alarm says to page someone else", async () => {
    await world.incidentState({
      to: STATE_ACKNOWLEDGED,
      name: "Acknowledged",
      isFirst: false,
    });
    world.recordAcknowledged = true;
    world.recordStateName = "Acknowledged";

    await janePagesPlatform();

    expect(
      await world.directPageTick(ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES),
    ).toBe(true);
    expect(world.run!.status).toBe(OnCallDutyPolicyStatus.Completed);

    expect(lines(pageMessageNow())[0]).toBe(
      `⚠️ Nobody answered the page from *Jane Doe* for ${INCIDENT_IN_SLACK}`,
    );

    expect(alarms()).toHaveLength(1);
    expect(alarms()[0]!.text).toContain(
      `⚠️ Nobody answered the page for ${INCIDENT_IN_SLACK}: *Jane Doe* paged Platform (Nitin and Jane Doe), and paging has stopped. Page someone else, or reach them another way.`,
    );
    expect(alarms()[0]!.notification).toBe(
      "Nobody answered the page from Jane Doe for Incident INC-8",
    );
    expect(alarms()[0]!.text).not.toContain("Someone needs to take it");
  });

  test("about an incident nobody is on: somebody needs to take it, as for any page", async () => {
    await janePagesPlatform();

    expect(
      await world.directPageTick(ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES),
    ).toBe(true);

    expect(alarms()).toHaveLength(1);
    expect(alarms()[0]!.text).toContain(
      `⚠️ Nobody has acknowledged ${INCIDENT_IN_SLACK}. *Jane Doe* paged Platform (Nitin and Jane Doe), and paging has stopped. Someone needs to take it.`,
    );
  });

  test("the ending is told as first told: acknowledged later, it still says the page went unanswered", async () => {
    world.recordAcknowledged = true;
    await janePagesPlatform();
    await world.directPageTick(ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES);

    const told: string = lines(pageMessageNow())[0]!;

    // The record moves on; the run's message is brought up to date again.
    world.recordAcknowledged = false;
    world.recordStateName = "Resolved";
    await world.directPageTick(
      ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES + 5,
    );
    await world.settle();

    expect(lines(pageMessageNow())[0]).toBe(told);
    expect(alarms()).toHaveLength(1);
  });
});

describe("a workflow's direct page is no person's page: its ending is the one it always had", () => {
  test("ended unanswered while the incident is acknowledged: 'nobody has acknowledged', as before", async () => {
    world.recordAcknowledged = true;

    await world.startDirectPage({ targets: { teamIds: [TEAM_PLATFORM] } });

    expect(isOnCallPersonPage(world.run!)).toBe(false);

    await world.directPageTick(ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES);

    expect(lines(pageMessageNow())[0]).toBe(
      `⚠️ Workflow *<${DASHBOARD}/${PROJECT_ID.toString()}/workflows/${PAGING_WORKFLOW_ID.toString()}/builder|Page the on-call engineer>* paged for ${INCIDENT_IN_SLACK} and nobody acknowledged`,
    );
    expect(world.run!.pageMessage).toBeUndefined();
  });
});
