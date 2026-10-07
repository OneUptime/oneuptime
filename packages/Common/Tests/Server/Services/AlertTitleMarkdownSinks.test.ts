import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import { getDeclaredFromAlertsMarkdown } from "../../../Server/Services/IncidentAlertService";
import ShortLinkService from "../../../Server/Services/ShortLinkService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import WorkspaceNotificationSummaryService from "../../../Server/Services/WorkspaceNotificationSummaryService";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import {
  MicrosoftTeamsAlertActionType,
  MicrosoftTeamsAlertEpisodeActionType,
} from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAlertActions from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Alert";
import MicrosoftTeamsAlertEpisodeActions from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/AlertEpisode";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import AlertWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Alert";
import AlertEpisodeWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/AlertEpisode";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceNotificationSummaryItem from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import { WORD_JOINER } from "../../../Utils/Markdown/MarkdownEscape";
import {
  hrefsOf,
  renderAsDashboard,
} from "../../Utils/Markdown/DashboardMarkdownRenderer";
import { mockProjectStates } from "../TestingUtils/Services/ProjectStatesHelper";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { TurnContext } from "botbuilder";
import { Token, Tokens, marked } from "marked";

/*
 * AN ALERT'S TITLE IS TEXT IN EVERY FEED ITEM AND CHAT MESSAGE.
 *
 * An alert's title is plain text, and often not typed by a person at all: a
 * monitor fills it in from what it watched - the subject and the sender of
 * an incoming email, a field of an incoming request, a response body - and
 * an alert episode's is often copied from its first alert's. Wherever
 * OneUptime places it into Markdown - the alert's and the episode's feed
 * items, which the dashboard renders without its safe mode and posts to
 * Slack and Teams, the Teams bot's replies and summaries, the Slack and
 * Teams summaries, on-call messages - it is escaped as MarkdownEscape says a
 * title must be, as an incident's is (IncidentTitleMarkdownSinks): it cannot
 * become an image fetched when the text is shown, a link whose words hide
 * where it goes, raw HTML, or a Slack mention, and an ordinary title reads
 * exactly as typed.
 *
 * Each place is driven with the title a monitored email could carry, and
 * what it writes is read by marked (as the emails are rendered), by the
 * dashboard's own parser, and by slackify, as Slack gets it.
 */

const HOSTILE_TITLE: string =
  "![](https://tracker.example/p.png) [Reset your password](https://evil.example/login) <!channel> <@U0123ABC> <img src=x onerror=alert(1)>";

const HOSTILE_NAME: string =
  "[Open](https://evil.example/state) <!here> <b>bold</b>";

const ORDINARY_TITLE: string = "Site 03 - payments (EU)";

const PROJECT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000a701",
);
const ALERT_ID: ObjectID = new ObjectID("0194d4ba-0000-4000-8000-00000000a702");
const EPISODE_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000a703",
);
const USER_ID: ObjectID = new ObjectID("0194d4ba-0000-4000-8000-00000000a704");

const DASHBOARD_LINK: string = "https://oneuptime.example/dashboard/alert";

const HTML_IMAGE_PATTERN: RegExp = /<img/;
// The addresses the hostile title and name bring.
const TITLE_ADDRESS_PATTERN: RegExp = /(?:evil|tracker)\.example/;
const HTML_LINK_PATTERN: RegExp = /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
const HTML_TAG_PATTERN: RegExp = /<[^>]+>/g;
const SLACK_MENTION_PATTERN: RegExp = /<[!@#]/;
const SLACK_HIDDEN_LINK_PATTERN: RegExp =
  /<https:\/\/(?:evil|tracker)\.example[^|>]*\|/;
const WORD_JOINER_PATTERN: RegExp = new RegExp(WORD_JOINER, "g");

function tokensOf(markdown: string): Array<Token> {
  const tokens: Array<Token> = [];

  marked.walkTokens(marked.lexer(markdown), (token: Token): void => {
    tokens.push(token);
  });

  return tokens;
}

function slackTextOf(markdown: string): string {
  return SlackUtil.getMarkdownBlocks({
    payloadMarkdownBlock: {
      _type: "WorkspacePayloadMarkdown",
      text: markdown,
    },
  })
    .map((block: { text?: { text?: string } }): string => {
      return block.text?.text || "";
    })
    .join("\n");
}

/*
 * Nothing in the text is fetched when it is shown, no link's words hide an
 * address the title brought, no raw HTML reaches a renderer, and Slack reads
 * no mention and no link that hides where it goes.
 */
function expectInert(markdowns: Array<string>): void {
  const htmls: Array<string> = renderAsDashboard(markdowns);

  markdowns.forEach((markdown: string, index: number): void => {
    const tokens: Array<Token> = tokensOf(markdown);

    expect({
      markdown: markdown,
      images: tokens.filter((token: Token): boolean => {
        return token.type === "image";
      }).length,
      html: tokens.filter((token: Token): boolean => {
        return token.type === "html";
      }).length,
      hidingLinks: tokens.filter((token: Token): boolean => {
        return (
          token.type === "link" &&
          TITLE_ADDRESS_PATTERN.test((token as Tokens.Link).href) &&
          (token as Tokens.Link).text !== (token as Tokens.Link).href
        );
      }).length,
    }).toEqual({ markdown: markdown, images: 0, html: 0, hidingLinks: 0 });

    const html: string = htmls[index]!;
    const hidingLinks: Array<string> = Array.from(
      html.matchAll(HTML_LINK_PATTERN),
    )
      .filter((match: RegExpMatchArray): boolean => {
        const href: string = hrefsOf(match[0])[0]!;

        return (
          TITLE_ADDRESS_PATTERN.test(href) &&
          match[2]!.replace(HTML_TAG_PATTERN, "") !== href
        );
      })
      .map((match: RegExpMatchArray): string => {
        return match[0];
      });

    expect({
      markdown: markdown,
      image: HTML_IMAGE_PATTERN.test(html),
      hidingLinks: hidingLinks,
    }).toEqual({ markdown: markdown, image: false, hidingLinks: [] });

    const slack: string = slackTextOf(markdown);

    expect({
      markdown: markdown,
      mention: SLACK_MENTION_PATTERN.test(slack),
      hiddenLink: SLACK_HIDDEN_LINK_PATTERN.test(slack),
    }).toEqual({ markdown: markdown, mention: false, hiddenLink: false });
  });
}

/*
 * The text as a reader sees it once the Markdown is rendered. The invisible
 * word joiner that breaks a Slack mention is taken out: nobody sees it.
 */
function readText(markdown: string): string {
  return (marked.parse(markdown, { async: false }) as string)
    .replace(HTML_TAG_PATTERN, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(WORD_JOINER_PATTERN, "");
}

let alertFeed: ReturnType<typeof jest.spyOn>;
let episodeFeed: ReturnType<typeof jest.spyOn>;

function alertFeedMarkdown(): Array<string> {
  return alertFeed.mock.calls.map((args: Array<unknown>): string => {
    return (args[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
  });
}

function episodeFeedMarkdown(): Array<string> {
  return episodeFeed.mock.calls.map((args: Array<unknown>): string => {
    return (args[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
  });
}

function stateNamed(name: string): AlertState {
  const state: AlertState = new AlertState();
  state._id = ObjectID.generate().toString();
  state.name = name;
  return state;
}

function severityNamed(name: string): AlertSeverity {
  const severity: AlertSeverity = new AlertSeverity();
  severity._id = ObjectID.generate().toString();
  severity.name = name;
  return severity;
}

function alertTitled(title: string): Alert {
  const alert: Alert = new Alert();
  alert._id = ALERT_ID.toString();
  alert.projectId = PROJECT_ID;
  alert.alertNumber = 42;
  alert.alertNumberWithPrefix = "ALT-42";
  alert.title = title;
  alert.description = "Every order fails.";
  return alert;
}

function episodeTitled(title: string): AlertEpisode {
  const episode: AlertEpisode = new AlertEpisode();
  episode._id = EPISODE_ID.toString();
  episode.projectId = PROJECT_ID;
  episode.episodeNumber = 7;
  episode.episodeNumberWithPrefix = "AEP-7";
  episode.title = title;
  return episode;
}

function createTurnContext(): TurnContext {
  return {
    activity: {},
    sendActivity: jest.fn(async (): Promise<void> => {}),
  } as unknown as TurnContext;
}

function sentText(turnContext: TurnContext): string {
  return (
    turnContext.sendActivity as unknown as {
      mock: { calls: Array<Array<unknown>> };
    }
  ).mock.calls
    .map((args: Array<unknown>): string => {
      return String(args[0]);
    })
    .join("\n");
}

beforeEach(() => {
  mockProjectStates();
  alertFeed = jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);
  episodeFeed = jest
    .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Alert Created feed item", () => {
  type CreateAlertFeedAsync = (alertId: ObjectID) => Promise<void>;

  async function createdFeedFor(
    alert: Alert,
    resources: Array<LinkedAffectedResource> = [],
  ): Promise<string> {
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert as never);
    jest
      .spyOn(LinkedAffectedResources, "readForAlert")
      .mockResolvedValue(resources as never);
    jest
      .spyOn(AlertWorkspaceMessages, "getAlertCreateMessageBlocks")
      .mockResolvedValue([] as never);

    await (
      AlertService as unknown as { createAlertFeedAsync: CreateAlertFeedAsync }
    ).createAlertFeedAsync(ALERT_ID);

    expect(alertFeedMarkdown()).toHaveLength(1);

    return alertFeedMarkdown()[0]!;
  }

  test("quotes a title from a monitored email inertly, and it reads as typed", async () => {
    const markdown: string = await createdFeedFor(alertTitled(HOSTILE_TITLE));

    expectInert([markdown]);
    expect(readText(markdown)).toContain(HOSTILE_TITLE);
  });

  test("quotes the state's and the severity's names inertly", async () => {
    const alert: Alert = alertTitled(ORDINARY_TITLE);
    alert.currentAlertState = stateNamed(HOSTILE_NAME);
    alert.alertSeverity = severityNamed(HOSTILE_NAME);

    const markdown: string = await createdFeedFor(alert);

    expectInert([markdown]);
    expect(readText(markdown)).toContain(`Alert State: ${HOSTILE_NAME}`);
    expect(readText(markdown)).toContain(`Severity: ${HOSTILE_NAME}`);
  });

  test("names the monitor it affects inertly, inside the monitor's link", async () => {
    const monitorId: string = ObjectID.generate().toString();
    const markdown: string = await createdFeedFor(alertTitled(ORDINARY_TITLE), [
      {
        type: LinkedAffectedResourceType.Monitor,
        id: monitorId,
        name: HOSTILE_NAME,
      },
    ]);

    expectInert([markdown]);
    expect(readText(markdown)).toContain(HOSTILE_NAME);
    expect(markdown).toContain(`/monitors/${monitorId})`);
  });

  test("an ordinary title reads exactly as typed, and the description stays Markdown", async () => {
    const alert: Alert = alertTitled(ORDINARY_TITLE);
    alert.description = "**Every** order fails.";

    const markdown: string = await createdFeedFor(alert);

    expect(markdown).toContain(`**${ORDINARY_TITLE}**:`);
    expect(markdown).toContain("**Every** order fails.");
  });

  test("a missing title still says so", async () => {
    const markdown: string = await createdFeedFor(alertTitled(""));

    expect(markdown).toContain("**No title provided.**:");
  });
});

describe("the alert episode's Episode Created feed item", () => {
  type CreateEpisodeCreatedFeed = (episode: AlertEpisode) => Promise<void>;

  async function createdFeedFor(episode: AlertEpisode): Promise<string> {
    jest
      .spyOn(
        AlertEpisodeWorkspaceMessages,
        "getAlertEpisodeCreateMessageBlocks",
      )
      .mockResolvedValue([] as never);

    await (
      AlertEpisodeService as unknown as {
        createEpisodeCreatedFeed: CreateEpisodeCreatedFeed;
      }
    ).createEpisodeCreatedFeed(episode);

    expect(episodeFeedMarkdown()).toHaveLength(1);

    return episodeFeedMarkdown()[0]!;
  }

  test("quotes the title inertly, and it reads as typed", async () => {
    const episode: AlertEpisode = episodeTitled(HOSTILE_TITLE);
    episode.description = "Grouped by the checkout rule.";

    const markdown: string = await createdFeedFor(episode);

    expectInert([markdown]);
    expect(readText(markdown)).toContain(HOSTILE_TITLE);
    // The description stays the Markdown it is.
    expect(markdown).toContain("Grouped by the checkout rule.");
  });

  test("an ordinary title reads exactly as typed", async () => {
    const markdown: string = await createdFeedFor(
      episodeTitled(ORDINARY_TITLE),
    );

    expect(markdown).toContain(`**${ORDINARY_TITLE}**`);
  });
});

describe("the alert episode members' feed items", () => {
  type OnCreateSuccess = (
    onCreate: OnCreate<AlertEpisodeMember>,
    createdItem: AlertEpisodeMember,
  ) => Promise<AlertEpisodeMember>;
  type OnDeleteSuccess = (
    onDelete: OnDelete<AlertEpisodeMember>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<AlertEpisodeMember>>;

  function stubReads(alertTitle: string, episodeTitle: string): void {
    jest.spyOn(AlertService, "updateOneById").mockResolvedValue(1 as never);
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alertTitled(alertTitle) as never);
    jest
      .spyOn(AlertEpisodeService, "findOneById")
      .mockResolvedValue(episodeTitled(episodeTitle) as never);
    jest
      .spyOn(AlertEpisodeService, "updateAlertCount")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertEpisodeService, "updateLastAlertAddedAt")
      .mockResolvedValue(undefined as never);
    // Removed from its only episode.
    jest.spyOn(AlertEpisodeMemberService, "findOneBy").mockResolvedValue(null);
  }

  function member(): AlertEpisodeMember {
    const created: AlertEpisodeMember = new AlertEpisodeMember();
    created.projectId = PROJECT_ID;
    created.alertId = ALERT_ID;
    created.alertEpisodeId = EPISODE_ID;
    return created;
  }

  async function addToEpisode(): Promise<void> {
    await (
      AlertEpisodeMemberService as unknown as {
        onCreateSuccess: OnCreateSuccess;
      }
    ).onCreateSuccess(
      { createBy: {} } as unknown as OnCreate<AlertEpisodeMember>,
      member(),
    );
  }

  async function removeFromEpisode(): Promise<void> {
    await (
      AlertEpisodeMemberService as unknown as {
        onDeleteSuccess: OnDeleteSuccess;
      }
    ).onDeleteSuccess(
      {
        deleteBy: {},
        carryForward: [member()],
      } as unknown as OnDelete<AlertEpisodeMember>,
      [],
    );
  }

  test("adding an alert to an episode quotes both titles inertly", async () => {
    stubReads(HOSTILE_TITLE, HOSTILE_TITLE);

    await addToEpisode();

    expect(episodeFeedMarkdown()).toHaveLength(1);
    expect(alertFeedMarkdown()).toHaveLength(1);
    expectInert([...episodeFeedMarkdown(), ...alertFeedMarkdown()]);

    for (const markdown of [...episodeFeedMarkdown(), ...alertFeedMarkdown()]) {
      expect(readText(markdown)).toContain(HOSTILE_TITLE);
    }
  });

  test("removing an alert from an episode quotes both titles inertly", async () => {
    stubReads(HOSTILE_TITLE, HOSTILE_TITLE);

    await removeFromEpisode();

    expect(episodeFeedMarkdown()).toHaveLength(1);
    expect(alertFeedMarkdown()).toHaveLength(1);
    expectInert([...episodeFeedMarkdown(), ...alertFeedMarkdown()]);
  });

  test("an ordinary title reads exactly as typed", async () => {
    stubReads(ORDINARY_TITLE, ORDINARY_TITLE);

    await addToEpisode();

    expect(episodeFeedMarkdown()[0]).toBe(
      `**Alert ALT-42** added to episode: ${ORDINARY_TITLE}`,
    );
    expect(alertFeedMarkdown()[0]).toBe(
      `Added to **Episode AEP-7**: ${ORDINARY_TITLE}`,
    );
  });
});

describe("an incident declared from alerts", () => {
  test("lists each alert's title inertly", () => {
    const markdown: string = getDeclaredFromAlertsMarkdown([
      {
        label: "Alert ALT-42",
        link: DASHBOARD_LINK,
        title: HOSTILE_TITLE,
        isPrivate: false,
      },
    ]);

    expectInert([markdown]);
    expect(readText(markdown)).toContain(HOSTILE_TITLE);
  });

  test("an ordinary title reads exactly as typed, and a private alert's is left out", () => {
    const markdown: string = getDeclaredFromAlertsMarkdown([
      {
        label: "Alert ALT-42",
        link: DASHBOARD_LINK,
        title: ORDINARY_TITLE,
        isPrivate: false,
      },
      {
        label: "Alert ALT-43",
        link: DASHBOARD_LINK,
        title: HOSTILE_TITLE,
        isPrivate: true,
      },
    ]);

    expect(markdown).toContain(
      `- **[Alert ALT-42](${DASHBOARD_LINK})**: ${ORDINARY_TITLE}`,
    );
    expect(markdown).not.toContain("tracker.example");
  });
});

describe("Microsoft Teams", () => {
  const databaseProps: DatabaseCommonInteractionProps = {
    tenantId: PROJECT_ID,
    userId: USER_ID,
  };

  test("the bot's alert details quote the title and the names inertly", async () => {
    const alert: Alert = alertTitled(HOSTILE_TITLE);
    alert.currentAlertState = stateNamed(HOSTILE_NAME);
    alert.alertSeverity = severityNamed(HOSTILE_NAME);

    jest.spyOn(AlertService, "findOneBy").mockResolvedValue(alert as never);

    const turnContext: TurnContext = createTurnContext();

    await MicrosoftTeamsAlertActions.handleBotAlertAction({
      actionType: MicrosoftTeamsAlertActionType.ViewAlert,
      actionValue: ALERT_ID.toString(),
      value: {},
      projectId: PROJECT_ID,
      oneUptimeUserId: USER_ID,
      databaseProps: databaseProps,
      turnContext: turnContext,
    });

    expect(sentText(turnContext)).toContain("**Title:**");
    expectInert([sentText(turnContext)]);
    expect(readText(sentText(turnContext))).toContain(HOSTILE_TITLE);
    expect(readText(sentText(turnContext))).toContain(`State: ${HOSTILE_NAME}`);
  });

  test("the bot's alert episode details quote the title inertly", async () => {
    const episode: AlertEpisode = episodeTitled(HOSTILE_TITLE);
    episode.currentAlertState = stateNamed(HOSTILE_NAME);
    episode.alertSeverity = severityNamed(HOSTILE_NAME);

    jest
      .spyOn(AlertEpisodeService, "findOneBy")
      .mockResolvedValue(episode as never);

    const turnContext: TurnContext = createTurnContext();

    await MicrosoftTeamsAlertEpisodeActions.handleBotAlertEpisodeAction({
      actionType: MicrosoftTeamsAlertEpisodeActionType.ViewAlertEpisode,
      actionValue: EPISODE_ID.toString(),
      value: {},
      projectId: PROJECT_ID,
      oneUptimeUserId: USER_ID,
      databaseProps: databaseProps,
      turnContext: turnContext,
    });

    expect(sentText(turnContext)).toContain("**Title:**");
    expectInert([sentText(turnContext)]);
    expect(readText(sentText(turnContext))).toContain(HOSTILE_TITLE);
  });

  test("the active alerts summary keeps the title inside its link, and the names as text", async () => {
    const state: AlertState = stateNamed(HOSTILE_NAME);
    const monitor: Monitor = new Monitor();
    monitor.name = HOSTILE_NAME;

    const alert: Alert = alertTitled(HOSTILE_TITLE);
    alert.currentAlertState = state;
    alert.alertSeverity = severityNamed(HOSTILE_NAME);
    alert.monitor = monitor;

    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStates")
      .mockResolvedValue([state] as never);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([alert] as never);
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString(DASHBOARD_LINK) as never);

    const message: string = await (
      MicrosoftTeamsUtil as unknown as {
        getActiveAlertsMessage: (projectId: ObjectID) => Promise<string>;
      }
    ).getActiveAlertsMessage(PROJECT_ID);

    expectInert([message]);

    // The one link for the alert goes to the dashboard, title and all.
    const alertLinks: Array<Tokens.Link> = tokensOf(message).filter(
      (token: Token): boolean => {
        return (
          token.type === "link" &&
          (token as Tokens.Link).text.startsWith("Alert ALT-42")
        );
      },
    ) as Array<Tokens.Link>;

    expect(alertLinks).toHaveLength(1);
    expect(alertLinks[0]!.href).toBe(DASHBOARD_LINK);
    expect(readText(alertLinks[0]!.raw)).toContain(HOSTILE_TITLE);
    expect(readText(message)).toContain(`Monitor: ${HOSTILE_NAME}`);
  });
});

describe("Slack and Teams summaries", () => {
  type BuildBlocks = (data: {
    blocks: Array<WorkspaceMessageBlock>;
    items: Array<WorkspaceNotificationSummaryItem>;
    type: WorkspaceNotificationSummaryType;
    fromDate: Date;
    projectId: ObjectID;
  }) => Promise<void>;

  function markdownOf(blocks: Array<WorkspaceMessageBlock>): Array<string> {
    return blocks
      .filter((block: WorkspaceMessageBlock): boolean => {
        return block._type === "WorkspacePayloadMarkdown";
      })
      .map((block: WorkspaceMessageBlock): string => {
        return (block as WorkspacePayloadMarkdown).text;
      });
  }

  async function summaryOf(
    type: WorkspaceNotificationSummaryType,
    items: Array<WorkspaceNotificationSummaryItem>,
  ): Promise<Array<string>> {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.example/dashboard") as never,
      );

    const blocks: Array<WorkspaceMessageBlock> = [];

    await (
      WorkspaceNotificationSummaryService as unknown as {
        buildAlertBlocks: BuildBlocks;
      }
    ).buildAlertBlocks({
      blocks: blocks,
      items: items,
      type: type,
      fromDate: new Date("2026-09-01T00:00:00.000Z"),
      projectId: PROJECT_ID,
    });

    return markdownOf(blocks);
  }

  test("an alert's line keeps its title inside the link and its names as text", async () => {
    const alert: Alert = alertTitled(HOSTILE_TITLE);
    alert.alertSeverity = severityNamed(HOSTILE_NAME);
    alert.currentAlertState = stateNamed(HOSTILE_NAME);

    jest.spyOn(AlertService, "findAllBy").mockResolvedValue([alert] as never);

    const markdown: Array<string> = await summaryOf(
      WorkspaceNotificationSummaryType.Alert,
      [WorkspaceNotificationSummaryItem.ListWithLinks],
    );
    const line: string = markdown.find((text: string): boolean => {
      return text.includes("ALT-42");
    })!;

    expectInert([line]);
    expect(readText(line)).toContain(HOSTILE_TITLE);
    expect(readText(line)).toContain(`Severity: ${HOSTILE_NAME}`);
  });

  test("an alert episode's line keeps its title inside the link", async () => {
    jest
      .spyOn(AlertEpisodeService, "findAllBy")
      .mockResolvedValue([episodeTitled(HOSTILE_TITLE)] as never);

    const markdown: Array<string> = await summaryOf(
      WorkspaceNotificationSummaryType.AlertEpisode,
      [WorkspaceNotificationSummaryItem.ListWithLinks],
    );
    const line: string = markdown.find((text: string): boolean => {
      return text.includes("tracker.example");
    })!;

    expectInert([line]);
    expect(readText(line)).toContain(HOSTILE_TITLE);
  });

  test("the severity and state breakdowns name them as text", async () => {
    const alert: Alert = alertTitled(ORDINARY_TITLE);
    alert.alertSeverity = severityNamed(HOSTILE_NAME);
    alert.currentAlertState = stateNamed(HOSTILE_NAME);

    jest.spyOn(AlertService, "findAllBy").mockResolvedValue([alert] as never);

    const markdown: Array<string> = await summaryOf(
      WorkspaceNotificationSummaryType.Alert,
      [
        WorkspaceNotificationSummaryItem.SeverityBreakdown,
        WorkspaceNotificationSummaryItem.StateBreakdown,
      ],
    );
    const breakdowns: Array<string> = markdown.filter(
      (text: string): boolean => {
        return text.includes("By Severity:") || text.includes("By State:");
      },
    );

    expect(breakdowns).toHaveLength(2);
    expectInert(breakdowns);

    for (const breakdown of breakdowns) {
      expect(readText(breakdown)).toContain(`${HOSTILE_NAME}: 1`);
    }
  });
});

describe("on-call messages in Slack and Teams", () => {
  beforeEach(() => {
    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(Hostname.fromString("oneuptime.example") as never);
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS as never);
    jest
      .spyOn(ShortLinkService, "saveShortLinkFor")
      .mockResolvedValue({} as never);
    jest
      .spyOn(ShortLinkService, "getShortenedUrl")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.example/l/ack") as never,
      );
  });

  function markdownOf(blocks: Array<WorkspaceMessageBlock>): string {
    return blocks
      .map((block: WorkspaceMessageBlock): string => {
        return (block as WorkspacePayloadMarkdown).text || "";
      })
      .join("\n");
  }

  test("a new alert's message quotes its title inertly", async () => {
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString(DASHBOARD_LINK) as never);

    const markdown: string = markdownOf(
      await UserNotificationRuleService.generateWorkspaceMessageBlocksForAlertCreated(
        alertTitled(HOSTILE_TITLE),
        ObjectID.generate(),
      ),
    );

    expectInert([markdown]);
    expect(readText(markdown)).toContain(`ALT-42 — ${HOSTILE_TITLE}`);
  });

  test("a new alert episode's message quotes its title inertly", async () => {
    jest
      .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
      .mockResolvedValue(URL.fromString(DASHBOARD_LINK) as never);

    const markdown: string = markdownOf(
      await UserNotificationRuleService.generateWorkspaceMessageBlocksForAlertEpisodeCreated(
        episodeTitled(HOSTILE_TITLE),
        ObjectID.generate(),
      ),
    );

    expectInert([markdown]);
    expect(readText(markdown)).toContain(`AEP-7 — ${HOSTILE_TITLE}`);
  });

  test("an ordinary title reads exactly as typed", async () => {
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString(DASHBOARD_LINK) as never);

    const markdown: string = markdownOf(
      await UserNotificationRuleService.generateWorkspaceMessageBlocksForAlertCreated(
        alertTitled(ORDINARY_TITLE),
        ObjectID.generate(),
      ),
    );

    expect(markdown).toContain(`📋 **ALT-42 — ${ORDINARY_TITLE}**`);
  });
});
