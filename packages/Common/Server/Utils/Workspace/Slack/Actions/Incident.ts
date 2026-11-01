import SlackReactionNoteActions, { SlackReactionData } from "./ReactionNote";
import { WorkspaceNoteResourceType } from "../../WorkspaceReactionNote";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentService from "../../../../Services/IncidentService";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import SlackUtil from "../Slack";
import SlackActionType from "./ActionTypes";
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
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventStanding,
  WorkspaceEventStateOption,
  WorkspaceEventStateOptions,
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
import OnCallPersonPageAnswer from "../../../OnCall/OnCallPersonPageAnswer";
import SlackActionAnswer, { SlackAnswerPlace } from "./Answer";
import WorkspaceActionAnswers, {
  WorkspaceLatePress,
} from "../../WorkspaceActionAnswers";
import IncidentStateTimeline from "../../../../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SlackActionAuthorization, {
  SlackAuthorizedEvent,
} from "./Authorization";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import SlackIncidentMoreActions from "./IncidentMoreActions";
import { WorkspacePendingActionKind } from "../../WorkspaceConnectRequest";
import WorkspaceIncidentActions from "../../WorkspaceIncidentActions";
import WorkspaceNoteForm, {
  WorkspaceNoteFormType,
  WorkspaceSubmittedNote,
} from "../../WorkspaceNoteForm";
import { PrivateRecordKind } from "../../../../../Types/StatusPage/PrivateRecordPublicNotes";
import { WorkspaceNoteType } from "../../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceCommands from "../../WorkspaceCommands";

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
        // The incident's menu (⋯), and `/oneuptime incident 42`.
        return SlackIncidentMoreActions.isAction(actionType);
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
    const { botUserId, projectAuthToken } = slackRequest;

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

      /*
       * The incident is declared by the member the Slack account is
       * connected to, with their own permissions, as they would declare it
       * in OneUptime: they must be allowed to declare incidents, and every
       * record the submitted view names - the monitors, on-call policies,
       * labels, severity and monitor status, whatever ids it carries - must
       * be one they may name. IncidentService checks those on the create
       * itself, and a record they may not read is answered like one that is
       * not in the project.
       */
      const props: DatabaseCommonInteractionProps | null =
        await SlackActionAuthorization.authorize({
          requester: slackRequest,
          modelType: Incident,
          action: SlackIncidentActions.DECLARE_ACTION,
        });

      if (!props) {
        return;
      }

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
      incident.incidentSeverityId = incidentSeverityId;
      /*
       * No root cause until somebody knows one: the incident names the
       * member who declared it already (WhoOpenedItRootCause).
       */

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

      /*
       * Created with the member's props, so it is credited to them and
       * held to what they may do and name; a refusal is told to them.
       */
      const createdIncident: Incident | null =
        await SlackActionAuthorization.runForRequester({
          requester: slackRequest,
          action: "declare the incident",
          run: async (): Promise<Incident> => {
            return await IncidentService.create({
              data: incident,
              props: props,
            });
          },
        });

      if (!createdIncident) {
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
                text: mdText`**Incident ${createdIncident.incidentNumberWithPrefix || "#" + createdIncident.incidentNumber}** created successfully. [View Incident](${await IncidentService.getIncidentLinkInDashboard(
                  slackRequest.projectId!,
                  createdIncident.id!,
                )})`.toString(),
              } as WorkspacePayloadMarkdown,
            ],
          },
        });
      }
    }
  }

  // Declaring an incident, as a refusal names it: "... to declare an incident".
  public static readonly DECLARE_ACTION: string = "declare an incident";

  // Changing its state, as a refusal names it.
  public static readonly CHANGE_STATE_ACTION: string =
    "change the state of this incident";

  // What a change-state form says instead of opening with nothing to pick.
  public static readonly NO_STATES_MESSAGE: string =
    "No incident states are available to you in this project. Ask a project admin for access to them.";

  @CaptureSpan()
  public static async viewNewIncidentModal(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const blocks: Array<WorkspaceMessageBlock> = [];

    /*
     * `/oneuptime incident`, with nothing after it, typed in an incident's
     * own channel: that incident, with its buttons - what a responder there
     * wants - and how to declare another instead. Anywhere else, and from
     * a button or a shortcut, the form, as always.
     */
    if (
      data.action.command &&
      !(data.action.actionValue || "").trim() &&
      (await SlackIncidentMoreActions.showIncidentOfChannel({
        slackRequest: data.slackRequest,
        req: data.req,
        res: data.res,
      }))
    ) {
      return;
    }

    // send response to clear the action.
    Response.sendTextResponse(data.req, data.res, "");

    /*
     * The form is filled in as the member the Slack account is connected
     * to: someone who may not declare an incident is told so now, before
     * filling it in, and every list below is read with their own
     * permissions (WorkspaceActionAuthorization.findReadable), so it offers
     * only what they may read - as the incident form in OneUptime does.
     */
    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: Incident,
        action: SlackIncidentActions.DECLARE_ACTION,
      });

    if (!props) {
      return;
    }

    const projectId: ObjectID = data.slackRequest.projectId!;

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

    const [
      incidentSeveritiesForProject,
      monitorsForProject,
      monitorStatusForProject,
      onCallPolicies,
      labelsForProject,
    ]: [
      Array<IncidentSeverity>,
      Array<Monitor>,
      Array<MonitorStatus>,
      Array<OnCallDutyPolicy>,
      Array<Label>,
    ] = await Promise.all([
      WorkspaceActionAuthorization.findReadable({
        service: IncidentSeverityService,
        props: props,
        query: {
          projectId: projectId,
          // Offered for a new pick: never an archived value.
          isArchived: false,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        select: {
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
      }),
      WorkspaceActionAuthorization.findReadable({
        service: MonitorService,
        props: props,
        query: {
          projectId: projectId,
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
          projectId: projectId,
          // Offered for a new pick: never an archived value.
          isArchived: false,
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
        service: OnCallDutyPolicyService,
        props: props,
        query: {
          projectId: projectId,
          // Archived policies page no one, so they are not offered.
          isArchived: false,
        },
        select: {
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
      }),
      WorkspaceActionAuthorization.findReadable({
        service: LabelService,
        props: props,
        query: {
          projectId: projectId,
          // Offered for a new pick: never an archived value.
          isArchived: false,
        },
        select: {
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
      }),
    ]);

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
        label: "Execute On-Call Policies",
        blockId: "onCallDutyPolicies",
        placeholder:
          "Select on-call policies to execute when this incident is created",
        options: onCallPolicyDropdownOptions,
        multiSelect: true,
        optional: true,
      };
      blocks.push(onCallPolicyDropdown);
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
      title: "New Incident",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitNewIncident,
      actionValue: data.slackRequest.slackChannelId || "",
      blocks: blocks,
    };

    await SlackActionAnswer.showModal({
      source: data.slackRequest,
      modalBlock: modalBlock,
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
    const { botUserId, userId, projectAuthToken } = slackRequest;

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

      /*
       * The incident is read once, as the member, by the check - and that
       * read answers "already acknowledged" below and goes to the write.
       */
      const authorized: SlackAuthorizedEvent | null =
        await SlackActionAuthorization.authorizeEvent({
          requester: slackRequest,
          modelType: IncidentStateTimeline,
          action: "acknowledge this incident",
          event: { type: WorkspaceEventType.Incident, id: incidentId },
        });

      if (!authorized) {
        return;
      }

      const { props, event: incident } = authorized;

      /*
       * Somebody got there first: say who and when, where the press was
       * (only the person who pressed sees it), as news, not as an error.
       * Paged into it by a person's page, the presser answered that page
       * by pressing (OnCallPersonPageAnswer): it stops, and is said first.
       */
      const standing: WorkspaceEventStanding =
        await WorkspaceMemberActions.getStanding(incident);

      if (standing.isAcknowledged) {
        await SlackActionAnswer.answerAlready({
          source: slackRequest,
          event: incident,
          press: WorkspaceLatePress.Acknowledge,
          answeredPageCount: await OnCallPersonPageAnswer.onAcknowledgePressed({
            kind: "incident",
            recordId: incident.id,
            projectId: incident.projectId,
            pressedByUserId: props.userId,
            isResolved: standing.isResolved,
          }),
        });

        return;
      }

      /*
       * Acknowledged by the member, as the dashboard acknowledges it for
       * them (WorkspaceMemberActions); a refusal is told to them.
       */
      const isAcknowledged: boolean | null =
        await SlackActionAuthorization.runForRequester({
          requester: slackRequest,
          action: "acknowledge the incident",
          run: async (): Promise<boolean> => {
            await WorkspaceMemberActions.acknowledge({
              event: incident,
              props: props,
            });
            return true;
          },
        });

      if (!isAcknowledged) {
        return;
      }

      // Pressed where only they see it: what it did.
      await SlackIncidentMoreActions.answerDoneIfPrivate({
        slackRequest: slackRequest,
        answer: () => {
          return WorkspaceActionAnswers.getDoneAnswer({
            event: incident,
            kind: WorkspacePendingActionKind.Acknowledge,
          });
        },
      });

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
          logger.error("Error logging button interaction:", {
            projectId: slackRequest.projectId?.toString(),
            incidentId: incidentId.toString(),
          });
          logger.error(err);
          // Don't throw the error, just log it so the main flow continues
        }
      }

      // Incident Feed will send a message to the channel that the incident has been Acknowledged.
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
  public static async resolveIncident(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest, req, res } = data;
    const { botUserId, userId, projectAuthToken } = slackRequest;

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

      // Read once, by the check; that read answers "already resolved".
      const authorized: SlackAuthorizedEvent | null =
        await SlackActionAuthorization.authorizeEvent({
          requester: slackRequest,
          modelType: IncidentStateTimeline,
          action: "resolve this incident",
          event: { type: WorkspaceEventType.Incident, id: incidentId },
        });

      if (!authorized) {
        return;
      }

      const { props, event: incident } = authorized;

      // Resolved already: who and when, where the press was.
      if ((await WorkspaceMemberActions.getStanding(incident)).isResolved) {
        await SlackActionAnswer.answerAlready({
          source: slackRequest,
          event: incident,
          press: WorkspaceLatePress.Resolve,
        });

        return;
      }

      // Resolved by the member, as the dashboard resolves it for them.
      const isResolved: boolean | null =
        await SlackActionAuthorization.runForRequester({
          requester: slackRequest,
          action: "resolve the incident",
          run: async (): Promise<boolean> => {
            await WorkspaceMemberActions.resolve({
              event: incident,
              props: props,
            });
            return true;
          },
        });

      if (isResolved) {
        // Pressed where only they see it: what it did.
        await SlackIncidentMoreActions.answerDoneIfPrivate({
          slackRequest: slackRequest,
          answer: () => {
            return WorkspaceActionAnswers.getDoneAnswer({
              event: incident,
              kind: WorkspacePendingActionKind.Resolve,
            });
          },
        });
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

    /*
     * Asked as the submit asks it, before the form is shown: someone who may
     * not execute an on-call policy for this incident is told so now. The
     * form then offers the policies they may read, with their own
     * permissions (WorkspaceActionAuthorization.findReadable).
     */
    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: OnCallDutyPolicyExecutionLog,
        action: "execute an on-call policy for this incident",
        resources: [
          { service: IncidentService, id: new ObjectID(actionValue) },
        ],
      });

    if (!props) {
      return;
    }

    const onCallPolicies: Array<OnCallDutyPolicy> =
      await WorkspaceActionAuthorization.findReadable({
        service: OnCallDutyPolicyService,
        props: props,
        query: {
          projectId: data.slackRequest.projectId!,
          // Archived policies page no one, so they are not offered.
          isArchived: false,
        },
        select: {
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
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
      // Said where the press was, as every other answer is.
      await SlackActionAuthorization.sendRefusal({
        requester: data.slackRequest,
        message: SlackActionAnswer.NO_ON_CALL_POLICIES_MESSAGE,
      });
      return;
    }

    const onCallPolicyDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "On-Call Policy",
      blockId: "onCallPolicy",
      placeholder: "Select On-Call Policy",
      options: dropdownOption,
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      // At most 24 characters: Slack refuses a longer modal title.
      title: "Execute On-Call Policy",
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitExecuteIncidentOnCallPolicy,
      actionValue: actionValue,
      blocks: [onCallPolicyDropdown],
    };

    await SlackActionAnswer.showModal({
      source: data.slackRequest,
      modalBlock: modalBlock,
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

    /*
     * Asked as the submit asks it, before the form is shown: someone who may
     * not change the state of this incident is told so now. The incident is read
     * as the submit reads it, with the state it is in, and the form offers
     * the states they may read that it may move into next - by the rule its
     * state timeline holds every move to (Common/Utils/StateMove) - so it
     * never offers a move the timeline would refuse.
     */
    const authorized: SlackAuthorizedEvent | null =
      await SlackActionAuthorization.authorizeEvent({
        requester: data.slackRequest,
        modelType: IncidentStateTimeline,
        action: SlackIncidentActions.CHANGE_STATE_ACTION,
        event: {
          type: WorkspaceEventType.Incident,
          id: new ObjectID(actionValue),
        },
      });

    if (!authorized) {
      return;
    }

    const stateOptions: WorkspaceEventStateOptions =
      await WorkspaceMemberActions.findStateOptions({
        event: authorized.event,
        props: authorized.props,
      });

    if (stateOptions.options.length === 0) {
      await SlackActionAuthorization.sendRefusal({
        requester: data.slackRequest,
        message: stateOptions.hasNoLaterState
          ? WorkspaceMemberActions.getNoLaterStateMessage(
              WorkspaceEventType.Incident,
            )
          : SlackIncidentActions.NO_STATES_MESSAGE,
      });
      return;
    }

    const incidentStates: Array<WorkspaceEventStateOption> =
      stateOptions.options;

    const dropdownOptions: Array<DropdownOption> = incidentStates.map(
      (state: WorkspaceEventStateOption) => {
        return {
          label: state.name,
          value: state.id.toString(),
        };
      },
    );

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

    await SlackActionAnswer.showModal({
      source: data.slackRequest,
      modalBlock: modalBlock,
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

    const authorized: SlackAuthorizedEvent | null =
      await SlackActionAuthorization.authorizeEvent({
        requester: data.slackRequest,
        modelType: IncidentStateTimeline,
        action: SlackIncidentActions.CHANGE_STATE_ACTION,
        event: { type: WorkspaceEventType.Incident, id: incidentId },
      });

    if (!authorized) {
      return;
    }

    /*
     * The state change the dashboard makes: a row in the incident's state
     * timeline, created by the member (WorkspaceMemberActions), from the
     * incident as the check read it.
     */
    const isStateChanged: boolean | null =
      await SlackActionAuthorization.runForRequester({
        requester: data.slackRequest,
        action: "change the state of the incident",
        run: async (): Promise<boolean> => {
          await WorkspaceMemberActions.changeState({
            event: authorized.event,
            stateId: stateId,
            props: authorized.props,
          });
          return true;
        },
      });

    if (!isStateChanged) {
      return;
    }

    // Opened from a message only they see: what it did.
    await SlackIncidentMoreActions.answerDoneIfPrivate({
      slackRequest: data.slackRequest,
      answer: () => {
        return WorkspaceIncidentActions.getStateChangedAnswer({
          event: authorized.event,
          stateId: stateId,
        });
      },
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
        logger.error("Error logging button interaction:", {
          projectId: data.slackRequest.projectId?.toString(),
          incidentId: incidentId.toString(),
        });
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
    const { botUserId, userId, projectAuthToken } = slackRequest;

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

      const authorized: SlackAuthorizedEvent | null =
        await SlackActionAuthorization.authorizeEvent({
          requester: slackRequest,
          modelType: OnCallDutyPolicyExecutionLog,
          action: "execute an on-call policy for this incident",
          event: { type: WorkspaceEventType.Incident, id: incidentId },
          resources: [{ service: OnCallDutyPolicyService, id: onCallPolicyId }],
        });

      if (!authorized) {
        return;
      }

      const { props, event: incident } = authorized;

      // Resolved already: nobody is paged, and the person is told why.
      if ((await WorkspaceMemberActions.getStanding(incident)).isResolved) {
        await SlackActionAnswer.answerAlready({
          source: slackRequest,
          event: incident,
          press: WorkspaceLatePress.ExecuteOnCallPolicy,
        });

        return;
      }

      /*
       * Executed by the member, as the dashboard's Execute On-Call Policy
       * executes it for them: an execution log triggered by the incident.
       */
      await SlackActionAuthorization.runForRequester({
        requester: slackRequest,
        action: "execute the on-call policy",
        run: async (): Promise<void> => {
          await WorkspaceMemberActions.executeOnCallPolicy({
            event: incident,
            onCallDutyPolicyId: onCallPolicyId,
            props: props,
          });
        },
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

    /*
     * The form's Note Type: "public" or "private" - or none, from a private
     * incident's form, which asks for none (WorkspaceNoteForm).
     */
    const submittedNoteType: string | undefined =
      data.slackRequest.viewValues["noteType"]?.toString() || undefined;

    if (
      submittedNoteType !== undefined &&
      submittedNoteType !== WorkspaceNoteFormType.Public &&
      submittedNoteType !== WorkspaceNoteFormType.Private
    ) {
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

    /*
     * What it writes: a private incident takes no public notes, so a public
     * one asked for on an incident made private since the form opened is
     * written as a private note - and the answer says so.
     */
    const submitted: WorkspaceSubmittedNote | null =
      await WorkspaceNoteForm.getSubmittedNote({
        submittedNoteType: submittedNoteType,
        kind: PrivateRecordKind.Incident,
        recordId: incidentId,
        projectId: data.slackRequest.projectId,
      });

    if (!submitted) {
      return;
    }

    const isPublic: boolean = submitted.noteType === WorkspaceNoteType.Public;

    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: data.slackRequest,
        modelType: isPublic ? IncidentPublicNote : IncidentInternalNote,
        action: isPublic
          ? "add a public note to this incident"
          : "add a private note to this incident",
        resources: [{ service: IncidentService, id: incidentId }],
      });

    if (!props) {
      return;
    }

    // Posted by the member, as the dashboard posts it for them.
    const isAdded: boolean | null =
      await SlackActionAuthorization.runForRequester({
        requester: data.slackRequest,
        action: "add the note",
        run: async (): Promise<boolean> => {
          if (isPublic) {
            await IncidentPublicNoteService.addNote({
              incidentId: incidentId,
              note: note,
              projectId: data.slackRequest.projectId!,
              props: props,
            });
            return true;
          }

          await IncidentInternalNoteService.addNote({
            incidentId: incidentId,
            note: note,
            projectId: data.slackRequest.projectId!,
            props: props,
          });
          return true;
        },
      });

    if (!isAdded) {
      return;
    }

    if (submitted.isPublicAskedOnPrivateRecord) {
      /*
       * Not the note they chose: told wherever they opened the form, with
       * what it became and why.
       */
      const place: SlackAnswerPlace | null = SlackActionAnswer.getPlace(
        data.slackRequest,
      );

      if (place) {
        await SlackActionAnswer.answer({
          place: place,
          answer: await WorkspaceNoteForm.getSavedPrivatelyAnswer({
            kind: PrivateRecordKind.Incident,
            recordId: incidentId,
            props: props,
          }),
        });
      }

      return;
    }

    // Opened from a message only they see: what it did.
    await SlackIncidentMoreActions.answerDoneIfPrivate({
      slackRequest: data.slackRequest,
      answer: () => {
        return WorkspaceIncidentActions.getNoteAddedAnswer({
          incidentId: incidentId,
          isPublic: isPublic,
          props: props,
        });
      },
    });
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

    /*
     * The note's kind - public, on the status page, or private - and the
     * note. A private incident takes no public notes, so its form asks for
     * no kind and says why (WorkspaceNoteForm).
     */
    const form: { title: string; blocks: Array<WorkspaceMessageBlock> } =
      WorkspaceNoteForm.getSlackForm({
        kind: PrivateRecordKind.Incident,
        isPrivateRecord: ObjectID.isValidUUID(actionValue)
          ? await WorkspaceNoteForm.isPrivateRecord({
              kind: PrivateRecordKind.Incident,
              recordId: new ObjectID(actionValue),
              projectId: data.slackRequest.projectId,
            })
          : false,
      });

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: form.title,
      submitButtonTitle: "Submit",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitIncidentNote,
      actionValue: actionValue,
      blocks: form.blocks,
    };

    await SlackActionAnswer.showModal({
      source: data.slackRequest,
      modalBlock: modalBlock,
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

    /*
     * `/oneuptime incident 42` - and a word that only looked like a number,
     * "IPv6", which is the new incident's title after all.
     */
    if (actionType === SlackActionType.ShowIncident) {
      return await SlackIncidentMoreActions.showIncidentByNumber({
        ...data,
        declare: async (): Promise<void> => {
          return await this.viewNewIncidentModal({
            ...data,
            action: {
              ...data.action,
              actionType: SlackActionType.NewIncident,
              actionValue: WorkspaceCommands.toTitle(
                data.action.actionValue || "",
              ),
            },
          });
        },
      });
    }

    // The incident's menu (⋯): Change Severity, Assign Role, ...
    if (SlackIncidentMoreActions.isAction(actionType)) {
      return await SlackIncidentMoreActions.handle(data);
    }

    // invalid action type.
    return Response.sendErrorResponse(
      data.req,
      data.res,
      new BadDataException("Invalid Action Type"),
    );
  }

  /*
   * A note emoji on a message, looked up among incident channels only.
   * Slack events go to SlackReactionNoteActions directly, which works out
   * what the channel belongs to first.
   */
  @CaptureSpan()
  public static async handleEmojiReaction(
    data: SlackReactionData,
  ): Promise<void> {
    await SlackReactionNoteActions.handleEmojiReaction({
      ...data,
      resourceTypes: [WorkspaceNoteResourceType.Incident],
    });
  }
}
