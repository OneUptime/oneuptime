import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAction,
  MicrosoftTeamsRequest,
} from "./Auth";
import { MicrosoftTeamsIncidentActionType } from "./ActionTypes";
import logger from "../../../Logger";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentService from "../../../../Services/IncidentService";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from 'botbuilder';
import { JSONObject } from "../../../../../Types/JSON";
import IncidentPublicNoteService from "../../../../Services/IncidentPublicNoteService";
import IncidentInternalNoteService from "../../../../Services/IncidentInternalNoteService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import IncidentStateService from "../../../../Services/IncidentStateService";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";

export default class MicrosoftTeamsIncidentActions {
  @CaptureSpan()
  public static isIncidentAction(data: { actionType: string }): boolean {
    // Check if the action is related to incidents
    return (
      data.actionType === MicrosoftTeamsIncidentActionType.AckIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.ResolveIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.ViewIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.IncidentCreated ||
      data.actionType === MicrosoftTeamsIncidentActionType.IncidentStateChanged ||
      data.actionType === MicrosoftTeamsIncidentActionType.ViewAddIncidentNote ||
      data.actionType === MicrosoftTeamsIncidentActionType.SubmitIncidentNote ||
      data.actionType === MicrosoftTeamsIncidentActionType.ExecuteIncidentOnCallPolicy ||
      data.actionType === MicrosoftTeamsIncidentActionType.ViewExecuteIncidentOnCallPolicy ||
      data.actionType === MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy ||
      data.actionType === MicrosoftTeamsIncidentActionType.ViewChangeIncidentState ||
      data.actionType === MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState
    );
  }

  @CaptureSpan()
  public static async handleIncidentAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, action } = data;

    logger.debug("Handling Microsoft Teams incident action:");
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsIncidentActionType.AckIncident:
          await this.acknowledgeIncident({
            teamsRequest,
            action,
          });
          break;

        case MicrosoftTeamsIncidentActionType.ResolveIncident:
          await this.resolveIncident({
            teamsRequest,
            action,
          });
          break;

        case MicrosoftTeamsIncidentActionType.ViewIncident:
          // This is handled by opening the URL directly
          break;

        default:
          logger.debug("Unhandled incident action: " + action.actionType);
          break;
      }
    } catch (error) {
      logger.error("Error handling Microsoft Teams incident action:");
      logger.error(error);
    }

    // Send empty response to Teams
    Response.sendTextResponse(data.req, data.res, "");
  }

  @CaptureSpan()
  private static async acknowledgeIncident(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
  }): Promise<void> {
    const incidentId: string = data.action.actionValue || "";

    if (!incidentId) {
      logger.error("No incident ID provided for acknowledge action");
      return;
    }

    logger.debug("Acknowledging incident: " + incidentId);

    try {
      // Get the incident
      const incident: Incident | null = await IncidentService.findOneBy({
        query: {
          _id: incidentId,
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

      if (!incident) {
        logger.error("Incident not found: " + incidentId);
        return;
      }

      // Check if already acknowledged
      if (incident.currentIncidentState?.isAcknowledgedState) {
        logger.debug("Incident is already acknowledged");
        return;
      }

      // Acknowledge the incident
      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: data.teamsRequest.userId || "",
          projectId: data.teamsRequest.projectId,
        });

      await IncidentService.acknowledgeIncident(
        new ObjectID(incidentId),
        oneUptimeUserId,
      );

      logger.debug("Incident acknowledged successfully");
    } catch (error) {
      logger.error("Error acknowledging incident:");
      logger.error(error);
    }
  }

  @CaptureSpan()
  private static async resolveIncident(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
  }): Promise<void> {
    const incidentId: string = data.action.actionValue || "";

    if (!incidentId) {
      logger.error("No incident ID provided for resolve action");
      return;
    }

    logger.debug("Resolving incident: " + incidentId);

    try {
      // Get the incident
      const incident: Incident | null = await IncidentService.findOneBy({
        query: {
          _id: incidentId,
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

      if (!incident) {
        logger.error("Incident not found: " + incidentId);
        return;
      }

      // Check if already resolved
      if (incident.currentIncidentState?.isResolvedState) {
        logger.debug("Incident is already resolved");
        return;
      }

      // Resolve the incident
      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: data.teamsRequest.userId || "",
          projectId: data.teamsRequest.projectId,
        });

      await IncidentService.resolveIncident(
        new ObjectID(incidentId),
        oneUptimeUserId,
      );

      logger.debug("Incident resolved successfully");
    } catch (error) {
      logger.error("Error resolving incident:");
      logger.error(error);
    }
  }

  @CaptureSpan()
  public static async handleBotIncidentAction(data: {
    actionType: string;
    actionValue: string;
    value: JSONObject;
    projectId: ObjectID;
    oneUptimeUserId: ObjectID;
    turnContext: TurnContext;
  }): Promise<void> {
    const { actionType, actionValue, value, projectId, oneUptimeUserId, turnContext } = data;

    if (actionType === MicrosoftTeamsIncidentActionType.AckIncident) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to acknowledge: missing incident id.");
        return;
      }

      await IncidentService.acknowledgeIncident(new ObjectID(actionValue), oneUptimeUserId);
      await turnContext.sendActivity("✅ Incident acknowledged.");
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.ResolveIncident) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to resolve: missing incident id.");
        return;
      }

      await IncidentService.resolveIncident(new ObjectID(actionValue), oneUptimeUserId);
      await turnContext.sendActivity("✅ Incident resolved.");
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.ViewIncident) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to view incident: missing incident id.");
        return;
      }

      const incident: Incident | null = await IncidentService.findOneBy({
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
        },
        props: {
          isRoot: true,
        },
      });

      if (!incident) {
        await turnContext.sendActivity("Incident not found.");
        return;
      }

      const message = `**Incident Details**\n\n**Title:** ${incident.title}\n**Description:** ${incident.description || 'No description'}\n**State:** ${incident.currentIncidentState?.name || 'Unknown'}\n**Severity:** ${incident.incidentSeverity?.name || 'Unknown'}\n**Created At:** ${incident.createdAt ? new Date(incident.createdAt).toLocaleString() : 'Unknown'}`;

      await turnContext.sendActivity(message);
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.ViewAddIncidentNote) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to add note: missing incident id.");
        return;
      }

      // Send the input card
      const card = this.buildAddIncidentNoteCard(actionValue);
      await turnContext.sendActivity({ attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }] });
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.SubmitIncidentNote) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to add note: missing incident id.");
        return;
      }

      // Check if form data is provided
      const noteType = value["noteType"];
      const note = value["note"];

      if (noteType && note) {
        // Submit the note
        const incidentId = new ObjectID(actionValue);

        if (noteType === "public") {
          await IncidentPublicNoteService.addNote({
            incidentId: incidentId,
            note: note.toString(),
            projectId: projectId,
            userId: oneUptimeUserId,
          });
        } else if (noteType === "private") {
          await IncidentInternalNoteService.addNote({
            incidentId: incidentId,
            note: note.toString(),
            projectId: projectId,
            userId: oneUptimeUserId,
          });
        }

        await turnContext.sendActivity("✅ Note added successfully.");
        return;
      } else {
        await turnContext.sendActivity("Unable to add note: missing note data.");
        return;
      }
    }

    if (actionType === MicrosoftTeamsIncidentActionType.ViewExecuteIncidentOnCallPolicy) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to execute on-call policy: missing incident id.");
        return;
      }

      // Send the input card
      const card = await this.buildExecuteOnCallPolicyCard(actionValue, projectId);
      await turnContext.sendActivity({ attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }] });
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to execute on-call policy: missing incident id.");
        return;
      }

      // Check if form data is provided
      const onCallPolicyId = value["onCallPolicy"];

      if (onCallPolicyId) {
        // Execute the policy
        const incidentId = new ObjectID(actionValue);

        await OnCallDutyPolicyService.executePolicy(new ObjectID(onCallPolicyId.toString()), {
          triggeredByIncidentId: incidentId,
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
        });

        await turnContext.sendActivity("✅ On-call policy executed successfully.");
        return;
      } else {
        await turnContext.sendActivity("Unable to execute on-call policy: missing policy id.");
        return;
      }
    }

    if (actionType === MicrosoftTeamsIncidentActionType.ViewChangeIncidentState) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to change incident state: missing incident id.");
        return;
      }

      // Send the input card
      const card = await this.buildChangeIncidentStateCard(actionValue, projectId);
      await turnContext.sendActivity({ attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }] });
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState) {
      if (!actionValue) {
        await turnContext.sendActivity("Unable to change incident state: missing incident id.");
        return;
      }

      // Check if form data is provided
      const incidentStateId = value["incidentState"];

      if (incidentStateId) {
        // Update the state
        const incidentId = new ObjectID(actionValue);

        await IncidentService.updateOneById({
          id: incidentId,
          data: {
            currentIncidentStateId: new ObjectID(incidentStateId.toString()),
          },
          props: {
            isRoot: true,
          },
        });

        await turnContext.sendActivity("✅ Incident state changed successfully.");
        return;
      } else {
        await turnContext.sendActivity("Unable to change incident state: missing state id.");
        return;
      }
    }

    // Default fallback for unimplemented actions
    await turnContext.sendActivity("Sorry, but the action " + actionType + " you requested is not implemented yet.");
  }

  private static buildAddIncidentNoteCard(incidentId: string): JSONObject {
    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "Add Incident Note",
          size: "Large",
          weight: "Bolder",
        },
        {
          type: "Input.ChoiceSet",
          id: "noteType",
          label: "Note Type",
          style: "compact",
          value: "public",
          choices: [
            {
              title: "Public Note (Will be posted on Status Page)",
              value: "public",
            },
            {
              title: "Private Note (Only visible to team members)",
              value: "private",
            },
          ],
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
            action: MicrosoftTeamsIncidentActionType.SubmitIncidentNote,
            actionValue: incidentId,
          },
        },
      ],
    };
  }

  private static async buildExecuteOnCallPolicyCard(incidentId: string, projectId: ObjectID): Promise<JSONObject> {
    const onCallPolicies = await OnCallDutyPolicyService.findBy({
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

    const choices = onCallPolicies.map(policy => ({
      title: policy.name || "",
      value: policy._id?.toString() || "",
    })).filter(choice => choice.title && choice.value);

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
            action: MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy,
            actionValue: incidentId,
          },
        },
      ],
    };
  }

  private static async buildChangeIncidentStateCard(incidentId: string, projectId: ObjectID): Promise<JSONObject> {
    const incidentStates = await IncidentStateService.getAllIncidentStates({
      projectId: projectId,
      props: {
        isRoot: true,
      },
    });

    const choices = incidentStates.map(state => ({
      title: state.name || "",
      value: state._id?.toString() || "",
    })).filter(choice => choice.title && choice.value);

    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "Change Incident State",
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
            action: MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState,
            actionValue: incidentId,
          },
        },
      ],
    };
  }
}
