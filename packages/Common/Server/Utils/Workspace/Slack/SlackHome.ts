import crypto from "crypto";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  CONNECT_ACCOUNT_QUERY_PARAM,
  CONNECT_ACCOUNT_QUERY_VALUE,
} from "../../../../Types/Workspace/ConnectCallback";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import DatabaseConfig from "../../../DatabaseConfig";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectResolver, {
  WorkspaceProjectResolution,
} from "../WorkspaceProjectResolution";
import SlackModalMetadata from "./SlackModalMetadata";
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
 * the project the person is in (WorkspaceProjectResolution) - the first of
 * them, by name, when they are in several - and carries it, so its buttons
 * act in the project it shows. Somebody connected in none of several is
 * told where to connect rather than given one project's Connect button.
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
      const resolution: WorkspaceProjectResolution =
        await WorkspaceProjectResolver.resolve({
          workspaceType: WorkspaceType.Slack,
          workspaceId: event.teamId,
          clues: {
            workspaceUserId: event.slackUserId,
          },
        });

      const personProject: WorkspaceProjectAuthToken | null =
        WorkspaceProjectResolver.getPersonProject(resolution);

      const projectAuth: WorkspaceProjectAuthToken | null =
        personProject || resolution.connections[0] || null;

      if (!projectAuth?.projectId || !projectAuth.authToken) {
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

      await SlackHome.publish({
        projectId: projectAuth.projectId,
        projectAuthToken: projectAuth.authToken,
        slackUserId: event.slackUserId,
        // Connected in none of several projects: where, not which.
        ...(personProject ? {} : { connectUrl: null }),
      });
    } catch (err) {
      logger.error("Could not draw a Slack Home tab.");
      logger.error(err);
    }
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
  }): Promise<void> {
    const blocks: Array<WorkspaceMessageBlock> = await SlackHome.getBlocks({
      projectId: data.projectId,
      slackUserId: data.slackUserId,
      connectUrl: data.connectUrl,
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
   * so the tab they may have connected from fills in. Never throws: the
   * account is connected either way.
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

    return WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.Slack,
      view: view,
      actions: SLACK_HOME_ACTIONS,
    });
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
}
