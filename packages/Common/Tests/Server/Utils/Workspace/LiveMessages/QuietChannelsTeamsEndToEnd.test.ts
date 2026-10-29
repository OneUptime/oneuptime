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
import type { AddressInfo } from "net";

/*
 * WHAT AN INCIDENT CHANNEL IN MICROSOFT TEAMS SHOWS, END TO END.
 *
 * The same incident as QuietChannelsSlackEndToEnd, in a Microsoft Teams
 * channel, through OneUptime's real services and workspace layer and the
 * REAL botbuilder stack (CloudAdapter, TurnContext, the Bot Connector
 * client): every message OneUptime sends or edits leaves as an HTTP request
 * to a fake Bot Connector on 127.0.0.1, which records it. A new message is
 * a POST to the channel's conversation; an edit is a PUT of the activity,
 * addressed as its thread ("<channel>;messageid=<post>"), exactly as
 * OneUptime's replies into a thread are.
 *
 * What Teams cannot do that Slack can, and so does not get:
 * - The note naming who could not be added to the channel: OneUptime never
 *   adds people to a Teams channel (a standard channel is open to its whole
 *   team), so connecting an account would change nothing there.
 *
 * Everything else is the same message, in the same order, with the same
 * words, as an Adaptive Card.
 *
 * How the real botbuilder gets in past Common's jest stubs: see
 * MicrosoftTeamsCreateCommandsEndToEnd.test.ts, whose recipe this copies.
 */

jest.mock("botbuilder", () => {
  return (
    jest.requireActual("../../../../Helpers/RealBotbuilder") as {
      loadRealBotbuilder: (fromFile: string) => unknown;
    }
  ).loadRealBotbuilder(__filename);
});

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

jest.mock("../../../../../Server/Utils/Logger");

import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
} from "botbuilder";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsServiceUrl from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsServiceUrl";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import QuietChannelsWorld, {
  FeedEntry,
  JANE,
  NB_USER_3,
  NITIN,
  RULE_FHIRST,
  RULE_SECOND,
  STATE_ACKNOWLEDGED,
  STATE_IDENTIFIED,
  STATE_RESOLVED,
  WORKSPACE_RULE_ID,
} from "./QuietChannelsWorld";

const TEAMS_CHANNEL: string = "19:inc-8@thread.tacv2";
const TEAM_ID: string = "graph-team-ops";

// Send and update, as botframework-connector calls them.
const ACTIVITIES_PATH: RegExp =
  /^\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/;

interface ConnectorRequest {
  method: string;
  conversationId: string;
  activityIdInPath: string | null;
  activity: JSONObject | null;
  // The card's text blocks, one per line.
  text: string;
  // The id the connector gave a new message.
  answeredId: string | null;
}

// The texts of an Adaptive Card's body, one per line, and its buttons.
function cardText(activity: JSONObject | null): string {
  const attachments: Array<JSONObject> =
    (activity?.["attachments"] as Array<JSONObject> | undefined) || [];
  const lines: Array<string> = [];

  for (const attachment of attachments) {
    const card: JSONObject = (attachment["content"] as JSONObject) || {};

    for (const element of (card["body"] as Array<JSONObject>) || []) {
      lines.push(String(element["text"] || ""));
    }

    const actions: Array<JSONObject> =
      (card["actions"] as Array<JSONObject>) || [];

    if (actions.length > 0) {
      lines.push(
        `[${actions
          .map((action: JSONObject): string => {
            return String(action["title"] || "");
          })
          .join("] [")}]`,
      );
    }
  }

  return lines.join("\n");
}

class FakeBotConnector {
  public serviceUrl: string = "";
  public requests: Array<ConnectorRequest> = [];
  // When set, the next PUT is answered 404 NotFound: the post was deleted.
  public refuseNextUpdate: boolean = false;
  private server: http.Server | null = null;
  private nextMessage: number = 1;

  public async start(): Promise<void> {
    this.server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse) => {
        let body: string = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          body += chunk;
        });
        req.on("end", () => {
          const path: string = (req.url || "/").split("?")[0] || "/";
          const match: RegExpExecArray | null = ACTIVITIES_PATH.exec(path);
          let activity: JSONObject | null = null;

          try {
            activity = body ? (JSON.parse(body) as JSONObject) : null;
          } catch {
            activity = null;
          }

          let answer: JSONObject = { error: { code: "NotFound" } };
          let status: number = 404;

          if (match && req.method === "POST") {
            status = 200;
            answer = { id: `msg-${this.nextMessage++}` };
          } else if (match && req.method === "PUT" && match[2]) {
            if (this.refuseNextUpdate) {
              this.refuseNextUpdate = false;
              status = 404;
              answer = {
                error: {
                  code: "NotFound",
                  message: "The activity could not be found.",
                },
              };
            } else {
              status = 200;
              answer = { id: decodeURIComponent(match[2]) };
            }
          }

          this.requests.push({
            method: req.method || "",
            conversationId: match?.[1] ? decodeURIComponent(match[1]) : "",
            activityIdInPath: match?.[2] ? decodeURIComponent(match[2]) : null,
            activity: activity,
            text: cardText(activity),
            answeredId:
              req.method === "POST" && match ? String(answer["id"]) : null,
          });

          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(answer));
        });
      },
    );

    await new Promise<void>((resolve: () => void) => {
      this.server!.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    const address: AddressInfo = this.server.address() as AddressInfo;
    this.serviceUrl = `http://127.0.0.1:${address.port}/`;
  }

  public async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      this.server?.close(() => {
        resolve();
      });
    });
  }

  public posts(): Array<ConnectorRequest> {
    return this.requests.filter((request: ConnectorRequest): boolean => {
      return request.method === "POST";
    });
  }

  public updates(): Array<ConnectorRequest> {
    return this.requests.filter((request: ConnectorRequest): boolean => {
      return request.method === "PUT";
    });
  }
}

const connector: FakeBotConnector = new FakeBotConnector();
let world: QuietChannelsWorld;

beforeAll(async () => {
  await connector.start();
});

afterAll(async () => {
  await connector.stop();
});

beforeEach(() => {
  connector.requests = [];

  (
    MicrosoftTeamsUtil as unknown as { cachedAdapter: CloudAdapter | null }
  ).cachedAdapter = new CloudAdapter(
    new ConfigurationBotFrameworkAuthentication({}),
  );

  // Proactive sends go to the fake Bot Connector.
  jest.spyOn(MicrosoftTeamsServiceUrl, "resolve").mockImplementation(() => {
    return connector.serviceUrl;
  });

  jest
    .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
    .mockResolvedValue("graph-token");

  // Microsoft Graph: the channel's name.
  jest.spyOn(API, "get").mockImplementation((async (): Promise<
    HTTPResponse<JSONObject>
  > => {
    const channel: JSONObject = {
      displayName: "inc-8",
      membershipType: "standard",
    };
    return {
      data: channel,
      jsonData: channel,
    } as unknown as HTTPResponse<JSONObject>;
  }) as never);

  world = new QuietChannelsWorld({
    workspaces: [WorkspaceType.MicrosoftTeams],
    channels: {
      teams: {
        id: TEAMS_CHANNEL,
        name: "inc-8",
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAM_ID,
        notificationRuleId: WORKSPACE_RULE_ID.toString(),
      },
    },
  });
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
  (
    MicrosoftTeamsUtil as unknown as { cachedAdapter: CloudAdapter | null }
  ).cachedAdapter = null;
});

function headline(request: ConnectorRequest): string {
  return request.text.split("\n")[0]!;
}

describe("an incident in its Microsoft Teams channel", () => {
  test("one card per event, the run's card edited in place - the same messages as in Slack", async () => {
    await world.channelCreated([NITIN, NB_USER_3]);
    await world.incidentCreated();
    await world.incidentState({
      to: STATE_IDENTIFIED,
      name: "Identified",
      isFirst: true,
    });
    await world.startRun();
    await world.invitedToRecordChannels([NITIN]);
    await world.escalate();
    await world.invitedToRecordChannels([NB_USER_3, NITIN]);
    /*
     * Rule "third" pages nobody: the policy repeats from "fhirst" at once,
     * paging Nitin a third time (OnCallEmptyLevel).
     */
    await world.escalate();
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

    const posts: Array<ConnectorRequest> = connector.posts();

    // No "could not be added" note in Teams; the rest as in Slack.
    expect(posts.map(headline)).toEqual([
      expect.stringContaining("Incident INC-8 Created"),
      expect.stringContaining("PolicyX"),
      expect.stringContaining("paged nobody at third (Level 3 of 3)"),
      expect.stringContaining("State"),
      expect.stringContaining("State"),
    ]);
    expect(posts[4]!.text).toContain("Resolved");

    /*
     * What each new card's notification says (the activity's summary): the
     * run's card and the alarm say what they are about, as in Slack, and so
     * do the record's own cards now - they used to say "sent a card".
     */
    expect(
      posts.map((post: ConnectorRequest): unknown => {
        return post.activity?.["summary"];
      }),
    ).toEqual([
      "🚨 Incident INC-8 Created: testslack",
      "PolicyX is paging for Incident INC-8",
      "PolicyX paged nobody at third (Level 3 of 3) for Incident INC-8",
      "👀 Nitin changed Incident INC-8 State to Acknowledged",
      "✅ Nitin changed Incident INC-8 State to Resolved",
    ]);

    /*
     * When the next rule comes is a moment Teams shows in each reader's own
     * time - its card text function - the run's rule 1 having started at
     * 5:15 PM UTC and waiting 6 minutes.
     */
    expect(posts[1]!.text).toContain(
      "**fhirst (Level 1 of 3)**: if nobody acknowledges by {{TIME(2026-10-08T17:21:00Z)}}, second (Level 2 of 3) is next.",
    );

    for (const post of posts) {
      // A new post in the channel itself, never into another post's thread.
      expect(post.conversationId).toBe(TEAMS_CHANNEL);
      expect(post.text).not.toContain("On Call Policy");
      expect(post.text).not.toContain("Notification Sent");
      expect(post.text).not.toContain("cannot be invited");
      expect(post.text).not.toContain("could be added");
    }

    expect(posts[0]!.text).toContain("Acknowledge Incident");
    expect(posts[1]!.text).toContain("is paging for");
    expect(posts[3]!.text).toContain("Acknowledged");

    // The run's card: every edit is a PUT of that activity, in its thread.
    const runCardId: string = posts[1]!.answeredId!;
    const updates: Array<ConnectorRequest> = connector.updates();

    expect(updates.length).toBeGreaterThan(0);

    for (const update of updates) {
      expect(update.conversationId).toBe(
        `${TEAMS_CHANNEL};messageid=${runCardId}`,
      );
      expect(update.activityIdInPath).toBe(runCardId);
      expect(update.activity?.["id"]).toBe(runCardId);
      expect(update.activity?.["type"]).toBe("message");
    }

    const last: ConnectorRequest = updates[updates.length - 1]!;
    expect(last.text).toContain("Nitin");
    expect(last.text).toContain("acknowledged");
    expect(last.text).toContain("stopped paging");
    expect(last.text).toContain("paged 3 times");
    expect(last.text).toContain("NB User 2");
    expect(last.activity?.["summary"]).toBe(
      "Nitin acknowledged Incident INC-8",
    );
  });

  test("the first state is not posted under the card that names it", async () => {
    await world.incidentCreated();
    await world.incidentState({
      to: STATE_IDENTIFIED,
      name: "Identified",
      isFirst: true,
    });

    expect(connector.posts()).toHaveLength(1);
    expect(connector.posts()[0]!.text).toContain("Incident State");
  });

  test("who could not be added is not said in Teams: nothing to fix there", async () => {
    await world.channelCreated([NB_USER_3]);

    // Setting the channel up sends nothing.
    expect(connector.requests).toEqual([]);

    await world.incidentCreated();
    await world.invitedToRecordChannels([NB_USER_3]);

    // The incident's card, and nothing after it.
    expect(connector.posts().map(headline)).toEqual([
      expect.stringContaining("Incident INC-8 Created"),
    ]);
    expect(connector.updates()).toEqual([]);
  });

  test("a note reaches the channel with its author", async () => {
    await world.incidentNote("Rolled back the deploy.", JANE);

    expect(connector.posts()).toHaveLength(1);
    expect(connector.posts()[0]!.text).toContain("Jane Doe");
    expect(connector.posts()[0]!.text).toContain("Rolled back the deploy.");
  });

  test("a message saved as a note is not posted back into the channel it is in", async () => {
    await world.incidentNoteSavedFromChat({
      text: "Rolled back the deploy.",
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelId: TEAMS_CHANNEL,
    });

    // The message is there already: nothing more is said in the channel.
    expect(connector.requests).toEqual([]);
  });

  test("a message saved as a note from another channel is posted to the incident's", async () => {
    await world.incidentNoteSavedFromChat({
      text: "Rolled back the deploy.",
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelId: "19:somewhere-else@thread.tacv2",
    });

    expect(connector.posts()).toHaveLength(1);
    expect(connector.posts()[0]!.conversationId).toBe(TEAMS_CHANNEL);
    expect(connector.posts()[0]!.text).toContain("Rolled back the deploy.");
  });
});

describe("a card edit Teams refuses because the post is gone", () => {
  test("is posted again, and edited there from then on", async () => {
    await world.startRun();

    const firstPost: ConnectorRequest = connector.posts()[0]!;
    expect(headline(firstPost)).toContain("PolicyX");

    // Somebody deletes the card: the Bot Connector answers the next edit 404.
    connector.refuseNextUpdate = true;

    await world.escalate();

    const refused: Array<ConnectorRequest> = connector
      .updates()
      .filter((update: ConnectorRequest): boolean => {
        return update.activityIdInPath === firstPost.answeredId;
      });
    expect(refused.length).toBeGreaterThan(0);

    const repost: Array<ConnectorRequest> = connector
      .posts()
      .filter((post: ConnectorRequest): boolean => {
        return headline(post).includes("PolicyX");
      });

    expect(repost).toHaveLength(2);

    // The later edits go to the new card.
    const newCardId: string = repost[1]!.answeredId!;
    expect(newCardId).not.toBe(repost[0]!.answeredId);
    await world.escalate();

    const lastUpdate: ConnectorRequest =
      connector.updates()[connector.updates().length - 1]!;
    expect(lastUpdate.activityIdInPath).toBe(newCardId);
  });
});

describe("an alert, in its Microsoft Teams channel", () => {
  beforeEach(() => {
    world.runFor = "alert";
    world.recordStateName = "Created";
  });

  test("created, first state, on-call, owners notified, acknowledged: the same cards as in Slack, the run's edited in place", async () => {
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

    const posts: Array<ConnectorRequest> = connector.posts();

    expect(posts.map(headline)).toEqual([
      expect.stringContaining("Alert AL-12 Created"),
      expect.stringContaining("PolicyX"),
      expect.stringContaining("State"),
    ]);
    expect(posts[1]!.text).toContain("Alert AL-12");

    // Every edit is of the run's card, and the last one says who acknowledged.
    const runCardId: string = posts[1]!.answeredId!;
    const updates: Array<ConnectorRequest> = connector.updates();
    expect(updates.length).toBeGreaterThan(0);

    for (const update of updates) {
      expect(update.activityIdInPath).toBe(runCardId);
    }

    expect(updates[updates.length - 1]!.text).toContain("acknowledged");

    // That the owners were told stays in the alert's feed.
    expect(
      world.feed.filter((entry: FeedEntry): boolean => {
        return entry.eventType === "OwnerNotificationSent";
      }),
    ).toEqual([
      expect.objectContaining({ record: "alert", postsToWorkspace: false }),
    ]);
  });
});

describe("a scheduled maintenance event, in its Microsoft Teams channel", () => {
  test("created, first state, ongoing, subscribers notified, a note: three cards, nothing edited", async () => {
    await world.maintenanceCreated();
    await world.maintenanceState("Scheduled", true);
    await world.maintenanceState("Ongoing", false);
    await world.maintenanceSubscribersNotified();
    await world.maintenanceNote("The upgrade has started.");

    expect(connector.posts().map(headline)).toEqual([
      expect.stringContaining("Scheduled Maintenance SM-3 Created"),
      expect.stringContaining("Ongoing"),
      expect.stringContaining("public note"),
    ]);

    for (const post of connector.posts()) {
      expect(post.conversationId).toBe(TEAMS_CHANNEL);
    }

    expect(connector.updates()).toEqual([]);
  });
});

/*
 * THE MAINTAINER'S POLICY, IN ITS MICROSOFT TEAMS CHANNEL: Level 1 has no
 * responders, Level 2 pages Nitin. Level 1 holds no wait
 * (OnCallEmptyLevel): the run's card is on Level 2 from the start, and says
 * Level 1 was passed at once - the same words as in Slack.
 */
describe("a policy whose first level has nobody to page, in its Microsoft Teams channel", () => {
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

  async function startPaging(): Promise<void> {
    await world.channelCreated([NITIN]);
    await world.incidentCreated();
    await world.incidentState({
      to: STATE_IDENTIFIED,
      name: "Identified",
      isFirst: true,
    });
    await world.startRun();
    await world.settle();
  }

  // The run's card as it reads now: its last edit, else its post.
  function runCard(): string {
    const runPost: ConnectorRequest | undefined = connector
      .posts()
      .find((post: ConnectorRequest): boolean => {
        return headline(post).includes("is paging for");
      });
    const edits: Array<ConnectorRequest> = connector
      .updates()
      .filter((update: ConnectorRequest): boolean => {
        return (
          Boolean(runPost?.answeredId) &&
          (update.activityIdInPath || "").includes(runPost!.answeredId!)
        );
      });

    return (edits[edits.length - 1] || runPost)?.text || "";
  }

  test("the run's card is on Level 2 from the start, and says Level 1 was passed at once", async () => {
    await startPaging();

    const card: string = runCard();

    expect(card).toContain(
      "**Level 2 of 2**: if nobody acknowledges by {{TIME(2026-10-08T17:45:00Z)}}, paging stops.",
    );
    expect(card).toContain("**Nitin**: paged once · by SMS and email");
    expect(card).toContain(
      "Level 1 of 2: nobody to page, so Level 2 of 2 was paged at once",
    );
  });

  test("one card for the run in the channel: nothing asks anybody to page somebody", async () => {
    await startPaging();

    const runCards: Array<ConnectorRequest> = connector
      .posts()
      .filter((post: ConnectorRequest): boolean => {
        return headline(post).includes("PolicyX");
      });

    expect(runCards).toHaveLength(1);

    for (const post of connector.posts()) {
      expect(post.text).not.toContain("page someone or fix the policy");
    }
  });

  test("the incident's feed says it the same way: Level 1 passed at once, then Nitin paged", async () => {
    await startPaging();

    const entries: Array<string> = world.feed
      .filter((entry: FeedEntry): boolean => {
        return entry.eventType === "OnCallPolicy";
      })
      .map((entry: FeedEntry): string => {
        return entry.markdown;
      });

    expect(
      entries.some((markdown: string): boolean => {
        return markdown.includes(
          "paged nobody at **Level 1 of 2**: this escalation rule has no responders, so the next level was paged at once.",
        );
      }),
    ).toBe(true);
  });
});
