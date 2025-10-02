import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAction,
  MicrosoftTeamsRequest,
} from "./Auth";
import { MicrosoftTeamsScheduledMaintenanceActionType } from "./ActionTypes";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceInternalNoteService from "../../../../Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceStateService from "../../../../Services/ScheduledMaintenanceStateService";
import MonitorService from "../../../../Services/MonitorService";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatusService from "../../../../Services/MonitorStatusService";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import LabelService from "../../../../Services/LabelService";
import Label from "../../../../../Models/DatabaseModels/Label";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../../../Types/Date";

export default class MicrosoftTeamsScheduledMaintenanceActions {
  @CaptureSpan()
  public static isScheduledMaintenanceAction(data: {
    actionType: string;
  }): boolean {
    return (
      data.actionType.includes("scheduled-maintenance") ||
      data.actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.ViewScheduledMaintenance ||
      data.actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing ||
      data.actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete ||
      data.actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.ViewAddScheduledMaintenanceNote ||
      data.actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote ||
      data.actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.ViewChangeScheduledMaintenanceState ||
      data.actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitChangeScheduledMaintenanceState ||
      data.actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.NewScheduledMaintenance ||
      data.actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance
    );
  }

  @CaptureSpan()
  public static async handleScheduledMaintenanceAction(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { action } = data;

    logger.debug("Handling Microsoft Teams scheduled maintenance action:");
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsScheduledMaintenanceActionType.ViewScheduledMaintenance:
          // This is handled by opening the URL directly
          break;

        case MicrosoftTeamsScheduledMaintenanceActionType.NewScheduledMaintenance:
          return await this.showNewScheduledMaintenanceCard(data);

        case MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance:
          return await this.submitNewScheduledMaintenance(data);

        default:
          logger.debug(
            `Unhandled scheduled maintenance action: ${action.actionType}`,
          );
          break;
      }
    } catch (error) {
      logger.error(
        "Error handling Microsoft Teams scheduled maintenance action:",
      );
      logger.error(error);
    }

    Response.sendTextResponse(data.req, data.res, "");
  }

  @CaptureSpan()
  public static async handleBotScheduledMaintenanceAction(
    actionType: MicrosoftTeamsScheduledMaintenanceActionType,
    turnContext: TurnContext,
    actionPayload: JSONObject,
    request: MicrosoftTeamsRequest,
  ): Promise<void> {
    try {
      const scheduledMaintenanceId: ObjectID = actionPayload[
        "scheduledMaintenanceId"
      ] as ObjectID;

      if (!scheduledMaintenanceId) {
        logger.error("ScheduledMaintenance ID is required");
        await turnContext.sendActivity("ScheduledMaintenance ID is required");
        return;
      }

      const scheduledMaintenance: ScheduledMaintenance | null =
        await ScheduledMaintenanceService.findOneById({
          id: scheduledMaintenanceId,
          select: {
            _id: true,
            title: true,
            description: true,
            startsAt: true,
            endsAt: true,
            currentScheduledMaintenanceState: {
              name: true,
            },
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!scheduledMaintenance) {
        logger.error("ScheduledMaintenance not found");
        await turnContext.sendActivity("ScheduledMaintenance not found");
        return;
      }

      switch (actionType) {
        case MicrosoftTeamsScheduledMaintenanceActionType.ViewScheduledMaintenance:
          await turnContext.sendActivity(
            `**${scheduledMaintenance.title}**\n\n${scheduledMaintenance.description}\n\nStarts: ${scheduledMaintenance.startsAt}\nEnds: ${scheduledMaintenance.endsAt}\nStatus: ${scheduledMaintenance.currentScheduledMaintenanceState?.name}`,
          );
          break;

        case MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing: {
          const ongoingState: ScheduledMaintenanceState =
            await ScheduledMaintenanceStateService.getOngoingScheduledMaintenanceState(
              {
                projectId: scheduledMaintenance.projectId!,
                props: {
                  isRoot: true,
                },
              },
            );
          await ScheduledMaintenanceService.updateOneById({
            id: scheduledMaintenanceId,
            data: {
              currentScheduledMaintenanceStateId: ongoingState.id!,
            },
            props: {
              isRoot: true,
            },
          });
          await turnContext.sendActivity(
            "ScheduledMaintenance marked as ongoing",
          );
          break;
        }

        case MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete: {
          const completedState: ScheduledMaintenanceState =
            await ScheduledMaintenanceStateService.getCompletedScheduledMaintenanceState(
              {
                projectId: scheduledMaintenance.projectId!,
                props: {
                  isRoot: true,
                },
              },
            );
          await ScheduledMaintenanceService.updateOneById({
            id: scheduledMaintenanceId,
            data: {
              currentScheduledMaintenanceStateId: completedState.id!,
            },
            props: {
              isRoot: true,
            },
          });
          await turnContext.sendActivity(
            "ScheduledMaintenance marked as complete",
          );
          break;
        }

        case MicrosoftTeamsScheduledMaintenanceActionType.ViewAddScheduledMaintenanceNote:
          await turnContext.sendActivity({
            attachments: [
              {
                contentType: "application/vnd.microsoft.card.adaptive",
                content: this.buildAddScheduledMaintenanceNoteCard(
                  scheduledMaintenanceId,
                ),
              },
            ],
          });
          break;

        case MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote: {
          const note: string = actionPayload["note"] as string;
          const isPublic: boolean = actionPayload["isPublic"] as boolean;

          if (!request.userId) {
            await turnContext.sendActivity("User ID is required to add notes");
            return;
          }

          if (isPublic) {
            await ScheduledMaintenancePublicNoteService.addNote({
              scheduledMaintenanceId: scheduledMaintenanceId,
              note: note,
              projectId: scheduledMaintenance.projectId!,
              userId: new ObjectID(request.userId),
            });
          } else {
            await ScheduledMaintenanceInternalNoteService.addNote({
              scheduledMaintenanceId: scheduledMaintenanceId,
              note: note,
              projectId: scheduledMaintenance.projectId!,
              userId: new ObjectID(request.userId),
            });
          }

          await turnContext.sendActivity("Note added successfully");

          // Hide the form card by deleting it
          if (turnContext.activity.replyToId) {
            await turnContext.deleteActivity(turnContext.activity.replyToId);
          }

          break;
        }

        case MicrosoftTeamsScheduledMaintenanceActionType.ViewChangeScheduledMaintenanceState:
          await turnContext.sendActivity({
            attachments: [
              {
                contentType: "application/vnd.microsoft.card.adaptive",
                content: await this.buildChangeScheduledMaintenanceStateCard(
                  scheduledMaintenanceId,
                  scheduledMaintenance.projectId!,
                ),
              },
            ],
          });
          break;

        case MicrosoftTeamsScheduledMaintenanceActionType.SubmitChangeScheduledMaintenanceState: {
          const stateId: ObjectID = actionPayload["stateId"] as ObjectID;

          await ScheduledMaintenanceService.updateOneById({
            id: scheduledMaintenanceId,
            data: {
              currentScheduledMaintenanceStateId: stateId,
            },
            props: {
              isRoot: true,
            },
          });

          await turnContext.sendActivity(
            "ScheduledMaintenance state changed successfully",
          );

          // Hide the form card by deleting it
          if (turnContext.activity.replyToId) {
            await turnContext.deleteActivity(turnContext.activity.replyToId);
          }

          break;
        }

        default:
          logger.error(`Unknown action type: ${actionType}`);
          await turnContext.sendActivity("Unknown action type");
          break;
      }
    } catch (error) {
      logger.error(`Error handling scheduled maintenance action: ${error}`);
      await turnContext.sendActivity(
        "An error occurred while processing the action",
      );
    }
  }

  private static buildAddScheduledMaintenanceNoteCard(
    scheduledMaintenanceId: ObjectID,
  ): JSONObject {
    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "Add Scheduled Maintenance Note",
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
            action:
              MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote,
            scheduledMaintenanceId: scheduledMaintenanceId.toString(),
          },
        },
      ],
    };
  }

  private static async buildChangeScheduledMaintenanceStateCard(
    scheduledMaintenanceId: ObjectID,
    projectId: ObjectID,
  ): Promise<JSONObject> {
    const scheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
      await ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      });

    const choices: Array<{ title: string; value: string }> =
      scheduledMaintenanceStates
        .map((state: ScheduledMaintenanceState) => {
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
          text: "Change Scheduled Maintenance State",
          size: "Large",
          weight: "Bolder",
        },
        {
          type: "Input.ChoiceSet",
          id: "stateId",
          label: "Scheduled Maintenance State",
          style: "compact",
          choices: choices,
        },
      ],
      actions: [
        {
          type: "Action.Submit",
          title: "Change",
          data: {
            action:
              MicrosoftTeamsScheduledMaintenanceActionType.SubmitChangeScheduledMaintenanceState,
            scheduledMaintenanceId: scheduledMaintenanceId.toString(),
          },
        },
      ],
    };
  }

  @CaptureSpan()
  public static async showNewScheduledMaintenanceCard(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, req, res } = data;

    logger.debug(
      "Showing new scheduled maintenance card for Microsoft Teams",
    );

    // Send empty response first
    Response.sendTextResponse(req, res, "");

    if (!teamsRequest.projectId) {
      logger.error("Project ID not found in Teams request");
      return;
    }

    // Build the adaptive card with form fields
    const card: JSONObject = await this.buildNewScheduledMaintenanceCard(
      teamsRequest.projectId,
    );

    // Send card as a message (note: in real Teams bot, this would be sent via TurnContext)
    // For now, we'll just log it. The actual sending will be done through the bot framework
    logger.debug("New scheduled maintenance card built:");
    logger.debug(JSON.stringify(card, null, 2));
  }

  @CaptureSpan()
  public static async submitNewScheduledMaintenance(data: {
    teamsRequest: MicrosoftTeamsRequest;
    action: MicrosoftTeamsAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { teamsRequest, req, res } = data;
    const { userId, projectId } = teamsRequest;

    logger.debug("Submitting new scheduled maintenance from Microsoft Teams");

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

    const title: string =
      (value["scheduledMaintenanceTitle"] as string) || "";
    const description: string =
      (value["scheduledMaintenanceDescription"] as string) || "";
    const startDate: string =
      (value["startDate"] as string) || "";
    const endDate: string = (value["endDate"] as string) || "";
    const monitorIds: string =
      (value["scheduledMaintenanceMonitors"] as string) || "";
    const monitorStatusId: string = (value["monitorStatus"] as string) || "";
    const labelIds: string = (value["labels"] as string) || "";

    if (!title || !description || !startDate || !endDate) {
      logger.error(
        "Missing required fields for scheduled maintenance creation",
      );
      return;
    }

    try {
      // Get OneUptime user ID
      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: userId,
          projectId: projectId,
        });

      // Create the scheduled maintenance
      const scheduledMaintenance: ScheduledMaintenance =
        new ScheduledMaintenance();
      scheduledMaintenance.title = title;
      scheduledMaintenance.description = description;
      scheduledMaintenance.projectId = projectId;
      scheduledMaintenance.createdByUserId = oneUptimeUserId;
      scheduledMaintenance.startsAt = OneUptimeDate.fromString(startDate);
      scheduledMaintenance.endsAt = OneUptimeDate.fromString(endDate);

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
          scheduledMaintenance.monitors = monitorIdArray.map(
            (id: string) => {
              const monitor: Monitor = new Monitor();
              monitor.id = new ObjectID(id);
              return monitor;
            },
          );
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
          scheduledMaintenance.labels = labelIdArray.map((id: string) => {
            const label: Label = new Label();
            label.id = new ObjectID(id);
            return label;
          });
        }
      }

      // Save the scheduled maintenance
      const createdScheduledMaintenance: ScheduledMaintenance =
        await ScheduledMaintenanceService.create({
          data: scheduledMaintenance,
          props: {
            isRoot: true,
          },
        });

      logger.debug(
        "Scheduled maintenance created successfully: " +
          createdScheduledMaintenance.id?.toString(),
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

      logger.debug(
        "New scheduled maintenance created from Microsoft Teams successfully",
      );
    } catch (error) {
      logger.error(
        "Error creating scheduled maintenance from Microsoft Teams:",
      );
      logger.error(error);
    }
  }

  public static async buildNewScheduledMaintenanceCard(
    projectId: ObjectID,
  ): Promise<JSONObject> {
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

    // Build the card
    const bodyElements: Array<JSONObject> = [
      {
        type: "TextBlock",
        text: "Create New Scheduled Maintenance",
        size: "Large",
        weight: "Bolder",
      },
      {
        type: "Input.Text",
        id: "scheduledMaintenanceTitle",
        label: "Event Title",
        placeholder: "Enter maintenance event title",
        isRequired: true,
      },
      {
        type: "Input.Text",
        id: "scheduledMaintenanceDescription",
        label: "Event Description",
        placeholder: "Enter maintenance event description",
        isMultiline: true,
        isRequired: true,
      },
      {
        type: "Input.Date",
        id: "startDate",
        label: "Start Date and Time",
        isRequired: true,
      },
      {
        type: "Input.Date",
        id: "endDate",
        label: "End Date and Time",
        isRequired: true,
      },
    ];

    // Add monitor multi-select if we have monitors
    if (monitorChoices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "scheduledMaintenanceMonitors",
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
          title: "Create Maintenance Event",
          data: {
            action:
              MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
          },
        },
      ],
    };
  }
}
