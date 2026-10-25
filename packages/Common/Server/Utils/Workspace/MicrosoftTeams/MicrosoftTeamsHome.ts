import { Activity, TurnContext } from "./Botbuilder";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { WorkspaceMessageBlock } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import DatabaseConfig from "../../../DatabaseConfig";
import logger from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import WorkspaceConnectRequest, {
  WorkspaceConnectLink,
  WorkspaceConnectRequestAgainKind,
} from "../WorkspaceConnectRequest";
import WorkspaceHome, {
  WorkspaceHomeActions,
  WorkspaceHomeView,
} from "../WorkspaceHome";
import MicrosoftTeamsAuthAction from "./Actions/Auth";
import MicrosoftTeamsUtil from "./MicrosoftTeams";
import MicrosoftTeamsCommands from "./MicrosoftTeamsCommands";
import MicrosoftTeamsConnectPrompt from "./MicrosoftTeamsConnectPrompt";
import MicrosoftTeamsCreateCommands from "./MicrosoftTeamsCreateCommands";
import MicrosoftTeamsPage from "./MicrosoftTeamsPage";
import MicrosoftTeamsReplies, {
  MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
} from "./MicrosoftTeamsReplies";

/*
 * THE HOME OF THE ONEUPTIME APP IN MICROSOFT TEAMS.
 *
 * Teams has no Home tab for a bot, so the Home is a card in the person's
 * chat with OneUptime: the same blocks as Slack's Home tab (WorkspaceHome) -
 * your on-call shifts, the open incidents and alerts - with buttons to
 * declare an incident, page someone, see who is on call, and Refresh, which
 * draws the card again in place.
 *
 *   - Somebody who adds the app for themselves gets it as the welcome; one
 *     not connected yet gets the Home's Connect card instead.
 *   - "home", typed to the bot, sends it again.
 *
 * A team or a group chat the app is added to gets a short hello instead
 * (getTeamWelcome): what OneUptime does there, and where its notifications
 * are set up - the words Slack's channel hello says (SlackWelcome).
 */

// The Home's buttons in Teams: Action.Submit actions the bot routes here.
export enum MicrosoftTeamsHomeActionType {
  DeclareIncident = "home-declare-incident",
  PageSomeone = "home-page-someone",
  WhoIsOnCall = "home-who-is-on-call",
  Refresh = "home-refresh",
}

export const MICROSOFT_TEAMS_HOME_ACTIONS: WorkspaceHomeActions = {
  declareIncident: MicrosoftTeamsHomeActionType.DeclareIncident,
  pageSomeone: MicrosoftTeamsHomeActionType.PageSomeone,
  whoIsOnCall: MicrosoftTeamsHomeActionType.WhoIsOnCall,
  refresh: MicrosoftTeamsHomeActionType.Refresh,
};

// What is typed to see the Home again.
export const MICROSOFT_TEAMS_HOME_COMMAND: string = "home";

// What somebody not connected is asked to connect for.
const HOME_PURPOSE: string =
  "see your on-call shifts and the open incidents here";

export default class MicrosoftTeamsHome {
  // "home", typed to the bot, alone (any case, a "!" or "?" after it).
  public static isHomeCommand(cleanText: string): boolean {
    let text: string = cleanText.trim().toLowerCase();

    while (text.endsWith("!") || text.endsWith("?") || text.endsWith(".")) {
      text = text.substring(0, text.length - 1);
    }

    return text.trim() === MICROSOFT_TEAMS_HOME_COMMAND;
  }

  public static isHomeAction(actionType: string | undefined): boolean {
    return Object.values(MicrosoftTeamsHomeActionType).includes(
      actionType as MicrosoftTeamsHomeActionType,
    );
  }

  /*
   * "home": the sender's Home, as a card in the conversation. Somebody not
   * connected is asked to connect (MicrosoftTeamsCommands.authorizeSender),
   * and somebody no longer a member is told so.
   */
  @CaptureSpan()
  public static async handleCommand(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
  }): Promise<void> {
    const props: DatabaseCommonInteractionProps | null =
      await MicrosoftTeamsCommands.authorizeSender({
        turnContext: data.turnContext,
        activity: data.activity,
        projectId: data.projectId,
        does: "show your Home",
        commandName: MICROSOFT_TEAMS_HOME_COMMAND,
        connect: {
          purpose: HOME_PURPOSE,
          command: MICROSOFT_TEAMS_HOME_COMMAND,
        },
      });

    if (!props?.userId) {
      return;
    }

    await MicrosoftTeamsHome.sendHome({
      turnContext: data.turnContext,
      projectId: data.projectId,
      props: props,
    });
  }

  /*
   * A button of the Home, pressed - as the member who pressed it
   * (`databaseProps`, read by the bot's invoke handler).
   */
  @CaptureSpan()
  public static async handleAction(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    actionType: string;
    projectId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
  }): Promise<void> {
    switch (data.actionType as MicrosoftTeamsHomeActionType) {
      case MicrosoftTeamsHomeActionType.DeclareIncident:
        await MicrosoftTeamsCreateCommands.handleCreateIncidentCommand({
          turnContext: data.turnContext,
          activity: data.activity,
          projectId: data.projectId,
        });
        return;
      case MicrosoftTeamsHomeActionType.PageSomeone:
        await MicrosoftTeamsPage.handleCommand({
          turnContext: data.turnContext,
          activity: data.activity,
          projectId: data.projectId,
        });
        return;
      case MicrosoftTeamsHomeActionType.WhoIsOnCall:
        await MicrosoftTeamsCommands.handleOnCallCommand({
          turnContext: data.turnContext,
          activity: data.activity,
          projectId: data.projectId,
        });
        return;
      case MicrosoftTeamsHomeActionType.Refresh:
        await MicrosoftTeamsHome.sendHome({
          turnContext: data.turnContext,
          projectId: data.projectId,
          props: data.databaseProps,
          // The card the button is on.
          replacing: (data.activity["replyToId"] as string) || undefined,
        });
        return;
    }
  }

  /*
   * Welcomes somebody who added the app for themselves: their Home, or -
   * not connected yet - the Home's Connect card. Never throws.
   */
  @CaptureSpan()
  public static async sendPersonalWelcome(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
  }): Promise<void> {
    try {
      const activity: JSONObject = data.turnContext
        .activity as unknown as JSONObject;
      const teamsUserId: string =
        ((activity["from"] as JSONObject | undefined)?.["aadObjectId"] as
          | string
          | undefined) || "";

      const props: DatabaseCommonInteractionProps | null = teamsUserId
        ? await MicrosoftTeamsHome.readMemberProps({
            teamsUserId: teamsUserId,
            projectId: data.projectId,
          })
        : null;

      if (props?.userId) {
        await MicrosoftTeamsHome.sendHome({
          turnContext: data.turnContext,
          projectId: data.projectId,
          props: props,
        });
        return;
      }

      const link: WorkspaceConnectLink | null = teamsUserId
        ? await WorkspaceConnectRequest.getConnectLink({
            workspaceType: WorkspaceType.MicrosoftTeams,
            projectId: data.projectId,
            workspaceUserId: teamsUserId,
            purpose: HOME_PURPOSE,
            again: {
              kind: WorkspaceConnectRequestAgainKind.Command,
              label: MICROSOFT_TEAMS_HOME_COMMAND,
            },
            teams: MicrosoftTeamsConnectPrompt.getPlace(activity),
          })
        : null;

      await MicrosoftTeamsHome.sendCard({
        turnContext: data.turnContext,
        blocks: WorkspaceHome.getNotConnectedBlocks({
          workspaceType: WorkspaceType.MicrosoftTeams,
          connectUrl: link?.url ? link.url.toString() : null,
        }),
        summary: `Welcome to ${ProductBrandingText.getProductName()}. Connect your Microsoft Teams account to see your Home.`,
      });
    } catch (err) {
      logger.error("Could not welcome a Microsoft Teams user to OneUptime.");
      logger.error(err);
    }
  }

  /*
   * The hello a team or a group chat gets when the app is added to it: what
   * OneUptime does there, and where its notifications are set up - or, for
   * an organization connected to no project, who connects it.
   */
  public static async getTeamWelcome(data: {
    // The project the organization is connected to; null for none, or several.
    projectId: ObjectID | null;
    // The organization is connected to a project (to several, too).
    isConnected: boolean;
    // A personal chat, where nobody needs to be mentioned.
    isPersonal?: boolean | undefined;
  }): Promise<{
    card: JSONObject;
    summary: string;
  }> {
    const { projectId } = data;
    const productName: string = ProductBrandingText.getProductName();
    const dashboardUrl: URL | null = await MicrosoftTeamsHome.getDashboardUrl();

    const body: Array<JSONObject> = [
      {
        type: "TextBlock",
        text: (data.isPersonal
          ? mdText`👋 **Hi, I'm ${productName}.** Ask me a question about your incidents, monitors, logs and traces, or type **help** to see what I can do: declare an incident, page someone, see who is on call.`
          : mdText`👋 **Hi, I'm ${productName}.** @mention me with a question about your incidents, monitors, logs and traces, or with **help** to see what I can do: declare an incident, page someone, see who is on call.`
        ).toString(),
        wrap: true,
      },
      {
        type: "TextBlock",
        text: (data.isConnected
          ? mdText`To post incidents, alerts or scheduled maintenance to a team's channels, add a notification rule in ${productName} under **Incidents → Workspace → Microsoft Teams**.`
          : mdText`To get started, a project admin connects your organization in ${productName}, under **Project Settings → Workspace → Microsoft Teams**.`
        ).toString(),
        wrap: true,
        spacing: "Medium",
      },
    ];

    const actions: Array<JSONObject> = [];

    if (dashboardUrl) {
      actions.push(
        projectId
          ? {
              type: "Action.OpenUrl",
              title: "Set up notifications",
              url: URL.fromString(dashboardUrl.toString())
                .addRoute(
                  `/${projectId.toString()}/incidents/workspace-connection-microsoft-teams`,
                )
                .toString(),
            }
          : {
              type: "Action.OpenUrl",
              title: `Open ${productName}`,
              url: dashboardUrl.toString(),
            },
      );
    }

    const card: JSONObject = {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: body,
    };

    if (actions.length > 0) {
      card["actions"] = actions;
    }

    return {
      card: card,
      // A personal chat needs no @mention.
      summary: data.isPersonal
        ? `Hi, I'm ${productName}. Ask me a question, or type help.`
        : `Hi, I'm ${productName}. @mention me with a question, or with help.`,
    };
  }

  /*
   * The member's Home as a card, sent - or, `replacing` a Home card, drawn
   * again in its place. A card Teams will not change in place is sent anew.
   */
  @CaptureSpan()
  public static async sendHome(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    replacing?: string | undefined;
  }): Promise<void> {
    const view: WorkspaceHomeView = await WorkspaceHome.read({
      projectId: data.projectId,
      userId: data.props.userId!,
      props: data.props,
    });

    const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.MicrosoftTeams,
      view: view,
      actions: MICROSOFT_TEAMS_HOME_ACTIONS,
    });

    await MicrosoftTeamsHome.sendCard({
      turnContext: data.turnContext,
      blocks: blocks,
      summary: WorkspaceHome.getNotificationText(view),
      replacing: data.replacing,
    });
  }

  // The card the blocks draw (MicrosoftTeamsUtil), sent or drawn in place.
  private static async sendCard(data: {
    turnContext: TurnContext;
    blocks: Array<WorkspaceMessageBlock>;
    summary: string;
    replacing?: string | undefined;
  }): Promise<void> {
    const activity: Partial<Activity> = {
      type: "message",
      attachments: [
        {
          contentType: MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
          content: MicrosoftTeamsHome.getCard(data.blocks),
        },
      ],
      summary: data.summary,
    };

    if (data.replacing) {
      try {
        await data.turnContext.updateActivity({
          ...activity,
          id: data.replacing,
        });
        return;
      } catch (err) {
        logger.debug(
          "Microsoft Teams did not draw the Home again in place; sending it anew.",
        );
        logger.debug(err);
      }
    }

    await MicrosoftTeamsReplies.sendBestEffort(data.turnContext, activity);
  }

  /*
   * The Home as a card, as wide as the chat: a narrow card cut its four
   * buttons short ("Declare inci…") and wrapped each record over two lines.
   */
  public static getCard(blocks: Array<WorkspaceMessageBlock>): JSONObject {
    const card: JSONObject =
      MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
        messageBlocks: blocks,
      });

    card["msteams"] = {
      ...((card["msteams"] as JSONObject | undefined) || {}),
      width: "Full",
    };

    return card;
  }

  // The member's props, or null when not connected or not a member.
  private static async readMemberProps(data: {
    teamsUserId: string;
    projectId: ObjectID;
  }): Promise<DatabaseCommonInteractionProps | null> {
    try {
      const userId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: data.teamsUserId,
          projectId: data.projectId,
        });

      return await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: data.projectId,
      });
    } catch (err) {
      logger.debug("A Microsoft Teams user without a member to welcome as.");
      logger.debug(err);
      return null;
    }
  }

  private static async getDashboardUrl(): Promise<URL | null> {
    try {
      return await DatabaseConfig.getDashboardUrl();
    } catch (err) {
      logger.debug("No dashboard address for the Microsoft Teams welcome.");
      logger.debug(err);
      return null;
    }
  }
}
