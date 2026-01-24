import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAction,
  MicrosoftTeamsRequest,
} from "./Auth";
import { MicrosoftTeamsAlertEpisodeActionType } from "./ActionTypes";
import logger from "../../../Logger";
import ObjectID from "../../../../../Types/ObjectID";
import AlertEpisodeService from "../../../../Services/AlertEpisodeService";
import AlertEpisode from "../../../../../Models/DatabaseModels/AlertEpisode";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import AlertEpisodeInternalNoteService from "../../../../Services/AlertEpisodeInternalNoteService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import AlertStateService from "../../../../Services/AlertStateService";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertState from "../../../../../Models/DatabaseModels/AlertState";

export default class MicrosoftTeamsAlertEpisodeActions {
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
  public static async handleAlertEpisodeAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, action } = data;

    logger.debug("Handling Microsoft Teams alert episode action:");
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsAlertEpisodeActionType.AckAlertEpisode:
          await this.acknowledgeAlertEpisode({
            teamsRequest,
            action,
          });
          break;

        case MicrosoftTeamsAlertEpisodeActionType.ResolveAlertEpisode:
          await this.resolveAlertEpisode({
            teamsRequest,
            action,
          });
          break;

        case MicrosoftTeamsAlertEpisodeActionType.ViewAlertEpisode:
          // This is handled by opening the URL directly
          break;

        default:
          logger.debug("Unhandled alert episode action: " + action.actionType);
          break;
      }
    } catch (error) {
      logger.error("Error handling Microsoft Teams alert episode action:");
      logger.error(error);
    }

    Response.sendTextResponse(data.req, data.res, "");
  }

  @CaptureSpan()
  private static async acknowledgeAlertEpisode(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
  }): Promise<void> {
    const episodeId: string = data.action.actionValue || "";

    if (!episodeId) {
      logger.error("No episode ID provided for acknowledge action");
      return;
    }

    logger.debug("Acknowledging alert episode: " + episodeId);

    try {
      const episode: AlertEpisode | null = await AlertEpisodeService.findOneBy({
        query: {
          _id: episodeId,
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

      if (!episode) {
        logger.error("Alert episode not found: " + episodeId);
        return;
      }

      if (episode.currentAlertState?.isAcknowledgedState) {
        logger.debug("Alert episode is already acknowledged");
        return;
      }

      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: data.teamsRequest.userId || "",
          projectId: data.teamsRequest.projectId,
        });

      await AlertEpisodeService.acknowledgeEpisode(
        new ObjectID(episodeId),
        oneUptimeUserId,
      );

      logger.debug("Alert episode acknowledged successfully");
    } catch (error) {
      logger.error("Error acknowledging alert episode:");
      logger.error(error);
    }
  }

  @CaptureSpan()
  private static async resolveAlertEpisode(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
  }): Promise<void> {
    const episodeId: string = data.action.actionValue || "";

    if (!episodeId) {
      logger.error("No episode ID provided for resolve action");
      return;
    }

    logger.debug("Resolving alert episode: " + episodeId);

    try {
      const episode: AlertEpisode | null = await AlertEpisodeService.findOneBy({
        query: {
          _id: episodeId,
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

      if (!episode) {
        logger.error("Alert episode not found: " + episodeId);
        return;
      }

      if (episode.currentAlertState?.isResolvedState) {
        logger.debug("Alert episode is already resolved");
        return;
      }

      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: data.teamsRequest.userId || "",
          projectId: data.teamsRequest.projectId,
        });

      await AlertEpisodeService.resolveEpisode(
        new ObjectID(episodeId),
        oneUptimeUserId,
      );

      logger.debug("Alert episode resolved successfully");
    } catch (error) {
      logger.error("Error resolving alert episode:");
      logger.error(error);
    }
  }

  @CaptureSpan()
  public static async handleBotAlertEpisodeAction(data: {
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

    if (actionType === MicrosoftTeamsAlertEpisodeActionType.AckAlertEpisode) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to acknowledge: missing alert episode id.",
        );
        return;
      }

      await AlertEpisodeService.acknowledgeEpisode(
        new ObjectID(actionValue),
        oneUptimeUserId,
      );
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

      await AlertEpisodeService.resolveEpisode(
        new ObjectID(actionValue),
        oneUptimeUserId,
      );
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
        props: {
          isRoot: true,
        },
      });

      if (!episode) {
        await turnContext.sendActivity("Alert episode not found.");
        return;
      }

      const message: string = `**Alert Episode Details**\n\n**Title:** ${episode.title}\n**Description:** ${episode.description || "No description"}\n**State:** ${episode.currentAlertState?.name || "Unknown"}\n**Severity:** ${episode.alertSeverity?.name || "Unknown"}\n**Alert Count:** ${episode.alertCount || 0}\n**Created At:** ${episode.createdAt ? new Date(episode.createdAt).toLocaleString() : "Unknown"}`;

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

        await AlertEpisodeInternalNoteService.addNote({
          alertEpisodeId: episodeId,
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
      actionType ===
      MicrosoftTeamsAlertEpisodeActionType.ViewExecuteAlertEpisodeOnCallPolicy
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to execute on-call policy: missing episode id.",
        );
        return;
      }

      // Send the input card
      const card: JSONObject | null =
        await this.buildExecuteAlertEpisodeOnCallPolicyCard(
          actionValue,
          projectId,
        );
      if (!card) {
        await turnContext.sendActivity(
          "No on-call policies found in the project",
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

        await OnCallDutyPolicyService.executePolicy(
          new ObjectID(onCallPolicyId.toString()),
          {
            triggeredByAlertEpisodeId: episodeId,
            userNotificationEventType:
              UserNotificationEventType.AlertEpisodeCreated,
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

      // Send the input card
      const card: JSONObject = await this.buildChangeAlertEpisodeStateCard(
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

        await AlertEpisodeService.updateOneById({
          id: episodeId,
          data: {
            currentAlertStateId: new ObjectID(alertStateId.toString()),
          },
          props: {
            isRoot: true,
          },
        });

        await turnContext.sendActivity(
          "✅ Alert episode state changed successfully.",
        );

        // Hide the form card by deleting it
        if (turnContext.activity.replyToId) {
          await turnContext.deleteActivity(turnContext.activity.replyToId);
        }

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
              MicrosoftTeamsAlertEpisodeActionType.SubmitExecuteAlertEpisodeOnCallPolicy,
            actionValue: episodeId,
          },
        },
      ],
    };
  }

  private static async buildChangeAlertEpisodeStateCard(
    episodeId: string,
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
