import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentService from "../../../../Services/IncidentService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import MicrosoftTeamsUtil from "../MicrosoftTeams";
import MicrosoftTeamsActionType from "./ActionTypes";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import Response from "../../../Response";
import {
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
  WorkspaceTextBoxBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import IncidentPublicNoteService from "../../../../Services/IncidentPublicNoteService";
import IncidentInternalNoteService from "../../../../Services/IncidentInternalNoteService";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import { DropdownOption } from "../../../../../UI/Components/Dropdown/Dropdown";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import IncidentStateService from "../../../../Services/IncidentStateService";
import logger from "../../../Logger";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentSeverityService from "../../../../Services/IncidentSeverityService";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import MonitorService from "../../../../Services/MonitorService";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusService from "../../../../Services/MonitorStatusService";
import Label from "../../../../../Models/DatabaseModels/Label";
import LabelService from "../../../../Services/LabelService";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import AccessTokenService from "../../../../Services/AccessTokenService";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceProjectAuthTokenService from "../../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import { JSONObject } from "../../../../../Types/JSON";

export default class MicrosoftTeamsIncidentActions {
  @CaptureSpan()
  public static isIncidentAction(data: {
    actionType: MicrosoftTeamsActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case MicrosoftTeamsActionType.ACKNOWLEDGE_INCIDENT:
      case MicrosoftTeamsActionType.RESOLVE_INCIDENT:
      case MicrosoftTeamsActionType.CREATE_INCIDENT_NOTE:
      case MicrosoftTeamsActionType.CREATE_INCIDENT_PUBLIC_NOTE:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async handleIncidentAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, action, req, res } = data;

    // Get project auth token
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.findOneBy({
        query: {
          projectId: teamsRequest.projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        select: {
          authToken: true,
          miscData: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!projectAuth || !projectAuth.authToken) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Project not connected to Microsoft Teams"),
      );
    }

    switch (action.actionType) {
      case MicrosoftTeamsActionType.ACKNOWLEDGE_INCIDENT:
        return this.acknowledgeIncident({
          teamsRequest: teamsRequest,
          action: action,
          req: req,
          res: res,
          authToken: projectAuth.authToken,
        });

      case MicrosoftTeamsActionType.RESOLVE_INCIDENT:
        return this.resolveIncident({
          teamsRequest: teamsRequest,
          action: action,
          req: req,
          res: res,
          authToken: projectAuth.authToken,
        });

      case MicrosoftTeamsActionType.CREATE_INCIDENT_NOTE:
        return this.createIncidentNote({
          teamsRequest: teamsRequest,
          action: action,
          req: req,
          res: res,
          authToken: projectAuth.authToken,
          isPublic: false,
        });

      case MicrosoftTeamsActionType.CREATE_INCIDENT_PUBLIC_NOTE:
        return this.createIncidentNote({
          teamsRequest: teamsRequest,
          action: action,
          req: req,
          res: res,
          authToken: projectAuth.authToken,
          isPublic: true,
        });

      default:
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid action type"),
        );
    }
  }

  @CaptureSpan()
  private static async acknowledgeIncident(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
    authToken: string;
  }): Promise<void> {
    const { teamsRequest, action, req, res } = data;

    const incidentId: ObjectID = new ObjectID(action.incidentId as string);

    // Get incident
    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        title: true,
        description: true,
        currentIncidentStateId: true,
      },
    });

    if (!incident) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Incident not found"),
      );
    }

    // Get acknowledged state
    const acknowledgedState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          projectId: teamsRequest.projectId,
          isAcknowledgedState: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    if (!acknowledgedState) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Acknowledged state not found"),
      );
    }

    // Update incident state
    await IncidentService.changeIncidentState({
      projectId: teamsRequest.projectId,
      incidentId: incidentId,
      incidentStateId: acknowledgedState.id!,
      shouldNotifyStatusPageSubscribers: true,
      isUpdatedFromWorkspace: true,
      notifyOwners: true,
      rootCause: "Acknowledged from Microsoft Teams",
    });

    // Send success response
    Response.sendJsonObjectResponse(req, res, {
      type: "message",
      text: `Incident ${incident.title} has been acknowledged.`,
    });
  }

  @CaptureSpan()
  private static async resolveIncident(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
    authToken: string;
  }): Promise<void> {
    const { teamsRequest, action, req, res } = data;

    const incidentId: ObjectID = new ObjectID(action.incidentId as string);

    // Get incident
    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        title: true,
        description: true,
        currentIncidentStateId: true,
      },
    });

    if (!incident) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Incident not found"),
      );
    }

    // Get resolved state
    const resolvedState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          projectId: teamsRequest.projectId,
          isResolvedState: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    if (!resolvedState) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Resolved state not found"),
      );
    }

    // Update incident state
    await IncidentService.changeIncidentState({
      projectId: teamsRequest.projectId,
      incidentId: incidentId,
      incidentStateId: resolvedState.id!,
      shouldNotifyStatusPageSubscribers: true,
      isUpdatedFromWorkspace: true,
      notifyOwners: true,
      rootCause: "Resolved from Microsoft Teams",
    });

    // Send success response
    Response.sendJsonObjectResponse(req, res, {
      type: "message",
      text: `Incident ${incident.title} has been resolved.`,
    });
  }

  @CaptureSpan()
  private static async createIncidentNote(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
    authToken: string;
    isPublic: boolean;
  }): Promise<void> {
    const { teamsRequest, action, req, res, isPublic } = data;

    const incidentId: ObjectID = new ObjectID(action.incidentId as string);
    const note: string = action.note as string;

    if (!note) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Note content is required"),
      );
    }

    // Get incident
    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        title: true,
      },
    });

    if (!incident) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Incident not found"),
      );
    }

    if (isPublic) {
      // Create public note
      await IncidentPublicNoteService.create({
        data: {
          incidentId: incidentId,
          projectId: teamsRequest.projectId,
          note: note,
          postedByName: "Microsoft Teams User",
        },
        props: {
          isRoot: true,
        },
      });
    } else {
      // Create internal note
      await IncidentInternalNoteService.create({
        data: {
          incidentId: incidentId,
          projectId: teamsRequest.projectId,
          note: note,
          postedByName: "Microsoft Teams User",
        },
        props: {
          isRoot: true,
        },
      });
    }

    // Send success response
    Response.sendJsonObjectResponse(req, res, {
      type: "message",
      text: `${isPublic ? "Public" : "Internal"} note added to incident ${
        incident.title
      }.`,
    });
  }
}