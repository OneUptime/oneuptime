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
import IncidentSeverityService from "../../../../Services/IncidentSeverityService";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import MonitorService from "../../../../Services/MonitorService";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatusService from "../../../../Services/MonitorStatusService";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import LabelService from "../../../../Services/LabelService";
import Label from "../../../../../Models/DatabaseModels/Label";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import URL from "../../../../../Types/API/URL";

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

        case MicrosoftTeamsIncidentActionType.NewIncident:
          return await this.showNewIncidentCard(data);

        case MicrosoftTeamsIncidentActionType.SubmitNewIncident:
          /*
           * This is handled by handleBotIncidentAction through bot framework
           * Don't process it here to avoid duplicate messages
           */
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
    const {
      actionType,
      actionValue,
      value,
      projectId,
      oneUptimeUserId,
      turnContext,
    } = data;

    if (actionType === MicrosoftTeamsIncidentActionType.AckIncident) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to acknowledge: missing incident id.",
        );
        return;
      }

      await IncidentService.acknowledgeIncident(
        new ObjectID(actionValue),
        oneUptimeUserId,
      );
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

      await IncidentService.resolveIncident(
        new ObjectID(actionValue),
        oneUptimeUserId,
      );
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
      const message: string = `**Incident Details**\n\n**Title:** ${incident.title}\n**Description:** ${incident.description || "No description"}\n**State:** ${incident.currentIncidentState?.name || "Unknown"}\n**Severity:** ${incident.incidentSeverity?.name || "Unknown"}\n**Declared At:** ${declaredAt ? new Date(declaredAt).toLocaleString() : "Unknown"}`;

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
          "No on-call policies found in the project",
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

        await OnCallDutyPolicyService.executePolicy(
          new ObjectID(onCallPolicyId.toString()),
          {
            triggeredByIncidentId: incidentId,
            userNotificationEventType:
              UserNotificationEventType.IncidentCreated,
          },
        );

        await turnContext.sendActivity(
          "✅ On-call policy executed successfully.",
        );

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

        await IncidentService.updateOneById({
          id: incidentId,
          data: {
            currentIncidentStateId: new ObjectID(incidentStateId.toString()),
          },
          props: {
            isRoot: true,
          },
        });

        await turnContext.sendActivity(
          "✅ Incident state changed successfully.",
        );

        // Hide the form card by deleting it
        if (turnContext.activity.replyToId) {
          await turnContext.deleteActivity(turnContext.activity.replyToId);
        }

        return;
      }
      await turnContext.sendActivity(
        "Unable to change incident state: missing state id.",
      );
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.SubmitNewIncident) {
      // Handle new incident submission
      const title: string = (value["incidentTitle"] as string) || "";
      const description: string =
        (value["incidentDescription"] as string) || "";
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

      try {
        // Create the incident
        const incident: Incident = new Incident();
        incident.title = title;
        incident.description = description;
        incident.projectId = projectId;
        incident.createdByUserId = oneUptimeUserId;
        incident.incidentSeverityId = new ObjectID(severityId);
        incident.rootCause = `Incident created via Microsoft Teams`;

        // Parse monitors
        if (monitorIds) {
          const monitorIdArray: Array<string> = monitorIds
            .split(",")
            .map((id: string) => {
              return id.trim();
            })
            .filter((id: string) => {
              return id;
            });
          if (monitorIdArray.length > 0) {
            incident.monitors = monitorIdArray.map((id: string) => {
              const monitor: Monitor = new Monitor();
              monitor.id = new ObjectID(id);
              return monitor;
            });
          }
        }

        // Parse labels
        if (labelIds) {
          const labelIdArray: Array<string> = labelIds
            .split(",")
            .map((id: string) => {
              return id.trim();
            })
            .filter((id: string) => {
              return id;
            });
          if (labelIdArray.length > 0) {
            incident.labels = labelIdArray.map((id: string) => {
              const label: Label = new Label();
              label.id = new ObjectID(id);
              return label;
            });
          }
        }

        // Parse on-call policies
        if (onCallPolicyIds) {
          const policyIdArray: Array<string> = onCallPolicyIds
            .split(",")
            .map((id: string) => {
              return id.trim();
            })
            .filter((id: string) => {
              return id;
            });
          if (policyIdArray.length > 0) {
            incident.onCallDutyPolicies = policyIdArray.map((id: string) => {
              const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
              policy.id = new ObjectID(id);
              return policy;
            });
          }
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
        );

        // Update monitor status if specified
        if (monitorStatusId && monitorIds) {
          const monitorIdArray: Array<string> = monitorIds
            .split(",")
            .map((id: string) => {
              return id.trim();
            })
            .filter((id: string) => {
              return id;
            });
          for (const monitorId of monitorIdArray) {
            await MonitorService.updateOneById({
              id: new ObjectID(monitorId),
              data: {
                currentMonitorStatusId: new ObjectID(monitorStatusId),
              },
              props: {
                isRoot: true,
              },
            });
          }
        }

        // Hide the form card by deleting it first
        if (turnContext.activity.replyToId) {
          await turnContext.deleteActivity(turnContext.activity.replyToId);
        }

        // Get the incident link
        const incidentLink: URL =
          await IncidentService.getIncidentLinkInDashboard(
            projectId,
            createdIncident.id!,
          );

        // Send confirmation message as a new message in the thread
        await turnContext.sendActivity(
          `✅ Incident created successfully!\n\nView incident: ${incidentLink.toString()}`,
        );

        return;
      } catch (error) {
        logger.error("Error creating incident from Microsoft Teams:");
        logger.error(error);
        await turnContext.sendActivity(
          "❌ Failed to create incident. Please try again.",
        );
        return;
      }
    }

    // Default fallback for unimplemented actions
    await turnContext.sendActivity(
      "Sorry, but the action " +
        actionType +
        " you requested is not implemented yet.",
    );
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

    logger.debug("Showing new incident card for Microsoft Teams");

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
    logger.debug("New incident card built:");
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

    logger.debug("Submitting new incident from Microsoft Teams");

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
      logger.error("Missing required fields for incident creation");
      return;
    }

    try {
      // Get OneUptime user ID
      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: userId,
          projectId: projectId,
        });

      // Create the incident
      const incident: Incident = new Incident();
      incident.title = title;
      incident.description = description;
      incident.projectId = projectId;
      incident.createdByUserId = oneUptimeUserId;
      incident.incidentSeverityId = new ObjectID(severityId);
      incident.rootCause = `Incident created via Microsoft Teams`;

      // Parse monitors
      if (monitorIds) {
        const monitorIdArray: Array<string> = monitorIds
          .split(",")
          .map((id: string) => {
            return id.trim();
          })
          .filter((id: string) => {
            return id;
          });
        if (monitorIdArray.length > 0) {
          incident.monitors = monitorIdArray.map((id: string) => {
            const monitor: Monitor = new Monitor();
            monitor.id = new ObjectID(id);
            return monitor;
          });
        }
      }

      // Parse labels
      if (labelIds) {
        const labelIdArray: Array<string> = labelIds
          .split(",")
          .map((id: string) => {
            return id.trim();
          })
          .filter((id: string) => {
            return id;
          });
        if (labelIdArray.length > 0) {
          incident.labels = labelIdArray.map((id: string) => {
            const label: Label = new Label();
            label.id = new ObjectID(id);
            return label;
          });
        }
      }

      // Parse on-call policies
      if (onCallPolicyIds) {
        const policyIdArray: Array<string> = onCallPolicyIds
          .split(",")
          .map((id: string) => {
            return id.trim();
          })
          .filter((id: string) => {
            return id;
          });
        if (policyIdArray.length > 0) {
          incident.onCallDutyPolicies = policyIdArray.map((id: string) => {
            const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
            policy.id = new ObjectID(id);
            return policy;
          });
        }
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
      );

      // Update monitor status if specified
      if (monitorStatusId && monitorIds) {
        const monitorIdArray: Array<string> = monitorIds
          .split(",")
          .map((id: string) => {
            return id.trim();
          })
          .filter((id: string) => {
            return id;
          });
        for (const monitorId of monitorIdArray) {
          await MonitorService.updateOneById({
            id: new ObjectID(monitorId),
            data: {
              currentMonitorStatusId: new ObjectID(monitorStatusId),
            },
            props: {
              isRoot: true,
            },
          });
        }
      }

      logger.debug("New incident created from Microsoft Teams successfully");
    } catch (error) {
      logger.error("Error creating incident from Microsoft Teams:");
      logger.error(error);
    }
  }

  public static async buildNewIncidentCard(
    projectId: ObjectID,
  ): Promise<JSONObject> {
    // Fetch severities
    const severities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: {
          projectId: projectId,
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

    const severityChoices: Array<{ title: string; value: string }> =
      severities.map((severity: IncidentSeverity) => {
        return {
          title: severity.name || "",
          value: severity._id?.toString() || "",
        };
      });

    // Fetch monitors
    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: projectId,
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

    const monitorChoices: Array<{ title: string; value: string }> = monitors
      .map((monitor: Monitor) => {
        return {
          title: monitor.name || "",
          value: monitor._id?.toString() || "",
        };
      })
      .filter((choice: { title: string; value: string }) => {
        return choice.title && choice.value;
      });

    // Fetch monitor statuses
    const monitorStatuses: Array<MonitorStatus> =
      await MonitorStatusService.findBy({
        query: {
          projectId: projectId,
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

    const monitorStatusChoices: Array<{ title: string; value: string }> =
      monitorStatuses
        .map((status: MonitorStatus) => {
          return {
            title: status.name || "",
            value: status._id?.toString() || "",
          };
        })
        .filter((choice: { title: string; value: string }) => {
          return choice.title && choice.value;
        });

    // Fetch labels
    const labels: Array<Label> = await LabelService.findBy({
      query: {
        projectId: projectId,
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

    const labelChoices: Array<{ title: string; value: string }> = labels
      .map((label: Label) => {
        return {
          title: label.name || "",
          value: label._id?.toString() || "",
        };
      })
      .filter((choice: { title: string; value: string }) => {
        return choice.title && choice.value;
      });

    // Fetch on-call policies
    const onCallPolicies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: {
          projectId: projectId,
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

    const onCallPolicyChoices: Array<{ title: string; value: string }> =
      onCallPolicies
        .map((policy: OnCallDutyPolicy) => {
          return {
            title: policy.name || "",
            value: policy._id?.toString() || "",
          };
        })
        .filter((choice: { title: string; value: string }) => {
          return choice.title && choice.value;
        });

    // Build the card
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

    // Add severity dropdown if we have severities
    if (severityChoices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "incidentSeverity",
        label: "Incident Severity",
        style: "compact",
        isRequired: true,
        choices: severityChoices,
      });
    }

    // Add monitor multi-select if we have monitors
    if (monitorChoices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "incidentMonitors",
        label: "Affected Monitors (Optional)",
        style: "compact",
        isMultiSelect: true,
        choices: monitorChoices,
      });
    }

    // Add monitor status dropdown if we have statuses and monitors
    if (monitorStatusChoices.length > 0 && monitorChoices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "monitorStatus",
        label: "Change Monitor Status To (Optional)",
        style: "compact",
        choices: monitorStatusChoices,
      });
    }

    // Add on-call policy multi-select if we have policies
    if (onCallPolicyChoices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "onCallDutyPolicies",
        label: "Execute On-Call Policies (Optional)",
        style: "compact",
        isMultiSelect: true,
        choices: onCallPolicyChoices,
      });
    }

    // Add labels multi-select if we have labels
    if (labelChoices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "labels",
        label: "Labels (Optional)",
        style: "compact",
        isMultiSelect: true,
        choices: labelChoices,
      });
    }

    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: bodyElements,
      actions: [
        {
          type: "Action.Submit",
          title: "Create Incident",
          data: {
            action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
          },
        },
      ],
    };
  }
}
