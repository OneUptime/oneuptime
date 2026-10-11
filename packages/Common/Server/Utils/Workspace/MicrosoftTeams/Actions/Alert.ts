import { MicrosoftTeamsAlertActionType } from "./ActionTypes";
import ObjectID from "../../../../../Types/ObjectID";
import AlertService from "../../../../Services/AlertService";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import AlertInternalNoteService from "../../../../Services/AlertInternalNoteService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventStateOption,
  WorkspaceEventStateOptions,
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
import AlertStateTimeline from "../../../../../Models/DatabaseModels/AlertStateTimeline";
import AlertInternalNote from "../../../../../Models/DatabaseModels/AlertInternalNote";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import MicrosoftTeamsReplies from "../MicrosoftTeamsReplies";
import FeedMarkdown, {
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";

export default class MicrosoftTeamsAlertActions {
  // What a change-state card says instead of opening with nothing to pick.
  public static readonly NO_STATES_MESSAGE: string =
    "No alert states are available to you in this project. Ask a project admin for access to them.";

  @CaptureSpan()
  public static isAlertAction(data: { actionType: string }): boolean {
    return (
      data.actionType.includes("alert") ||
      data.actionType === MicrosoftTeamsAlertActionType.AckAlert ||
      data.actionType === MicrosoftTeamsAlertActionType.ResolveAlert ||
      data.actionType === MicrosoftTeamsAlertActionType.ViewAlert ||
      data.actionType === MicrosoftTeamsAlertActionType.AlertCreated ||
      data.actionType === MicrosoftTeamsAlertActionType.AlertStateChanged ||
      data.actionType === MicrosoftTeamsAlertActionType.ViewAddAlertNote ||
      data.actionType === MicrosoftTeamsAlertActionType.SubmitAlertNote ||
      data.actionType ===
        MicrosoftTeamsAlertActionType.ViewExecuteAlertOnCallPolicy ||
      data.actionType ===
        MicrosoftTeamsAlertActionType.SubmitExecuteAlertOnCallPolicy ||
      data.actionType === MicrosoftTeamsAlertActionType.ViewChangeAlertState ||
      data.actionType === MicrosoftTeamsAlertActionType.SubmitChangeAlertState
    );
  }

  @CaptureSpan()
  public static async handleBotAlertAction(data: {
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

    if (actionType === MicrosoftTeamsAlertActionType.AckAlert) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to acknowledge: missing alert id.",
        );
        return;
      }

      const alertId: ObjectID = new ObjectID(actionValue);

      const alert: WorkspaceEventRecord =
        await WorkspaceMemberActions.authorize({
          props: databaseProps,
          modelType: AlertStateTimeline,
          action: "acknowledge this alert",
          event: { type: WorkspaceEventType.Alert, id: alertId },
        });

      /*
       * Acknowledged by the member, as the dashboard acknowledges it for
       * them (WorkspaceMemberActions). A refusal is theirs to read:
       * handleBotInvokeActivity tells them.
       */
      await WorkspaceMemberActions.acknowledge({
        event: alert,
        props: databaseProps,
      });

      await turnContext.sendActivity("✅ Alert acknowledged.");
      return;
    }

    if (actionType === MicrosoftTeamsAlertActionType.ResolveAlert) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to resolve: missing alert id.");
        return;
      }

      const alertId: ObjectID = new ObjectID(actionValue);

      const alert: WorkspaceEventRecord =
        await WorkspaceMemberActions.authorize({
          props: databaseProps,
          modelType: AlertStateTimeline,
          action: "resolve this alert",
          event: { type: WorkspaceEventType.Alert, id: alertId },
        });

      // Resolved by the member, as the dashboard resolves it for them.
      await WorkspaceMemberActions.resolve({
        event: alert,
        props: databaseProps,
      });

      await turnContext.sendActivity("✅ Alert resolved.");
      return;
    }

    if (actionType === MicrosoftTeamsAlertActionType.ViewAlert) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to view alert: missing alert id.",
        );
        return;
      }

      const alert: Alert | null = await AlertService.findOneBy({
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
        },
        // Read as the member: an alert they may not read is not shown.
        props: databaseProps,
      });

      if (!alert) {
        await turnContext.sendActivity("Alert not found.");
        return;
      }

      // The title and the state and severity names are plain text, escaped as MarkdownEscape says a title must be.
      const message: string =
        mdText`**Alert Details**\n\n**Title:** ${alert.title}\n**Description:** ${FeedMarkdown.asChatMarkdown(alert.description || "No description")}\n**State:** ${alert.currentAlertState?.name || "Unknown"}\n**Severity:** ${alert.alertSeverity?.name || "Unknown"}\n**Created At:** ${alert.createdAt ? new Date(alert.createdAt).toLocaleString() : "Unknown"}`.toString();

      await turnContext.sendActivity(message);
      return;
    }

    if (actionType === MicrosoftTeamsAlertActionType.ViewAddAlertNote) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to add note: missing alert id.");
        return;
      }

      // Send the input card
      const card: JSONObject = this.buildAddAlertNoteCard(actionValue);
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

    if (actionType === MicrosoftTeamsAlertActionType.SubmitAlertNote) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to add note: missing alert id.");
        return;
      }

      // Check if form data is provided
      const note: JSONValue = value["note"];

      if (note) {
        // Submit the note
        const alertId: ObjectID = new ObjectID(actionValue);

        await WorkspaceActionAuthorization.assertCanCreate({
          props: databaseProps,
          modelType: AlertInternalNote,
          action: "add a private note to this alert",
          resources: [{ service: AlertService, id: alertId }],
        });

        // Posted by the member, as the dashboard posts it for them.
        await AlertInternalNoteService.addNote({
          alertId: alertId,
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
      actionType === MicrosoftTeamsAlertActionType.ViewExecuteAlertOnCallPolicy
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to execute on-call policy: missing alert id.",
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
        action: "execute an on-call policy for this alert",
        resources: [{ service: AlertService, id: new ObjectID(actionValue) }],
      });

      // Send the input card
      const card: JSONObject | null =
        await this.buildExecuteAlertOnCallPolicyCard(
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
      MicrosoftTeamsAlertActionType.SubmitExecuteAlertOnCallPolicy
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to execute on-call policy: missing alert id.",
        );
        return;
      }

      // Check if form data is provided
      const onCallPolicyId: JSONValue = value["onCallPolicy"];

      if (onCallPolicyId) {
        // Execute the policy
        const alertId: ObjectID = new ObjectID(actionValue);
        const policyId: ObjectID = new ObjectID(onCallPolicyId.toString());

        const alert: WorkspaceEventRecord =
          await WorkspaceMemberActions.authorize({
            props: databaseProps,
            modelType: OnCallDutyPolicyExecutionLog,
            action: "execute an on-call policy for this alert",
            event: { type: WorkspaceEventType.Alert, id: alertId },
            resources: [{ service: OnCallDutyPolicyService, id: policyId }],
          });

        /*
         * Executed by the member, as the dashboard's Execute On-Call Policy
         * executes it for them: an execution log triggered by the alert.
         */
        await WorkspaceMemberActions.executeOnCallPolicy({
          event: alert,
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

    if (actionType === MicrosoftTeamsAlertActionType.ViewChangeAlertState) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to change alert state: missing alert id.",
        );
        return;
      }

      /*
       * Asked as the submit asks it, before the card is shown, of the
       * record as the submit reads it, with the state it is in. The card
       * then offers the states the member may read that it may
       * move into next (Common/Utils/StateMove), so it never offers a move
       * its timeline would refuse.
       */
      const alert: WorkspaceEventRecord =
        await WorkspaceMemberActions.authorize({
          props: databaseProps,
          modelType: AlertStateTimeline,
          action: "change the state of this alert",
          event: {
            type: WorkspaceEventType.Alert,
            id: new ObjectID(actionValue),
          },
        });

      const stateOptions: WorkspaceEventStateOptions =
        await WorkspaceMemberActions.findStateOptions({
          event: alert,
          props: databaseProps,
        });

      if (stateOptions.options.length === 0) {
        await turnContext.sendActivity(
          stateOptions.hasNoLaterState
            ? WorkspaceMemberActions.getNoLaterStateMessage(
                WorkspaceEventType.Alert,
              )
            : MicrosoftTeamsAlertActions.NO_STATES_MESSAGE,
        );
        return;
      }

      const card: JSONObject = this.buildChangeAlertStateCard(actionValue, stateOptions.options);

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

    if (actionType === MicrosoftTeamsAlertActionType.SubmitChangeAlertState) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to change alert state: missing alert id.",
        );
        return;
      }

      // Check if form data is provided
      const alertStateId: JSONValue = value["alertState"];

      if (alertStateId) {
        // Update the state
        const alertId: ObjectID = new ObjectID(actionValue);

        const alert: WorkspaceEventRecord =
          await WorkspaceMemberActions.authorize({
            props: databaseProps,
            modelType: AlertStateTimeline,
            action: "change the state of this alert",
            event: { type: WorkspaceEventType.Alert, id: alertId },
          });

        /*
         * The state change the dashboard makes: a row in the alert's state
         * timeline, created by the member (WorkspaceMemberActions).
         */
        await WorkspaceMemberActions.changeState({
          event: alert,
          stateId: new ObjectID(alertStateId.toString()),
          props: databaseProps,
        });

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "✅ Alert state changed successfully.",
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
        "Unable to change alert state: missing state id.",
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

  private static buildAddAlertNoteCard(alertId: string): JSONObject {
    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "Add Alert Note",
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
            action: MicrosoftTeamsAlertActionType.SubmitAlertNote,
            actionValue: alertId,
          },
        },
      ],
    };
  }

  private static async buildExecuteAlertOnCallPolicyCard(
    alertId: string,
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
              MicrosoftTeamsAlertActionType.SubmitExecuteAlertOnCallPolicy,
            actionValue: alertId,
          },
        },
      ],
    };
  }

  /*
   * The card offering the states the alert may move into next, as the
   * member may read them (WorkspaceMemberActions.findStateOptions), in the
   * project's order.
   */
  private static buildChangeAlertStateCard(
    alertId: string,
    alertStates: Array<WorkspaceEventStateOption>,
  ): JSONObject {

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
          text: "Change Alert State",
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
            action: MicrosoftTeamsAlertActionType.SubmitChangeAlertState,
            actionValue: alertId,
          },
        },
      ],
    };
  }
}
