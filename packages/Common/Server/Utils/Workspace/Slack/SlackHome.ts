import crypto from "crypto";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  CONNECT_ACCOUNT_QUERY_PARAM,
  CONNECT_ACCOUNT_QUERY_VALUE,
} from "../../../../Types/Workspace/ConnectCallback";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
  WorkspacePayloadMenu,
  WorkspacePayloadMenuOption,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import DatabaseConfig from "../../../DatabaseConfig";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectResolver, {
  WorkspaceProjectChoice,
  WorkspaceProjectResolution,
} from "../WorkspaceProjectResolution";
import SlackModalMetadata from "./SlackModalMetadata";
import SlackProjectChoice, { SlackHomeOfPerson } from "./SlackProjectChoice";
import WorkspaceUserAuthTokenService from "../../../Services/WorkspaceUserAuthTokenService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import WorkspaceHome, {
  WorkspaceHomeActions,
  WorkspaceHomeView,
} from "../WorkspaceHome";
import SlackUtil from "./Slack";
import SlackActionType from "./Actions/ActionTypes";

/*
 * THE HOME TAB OF THE ONEUPTIME APP IN SLACK.
 *
 * Slack gives every app a Home tab, which the app draws for each person
 * with views.publish. Slack tells the app each time somebody opens it
 * (app_home_opened), and OneUptime draws it then - WorkspaceHome says what
 * it holds: your on-call shifts, the open incidents and alerts, and buttons
 * to declare an incident, page someone, schedule maintenance or see who is
 * on call. It is drawn again once somebody connects their Slack account, so
 * the tab they connected from fills in.
 *
 * A person whose Slack account is not connected sees why the tab is empty
 * and a button that connects it (their own Slack settings page in
 * OneUptime, with ?connectAccount=true). A workspace connected to no
 * project gets no Home: there is no project to show, nor a token to draw it
 * with.
 *
 * A workspace can be connected to more than one project: the Home shows
 * one project at a time - the one the person is in
 * (WorkspaceProjectResolution) - and carries it, so its buttons act in the
 * project it shows. Somebody connected as a member in two or more of them
 * gets a Switch project menu beside the line that names the project, which
 * lists their others by name; choosing one draws the Home again for it, and
 * it is remembered for their later openings
 * (SlackProjectChoice.rememberHomeProject) while they are still a member
 * there. Before they choose, or once they are no longer a member of the
 * project they chose, the Home shows the first of their projects, in the
 * order the projects were connected.
 *
 * The menu never widens what anybody sees: it offers only the projects
 * where the Slack account is connected to a current member, and the
 * project a press names - which anybody could write - is read again: one
 * the person may not see is never drawn, nor remembered, and the Home is
 * drawn as it opens, saying so first. Somebody connected in none of several
 * projects is told where to connect rather than given one project's Connect
 * button.
 *
 * The tab needs the manifest's features.app_home.home_tab_enabled and its
 * app_home_opened event. An app created from an older manifest has neither:
 * Slack never asks, and nothing changes for it.
 */

// The Home's buttons, as Slack's buttons act (SlackActionType).
export const SLACK_HOME_ACTIONS: WorkspaceHomeActions = {
  declareIncident: SlackActionType.NewIncident,
  pageSomeone: SlackActionType.PageSomeone,
  scheduleMaintenance: SlackActionType.NewScheduledMaintenance,
  whoIsOnCall: SlackActionType.ShowOnCall,
};

/*
 * The Home's Switch project menu - what it says while nothing is chosen -
 * and what a Home drawn for a project the person may not switch to says
 * first, under the greeting. Slack draws them in English, as it draws the
 * Home's buttons.
 */
export const SLACK_HOME_PROJECT_MENU: {
  placeholder: string;
  refused: string;
} = {
  placeholder: "Switch project",
  refused:
    "⚠️ You can't switch to that project: you're no longer a member of it, or your Slack account isn't connected there.",
};

/*
 * What somebody's Home shows (SlackHome.getPersonHome): the project, by its
 * connection, and the projects they can switch it to.
 */
export interface SlackPersonHome {
  // The connection of the project the Home shows: drawn with its token.
  projectAuth: WorkspaceProjectAuthToken;
  /*
   * Connected in none of several projects: told where to connect rather
   * than given one project's Connect button.
   */
  isConnectedInNone: boolean;
  // Connected as a member in two or more of the workspace's projects.
  isInSeveralProjects: boolean;
  /*
   * Those projects, named, in the order they were connected - the one
   * shown among them - for the Switch project menu. Empty for somebody in
   * fewer than two, or when any of them cannot be named: no menu then.
   */
  choices: Array<WorkspaceProjectChoice>;
  // It shows the project they chose for it last (getHomeProject).
  isRememberedProject: boolean;
}

// Opens of one person's Home within this many seconds draw it once.
const DRAWN_RECENTLY_IN_SECONDS: number = 10;

const DRAWN_NAMESPACE: string = "slack-home-drawn";

export default class SlackHome {
  /*
   * app_home_opened, for the Home tab: draws the person's Home. Slack also
   * sends it when the Messages tab is opened, which is not drawn: that open
   * is SlackMessagesWelcome's. Never throws: Slack has its 200 already.
   */
  @CaptureSpan()
  public static async handleHomeOpened(event: {
    teamId: string;
    slackUserId: string;
    tab?: string | undefined;
  }): Promise<void> {
    if (event.tab && event.tab !== "home") {
      return;
    }

    if (!event.teamId || !event.slackUserId) {
      return;
    }

    try {
      const home: SlackPersonHome | null = await SlackHome.getPersonHome({
        teamId: event.teamId,
        slackUserId: event.slackUserId,
      });

      if (!home) {
        logger.debug(
          "Slack Home opened in a workspace connected to no project; nothing to draw.",
        );
        return;
      }

      // Slack can tell of one open twice: drawn once.
      if (
        !(await SlackHome.claimDrawing({
          teamId: event.teamId,
          slackUserId: event.slackUserId,
        }))
      ) {
        logger.debug("Slack Home drawn moments ago; not drawn again.");
        return;
      }

      // The project they chose stays chosen while they go on opening it.
      if (home.isRememberedProject) {
        await SlackProjectChoice.rememberHomeProject({
          person: SlackHome.personOf(event),
          projectId: home.projectAuth.projectId!,
        });
      }

      await SlackHome.publishHome({
        home: home,
        slackUserId: event.slackUserId,
      });
    } catch (err) {
      logger.error("Could not draw a Slack Home tab.");
      logger.error(err);
    }
  }

  /*
   * The Home's Switch project menu, chosen from: the Home drawn again for
   * the project chosen - when the person's Slack account is still connected
   * to a current member there, read again now and never taken from the
   * press - and that project remembered for their later openings. A project
   * they may not switch to - one they left after the menu was drawn, or any
   * other a press names - is neither drawn nor remembered: their Home is
   * drawn as it opens, saying first that it could not switch. Never throws:
   * Slack has its 200 already.
   */
  @CaptureSpan()
  public static async switchProject(data: {
    teamId: string | undefined;
    slackUserId: string | undefined;
    // What the chosen option names (readProjectSwitch); null for none.
    projectId: ObjectID | null;
  }): Promise<void> {
    if (!data.teamId || !data.slackUserId) {
      return;
    }

    try {
      const home: SlackPersonHome | null = await SlackHome.getPersonHome({
        teamId: data.teamId,
        slackUserId: data.slackUserId,
        chosenProjectId: data.projectId || undefined,
      });

      if (!home) {
        logger.debug(
          "Slack Home's project switched in a workspace connected to no project; nothing to draw.",
        );
        return;
      }

      const isSwitched: boolean = Boolean(
        data.projectId &&
          SlackHome.isSameId(home.projectAuth.projectId, data.projectId),
      );

      if (isSwitched && home.isInSeveralProjects) {
        await SlackProjectChoice.rememberHomeProject({
          person: { teamId: data.teamId, slackUserId: data.slackUserId },
          projectId: home.projectAuth.projectId!,
        });
      }

      await SlackHome.publishHome({
        home: home,
        slackUserId: data.slackUserId,
        isSwitchRefused: !isSwitched,
      });
    } catch (err) {
      logger.error("Could not switch a Slack Home to another project.");
      logger.error(err);
    }
  }

  /*
   * The project an option of the Home's Switch project menu names, as Slack
   * posts the choice: its value, when it is a project's id; null for
   * anything else. It decides nothing by itself (switchProject).
   */
  public static readProjectSwitch(
    payload: JSONObject | undefined,
  ): ObjectID | null {
    const actions: unknown = payload?.["actions"];

    if (!Array.isArray(actions)) {
      return null;
    }

    for (const action of actions as JSONArray) {
      if (!action || typeof action !== "object" || Array.isArray(action)) {
        continue;
      }

      if (
        (action as JSONObject)["action_id"] !== SlackActionType.SwitchHomeProject
      ) {
        continue;
      }

      const selected: unknown = (action as JSONObject)["selected_option"];
      const value: unknown =
        selected && typeof selected === "object" && !Array.isArray(selected)
          ? (selected as JSONObject)["value"]
          : undefined;

      return typeof value === "string" && ObjectID.isValidUUID(value)
        ? new ObjectID(value)
        : null;
    }

    return null;
  }

  /*
   * The Home somebody is shown in a workspace (see the header). For a
   * person connected as a member in two or more of its projects: the one
   * they choose now (`chosenProjectId`), or else the one they chose last
   * (SlackProjectChoice.getHomeProject), while they are a member there -
   * else the first of their projects; with every one of them named, for the
   * menu. For anybody else: the project WorkspaceProjectResolution tells
   * apart for them, as before. Null for a workspace connected to no
   * project.
   */
  @CaptureSpan()
  public static async getPersonHome(data: {
    teamId: string;
    slackUserId: string;
    // A project they just chose for it, or just connected their account in.
    chosenProjectId?: ObjectID | undefined;
  }): Promise<SlackPersonHome | null> {
    const resolution: WorkspaceProjectResolution =
      await WorkspaceProjectResolver.resolve({
        workspaceType: WorkspaceType.Slack,
        workspaceId: data.teamId,
        clues: {
          workspaceUserId: data.slackUserId,
        },
      });

    /*
     * The workspace's projects the Slack account is connected in as a
     * current member, in the order the projects were connected - read when
     * it is connected to two or more. The menu offers no other.
     */
    const memberProjectIds: Array<ObjectID> = resolution.memberProjectIds;

    if (memberProjectIds.length < 2) {
      const personProject: WorkspaceProjectAuthToken | null =
        WorkspaceProjectResolver.getPersonProject(resolution);

      const projectAuth: WorkspaceProjectAuthToken | null =
        personProject || resolution.connections[0] || null;

      if (!projectAuth?.projectId || !projectAuth.authToken) {
        return null;
      }

      return {
        projectAuth: projectAuth,
        isConnectedInNone: !personProject,
        isInSeveralProjects: false,
        choices: [],
        isRememberedProject: false,
      };
    }

    // One of the person's projects, as it is listed; undefined for any other.
    const memberProjectId: (
      projectId: ObjectID | null | undefined,
    ) => ObjectID | undefined = (
      projectId: ObjectID | null | undefined,
    ): ObjectID | undefined => {
      return memberProjectIds.find((memberId: ObjectID): boolean => {
        return SlackHome.isSameId(memberId, projectId);
      });
    };

    let shownProjectId: ObjectID = memberProjectIds[0]!;
    let isRememberedProject: boolean = false;

    const chosenProjectId: ObjectID | undefined = memberProjectId(
      data.chosenProjectId,
    );

    if (chosenProjectId) {
      shownProjectId = chosenProjectId;
    } else {
      const rememberedProjectId: ObjectID | undefined = memberProjectId(
        await SlackProjectChoice.getHomeProject(SlackHome.personOf(data)),
      );

      if (rememberedProjectId) {
        shownProjectId = rememberedProjectId;
        isRememberedProject = true;
      }
    }

    const projectAuth: WorkspaceProjectAuthToken | undefined =
      resolution.connections.find(
        (connection: WorkspaceProjectAuthToken): boolean => {
          return SlackHome.isSameId(connection.projectId, shownProjectId);
        },
      );

    if (!projectAuth?.projectId || !projectAuth.authToken) {
      return null;
    }

    const choices: Array<WorkspaceProjectChoice> | null =
      await WorkspaceProjectResolver.getProjectChoices(memberProjectIds);

    return {
      projectAuth: projectAuth,
      isConnectedInNone: false,
      isInSeveralProjects: true,
      choices: choices || [],
      isRememberedProject: isRememberedProject,
    };
  }

  /*
   * Draws `slackUserId`'s Home in the project's workspace, now: what
   * WorkspaceHome holds for them, or how to connect. Throws when Slack
   * refuses it.
   */
  @CaptureSpan()
  public static async publish(data: {
    projectId: ObjectID;
    projectAuthToken: string;
    slackUserId: string;
    /*
     * What a person not connected is given to connect with: the project's
     * Connect button by default; null for where in OneUptime instead.
     */
    connectUrl?: string | null | undefined;
    /*
     * The person's projects, when they are a member of two or more of the
     * workspace's: the Switch project menu lists those not shown.
     */
    choices?: Array<WorkspaceProjectChoice> | undefined;
    // Drawn for a project switch it could not follow: says so first.
    isSwitchRefused?: boolean | undefined;
  }): Promise<void> {
    const blocks: Array<WorkspaceMessageBlock> = await SlackHome.getBlocks({
      projectId: data.projectId,
      slackUserId: data.slackUserId,
      connectUrl: data.connectUrl,
      choices: data.choices,
      isSwitchRefused: data.isSwitchRefused,
    });

    await SlackHome.viewsPublish({
      authToken: data.projectAuthToken,
      slackUserId: data.slackUserId,
      blocks: blocks,
      projectId: data.projectId,
    });
  }

  /*
   * Draws the Home of somebody who has just connected their Slack account,
   * so the tab they may have connected from fills in - for the project they
   * connected in, which in a workspace connected to several is then the
   * project their later openings show too. Never throws: the account is
   * connected either way.
   */
  @CaptureSpan()
  public static async refreshAfterConnect(data: {
    projectId: ObjectID;
    slackUserId: string;
  }): Promise<void> {
    try {
      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: data.projectId,
          workspaceType: WorkspaceType.Slack,
        });

      if (!projectAuth?.authToken) {
        return;
      }

      const teamId: string = projectAuth.workspaceProjectId || "";

      const home: SlackPersonHome | null = teamId
        ? await SlackHome.getPersonHome({
            teamId: teamId,
            slackUserId: data.slackUserId,
            chosenProjectId: data.projectId,
          })
        : null;

      if (home && SlackHome.isSameId(home.projectAuth.projectId, data.projectId)) {
        if (home.isInSeveralProjects) {
          await SlackProjectChoice.rememberHomeProject({
            person: { teamId: teamId, slackUserId: data.slackUserId },
            projectId: data.projectId,
          });
        }

        await SlackHome.publishHome({
          home: home,
          slackUserId: data.slackUserId,
        });
        return;
      }

      await SlackHome.publish({
        projectId: data.projectId,
        projectAuthToken: projectAuth.authToken,
        slackUserId: data.slackUserId,
      });
    } catch (err) {
      logger.debug(
        "Could not draw the Slack Home of an account just connected.",
      );
      logger.debug(err);
    }
  }

  // The Home's blocks for `slackUserId` (see the header).
  @CaptureSpan()
  public static async getBlocks(data: {
    projectId: ObjectID;
    slackUserId: string;
    now?: Date | undefined;
    // See publish: the Connect button's link, or null for none.
    connectUrl?: string | null | undefined;
    // See publish: the person's projects, for the Switch project menu.
    choices?: Array<WorkspaceProjectChoice> | undefined;
    // See publish.
    isSwitchRefused?: boolean | undefined;
  }): Promise<Array<WorkspaceMessageBlock>> {
    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          workspaceUserId: data.slackUserId,
          projectId: data.projectId,
          workspaceType: WorkspaceType.Slack,
        },
        select: {
          userId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!userAuth?.userId) {
      return WorkspaceHome.getNotConnectedBlocks({
        workspaceType: WorkspaceType.Slack,
        connectUrl:
          data.connectUrl !== undefined
            ? data.connectUrl
            : await SlackHome.getConnectUrl(data.projectId),
      });
    }

    let props: DatabaseCommonInteractionProps;

    try {
      props = await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userAuth.userId,
        projectId: data.projectId,
      });
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        return SlackHome.getRefusedBlocks(err.message);
      }

      throw err;
    }

    const view: WorkspaceHomeView = await WorkspaceHome.read({
      projectId: data.projectId,
      userId: userAuth.userId,
      props: props,
      now: data.now,
    });

    const projectMenu: WorkspacePayloadMenu | null = SlackHome.getProjectMenu({
      shownProjectId: data.projectId,
      choices: data.choices || [],
    });

    /*
     * The menu sits beside the line that names the project: named as the
     * menu was, should the Home's own read of the name have failed.
     */
    if (projectMenu && !view.projectName) {
      view.projectName =
        (data.choices || []).find((choice: WorkspaceProjectChoice): boolean => {
          return SlackHome.isSameId(choice.projectId, data.projectId);
        })?.name || null;
    }

    return WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.Slack,
      view: view,
      actions: SLACK_HOME_ACTIONS,
      projectMenu: projectMenu || undefined,
      notice: data.isSwitchRefused
        ? mdText`${SLACK_HOME_PROJECT_MENU.refused}`
        : undefined,
    });
  }

  /*
   * The Home's Switch project menu: the person's projects other than the
   * one shown, by name, in the order the projects were connected. Null when
   * there is no other, or the project shown is not among them - the menu
   * belongs to the Home of one of the person's own projects.
   */
  public static getProjectMenu(data: {
    shownProjectId: ObjectID;
    choices: Array<WorkspaceProjectChoice>;
  }): WorkspacePayloadMenu | null {
    const isShownAmongThem: boolean = data.choices.some(
      (choice: WorkspaceProjectChoice): boolean => {
        return SlackHome.isSameId(choice.projectId, data.shownProjectId);
      },
    );

    const others: Array<WorkspaceProjectChoice> = data.choices.filter(
      (choice: WorkspaceProjectChoice): boolean => {
        return !SlackHome.isSameId(choice.projectId, data.shownProjectId);
      },
    );

    if (!isShownAmongThem || others.length === 0) {
      return null;
    }

    return {
      actionId: SlackActionType.SwitchHomeProject,
      placeholder: SLACK_HOME_PROJECT_MENU.placeholder,
      options: others.map(
        (choice: WorkspaceProjectChoice): WorkspacePayloadMenuOption => {
          return {
            label: choice.name,
            value: choice.projectId.toString(),
          };
        },
      ),
      // Each project's Home has a menu of its own: nothing chosen in another is kept.
      blockId: `${SlackActionType.SwitchHomeProject}:${data.shownProjectId.toString()}`,
    };
  }

  /*
   * The person's own Slack settings page in OneUptime, which connects the
   * account of whoever opens it (?connectAccount=true); null without a
   * dashboard address.
   */
  public static async getConnectUrl(
    projectId: ObjectID,
  ): Promise<string | null> {
    try {
      const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

      return URL.fromString(dashboardUrl.toString())
        .addRoute(`/${projectId.toString()}/user-settings/slack-integration`)
        .addQueryParam(CONNECT_ACCOUNT_QUERY_PARAM, CONNECT_ACCOUNT_QUERY_VALUE)
        .toString();
    } catch (err) {
      logger.debug("No dashboard address for the Slack Home's Connect button.");
      logger.debug(err);
      return null;
    }
  }

  // Draws the Home getPersonHome chose, for its project.
  private static async publishHome(data: {
    home: SlackPersonHome;
    slackUserId: string;
    isSwitchRefused?: boolean | undefined;
  }): Promise<void> {
    await SlackHome.publish({
      projectId: data.home.projectAuth.projectId!,
      projectAuthToken: data.home.projectAuth.authToken!,
      slackUserId: data.slackUserId,
      // Connected in none of several projects: where, not which.
      ...(data.home.isConnectedInNone ? { connectUrl: null } : {}),
      choices: data.home.choices,
      isSwitchRefused: data.isSwitchRefused,
    });
  }

  // A member refused - not one any more, or the project blocked: why.
  private static getRefusedBlocks(
    message: string,
  ): Array<WorkspaceMessageBlock> {
    const blocks: Array<WorkspaceMessageBlock> =
      WorkspaceHome.getNotAMemberBlocks();

    return blocks.map((block: WorkspaceMessageBlock): WorkspaceMessageBlock => {
      if (block._type === "WorkspacePayloadMarkdown") {
        return {
          _type: "WorkspacePayloadMarkdown",
          text: mdText`${message}`.toString(),
        } as WorkspacePayloadMarkdown;
      }

      return block as WorkspacePayloadHeader;
    });
  }

  /*
   * Whether this open of the Home is the one to draw it: the first in
   * DRAWN_RECENTLY_IN_SECONDS. A cache that cannot be read draws it.
   */
  private static async claimDrawing(person: {
    teamId: string;
    slackUserId: string;
  }): Promise<boolean> {
    try {
      return await GlobalCache.setStringIfNotExists(
        DRAWN_NAMESPACE,
        crypto
          .createHash("sha256")
          .update(JSON.stringify([person.teamId, person.slackUserId]))
          .digest("hex"),
        "1",
        { expiresInSeconds: DRAWN_RECENTLY_IN_SECONDS },
      );
    } catch (err) {
      logger.debug("Could not check whether the Slack Home was just drawn.");
      logger.debug(err);
      return true;
    }
  }

  /*
   * views.publish: the Home view, for one person. It carries the project it
   * shows (SlackModalMetadata), so a press of its buttons is read there.
   */
  private static async viewsPublish(data: {
    authToken: string;
    slackUserId: string;
    blocks: Array<WorkspaceMessageBlock>;
    projectId: ObjectID;
  }): Promise<void> {
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/views.publish"),
        data: {
          user_id: data.slackUserId,
          view: {
            type: "home",
            private_metadata: SlackModalMetadata.write("", {
              projectId: data.projectId.toString(),
            }),
            blocks: SlackUtil.getBlocksFromWorkspaceMessagePayload({
              messageBlocks: data.blocks,
              maxBlocks: SlackUtil.MAX_BLOCKS_PER_MODAL,
            }),
          },
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 1,
          retryOnlyOnRetryableErrors: true,
        },
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      throw new BadRequestException(
        "Error from Slack " +
          String((response.jsonData as JSONObject)?.["error"] || ""),
      );
    }
  }

  // The person whose Home it is, as the project chosen for it is kept.
  private static personOf(data: {
    teamId: string;
    slackUserId: string;
  }): SlackHomeOfPerson {
    return { teamId: data.teamId, slackUserId: data.slackUserId };
  }

  private static isSameId(
    a: ObjectID | string | null | undefined,
    b: ObjectID | string | null | undefined,
  ): boolean {
    if (!a || !b) {
      return false;
    }

    return a.toString().toLowerCase() === b.toString().toLowerCase();
  }
}
