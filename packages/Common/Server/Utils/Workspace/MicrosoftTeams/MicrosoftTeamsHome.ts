import { Activity, TurnContext } from "./Botbuilder";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMenu,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
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
import WorkspaceHomeProject from "../WorkspaceHomeProject";
import WorkspaceProjectResolver, {
  WorkspaceProjectChoice,
  WorkspaceProjectResolution,
} from "../WorkspaceProjectResolution";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "./Actions/Auth";
import MicrosoftTeamsActionAnswer from "./MicrosoftTeamsActionAnswer";
import MicrosoftTeamsCardProject from "./MicrosoftTeamsCardProject";
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
 * In a Microsoft 365 organization connected to several projects, somebody
 * whose Teams account is connected to a member in two or more of them sees
 * one at a time, as in Slack (SlackHome): the one they chose last
 * (WorkspaceHomeProject), else the first of theirs, in the order the
 * projects were connected - never asked which first. Under the line that
 * names it, a Switch project menu lists their others, with a button that
 * switches (a card's dropdown cannot act by itself), or - with one other -
 * one button, "Switch to IRM Non-Prod". A switch draws the card again in
 * place for the project chosen, and their later Homes open on it. The menu
 * widens nothing: a press names a project, and the person's links and
 * memberships are read again for it - one they may not see is never drawn,
 * nor kept, and their Home is drawn as it opens, saying first that it could
 * not switch. A project that refuses them - blocked, or just left - still
 * names itself with the menu beside it, so they can always switch away.
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
  // The Switch project menu's button (switchProject), read before any project.
  SwitchProject = "home-switch-project",
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

/*
 * What somebody's Home shows (getPersonHome): the project, by its
 * connection, and the projects they can switch it to.
 */
export interface MicrosoftTeamsPersonHome {
  // The connection of the project the Home shows.
  projectAuth: WorkspaceProjectAuthToken;
  /*
   * Connected in none of several projects: nobody's Home to draw for them
   * there - told how to connect instead.
   */
  isConnectedInNone: boolean;
  // Connected as a member in two or more of the organization's projects.
  isInSeveralProjects: boolean;
  /*
   * The organization is connected to two or more projects: every card of
   * its Home carries the project it shows (MicrosoftTeamsCardProject).
   */
  isSharedOrganization: boolean;
  /*
   * Those projects, named, in the order they were connected - the one
   * shown among them - for the Switch project menu. Empty for somebody in
   * fewer than two, or when any of them cannot be named: no menu then.
   */
  choices: Array<WorkspaceProjectChoice>;
  // It shows the project they chose for it last (WorkspaceHomeProject).
  isRememberedProject: boolean;
}

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
   * The Switch project menu's button: read before the press's project is,
   * since it names the project it is for (switchProject).
   */
  public static isSwitchProjectAction(actionType: string | undefined): boolean {
    return actionType === MicrosoftTeamsHomeActionType.SwitchProject;
  }

  /*
   * "home": the sender's Home, as a card in the conversation. Somebody not
   * connected is asked to connect (MicrosoftTeamsCommands.authorizeSender),
   * and somebody no longer a member is told so - or, with projects of
   * theirs to switch to, shown which project refuses them, with the menu.
   */
  @CaptureSpan()
  public static async handleCommand(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
  }): Promise<void> {
    const projectMenu: WorkspacePayloadMenu | null =
      await MicrosoftTeamsHome.readProjectMenu({
        activity: data.activity,
        projectId: data.projectId,
      });

    if (projectMenu) {
      await MicrosoftTeamsHome.drawHome({
        turnContext: data.turnContext,
        activity: data.activity,
        projectId: data.projectId,
        projectMenu: projectMenu,
      });
      return;
    }

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
      projectMenu: null,
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
      case MicrosoftTeamsHomeActionType.SwitchProject:
        // Read before any project is (switchProject): nothing to do here.
        return;
    }
  }

  /*
   * The Switch project menu, pressed: the card drawn again in place for the
   * project chosen - when the presser's Teams account is still connected to
   * a current member there, read again now and never taken from the press
   * - and that project kept for their later Homes (WorkspaceHomeProject). A
   * project they may not switch to - one they left after the menu was
   * drawn, or any other a press names - is neither drawn nor kept: their
   * Home is drawn as it opens, saying first that it could not switch.
   * Somebody connected in none of the organization's projects is answered
   * in a reply, and the card they pressed is left as it is. Never throws.
   */
  @CaptureSpan()
  public static async switchProject(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    // What the press names (the option chosen): a project's id, or anything.
    actionValue: string | undefined;
  }): Promise<void> {
    try {
      const tenantId: string = MicrosoftTeamsHome.getTenantId(data.activity);
      const aadObjectId: string = MicrosoftTeamsHome.getAadObjectId(
        data.activity,
      );
      const chosenProjectId: ObjectID | null =
        typeof data.actionValue === "string" &&
        ObjectID.isValidUUID(data.actionValue)
          ? new ObjectID(data.actionValue)
          : null;

      const home: MicrosoftTeamsPersonHome | null =
        tenantId && aadObjectId
          ? await MicrosoftTeamsHome.getPersonHome({
              tenantId: tenantId,
              aadObjectId: aadObjectId,
              chosenProjectId: chosenProjectId || undefined,
            })
          : null;

      if (!home || home.isConnectedInNone) {
        await MicrosoftTeamsActionAnswer.reply({
          turnContext: data.turnContext,
          answer: MicrosoftTeamsHome.getSwitchRefusedAnswer(),
        });
        return;
      }

      const shownProjectId: ObjectID = home.projectAuth.projectId!;
      const isSwitched: boolean = Boolean(
        chosenProjectId &&
          MicrosoftTeamsHome.isSameId(shownProjectId, chosenProjectId),
      );

      if (isSwitched && home.isInSeveralProjects) {
        await WorkspaceHomeProject.rememberChosenProject({
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceUserId: aadObjectId,
          projectId: shownProjectId,
        });
      }

      /*
       * The card drawn again is the presser's, and so is every button on
       * it: it acts in the project it shows (MicrosoftTeamsCardProject).
       */
      if (home.isSharedOrganization) {
        MicrosoftTeamsCardProject.drawCardsFor({
          turnContext: data.turnContext,
          projectId: shownProjectId,
        });
      }

      await MicrosoftTeamsHome.drawHome({
        turnContext: data.turnContext,
        activity: data.activity,
        projectId: shownProjectId,
        projectMenu: MicrosoftTeamsHome.getProjectMenu({
          shownProjectId: shownProjectId,
          choices: home.choices,
        }),
        notice: isSwitched
          ? undefined
          : WorkspaceHome.getSwitchRefusedNotice(WorkspaceType.MicrosoftTeams),
        replacing: (data.activity["replyToId"] as string) || undefined,
      });
    } catch (err) {
      MicrosoftTeamsReplies.logFailure(
        "Could not switch a Microsoft Teams Home to another project",
        err,
        {},
      );
      await MicrosoftTeamsReplies.sendBestEffort(
        data.turnContext,
        "Sorry, I couldn't switch your Home just now. Please try again in a minute.",
      );
    }
  }

  /*
   * What a switch press from somebody connected in none of the
   * organization's projects is told, under the card it was pressed on.
   */
  public static getSwitchRefusedAnswer(): { markdown: string; text: string } {
    const notice: MarkdownText = WorkspaceHome.getSwitchRefusedNotice(
      WorkspaceType.MicrosoftTeams,
    );

    return {
      markdown: notice.toString(),
      text: "You can't switch to that project.",
    };
  }

  /*
   * The Home somebody is shown in an organization (see the header). For a
   * person connected as a member in two or more of its projects: the one
   * they choose now (`chosenProjectId`), or else the one they chose last
   * (WorkspaceHomeProject), while they are a member there - else the first
   * of their projects; with every one of them named, for the menu. For
   * anybody else: the project WorkspaceProjectResolution tells apart for
   * them. Null for an organization connected to no project.
   */
  @CaptureSpan()
  public static async getPersonHome(data: {
    tenantId: string;
    aadObjectId: string;
    chosenProjectId?: ObjectID | undefined;
  }): Promise<MicrosoftTeamsPersonHome | null> {
    const resolution: WorkspaceProjectResolution =
      await WorkspaceProjectResolver.resolve({
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceId: data.tenantId,
        clues: {
          workspaceUserId: data.aadObjectId,
        },
      });

    const memberProjectIds: Array<ObjectID> = resolution.memberProjectIds;

    if (memberProjectIds.length < 2) {
      const personProject: WorkspaceProjectAuthToken | null =
        WorkspaceProjectResolver.getPersonProject(resolution);

      const projectAuth: WorkspaceProjectAuthToken | null =
        personProject || resolution.connections[0] || null;

      if (!projectAuth?.projectId) {
        return null;
      }

      return {
        projectAuth: projectAuth,
        isConnectedInNone: !personProject,
        isInSeveralProjects: false,
        isSharedOrganization: resolution.connections.length > 1,
        choices: [],
        isRememberedProject: false,
      };
    }

    const memberProjectId: (
      projectId: ObjectID | null | undefined,
    ) => ObjectID | undefined = (
      projectId: ObjectID | null | undefined,
    ): ObjectID | undefined => {
      return memberProjectIds.find((memberId: ObjectID): boolean => {
        return MicrosoftTeamsHome.isSameId(memberId, projectId);
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
        await WorkspaceHomeProject.getChosenProject({
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceUserId: data.aadObjectId,
          memberProjectIds: memberProjectIds,
        }),
      );

      if (rememberedProjectId) {
        shownProjectId = rememberedProjectId;
        isRememberedProject = true;
      }
    }

    const projectAuth: WorkspaceProjectAuthToken | undefined =
      resolution.connections.find(
        (connection: WorkspaceProjectAuthToken): boolean => {
          return MicrosoftTeamsHome.isSameId(
            connection.projectId,
            shownProjectId,
          );
        },
      );

    if (!projectAuth?.projectId) {
      return null;
    }

    const choices: Array<WorkspaceProjectChoice> | null =
      await WorkspaceProjectResolver.getProjectChoices(memberProjectIds);

    return {
      projectAuth: projectAuth,
      isConnectedInNone: false,
      isInSeveralProjects: true,
      isSharedOrganization: true,
      choices: choices || [],
      isRememberedProject: isRememberedProject,
    };
  }

  /*
   * The project a Home - typed `home`, or the welcome - opens on for
   * somebody nothing else tells the project of (`resolution`, ambiguous): a
   * member in two or more of the organization's projects sees the one they
   * chose last, else the first of theirs, never asked which first. Null for
   * anybody else, who is asked or told as before. Never throws.
   */
  @CaptureSpan()
  public static async findPersonHomeProject(data: {
    aadObjectId: string;
    resolution: WorkspaceProjectResolution | undefined;
  }): Promise<WorkspaceProjectAuthToken | null> {
    const resolution: WorkspaceProjectResolution | undefined = data.resolution;

    if (!resolution?.isAmbiguous || resolution.memberProjectIds.length < 2) {
      return null;
    }

    const chosen: ObjectID | null = await WorkspaceHomeProject.getChosenProject(
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: data.aadObjectId,
        memberProjectIds: resolution.memberProjectIds,
      },
    );

    const shownProjectId: ObjectID = chosen || resolution.memberProjectIds[0]!;

    return (
      resolution.connections.find(
        (connection: WorkspaceProjectAuthToken): boolean => {
          return MicrosoftTeamsHome.isSameId(
            connection.projectId,
            shownProjectId,
          );
        },
      ) || null
    );
  }

  /*
   * The Home's Switch project menu: the person's projects other than the
   * one shown (WorkspaceHome.getProjectMenu), sent by its button as the
   * press's actionValue (MicrosoftTeamsUtil.getMenuElements).
   */
  public static getProjectMenu(data: {
    shownProjectId: ObjectID;
    choices: Array<WorkspaceProjectChoice>;
  }): WorkspacePayloadMenu | null {
    return WorkspaceHome.getProjectMenu({
      actionId: MicrosoftTeamsHomeActionType.SwitchProject,
      shownProjectId: data.shownProjectId,
      choices: data.choices,
    });
  }

  /*
   * The Switch project menu of the Home of `projectId`, for the person an
   * activity is from: their projects in the organization, read again now -
   * null when they are a member of fewer than two, or the project is not
   * one of theirs. Never throws: without it, the Home is drawn without one.
   */
  @CaptureSpan()
  public static async readProjectMenu(data: {
    activity: JSONObject;
    projectId: ObjectID;
  }): Promise<WorkspacePayloadMenu | null> {
    const tenantId: string = MicrosoftTeamsHome.getTenantId(data.activity);
    const aadObjectId: string = MicrosoftTeamsHome.getAadObjectId(
      data.activity,
    );

    if (!tenantId || !aadObjectId) {
      return null;
    }

    try {
      const resolution: WorkspaceProjectResolution =
        await WorkspaceProjectResolver.resolve({
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceId: tenantId,
          clues: {
            workspaceUserId: aadObjectId,
          },
        });

      if (resolution.memberProjectIds.length < 2) {
        return null;
      }

      const choices: Array<WorkspaceProjectChoice> | null =
        await WorkspaceProjectResolver.getProjectChoices(
          resolution.memberProjectIds,
        );

      return MicrosoftTeamsHome.getProjectMenu({
        shownProjectId: data.projectId,
        choices: choices || [],
      });
    } catch (err) {
      logger.debug(
        "Could not read the projects of a Microsoft Teams Home's person; drawing it without Switch project.",
      );
      logger.debug(err);
      return null;
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
      const teamsUserId: string = MicrosoftTeamsHome.getAadObjectId(activity);

      const isConnected: boolean = teamsUserId
        ? await MicrosoftTeamsHome.isConnected({
            teamsUserId: teamsUserId,
            projectId: data.projectId,
          })
        : false;

      if (isConnected) {
        await MicrosoftTeamsHome.drawHome({
          turnContext: data.turnContext,
          activity: activity,
          projectId: data.projectId,
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
   * `projectMenu` is its Switch project menu: read for the person when not
   * given (readProjectMenu), none for null. `notice` is said first, under
   * the greeting.
   */
  @CaptureSpan()
  public static async sendHome(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    replacing?: string | undefined;
    projectMenu?: WorkspacePayloadMenu | null | undefined;
    notice?: MarkdownText | undefined;
  }): Promise<void> {
    const projectMenu: WorkspacePayloadMenu | null =
      data.projectMenu !== undefined
        ? data.projectMenu
        : await MicrosoftTeamsHome.readProjectMenu({
            activity: data.turnContext.activity as unknown as JSONObject,
            projectId: data.projectId,
          });

    const view: WorkspaceHomeView = await WorkspaceHome.read({
      projectId: data.projectId,
      userId: data.props.userId!,
      props: data.props,
    });

    /*
     * The menu goes with the line that names the project: named as the menu
     * names it, should the Home's own read of the name have failed.
     */
    if (projectMenu && !view.projectName) {
      view.projectName = await MicrosoftTeamsHome.readProjectName(
        data.projectId,
      );
    }

    const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.MicrosoftTeams,
      view: view,
      actions: MICROSOFT_TEAMS_HOME_ACTIONS,
      projectMenu: projectMenu || undefined,
      notice: data.notice,
    });

    await MicrosoftTeamsHome.sendCard({
      turnContext: data.turnContext,
      blocks: blocks,
      summary: WorkspaceHome.getNotificationText(view),
      replacing: data.replacing,
    });
  }

  /*
   * The Home of `projectId` for the person an activity is from, read as the
   * member their Teams account is connected to there: sent, or drawn in
   * place of the card `replacing`. Not connected there: asked to connect,
   * in a reply. Refused there - blocked by an administrator, or left a
   * moment ago - with projects of theirs to switch to (`projectMenu`): the
   * Home names the project, says why, and keeps the menu, so they can switch
   * away; without: the refusal in a reply, as every refusal is.
   */
  @CaptureSpan()
  public static async drawHome(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
    projectMenu?: WorkspacePayloadMenu | null | undefined;
    notice?: MarkdownText | undefined;
    replacing?: string | undefined;
  }): Promise<void> {
    const teamsUserId: string = MicrosoftTeamsHome.getAadObjectId(
      data.activity,
    );

    let userId: ObjectID;

    try {
      userId = await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId(
        {
          teamsUserId: teamsUserId,
          projectId: data.projectId,
        },
      );
    } catch (err) {
      if (err instanceof MicrosoftTeamsAccountNotLinkedException) {
        await MicrosoftTeamsConnectPrompt.prompt({
          turnContext: data.turnContext,
          projectId: data.projectId,
          description: MicrosoftTeamsConnectPrompt.describeCommand({
            purpose: HOME_PURPOSE,
            command: MICROSOFT_TEAMS_HOME_COMMAND,
          }),
        });
        return;
      }

      throw err;
    }

    const projectMenu: WorkspacePayloadMenu | null =
      data.projectMenu !== undefined
        ? data.projectMenu
        : await MicrosoftTeamsHome.readProjectMenu({
            activity: data.activity,
            projectId: data.projectId,
          });

    let props: DatabaseCommonInteractionProps;

    try {
      props = await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: data.projectId,
      });
    } catch (err) {
      if (!(err instanceof NotAuthorizedException)) {
        throw err;
      }

      if (!projectMenu) {
        // Placed as text: a refusal can name a label, a record or a person.
        await MicrosoftTeamsActionAnswer.reply({
          turnContext: data.turnContext,
          answer: {
            markdown: mdText`${err.message}`.toString(),
            text: err.message,
          },
        });
        return;
      }

      await MicrosoftTeamsHome.sendCard({
        turnContext: data.turnContext,
        blocks: WorkspaceHome.getRefusedBlocks({
          message: err.message,
          firstName: await WorkspaceHome.readFirstName(userId),
          projectName: await MicrosoftTeamsHome.readProjectName(data.projectId),
          projectMenu: projectMenu,
          notice: data.notice,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }),
        summary: err.message,
        replacing: data.replacing,
      });
      return;
    }

    await MicrosoftTeamsHome.sendHome({
      turnContext: data.turnContext,
      projectId: data.projectId,
      props: props,
      replacing: data.replacing,
      projectMenu: projectMenu,
      notice: data.notice,
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

  // Whether the Teams account is connected to somebody in the project.
  private static async isConnected(data: {
    teamsUserId: string;
    projectId: ObjectID;
  }): Promise<boolean> {
    try {
      await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
        teamsUserId: data.teamsUserId,
        projectId: data.projectId,
      });
      return true;
    } catch (err) {
      logger.debug("A Microsoft Teams user without a member to welcome as.");
      logger.debug(err);
      return false;
    }
  }

  // A project's name, for the line that names it; null when it cannot be read.
  private static async readProjectName(
    projectId: ObjectID,
  ): Promise<string | null> {
    const choices: Array<WorkspaceProjectChoice> | null =
      await WorkspaceProjectResolver.getProjectChoices([projectId]);

    return choices?.[0]?.name || null;
  }

  // The Microsoft 365 organization an activity was sent in.
  private static getTenantId(activity: JSONObject): string {
    const channelData: JSONObject | undefined = activity["channelData"] as
      | JSONObject
      | undefined;
    const tenant: unknown = (
      channelData?.["tenant"] as JSONObject | undefined
    )?.["id"];
    const conversationTenant: unknown = (
      activity["conversation"] as JSONObject | undefined
    )?.["tenantId"];

    if (typeof tenant === "string" && tenant) {
      return tenant;
    }

    return typeof conversationTenant === "string" ? conversationTenant : "";
  }

  // Its sender's Microsoft Entra object id.
  private static getAadObjectId(activity: JSONObject): string {
    const aadObjectId: unknown = (activity["from"] as JSONObject | undefined)?.[
      "aadObjectId"
    ];

    return typeof aadObjectId === "string" ? aadObjectId : "";
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
