import { MicrosoftTeamsAlertEpisodeActionType } from "./ActionTypes";
import ObjectID from "../../../../../Types/ObjectID";
import AlertEpisodeService from "../../../../Services/AlertEpisodeService";
import AlertEpisode from "../../../../../Models/DatabaseModels/AlertEpisode";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventStateOption,
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
import AlertEpisodeStateTimeline from "../../../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertEpisodeInternalNote from "../../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import AlertEpisodeInternalNoteService from "../../../../Services/AlertEpisodeInternalNoteService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import MicrosoftTeamsReplies from "../MicrosoftTeamsReplies";
import FeedMarkdown, {
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";

export default class MicrosoftTeamsAlertEpisodeActions {
  // What a change-state card says instead of opening with nothing to pick.
  public static readonly NO_STATES_MESSAGE: string =
    "No alert states are available to you in this project. Ask a project admin for access to them.";

  @CaptureSpan()
  public static isAlertEpisodeAction(data: { actionType: string }): boolean {
    return (
      data.actionType.includes("AlertEpisode") ||
      data.actionType ===
        MicrosoftTeamsAlertEpisodeActionType.AckAlertEpisode ||
      data.actionType ===
        MicrosoftTeamsAlertEpisodeActionType.ResolveAlertEpisode ||
      data.actionType ===
        MicrosoftTeamsAlertEpisodeActionType.ViewAlertEpisode ||
      data.actionType ===
        MicrosoftTeamsAlertEpisodeActionType.AlertEpisodeCreated ||
      data.actionType ===
        MicrosoftTeamsAlertEpisodeActionType.AlertEpisodeStateChanged ||
      data.actionType ===
        MicrosoftTeamsAlertEpisodeActionType.ViewAddAlertEpisodeNote ||
      data.actionType ===
        MicrosoftTeamsAlertEpisodeActionType.SubmitAlertEpisodeNote ||
      data.actionType ===
        MicrosoftTeamsAlertEpisodeActionType.ViewExecuteAlertEpisodeOnCallPolicy ||
      data.actionType ===
        MicrosoftTeamsAlertEpisodeActionType.SubmitExecuteAlertEpisodeOnCallPolicy ||
      data.actionType ===
        MicrosoftTeamsAlertEpisodeActionType.ViewChangeAlertEpisodeState ||
      data.actionType ===
        MicrosoftTeamsAlertEpisodeActionType.SubmitChangeAlertEpisodeState
    );
  }

  @CaptureSpan()
  public static async handleBotAlertEpisodeAction(data: {
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

    if (actionType === MicrosoftTeamsAlertEpisodeActionType.AckAlertEpisode) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to acknowledge: missing alert episode id.",
        );
        return;
      }

      const episodeId: ObjectID = new ObjectID(actionValue);

      const episode: WorkspaceEventRecord =
        await WorkspaceMemberActions.authorize({
          props: databaseProps,
          modelType: AlertEpisodeStateTimeline,
          action: "acknowledge this alert episode",
          event: { type: WorkspaceEventType.AlertEpisode, id: episodeId },
        });

      /*
       * Acknowledged by the member, as the dashboard acknowledges it for
       * them (WorkspaceMemberActions). A refusal is theirs to read:
       * handleBotInvokeActivity tells them.
       */
      await WorkspaceMemberActions.acknowledge({
        event: episode,
        props: databaseProps,
      });

      await turnContext.sendActivity("✅ Alert episode acknowledged.");
      return;
    }

    if (
      actionType === MicrosoftTeamsAlertEpisodeActionType.ResolveAlertEpisode
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to resolve: missing alert episode id.",
        );
        return;
      }

      const episodeId: ObjectID = new ObjectID(actionValue);

      const episode: WorkspaceEventRecord =
        await WorkspaceMemberActions.authorize({
          props: databaseProps,
          modelType: AlertEpisodeStateTimeline,
          action: "resolve this alert episode",
          event: { type: WorkspaceEventType.AlertEpisode, id: episodeId },
        });

      // Resolved by the member, as the dashboard resolves it for them.
      await WorkspaceMemberActions.resolve({
        event: episode,
        props: databaseProps,
      });

      await turnContext.sendActivity("✅ Alert episode resolved.");
      return;
    }

    if (actionType === MicrosoftTeamsAlertEpisodeActionType.ViewAlertEpisode) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to view alert episode: missing episode id.",
        );
        return;
      }

      const episode: AlertEpisode | null = await AlertEpisodeService.findOneBy({
        query: {
          _id: actionValue,
          projectId: projectId,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          currentAlertState: {
            name: true,
          },
          alertSeverity: {
            name: true,
          },
          createdAt: true,
          alertCount: true,
        },
        // Read as the member: an episode they may not read is not shown.
        props: databaseProps,
      });

      if (!episode) {
        await turnContext.sendActivity("Alert episode not found.");
        return;
      }

      // The title and the state and severity names are plain text, escaped as MarkdownEscape says a title must be.
      const message: string =
        mdText`**Alert Episode Details**\n\n**Title:** ${episode.title}\n**Description:** ${FeedMarkdown.asChatMarkdown(episode.description || "No description")}\n**State:** ${episode.currentAlertState?.name || "Unknown"}\n**Severity:** ${episode.alertSeverity?.name || "Unknown"}\n**Alert Count:** ${episode.alertCount || 0}\n**Created At:** ${episode.createdAt ? new Date(episode.createdAt).toLocaleString() : "Unknown"}`.toString();

      await turnContext.sendActivity(message);
      return;
    }

    if (
      actionType ===
      MicrosoftTeamsAlertEpisodeActionType.ViewAddAlertEpisodeNote
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to add note: missing episode id.",
        );
        return;
      }

      // Send the input card
      const card: JSONObject = this.buildAddAlertEpisodeNoteCard(actionValue);
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
      actionType === MicrosoftTeamsAlertEpisodeActionType.SubmitAlertEpisodeNote
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
          modelType: AlertEpisodeInternalNote,
          action: "add a private note to this alert episode",
          resources: [{ service: AlertEpisodeService, id: episodeId }],
        });

        // Posted by the member, as the dashboard posts it for them.
        await AlertEpisodeInternalNoteService.addNote({
          alertEpisodeId: episodeId,
          note: note.toString(),
          projectId: projectId,
          props: databaseProps,
        });

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "✅ Note added successfully.",
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
      MicrosoftTeamsAlertEpisodeActionType.ViewExecuteAlertEpisodeOnCallPolicy
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
        action: "execute an on-call policy for this alert episode",
        resources: [
          { service: AlertEpisodeService, id: new ObjectID(actionValue) },
        ],
      });

      // Send the input card
      const card: JSONObject | null =
        await this.buildExecuteAlertEpisodeOnCallPolicyCard(
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
      MicrosoftTeamsAlertEpisodeActionType.SubmitExecuteAlertEpisodeOnCallPolicy
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

        const episode: WorkspaceEventRecord =
          await WorkspaceMemberActions.authorize({
            props: databaseProps,
            modelType: OnCallDutyPolicyExecutionLog,
            action: "execute an on-call policy for this alert episode",
            event: { type: WorkspaceEventType.AlertEpisode, id: episodeId },
            resources: [{ service: OnCallDutyPolicyService, id: policyId }],
          });

        /*
         * Executed by the member, as the dashboard's Execute On-Call Policy
         * executes it for them: an execution log triggered by the episode.
         */
        await WorkspaceMemberActions.executeOnCallPolicy({
          event: episode,
          onCallDutyPolicyId: policyId,
          props: databaseProps,
        });

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "✅ On-call policy executed successfully.",
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
      MicrosoftTeamsAlertEpisodeActionType.ViewChangeAlertEpisodeState
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to change episode state: missing episode id.",
        );
        return;
      }

      /*
       * Asked as the submit asks it, before the card is shown, and the card
       * then offers the alert states the member may read.
       */
      await WorkspaceActionAuthorization.assertCanCreate({
        props: databaseProps,
        modelType: AlertEpisodeStateTimeline,
        action: "change the state of this alert episode",
        resources: [
          { service: AlertEpisodeService, id: new ObjectID(actionValue) },
        ],
      });

      const card: JSONObject | null =
        await this.buildChangeAlertEpisodeStateCard(
          actionValue,
          projectId,
          databaseProps,
        );

      if (!card) {
        await turnContext.sendActivity(
          MicrosoftTeamsAlertEpisodeActions.NO_STATES_MESSAGE,
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
      MicrosoftTeamsAlertEpisodeActionType.SubmitChangeAlertEpisodeState
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to change episode state: missing episode id.",
        );
        return;
      }

      // Check if form data is provided
      const alertStateId: JSONValue = value["alertState"];

      if (alertStateId) {
        // Update the state
        const episodeId: ObjectID = new ObjectID(actionValue);

        const episode: WorkspaceEventRecord =
          await WorkspaceMemberActions.authorize({
            props: databaseProps,
            modelType: AlertEpisodeStateTimeline,
            action: "change the state of this alert episode",
            event: { type: WorkspaceEventType.AlertEpisode, id: episodeId },
          });

        /*
         * The state change the dashboard makes: a row in the episode's
         * state timeline, created by the member (WorkspaceMemberActions).
         */
        await WorkspaceMemberActions.changeState({
          event: episode,
          stateId: new ObjectID(alertStateId.toString()),
          props: databaseProps,
        });

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "✅ Alert episode state changed successfully.",
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

    /*
     * Default fallback for unimplemented actions
     * The action's name is placed as text: it comes from the card.
     */
    await turnContext.sendActivity(
      mdText`Sorry, but the action ${actionType} you requested is not implemented yet.`.toString(),
    );
  }

  private static buildAddAlertEpisodeNoteCard(episodeId: string): JSONObject {
    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "Add Alert Episode Note",
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
            action: MicrosoftTeamsAlertEpisodeActionType.SubmitAlertEpisodeNote,
            actionValue: episodeId,
          },
        },
      ],
    };
  }

  private static async buildExecuteAlertEpisodeOnCallPolicyCard(
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
              MicrosoftTeamsAlertEpisodeActionType.SubmitExecuteAlertEpisodeOnCallPolicy,
            actionValue: episodeId,
          },
        },
      ],
    };
  }

  /*
   * The alert states the member may read, in the project's order; null when
   * they may read none, for the caller to say so instead of an empty card.
   */
  private static async buildChangeAlertEpisodeStateCard(
    episodeId: string,
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<JSONObject | null> {
    const alertStates: Array<WorkspaceEventStateOption> =
      await WorkspaceMemberActions.findStateOptions({
        type: WorkspaceEventType.AlertEpisode,
        projectId: projectId,
        props: props,
      });

    if (alertStates.length === 0) {
      return null;
    }

    const choices: Array<{ title: string; value: string }> = alertStates.map(
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
          text: "Change Alert Episode State",
          size: "Large",
          weight: "Bolder",
        },
        {
          type: "Input.ChoiceSet",
          id: "alertState",
          label: "Alert State",
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
              MicrosoftTeamsAlertEpisodeActionType.SubmitChangeAlertEpisodeState,
            actionValue: episodeId,
          },
        },
      ],
    };
  }
}
