import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentService from "../../../../Services/IncidentService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import MicrosoftTeamsActionType from "./ActionTypes";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import Response from "../../../Response";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

export default class MicrosoftTeamsIncidentActions {
  @CaptureSpan()
  public static isIncidentAction(data: {
    actionType: MicrosoftTeamsActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case MicrosoftTeamsActionType.AcknowledgeIncident:
      case MicrosoftTeamsActionType.ResolveIncident:
      case MicrosoftTeamsActionType.ViewAddIncidentNote:
      case MicrosoftTeamsActionType.SubmitIncidentNote:
      case MicrosoftTeamsActionType.ViewChangeIncidentState:
      case MicrosoftTeamsActionType.SubmitChangeIncidentState:
      case MicrosoftTeamsActionType.ViewExecuteIncidentOnCallPolicy:
      case MicrosoftTeamsActionType.SubmitExecuteIncidentOnCallPolicy:
      case MicrosoftTeamsActionType.ViewIncident:
      case MicrosoftTeamsActionType.NewIncident:
      case MicrosoftTeamsActionType.SubmitNewIncident:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async acknowledgeIncident(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { req, res } = data;
    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Incident ID"),
      );
    }

    // Send early response to Teams
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    const incidentId: ObjectID = new ObjectID(actionValue);

    try {
      // Check if already acknowledged
      const isAlreadyAcknowledged: boolean =
        await IncidentService.isIncidentAcknowledged({
          incidentId: incidentId,
        });

      if (isAlreadyAcknowledged) {
        logger.debug("Incident is already acknowledged");
        return;
      }

      // Acknowledge the incident 
      await IncidentService.acknowledgeIncident(
        incidentId,
        data.teamsRequest.userId!
      );

      logger.debug("Incident acknowledged successfully via Microsoft Teams");
    } catch (error) {
      logger.error("Error acknowledging incident via Microsoft Teams");
      logger.error(error);
    }
  }

  @CaptureSpan()
  public static async resolveIncident(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { req, res } = data;
    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Incident ID"),
      );
    }

    // Send early response to Teams
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    const incidentId: ObjectID = new ObjectID(actionValue);

    try {
      // Check if already resolved
      const isAlreadyResolved: boolean =
        await IncidentService.isIncidentResolved({
          incidentId: incidentId,
        });

      if (isAlreadyResolved) {
        logger.debug("Incident is already resolved");
        return;
      }

      await IncidentService.resolveIncident(
        incidentId,
        data.teamsRequest.userId!
      );

      logger.debug("Incident resolved successfully via Microsoft Teams");
    } catch (error) {
      logger.error("Error resolving incident via Microsoft Teams");
      logger.error(error);
    }
  }

  @CaptureSpan()
  public static async viewAddIncidentNote(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // Placeholder implementation - would show note addition modal
    logger.debug("Microsoft Teams view add incident note not yet fully implemented");
    Response.sendEmptySuccessResponse(data.req, data.res);
  }

  @CaptureSpan()
  public static async submitIncidentNote(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // Placeholder implementation - would submit note to incident
    logger.debug("Microsoft Teams submit incident note not yet fully implemented");
    Response.sendEmptySuccessResponse(data.req, data.res);
  }

  @CaptureSpan()
  public static async viewChangeIncidentState(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // Placeholder implementation - would show state change modal
    logger.debug("Microsoft Teams view change incident state not yet fully implemented");
    Response.sendEmptySuccessResponse(data.req, data.res);
  }

  @CaptureSpan()
  public static async submitChangeIncidentState(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // Placeholder implementation - would submit state change
    logger.debug("Microsoft Teams submit change incident state not yet fully implemented");
    Response.sendEmptySuccessResponse(data.req, data.res);
  }

  @CaptureSpan()
  public static async viewExecuteOnCallPolicy(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // Placeholder implementation - would show on-call policy execution modal
    logger.debug("Microsoft Teams view execute on-call policy not yet fully implemented");
    Response.sendEmptySuccessResponse(data.req, data.res);
  }

  @CaptureSpan()
  public static async executeOnCallPolicy(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // Placeholder implementation - would execute on-call policy
    logger.debug("Microsoft Teams execute on-call policy not yet fully implemented");
    Response.sendEmptySuccessResponse(data.req, data.res);
  }

  @CaptureSpan()
  public static async viewIncident(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // Placeholder implementation - would show incident details
    logger.debug("Microsoft Teams view incident not yet fully implemented");
    Response.sendEmptySuccessResponse(data.req, data.res);
  }

  @CaptureSpan()
  public static async viewNewIncidentModal(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // Placeholder implementation - would show new incident creation modal
    logger.debug("Microsoft Teams view new incident modal not yet fully implemented");
    Response.sendEmptySuccessResponse(data.req, data.res);
  }

  @CaptureSpan()
  public static async submitNewIncident(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // Placeholder implementation - would create new incident
    logger.debug("Microsoft Teams submit new incident not yet fully implemented");
    Response.sendEmptySuccessResponse(data.req, data.res);
  }

  @CaptureSpan()
  public static async executeAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, req, res } = data;
    const { userId, projectAuthToken } = teamsRequest;

    if (!projectAuthToken) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Project Auth Token"),
      );
    }

    if (!userId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid User ID"),
      );
    }

    if (data.action.actionType === MicrosoftTeamsActionType.AcknowledgeIncident) {
      await this.acknowledgeIncident({
        teamsRequest,
        action: data.action,
        req,
        res,
      });
    } else if (
      data.action.actionType === MicrosoftTeamsActionType.ResolveIncident
    ) {
      await this.resolveIncident({
        teamsRequest,
        action: data.action,
        req,
        res,
      });
    } else if (
      data.action.actionType === MicrosoftTeamsActionType.ViewAddIncidentNote
    ) {
      await this.viewAddIncidentNote({
        teamsRequest,
        action: data.action,
        req,
        res,
      });
    } else if (
      data.action.actionType === MicrosoftTeamsActionType.SubmitIncidentNote
    ) {
      await this.submitIncidentNote({
        teamsRequest,
        action: data.action,
        req,
        res,
      });
    } else if (
      data.action.actionType === MicrosoftTeamsActionType.ViewChangeIncidentState
    ) {
      await this.viewChangeIncidentState({
        teamsRequest,
        action: data.action,
        req,
        res,
      });
    } else if (
      data.action.actionType === MicrosoftTeamsActionType.SubmitChangeIncidentState
    ) {
      await this.submitChangeIncidentState({
        teamsRequest,
        action: data.action,
        req,
        res,
      });
    } else if (
      data.action.actionType === MicrosoftTeamsActionType.ViewExecuteIncidentOnCallPolicy
    ) {
      await this.viewExecuteOnCallPolicy({
        teamsRequest,
        action: data.action,
        req,
        res,
      });
    } else if (
      data.action.actionType === MicrosoftTeamsActionType.SubmitExecuteIncidentOnCallPolicy
    ) {
      await this.executeOnCallPolicy({
        teamsRequest,
        action: data.action,
        req,
        res,
      });
    } else if (
      data.action.actionType === MicrosoftTeamsActionType.ViewIncident
    ) {
      await this.viewIncident({
        teamsRequest,
        action: data.action,
        req,
        res,
      });
    } else if (
      data.action.actionType === MicrosoftTeamsActionType.NewIncident
    ) {
      await this.viewNewIncidentModal({
        teamsRequest,
        action: data.action,
        req,
        res,
      });
    } else if (
      data.action.actionType === MicrosoftTeamsActionType.SubmitNewIncident
    ) {
      await this.submitNewIncident({
        teamsRequest,
        action: data.action,
        req,
        res,
      });
    } else {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Action Type"),
      );
    }
  }
}
