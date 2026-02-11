import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentService from "../../../../Services/IncidentService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import SlackUtil from "../Slack";
import SlackActionType, {
  PrivateNoteEmojis,
  PublicNoteEmojis,
} from "./ActionTypes";
import { SlackAction, SlackRequest } from "./Auth";
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
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import WorkspaceNotificationLog from "../../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";

export default class SlackIncidentActions {
  @CaptureSpan()
  public static isIncidentAction(data: {
    actionType: SlackActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case SlackActionType.AcknowledgeIncident:
      case SlackActionType.ResolveIncident:
      case SlackActionType.ViewAddIncidentNote:
      case SlackActionType.SubmitIncidentNote:
      case SlackActionType.ViewChangeIncidentState:
      case SlackActionType.SubmitChangeIncidentState:
      case SlackActionType.ViewExecuteIncidentOnCallPolicy:
      case SlackActionType.SubmitExecuteIncidentOnCallPolicy:
      case SlackActionType.ViewIncident:
      case SlackActionType.NewIncident:
      case SlackActionType.SubmitNewIncident:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async submitNewIncident(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;
    const { botUserId, userId, projectAuthToken } = slackRequest;

    if (!projectAuthToken) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Project Auth Token"),
      );
    }

    if (!botUserId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Bot User ID"),
      );
    }

    if (data.action.actionType === SlackActionType.SubmitNewIncident) {
      // We send this early let slack know we're ok. We'll do the rest in the background.

      // if view values is empty, then return error.
      if (!data.slackRequest.viewValues) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid View Values"),
        );
      }

      if (!data.slackRequest.viewValues["incidentTitle"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Incident Title"),
        );
      }

      if (!data.slackRequest.viewValues["incidentDescription"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Incident Description"),
        );
      }

      if (!data.slackRequest.viewValues["incidentSeverity"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Incident Severity"),
        );
      }

      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const title: string =
        data.slackRequest.viewValues["incidentTitle"].toString();
      const description: string =
        data.slackRequest.viewValues["incidentDescription"].toString();
      const severity: string =
        data.slackRequest.viewValues["incidentSeverity"].toString();
      const monitors: Array<string> = (data.slackRequest.viewValues[
        "incidentMonitors"
      ] || []) as Array<string>;
      const monitorStatus: string | undefined =
        data.slackRequest.viewValues["monitorStatus"]?.toString();

      const labels: Array<string> =
        (data.slackRequest.viewValues["labels"] as Array<string>) || [];

      const onCallDutyPolicies: Array<string> =
        (data.slackRequest.viewValues["onCallDutyPolicies"] as Array<string>) ||
        [];

      const incidentMonitors: Array<ObjectID> = monitors.map(
        (monitor: string) => {
          return new ObjectID(monitor);
        },
      );
      const incidentLabels: Array<ObjectID> = labels.map((label: string) => {
        return new ObjectID(label);
      });

      const incidentOnCallPolicies: Array<ObjectID> = onCallDutyPolicies.map(
        (policy: string) => {
          return new ObjectID(policy);
        },
      );

      const incidentSeverityId: ObjectID = new ObjectID(severity);
      const monitorStatusId: ObjectID | undefined = monitorStatus
        ? new ObjectID(monitorStatus)
        : undefined;

      const incident: Incident = new Incident();
      incident.title = title;
      incident.description = description;
      incident.projectId = slackRequest.projectId!;
      if (userId) {
        incident.createdByUserId = userId;
      }
      incident.incidentSeverityId = incidentSeverityId;
      const rootCauseInMarkdown: string = `Incident created by @${slackRequest.slackUsername} on Slack.`;

      incident.rootCause = rootCauseInMarkdown;

      if (incidentOnCallPolicies.length > 0) {
        incident.onCallDutyPolicies = incidentOnCallPolicies.map(
          (policyId: ObjectID) => {
            const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
            policy.id = policyId;
            return policy;
          },
        );
      }

      if (monitors.length > 0) {
        incident.monitors = incidentMonitors.map((monitorId: ObjectID) => {
          const monitor: Monitor = new Monitor();
          monitor.id = monitorId;
          return monitor;
        });
      }

      if (monitorStatusId) {
        incident.changeMonitorStatusToId = monitorStatusId;
      }

      if (incidentLabels.length > 0) {
        incident.labels = incidentLabels.map((labelId: ObjectID) => {
          const label: Label = new Label();
          label.id = labelId;
          return label;
        });
      }

      const createdIncident: Incident = await IncidentService.create({
        data: incident,
        props: {
          isRoot: true,
        },
      });

      // post a message to Slack after the incident was created.
      const slackChannelId: string = data.action.actionValue || ""; // this is the channel id where the incident was created.

      if (slackChannelId) {
        await SlackUtil.sendMessage({
          authToken: projectAuthToken,
          userId: botUserId,
          projectId: slackRequest.projectId!,
          workspaceMessagePayload: {
            _type: "WorkspaceMessagePayload",
            channelIds: [slackChannelId],
            channelNames: [],
            workspaceType: WorkspaceType.Slack,
            messageBlocks: [
              {
                _type: "WorkspacePayloadMarkdown",
                text: `**Incident ${createdIncident.incidentNumberWithPrefix || "#" + createdIncident.incidentNumber}** created successfully. [View Incident](${await IncidentService.getIncidentLinkInDashboard(
                  slackRequest.projectId!,
                  createdIncident.id!,
                )})`,
              } as WorkspacePayloadMarkdown,
            ],
          },
        });
      }
    }
  }

  @CaptureSpan()
  public static async viewNewIncidentModal(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const blocks: Array<WorkspaceMessageBlock> = [];

    // send response to clear the action.
    Response.sendTextResponse(data.req, data.res, "");

    /*
     * show new incident modal.
     * new incident modal is :
     * Incident Title (this can be prefilled with actionValue)
     * Incident Description
     * Incident Severity (dropdown) (single select)
     * Monitors (dropdown) (miltiselect)
     * Change Monitor Status to (dropdown) (single select)
     * Labels (dropdown) (multiselect)
     */

    const incidentTitle: WorkspaceTextBoxBlock = {
      _type: "WorkspaceTextBoxBlock",
      label: "Incident Title",
      blockId: "incidentTitle",
      placeholder: "Incident Title",
      initialValue: data.action.actionValue || "",
    };

    blocks.push(incidentTitle);

    const incidentDescription: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: "Incident Description",
      blockId: "incidentDescription",
      placeholder: "Incident Description",
    };

    blocks.push(incidentDescription);

    const incidentSeveritiesForProject: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: {
          projectId: data.slackRequest.projectId!,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

    const dropdownOptions: Array<DropdownOption> =
      incidentSeveritiesForProject.map((severity: IncidentSeverity) => {
        return {
          label: severity.name || "",
          value: severity._id?.toString() || "",
        };
      });

    const incidentSeverity: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Incident Severity",
      blockId: "incidentSeverity",
      placeholder: "Select Incident Severity",
      options: dropdownOptions,
    };

    if (incidentSeveritiesForProject.length > 0) {
      blocks.push(incidentSeverity);
    }

    const monitorsForProject: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.slackRequest.projectId!,
      },
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

    const monitorDropdownOptions: Array<DropdownOption> =
      monitorsForProject.map((monitor: Monitor) => {
        return {
          label: monitor.name || "",
          value: monitor._id?.toString() || "",
        };
      });

    const incidentMonitors: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Monitors",
      blockId: "incidentMonitors",
      placeholder: "Select Monitors",
      options: monitorDropdownOptions,
      multiSelect: true,
      optional: true,
    };

    if (monitorsForProject.length > 0) {
      blocks.push(incidentMonitors);
    }

    const monitorStatusForProject: Array<MonitorStatus> =
      await MonitorStatusService.findBy({
        query: {
          projectId: data.slackRequest.projectId!,
        },
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
        sort: {
          priority: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const monitorStatusDropdownOptions: Array<DropdownOption> =
      monitorStatusForProject.map((status: MonitorStatus) => {
        return {
          label: status.name || "",
          value: status._id?.toString() || "",
        };
      });

    const monitorStatusDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Change Monitor Status to",
      blockId: "monitorStatus",
      placeholder: "Select Monitor Status",
      options: monitorStatusDropdownOptions,
      optional: true,
    };

    if (
      monitorStatusForProject.length > 0 &&
      monitorDropdownOptions.length > 0
    ) {
      blocks.push(monitorStatusDropdown);
    }

    // add on-call policy dropdown.

    const onCallPolicies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: {
          projectId: data.slackRequest.projectId!,
        },
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const onCallPolicyDropdownOptions: Array<DropdownOption> =
      onCallPolicies.map((policy: OnCallDutyPolicy) => {
        return {
          label: policy.name || "",
          value: policy._id?.toString() || "",
        };
      });

    if (onCallPolicies.length > 0) {
      const onCallPolicyDropdown: WorkspaceDropdownBlock = {
        _type: "WorkspaceDropdownBlock",
        label: "Execute On Call Policy",
        blockId: "onCallDutyPolicies",
        placeholder:
          "Select on call policies to execute when this incident is created",
        options: onCallPolicyDropdownOptions,
        multiSelect: true,
        optional: true,
      };
      blocks.push(onCallPolicyDropdown);
    }

    const labelsForProject: Array<Label> = await LabelService.findBy({
      query: {
        projectId: data.slackRequest.projectId!,
      },
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

    const labelsDropdownOptions: Array<DropdownOption> = labelsForProject.map(
      (label: Label) => {
        return {
          label: label.name || "",
          value: label._id?.toString() || "",
        };
      },
    );

    const labelsDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Labels",
      blockId: "labels",
      placeholder: "Select Labels",
      options: labelsDropdownOptions,
      multiSelect: true,
      optional: true,
    };

    if (labelsForProject.length > 0) {
      blocks.push(labelsDropdown);
    }

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "New Incident",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitNewIncident,
      actionValue: data.slackRequest.slackChannelId || "",
      blocks: blocks,
    };

    await SlackUtil.showModalToUser({
      authToken: data.slackRequest.projectAuthToken!,
      modalBlock: modalBlock,
      triggerId: data.slackRequest.triggerId!,
    });
  }

  @CaptureSpan()
  public static async acknowledgeIncident(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;
    const { botUserId, userId, projectAuthToken, slackUsername } = slackRequest;

    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Incident ID"),
      );
    }

    if (!userId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid User ID"),
      );
    }

    if (!projectAuthToken) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Project Auth Token"),
      );
    }

    if (!botUserId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Bot User ID"),
      );
    }

    if (data.action.actionType === SlackActionType.AcknowledgeIncident) {
      const incidentId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyAcknowledged: boolean =
        await IncidentService.isIncidentAcknowledged({
          incidentId: incidentId,
        });

      if (isAlreadyAcknowledged) {
        const incidentNumberResult: {
          number: number | null;
          numberWithPrefix: string | null;
        } = await IncidentService.getIncidentNumber({
          incidentId: incidentId,
        });
        const incidentNumberDisplay: string =
          incidentNumberResult.numberWithPrefix ||
          "#" + incidentNumberResult.number;

        // send a message to the channel visible to user, that the incident has already been acknowledged.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot acknowledge the **[Incident ${incidentNumberDisplay}](${await IncidentService.getIncidentLinkInDashboard(slackRequest.projectId!, incidentId)})**. It has already been acknowledged.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await IncidentService.acknowledgeIncident(incidentId, userId);

      // Log the button interaction
      if (slackRequest.projectId) {
        try {
          const logData: {
            projectId: ObjectID;
            workspaceType: WorkspaceType;
            channelId?: string;
            userId: ObjectID;
            buttonAction: string;
            incidentId?: ObjectID;
          } = {
            projectId: slackRequest.projectId,
            workspaceType: WorkspaceType.Slack,
            userId: userId,
            buttonAction: "acknowledge_incident",
          };

          if (slackRequest.slackChannelId) {
            logData.channelId = slackRequest.slackChannelId;
          }
          logData.incidentId = incidentId;

          await WorkspaceNotificationLogService.logButtonPressed(logData, {
            isRoot: true,
          });
        } catch (err) {
          logger.error("Error logging button interaction:");
          logger.error(err);
          // Don't throw the error, just log it so the main flow continues
        }
      }

      // Incident Feed will send a message to the channel that the incident has been Acknowledged.
      return;
    }

    // invlaid action type.
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid Action Type"),
    );
  }

  @CaptureSpan()
  public static async resolveIncident(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;
    const { botUserId, userId, projectAuthToken, slackUsername } = slackRequest;

    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Incident ID"),
      );
    }

    if (!userId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid User ID"),
      );
    }

    if (!projectAuthToken) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Project Auth Token"),
      );
    }

    if (!botUserId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Bot User ID"),
      );
    }

    if (data.action.actionType === SlackActionType.ResolveIncident) {
      const incidentId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyResolved: boolean =
        await IncidentService.isIncidentResolved({
          incidentId: incidentId,
        });

      if (isAlreadyResolved) {
        const incidentNumberResult: {
          number: number | null;
          numberWithPrefix: string | null;
        } = await IncidentService.getIncidentNumber({
          incidentId: incidentId,
        });
        const incidentNumberDisplay: string =
          incidentNumberResult.numberWithPrefix ||
          "#" + incidentNumberResult.number;
        // send a message to the channel visible to user, that the incident has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot resolve the **[Incident ${incidentNumberDisplay}](${await IncidentService.getIncidentLinkInDashboard(slackRequest.projectId!, incidentId)})**. It has already been resolved.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await IncidentService.resolveIncident(incidentId, userId);

      return;
    }

    // invlaid action type.
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid Action Type"),
    );
  }

  @CaptureSpan()
  public static async viewExecuteOnCallPolicy(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
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

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const incidentId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    const onCallPolicies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: {
          projectId: data.slackRequest.projectId!,
        },
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const dropdownOption: Array<DropdownOption> = onCallPolicies
      .map((policy: OnCallDutyPolicy) => {
        return {
          label: policy.name || "",
          value: policy._id?.toString() || "",
        };
      })
      .filter((option: DropdownOption) => {
        return option.label !== "" || option.value !== "";
      });

    if (dropdownOption.length === 0) {
      await SlackUtil.sendDirectMessageToUser({
        messageBlocks: [
          {
            _type: "WorkspacePayloadMarkdown",
            text: "No on-call policies found in this project.",
          } as WorkspacePayloadMarkdown,
        ],
        authToken: data.slackRequest.projectAuthToken!,
        workspaceUserId: data.slackRequest.slackUserId!,
      });
      return;
    }

    const onCallPolicyDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "On Call Policy",
      blockId: "onCallPolicy",
      placeholder: "Select On Call Policy",
      options: dropdownOption,
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Execute On Call Policy",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitExecuteIncidentOnCallPolicy,
      actionValue: actionValue,
      blocks: [onCallPolicyDropdown],
    };

    await SlackUtil.showModalToUser({
      authToken: data.slackRequest.projectAuthToken!,
      modalBlock: modalBlock,
      triggerId: data.slackRequest.triggerId!,
    });
  }

  @CaptureSpan()
  public static async viewChangeIncidentState(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
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

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const incidentId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    const incidentStates: Array<IncidentState> =
      await IncidentStateService.getAllIncidentStates({
        projectId: data.slackRequest.projectId!,
        props: {
          isRoot: true,
        },
      });

    logger.debug("Incident States: ");
    logger.debug(incidentStates);

    const dropdownOptions: Array<DropdownOption> = incidentStates
      .map((state: IncidentState) => {
        return {
          label: state.name || "",
          value: state._id?.toString() || "",
        };
      })
      .filter((option: DropdownOption) => {
        return option.label !== "" || option.value !== "";
      });

    logger.debug("Dropdown Options: ");
    logger.debug(dropdownOptions);

    const statePickerDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Incident State",
      blockId: "incidentState",
      placeholder: "Select Incident State",
      options: dropdownOptions,
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Change Incident State",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitChangeIncidentState,
      actionValue: actionValue,
      blocks: [statePickerDropdown],
    };

    await SlackUtil.showModalToUser({
      authToken: data.slackRequest.projectAuthToken!,
      modalBlock: modalBlock,
      triggerId: data.slackRequest.triggerId!,
    });
  }

  @CaptureSpan()
  public static async submitChangeIncidentState(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
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

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const incidentId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    if (
      !data.slackRequest.viewValues ||
      !data.slackRequest.viewValues["incidentState"]
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid View Values"),
      );
    }

    const incidentId: ObjectID = new ObjectID(actionValue);
    const stateString: string =
      data.slackRequest.viewValues["incidentState"].toString();

    const stateId: ObjectID = new ObjectID(stateString);

    await IncidentService.updateOneById({
      id: incidentId,
      data: {
        currentIncidentStateId: stateId,
      },
      props:
        await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
          {
            userId: data.slackRequest.userId!,
            projectId: data.slackRequest.projectId!,
          },
        ),
    });

    // Log the button interaction
    if (data.slackRequest.projectId && data.slackRequest.userId) {
      try {
        const logData: {
          projectId: ObjectID;
          workspaceType: WorkspaceType;
          channelId?: string;
          userId: ObjectID;
          buttonAction: string;
          incidentId: ObjectID;
        } = {
          projectId: data.slackRequest.projectId,
          workspaceType: WorkspaceType.Slack,
          userId: data.slackRequest.userId,
          buttonAction: "change_incident_state",
          incidentId: incidentId,
        };

        if (data.slackRequest.slackChannelId) {
          logData.channelId = data.slackRequest.slackChannelId;
        }

        await WorkspaceNotificationLogService.logButtonPressed(logData, {
          isRoot: true,
        });
      } catch (err) {
        logger.error("Error logging button interaction:");
        logger.error(err);
        // Don't throw the error, just log it so the main flow continues
      }
    }
  }

  @CaptureSpan()
  public static async executeOnCallPolicy(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;
    const { botUserId, userId, projectAuthToken, slackUsername } = slackRequest;

    const { actionValue } = data.action;

    if (!actionValue) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Incident ID"),
      );
    }

    if (!userId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid User ID"),
      );
    }

    if (!projectAuthToken) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Project Auth Token"),
      );
    }

    if (!botUserId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Bot User ID"),
      );
    }

    if (
      data.action.actionType ===
      SlackActionType.SubmitExecuteIncidentOnCallPolicy
    ) {
      const incidentId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyResolved: boolean =
        await IncidentService.isIncidentResolved({
          incidentId: incidentId,
        });

      if (isAlreadyResolved) {
        const incidentNumberResult: {
          number: number | null;
          numberWithPrefix: string | null;
        } = await IncidentService.getIncidentNumber({
          incidentId: incidentId,
        });
        const incidentNumberDisplay: string =
          incidentNumberResult.numberWithPrefix ||
          "#" + incidentNumberResult.number;
        // send a message to the channel visible to user, that the incident has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot execute the on-call policy for **[Incident ${incidentNumberDisplay}](${await IncidentService.getIncidentLinkInDashboard(slackRequest.projectId!, incidentId)})**. It has already been resolved.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      if (
        !data.slackRequest.viewValues ||
        !data.slackRequest.viewValues["onCallPolicy"]
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid View Values"),
        );
      }

      const onCallPolicyString: string =
        data.slackRequest.viewValues["onCallPolicy"].toString();

      // get the on-call policy id.
      const onCallPolicyId: ObjectID = new ObjectID(onCallPolicyString);

      await OnCallDutyPolicyService.executePolicy(onCallPolicyId, {
        triggeredByIncidentId: incidentId,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
      });
    }
  }

  @CaptureSpan()
  public static async submitIncidentNote(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
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

    // const incidentId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    // if view values is empty, then return error.

    if (!data.slackRequest.viewValues) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid View Values"),
      );
    }

    if (!data.slackRequest.viewValues["noteType"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Note Type"),
      );
    }

    if (!data.slackRequest.viewValues["note"]) {
      // return error.
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Note"),
      );
    }

    const incidentId: ObjectID = new ObjectID(actionValue);
    const note: string = data.slackRequest.viewValues["note"].toString();
    const noteType: string =
      data.slackRequest.viewValues["noteType"].toString();

    if (noteType !== "public" && noteType !== "private") {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Note Type"),
      );
    }

    // send empty response.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // if public note then, add a note.
    if (noteType === "public") {
      await IncidentPublicNoteService.addNote({
        incidentId: incidentId!,
        note: note || "",
        projectId: data.slackRequest.projectId!,
        userId: data.slackRequest.userId!,
      });
    }

    // if private note then, add a note.
    if (noteType === "private") {
      await IncidentInternalNoteService.addNote({
        incidentId: incidentId!,
        note: note || "",
        projectId: data.slackRequest.projectId!,
        userId: data.slackRequest.userId!,
      });
    }
  }

  @CaptureSpan()
  public static async viewAddIncidentNote(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
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

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const incidentId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    const notePickerDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Note Type",
      blockId: "noteType",
      placeholder: "Select Note Type",
      options: [
        {
          label: "Public Note (Will be posted on Status Page)",
          value: "public",
        },
        {
          label: "Private Note (Only visible to team members)",
          value: "private",
        },
      ],
    };

    const noteTextArea: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: "Note",
      blockId: "note",
      placeholder: "Note",
      description: "Please type in plain text or markdown.",
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Add Note",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitIncidentNote,
      actionValue: actionValue,
      blocks: [notePickerDropdown, noteTextArea],
    };

    await SlackUtil.showModalToUser({
      authToken: data.slackRequest.projectAuthToken!,
      modalBlock: modalBlock,
      triggerId: data.slackRequest.triggerId!,
    });
  }

  @CaptureSpan()
  public static async handleIncidentAction(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // now we should be all set, project is authorized and user is authorized. Lets perform some actions based on the action type.
    const actionType: SlackActionType | undefined = data.action.actionType;

    if (actionType === SlackActionType.AcknowledgeIncident) {
      return await this.acknowledgeIncident(data);
    }

    if (actionType === SlackActionType.ResolveIncident) {
      return await this.resolveIncident(data);
    }

    if (actionType === SlackActionType.ViewAddIncidentNote) {
      return await this.viewAddIncidentNote(data);
    }

    if (actionType === SlackActionType.SubmitIncidentNote) {
      return await this.submitIncidentNote(data);
    }

    if (actionType === SlackActionType.ViewExecuteIncidentOnCallPolicy) {
      return await this.viewExecuteOnCallPolicy(data);
    }

    if (actionType === SlackActionType.SubmitExecuteIncidentOnCallPolicy) {
      return await this.executeOnCallPolicy(data);
    }

    if (actionType === SlackActionType.ViewChangeIncidentState) {
      return await this.viewChangeIncidentState(data);
    }

    if (actionType === SlackActionType.SubmitChangeIncidentState) {
      return await this.submitChangeIncidentState(data);
    }

    if (actionType === SlackActionType.NewIncident) {
      return await this.viewNewIncidentModal(data);
    }

    if (actionType === SlackActionType.SubmitNewIncident) {
      return await this.submitNewIncident(data);
    }

    if (actionType === SlackActionType.ViewIncident) {
      /*
       * do nothing. This is just a view incident action.
       * clear response.
       */
      return Response.sendJsonObjectResponse(data.req, data.res, {
        response_action: "clear",
      });
    }

    // invalid action type.
    return Response.sendErrorResponse(
      data.req,
      data.res,
      new BadDataException("Invalid Action Type"),
    );
  }

  @CaptureSpan()
  public static async handleEmojiReaction(data: {
    teamId: string;
    reaction: string;
    userId: string;
    channelId: string;
    messageTs: string;
  }): Promise<void> {
    logger.debug("Handling emoji reaction with data:");
    logger.debug(data);

    const { teamId, reaction, userId, channelId, messageTs } = data;

    // Check if the emoji is a supported private or public note emoji
    const isPrivateNoteEmoji: boolean = PrivateNoteEmojis.includes(reaction);
    const isPublicNoteEmoji: boolean = PublicNoteEmojis.includes(reaction);

    if (!isPrivateNoteEmoji && !isPublicNoteEmoji) {
      logger.debug(
        `Emoji "${reaction}" is not a supported note emoji. Ignoring.`,
      );
      return;
    }

    // Get the project auth token using the team ID
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.findOneBy({
        query: {
          workspaceProjectId: teamId,
        },
        select: {
          projectId: true,
          authToken: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!projectAuth || !projectAuth.projectId || !projectAuth.authToken) {
      logger.debug(
        "No project auth found for team ID. Ignoring emoji reaction.",
      );
      return;
    }

    const projectId: ObjectID = projectAuth.projectId;
    const authToken: string = projectAuth.authToken;

    // Find the incident linked to this channel
    const workspaceLog: WorkspaceNotificationLog | null =
      await WorkspaceNotificationLogService.findOneBy({
        query: {
          channelId: channelId,
          workspaceType: WorkspaceType.Slack,
          projectId: projectId,
        },
        select: {
          incidentId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!workspaceLog || !workspaceLog.incidentId) {
      logger.debug(
        "No incident found linked to this channel. Ignoring emoji reaction.",
      );
      return;
    }

    const incidentId: ObjectID = workspaceLog.incidentId;

    // Get the incident number for the confirmation message
    const incidentNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await IncidentService.getIncidentNumber({
      incidentId: incidentId,
    });
    const incidentNumberDisplay: string =
      incidentNumberResult.numberWithPrefix ||
      "#" + incidentNumberResult.number;

    // Get the user ID in OneUptime based on Slack user ID
    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          workspaceUserId: userId,
          workspaceType: WorkspaceType.Slack,
          projectId: projectId,
        },
        select: {
          userId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!userAuth || !userAuth.userId) {
      logger.debug(
        "No OneUptime user found for Slack user. Ignoring emoji reaction.",
      );
      return;
    }

    const oneUptimeUserId: ObjectID = userAuth.userId;

    // Fetch the message text using the timestamp
    let messageText: string | null = null;
    try {
      messageText = await SlackUtil.getMessageByTimestamp({
        authToken: authToken,
        channelId: channelId,
        messageTs: messageTs,
      });
    } catch (err) {
      logger.error("Error fetching message text:");
      logger.error(err);
      return;
    }

    if (!messageText) {
      logger.debug("No message text found. Ignoring emoji reaction.");
      return;
    }

    // Create a unique identifier for this Slack message to prevent duplicate notes
    const postedFromSlackMessageId: string = `${channelId}:${messageTs}`;

    // Save the note based on the emoji type
    let noteType: string;
    try {
      if (isPrivateNoteEmoji) {
        noteType = "private";

        // Check if a note from this Slack message already exists
        const hasExistingNote: boolean =
          await IncidentInternalNoteService.hasNoteFromSlackMessage({
            incidentId: incidentId,
            postedFromSlackMessageId: postedFromSlackMessageId,
          });

        if (hasExistingNote) {
          logger.debug(
            "Private note from this Slack message already exists. Skipping duplicate.",
          );
          return;
        }

        await IncidentInternalNoteService.addNote({
          incidentId: incidentId,
          note: messageText,
          projectId: projectId,
          userId: oneUptimeUserId,
          postedFromSlackMessageId: postedFromSlackMessageId,
        });
        logger.debug("Private note added successfully.");
      } else if (isPublicNoteEmoji) {
        noteType = "public";

        // Check if a note from this Slack message already exists
        const hasExistingNote: boolean =
          await IncidentPublicNoteService.hasNoteFromSlackMessage({
            incidentId: incidentId,
            postedFromSlackMessageId: postedFromSlackMessageId,
          });

        if (hasExistingNote) {
          logger.debug(
            "Public note from this Slack message already exists. Skipping duplicate.",
          );
          return;
        }

        await IncidentPublicNoteService.addNote({
          incidentId: incidentId,
          note: messageText,
          projectId: projectId,
          userId: oneUptimeUserId,
          postedFromSlackMessageId: postedFromSlackMessageId,
        });
        logger.debug("Public note added successfully.");
      } else {
        return;
      }
    } catch (err) {
      logger.error("Error saving note:");
      logger.error(err);
      return;
    }

    // Send confirmation message as a reply to the original message thread
    try {
      const incidentLink: string = (
        await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)
      ).toString();

      const confirmationMessage: string =
        noteType === "private"
          ? `✅ Message saved as *private note* to <${incidentLink}|Incident ${incidentNumberDisplay}>.`
          : `✅ Message saved as *public note* to <${incidentLink}|Incident ${incidentNumberDisplay}>. This note will be visible on the status page.`;

      await SlackUtil.sendMessageToThread({
        authToken: authToken,
        channelId: channelId,
        threadTs: messageTs,
        text: confirmationMessage,
      });

      logger.debug("Confirmation message sent successfully.");
    } catch (err) {
      logger.error("Error sending confirmation message:");
      logger.error(err);
      // Don't throw - note was saved successfully, confirmation is best effort
    }
  }
}
