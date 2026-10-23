import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsInstalledTeam,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import Project from "../../../Models/DatabaseModels/Project";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Sleep from "../../../Types/Sleep";
import {
  CONNECT_ACCOUNT_QUERY_PARAM,
  CONNECT_ACCOUNT_QUERY_VALUE,
} from "../../../Types/Workspace/ConnectCallback";
import WorkspaceAskToConnectUtil, {
  WORKSPACE_ASK_TO_CONNECT_AGAIN_AFTER_HOURS,
  WORKSPACE_ASK_TO_CONNECT_MAX_NAMED,
  WorkspaceAskToConnectRun,
  WorkspaceAskToConnectState,
  WorkspaceAskToConnectStatus,
} from "../../../Types/Workspace/WorkspaceAskToConnect";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../../Types/Workspace/WorkspaceType";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import DatabaseConfig from "../../DatabaseConfig";
import GlobalCache from "../../Infrastructure/GlobalCache";
import ProjectService from "../../Services/ProjectService";
import TeamMemberService from "../../Services/TeamMemberService";
import UserService from "../../Services/UserService";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../Services/WorkspaceUserAuthTokenService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsRosterMember,
} from "./MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "./Slack/Slack";
import SlackChannelMembers, {
  SlackChannelMembersError,
  SlackPersonFacts,
} from "./Slack/SlackChannelMembers";
import WorkspaceHome, { WORKSPACE_HOME_TEXT } from "./WorkspaceHome";

/*
 * ASKING EVERY MEMBER OF A PROJECT TO CONNECT THEIR CHAT ACCOUNT, AT ONCE.
 *
 * A Slack or Microsoft Teams account is connected to a member only by the
 * member signing in to it (WorkspaceUserAuthToken): nobody connects somebody
 * else's, an admin included. With hundreds of people to bring in, an admin
 * asks them all instead, from Project Settings > Workspace > Slack or
 * Microsoft Teams:
 *
 *   1. Every member of the project whose account in the workspace is not
 *      connected, and who was not asked in the last day, is to be asked.
 *   2. Each is looked for in the workspace by their OneUptime email address:
 *      in Slack among the workspace's people, in Microsoft Teams in the
 *      rosters of the teams OneUptime's app is installed in - the people its
 *      bot can message. Nobody with that address, a bot or a deactivated
 *      account: not found, and named on the page.
 *   3. Each one found gets a direct message from OneUptime's bot: who asked,
 *      what connecting does, and a Connect button - the link to their own
 *      settings in OneUptime that connects their account in one click
 *      (`?connectAccount=true`). It carries no token and never expires, so
 *      it connects only the account of whoever signs in with it.
 *
 * The email address only decides whom to message. The account is connected
 * by its own sign-in, as ever, so a message read by the wrong person
 * connects nothing of theirs to the member.
 *
 * A thousand messages take minutes inside the chats' rate limits, so asking
 * goes on after the request answers, on the server that took it - one run
 * per project and workspace at a time, under a lock that server keeps
 * extending. How far it got is kept in the cache for the page to read. A
 * server that stops half way lets its lock run out: the page says the run
 * stopped, and asking again goes on with whoever was not asked yet.
 */

// The roles that may ask everybody: the ones that may uninstall the app.
export const WORKSPACE_ASK_TO_CONNECT_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

export const WORKSPACE_ASK_TO_CONNECT_PERMISSION_MESSAGE: string =
  "Only a project owner or admin can ask the project's members to connect their accounts.";

export const WORKSPACE_ASK_TO_CONNECT_ALREADY_ASKING_MESSAGE: string =
  "OneUptime is already asking this project's members to connect their accounts. Wait for it to finish.";

// The last run, for the page: by project and workspace.
const RUN_NAMESPACE: string = "workspace-ask-to-connect-run";
// Held while a server is asking.
const LOCK_NAMESPACE: string = "workspace-ask-to-connect-lock";
// Who was asked lately: by project, workspace and member.
const ASKED_NAMESPACE: string = "workspace-ask-to-connect-asked";

// How long the page can show the last run.
const RUN_KEPT_FOR_SECONDS: number = 7 * 24 * 60 * 60;

/*
 * How long the lock outlives the last sign of life of the server asking. It
 * is extended before every person, and before every wait for a busy Slack.
 */
const LOCK_SECONDS: number = 3 * 60;

/*
 * The pause after each message: about four a second, inside Slack's limit
 * for a workspace and the Bot Connector's for a tenant.
 */
export const WORKSPACE_ASK_TO_CONNECT_PAUSE_MS: number = 250;

/*
 * Slack: up to this many people are looked up one by one
 * (users.lookupByEmail); more, by reading the workspace's people page by
 * page (users.list), 200 at a time.
 */
export const SLACK_LOOKUP_ONE_BY_ONE_MAX: number = 20;

// The most pages of a workspace's people read: 100,000 people.
const SLACK_MAX_PEOPLE_PAGES: number = 500;

// How often a busy Slack is asked again, waiting longer each time.
const SLACK_BUSY_TRIES: number = 5;
export const SLACK_BUSY_WAIT_MS: number = 30 * 1000;

// A member to ask, as the run knows them.
export interface WorkspaceAskToConnectPerson {
  userId: ObjectID;
  // Their id, lower-cased: what the run keys people by.
  key: string;
  name: string;
  email: string;
}

// The direct message, and what its notification says.
export interface WorkspaceAskToConnectMessage {
  blocks: Array<WorkspaceMessageBlock>;
  text: string;
}

export default class WorkspaceAskToConnect {
  /*
   * How many members the project has, how many of them have connected, and
   * the last run - Stopped when it says it is asking but nobody holds its
   * lock any more.
   */
  @CaptureSpan()
  public static async getStatus(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<WorkspaceAskToConnectStatus> {
    const memberIds: Array<string> = await WorkspaceAskToConnect.getMemberIds(
      data.projectId,
    );

    const connected: Set<string> =
      await WorkspaceAskToConnect.getConnectedUserIds(data);

    return {
      memberCount: memberIds.length,
      connectedCount: memberIds.filter((memberId: string): boolean => {
        return connected.has(memberId);
      }).length,
      run: await WorkspaceAskToConnect.readRun(data),
    };
  }

  /*
   * Asks every member who has not connected and was not asked lately (see
   * the header), and answers at once with who it set out to ask; the
   * messages go on being sent after the answer. Throws when the workspace is
   * not connected, or when a run is asking already.
   */
  @CaptureSpan()
  public static async start(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    askedByUserId: ObjectID;
  }): Promise<WorkspaceAskToConnectStatus> {
    const workspaceName: string = getWorkspaceTypeDisplayName(
      data.workspaceType,
    );

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      });

    if (!projectAuth) {
      throw new BadDataException(
        `${workspaceName} is not connected to this project. Connect it first.`,
      );
    }

    const key: string = WorkspaceAskToConnect.getRunKey(data);
    const holder: string = ObjectID.generate().toString();

    const isFirst: boolean = await GlobalCache.setStringIfNotExists(
      LOCK_NAMESPACE,
      key,
      holder,
      { expiresInSeconds: LOCK_SECONDS },
    );

    if (!isFirst) {
      throw new BadDataException(
        WORKSPACE_ASK_TO_CONNECT_ALREADY_ASKING_MESSAGE,
      );
    }

    let memberIds: Array<string>;
    let connected: Set<string>;
    let people: Array<WorkspaceAskToConnectPerson>;
    let run: WorkspaceAskToConnectRun;

    try {
      memberIds = await WorkspaceAskToConnect.getMemberIds(data.projectId);
      connected = await WorkspaceAskToConnect.getConnectedUserIds(data);

      const notConnected: Array<string> = memberIds.filter(
        (memberId: string): boolean => {
          return !connected.has(memberId);
        },
      );

      const askedLately: Set<string> =
        await WorkspaceAskToConnect.getAskedLately({
          ...data,
          userIds: notConnected,
        });

      people = await WorkspaceAskToConnect.getPeople(
        notConnected.filter((memberId: string): boolean => {
          return !askedLately.has(memberId);
        }),
      );

      const now: string = OneUptimeDate.getCurrentDate().toISOString();

      run = {
        state:
          people.length > 0
            ? WorkspaceAskToConnectState.Asking
            : WorkspaceAskToConnectState.Done,
        startedAt: now,
        finishedAt: people.length > 0 ? undefined : now,
        askedByName: await WorkspaceAskToConnect.getName(data.askedByUserId),
        toAskCount: people.length,
        askedCount: 0,
        notFoundCount: 0,
        failedCount: 0,
        notFoundNames: [],
      };

      await WorkspaceAskToConnect.writeRun({ ...data, run: run });
    } catch (err) {
      await WorkspaceAskToConnect.releaseLock({ key: key, holder: holder });
      throw err;
    }

    if (run.state === WorkspaceAskToConnectState.Asking) {
      // Minutes of messages: they go on after the request answers.
      WorkspaceAskToConnect.ask({
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        projectAuth: projectAuth,
        people: people,
        run: { ...run, notFoundNames: [...run.notFoundNames] },
        holder: holder,
      }).catch((err: unknown) => {
        logger.error(
          "Asking a project's members to connect their accounts stopped.",
          { projectId: data.projectId.toString() },
        );
        logger.error(err, { projectId: data.projectId.toString() });
      });
    } else {
      await WorkspaceAskToConnect.releaseLock({ key: key, holder: holder });
    }

    return {
      memberCount: memberIds.length,
      connectedCount: memberIds.filter((memberId: string): boolean => {
        return connected.has(memberId);
      }).length,
      run: run,
    };
  }

  /*
   * Finds the people in the workspace and messages each one found, keeping
   * the run up to date in the cache as it goes. Never throws for a person:
   * a message the workspace refuses is counted, and the rest go on.
   */
  public static async ask(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    projectAuth: WorkspaceProjectAuthToken;
    people: Array<WorkspaceAskToConnectPerson>;
    run: WorkspaceAskToConnectRun;
    holder: string;
  }): Promise<void> {
    const run: WorkspaceAskToConnectRun = data.run;
    const key: string = WorkspaceAskToConnect.getRunKey(data);

    const keepLock: () => Promise<void> = async (): Promise<void> => {
      await WorkspaceAskToConnect.keepLock(key);
    };

    try {
      const accounts: Map<string, string> =
        await WorkspaceAskToConnect.findAccounts({
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          authToken: data.projectAuth.authToken || "",
          people: data.people,
          keepLock: keepLock,
        });

      const message: WorkspaceAskToConnectMessage =
        WorkspaceAskToConnect.getMessage({
          workspaceType: data.workspaceType,
          askedByName: run.askedByName,
          projectName: await WorkspaceAskToConnect.getProjectName(
            data.projectId,
          ),
          connectUrl: await WorkspaceAskToConnect.getConnectUrl({
            projectId: data.projectId,
            workspaceType: data.workspaceType,
          }),
        });

      for (const person of data.people) {
        await keepLock();

        const workspaceUserId: string | undefined = accounts.get(person.key);

        if (!workspaceUserId) {
          run.notFoundCount++;

          if (run.notFoundNames.length < WORKSPACE_ASK_TO_CONNECT_MAX_NAMED) {
            run.notFoundNames.push(person.name || person.email);
          }

          await WorkspaceAskToConnect.writeRun({ ...data, run: run });
          continue;
        }

        try {
          await WorkspaceAskToConnect.sendMessage({
            projectId: data.projectId,
            workspaceType: data.workspaceType,
            authToken: data.projectAuth.authToken || "",
            workspaceUserId: workspaceUserId,
            message: message,
          });

          run.askedCount++;

          await WorkspaceAskToConnect.markAsked({
            projectId: data.projectId,
            workspaceType: data.workspaceType,
            userKey: person.key,
          });
        } catch (err) {
          run.failedCount++;
          logger.error(
            "The workspace refused the message asking a member to connect their account.",
            { projectId: data.projectId.toString() },
          );
          logger.error(err, { projectId: data.projectId.toString() });
        }

        await WorkspaceAskToConnect.writeRun({ ...data, run: run });
        await Sleep.sleep(WORKSPACE_ASK_TO_CONNECT_PAUSE_MS);
      }
    } catch (err) {
      // Nobody could be looked up: whoever was not asked yet was not asked.
      run.failedCount = Math.max(
        0,
        run.toAskCount - run.askedCount - run.notFoundCount,
      );
      logger.error(
        "Could not look up a project's members in the workspace to ask them to connect.",
        { projectId: data.projectId.toString() },
      );
      logger.error(err, { projectId: data.projectId.toString() });
    } finally {
      run.state = WorkspaceAskToConnectState.Done;
      run.finishedAt = OneUptimeDate.getCurrentDate().toISOString();

      await WorkspaceAskToConnect.writeRun({ ...data, run: run });
      await WorkspaceAskToConnect.releaseLock({
        key: key,
        holder: data.holder,
      });
    }
  }

  /*
   * The direct message (see the header). Names are text: a person's and a
   * project's names are theirs to set. Without a dashboard address to link
   * to, it says where in OneUptime to connect instead of drawing a button.
   */
  public static getMessage(data: {
    workspaceType: WorkspaceType;
    askedByName: string;
    projectName: string;
    connectUrl: string | null;
  }): WorkspaceAskToConnectMessage {
    const productName: string = ProductBrandingText.getProductName();
    const workspaceName: string = getWorkspaceTypeDisplayName(
      data.workspaceType,
    );

    const askedBy: MarkdownText = data.askedByName
      ? mdText`**${data.askedByName}**`
      : mdText`A project admin`;

    const inProject: MarkdownText = data.projectName
      ? mdText` in the **${data.projectName}** project`
      : mdText``;

    const blocks: Array<WorkspaceMessageBlock> = [
      WorkspaceAskToConnect.markdown(
        mdText`👋 ${askedBy} asks you to connect your ${workspaceName} account to ${productName}${inProject}.`,
      ),
      WorkspaceAskToConnect.markdown(
        mdText`Once it is connected, ${productName}'s buttons and commands in ${workspaceName} act as you, with your permissions in the project: acknowledge and resolve incidents, add notes and page people without leaving ${workspaceName}.`,
      ),
    ];

    if (data.connectUrl) {
      blocks.push(
        WorkspaceAskToConnect.markdown(
          mdText`It takes one click: sign in to ${productName} if it asks, then allow ${workspaceName}.`,
        ),
      );

      blocks.push({
        _type: "WorkspacePayloadButtons",
        buttons: [
          {
            _type: "WorkspaceMessagePayloadButton",
            title: WORKSPACE_HOME_TEXT.connect[data.workspaceType],
            value: "",
            actionId: WorkspaceHome.CONNECT_ACTION_ID,
            url: URL.fromString(data.connectUrl),
            isPrimary: true,
          },
        ],
      } as WorkspacePayloadButtons);
    } else {
      blocks.push(
        WorkspaceAskToConnect.markdown(
          mdText`In ${productName}, go to **User Settings → Workspace → ${workspaceName}** and press **Connect my account with ${workspaceName}**.`,
        ),
      );
    }

    return {
      blocks: blocks,
      text: `You're asked to connect your ${workspaceName} account to ${productName}.`,
    };
  }

  /*
   * The member's own settings page for the workspace, which connects their
   * account in one click when opened with `?connectAccount=true`. Null
   * without a dashboard address.
   */
  public static async getConnectUrl(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<string | null> {
    const page: string =
      data.workspaceType === WorkspaceType.MicrosoftTeams
        ? "microsoft-teams-integration"
        : "slack-integration";

    try {
      const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

      return URL.fromString(dashboardUrl.toString())
        .addRoute(`/${data.projectId.toString()}/user-settings/${page}`)
        .addQueryParam(CONNECT_ACCOUNT_QUERY_PARAM, CONNECT_ACCOUNT_QUERY_VALUE)
        .toString();
    } catch (err) {
      logger.debug("No dashboard address for the Connect button.");
      logger.debug(err);
      return null;
    }
  }

  /*
   * The workspace account of each person found, by the person's key: in
   * Slack, by their email address; in Microsoft Teams, by their email
   * address or user principal name in the rosters of the teams the app is
   * installed in.
   */
  public static async findAccounts(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    authToken: string;
    people: Array<WorkspaceAskToConnectPerson>;
    keepLock: () => Promise<void>;
  }): Promise<Map<string, string>> {
    // Who each address belongs to, lower-cased.
    const wanted: Map<string, string> = new Map<string, string>();

    for (const person of data.people) {
      const email: string = person.email.trim().toLowerCase();

      if (email) {
        wanted.set(email, person.key);
      }
    }

    if (wanted.size === 0) {
      return new Map<string, string>();
    }

    if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
      return await WorkspaceAskToConnect.findMicrosoftTeamsAccounts({
        projectId: data.projectId,
        wanted: wanted,
      });
    }

    return await WorkspaceAskToConnect.findSlackAccounts({
      authToken: data.authToken,
      wanted: wanted,
      keepLock: data.keepLock,
    });
  }

  private static async findSlackAccounts(data: {
    authToken: string;
    wanted: Map<string, string>;
    keepLock: () => Promise<void>;
  }): Promise<Map<string, string>> {
    const found: Map<string, string> = new Map<string, string>();

    const take: (person: SlackPersonFacts | null) => void = (
      person: SlackPersonFacts | null,
    ): void => {
      if (!person || person.isBot || person.isDeactivated) {
        return;
      }

      const key: string | undefined = data.wanted.get(
        person.email.trim().toLowerCase(),
      );

      if (key && !found.has(key)) {
        found.set(key, person.id);
      }
    };

    if (data.wanted.size <= SLACK_LOOKUP_ONE_BY_ONE_MAX) {
      for (const email of data.wanted.keys()) {
        take(
          await WorkspaceAskToConnect.whenSlackAnswers({
            call: () => {
              return SlackChannelMembers.findPersonByEmail({
                authToken: data.authToken,
                email: email,
              });
            },
            keepLock: data.keepLock,
          }),
        );
      }

      return found;
    }

    let cursor: string = "";
    let pages: number = 0;

    do {
      // The page asked for, as it was when asked: a retry asks for it again.
      const pageCursor: string = cursor;

      const page: { people: Array<SlackPersonFacts>; nextCursor: string } =
        await WorkspaceAskToConnect.whenSlackAnswers({
          call: () => {
            return SlackChannelMembers.getPeoplePage({
              authToken: data.authToken,
              cursor: pageCursor,
            });
          },
          keepLock: data.keepLock,
        });

      for (const person of page.people) {
        take(person);
      }

      cursor = page.nextCursor;
      pages++;
    } while (
      cursor &&
      found.size < data.wanted.size &&
      pages < SLACK_MAX_PEOPLE_PAGES
    );

    return found;
  }

  /*
   * A Slack call, asked again - after a longer wait each time - while Slack
   * says it is busy (its rate limit, an outage). Anything else it answers is
   * thrown.
   */
  private static async whenSlackAnswers<T>(data: {
    call: () => Promise<T>;
    keepLock: () => Promise<void>;
  }): Promise<T> {
    for (let attempt: number = 1; ; attempt++) {
      try {
        return await data.call();
      } catch (err) {
        if (
          attempt >= SLACK_BUSY_TRIES ||
          !SlackChannelMembersError.isUnavailable(err)
        ) {
          throw err;
        }

        await data.keepLock();
        await Sleep.sleep(SLACK_BUSY_WAIT_MS * attempt);
        await data.keepLock();
      }
    }
  }

  private static async findMicrosoftTeamsAccounts(data: {
    projectId: ObjectID;
    wanted: Map<string, string>;
  }): Promise<Map<string, string>> {
    const found: Map<string, string> = new Map<string, string>();

    const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> =
      await MicrosoftTeamsUtil.getInstalledTeamsForProject({
        projectId: data.projectId,
      });

    for (const team of Object.values(installedTeams)) {
      if (!team.graphTeamId) {
        continue;
      }

      let roster: Array<MicrosoftTeamsRosterMember> | null = null;

      try {
        roster = await MicrosoftTeamsUtil.getTeamRoster({
          projectId: data.projectId,
          teamId: team.graphTeamId,
        });
      } catch (err) {
        logger.error(
          "Could not read a team's roster to find the project's members in Microsoft Teams.",
          { projectId: data.projectId.toString() },
        );
        logger.error(err, { projectId: data.projectId.toString() });
        continue;
      }

      for (const member of roster || []) {
        for (const address of [member.email, member.userPrincipalName]) {
          const key: string | undefined = data.wanted.get(
            address.trim().toLowerCase(),
          );

          if (key && !found.has(key)) {
            found.set(key, member.aadObjectId);
          }
        }
      }

      if (found.size >= data.wanted.size) {
        break;
      }
    }

    return found;
  }

  private static async sendMessage(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    authToken: string;
    workspaceUserId: string;
    message: WorkspaceAskToConnectMessage;
  }): Promise<void> {
    if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: data.projectId,
        workspaceUserId: data.workspaceUserId,
        messageBlocks: data.message.blocks,
        text: data.message.text,
      });
      return;
    }

    await SlackUtil.sendDirectMessageToUser({
      authToken: data.authToken,
      workspaceUserId: data.workspaceUserId,
      messageBlocks: data.message.blocks,
      text: data.message.text,
    });
  }

  // The members of the project - an accepted invitation to a team - by lower-cased id.
  private static async getMemberIds(
    projectId: ObjectID,
  ): Promise<Array<string>> {
    const members: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: projectId,
        hasAcceptedInvitation: true,
      },
      select: {
        userId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    const memberIds: Set<string> = new Set<string>();

    for (const member of members) {
      const memberId: string = member.userId?.toString().toLowerCase() || "";

      if (memberId) {
        memberIds.add(memberId);
      }
    }

    return Array.from(memberIds);
  }

  // The members whose account in the workspace is connected, by lower-cased id.
  private static async getConnectedUserIds(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<Set<string>> {
    const links: Array<WorkspaceUserAuthToken> =
      await WorkspaceUserAuthTokenService.findBy({
        query: {
          projectId: data.projectId,
          workspaceType: data.workspaceType,
        },
        select: {
          userId: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    const connected: Set<string> = new Set<string>();

    for (const link of links) {
      const userId: string = link.userId?.toString().toLowerCase() || "";

      if (userId) {
        connected.add(userId);
      }
    }

    return connected;
  }

  // The people to ask, with their names and email addresses.
  private static async getPeople(
    userIds: Array<string>,
  ): Promise<Array<WorkspaceAskToConnectPerson>> {
    if (userIds.length === 0) {
      return [];
    }

    const users: Array<User> = await UserService.findBy({
      query: {
        _id: QueryHelper.any(userIds),
      },
      select: {
        _id: true,
        name: true,
        email: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    return users
      .filter((user: User): boolean => {
        return Boolean(user.id);
      })
      .map((user: User): WorkspaceAskToConnectPerson => {
        return {
          userId: user.id!,
          key: user.id!.toString().toLowerCase(),
          name: user.name?.toString() || "",
          email: user.email?.toString() || "",
        };
      })
      .sort(
        (a: WorkspaceAskToConnectPerson, b: WorkspaceAskToConnectPerson) => {
          return (a.name || a.email).localeCompare(b.name || b.email);
        },
      );
  }

  // Whoever of `userIds` was asked lately (see WORKSPACE_ASK_TO_CONNECT_AGAIN_AFTER_HOURS).
  private static async getAskedLately(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    userIds: Array<string>;
  }): Promise<Set<string>> {
    const askedLately: Set<string> = new Set<string>();

    if (data.userIds.length === 0) {
      return askedLately;
    }

    const values: Array<string | null> = await GlobalCache.getStrings(
      ASKED_NAMESPACE,
      data.userIds.map((userId: string): string => {
        return WorkspaceAskToConnect.getAskedKey({ ...data, userKey: userId });
      }),
    );

    data.userIds.forEach((userId: string, index: number) => {
      if (values[index]) {
        askedLately.add(userId);
      }
    });

    return askedLately;
  }

  private static async markAsked(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    userKey: string;
  }): Promise<void> {
    try {
      await GlobalCache.setString(
        ASKED_NAMESPACE,
        WorkspaceAskToConnect.getAskedKey(data),
        OneUptimeDate.getCurrentDate().toISOString(),
        {
          expiresInSeconds:
            WORKSPACE_ASK_TO_CONNECT_AGAIN_AFTER_HOURS * 60 * 60,
        },
      );
    } catch (err) {
      logger.debug("Could not remember that a member was asked to connect.");
      logger.debug(err);
    }
  }

  private static async readRun(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<WorkspaceAskToConnectRun | null> {
    const key: string = WorkspaceAskToConnect.getRunKey(data);

    try {
      const run: WorkspaceAskToConnectRun | null =
        WorkspaceAskToConnectUtil.runFromJSON(
          await GlobalCache.getJSONObject(RUN_NAMESPACE, key),
        );

      if (
        run &&
        run.state === WorkspaceAskToConnectState.Asking &&
        !(await GlobalCache.getString(LOCK_NAMESPACE, key))
      ) {
        run.state = WorkspaceAskToConnectState.Stopped;
      }

      return run;
    } catch (err) {
      logger.debug("Could not read how asking members to connect went.");
      logger.debug(err);
      return null;
    }
  }

  private static async writeRun(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    run: WorkspaceAskToConnectRun;
  }): Promise<void> {
    try {
      await GlobalCache.setJSON(
        RUN_NAMESPACE,
        WorkspaceAskToConnect.getRunKey(data),
        WorkspaceAskToConnectUtil.runToJSON(data.run) as JSONObject,
        { expiresInSeconds: RUN_KEPT_FOR_SECONDS },
      );
    } catch (err) {
      logger.debug("Could not keep how asking members to connect is going.");
      logger.debug(err);
    }
  }

  private static async keepLock(key: string): Promise<void> {
    try {
      await GlobalCache.extendExpiry(LOCK_NAMESPACE, key, {
        expiresInSeconds: LOCK_SECONDS,
      });
    } catch (err) {
      logger.debug("Could not extend the lock of asking members to connect.");
      logger.debug(err);
    }
  }

  private static async releaseLock(data: {
    key: string;
    holder: string;
  }): Promise<void> {
    try {
      await GlobalCache.deleteKeyIfValue(LOCK_NAMESPACE, data.key, data.holder);
    } catch (err) {
      logger.debug("Could not release the lock of asking members to connect.");
      logger.debug(err);
    }
  }

  private static async getName(userId: ObjectID): Promise<string> {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: { name: true, email: true },
      props: { isRoot: true },
    });

    return user?.name?.toString() || user?.email?.toString() || "";
  }

  private static async getProjectName(projectId: ObjectID): Promise<string> {
    try {
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: { name: true },
        props: { isRoot: true },
      });

      return project?.name?.toString() || "";
    } catch (err) {
      logger.debug(
        "Could not read the project's name for its members' message.",
      );
      logger.debug(err);
      return "";
    }
  }

  private static getRunKey(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): string {
    return `${data.projectId.toString().toLowerCase()}:${data.workspaceType}`;
  }

  private static getAskedKey(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    userKey: string;
  }): string {
    return `${WorkspaceAskToConnect.getRunKey(data)}:${data.userKey}`;
  }

  private static markdown(text: MarkdownText): WorkspacePayloadMarkdown {
    return {
      _type: "WorkspacePayloadMarkdown",
      text: text.toString(),
    } as WorkspacePayloadMarkdown;
  }
}
