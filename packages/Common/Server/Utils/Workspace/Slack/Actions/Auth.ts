import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import { ExpressRequest } from "../../../Express";
import SlackUtil from "../Slack";
import SlackActionType from "./ActionTypes";
import logger from "../../../Logger";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import Dictionary from "../../../../../Types/Dictionary";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import SlackModalMetadata, {
  SlackModalMetadataValue,
} from "../SlackModalMetadata";
import SlackActionAnswer, {
  SlackAnswerDelivery,
  SlackAnswerPlace,
} from "./Answer";
import SlackConnectPrompt from "./ConnectPrompt";
import { SLACK_ID_PATTERN } from "../../../../../Types/Workspace/ConnectCallback";
import SlackCommandParser from "../SlackCommandParser";
import SlackOverflowMenu, {
  SLACK_OVERFLOW_MENU_ACTION_ID,
  SlackOverflowChoice,
} from "../SlackOverflowMenu";
import WorkspaceProjectResolver, {
  WorkspaceAmbiguousRetry,
  WorkspaceAmbiguousRetryKind,
  WorkspaceProjectResolution,
} from "../../WorkspaceProjectResolution";
import { WorkspaceAnswer } from "../../WorkspaceActionAnswers";
import WorkspaceCommands, {
  WorkspaceCommandName,
} from "../../WorkspaceCommands";
import SlackProjectChoice, {
  SlackProjectChoiceKind,
} from "../SlackProjectChoice";

// The forms whose value is the channel they were opened in.
const NEW_RECORD_FORMS: ReadonlyArray<SlackActionType> = [
  SlackActionType.SubmitNewIncident,
  SlackActionType.SubmitNewScheduledMaintenance,
];

// The app's shortcuts (its manifest), and the commands that do the same.
const SHORTCUT_COMMANDS: Partial<
  Record<SlackActionType, WorkspaceCommandName>
> = {
  [SlackActionType.NewIncident]: WorkspaceCommandName.Incident,
  [SlackActionType.NewScheduledMaintenance]: WorkspaceCommandName.Maintenance,
};

export interface SlackAction {
  actionValue?: string | undefined;
  actionType?: SlackActionType | undefined;
  /*
   * Chosen from a message's menu (⋯), as the press of the button it stands
   * for (SlackOverflowMenu): an answer that asks to press it again says to
   * choose it from the menu.
   */
  isMenuChoice?: boolean | undefined;
  /*
   * For a slash command: how it was typed, without what followed it -
   * "/oneuptime incident", or an older app's "/incident" - for an answer
   * that asks to run it again (SlackConnectPrompt). A button, a form or a
   * shortcut has none.
   */
  command?: string | undefined;
}

// Why a press is not acted on, for SlackAuthAction.answerRefusal to say.
export enum SlackAuthRefusalReason {
  // The Slack account is not connected to a OneUptime user in the project.
  NotConnected = "NotConnected",
  // It is, but that user is no longer a member of the project.
  NotAMember = "NotAMember",
  /*
   * The workspace is connected to more than one project, and nothing the
   * press carries tells which one it is about (WorkspaceProjectResolution).
   */
  AmbiguousProject = "AmbiguousProject",
}

export interface SlackAuthRefusal {
  reason: SlackAuthRefusalReason;
  /*
   * The project the press was read in: where a Connect button connects the
   * account. For an ambiguous press, the workspace's first connection's.
   */
  projectId: ObjectID;
  // The press that was refused: what the answer is about.
  action: SlackAction;
  // An ambiguous press: what was read of the projects and the person.
  resolution?: WorkspaceProjectResolution | undefined;
}

export interface SlackRequest {
  isAuthorized: boolean;
  userId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  projectAuthToken?: string | undefined;
  userAuthToken?: string | undefined;
  botUserId?: string | undefined;
  // The Slack workspace the press was made in.
  slackTeamId?: string | undefined;
  /*
   * The channel the press was made in - for a form's submission, the one
   * the form was opened from (SlackModalMetadata).
   */
  slackChannelId?: string | undefined;
  // The thread the press was made in, when it was in one.
  slackThreadTs?: string | undefined;
  slackMessageId?: string | undefined;
  slackUserFullName?: string | undefined;
  slackUserId?: string | undefined;
  slackUsername?: string | undefined;
  /*
   * Where Slack takes an answer to the press, only for the person who
   * pressed (buttons and slash commands): see SlackActionAnswer.
   */
  responseUrl?: string | undefined;
  actions?: SlackAction[] | undefined;
  triggerId?: string | undefined;
  payloadType?: string | undefined;
  view?: JSONObject | undefined; // view object from slack.
  viewValues?:
    | Dictionary<string | number | Array<string | number> | Date>
    | undefined;
  // Why the press is not acted on, when it is not (isAuthorized false).
  refusal?: SlackAuthRefusal | undefined;
  /*
   * The kind of view a press was made in: "home" for the app's Home tab
   * (SlackHome), "modal" for a form. None for a message's button.
   */
  slackViewType?: string | undefined;
  /*
   * The press was made on a message only its presser sees - the incident a
   * command answered with - or on a form opened from one: nobody else sees
   * what it does, so it is answered with what it did.
   */
  isFromPrivateMessage?: boolean | undefined;
  /*
   * What Slack sent, as read: a press that could be about more than one
   * project is made again from it once its person chooses which
   * (SlackProjectChoice).
   */
  payload?: JSONObject | undefined;
  /*
   * A press made again once its project was chosen in a modal: a form it
   * opens, or an answer in a modal, takes that modal's place.
   */
  replaceViewId?: string | undefined;
}

/*
 * What a Slack user may do without a Slack account connected to a current
 * member of the project: open links. Everything that reads or writes the
 * project's records acts as the member the Slack account is connected to,
 * with that member's own permissions - declaring an incident included
 * (/oneuptime incident and its form), so an incident is never created by
 * nobody, and its form lists only what its member may read. No project
 * setting lets anyone in the workspace declare without connecting an
 * account.
 *
 * A link button opens its link in the browser, and Slack reports the click
 * too: such a report needs nothing but an acknowledgement, never a "connect
 * your account" answer. Every View button of a message, the incident's
 * call, and the Connect button of such an answer are links.
 */
const slackActionTypesThatDoNotRequireUserSlackAccountToBeConnectedToOneUptime: Array<SlackActionType> =
  [
    SlackActionType.ViewIncident,

    // Alerts
    SlackActionType.ViewAlert,

    // Episodes
    SlackActionType.ViewIncidentEpisode,
    SlackActionType.ViewAlertEpisode,

    // scheduled maintenance
    SlackActionType.ViewScheduledMaintenance,

    // Monitors and on-call policies
    SlackActionType.ViewMonitor,
    SlackActionType.ViewOnCallPolicy,

    /*
     * Anyone in the channel joins the incident's call: it is a link, and
     * the meeting decides who gets in.
     */
    SlackActionType.JoinVideoCall,

    // The Connect button itself: a link to connect the account.
    SlackActionType.ConnectSlackAccount,

    // A link to a page in OneUptime (SlackWelcome).
    SlackActionType.OpenInOneUptime,

    /*
     * A project chosen for a request (SlackProjectChoice): it reads and
     * writes nothing itself. The request it makes again is read in full -
     * the account, the membership, the permissions - in that project.
     */
    SlackActionType.ChooseProject,

    /*
     * The Home's Switch project menu (SlackHome): it reads and writes
     * nothing itself. The Home it draws again is read in full for the
     * project chosen - the person's connected accounts and memberships in
     * the workspace's projects, read again, then their own permissions
     * there - and a project they may not see is never drawn.
     */
    SlackActionType.SwitchHomeProject,
  ];

export default class SlackAuthAction {
  // Whether a press of `actionType` needs a connected account.
  public static requiresConnectedAccount(
    actionType: SlackActionType | undefined,
  ): boolean {
    return (
      Boolean(actionType) &&
      !slackActionTypesThatDoNotRequireUserSlackAccountToBeConnectedToOneUptime.includes(
        actionType!,
      )
    );
  }

  /*
   * How somebody makes a press that could be about more than one project
   * again where it can be told apart (WorkspaceProjectResolution): from a
   * channel of the project they mean - except a shortcut from Slack's
   * shortcuts menu, which never says where it was used: it is pointed to
   * the command that does the same, "/oneuptime incident".
   */
  public static getAmbiguousRetry(data: {
    payloadType: string | undefined;
    actionType: string | undefined;
  }): WorkspaceAmbiguousRetry {
    const command: WorkspaceCommandName | undefined =
      data.payloadType === "shortcut"
        ? SHORTCUT_COMMANDS[data.actionType as SlackActionType]
        : undefined;

    if (!command) {
      return { kind: WorkspaceAmbiguousRetryKind.Again };
    }

    return {
      kind: WorkspaceAmbiguousRetryKind.Command,
      command: WorkspaceCommands.getUsage({
        workspaceType: WorkspaceType.Slack,
        command: command,
      }),
    };
  }

  /*
   * Reads a Slack request - a button, a form's submission, a shortcut or a
   * slash command - and who made it: the project the Slack workspace is
   * connected to, and the OneUptime member the Slack account is connected
   * to. Says nothing to anybody: a press that is refused comes back with
   * isAuthorized false and why (refusal), and the caller answers Slack
   * first, then the person (answerRefusal), where they pressed.
   *
   * A request made again once its person chose its project
   * (SlackProjectChoice) is read from `payload`, what Slack sent of it,
   * with `chosenProjectId` telling its project apart; a form it opens takes
   * the place of `replaceViewId`, the modal they chose in.
   */
  @CaptureSpan()
  public static async isAuthorized(data: {
    req: ExpressRequest;
    payload?: JSONObject | undefined;
    chosenProjectId?: ObjectID | undefined;
    replaceViewId?: string | undefined;
  }): Promise<SlackRequest> {
    const { req } = data;

    logger.debug("Starting Slack request authorization");

    let payload: JSONObject = data.payload || req.body;

    if (payload["payload"] && typeof payload["payload"] === "string") {
      payload = JSON.parse(payload["payload"]);
    }

    let slackUserId: string | undefined = (
      (payload as JSONObject)["user"] as JSONObject
    )?.["id"] as string;
    let slackTeamId: string | undefined = (
      (payload as JSONObject)["team"] as JSONObject
    )?.["id"] as string;

    // if there are no actions then return.
    if (
      (!payload["actions"] || (payload["actions"] as JSONArray).length === 0) &&
      payload["type"] !== "view_submission" &&
      payload["type"] !== "shortcut" &&
      payload["type"] !== "app_uninstalled" &&
      !payload["command"]
    ) {
      logger.debug("No actions found in payload. Returning unauthorized.");
      return {
        isAuthorized: false,
      };
    }

    const actions: SlackAction[] = (
      (payload["actions"] || []) as JSONArray
    ).map((action: JSONObject) => {
      /*
       * A choice of a message's overflow menu (⋯) is the press of the
       * button it stands for: its option's value names that button's
       * action and value (SlackOverflowMenu).
       */
      if (action["action_id"] === SLACK_OVERFLOW_MENU_ACTION_ID) {
        const choice: SlackOverflowChoice | null = SlackOverflowMenu.decode(
          (action["selected_option"] as JSONObject | undefined)?.["value"],
        );

        if (choice) {
          return {
            actionValue: choice.actionValue,
            actionType: choice.actionType as SlackActionType,
            isMenuChoice: true,
          };
        }
      }

      /*
       * A project chosen for a request: each button's action id carries its
       * place among them (SlackProjectChoice).
       */
      if (SlackProjectChoice.isChoiceActionId(action["action_id"])) {
        return {
          actionValue: action["value"] as string,
          actionType: SlackActionType.ChooseProject,
        };
      }

      return {
        actionValue: action["value"] as string,
        actionType: action["action_id"] as SlackActionType,
      };
    });

    // A message only the person who pressed sees (chat.postEphemeral, a response_url).
    let isFromPrivateMessage: boolean =
      ((payload["container"] as JSONObject | undefined)?.["is_ephemeral"] as
        | boolean
        | undefined) === true;

    let slackChannelId: string | undefined = (
      (payload as JSONObject)?.["channel"] as JSONObject
    )?.["id"] as string;

    if (!slackChannelId) {
      slackChannelId = (payload as JSONObject)?.["channel_id"] as string;
    }

    const slackMessageId: string | undefined = (
      (payload as JSONObject)?.["message"] as JSONObject
    )?.["ts"] as string;

    /*
     * A button on a message in a thread: Slack names the thread on the
     * press's container (and on the message).
     */
    let slackThreadTs: string | undefined =
      (((payload as JSONObject)?.["container"] as JSONObject | undefined)?.[
        "thread_ts"
      ] as string | undefined) ||
      (((payload as JSONObject)?.["message"] as JSONObject | undefined)?.[
        "thread_ts"
      ] as string | undefined) ||
      undefined;

    const responseUrl: string | undefined =
      typeof payload["response_url"] === "string"
        ? (payload["response_url"] as string)
        : undefined;

    const slackUserFullName: string | undefined = (
      (payload as JSONObject)?.["user"] as JSONObject
    )?.["name"] as string;

    let slackUsername: string | undefined = (
      (payload as JSONObject)?.["user"] as JSONObject
    )?.["username"] as string;

    if (payload["user_id"]) {
      slackUserId = payload["user_id"] as string;
    }

    if (payload["user_name"]) {
      slackUsername = payload["user_name"] as string;
    }

    if (payload["team_id"]) {
      slackTeamId = payload["team_id"] as string;
    }

    const triggerId: string | undefined = payload?.["trigger_id"] as string;

    const view: JSONObject | undefined =
      (payload["view"] as JSONObject) || undefined;

    let viewValues: Dictionary<
      string | number | Array<string | number> | Date
    > = {};

    /*
     * The project a form, or the app's Home, was drawn for, which it
     * carries (SlackModalMetadata): what a press in it is about.
     */
    let drawnForProjectId: string | undefined = undefined;

    if (view) {
      viewValues = SlackUtil.getValuesFromView({
        view: view,
      });

      /*
       * The view's private metadata: the value its form carries (the
       * record's id), and where the form was opened, so its submission is
       * answered there (SlackModalMetadata).
       */
      const metadata: SlackModalMetadataValue = SlackModalMetadata.read(
        view["private_metadata"],
      );

      if (!slackChannelId && metadata.origin.channelId) {
        slackChannelId = metadata.origin.channelId;
      }

      if (!slackThreadTs && metadata.origin.threadTs) {
        slackThreadTs = metadata.origin.threadTs;
      }

      if (metadata.origin.isFromPrivateMessage) {
        isFromPrivateMessage = true;
      }

      drawnForProjectId = metadata.origin.projectId;

      /*
       * The New Incident and New Scheduled Maintenance forms carry the
       * channel they were opened in as their value - bare, in a form opened
       * before forms carried where they were opened.
       */
      if (
        !slackChannelId &&
        NEW_RECORD_FORMS.includes(view["callback_id"] as SlackActionType) &&
        metadata.value &&
        SLACK_ID_PATTERN.test(metadata.value)
      ) {
        slackChannelId = metadata.value;
      }

      // add actionId and actionValue

      const action: SlackAction = {
        // view callbackId
        actionType: view["callback_id"] as SlackActionType,
        // private metadata
        actionValue: metadata.value,
      };

      actions.push(action);
    }

    if (payload["callback_id"]) {
      const action: SlackAction = {
        actionType: payload["callback_id"] as SlackActionType,
      };

      actions.push(action);
    }

    /*
     * A slash command: /oneuptime and its words, or an older app's
     * /incident or /maintenance (SlackCommandParser), as the action it asks
     * for - the New Incident form with its title, say.
     */
    if (payload["command"]) {
      actions.push(
        SlackCommandParser.getAction(
          SlackCommandParser.read({
            command: payload["command"],
            text: payload["text"],
          }),
        ),
      );
    }

    /*
     * The project its person chose for it - a request made again, or the
     * press of the button they chose with (SlackProjectChoice) - tells it
     * apart as the project a form was drawn for does, and before it.
     */
    const chosenProjectId: string | undefined =
      data.chosenProjectId?.toString() ||
      SlackProjectChoice.readChoice(
        actions.find((action: SlackAction): boolean => {
          return action.actionType === SlackActionType.ChooseProject;
        })?.actionValue,
      )?.projectId.toString();

    if (chosenProjectId) {
      drawnForProjectId = chosenProjectId;
    }

    // The first press that reads or writes the project's records, if any.
    const memberAction: SlackAction | undefined = actions.find(
      (action: SlackAction): boolean => {
        return SlackAuthAction.requiresConnectedAccount(action.actionType);
      },
    );

    /*
     * The project the press is about. A Slack workspace can be connected to
     * more than one project, and Slack names only the workspace: the
     * project is told from what the press carries - the record a button or
     * a form is about, the project a form was drawn for, the channel, the
     * person (WorkspaceProjectResolution) - and never from whichever of the
     * workspace's connections a lookup returns first, which read an
     * incident's buttons, in its own channel, in another project.
     */
    const resolution: WorkspaceProjectResolution =
      await WorkspaceProjectResolver.resolve({
        workspaceType: WorkspaceType.Slack,
        workspaceId: slackTeamId || "",
        clues: {
          recordIds: actions.map((action: SlackAction): string | undefined => {
            return action.actionValue;
          }),
          drawnForProjectId: drawnForProjectId,
          channelId: slackChannelId,
          workspaceUserId: slackUserId,
        },
      });

    if (resolution.isAmbiguous && memberAction && resolution.connections[0]) {
      const firstConnection: WorkspaceProjectAuthToken =
        resolution.connections[0];

      logger.debug(
        "Slack press could be about more than one connected project; asking which.",
        {
          projectId: firstConnection.projectId?.toString(),
        },
      );

      /*
       * Answered where they pressed (answerRefusal), by the workspace's
       * app - every connection's token is the same app's - and read in no
       * project.
       */
      return {
        isAuthorized: false,
        slackUserId: slackUserId,
        payloadType: payload["type"] as string,
        slackViewType:
          typeof view?.["type"] === "string"
            ? (view["type"] as string)
            : undefined,
        projectAuthToken: firstConnection.authToken || undefined,
        slackTeamId: slackTeamId,
        slackChannelId: slackChannelId,
        slackThreadTs: slackThreadTs,
        slackUsername: slackUsername,
        slackMessageId: slackMessageId,
        slackUserFullName: slackUserFullName,
        responseUrl: responseUrl,
        actions: actions,
        triggerId: triggerId,
        view: view,
        viewValues: viewValues,
        ...(isFromPrivateMessage ? { isFromPrivateMessage: true } : {}),
        payload: payload,
        ...(data.replaceViewId ? { replaceViewId: data.replaceViewId } : {}),
        refusal: {
          reason: SlackAuthRefusalReason.AmbiguousProject,
          projectId: firstConnection.projectId!,
          action: memberAction,
          resolution: resolution,
        },
      };
    }

    /*
     * A link - View Incident, Join call - reads and writes nothing: any of
     * the workspace's connections acknowledges it.
     */
    const projectAuth: WorkspaceProjectAuthToken | null =
      resolution.projectAuth || resolution.connections[0] || null;

    if (!projectAuth) {
      return {
        isAuthorized: false,
      };
    }

    const projectId: ObjectID | undefined = projectAuth.projectId;

    if (!projectId) {
      logger.debug(
        "Project ID not found in project auth. Returning unauthorized.",
      );
      return {
        isAuthorized: false,
      };
    }

    /*
     * The member who signed in to Slack as this account in the project - a
     * Slack link, never another chat's (WorkspaceUserAuthToken).
     */
    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          workspaceUserId: slackUserId,
          workspaceType: WorkspaceType.Slack,
          projectId: projectId,
        },
        select: {
          userId: true,
          authToken: true,
        },
        props: {
          isRoot: true,
        },
      });

    const botUserId: string | undefined = (
      projectAuth.miscData as SlackMiscData
    )?.botUserId;

    let userId: ObjectID | undefined = userAuth?.userId;

    /*
     * A connected Slack account outlives the membership it was connected
     * under. Someone removed from the project acts here as a Slack user with
     * no OneUptime account, never as the OneUptime user they used to be.
     */
    let isRemovedFromProject: boolean = false;

    if (
      userId &&
      !(await WorkspaceActionAuthorization.isProjectMember({
        userId: userId,
        projectId: projectId,
      }))
    ) {
      logger.debug(
        "Slack user is linked to a user who is no longer a project member.",
        {
          projectId: projectId.toString(),
        },
      );
      userId = undefined;
      isRemovedFromProject = true;
    }

    const slackRequest: SlackRequest = {
      isAuthorized: true,
      slackUserId: slackUserId,
      payloadType: payload["type"] as string,
      slackViewType:
        typeof view?.["type"] === "string"
          ? (view["type"] as string)
          : undefined,
      userId: userId,
      projectId: projectId,
      projectAuthToken: projectAuth.authToken!,
      userAuthToken: userId ? userAuth?.authToken : undefined,
      botUserId: botUserId,
      slackTeamId: slackTeamId,
      slackChannelId: slackChannelId,
      slackThreadTs: slackThreadTs,
      slackUsername: slackUsername,
      slackMessageId: slackMessageId,
      slackUserFullName: slackUserFullName,
      responseUrl: responseUrl,
      actions: actions,
      triggerId: triggerId,
      view: view,
      viewValues: viewValues,
      ...(isFromPrivateMessage ? { isFromPrivateMessage: true } : {}),
      payload: payload,
      ...(data.replaceViewId ? { replaceViewId: data.replaceViewId } : {}),
    };

    // check if all the actions are authed.
    if (!userId) {
      for (const action of actions) {
        if (SlackAuthAction.requiresConnectedAccount(action.actionType)) {
          logger.debug(
            isRemovedFromProject
              ? "Slack user is no longer a project member. Returning unauthorized."
              : "Slack user has not connected a OneUptime account. Returning unauthorized.",
            { projectId: projectId.toString() },
          );

          slackRequest.isAuthorized = false;
          slackRequest.refusal = {
            reason: isRemovedFromProject
              ? SlackAuthRefusalReason.NotAMember
              : SlackAuthRefusalReason.NotConnected,
            projectId: projectId,
            action: action,
          };

          return slackRequest;
        }
      }
    }

    logger.debug("Slack request authorized successfully", {
      projectId: projectId.toString(),
    });

    return slackRequest;
  }

  /*
   * Tells the person a refused press is about why, where they pressed
   * (SlackActionAnswer) - never in a direct message they will not see:
   *
   *   - a Slack account not connected yet: what they pressed, and a Connect
   *     button that connects it and then finishes the press for them
   *     (SlackConnectPrompt);
   *   - one connected to somebody who has left the project: that their
   *     account is not a member, and to ask an admin;
   *   - a press that could be about more than one of the projects the
   *     workspace is connected to: which of the projects they are in they
   *     mean, a button for each, and the press made again in the one they
   *     choose (SlackProjectChoice) - or, when that cannot be asked, which
   *     projects they are in, and to press or run it where it can be told
   *     apart; connected in none, how to connect
   *     (WorkspaceProjectResolution.getAmbiguousAnswer).
   *
   * Called once Slack has been answered. Never throws.
   */
  @CaptureSpan()
  public static async answerRefusal(
    slackRequest: SlackRequest,
  ): Promise<SlackAnswerDelivery> {
    const refusal: SlackAuthRefusal | undefined = slackRequest.refusal;

    const place: SlackAnswerPlace | null =
      SlackActionAnswer.getPlace(slackRequest);

    if (!refusal || !place) {
      return SlackAnswerDelivery.None;
    }

    try {
      if (
        refusal.reason === SlackAuthRefusalReason.AmbiguousProject &&
        refusal.resolution
      ) {
        /*
         * A press that can be made again in the project they choose: asked
         * which, with a button for each project they are in, and made again
         * there (SlackProjectChoice) - answered as below when it cannot be.
         */
        if (
          SlackProjectChoice.canMakeAgain({
            actionType: refusal.action.actionType,
            payloadType: slackRequest.payloadType,
            payload: slackRequest.payload,
          })
        ) {
          const delivery: SlackAnswerDelivery | null =
            await SlackProjectChoice.offer({
              place: place,
              teamId: slackRequest.slackTeamId,
              slackUserId: slackRequest.slackUserId,
              resolution: refusal.resolution,
              request: {
                kind: SlackProjectChoiceKind.Press,
                payload: SlackProjectChoice.getPressPayload(
                  slackRequest.payload!,
                ),
              },
            });

          if (delivery !== null) {
            return delivery;
          }
        }

        const answer: WorkspaceAnswer =
          await WorkspaceProjectResolver.getAmbiguousAnswer({
            workspaceType: WorkspaceType.Slack,
            resolution: refusal.resolution,
            retry: SlackAuthAction.getAmbiguousRetry({
              payloadType: slackRequest.payloadType,
              actionType: refusal.action.actionType,
            }),
          });

        return await SlackActionAnswer.answer({
          place: place,
          answer: answer,
        });
      }

      if (refusal.reason === SlackAuthRefusalReason.NotAMember) {
        return await SlackActionAnswer.answer({
          place: place,
          answer: {
            markdown:
              mdText`${WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE}`.toString(),
            text: WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
          },
        });
      }

      return await SlackConnectPrompt.prompt({
        projectId: refusal.projectId,
        place: place,
        slackTeamId: slackRequest.slackTeamId,
        description: SlackConnectPrompt.describe({
          actionType: refusal.action.actionType,
          actionValue: refusal.action.actionValue,
          payloadType: slackRequest.payloadType,
          command: refusal.action.command,
          isMenuChoice: refusal.action.isMenuChoice,
        }),
      });
    } catch (err) {
      logger.error("Could not answer a refused Slack press.", {
        projectId: refusal.projectId.toString(),
      });
      logger.error(err, { projectId: refusal.projectId.toString() });
      return SlackAnswerDelivery.None;
    }
  }
}
