import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import { MicrosoftTeamsIncidentEpisodeActionType } from "./ActionTypes";
import logger from "../../../Logger";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentEpisodeService from "../../../../Services/IncidentEpisodeService";
import IncidentEpisode from "../../../../../Models/DatabaseModels/IncidentEpisode";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventStateOption,
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
import IncidentEpisodeStateTimeline from "../../../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentEpisodeInternalNote from "../../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import IncidentEpisodeInternalNoteService from "../../../../Services/IncidentEpisodeInternalNoteService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import MicrosoftTeamsReplies from "../MicrosoftTeamsReplies";
import FeedMarkdown, {
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";

export default class MicrosoftTeamsIncidentEpisodeActions {
  // What a change-state card says instead of opening with nothing to pick.
  public static readonly NO_STATES_MESSAGE: string =
    "No incident states are available to you in this project. Ask a project admin for access to them.";

  @CaptureSpan()
  public static isIncidentEpisodeAction(data: { actionType: string }): boolean {
    return (
      data.actionType.includes("IncidentEpisode") ||
      data.actionType ===
        MicrosoftTeamsIncidentEpisodeActionType.AckIncidentEpisode ||
      data.actionType ===
        MicrosoftTeamsIncidentEpisodeActionType.ResolveIncidentEpisode ||
      data.actionType ===
        MicrosoftTeamsIncidentEpisodeActionType.ViewIncidentEpisode ||
      data.actionType ===
        MicrosoftTeamsIncidentEpisodeActionType.IncidentEpisodeCreated ||
      data.actionType ===
        MicrosoftTeamsIncidentEpisodeActionType.IncidentEpisodeStateChanged ||
      data.actionType ===
        MicrosoftTeamsIncidentEpisodeActionType.ViewAddIncidentEpisodeNote ||
      data.actionType ===
        MicrosoftTeamsIncidentEpisodeActionType.SubmitIncidentEpisodeNote ||
      data.actionType ===
        MicrosoftTeamsIncidentEpisodeActionType.ViewExecuteIncidentEpisodeOnCallPolicy ||
      data.actionType ===
        MicrosoftTeamsIncidentEpisodeActionType.SubmitExecuteIncidentEpisodeOnCallPolicy ||
      data.actionType ===
        MicrosoftTeamsIncidentEpisodeActionType.ViewChangeIncidentEpisodeState ||
      data.actionType ===
        MicrosoftTeamsIncidentEpisodeActionType.SubmitChangeIncidentEpisodeState
    );
  }

  @CaptureSpan()
  public static async handleIncidentEpisodeAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { action } = data;

    logger.debug("Handling Microsoft Teams incident episode action:");
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsIncidentEpisodeActionType.ViewIncidentEpisode:
          // This is handled by opening the URL directly
          break;

        default:
          logger.debug(
            "Unhandled incident episode action: " + action.actionType,
          );
          break;
      }
    } catch (error) {
      logger.error("Error handling Microsoft Teams incident episode action:");
      logger.error(error);
    }

    Response.sendTextResponse(data.req, data.res, "");
  }

  @CaptureSpan()
  public static async handleBotIncidentEpisodeAction(data: {
    actionType: string;
    actionValue: string;
    value: JSONObject;
    projectId: ObjectID;
    oneUptimeUserId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const {
      actionType,
      actionValue,
      value,
      projectId,
      databaseProps,
      turnContext,
    } = data;

    if (
      actionType === MicrosoftTeamsIncidentEpisodeActionType.AckIncidentEpisode
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to acknowledge: missing incident episode id.",
        );
        return;
      }

      const episodeId: ObjectID = new ObjectID(actionValue);

      await WorkspaceActionAuthorization.assertCanCreate({
        props: databaseProps,
        modelType: IncidentEpisodeStateTimeline,
        action: "acknowledge this incident episode",
        resources: [{ service: IncidentEpisodeService, id: episodeId }],
      });

      /*
       * Acknowledged by the member, as the dashboard acknowledges it for
       * them (WorkspaceMemberActions). A refusal is theirs to read:
       * handleBotInvokeActivity tells them.
       */
      await WorkspaceMemberActions.acknowledge({
        event: {
          type: WorkspaceEventType.IncidentEpisode,
          id: episodeId,
        },
        props: databaseProps,
      });

      await turnContext.sendActivity("Incident episode acknowledged.");
      return;
    }

    if (
      actionType ===
      MicrosoftTeamsIncidentEpisodeActionType.ResolveIncidentEpisode
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to resolve: missing incident episode id.",
        );
        return;
      }

      const episodeId: ObjectID = new ObjectID(actionValue);

      await WorkspaceActionAuthorization.assertCanCreate({
        props: databaseProps,
        modelType: IncidentEpisodeStateTimeline,
        action: "resolve this incident episode",
        resources: [{ service: IncidentEpisodeService, id: episodeId }],
      });

      // Resolved by the member, as the dashboard resolves it for them.
      await WorkspaceMemberActions.resolve({
        event: {
          type: WorkspaceEventType.IncidentEpisode,
          id: episodeId,
        },
        props: databaseProps,
      });

      await turnContext.sendActivity("Incident episode resolved.");
      return;
    }

    if (
      actionType === MicrosoftTeamsIncidentEpisodeActionType.ViewIncidentEpisode
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to view incident episode: missing episode id.",
        );
        return;
      }

      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneBy({
          query: {
            _id: actionValue,
            projectId: projectId,
          },
          select: {
            _id: true,
            title: true,
            description: true,
            currentIncidentState: {
              name: true,
            },
            incidentSeverity: {
              name: true,
            },
            createdAt: true,
            incidentCount: true,
          },
          // Read as the member: an episode they may not read is not shown.
          props: databaseProps,
        });

      if (!episode) {
        await turnContext.sendActivity("Incident episode not found.");
        return;
      }

      // The title and the state and severity names are plain text, escaped as MarkdownEscape says a title must be.
      const message: string =
        mdText`**Incident Episode Details**\n\n**Title:** ${episode.title}\n**Description:** ${FeedMarkdown.asChatMarkdown(episode.description || "No description")}\n**State:** ${episode.currentIncidentState?.name || "Unknown"}\n**Severity:** ${episode.incidentSeverity?.name || "Unknown"}\n**Incident Count:** ${episode.incidentCount || 0}\n**Created At:** ${episode.createdAt ? new Date(episode.createdAt).toLocaleString() : "Unknown"}`.toString();

      await turnContext.sendActivity(message);
      return;
    }

    if (
      actionType ===
      MicrosoftTeamsIncidentEpisodeActionType.ViewAddIncidentEpisodeNote
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to add note: missing episode id.",
        );
        return;
      }

      // Send the input card
      const card: JSONObject =
        this.buildAddIncidentEpisodeNoteCard(actionValue);
      await turnContext.sendActivity({
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: card,
          },
        ],
      });
      return;
    }

    if (
      actionType ===
      MicrosoftTeamsIncidentEpisodeActionType.SubmitIncidentEpisodeNote
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to add note: missing episode id.",
        );
        return;
      }

      // Check if form data is provided
      const note: JSONValue = value["note"];

      if (note) {
        // Submit the note
        const episodeId: ObjectID = new ObjectID(actionValue);

        await WorkspaceActionAuthorization.assertCanCreate({
          props: databaseProps,
          modelType: IncidentEpisodeInternalNote,
          action: "add a private note to this incident episode",
          resources: [{ service: IncidentEpisodeService, id: episodeId }],
        });

        // Posted by the member, as the dashboard posts it for them.
        await IncidentEpisodeInternalNoteService.addNote({
          incidentEpisodeId: episodeId,
          note: note.toString(),
          projectId: projectId,
          props: databaseProps,
        });

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "Note added successfully.",
        );

        /*
         * The action is done: a refused reply or a failed delete of the
         * form must not read as a failed action, which invites a repeat.
         */
        await MicrosoftTeamsReplies.deleteBestEffort(
          turnContext,
          turnContext.activity.replyToId,
        );

        return;
      }
      await turnContext.sendActivity("Unable to add note: missing note data.");
      return;
    }

    if (
      actionType ===
      MicrosoftTeamsIncidentEpisodeActionType.ViewExecuteIncidentEpisodeOnCallPolicy
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to execute on-call policy: missing episode id.",
        );
        return;
      }

      /*
       * Asked as the submit asks it, before the card is shown, and the card
       * then offers the policies the member may read.
       */
      await WorkspaceActionAuthorization.assertCanCreate({
        props: databaseProps,
        modelType: OnCallDutyPolicyExecutionLog,
        action: "execute an on-call policy for this incident episode",
        resources: [
          { service: IncidentEpisodeService, id: new ObjectID(actionValue) },
        ],
      });

      // Send the input card
      const card: JSONObject | null =
        await this.buildExecuteIncidentEpisodeOnCallPolicyCard(
          actionValue,
          projectId,
          databaseProps,
        );
      if (!card) {
        await turnContext.sendActivity(
          "No on-call policies are available to you in this project yet. Add one in the OneUptime Dashboard under On-Call Duty > Policies, or ask a project admin for access to one.",
        );
        return;
      }
      await turnContext.sendActivity({
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: card,
          },
        ],
      });
      return;
    }

    if (
      actionType ===
      MicrosoftTeamsIncidentEpisodeActionType.SubmitExecuteIncidentEpisodeOnCallPolicy
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to execute on-call policy: missing episode id.",
        );
        return;
      }

      // Check if form data is provided
      const onCallPolicyId: JSONValue = value["onCallPolicy"];

      if (onCallPolicyId) {
        // Execute the policy
        const episodeId: ObjectID = new ObjectID(actionValue);
        const policyId: ObjectID = new ObjectID(onCallPolicyId.toString());

        await WorkspaceActionAuthorization.assertCanCreate({
          props: databaseProps,
          modelType: OnCallDutyPolicyExecutionLog,
          action: "execute an on-call policy for this incident episode",
          resources: [
            { service: IncidentEpisodeService, id: episodeId },
            { service: OnCallDutyPolicyService, id: policyId },
          ],
        });

        /*
         * Executed by the member, as the dashboard's Execute On-Call Policy
         * executes it for them: an execution log triggered by the episode.
         */
        await WorkspaceMemberActions.executeOnCallPolicy({
          event: {
            type: WorkspaceEventType.IncidentEpisode,
            id: episodeId,
          },
          onCallDutyPolicyId: policyId,
          props: databaseProps,
        });

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "On-call policy executed successfully.",
        );

        /*
         * The action is done: a refused reply or a failed delete of the
         * form must not read as a failed action, which invites a repeat.
         */
        await MicrosoftTeamsReplies.deleteBestEffort(
          turnContext,
          turnContext.activity.replyToId,
        );

        return;
      }
      await turnContext.sendActivity(
        "Unable to execute on-call policy: missing policy id.",
      );
      return;
    }

    if (
      actionType ===
      MicrosoftTeamsIncidentEpisodeActionType.ViewChangeIncidentEpisodeState
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to change episode state: missing episode id.",
        );
        return;
      }

      /*
       * Asked as the submit asks it, before the card is shown, and the card
       * then offers the incident states the member may read.
       */
      await WorkspaceActionAuthorization.assertCanCreate({
        props: databaseProps,
        modelType: IncidentEpisodeStateTimeline,
        action: "change the state of this incident episode",
        resources: [
          { service: IncidentEpisodeService, id: new ObjectID(actionValue) },
        ],
      });

      const card: JSONObject | null =
        await this.buildChangeIncidentEpisodeStateCard(
          actionValue,
          projectId,
          databaseProps,
        );

      if (!card) {
        await turnContext.sendActivity(
          MicrosoftTeamsIncidentEpisodeActions.NO_STATES_MESSAGE,
        );
        return;
      }

      await turnContext.sendActivity({
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: card,
          },
        ],
      });
      return;
    }

    if (
      actionType ===
      MicrosoftTeamsIncidentEpisodeActionType.SubmitChangeIncidentEpisodeState
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to change episode state: missing episode id.",
        );
        return;
      }

      // Check if form data is provided
      const incidentStateId: JSONValue = value["incidentState"];

      if (incidentStateId) {
        // Update the state
        const episodeId: ObjectID = new ObjectID(actionValue);

        await WorkspaceActionAuthorization.assertCanCreate({
          props: databaseProps,
          modelType: IncidentEpisodeStateTimeline,
          action: "change the state of this incident episode",
          resources: [{ service: IncidentEpisodeService, id: episodeId }],
        });

        /*
         * The state change the dashboard makes: a row in the episode's
         * state timeline, created by the member (WorkspaceMemberActions).
         */
        await WorkspaceMemberActions.changeState({
          event: {
            type: WorkspaceEventType.IncidentEpisode,
            id: episodeId,
          },
          stateId: new ObjectID(incidentStateId.toString()),
          props: databaseProps,
        });

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "Incident episode state changed successfully.",
        );

        /*
         * The action is done: a refused reply or a failed delete of the
         * form must not read as a failed action, which invites a repeat.
         */
        await MicrosoftTeamsReplies.deleteBestEffort(
          turnContext,
          turnContext.activity.replyToId,
        );

        return;
      }
      await turnContext.sendActivity(
        "Unable to change episode state: missing state id.",
      );
      return;
    }

    // Default fallback for unimplemented actions
    await turnContext.sendActivity(
      "Sorry, but the action " +
        actionType +
        " you requested is not implemented yet.",
    );
  }

  private static buildAddIncidentEpisodeNoteCard(
    episodeId: string,
  ): JSONObject {
    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "Add Incident Episode Note",
          size: "Large",
          weight: "Bolder",
        },
        {
          type: "Input.Text",
          id: "note",
          label: "Note",
          isMultiline: true,
          placeholder: "Please type in plain text or markdown.",
        },
      ],
      actions: [
        {
          type: "Action.Submit",
          title: "Submit",
          data: {
            action:
              MicrosoftTeamsIncidentEpisodeActionType.SubmitIncidentEpisodeNote,
            actionValue: episodeId,
          },
        },
      ],
    };
  }

  private static async buildExecuteIncidentEpisodeOnCallPolicyCard(
    episodeId: string,
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<JSONObject | null> {
    // The policies the member may read, with their own permissions.
    const onCallPolicies: Array<OnCallDutyPolicy> =
      await WorkspaceActionAuthorization.findReadable({
        service: OnCallDutyPolicyService,
        props: props,
        query: {
          projectId: projectId,
          // Archived policies page no one, so they are not offered.
          isArchived: false,
        },
        select: {
          name: true,
          _id: true,
        },
        limit: 50,
      });

    const choices: Array<{ title: string; value: string }> = onCallPolicies
      .map((policy: OnCallDutyPolicy) => {
        return {
          title: policy.name || "",
          value: policy._id?.toString() || "",
        };
      })
      .filter((choice: { title: string; value: string }) => {
        return choice.title && choice.value;
      });

    if (choices.length === 0) {
      return null;
    }

    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "Execute On-Call Policy",
          size: "Large",
          weight: "Bolder",
        },
        {
          type: "Input.ChoiceSet",
          id: "onCallPolicy",
          label: "On-Call Policy",
          style: "compact",
          choices: choices,
        },
      ],
      actions: [
        {
          type: "Action.Submit",
          title: "Execute",
          data: {
            action:
              MicrosoftTeamsIncidentEpisodeActionType.SubmitExecuteIncidentEpisodeOnCallPolicy,
            actionValue: episodeId,
          },
        },
      ],
    };
  }

  /*
   * The incident states the member may read, in the project's order; null
   * when they may read none, for the caller to say so instead of an empty
   * card.
   */
  private static async buildChangeIncidentEpisodeStateCard(
    episodeId: string,
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<JSONObject | null> {
    const incidentStates: Array<WorkspaceEventStateOption> =
      await WorkspaceMemberActions.findStateOptions({
        type: WorkspaceEventType.IncidentEpisode,
        projectId: projectId,
        props: props,
      });

    if (incidentStates.length === 0) {
      return null;
    }

    const choices: Array<{ title: string; value: string }> = incidentStates.map(
      (state: WorkspaceEventStateOption) => {
        return {
          title: state.name,
          value: state.id.toString(),
        };
      },
    );

    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "Change Incident Episode State",
          size: "Large",
          weight: "Bolder",
        },
        {
          type: "Input.ChoiceSet",
          id: "incidentState",
          label: "Incident State",
          style: "compact",
          choices: choices,
        },
      ],
      actions: [
        {
          type: "Action.Submit",
          title: "Change",
          data: {
            action:
              MicrosoftTeamsIncidentEpisodeActionType.SubmitChangeIncidentEpisodeState,
            actionValue: episodeId,
          },
        },
      ],
    };
  }
}
