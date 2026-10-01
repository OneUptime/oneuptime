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
import { TurnContext } from "botbuilder";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import IncidentPublicNoteService from "../../../../Services/IncidentPublicNoteService";
import IncidentInternalNoteService from "../../../../Services/IncidentInternalNoteService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import IncidentStateService from "../../../../Services/IncidentStateService";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Label from "../../../../../Models/DatabaseModels/Label";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import URL from "../../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MicrosoftTeamsActionAuthorization from "./Authorization";
import WorkspaceProjectReferenceValidator from "../../WorkspaceProjectReferenceValidator";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import IncidentStateTimeline from "../../../../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import { escapeMarkdownValue } from "../../../../../Utils/Markdown/MarkdownEscape";
import ColumnLength from "../../../../../Types/Database/ColumnLength";
import { truncateToLength } from "../../../Database/TruncateColumnValue";
import MicrosoftTeamsCardChoices, {
  MicrosoftTeamsCardChoiceList,
} from "../MicrosoftTeamsCardChoices";
import { MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES } from "../MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies from "../MicrosoftTeamsReplies";

// Incident.title is a LongText column.
const MICROSOFT_TEAMS_INCIDENT_TITLE_MAX_LENGTH: number = ColumnLength.LongText;

// The lists the "Create New Incident" card offers.
export interface MicrosoftTeamsNewIncidentFormChoices {
  severities: MicrosoftTeamsCardChoiceList;
  monitors: MicrosoftTeamsCardChoiceList;
  monitorStatuses: MicrosoftTeamsCardChoiceList;
  labels: MicrosoftTeamsCardChoiceList;
  onCallDutyPolicies: MicrosoftTeamsCardChoiceList;
}

export default class MicrosoftTeamsIncidentActions {
  @CaptureSpan()
  public static isIncidentAction(data: { actionType: string }): boolean {
    // Check if the action is related to incidents
    return (
      data.actionType === MicrosoftTeamsIncidentActionType.AckIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.ResolveIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.ViewIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.IncidentCreated ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.IncidentStateChanged ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.ViewAddIncidentNote ||
      data.actionType === MicrosoftTeamsIncidentActionType.SubmitIncidentNote ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.ExecuteIncidentOnCallPolicy ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.ViewExecuteIncidentOnCallPolicy ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.ViewChangeIncidentState ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState ||
      data.actionType === MicrosoftTeamsIncidentActionType.NewIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.SubmitNewIncident
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

    logger.debug("Handling Microsoft Teams incident action:", {
      projectId: teamsRequest.projectId.toString(),
      actionType: action.actionType,
    });
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

        case MicrosoftTeamsIncidentActionType.NewIncident:
          return await this.showNewIncidentCard(data);

        case MicrosoftTeamsIncidentActionType.SubmitNewIncident:
          /*
           * This is handled by handleBotIncidentAction through bot framework
           * Don't process it here to avoid duplicate messages
           */
          break;

        default:
          logger.debug("Unhandled incident action: " + action.actionType, {
            projectId: teamsRequest.projectId.toString(),
            actionType: action.actionType,
          });
          break;
      }
    } catch (error) {
      logger.error("Error handling Microsoft Teams incident action:", {
        projectId: teamsRequest.projectId.toString(),
        actionType: action.actionType,
      });
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
      logger.error("No incident ID provided for acknowledge action", {
        projectId: data.teamsRequest.projectId.toString(),
      });
      return;
    }

    logger.debug("Acknowledging incident: " + incidentId, {
      projectId: data.teamsRequest.projectId.toString(),
      incidentId: incidentId,
    });

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
        logger.error("Incident not found: " + incidentId, {
          projectId: data.teamsRequest.projectId.toString(),
          incidentId: incidentId,
        });
        return;
      }

      // Check if already acknowledged
      if (incident.currentIncidentState?.isAcknowledgedState) {
        logger.debug("Incident is already acknowledged", {
          projectId: data.teamsRequest.projectId.toString(),
          incidentId: incidentId,
        });
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

      logger.debug("Incident acknowledged successfully", {
        projectId: data.teamsRequest.projectId.toString(),
        incidentId: incidentId,
      });
    } catch (error) {
      logger.error("Error acknowledging incident:", {
        projectId: data.teamsRequest.projectId.toString(),
        incidentId: incidentId,
      });
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
      logger.error("No incident ID provided for resolve action", {
        projectId: data.teamsRequest.projectId.toString(),
      });
      return;
    }

    logger.debug("Resolving incident: " + incidentId, {
      projectId: data.teamsRequest.projectId.toString(),
      incidentId: incidentId,
    });

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
        logger.error("Incident not found: " + incidentId, {
          projectId: data.teamsRequest.projectId.toString(),
          incidentId: incidentId,
        });
        return;
      }

      // Check if already resolved
      if (incident.currentIncidentState?.isResolvedState) {
        logger.debug("Incident is already resolved", {
          projectId: data.teamsRequest.projectId.toString(),
          incidentId: incidentId,
        });
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

      logger.debug("Incident resolved successfully", {
        projectId: data.teamsRequest.projectId.toString(),
        incidentId: incidentId,
      });
    } catch (error) {
      logger.error("Error resolving incident:", {
        projectId: data.teamsRequest.projectId.toString(),
        incidentId: incidentId,
      });
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
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const {
      actionType,
      actionValue,
      value,
      projectId,
      oneUptimeUserId,
      databaseProps,
      turnContext,
    } = data;

    if (actionType === MicrosoftTeamsIncidentActionType.AckIncident) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to acknowledge: missing incident id.",
        );
        return;
      }

      const incidentId: ObjectID = new ObjectID(actionValue);

      await WorkspaceActionAuthorization.assertCanCreate({
        props: databaseProps,
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
        resources: [{ service: IncidentService, id: incidentId }],
      });

      await MicrosoftTeamsActionAuthorization.assertCanUpdateIncident({
        incidentId: incidentId,
        projectId: projectId,
        props: databaseProps,
      });

      await IncidentService.acknowledgeIncident(incidentId, oneUptimeUserId);
      await turnContext.sendActivity("✅ Incident acknowledged.");
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.ResolveIncident) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to resolve: missing incident id.",
        );
        return;
      }

      const incidentId: ObjectID = new ObjectID(actionValue);

      await WorkspaceActionAuthorization.assertCanCreate({
        props: databaseProps,
        modelType: IncidentStateTimeline,
        action: "resolve this incident",
        resources: [{ service: IncidentService, id: incidentId }],
      });

      await MicrosoftTeamsActionAuthorization.assertCanUpdateIncident({
        incidentId: incidentId,
        projectId: projectId,
        props: databaseProps,
      });

      await IncidentService.resolveIncident(incidentId, oneUptimeUserId);
      await turnContext.sendActivity("✅ Incident resolved.");
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.ViewIncident) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to view incident: missing incident id.",
        );
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
          declaredAt: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!incident) {
        await turnContext.sendActivity("Incident not found.");
        return;
      }

      const declaredAt: Date | undefined =
        incident.declaredAt || incident.createdAt || undefined;
      // The title is plain text, escaped as MarkdownEscape says a title must be.
      const message: string = `**Incident Details**\n\n**Title:** ${escapeMarkdownValue(incident.title)}\n**Description:** ${incident.description || "No description"}\n**State:** ${incident.currentIncidentState?.name || "Unknown"}\n**Severity:** ${incident.incidentSeverity?.name || "Unknown"}\n**Declared At:** ${declaredAt ? new Date(declaredAt).toLocaleString() : "Unknown"}`;

      await turnContext.sendActivity(message);
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.ViewAddIncidentNote) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to add note: missing incident id.",
        );
        return;
      }

      // Send the input card
      const card: JSONObject = this.buildAddIncidentNoteCard(actionValue);
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

    if (actionType === MicrosoftTeamsIncidentActionType.SubmitIncidentNote) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to add note: missing incident id.",
        );
        return;
      }

      // Check if form data is provided
      const noteType: JSONValue = value["noteType"];
      const note: JSONValue = value["note"];

      if (noteType && note) {
        // Submit the note
        const incidentId: ObjectID = new ObjectID(actionValue);

        if (noteType !== "public" && noteType !== "private") {
          await turnContext.sendActivity(
            "Unable to add note: invalid note type.",
          );
          return;
        }

        await WorkspaceActionAuthorization.assertCanCreate({
          props: databaseProps,
          modelType:
            noteType === "public" ? IncidentPublicNote : IncidentInternalNote,
          action:
            noteType === "public"
              ? "add a public note to this incident"
              : "add a private note to this incident",
          resources: [{ service: IncidentService, id: incidentId }],
        });

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

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "✅ Note added successfully.",
        );

        /*
         * The action is done: a refused reply or a failed delete of the
         * form must not read as a failed action, which invites a repeat.
         */
        await MicrosoftTeamsReplies.deleteBestEffort(
          turnContext,
          turnContext.activity.replyToId,
        );

        return;
      }
      await turnContext.sendActivity("Unable to add note: missing note data.");
      return;
    }

    if (
      actionType ===
      MicrosoftTeamsIncidentActionType.ViewExecuteIncidentOnCallPolicy
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to execute on-call policy: missing incident id.",
        );
        return;
      }

      // Send the input card
      const card: JSONObject | null = await this.buildExecuteOnCallPolicyCard(
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
      MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to execute on-call policy: missing incident id.",
        );
        return;
      }

      // Check if form data is provided
      const onCallPolicyId: JSONValue = value["onCallPolicy"];

      if (onCallPolicyId) {
        // Execute the policy
        const incidentId: ObjectID = new ObjectID(actionValue);
        const policyId: ObjectID = new ObjectID(onCallPolicyId.toString());

        await WorkspaceActionAuthorization.assertCanCreate({
          props: databaseProps,
          modelType: OnCallDutyPolicyExecutionLog,
          action: "execute an on-call policy for this incident",
          resources: [
            { service: IncidentService, id: incidentId },
            { service: OnCallDutyPolicyService, id: policyId },
          ],
        });

        await OnCallDutyPolicyService.executePolicy(policyId, {
          triggeredByIncidentId: incidentId,
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
        });

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "✅ On-call policy executed successfully.",
        );

        /*
         * The action is done: a refused reply or a failed delete of the
         * form must not read as a failed action, which invites a repeat.
         */
        await MicrosoftTeamsReplies.deleteBestEffort(
          turnContext,
          turnContext.activity.replyToId,
        );

        return;
      }
      await turnContext.sendActivity(
        "Unable to execute on-call policy: missing policy id.",
      );
      return;
    }

    if (
      actionType === MicrosoftTeamsIncidentActionType.ViewChangeIncidentState
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to change incident state: missing incident id.",
        );
        return;
      }

      // Send the input card
      const card: JSONObject = await this.buildChangeIncidentStateCard(
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
      actionType === MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to change incident state: missing incident id.",
        );
        return;
      }

      // Check if form data is provided
      const incidentStateId: JSONValue = value["incidentState"];

      if (incidentStateId) {
        // Update the state
        const incidentId: ObjectID = new ObjectID(actionValue);

        await WorkspaceActionAuthorization.assertCanCreate({
          props: databaseProps,
          modelType: IncidentStateTimeline,
          action: "change the state of this incident",
          resources: [{ service: IncidentService, id: incidentId }],
        });

        await IncidentService.updateOneById({
          id: incidentId,
          data: {
            currentIncidentStateId: new ObjectID(incidentStateId.toString()),
          },
          props: databaseProps,
        });

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "✅ Incident state changed successfully.",
        );

        /*
         * The action is done: a refused reply or a failed delete of the
         * form must not read as a failed action, which invites a repeat.
         */
        await MicrosoftTeamsReplies.deleteBestEffort(
          turnContext,
          turnContext.activity.replyToId,
        );

        return;
      }
      await turnContext.sendActivity(
        "Unable to change incident state: missing state id.",
      );
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.SubmitNewIncident) {
      // Handle new incident submission
      const title: string = ((value["incidentTitle"] as string) || "").trim();
      const description: string = (
        (value["incidentDescription"] as string) || ""
      ).trim();
      const severityId: string = (value["incidentSeverity"] as string) || "";
      const monitorIds: string = (value["incidentMonitors"] as string) || "";
      const monitorStatusId: string = (value["monitorStatus"] as string) || "";
      const labelIds: string = (value["labels"] as string) || "";
      const onCallPolicyIds: string =
        (value["onCallDutyPolicies"] as string) || "";

      if (!title || !description || !severityId) {
        await turnContext.sendActivity(
          "Unable to create incident: missing required fields (title, description, or severity).",
        );
        return;
      }

      let createdIncident: Incident;

      try {
        createdIncident = await this.createIncidentInProject({
          projectId,
          oneUptimeUserId,
          title,
          description,
          severityId,
          monitorIds,
          monitorStatusId,
          labelIds,
          onCallPolicyIds,
        });
      } catch (error) {
        MicrosoftTeamsReplies.logFailure(
          "Could not create an incident from Microsoft Teams",
          error,
          {
            projectId: projectId.toString(),
          },
        );
        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          await this.getIncidentCreateFailedMessage({
            error: error,
            projectId: projectId,
          }),
        );
        return;
      }

      /*
       * The incident exists from here on, so nothing below may report the
       * create as failed: a user told it failed submits again, which creates
       * a second incident and pages its on-call policies a second time. The
       * confirmation goes first; removing the submitted form is a courtesy.
       */
      await MicrosoftTeamsReplies.sendBestEffort(
        turnContext,
        await this.getIncidentCreatedMessage({
          projectId: projectId,
          incidentId: createdIncident.id || undefined,
        }),
      );
      await MicrosoftTeamsReplies.deleteBestEffort(
        turnContext,
        turnContext.activity.replyToId,
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

  /*
   * Why a submitted incident was not created, for the user: the reason when
   * OneUptime wrote one for them (a reference to another project's monitor,
   * say), otherwise a generic line; the details go to the log.
   */
  private static async getIncidentCreateFailedMessage(data: {
    error: unknown;
    projectId: ObjectID;
  }): Promise<string> {
    const reason: string | null =
      MicrosoftTeamsReplies.getUserFacingErrorMessage(data.error);

    if (reason) {
      return `❌ Could not create the incident: ${reason}`;
    }

    const createInOneUptimeUrl: string | null =
      await MicrosoftTeamsReplies.getDashboardLink({
        projectId: data.projectId,
        route: "/incidents/create",
      });

    return `❌ Could not create the incident because of an unexpected error. Please try again, or create it in OneUptime${
      createInOneUptimeUrl ? `: ${createInOneUptimeUrl}` : "."
    }`;
  }

  // The confirmation, with a link to the incident when one can be built.
  private static async getIncidentCreatedMessage(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
  }): Promise<string> {
    if (data.incidentId) {
      try {
        const incidentLink: URL =
          await IncidentService.getIncidentLinkInDashboard(
            data.projectId,
            data.incidentId,
          );

        return `✅ Incident created successfully!\n\nView incident: ${incidentLink.toString()}`;
      } catch (error) {
        logger.debug("Could not build the link to a new incident");
        logger.debug(error);
      }
    }

    return "✅ Incident created successfully!";
  }

  /*
   * Every id below comes from the submitted card, not from the form we sent,
   * and the incident is created as root. So they are checked against the
   * linked project before anything is created.
   */
  private static async createIncidentInProject(data: {
    projectId: ObjectID;
    oneUptimeUserId: ObjectID;
    title: string;
    description: string;
    severityId: string;
    monitorIds: string;
    monitorStatusId: string;
    labelIds: string;
    onCallPolicyIds: string;
  }): Promise<Incident> {
    const { projectId } = data;

    const monitorIdArray: Array<ObjectID> =
      WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(
        data.monitorIds,
      );
    const labelIdArray: Array<ObjectID> =
      WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(data.labelIds);
    const policyIdArray: Array<ObjectID> =
      WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(
        data.onCallPolicyIds,
      );
    const monitorStatusId: ObjectID | undefined =
      data.monitorStatusId && monitorIdArray.length > 0
        ? new ObjectID(data.monitorStatusId)
        : undefined;

    await WorkspaceProjectReferenceValidator.validateReferencesBelongToProject({
      projectId: projectId,
      subject: "incident",
      monitorIds: monitorIdArray,
      labelIds: labelIdArray,
      onCallDutyPolicyIds: policyIdArray,
      monitorStatusId: monitorStatusId,
    });

    // Create the incident
    const incident: Incident = new Incident();
    incident.title = data.title;
    incident.description = data.description;
    incident.projectId = projectId;
    incident.createdByUserId = data.oneUptimeUserId;
    incident.incidentSeverityId = new ObjectID(data.severityId);
    incident.rootCause = `Incident created via Microsoft Teams`;

    if (monitorIdArray.length > 0) {
      incident.monitors = monitorIdArray.map((id: ObjectID) => {
        const monitor: Monitor = new Monitor();
        monitor.id = id;
        return monitor;
      });
    }

    if (labelIdArray.length > 0) {
      incident.labels = labelIdArray.map((id: ObjectID) => {
        const label: Label = new Label();
        label.id = id;
        return label;
      });
    }

    if (policyIdArray.length > 0) {
      incident.onCallDutyPolicies = policyIdArray.map((id: ObjectID) => {
        const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
        policy.id = id;
        return policy;
      });
    }

    /*
     * IncidentService moves the incident's monitors to this status, as it does
     * for an incident declared in the dashboard or from Slack: with a status
     * timeline entry and owner notifications, and back again once the
     * incident is resolved. Teams used to write currentMonitorStatusId on the
     * monitors directly, which did none of that.
     */
    if (monitorStatusId) {
      incident.changeMonitorStatusToId = monitorStatusId;
    }

    // Save the incident
    const createdIncident: Incident = await IncidentService.create({
      data: incident,
      props: {
        isRoot: true,
      },
    });

    logger.debug(
      "Incident created successfully: " + createdIncident.id?.toString(),
      {
        projectId: projectId.toString(),
        incidentId: createdIncident.id?.toString(),
      },
    );

    return createdIncident;
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

  private static async buildExecuteOnCallPolicyCard(
    incidentId: string,
    projectId: ObjectID,
  ): Promise<JSONObject | null> {
    const onCallPolicies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: {
          projectId: projectId,
          // Archived policies page no one, so they are not offered.
          isArchived: false,
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
              MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy,
            actionValue: incidentId,
          },
        },
      ],
    };
  }

  private static async buildChangeIncidentStateCard(
    incidentId: string,
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

  @CaptureSpan()
  public static async showNewIncidentCard(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, req, res } = data;

    logger.debug("Showing new incident card for Microsoft Teams", {
      projectId: teamsRequest.projectId?.toString(),
    });

    // Send empty response first
    Response.sendTextResponse(req, res, "");

    if (!teamsRequest.projectId) {
      logger.error("Project ID not found in Teams request");
      return;
    }

    // Build the adaptive card with form fields
    const card: JSONObject = await this.buildNewIncidentCard(
      teamsRequest.projectId,
    );

    /*
     * Send card as a message (note: in real Teams bot, this would be sent via TurnContext)
     * For now, we'll just log it. The actual sending will be done through the bot framework
     */
    logger.debug("New incident card built:", {
      projectId: teamsRequest.projectId.toString(),
    });
    logger.debug(JSON.stringify(card, null, 2));
  }

  @CaptureSpan()
  public static async submitNewIncident(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, req, res } = data;
    const { userId, projectId } = teamsRequest;

    logger.debug("Submitting new incident from Microsoft Teams", {
      projectId: projectId?.toString(),
    });

    if (!projectId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Project ID"),
      );
    }

    if (!userId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid User ID"),
      );
    }

    // Send early response
    Response.sendTextResponse(req, res, "");

    // Extract form data from the payload
    const payload: JSONObject = teamsRequest.payload || {};
    const value: JSONObject = (payload["value"] as JSONObject) || {};

    const title: string = (value["incidentTitle"] as string) || "";
    const description: string = (value["incidentDescription"] as string) || "";
    const severityId: string = (value["incidentSeverity"] as string) || "";
    const monitorIds: string = (value["incidentMonitors"] as string) || "";
    const monitorStatusId: string = (value["monitorStatus"] as string) || "";
    const labelIds: string = (value["labels"] as string) || "";
    const onCallPolicyIds: string =
      (value["onCallDutyPolicies"] as string) || "";

    if (!title || !description || !severityId) {
      logger.error("Missing required fields for incident creation", {
        projectId: projectId.toString(),
      });
      return;
    }

    try {
      // Get OneUptime user ID
      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: userId,
          projectId: projectId,
        });

      await this.createIncidentInProject({
        projectId,
        oneUptimeUserId,
        title,
        description,
        severityId,
        monitorIds,
        monitorStatusId,
        labelIds,
        onCallPolicyIds,
      });

      logger.debug("New incident created from Microsoft Teams successfully", {
        projectId: projectId.toString(),
      });
    } catch (error) {
      logger.error("Error creating incident from Microsoft Teams:", {
        projectId: projectId.toString(),
      });
      logger.error(error);
    }
  }

  // Every list the "Create New Incident" card offers, read for one project.
  public static async getNewIncidentFormChoices(
    projectId: ObjectID,
  ): Promise<MicrosoftTeamsNewIncidentFormChoices> {
    const [severities, monitors, monitorStatuses, labels, onCallDutyPolicies]: [
      MicrosoftTeamsCardChoiceList,
      MicrosoftTeamsCardChoiceList,
      MicrosoftTeamsCardChoiceList,
      MicrosoftTeamsCardChoiceList,
      MicrosoftTeamsCardChoiceList,
    ] = await Promise.all([
      MicrosoftTeamsCardChoices.getIncidentSeverityChoices(projectId),
      MicrosoftTeamsCardChoices.getMonitorChoices(projectId),
      MicrosoftTeamsCardChoices.getMonitorStatusChoices(projectId),
      MicrosoftTeamsCardChoices.getLabelChoices(projectId),
      MicrosoftTeamsCardChoices.getOnCallDutyPolicyChoices(projectId),
    ]);

    return {
      severities: severities,
      monitors: monitors,
      monitorStatuses: monitorStatuses,
      labels: labels,
      onCallDutyPolicies: onCallDutyPolicies,
    };
  }

  /*
   * The "Create New Incident" card for a project, fitted to the first size
   * budget. The bot itself sends the card through
   * MicrosoftTeamsCreateCommands, which also tries the smaller budgets.
   */
  public static async buildNewIncidentCard(
    projectId: ObjectID,
    options?: { initialTitle?: string | undefined } | undefined,
  ): Promise<JSONObject> {
    return this.buildNewIncidentCardForBudget({
      choices: await this.getNewIncidentFormChoices(projectId),
      budgetInBytes: MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
      initialTitle: options?.initialTitle,
    });
  }

  /*
   * The "Create New Incident" card with its monitor, label and on-call policy
   * lists shortened until it fits the budget (issue #4111: listing all of
   * them made Teams refuse the card). Severities are required, so they are
   * never shortened to fit (they are read up to 50).
   */
  public static buildNewIncidentCardForBudget(data: {
    choices: MicrosoftTeamsNewIncidentFormChoices;
    budgetInBytes: number;
    initialTitle?: string | undefined;
    createInOneUptimeUrl?: string | null | undefined;
  }): JSONObject {
    return MicrosoftTeamsCardChoices.fitCardToBudget<
      keyof MicrosoftTeamsNewIncidentFormChoices
    >({
      lists: data.choices,
      trimmableKeys: ["monitors", "labels", "onCallDutyPolicies"],
      budgetInBytes: data.budgetInBytes,
      buildCard: (
        shown: Record<
          keyof MicrosoftTeamsNewIncidentFormChoices,
          MicrosoftTeamsCardChoiceList
        >,
      ): JSONObject => {
        return this.buildNewIncidentCardBody({
          shown: shown,
          initialTitle: data.initialTitle,
          createInOneUptimeUrl: data.createInOneUptimeUrl,
        });
      },
    }).card;
  }

  private static buildNewIncidentCardBody(data: {
    shown: MicrosoftTeamsNewIncidentFormChoices;
    initialTitle?: string | undefined;
    createInOneUptimeUrl?: string | null | undefined;
  }): JSONObject {
    const { shown } = data;
    const initialTitle: string = (data.initialTitle || "").trim();
    let isAnythingLeftOff: boolean = false;

    const addLaterHint: string =
      "You can add them to the incident in OneUptime after it is created.";

    const bodyElements: Array<JSONObject> = [
      {
        type: "TextBlock",
        text: "Create New Incident",
        size: "Large",
        weight: "Bolder",
      },
      {
        type: "Input.Text",
        id: "incidentTitle",
        label: "Incident Title",
        placeholder: "Enter incident title",
        isRequired: true,
        maxLength: MICROSOFT_TEAMS_INCIDENT_TITLE_MAX_LENGTH,
        ...(initialTitle
          ? {
              value: truncateToLength(
                initialTitle,
                MICROSOFT_TEAMS_INCIDENT_TITLE_MAX_LENGTH,
              ),
            }
          : {}),
      },
      {
        type: "Input.Text",
        id: "incidentDescription",
        label: "Incident Description",
        placeholder: "Enter incident description",
        isMultiline: true,
        isRequired: true,
      },
    ];

    const addNotShownNote: (
      list: MicrosoftTeamsCardChoiceList,
      pluralNoun: string,
    ) => void = (
      list: MicrosoftTeamsCardChoiceList,
      pluralNoun: string,
    ): void => {
      const note: JSONObject | null =
        MicrosoftTeamsCardChoices.buildNotShownNoteElement({
          list: list,
          pluralNoun: pluralNoun,
          addLaterHint: addLaterHint,
        });

      if (note) {
        isAnythingLeftOff = true;
        bodyElements.push(note);
      }
    };

    // Add severity dropdown if we have severities
    if (shown.severities.choices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "incidentSeverity",
        label: "Incident Severity",
        style: "compact",
        isRequired: true,
        choices: shown.severities.choices,
      });
    }

    // Add monitor multi-select if we have monitors
    if (shown.monitors.choices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "incidentMonitors",
        label: "Affected Monitors (Optional)",
        style: "compact",
        isMultiSelect: true,
        choices: shown.monitors.choices,
      });
    }

    addNotShownNote(shown.monitors, "monitors");

    // Add monitor status dropdown if we have statuses and monitors
    if (
      shown.monitorStatuses.choices.length > 0 &&
      shown.monitors.choices.length > 0
    ) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "monitorStatus",
        label: "Change Monitor Status To (Optional)",
        style: "compact",
        choices: shown.monitorStatuses.choices,
      });
    }

    // Add on-call policy multi-select if we have policies
    if (shown.onCallDutyPolicies.choices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "onCallDutyPolicies",
        label: "Execute On-Call Policies (Optional)",
        style: "compact",
        isMultiSelect: true,
        choices: shown.onCallDutyPolicies.choices,
      });
    }

    addNotShownNote(shown.onCallDutyPolicies, "on-call policies");

    // Add labels multi-select if we have labels
    if (shown.labels.choices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "labels",
        label: "Labels (Optional)",
        style: "compact",
        isMultiSelect: true,
        choices: shown.labels.choices,
      });
    }

    addNotShownNote(shown.labels, "labels");

    const actions: Array<JSONObject> = [
      {
        type: "Action.Submit",
        title: "Create Incident",
        data: {
          action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
        },
      },
    ];

    if (isAnythingLeftOff && data.createInOneUptimeUrl) {
      actions.push(
        MicrosoftTeamsCardChoices.buildCreateInOneUptimeAction(
          data.createInOneUptimeUrl,
        ),
      );
    }

    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: bodyElements,
      actions: actions,
    };
  }
}
