import SlackReactionNoteActions, { SlackReactionData } from "./ReactionNote";
import { WorkspaceNoteResourceType } from "../../WorkspaceReactionNote";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import SlackUtil from "../Slack";
import SlackActionType from "./ActionTypes";
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
import logger, { LogAttributes } from "../../../Logger";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorService from "../../../../Services/MonitorService";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusService from "../../../../Services/MonitorStatusService";
import Label from "../../../../../Models/DatabaseModels/Label";
import LabelService from "../../../../Services/LabelService";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import OneUptimeDate from "../../../../../Types/Date";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventStateOption,
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
import ScheduledMaintenanceStateTimeline from "../../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ScheduledMaintenancePublicNote from "../../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceInternalNote from "../../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SlackActionAuthorization from "./Authorization";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";

export default class SlackScheduledMaintenanceActions {
  // Changing an event's state, as a refusal names it.
  public static readonly CHANGE_STATE_ACTION: string =
    "change the state of this scheduled maintenance event";

  // What a change-state form says instead of opening with nothing to pick.
  public static readonly NO_STATES_MESSAGE: string =
    "No scheduled maintenance states are available to you in this project. Ask a project admin for access to them.";

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

      /*
       * Created by the member the Slack account is connected to, with
       * their own permissions, as they would create it in OneUptime: they
       * must be allowed to create events, and every record the submitted
       * view names - the monitors, labels and monitor status, whatever ids
       * it carries - must be one they may name. ScheduledMaintenanceService
       * checks those on the create itself, and a record they may not read is
       * answered like one that is not in the project.
       */
      const props: DatabaseCommonInteractionProps | null =
        await SlackActionAuthorization.authorize({
          requester: slackRequest,
          modelType: ScheduledMaintenance,
          action: "create a scheduled maintenance event",
          resources: [],
        });

      if (!props) {
        return;
      }

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
          text: mdText`@${slackRequest.slackUsername}, unfortunately you cannot create a scheduled maintenance with start date in the past.`.toString(),
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
          text: mdText`@${slackRequest.slackUsername}, unfortunately you cannot create a scheduled maintenance with end date in the past.`.toString(),
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
          text: mdText`@${slackRequest.slackUsername}, unfortunately you cannot create a scheduled maintenance with end date before start date.`.toString(),
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

      const createdEvent: ScheduledMaintenance | null =
        await SlackActionAuthorization.runForRequester({
          requester: slackRequest,
          action: "create the scheduled maintenance event",
          run: async (): Promise<ScheduledMaintenance> => {
            return await ScheduledMaintenanceService.create({
              data: scheduledMaintenance,
              props: props,
            });
          },
        });

      if (!createdEvent) {
        return;
      }

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
                text: mdText`**Scheduled Event ${createdEvent.scheduledMaintenanceNumberWithPrefix || "#" + createdEvent.scheduledMaintenanceNumber}** created successfully. [View Event](${await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                  slackRequest.projectId!,
                  createdEvent.id!,
                )})`.toString(),
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
     * The form is filled in as the member the Slack account is connected
     * to: someone who may not create a scheduled maintenance event is told
     * so now, before filling it in, and every list below is read with their
     * own permissions (WorkspaceActionAuthorization.findReadable), so it
     * offers only what they may read - as the form in OneUptime does.
     */
    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: ScheduledMaintenance,
        action: "create a scheduled maintenance event",
      });

    if (!props) {
      return;
    }

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

    const [monitorsForProject, monitorStatusForProject, labelsForProject]: [
      Array<Monitor>,
      Array<MonitorStatus>,
      Array<Label>,
    ] = await Promise.all([
      WorkspaceActionAuthorization.findReadable({
        service: MonitorService,
        props: props,
        query: {
          projectId: data.slackRequest.projectId!,
        },
        select: {
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
      }),
      WorkspaceActionAuthorization.findReadable({
        service: MonitorStatusService,
        props: props,
        query: {
          projectId: data.slackRequest.projectId!,
        },
        select: {
          name: true,
        },
        sort: {
          priority: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
      }),
      WorkspaceActionAuthorization.findReadable({
        service: LabelService,
        props: props,
        query: {
          projectId: data.slackRequest.projectId!,
        },
        select: {
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
      }),
    ]);

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

      const props: DatabaseCommonInteractionProps | null =
        await SlackActionAuthorization.authorize({
          requester: slackRequest,
          modelType: ScheduledMaintenanceStateTimeline,
          action: "mark this scheduled maintenance event as ongoing",
          resources: [
            {
              service: ScheduledMaintenanceService,
              id: scheduledMaintenanceId,
            },
          ],
        });

      if (!props) {
        return;
      }

      const isAlreadyOngoing: boolean =
        await ScheduledMaintenanceService.isScheduledMaintenanceOngoing({
          scheduledMaintenanceId: scheduledMaintenanceId,
        });

      if (isAlreadyOngoing) {
        const scheduledMaintenanceNumberResult: {
          number: number | null;
          numberWithPrefix: string | null;
        } = await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
          scheduledMaintenanceId: scheduledMaintenanceId,
        });

        // send a message to the channel visible to user, that the scheduledMaintenance has already been acknowledged.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: mdText`@${slackUsername}, unfortunately you cannot change the state to ongoing because the **[Scheduled Maintenance ${scheduledMaintenanceNumberResult.numberWithPrefix || "#" + scheduledMaintenanceNumberResult.number}](${await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(slackRequest.projectId!, scheduledMaintenanceId)})** is already in ongoing state.`.toString(),
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      /*
       * Marked by the member, as the dashboard marks it for them
       * (WorkspaceMemberActions); a refusal is told to them.
       */
      const isMarked: boolean | null =
        await SlackActionAuthorization.runForRequester({
          requester: slackRequest,
          action: "mark the scheduled maintenance event as ongoing",
          run: async (): Promise<boolean> => {
            await WorkspaceMemberActions.markScheduledMaintenanceAsOngoing({
              scheduledMaintenanceId: scheduledMaintenanceId,
              props: props,
            });
            return true;
          },
        });

      if (!isMarked) {
        return;
      }

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
          logger.error("Error logging button interaction:", {
            projectId: slackRequest.projectId?.toString(),
            scheduledMaintenanceId: scheduledMaintenanceId?.toString(),
          } as LogAttributes);
          logger.error(err, {
            projectId: slackRequest.projectId?.toString(),
            scheduledMaintenanceId: scheduledMaintenanceId?.toString(),
          } as LogAttributes);
          // Don't throw the error, just log it so the main flow continues
        }
      }

      // Scheduled Maintenance Feed will send a message to the channel that the scheduledMaintenance has been Ongoing.
      return;
    }

    // invalid action type.
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

      const props: DatabaseCommonInteractionProps | null =
        await SlackActionAuthorization.authorize({
          requester: slackRequest,
          modelType: ScheduledMaintenanceStateTimeline,
          action: "mark this scheduled maintenance event as complete",
          resources: [
            {
              service: ScheduledMaintenanceService,
              id: scheduledMaintenanceId,
            },
          ],
        });

      if (!props) {
        return;
      }

      const isAlreadyResolved: boolean =
        await ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
          scheduledMaintenanceId: scheduledMaintenanceId,
        });

      if (isAlreadyResolved) {
        const scheduledMaintenanceNumberResult: {
          number: number | null;
          numberWithPrefix: string | null;
        } = await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
          scheduledMaintenanceId: scheduledMaintenanceId,
        });
        // send a message to the channel visible to user, that the scheduledMaintenance has already been Resolved.
        const markdwonPayload: WorkspacePayloadMarkdown = {
          _type: "WorkspacePayloadMarkdown",
          text: mdText`@${slackUsername}, unfortunately you cannot resolve the **[Scheduled Maintenance ${scheduledMaintenanceNumberResult.numberWithPrefix || "#" + scheduledMaintenanceNumberResult.number}](${await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(slackRequest.projectId!, scheduledMaintenanceId)})**. It has already been resolved.`.toString(),
        };

        await SlackUtil.sendDirectMessageToUser({
          messageBlocks: [markdwonPayload],
          authToken: projectAuthToken,
          workspaceUserId: slackRequest.slackUserId!,
        });

        return;
      }

      // Marked by the member, as the dashboard marks it for them.
      const isMarked: boolean | null =
        await SlackActionAuthorization.runForRequester({
          requester: slackRequest,
          action: "mark the scheduled maintenance event as complete",
          run: async (): Promise<boolean> => {
            await WorkspaceMemberActions.resolve({
              event: {
                type: WorkspaceEventType.ScheduledMaintenance,
                id: scheduledMaintenanceId,
              },
              props: props,
            });
            return true;
          },
        });

      if (!isMarked) {
        return;
      }

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
          logger.error("Error logging button interaction:", {
            projectId: slackRequest.projectId?.toString(),
            scheduledMaintenanceId: scheduledMaintenanceId?.toString(),
          } as LogAttributes);
          logger.error(err, {
            projectId: slackRequest.projectId?.toString(),
            scheduledMaintenanceId: scheduledMaintenanceId?.toString(),
          } as LogAttributes);
          // Don't throw the error, just log it so the main flow continues
        }
      }

      return;
    }

    // invalid action type.
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

    /*
     * Asked as the submit asks it, before the form is shown: someone who may
     * not change the state of this event is told so now. The form then
     * offers the states they may read, read with their own permissions, as
     * the dashboard's state panel lists them for them.
     */
    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: ScheduledMaintenanceStateTimeline,
        action: SlackScheduledMaintenanceActions.CHANGE_STATE_ACTION,
        resources: [
          {
            service: ScheduledMaintenanceService,
            id: new ObjectID(actionValue),
          },
        ],
      });

    if (!props) {
      return;
    }

    const scheduledMaintenanceStates: Array<WorkspaceEventStateOption> =
      await WorkspaceMemberActions.findStateOptions({
        type: WorkspaceEventType.ScheduledMaintenance,
        projectId: data.slackRequest.projectId!,
        props: props,
      });

    if (scheduledMaintenanceStates.length === 0) {
      await SlackActionAuthorization.sendRefusal({
        requester: data.slackRequest,
        message: SlackScheduledMaintenanceActions.NO_STATES_MESSAGE,
      });
      return;
    }

    const dropdownOptions: Array<DropdownOption> =
      scheduledMaintenanceStates.map((state: WorkspaceEventStateOption) => {
        return {
          label: state.name,
          value: state.id.toString(),
        };
      });

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

    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: ScheduledMaintenanceStateTimeline,
        action: SlackScheduledMaintenanceActions.CHANGE_STATE_ACTION,
        resources: [
          { service: ScheduledMaintenanceService, id: scheduledMaintenanceId },
        ],
      });

    if (!props) {
      return;
    }

    /*
     * The state change the dashboard makes: a row in the event's state
     * timeline, created by the member (WorkspaceMemberActions).
     */
    await SlackActionAuthorization.runForRequester({
      requester: data.slackRequest,
      action: "change the state of the scheduled maintenance event",
      run: async (): Promise<void> => {
        await WorkspaceMemberActions.changeState({
          event: {
            type: WorkspaceEventType.ScheduledMaintenance,
            id: scheduledMaintenanceId,
          },
          stateId: stateId,
          props: props,
        });
      },
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

    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType:
          noteType === "public"
            ? ScheduledMaintenancePublicNote
            : ScheduledMaintenanceInternalNote,
        action:
          noteType === "public"
            ? "add a public note to this scheduled maintenance event"
            : "add a private note to this scheduled maintenance event",
        resources: [
          { service: ScheduledMaintenanceService, id: scheduledMaintenanceId },
        ],
      });

    if (!props) {
      return;
    }

    // Posted by the member, as the dashboard posts it for them.
    await SlackActionAuthorization.runForRequester({
      requester: data.slackRequest,
      action: "add the note",
      run: async (): Promise<void> => {
        if (noteType === "public") {
          await ScheduledMaintenancePublicNoteService.addNote({
            scheduledMaintenanceId: scheduledMaintenanceId,
            note: note,
            projectId: data.slackRequest.projectId!,
            props: props,
          });
          return;
        }

        await ScheduledMaintenanceInternalNoteService.addNote({
          scheduledMaintenanceId: scheduledMaintenanceId,
          note: note,
          projectId: data.slackRequest.projectId!,
          props: props,
        });
      },
    });
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

  /*
   * A note emoji on a message, looked up among scheduled maintenance channels only.
   * Slack events go to SlackReactionNoteActions directly, which works out
   * what the channel belongs to first.
   */
  @CaptureSpan()
  public static async handleEmojiReaction(
    data: SlackReactionData,
  ): Promise<void> {
    await SlackReactionNoteActions.handleEmojiReaction({
      ...data,
      resourceTypes: [WorkspaceNoteResourceType.ScheduledMaintenance],
    });
  }
}
