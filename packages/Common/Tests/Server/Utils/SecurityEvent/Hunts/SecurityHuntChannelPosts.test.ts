import SecurityHuntNotifications, {
  SecurityHuntFoundFacts,
  buildHuntFoundChannelMarkdown,
  buildHuntFoundChannelText,
} from "../../../../../Server/Utils/SecurityEvent/Hunts/SecurityHuntNotifications";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import AccessTokenService from "../../../../../Server/Services/AccessTokenService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import SecurityHuntService from "../../../../../Server/Services/SecurityHuntService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import UserNotificationSettingService from "../../../../../Server/Services/UserNotificationSettingService";
import WorkspaceNotificationRuleService from "../../../../../Server/Services/WorkspaceNotificationRuleService";
import logger from "../../../../../Server/Utils/Logger";
import WorkspaceMessageTime from "../../../../../Server/Utils/Workspace/WorkspaceMessageTime";
import Project from "../../../../../Models/DatabaseModels/Project";
import SecurityHunt from "../../../../../Models/DatabaseModels/SecurityHunt";
import User from "../../../../../Models/DatabaseModels/User";
import URL from "../../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../../../Types/Email";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import {
  SecurityHuntRunWindow,
  SecurityHuntSchedule,
} from "../../../../../Types/SecurityEvent/SecurityHunt";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT A HUNT FINDS, IN SLACK AND MICROSOFT TEAMS (SecurityHuntNotifications).
 *
 * Each time a scheduled run finds events, besides the people the hunt names,
 * the find is posted to the channels and chats of the project's Security
 * Hunt rules that match the hunt - the workspace rules security cases are
 * posted by (WorkspaceNotificationRuleService, notificationFor
 * securityHuntId), never a path of its own. The post says what a
 * notification says - the hunt (linked to its page on the run's window), its
 * search, how many events and when they arrived, each moment in the
 * reader's own time - and none of an event's own words. It goes whether or
 * not any person could be told, and a post that fails never fails the job:
 * the people were told already.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const HUNT_ID: ObjectID = new ObjectID("3b000000-0000-4000-8000-000000000001");
const MAYA: ObjectID = new ObjectID("80000000-0000-4000-8000-000000000001");
const DASHBOARD: string = "https://oneuptime.acme-commerce.example/dashboard";

const WINDOW: SecurityHuntRunWindow = {
  startTime: new Date("2026-10-28T10:00:00.000Z"),
  endTime: new Date("2026-10-29T10:00:00.000Z"),
};

const URL_ON_WINDOW: string = `${DASHBOARD}/${PROJECT_ID.toString()}/security-events/hunts/${HUNT_ID.toString()}?range=Custom&start=2026-10-28T10%3A00%3A00.000Z&end=2026-10-29T10%3A00%3A00.000Z`;

function facts(
  values: Partial<SecurityHuntFoundFacts> = {},
): SecurityHuntFoundFacts {
  return {
    huntId: HUNT_ID,
    projectId: PROJECT_ID,
    huntName: "Encoded PowerShell",
    searchQuery: "processname:powershell.exe commandline:-enc",
    filterCount: 0,
    projectName: "Acme Commerce",
    url: URL_ON_WINDOW,
    eventCount: 3,
    startTime: WINDOW.startTime,
    endTime: WINDOW.endTime,
    ...values,
  };
}

describe("what a channel is told", () => {
  test("the headline, the hunt linked to its page on the run's window, its search, and the window in each reader's time", () => {
    const markdown: string = buildHuntFoundChannelMarkdown(facts()).toString();
    const paragraphs: Array<string> = markdown.split("\n\n");

    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[0]).toBe("🔎 **Hunt found 3 security events**");
    expect(paragraphs[1]).toBe(`**[Encoded PowerShell](${URL_ON_WINDOW})**`);
    expect(paragraphs[2]).toBe(
      "Search: `processname:powershell.exe commandline:-enc`",
    );
    // Each moment as both workspaces show it in the reader's own zone and clock.
    expect(paragraphs[3]).toBe(
      `Events from ${WorkspaceMessageTime.dateAndTime(WINDOW.startTime).toString()} to ${WorkspaceMessageTime.dateAndTime(WINDOW.endTime).toString()}`,
    );
  });

  test("counts one event in the singular, and the filters a hunt keeps beside its search", () => {
    const markdown: string = buildHuntFoundChannelMarkdown(
      facts({ eventCount: 1, filterCount: 2 }),
    ).toString();

    expect(markdown).toContain("🔎 **Hunt found 1 security event**");
    expect(markdown).toContain(
      "Search: `processname:powershell.exe commandline:-enc` and 2 filters",
    );
  });

  test("a hunt saved from a sidebar click alone is its filters", () => {
    const markdown: string = buildHuntFoundChannelMarkdown(
      facts({ searchQuery: "", filterCount: 1 }),
    ).toString();

    expect(markdown).toContain("Search: 1 filter");
    expect(markdown).not.toContain("``");
  });

  test("the hunt's name and search are the team's words, placed where they sit: no Markdown of theirs takes effect", () => {
    const paragraphs: Array<string> = buildHuntFoundChannelMarkdown(
      facts({
        huntName: "*Admin* [sign-ins](https://evil.example) _now_",
        searchQuery: "message:`whoami`",
      }),
    )
      .toString()
      .split("\n\n");

    // The name is the link's words, escaped: no second link, no emphasis.
    expect(paragraphs[1]).toBe(
      `**[\\*Admin\\* \\[sign-ins\\]\\(https://evil.example\\) \\_now\\_](${URL_ON_WINDOW})**`,
    );
    // A search with backticks stays one code span, exactly as written.
    expect(paragraphs[2]).toBe("Search: `` message:`whoami` ``");
  });

  test("a name that reads like a mention is text, never a ping to the channel", () => {
    const markdown: string = buildHuntFoundChannelMarkdown(
      facts({ huntName: "<!channel> admins" }),
    ).toString();

    expect(markdown).not.toContain("<!channel>");
    expect(markdown).toContain("!channel> admins](");
  });

  test("the notification a phone shows: the find, then the hunt", () => {
    expect(buildHuntFoundChannelText(facts())).toBe(
      "Hunt found 3 security events: Encoded PowerShell",
    );
    expect(buildHuntFoundChannelText(facts({ eventCount: 1 }))).toBe(
      "Hunt found 1 security event: Encoded PowerShell",
    );
  });
});

describe("posted to the hunt's channels", () => {
  let post: Spy;

  beforeEach(() => {
    post = getJestSpyOn(
      WorkspaceNotificationRuleService,
      "sendWorkspaceMarkdownNotification",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("through the workspace rules, for the hunt - never a path of its own", async () => {
    await expect(
      SecurityHuntNotifications.postToChannels(facts()),
    ).resolves.toBe(true);

    expect(post).toHaveBeenCalledTimes(1);

    const call: Record<string, unknown> = post.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(call["projectId"]).toEqual(PROJECT_ID);
    // Only the hunt: the rules that match it are its Security Hunt rules.
    expect(call["notificationFor"]).toEqual({ securityHuntId: HUNT_ID });
    expect(call["feedInfoInMarkdown"]).toBe(
      buildHuntFoundChannelMarkdown(facts()).toString(),
    );
    expect(call["notificationText"]).toBe(
      "Hunt found 3 security events: Encoded PowerShell",
    );
    // OneUptime posts it: no person did what it says.
    expect(call["workspaceNotification"]).toEqual({
      sendWorkspaceNotification: true,
    });
  });

  test("a post that fails is logged, and never throws: the people were told already", async () => {
    post.mockRejectedValue(new Error("Slack is down") as never);

    await expect(
      SecurityHuntNotifications.postToChannels(facts()),
    ).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("a run that found events, posted", () => {
  let post: Spy;
  let send: Spy;
  let findHunt: Spy;

  function storedHunt(
    values: Partial<Record<string, unknown>> = {},
  ): SecurityHunt {
    const model: SecurityHunt = new SecurityHunt();
    model._id = HUNT_ID.toString();
    model.projectId = PROJECT_ID;
    model.name = "Encoded PowerShell";
    model.searchQuery = "processname:powershell.exe commandline:-enc";
    model.filters = {};
    model.schedule = SecurityHuntSchedule.EveryDay;
    const maya: User = new User();
    maya._id = MAYA.toString();
    maya.name = new Name("Maya Chen");
    maya.email = new Email("maya@acme-commerce.example");
    model.notifyUsers = [maya];
    model.notifyTeams = [];
    Object.assign(model, values);
    return model;
  }

  beforeEach(() => {
    getJestSpyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(
      (async (): Promise<URL> => {
        return URL.fromString(DASHBOARD);
      }) as never,
    );
    findHunt = getJestSpyOn(SecurityHuntService, "findOneBy").mockResolvedValue(
      storedHunt() as never,
    );
    const project: Project = new Project();
    project.name = "Acme Commerce";
    getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
      project as never,
    );
    getJestSpyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);
    getJestSpyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    ).mockResolvedValue({
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: [Permission.ProjectUser, Permission.SecurityViewer].map(
            (permission: Permission) => {
              return { _type: "UserPermission", permission, labelIds: [] };
            },
          ),
        },
      },
    } as unknown as DatabaseCommonInteractionProps as never);
    getJestSpyOn(
      UserNotificationSettingService,
      "addSecurityHuntNotificationSettings",
    ).mockResolvedValue(undefined as never);
    send = getJestSpyOn(
      UserNotificationSettingService,
      "sendUserNotification",
    ).mockResolvedValue(undefined as never);
    post = getJestSpyOn(
      WorkspaceNotificationRuleService,
      "sendWorkspaceMarkdownNotification",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function notify(): Promise<number> {
    return (
      await SecurityHuntNotifications.notifyHuntFound({
        projectId: PROJECT_ID,
        securityHuntId: HUNT_ID,
        eventCount: 3,
        window: WINDOW,
      })
    ).length;
  }

  test("tells the people first, then posts once, with the hunt's page on the run's window", async () => {
    const order: Array<string> = [];

    send.mockImplementation((async () => {
      order.push("person");
    }) as never);
    post.mockImplementation((async () => {
      order.push("channels");
    }) as never);

    expect(await notify()).toBe(1);
    expect(order).toEqual(["person", "channels"]);

    const markdown: string = (
      post.mock.calls[0]![0] as { feedInfoInMarkdown: string }
    ).feedInfoInMarkdown;

    expect(markdown).toContain("**[Encoded PowerShell](");
    expect(markdown).toContain(
      `/security-events/hunts/${HUNT_ID.toString()}?range=Custom`,
    );
  });

  test("posts as the hunt is now: a renamed hunt by its new name", async () => {
    findHunt.mockResolvedValue(
      storedHunt({ name: "Encoded PowerShell on web" }) as never,
    );

    await notify();

    expect(
      (post.mock.calls[0]![0] as { notificationText: string }).notificationText,
    ).toBe("Hunt found 3 security events: Encoded PowerShell on web");
  });

  test("posts even when nobody it names may be told: a channel's rule chose to hear", async () => {
    findHunt.mockResolvedValue(storedHunt({ notifyUsers: [] }) as never);

    expect(await notify()).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("posts nothing for a hunt deleted, or taken off its schedule, since it ran", async () => {
    findHunt.mockResolvedValue(null as never);
    await notify();

    findHunt.mockResolvedValue(
      storedHunt({ schedule: SecurityHuntSchedule.NotScheduled }) as never,
    );
    await notify();

    expect(post).not.toHaveBeenCalled();
  });

  test("a post that fails takes nothing from the people told", async () => {
    post.mockRejectedValue(new Error("Teams answered 502") as never);

    expect(await notify()).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("no event's own words travel: only what the hunt and its run are", async () => {
    await notify();

    const call: { feedInfoInMarkdown: string; notificationText: string } = post
      .mock.calls[0]![0] as {
      feedInfoInMarkdown: string;
      notificationText: string;
    };

    for (const text of [call.feedInfoInMarkdown, call.notificationText]) {
      // The hunt's name, its search, the count, the window - and nothing a matched event said.
      expect(text).not.toMatch(/message:|principalUser|commandLine=/);
    }
  });
});
