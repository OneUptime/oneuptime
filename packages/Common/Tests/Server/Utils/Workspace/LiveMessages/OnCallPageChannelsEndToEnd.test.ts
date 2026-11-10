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
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import QuietChannelsWorld, {
  FeedEntry,
  NITIN,
  STATE_IDENTIFIED,
  WORKSPACE_RULE_ID,
} from "./QuietChannelsWorld";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * HOW EACH PAGE REACHED ITS PERSON, IN THE INCIDENT'S FEED, END TO END
 * (#6568).
 *
 * A customer reviewing an incident asked which channel paged a responder -
 * SMS, a call, a push - and how they answered, as the run's Slack message
 * says it ("paged once · by SMS and email") and other tools' timelines do.
 * Here an incident's on-call run goes through OneUptime's real code - the
 * run's timeline and its hooks, each notification's own hooks, the feed,
 * the run's live message and SlackUtil - in QuietChannelsWorld's in-memory
 * database: PolicyX's first rule pages Nitin by SMS and email; Nitin's
 * own On-Call Rules call them ten minutes on; the SMS turns out to have
 * failed; they acknowledge from the call. The feed tells each of those
 * once, in the order they happened, and never why a notification failed
 * - a provider's reason can hold their phone number.
 */

const SLACK_INCIDENT_CHANNEL: string = "C0INC8";

// The zero-width space Slack's bold and links are wrapped in, taken out.
const ZERO_WIDTH_SPACE: string = String.fromCharCode(0x200b);

interface SlackRequest {
  method: string;
  ts: string;
  text: string;
}

// The Slack API, as far as the run's message goes, recording every call.
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
      });

      return {
        jsonData: answer,
        data: answer,
      } as unknown as HTTPResponse<JSONObject>;
    }) as never);
  }

  // The run's message as it stands now: its last edit, or its post.
  public runMessageNow(): string {
    const posted: SlackRequest | undefined = this.requests.find(
      (request: SlackRequest): boolean => {
        return (
          request.method === "chat.postMessage" &&
          request.text.indexOf("See every step in OneUptime") !== -1
        );
      },
    );

    const edits: Array<SlackRequest> = this.requests.filter(
      (request: SlackRequest): boolean => {
        return request.method === "chat.update" && request.ts === posted?.ts;
      },
    );

    return (edits[edits.length - 1] || posted)?.text || "";
  }
}

let slack: FakeSlack;
let world: QuietChannelsWorld;

beforeEach(async () => {
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

  await world.incidentCreated();
  await world.incidentState({
    to: STATE_IDENTIFIED,
    name: "Identified",
    isFirst: true,
  });

  // PolicyX's first rule, "fhirst": Nitin, on call in Primary cover.
  await world.startRun();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function onCallEntries(): Array<FeedEntry> {
  return world.feed.filter((entry: FeedEntry): boolean => {
    return entry.eventType === "OnCallPolicy";
  });
}

// The entries about Nitin's page, with the policy's link taken out.
function nitinsEntries(): Array<string> {
  return onCallEntries()
    .map((entry: FeedEntry): string => {
      return entry.markdown.replace(/\*\*\[PolicyX\]\([^)]*\)\*\*/g, "PolicyX");
    })
    .filter((markdown: string): boolean => {
      return markdown.indexOf("**Nitin**") !== -1;
    });
}

// Nitin's line in the run's Slack message.
function nitinsLineInSlack(): string {
  return (
    slack
      .runMessageNow()
      .split("\n")
      .find((line: string): boolean => {
        return line.indexOf("*Nitin*") !== -1;
      }) || ""
  );
}

const LEVEL: string = "**fhirst** (Level 1 of 3, schedule **Primary cover**)";

describe("an incident's on-call run pages Nitin", () => {
  test("the feed names the channels the page went out by - and no longer 'Alert Sent'", () => {
    expect(nitinsEntries()).toEqual([
      `On-call policy PolicyX paged **Nitin** via SMS and email at ${LEVEL}.`,
    ]);
    expect(
      onCallEntries()
        .map((entry: FeedEntry) => {
          return entry.markdown;
        })
        .join("\n"),
    ).not.toContain("Alert Sent");
  });

  test("the run's Slack message says the same in its own short words", () => {
    expect(nitinsLineInSlack()).toContain("paged once · by SMS and email");
  });

  describe("their own On-Call Rules call them ten minutes on", () => {
    beforeEach(async () => {
      await world.notifyAgain(NITIN, "userCallId");
    });

    test("the call is an entry of its own: Nitin was paged again, via phone call", () => {
      expect(nitinsEntries()).toEqual([
        `On-call policy PolicyX paged **Nitin** via SMS and email at ${LEVEL}.`,
        `On-call policy PolicyX paged **Nitin** again via phone call at ${LEVEL}.`,
      ]);
    });

    test("a second call - a rule that calls again, a repeat - adds nothing: the feed named calls already", async () => {
      await world.notifyAgain(NITIN, "userCallId");

      expect(nitinsEntries()).toHaveLength(2);
    });

    test("the Slack message names the call beside the SMS and the email", () => {
      expect(nitinsLineInSlack()).toContain("by call, SMS and email");
    });

    describe("and the SMS turns out not to have been delivered", () => {
      beforeEach(async () => {
        await world.failNotification(NITIN, "userSmsId");
      });

      test("the feed says it could not page Nitin via SMS - and not why", () => {
        expect(nitinsEntries()[2]).toBe(
          `On-call policy PolicyX could not page **Nitin** via SMS at ${LEVEL}.`,
        );
        expect(nitinsEntries().join("\n")).not.toContain("provider");
      });

      test("the same failure written a second time is told of once", async () => {
        await world.failNotification(NITIN, "userSmsId");

        expect(
          nitinsEntries().filter((markdown: string): boolean => {
            return markdown.indexOf("could not page") !== -1;
          }),
        ).toHaveLength(1);
      });

      test("the Slack message stops counting the SMS", () => {
        expect(nitinsLineInSlack()).toContain("by call and email");
      });

      describe("and Nitin acknowledges from the call", () => {
        beforeEach(async () => {
          await world.acknowledge(NITIN, "userCallId");
        });

        test("the feed says Nitin acknowledged the page via phone call - the whole story, in order", () => {
          expect(nitinsEntries()).toEqual([
            `On-call policy PolicyX paged **Nitin** via SMS and email at ${LEVEL}.`,
            `On-call policy PolicyX paged **Nitin** again via phone call at ${LEVEL}.`,
            `On-call policy PolicyX could not page **Nitin** via SMS at ${LEVEL}.`,
            `**Nitin** acknowledged the page from on-call policy PolicyX at ${LEVEL} via phone call.`,
          ]);
        });

        test("no entry of the page goes to chat: the run's one message is how the channel hears of it", () => {
          for (const entry of onCallEntries()) {
            expect(entry.postsToWorkspace).toBe(false);
          }
        });
      });
    });
  });
});
