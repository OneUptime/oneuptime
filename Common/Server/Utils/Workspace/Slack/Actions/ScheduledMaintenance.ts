import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import SlackUtil from "../Slack";
import SlackActionType, {
  PrivateNoteEmojis,
  PublicNoteEmojis,
} from "./ActionTypes";
import { SlackAction, SlackRequest } from "./Auth";
import Response from "../../../Response";
import {
  WorkspaceDateTimePickerBlock,
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
  WorkspaceTextBoxBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import ScheduledMaintenancePublicNoteService from "../../../../Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceInternalNoteService from "../../../../Services/ScheduledMaintenanceInternalNoteService";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import { DropdownOption } from "../../../../../UI/Components/Dropdown/Dropdown";
import ScheduledMaintenanceState from "../../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateService from "../../../../Services/ScheduledMaintenanceStateService";
import logger from "../../../Logger";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorService from "../../../../Services/MonitorService";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusService from "../../../../Services/MonitorStatusService";
import Label from "../../../../../Models/DatabaseModels/Label";
import LabelService from "../../../../Services/LabelService";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import OneUptimeDate from "../../../../../Types/Date";
import AccessTokenService from "../../../../Services/AccessTokenService";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceNotificationLog from "../../../../../Models/DatabaseModels/WorkspaceNotificationLog";

export default class SlackScheduledMaintenanceActions {
  @CaptureSpan()
  public static isScheduledMaintenanceAction(data: {
    actionType: SlackActionType;
  }): boolean {
    const { actionType } = data;

    switch (actionType) {
      case SlackActionType.MarkScheduledMaintenanceAsOngoing:
      case SlackActionType.MarkScheduledMaintenanceAsComplete:
      case SlackActionType.ViewAddScheduledMaintenanceNote:
      case SlackActionType.SubmitScheduledMaintenanceNote:
      case SlackActionType.ViewChangeScheduledMaintenanceState:
      case SlackActionType.SubmitChangeScheduledMaintenanceState:
      case SlackActionType.ViewScheduledMaintenance:
      case SlackActionType.NewScheduledMaintenance:
      case SlackActionType.SubmitNewScheduledMaintenance:
        return true;
      default:
        return false;
    }
  }

  @CaptureSpan()
  public static async submitNewScheduledMaintenance(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;
    const { botUserId, userId, projectAuthToken } = slackRequest;

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
      data.action.actionType === SlackActionType.SubmitNewScheduledMaintenance
    ) {
      // We send this early let slack know we're ok. We'll do the rest in the background.

      // if view values is empty, then return error.
      if (!data.slackRequest.viewValues) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid View Values"),
        );
      }

      if (!data.slackRequest.viewValues["scheduledMaintenanceTitle"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Scheduled Maintenance Title"),
        );
      }

      if (!data.slackRequest.viewValues["scheduledMaintenanceDescription"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Scheduled Maintenance Description"),
        );
      }

      // check start date and end date.

      if (!data.slackRequest.viewValues["startDate"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Start Date"),
        );
      }

      if (!data.slackRequest.viewValues["endDate"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid End Date"),
        );
      }

      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const title: string =
        data.slackRequest.viewValues["scheduledMaintenanceTitle"]!.toString();
      const description: string =
        data.slackRequest.viewValues[
          "scheduledMaintenanceDescription"
        ].toString();

      const monitors: Array<string> = (data.slackRequest.viewValues[
        "scheduledMaintenanceMonitors"
      ] || []) as Array<string>;
      const monitorStatus: string | undefined =
        data.slackRequest.viewValues["monitorStatus"]?.toString();

      const labels: Array<string> =
        (data.slackRequest.viewValues["labels"] as Array<string>) || [];

      const scheduledMaintenanceMonitors: Array<ObjectID> = monitors.map(
        (monitor: string) => {
          return new ObjectID(monitor);
        },
      );
      const scheduledMaintenanceLabels: Array<ObjectID> = labels.map(
        (label: string) => {
          return new ObjectID(label);
        },
      );

      const monitorStatusId: ObjectID | undefined = monitorStatus
        ? new ObjectID(monitorStatus)
        : undefined;

      const startDate: Date = OneUptimeDate.fromString(
        data.slackRequest.viewValues["startDate"].toString(),
      );
      const endDate: Date = OneUptimeDate.fromString(
        data.slackRequest.viewValues["endDate"].toString(),
      );

      // make sure start and end date are in the future.
      if (OneUptimeDate.isInTheFuture(startDate) === false) {
        // send slack message to user that start date is in the past.
        const markdownPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackRequest.slackUsername}, unfortunately you cannot create a scheduled maintenance with start date in the past.`,
        };
        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdownPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });
        return;
      }

      if (OneUptimeDate.isInTheFuture(endDate) === false) {
        // send slack message to user that end date is in the past.
        const markdownPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackRequest.slackUsername}, unfortunately you cannot create a scheduled maintenance with end date in the past.`,
        };
        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdownPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });
        return;
      }

      // make sure end date is after start date.

      if (OneUptimeDate.isAfter(endDate, startDate) === false) {
        // send slack message to user that end date is before start date.
        const markdownPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackRequest.slackUsername}, unfortunately you cannot create a scheduled maintenance with end date before start date.`,
        };
        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdownPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });
        return;
      }

      const scheduledMaintenance: ScheduledMaintenance =
        new ScheduledMaintenance();
      scheduledMaintenance.title = title;
      scheduledMaintenance.description = description;
      scheduledMaintenance.projectId = slackRequest.projectId!;

      if (userId) {
        scheduledMaintenance.createdByUserId = userId;
      }

      scheduledMaintenance.startsAt = startDate;
      scheduledMaintenance.endsAt = endDate;

      if (monitors.length > 0) {
        scheduledMaintenance.monitors = scheduledMaintenanceMonitors.map(
          (monitorId: ObjectID) => {
            const monitor: Monitor = new Monitor();
            monitor.id = monitorId;
            return monitor;
          },
        );
      }

      if (monitorStatusId) {
        scheduledMaintenance.changeMonitorStatusToId = monitorStatusId;
      }

      if (scheduledMaintenanceLabels.length > 0) {
        scheduledMaintenance.labels = scheduledMaintenanceLabels.map(
          (labelId: ObjectID) => {
            const label: Label = new Label();
            label.id = labelId;
            return label;
          },
        );
      }

      const createdEvent: ScheduledMaintenance =
        await ScheduledMaintenanceService.create({
          data: scheduledMaintenance,
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
                text: `**Scheduled Event #${createdEvent.scheduledMaintenanceNumber}** created successfully. [View Event](${await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                  slackRequest.projectId!,
                  createdEvent.id!,
                )})`,
              } as WorkspacePayloadMarkdown,
            ],
          },
        });
      }
    }
  }

  @CaptureSpan()
  public static async viewNewScheduledMaintenanceModal(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const blocks: Array<WorkspaceMessageBlock> = [];

    // send response to clear the action.
    Response.sendTextResponse(data.req, data.res, "");

    /*
     * show new scheduledMaintenance modal.
     * new scheduledMaintenance modal is :
     * ScheduledMaintenance Title (this can be prefilled with actionValue)
     * ScheduledMaintenance Description
     * Start Date and Time (date picker)
     * End Date and Time (date picker)
     * Monitors (dropdown) (miltiselect)
     * Change Monitor Status to (dropdown) (single select)
     */

    // Labels (dropdown) (multiselect)

    const scheduledMaintenanceTitle: WorkspaceTextBoxBlock = {
      _type: "WorkspaceTextBoxBlock",
      label: "Event Title",
      blockId: "scheduledMaintenanceTitle",
      placeholder: "Scheduled Maintenance Title",
      initialValue: data.action.actionValue || "",
    };

    blocks.push(scheduledMaintenanceTitle);

    const scheduledMaintenanceDescription: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: "Event Description",
      blockId: "scheduledMaintenanceDescription",
      placeholder: "Scheduled Maintenance Description",
    };

    blocks.push(scheduledMaintenanceDescription);

    // start date
    const startDatePicker: WorkspaceDateTimePickerBlock = {
      _type: "WorkspaceDateTimePickerBlock",
      label: "Start Date and Time",
      blockId: "startDate",
      optional: false,
    };

    blocks.push(startDatePicker);

    // end date

    const endDatePicker: WorkspaceDateTimePickerBlock = {
      _type: "WorkspaceDateTimePickerBlock",
      label: "End Date and Time",
      blockId: "endDate",
      optional: false,
    };

    blocks.push(endDatePicker);

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

    const scheduledMaintenanceMonitors: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Monitors affected",
      blockId: "scheduledMaintenanceMonitors",
      placeholder: "Select Monitors",
      options: monitorDropdownOptions,
      multiSelect: true,
      optional: true,
    };

    if (monitorsForProject.length > 0) {
      blocks.push(scheduledMaintenanceMonitors);
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
      description:
        "Select the status you want to change the monitor to when the event starts.",
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
      title: "New Scheduled Event",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitNewScheduledMaintenance,
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
  public static async markScheduledMaintenanceAsOngoing(data: {
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
        new BadDataException("Invalid Scheduled Maintenance ID"),
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
      SlackActionType.MarkScheduledMaintenanceAsOngoing
    ) {
      const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyOngoing: boolean =
        await ScheduledMaintenanceService.isScheduledMaintenanceOngoing({
          scheduledMaintenanceId: scheduledMaintenanceId,
        });

      if (isAlreadyOngoing) {
        const scheduledMaintenanceNumber: number | null =
          await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
            scheduledMaintenanceId: scheduledMaintenanceId,
          });

        // send a message to the channel visible to user, that the scheduledMaintenance has already been acknowledged.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot change the state to ongoing because the **[Scheduled Maintenance ${scheduledMaintenanceNumber?.toString()}](${await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(slackRequest.projectId!, scheduledMaintenanceId)})** is already in ongoing state.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await ScheduledMaintenanceService.markScheduledMaintenanceAsOngoing(
        scheduledMaintenanceId,
        userId,
      );

      // Log the button interaction
      if (slackRequest.projectId) {
        try {
          const logData: {
            projectId: ObjectID;
            workspaceType: WorkspaceType;
            channelId?: string;
            userId: ObjectID;
            buttonAction: string;
            scheduledMaintenanceId?: ObjectID;
          } = {
            projectId: slackRequest.projectId,
            workspaceType: WorkspaceType.Slack,
            userId: userId,
            buttonAction: "mark_scheduled_maintenance_as_ongoing",
          };

          if (slackRequest.slackChannelId) {
            logData.channelId = slackRequest.slackChannelId;
          }
          logData.scheduledMaintenanceId = scheduledMaintenanceId;

          await WorkspaceNotificationLogService.logButtonPressed(logData, {
            isRoot: true,
          });
        } catch (err) {
          logger.error("Error logging button interaction:");
          logger.error(err);
          // Don't throw the error, just log it so the main flow continues
        }
      }

      // Scheduled Maintenance Feed will send a message to the channel that the scheduledMaintenance has been Ongoing.
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
  public static async resolveScheduledMaintenance(data: {
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
        new BadDataException("Invalid Scheduled Maintenance ID"),
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
      SlackActionType.MarkScheduledMaintenanceAsComplete
    ) {
      const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);

      // We send this early let slack know we're ok. We'll do the rest in the background.
      Response.sendJsonObjectResponse(req, res, {
        response_action: "clear",
      });

      const isAlreadyResolved: boolean =
        await ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
          scheduledMaintenanceId: scheduledMaintenanceId,
        });

      if (isAlreadyResolved) {
        const scheduledMaintenanceNumber: number | null =
          await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
            scheduledMaintenanceId: scheduledMaintenanceId,
          });
        // send a message to the channel visible to user, that the scheduledMaintenance has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: `@${slackUsername}, unfortunately you cannot resolve the **[Scheduled Maintenance ${scheduledMaintenanceNumber?.toString()}](${await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(slackRequest.projectId!, scheduledMaintenanceId)})**. It has already been resolved.`,
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      await ScheduledMaintenanceService.markScheduledMaintenanceAsComplete(
        scheduledMaintenanceId,
        userId,
      );

      // Log the button interaction
      if (slackRequest.projectId) {
        try {
          const logData: {
            projectId: ObjectID;
            workspaceType: WorkspaceType;
            channelId?: string;
            userId: ObjectID;
            buttonAction: string;
            scheduledMaintenanceId?: ObjectID;
          } = {
            projectId: slackRequest.projectId,
            workspaceType: WorkspaceType.Slack,
            userId: userId,
            buttonAction: "mark_scheduled_maintenance_as_complete",
          };

          if (slackRequest.slackChannelId) {
            logData.channelId = slackRequest.slackChannelId;
          }
          logData.scheduledMaintenanceId = scheduledMaintenanceId;

          await WorkspaceNotificationLogService.logButtonPressed(logData, {
            isRoot: true,
          });
        } catch (err) {
          logger.error("Error logging button interaction:");
          logger.error(err);
          // Don't throw the error, just log it so the main flow continues
        }
      }

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
  public static async viewChangeScheduledMaintenanceState(data: {
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
        new BadDataException("Invalid Scheduled Maintenance ID"),
      );
    }

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    const scheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
      await ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates({
        projectId: data.slackRequest.projectId!,
        props: {
          isRoot: true,
        },
      });

    logger.debug("Scheduled Maintenance States: ");
    logger.debug(scheduledMaintenanceStates);

    const dropdownOptions: Array<DropdownOption> = scheduledMaintenanceStates
      .map((state: ScheduledMaintenanceState) => {
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
      label: "Scheduled Maintenance State",
      blockId: "scheduledMaintenanceState",
      placeholder: "Select Scheduled Maintenance State",
      options: dropdownOptions,
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Change Event State",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitChangeScheduledMaintenanceState,
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
  public static async submitChangeScheduledMaintenanceState(data: {
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
        new BadDataException("Invalid Scheduled Maintenance ID"),
      );
    }

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);

    // send a modal with a dropdown that says "Public Note" or "Private Note" and a text area to add the note.

    if (
      !data.slackRequest.viewValues ||
      !data.slackRequest.viewValues["scheduledMaintenanceState"]
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid View Values"),
      );
    }

    const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);
    const stateString: string =
      data.slackRequest.viewValues["scheduledMaintenanceState"].toString();

    const stateId: ObjectID = new ObjectID(stateString);

    await ScheduledMaintenanceService.updateOneById({
      id: scheduledMaintenanceId,
      data: {
        currentScheduledMaintenanceStateId: stateId,
      },
      props:
        await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
          {
            userId: data.slackRequest.userId!,
            projectId: data.slackRequest.projectId!,
          },
        ),
    });
  }

  @CaptureSpan()
  public static async submitScheduledMaintenanceNote(data: {
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
        new BadDataException("Invalid Scheduled Maintenance ID"),
      );
    }

    // const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);

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

    const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);
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
      await ScheduledMaintenancePublicNoteService.addNote({
        scheduledMaintenanceId: scheduledMaintenanceId!,
        note: note || "",
        projectId: data.slackRequest.projectId!,
        userId: data.slackRequest.userId!,
      });
    }

    // if private note then, add a note.
    if (noteType === "private") {
      await ScheduledMaintenanceInternalNoteService.addNote({
        scheduledMaintenanceId: scheduledMaintenanceId!,
        note: note || "",
        projectId: data.slackRequest.projectId!,
        userId: data.slackRequest.userId!,
      });
    }
  }

  @CaptureSpan()
  public static async viewAddScheduledMaintenanceNote(data: {
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
        new BadDataException("Invalid Scheduled Maintenance ID"),
      );
    }

    // We send this early let slack know we're ok. We'll do the rest in the background.
    Response.sendJsonObjectResponse(req, res, {
      response_action: "clear",
    });

    // const scheduledMaintenanceId: ObjectID = new ObjectID(actionValue);

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
      actionId: SlackActionType.SubmitScheduledMaintenanceNote,
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
  public static async handleScheduledMaintenanceAction(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    // now we should be all set, project is authorized and user is authorized. Lets perform some actions based on the action type.
    const actionType: SlackActionType | undefined = data.action.actionType;

    if (actionType === SlackActionType.MarkScheduledMaintenanceAsOngoing) {
      return await this.markScheduledMaintenanceAsOngoing(data);
    }

    if (actionType === SlackActionType.MarkScheduledMaintenanceAsComplete) {
      return await this.resolveScheduledMaintenance(data);
    }

    if (actionType === SlackActionType.ViewAddScheduledMaintenanceNote) {
      return await this.viewAddScheduledMaintenanceNote(data);
    }

    if (actionType === SlackActionType.SubmitScheduledMaintenanceNote) {
      return await this.submitScheduledMaintenanceNote(data);
    }

    if (actionType === SlackActionType.ViewChangeScheduledMaintenanceState) {
      return await this.viewChangeScheduledMaintenanceState(data);
    }

    if (actionType === SlackActionType.SubmitChangeScheduledMaintenanceState) {
      return await this.submitChangeScheduledMaintenanceState(data);
    }

    if (actionType === SlackActionType.NewScheduledMaintenance) {
      return await this.viewNewScheduledMaintenanceModal(data);
    }

    if (actionType === SlackActionType.SubmitNewScheduledMaintenance) {
      return await this.submitNewScheduledMaintenance(data);
    }

    if (actionType === SlackActionType.ViewScheduledMaintenance) {
      /*
       * do nothing. This is just a view scheduledMaintenance action.
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
    logger.debug("Handling emoji reaction for Scheduled Maintenance with data:");
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
    const projectAuth =
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
      logger.debug("No project auth found for team ID. Ignoring emoji reaction.");
      return;
    }

    const projectId: ObjectID = projectAuth.projectId;
    const authToken: string = projectAuth.authToken;

    // Find the scheduled maintenance linked to this channel
    const workspaceLog: WorkspaceNotificationLog | null =
      await WorkspaceNotificationLogService.findOneBy({
        query: {
          channelId: channelId,
          workspaceType: WorkspaceType.Slack,
          projectId: projectId,
        },
        select: {
          scheduledMaintenanceId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!workspaceLog || !workspaceLog.scheduledMaintenanceId) {
      logger.debug(
        "No scheduled maintenance found linked to this channel. Ignoring emoji reaction.",
      );
      return;
    }

    const scheduledMaintenanceId: ObjectID = workspaceLog.scheduledMaintenanceId;

    // Get the scheduled maintenance number for the confirmation message
    const scheduledMaintenanceNumber: number | null =
      await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
        scheduledMaintenanceId: scheduledMaintenanceId,
      });

    // Get the user ID in OneUptime based on Slack user ID
    const userAuth = await WorkspaceUserAuthTokenService.findOneBy({
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

    // Save the note based on the emoji type
    let noteType: string;
    try {
      if (isPrivateNoteEmoji) {
        noteType = "private";
        await ScheduledMaintenanceInternalNoteService.addNote({
          scheduledMaintenanceId: scheduledMaintenanceId,
          note: messageText,
          projectId: projectId,
          userId: oneUptimeUserId,
        });
        logger.debug("Private note added successfully.");
      } else if (isPublicNoteEmoji) {
        noteType = "public";
        await ScheduledMaintenancePublicNoteService.addNote({
          scheduledMaintenanceId: scheduledMaintenanceId,
          note: messageText,
          projectId: projectId,
          userId: oneUptimeUserId,
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
      const scheduledMaintenanceLink: string = (
        await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(projectId, scheduledMaintenanceId)
      ).toString();

      const confirmationMessage: string =
        noteType === "private"
          ? `✅ Message saved as *private note* to <${scheduledMaintenanceLink}|Scheduled Maintenance #${scheduledMaintenanceNumber}>.`
          : `✅ Message saved as *public note* to <${scheduledMaintenanceLink}|Scheduled Maintenance #${scheduledMaintenanceNumber}>. This note will be visible on the status page.`;

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
