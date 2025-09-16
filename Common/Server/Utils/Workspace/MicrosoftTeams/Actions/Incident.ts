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

export default class MicrosoftTeamsIncidentActions {
  @CaptureSpan()
  public static isIncidentAction(data: { actionType: string }): boolean {
    // Check if the action is related to incidents
    return (
      data.actionType === MicrosoftTeamsIncidentActionType.AckIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.ResolveIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.ViewIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.IncidentCreated ||
      data.actionType === MicrosoftTeamsIncidentActionType.IncidentStateChanged
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
}
