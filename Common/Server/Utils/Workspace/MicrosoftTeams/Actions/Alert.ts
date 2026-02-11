import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAction,
  MicrosoftTeamsRequest,
} from "./Auth";
import { MicrosoftTeamsAlertActionType } from "./ActionTypes";
import logger from "../../../Logger";
import ObjectID from "../../../../../Types/ObjectID";
import AlertService from "../../../../Services/AlertService";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import AlertInternalNoteService from "../../../../Services/AlertInternalNoteService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import AlertStateService from "../../../../Services/AlertStateService";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertState from "../../../../../Models/DatabaseModels/AlertState";

export default class MicrosoftTeamsAlertActions {
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
  public static async handleAlertAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, action } = data;

    logger.debug("Handling Microsoft Teams alert action:");
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsAlertActionType.AckAlert:
          await this.acknowledgeAlert({
            teamsRequest,
            action,
          });
          break;

        case MicrosoftTeamsAlertActionType.ResolveAlert:
          await this.resolveAlert({
            teamsRequest,
            action,
          });
          break;

        case MicrosoftTeamsAlertActionType.ViewAlert:
          // This is handled by opening the URL directly
          break;

        default:
          logger.debug("Unhandled alert action: " + action.actionType);
          break;
      }
    } catch (error) {
      logger.error("Error handling Microsoft Teams alert action:");
      logger.error(error);
    }

    Response.sendTextResponse(data.req, data.res, "");
  }

  @CaptureSpan()
  private static async acknowledgeAlert(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
  }): Promise<void> {
    const alertId: string = data.action.actionValue || "";

    if (!alertId) {
      logger.error("No alert ID provided for acknowledge action");
      return;
    }

    logger.debug("Acknowledging alert: " + alertId);

    try {
      const alert: Alert | null = await AlertService.findOneBy({
        query: {
          _id: alertId,
          projectId: data.teamsRequest.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          currentAlertState: {
            _id: true,
            name: true,
            isAcknowledgedState: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!alert) {
        logger.error("Alert not found: " + alertId);
        return;
      }

      if (alert.currentAlertState?.isAcknowledgedState) {
        logger.debug("Alert is already acknowledged");
        return;
      }

      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: data.teamsRequest.userId || "",
          projectId: data.teamsRequest.projectId,
        });

      await AlertService.acknowledgeAlert(
        new ObjectID(alertId),
        oneUptimeUserId,
      );

      logger.debug("Alert acknowledged successfully");
    } catch (error) {
      logger.error("Error acknowledging alert:");
      logger.error(error);
    }
  }

  @CaptureSpan()
  private static async resolveAlert(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
  }): Promise<void> {
    const alertId: string = data.action.actionValue || "";

    if (!alertId) {
      logger.error("No alert ID provided for resolve action");
      return;
    }

    logger.debug("Resolving alert: " + alertId);

    try {
      const alert: Alert | null = await AlertService.findOneBy({
        query: {
          _id: alertId,
          projectId: data.teamsRequest.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          currentAlertState: {
            _id: true,
            name: true,
            isResolvedState: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!alert) {
        logger.error("Alert not found: " + alertId);
        return;
      }

      if (alert.currentAlertState?.isResolvedState) {
        logger.debug("Alert is already resolved");
        return;
      }

      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: data.teamsRequest.userId || "",
          projectId: data.teamsRequest.projectId,
        });

      await AlertService.resolveAlert(new ObjectID(alertId), oneUptimeUserId);

      logger.debug("Alert resolved successfully");
    } catch (error) {
      logger.error("Error resolving alert:");
      logger.error(error);
    }
  }

  @CaptureSpan()
  public static async handleBotAlertAction(data: {
    actionType: string;
    actionValue: string;
    value: JSONObject;
    projectId: ObjectID;
    oneUptimeUserId: ObjectID;
    turnContext: TurnContext;
  }): Promise<void> {
    const {
      actionType,
      actionValue,
      value,
      projectId,
      oneUptimeUserId,
      turnContext,
    } = data;

    if (actionType === MicrosoftTeamsAlertActionType.AckAlert) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to acknowledge: missing alert id.",
        );
        return;
      }

      await AlertService.acknowledgeAlert(
        new ObjectID(actionValue),
        oneUptimeUserId,
      );
      await turnContext.sendActivity("✅ Alert acknowledged.");
      return;
    }

    if (actionType === MicrosoftTeamsAlertActionType.ResolveAlert) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to resolve: missing alert id.");
        return;
      }

      await AlertService.resolveAlert(
        new ObjectID(actionValue),
        oneUptimeUserId,
      );
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
        props: {
          isRoot: true,
        },
      });

      if (!alert) {
        await turnContext.sendActivity("Alert not found.");
        return;
      }

      const message: string = `**Alert Details**\n\n**Title:** ${alert.title}\n**Description:** ${alert.description || "No description"}\n**State:** ${alert.currentAlertState?.name || "Unknown"}\n**Severity:** ${alert.alertSeverity?.name || "Unknown"}\n**Created At:** ${alert.createdAt ? new Date(alert.createdAt).toLocaleString() : "Unknown"}`;

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

        await AlertInternalNoteService.addNote({
          alertId: alertId,
          note: note.toString(),
          projectId: projectId,
          userId: oneUptimeUserId,
        });

        await turnContext.sendActivity("✅ Note added successfully.");

        // Hide the form card by deleting it
        if (turnContext.activity.replyToId) {
          await turnContext.deleteActivity(turnContext.activity.replyToId);
        }

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

      // Send the input card
      const card: JSONObject | null =
        await this.buildExecuteAlertOnCallPolicyCard(actionValue, projectId);
      if (!card) {
        await turnContext.sendActivity(
          "No on-call policies have been configured for this project yet. Please add an on-call policy in the OneUptime Dashboard under On-Call Duty > Policies to use this feature.",
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

        await OnCallDutyPolicyService.executePolicy(
          new ObjectID(onCallPolicyId.toString()),
          {
            triggeredByAlertId: alertId,
            userNotificationEventType: UserNotificationEventType.AlertCreated,
          },
        );

        await turnContext.sendActivity(
          "✅ On-call policy executed successfully.",
        );

        // Hide the form card by deleting it
        if (turnContext.activity.replyToId) {
          await turnContext.deleteActivity(turnContext.activity.replyToId);
        }

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

      // Send the input card
      const card: JSONObject = await this.buildChangeAlertStateCard(
        actionValue,
        projectId,
      );
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

        await AlertService.updateOneById({
          id: alertId,
          data: {
            currentAlertStateId: new ObjectID(alertStateId.toString()),
          },
          props: {
            isRoot: true,
          },
        });

        await turnContext.sendActivity("✅ Alert state changed successfully.");

        // Hide the form card by deleting it
        if (turnContext.activity.replyToId) {
          await turnContext.deleteActivity(turnContext.activity.replyToId);
        }

        return;
      }
      await turnContext.sendActivity(
        "Unable to change alert state: missing state id.",
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
  ): Promise<JSONObject | null> {
    const onCallPolicies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          name: true,
          _id: true,
        },
        props: {
          isRoot: true,
        },
        limit: 50,
        skip: 0,
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

  private static async buildChangeAlertStateCard(
    alertId: string,
    projectId: ObjectID,
  ): Promise<JSONObject> {
    const alertStates: Array<AlertState> =
      await AlertStateService.getAllAlertStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      });

    const choices: Array<{ title: string; value: string }> = alertStates
      .map((state: AlertState) => {
        return {
          title: state.name || "",
          value: state._id?.toString() || "",
        };
      })
      .filter((choice: { title: string; value: string }) => {
        return choice.title && choice.value;
      });

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
