import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAction,
  MicrosoftTeamsRequest,
} from "./Auth";
import { MicrosoftTeamsIncidentEpisodeActionType } from "./ActionTypes";
import logger from "../../../Logger";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentEpisodeService from "../../../../Services/IncidentEpisodeService";
import IncidentEpisode from "../../../../../Models/DatabaseModels/IncidentEpisode";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import IncidentEpisodeInternalNoteService from "../../../../Services/IncidentEpisodeInternalNoteService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import IncidentStateService from "../../../../Services/IncidentStateService";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";

export default class MicrosoftTeamsIncidentEpisodeActions {
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
    const { teamsRequest, action } = data;

    logger.debug("Handling Microsoft Teams incident episode action:");
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsIncidentEpisodeActionType.AckIncidentEpisode:
          await this.acknowledgeIncidentEpisode({
            teamsRequest,
            action,
          });
          break;

        case MicrosoftTeamsIncidentEpisodeActionType.ResolveIncidentEpisode:
          await this.resolveIncidentEpisode({
            teamsRequest,
            action,
          });
          break;

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
  private static async acknowledgeIncidentEpisode(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
  }): Promise<void> {
    const episodeId: string = data.action.actionValue || "";

    if (!episodeId) {
      logger.error("No episode ID provided for acknowledge action");
      return;
    }

    logger.debug("Acknowledging incident episode: " + episodeId);

    try {
      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneBy({
          query: {
            _id: episodeId,
            projectId: data.teamsRequest.projectId,
          },
          select: {
            _id: true,
            projectId: true,
            currentIncidentState: {
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
        logger.error("Incident episode not found: " + episodeId);
        return;
      }

      if (episode.currentIncidentState?.isAcknowledgedState) {
        logger.debug("Incident episode is already acknowledged");
        return;
      }

      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: data.teamsRequest.userId || "",
          projectId: data.teamsRequest.projectId,
        });

      await IncidentEpisodeService.acknowledgeEpisode(
        new ObjectID(episodeId),
        oneUptimeUserId,
      );

      logger.debug("Incident episode acknowledged successfully");
    } catch (error) {
      logger.error("Error acknowledging incident episode:");
      logger.error(error);
    }
  }

  @CaptureSpan()
  private static async resolveIncidentEpisode(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
  }): Promise<void> {
    const episodeId: string = data.action.actionValue || "";

    if (!episodeId) {
      logger.error("No episode ID provided for resolve action");
      return;
    }

    logger.debug("Resolving incident episode: " + episodeId);

    try {
      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneBy({
          query: {
            _id: episodeId,
            projectId: data.teamsRequest.projectId,
          },
          select: {
            _id: true,
            projectId: true,
            currentIncidentState: {
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
        logger.error("Incident episode not found: " + episodeId);
        return;
      }

      if (episode.currentIncidentState?.isResolvedState) {
        logger.debug("Incident episode is already resolved");
        return;
      }

      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: data.teamsRequest.userId || "",
          projectId: data.teamsRequest.projectId,
        });

      await IncidentEpisodeService.resolveEpisode(
        new ObjectID(episodeId),
        oneUptimeUserId,
      );

      logger.debug("Incident episode resolved successfully");
    } catch (error) {
      logger.error("Error resolving incident episode:");
      logger.error(error);
    }
  }

  @CaptureSpan()
  public static async handleBotIncidentEpisodeAction(data: {
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

    if (
      actionType === MicrosoftTeamsIncidentEpisodeActionType.AckIncidentEpisode
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to acknowledge: missing incident episode id.",
        );
        return;
      }

      await IncidentEpisodeService.acknowledgeEpisode(
        new ObjectID(actionValue),
        oneUptimeUserId,
      );
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

      await IncidentEpisodeService.resolveEpisode(
        new ObjectID(actionValue),
        oneUptimeUserId,
      );
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
          props: {
            isRoot: true,
          },
        });

      if (!episode) {
        await turnContext.sendActivity("Incident episode not found.");
        return;
      }

      const message: string = `**Incident Episode Details**\n\n**Title:** ${episode.title}\n**Description:** ${episode.description || "No description"}\n**State:** ${episode.currentIncidentState?.name || "Unknown"}\n**Severity:** ${episode.incidentSeverity?.name || "Unknown"}\n**Incident Count:** ${episode.incidentCount || 0}\n**Created At:** ${episode.createdAt ? new Date(episode.createdAt).toLocaleString() : "Unknown"}`;

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

        await IncidentEpisodeInternalNoteService.addNote({
          incidentEpisodeId: episodeId,
          note: note.toString(),
          projectId: projectId,
          userId: oneUptimeUserId,
        });

        await turnContext.sendActivity("Note added successfully.");

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
      MicrosoftTeamsIncidentEpisodeActionType.ViewExecuteIncidentEpisodeOnCallPolicy
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to execute on-call policy: missing episode id.",
        );
        return;
      }

      // Send the input card
      const card: JSONObject | null =
        await this.buildExecuteIncidentEpisodeOnCallPolicyCard(
          actionValue,
          projectId,
        );
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

        await OnCallDutyPolicyService.executePolicy(
          new ObjectID(onCallPolicyId.toString()),
          {
            triggeredByIncidentEpisodeId: episodeId,
            userNotificationEventType:
              UserNotificationEventType.IncidentEpisodeCreated,
          },
        );

        await turnContext.sendActivity("On-call policy executed successfully.");

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
      MicrosoftTeamsIncidentEpisodeActionType.ViewChangeIncidentEpisodeState
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to change episode state: missing episode id.",
        );
        return;
      }

      // Send the input card
      const card: JSONObject = await this.buildChangeIncidentEpisodeStateCard(
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

        await IncidentEpisodeService.changeEpisodeState({
          projectId: projectId,
          episodeId: episodeId,
          incidentStateId: new ObjectID(incidentStateId.toString()),
          notifyOwners: true,
          rootCause: "State changed via Microsoft Teams.",
          props: {
            isRoot: true,
          },
        });

        await turnContext.sendActivity(
          "Incident episode state changed successfully.",
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
              MicrosoftTeamsIncidentEpisodeActionType.SubmitExecuteIncidentEpisodeOnCallPolicy,
            actionValue: episodeId,
          },
        },
      ],
    };
  }

  private static async buildChangeIncidentEpisodeStateCard(
    episodeId: string,
    projectId: ObjectID,
  ): Promise<JSONObject> {
    const incidentStates: Array<IncidentState> =
      await IncidentStateService.getAllIncidentStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      });

    const choices: Array<{ title: string; value: string }> = incidentStates
      .map((state: IncidentState) => {
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
