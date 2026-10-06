import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ShortLinkService from "../../../Server/Services/ShortLinkService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import WorkspaceNotificationSummaryService from "../../../Server/Services/WorkspaceNotificationSummaryService";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import {
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsIncidentEpisodeActionType,
} from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsIncidentActions from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsIncidentEpisodeActions from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/IncidentEpisode";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import IncidentEpisodeWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/IncidentEpisode";
import URL from "../../../Types/API/URL";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceNotificationSummaryItem from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import {
  hrefsOf,
  renderAsDashboard,
} from "../../Utils/Markdown/DashboardMarkdownRenderer";
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
 * An incident's title is plain text, typed by whoever declared the incident
 * - since incident forms, anyone holding a form's link - and an episode's is
 * often copied from its first incident's. Wherever OneUptime places a title
 * into Markdown - episode and incident feed items, which the dashboard
 * renders without its safe mode and posts to Slack and Teams, the Teams and
 * Slack summaries, the Teams bot's replies, on-call messages - it is escaped
 * as MarkdownEscape says a title must be (escapeMarkdownValue), as the
 * "Incident Created" feed item escapes it: a title cannot become an image
 * fetched when the text is shown, or a link whose text hides where it goes,
 * and an ordinary title reads exactly as typed.
 *
 * Each place is driven with the title a stranger could send, and what it
 * writes is read by marked, as the emails are rendered, and by the
 * dashboard's own parser.
 */

const HOSTILE_TITLE: string =
  "![](https://tracker.example/p.png) [Reset your password](https://evil.example/login)";

const ORDINARY_TITLE: string = "Site 03 - payments (EU)";

const PROJECT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000c701",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000c702",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000c703",
);
const USER_ID: ObjectID = new ObjectID("0194d4ba-0000-4000-8000-00000000c704");

const DASHBOARD_LINK: string = "https://oneuptime.example/dashboard/incident";

const HTML_IMAGE_PATTERN: RegExp = /<img/;
const HTML_LINK_PATTERN: RegExp = /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

function tokensOf(markdown: string): Array<Token> {
  const tokens: Array<Token> = [];

  marked.walkTokens(marked.lexer(markdown), (token: Token): void => {
    tokens.push(token);
  });

  return tokens;
}

/*
 * Nothing in the text is fetched when it is shown, and every link to the
 * address in the title shows that address: the title's own link syntax
 * did not become a link whose text hides where it goes.
 */
function expectTitleInert(markdowns: Array<string>): void {
  const htmls: Array<string> = renderAsDashboard(markdowns);

  markdowns.forEach((markdown: string, index: number): void => {
    const tokens: Array<Token> = tokensOf(markdown);

    expect({
      markdown: markdown,
      images: tokens.filter((token: Token): boolean => {
        return token.type === "image";
      }).length,
      hidingLinks: tokens.filter((token: Token): boolean => {
        return (
          token.type === "link" &&
          (token as Tokens.Link).href.includes("evil.example") &&
          (token as Tokens.Link).text !== (token as Tokens.Link).href
        );
      }).length,
    }).toEqual({ markdown: markdown, images: 0, hidingLinks: 0 });

    const html: string = htmls[index]!;
    const hidingLinks: Array<string> = Array.from(
      html.matchAll(HTML_LINK_PATTERN),
    )
      .filter((match: RegExpMatchArray): boolean => {
        return (
          hrefsOf(match[0])[0]!.includes("evil.example") &&
          match[2]!.replace(/<[^>]+>/g, "") !== hrefsOf(match[0])[0]
        );
      })
      .map((match: RegExpMatchArray): string => {
        return match[0];
      });

    expect({
      markdown: markdown,
      image: HTML_IMAGE_PATTERN.test(html),
      hidingLinks,
    }).toEqual({ markdown: markdown, image: false, hidingLinks: [] });
  });
}

// The text as a reader sees it once the Markdown is rendered.
function readText(markdown: string): string {
  return (marked.parse(markdown, { async: false }) as string)
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

let incidentFeed: ReturnType<typeof jest.spyOn>;
let episodeFeed: ReturnType<typeof jest.spyOn>;

function incidentFeedMarkdown(): Array<string> {
  return incidentFeed.mock.calls.map((args: Array<unknown>): string => {
    return (args[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
  });
}

function episodeFeedMarkdown(): Array<string> {
  return episodeFeed.mock.calls.map((args: Array<unknown>): string => {
    return (args[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
  });
}

function incidentTitled(title: string): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.projectId = PROJECT_ID;
  incident.incidentNumber = 42;
  incident.incidentNumberWithPrefix = "INC-42";
  incident.title = title;
  incident.description = "Every order fails.";
  return incident;
}

function episodeTitled(title: string): IncidentEpisode {
  const episode: IncidentEpisode = new IncidentEpisode();
  episode._id = EPISODE_ID.toString();
  episode.projectId = PROJECT_ID;
  episode.episodeNumber = 7;
  episode.episodeNumberWithPrefix = "EP-7";
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
  incidentFeed = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  episodeFeed = jest
    .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("episode feed items", () => {
  type OnCreateSuccess = (
    onCreate: OnCreate<IncidentEpisodeMember>,
    createdItem: IncidentEpisodeMember,
  ) => Promise<IncidentEpisodeMember>;
  type OnDeleteSuccess = (
    onDelete: OnDelete<IncidentEpisodeMember>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<IncidentEpisodeMember>>;

  function stubReads(incidentTitle: string, episodeTitle: string): void {
    jest.spyOn(IncidentService, "updateOneById").mockResolvedValue(1 as never);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incidentTitled(incidentTitle) as never);
    jest
      .spyOn(IncidentEpisodeService, "findOneById")
      .mockResolvedValue(episodeTitled(episodeTitle) as never);
    jest
      .spyOn(IncidentEpisodeService, "updateIncidentCount")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentEpisodeService, "updateLastIncidentAddedAt")
      .mockResolvedValue(undefined as never);
    // Removed from its only episode.
    jest
      .spyOn(IncidentEpisodeMemberService, "findOneBy")
      .mockResolvedValue(null);
  }

  function member(): IncidentEpisodeMember {
    const created: IncidentEpisodeMember = new IncidentEpisodeMember();
    created.projectId = PROJECT_ID;
    created.incidentId = INCIDENT_ID;
    created.incidentEpisodeId = EPISODE_ID;
    return created;
  }

  async function addToEpisode(): Promise<void> {
    await (
      IncidentEpisodeMemberService as unknown as {
        onCreateSuccess: OnCreateSuccess;
      }
    ).onCreateSuccess(
      { createBy: {} } as unknown as OnCreate<IncidentEpisodeMember>,
      member(),
    );
  }

  async function removeFromEpisode(): Promise<void> {
    await (
      IncidentEpisodeMemberService as unknown as {
        onDeleteSuccess: OnDeleteSuccess;
      }
    ).onDeleteSuccess(
      {
        deleteBy: {},
        carryForward: [member()],
      } as unknown as OnDelete<IncidentEpisodeMember>,
      [],
    );
  }

  test("adding an incident to an episode quotes both titles inertly", async () => {
    stubReads(HOSTILE_TITLE, HOSTILE_TITLE);

    await addToEpisode();

    expect(episodeFeedMarkdown()).toHaveLength(1);
    expect(incidentFeedMarkdown()).toHaveLength(1);
    expectTitleInert([...episodeFeedMarkdown(), ...incidentFeedMarkdown()]);

    // And the titles read as typed.
    for (const markdown of [
      ...episodeFeedMarkdown(),
      ...incidentFeedMarkdown(),
    ]) {
      expect(readText(markdown)).toContain(HOSTILE_TITLE);
    }
  });

  test("removing an incident from an episode quotes both titles inertly", async () => {
    stubReads(HOSTILE_TITLE, HOSTILE_TITLE);

    await removeFromEpisode();

    expect(episodeFeedMarkdown()).toHaveLength(1);
    expect(incidentFeedMarkdown()).toHaveLength(1);
    expectTitleInert([...episodeFeedMarkdown(), ...incidentFeedMarkdown()]);
  });

  test("an ordinary title reads exactly as typed", async () => {
    stubReads(ORDINARY_TITLE, ORDINARY_TITLE);

    await addToEpisode();

    expect(episodeFeedMarkdown()[0]).toBe(
      `**Incident INC-42** added to episode: ${ORDINARY_TITLE}`,
    );
    expect(incidentFeedMarkdown()[0]).toBe(
      `Added to **Episode EP-7**: ${ORDINARY_TITLE}`,
    );
  });

  test("an episode's Episode Created item quotes its title inertly", async () => {
    jest
      .spyOn(
        IncidentEpisodeWorkspaceMessages,
        "getIncidentEpisodeCreateMessageBlocks",
      )
      .mockResolvedValue([] as never);

    const episode: IncidentEpisode = episodeTitled(HOSTILE_TITLE);
    episode.description = "Grouped by the checkout rule.";

    await (
      IncidentEpisodeService as unknown as {
        createEpisodeCreatedFeed: (episode: IncidentEpisode) => Promise<void>;
      }
    ).createEpisodeCreatedFeed(episode);

    expect(episodeFeedMarkdown()).toHaveLength(1);
    expectTitleInert(episodeFeedMarkdown());
    expect(readText(episodeFeedMarkdown()[0]!)).toContain(HOSTILE_TITLE);
    // The description stays the Markdown it is.
    expect(episodeFeedMarkdown()[0]).toContain("Grouped by the checkout rule.");
  });
});

describe("the incident's updated feed item", () => {
  type OnUpdateSuccess = (
    onUpdate: OnUpdate<Incident>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<Incident>>;

  test("quotes a new title inertly", async () => {
    jest
      .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
      .mockReturnValue(undefined as never);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incidentTitled(HOSTILE_TITLE) as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString(DASHBOARD_LINK) as never);

    await (
      IncidentService as unknown as { onUpdateSuccess: OnUpdateSuccess }
    ).onUpdateSuccess(
      {
        updateBy: {
          query: { _id: INCIDENT_ID.toString() },
          data: { title: HOSTILE_TITLE },
          props: { tenantId: PROJECT_ID, userId: USER_ID },
        },
        carryForward: {},
      } as unknown as OnUpdate<Incident>,
      [INCIDENT_ID],
    );

    expect(incidentFeedMarkdown()).toHaveLength(1);
    expectTitleInert(incidentFeedMarkdown());
    expect(readText(incidentFeedMarkdown()[0]!)).toContain(HOSTILE_TITLE);
  });
});

describe("Microsoft Teams", () => {
  const databaseProps: DatabaseCommonInteractionProps = {
    tenantId: PROJECT_ID,
    userId: USER_ID,
  };

  test("the active incidents summary keeps the title inside its link", async () => {
    const state: IncidentState = new IncidentState();
    state._id = ObjectID.generate().toString();
    state.name = "Investigating";

    const incident: Incident = incidentTitled(HOSTILE_TITLE);
    incident.currentIncidentState = state;

    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStates")
      .mockResolvedValue([state] as never);
    jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([incident] as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString(DASHBOARD_LINK) as never);

    const message: string = await (
      MicrosoftTeamsUtil as unknown as {
        getActiveIncidentsMessage: (projectId: ObjectID) => Promise<string>;
      }
    ).getActiveIncidentsMessage(PROJECT_ID);

    expectTitleInert([message]);

    // The one link for the incident goes to the dashboard, title and all.
    const incidentLinks: Array<Tokens.Link> = tokensOf(message).filter(
      (token: Token): boolean => {
        return (
          token.type === "link" &&
          (token as Tokens.Link).text.startsWith("Incident INC-42")
        );
      },
    ) as Array<Tokens.Link>;

    expect(incidentLinks).toHaveLength(1);
    expect(incidentLinks[0]!.href).toBe(DASHBOARD_LINK);
    expect(readText(incidentLinks[0]!.raw)).toContain(HOSTILE_TITLE);
  });

  test("the bot's incident details quote the title inertly", async () => {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incidentTitled(HOSTILE_TITLE) as never);

    const turnContext: TurnContext = createTurnContext();

    await MicrosoftTeamsIncidentActions.handleBotIncidentAction({
      actionType: MicrosoftTeamsIncidentActionType.ViewIncident,
      actionValue: INCIDENT_ID.toString(),
      value: {},
      projectId: PROJECT_ID,
      oneUptimeUserId: USER_ID,
      databaseProps: databaseProps,
      turnContext: turnContext,
    });

    expect(sentText(turnContext)).toContain("**Title:**");
    expectTitleInert([sentText(turnContext)]);
    expect(readText(sentText(turnContext))).toContain(HOSTILE_TITLE);
  });

  test("the bot's episode details quote the title inertly", async () => {
    jest
      .spyOn(IncidentEpisodeService, "findOneBy")
      .mockResolvedValue(episodeTitled(HOSTILE_TITLE) as never);

    const turnContext: TurnContext = createTurnContext();

    await MicrosoftTeamsIncidentEpisodeActions.handleBotIncidentEpisodeAction({
      actionType: MicrosoftTeamsIncidentEpisodeActionType.ViewIncidentEpisode,
      actionValue: EPISODE_ID.toString(),
      value: {},
      projectId: PROJECT_ID,
      oneUptimeUserId: USER_ID,
      databaseProps: databaseProps,
      turnContext: turnContext,
    });

    expect(sentText(turnContext)).toContain("**Title:**");
    expectTitleInert([sentText(turnContext)]);
    expect(readText(sentText(turnContext))).toContain(HOSTILE_TITLE);
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
  ): Promise<Array<string>> {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.example/dashboard") as never,
      );

    const blocks: Array<WorkspaceMessageBlock> = [];

    await (
      WorkspaceNotificationSummaryService as unknown as {
        buildIncidentBlocks: BuildBlocks;
      }
    ).buildIncidentBlocks({
      blocks: blocks,
      items: [WorkspaceNotificationSummaryItem.ListWithLinks],
      type: type,
      fromDate: new Date("2026-09-01T00:00:00.000Z"),
      projectId: PROJECT_ID,
    });

    return markdownOf(blocks);
  }

  test("an incident's line keeps its title inside the link", async () => {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "Critical";

    const incident: Incident = incidentTitled(HOSTILE_TITLE);
    incident.incidentSeverity = severity;

    jest
      .spyOn(IncidentService, "findAllBy")
      .mockResolvedValue([incident] as never);

    const markdown: Array<string> = await summaryOf(
      WorkspaceNotificationSummaryType.Incident,
    );
    const line: string = markdown.find((text: string): boolean => {
      return text.includes("INC-42");
    })!;

    expectTitleInert([line]);
    expect(readText(line)).toContain(HOSTILE_TITLE);
  });

  test("an episode's line keeps its title inside the link", async () => {
    jest
      .spyOn(IncidentEpisodeService, "findAllBy")
      .mockResolvedValue([episodeTitled(HOSTILE_TITLE)] as never);

    const markdown: Array<string> = await summaryOf(
      WorkspaceNotificationSummaryType.IncidentEpisode,
    );
    const line: string = markdown.find((text: string): boolean => {
      return text.includes("tracker.example");
    })!;

    expectTitleInert([line]);
    expect(readText(line)).toContain(HOSTILE_TITLE);
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

  test("a new incident's message quotes its title inertly", async () => {
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString(DASHBOARD_LINK) as never);

    const markdown: string = markdownOf(
      await UserNotificationRuleService.generateWorkspaceMessageBlocksForIncidentCreated(
        incidentTitled(HOSTILE_TITLE),
        ObjectID.generate(),
      ),
    );

    expectTitleInert([markdown]);
    expect(readText(markdown)).toContain(`INC-42 — ${HOSTILE_TITLE}`);
  });

  test("a new episode's message quotes its title inertly", async () => {
    jest
      .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
      .mockResolvedValue(URL.fromString(DASHBOARD_LINK) as never);

    const markdown: string = markdownOf(
      await UserNotificationRuleService.generateWorkspaceMessageBlocksForIncidentEpisodeCreated(
        episodeTitled(HOSTILE_TITLE),
        ObjectID.generate(),
      ),
    );

    expectTitleInert([markdown]);
    expect(readText(markdown)).toContain(`EP-7 — ${HOSTILE_TITLE}`);
  });

  test("an ordinary title reads exactly as typed", async () => {
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString(DASHBOARD_LINK) as never);

    const markdown: string = markdownOf(
      await UserNotificationRuleService.generateWorkspaceMessageBlocksForIncidentCreated(
        incidentTitled(ORDINARY_TITLE),
        ObjectID.generate(),
      ),
    );

    expect(markdown).toContain(`📋 **INC-42 — ${ORDINARY_TITLE}**`);
  });
});
