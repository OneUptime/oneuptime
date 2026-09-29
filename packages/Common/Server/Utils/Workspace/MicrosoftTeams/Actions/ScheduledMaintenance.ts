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
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import ScheduledMaintenanceStateTimeline from "../../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ScheduledMaintenancePublicNote from "../../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceInternalNote from "../../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceInternalNoteService from "../../../../Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceStateService from "../../../../Services/ScheduledMaintenanceStateService";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Label from "../../../../../Models/DatabaseModels/Label";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../../../Types/Date";
import URL from "../../../../../Types/API/URL";
import ColumnLength from "../../../../../Types/Database/ColumnLength";
import { truncateToLength } from "../../../Database/TruncateColumnValue";
import WorkspaceProjectReferenceValidator from "../../WorkspaceProjectReferenceValidator";
import MicrosoftTeamsCardChoices, {
  MicrosoftTeamsCardChoiceList,
} from "../MicrosoftTeamsCardChoices";
import { MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES } from "../MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies from "../MicrosoftTeamsReplies";
import MicrosoftTeamsTimezone, {
  MicrosoftTeamsUserTimezone,
} from "../MicrosoftTeamsTimezone";

// ScheduledMaintenance.title is a ShortText column.
const MICROSOFT_TEAMS_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH: number =
  ColumnLength.ShortText;

/*
 * Input.Time has minute precision, so "start now" is already a minute or two
 * in the past once the form is filled in. A start this recent begins now.
 */
const MICROSOFT_TEAMS_MAINTENANCE_START_GRACE_IN_MINUTES: number = 5;

// The lists the "Create New Scheduled Maintenance" card offers.
export interface MicrosoftTeamsNewScheduledMaintenanceFormChoices {
  monitors: MicrosoftTeamsCardChoiceList;
  monitorStatuses: MicrosoftTeamsCardChoiceList;
  labels: MicrosoftTeamsCardChoiceList;
}

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

    logger.debug("Handling Microsoft Teams scheduled maintenance action:", {
      projectId: data.teamsRequest.projectId.toString(),
      actionType: action.actionType,
    });
    logger.debug(action);

    try {
      switch (action.actionType) {
        case MicrosoftTeamsScheduledMaintenanceActionType.ViewScheduledMaintenance:
          // This is handled by opening the URL directly
          break;

        case MicrosoftTeamsScheduledMaintenanceActionType.NewScheduledMaintenance:
          return await this.showNewScheduledMaintenanceCard(data);

        case MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance:
          /*
           * This is handled by handleBotScheduledMaintenanceAction through bot framework
           * Don't process it here to avoid duplicate messages
           */
          break;

        default:
          logger.debug(
            `Unhandled scheduled maintenance action: ${action.actionType}`,
            {
              projectId: data.teamsRequest.projectId.toString(),
              actionType: action.actionType,
            },
          );
          break;
      }
    } catch (error) {
      logger.error(
        "Error handling Microsoft Teams scheduled maintenance action:",
        {
          projectId: data.teamsRequest.projectId.toString(),
          actionType: action.actionType,
        },
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
    databaseProps: DatabaseCommonInteractionProps,
  ): Promise<void> {
    try {
      // Handle new scheduled maintenance creation separately (doesn't need existing ID)
      if (
        actionType ===
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance
      ) {
        // Handle new scheduled maintenance submission
        const title: string = (
          (actionPayload["scheduledMaintenanceTitle"] as string) || ""
        ).trim();
        const description: string = (
          (actionPayload["scheduledMaintenanceDescription"] as string) || ""
        ).trim();
        const startDate: string = (actionPayload["startDate"] as string) || "";
        const startTime: string = (actionPayload["startTime"] as string) || "";
        const endDate: string = (actionPayload["endDate"] as string) || "";
        const endTime: string = (actionPayload["endTime"] as string) || "";
        const monitorIds: string =
          (actionPayload["scheduledMaintenanceMonitors"] as string) || "";
        const monitorStatusId: string =
          (actionPayload["monitorStatus"] as string) || "";
        const labelIds: string = (actionPayload["labels"] as string) || "";

        if (
          !title ||
          !description ||
          !startDate ||
          !startTime ||
          !endDate ||
          !endTime
        ) {
          await turnContext.sendActivity(
            "Unable to create scheduled maintenance: missing required fields (title, description, start date/time, or end date/time).",
          );
          return;
        }

        if (!request.userId || !request.projectId) {
          await turnContext.sendActivity(
            "Unable to create scheduled maintenance: missing user or project information.",
          );
          return;
        }

        if (
          title.length > MICROSOFT_TEAMS_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH
        ) {
          await turnContext.sendActivity(
            `Unable to create scheduled maintenance: the title can be at most ${MICROSOFT_TEAMS_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH} characters.`,
          );
          return;
        }

        await WorkspaceActionAuthorization.assertCanCreate({
          props: databaseProps,
          modelType: ScheduledMaintenance,
          action: "create a scheduled maintenance event",
        });

        /*
         * The card submits a bare date and time. They mean the time on the
         * user's clock, so they are read in the user's Teams time zone (see
         * MicrosoftTeamsTimezone), not in the server's.
         */
        const timezone: MicrosoftTeamsUserTimezone =
          MicrosoftTeamsTimezone.resolve({
            activity: turnContext.activity as unknown as JSONObject,
            timezoneFromCard: actionPayload["timezone"],
          });

        let startsAt: Date | null = MicrosoftTeamsTimezone.toDate({
          date: startDate,
          time: startTime,
          timezone: timezone,
        });
        const endsAt: Date | null = MicrosoftTeamsTimezone.toDate({
          date: endDate,
          time: endTime,
          timezone: timezone,
        });

        if (!startsAt || !endsAt) {
          await turnContext.sendActivity(
            "Unable to create scheduled maintenance: the start or end date and time could not be read. Please pick them again.",
          );
          return;
        }

        if (!OneUptimeDate.isInTheFuture(startsAt)) {
          const earliestStart: Date = OneUptimeDate.addRemoveMinutes(
            OneUptimeDate.getCurrentDate(),
            -MICROSOFT_TEAMS_MAINTENANCE_START_GRACE_IN_MINUTES,
          );

          if (OneUptimeDate.isBefore(startsAt, earliestStart)) {
            await turnContext.sendActivity(
              `Unable to create scheduled maintenance: the start time (${MicrosoftTeamsTimezone.format(
                startsAt,
                timezone,
              )}) is in the past.`,
            );
            return;
          }

          // A start picked for "now" that has just gone by: start now.
          startsAt = OneUptimeDate.getCurrentDate();
        }

        if (!OneUptimeDate.isAfter(endsAt, startsAt)) {
          await turnContext.sendActivity(
            `Unable to create scheduled maintenance: the end time (${MicrosoftTeamsTimezone.format(
              endsAt,
              timezone,
            )}) must be after the start time (${MicrosoftTeamsTimezone.format(
              startsAt,
              timezone,
            )}).`,
          );
          return;
        }

        const scheduledMaintenanceObj: ScheduledMaintenance =
          new ScheduledMaintenance();
        scheduledMaintenanceObj.title = title;
        scheduledMaintenanceObj.description = description;
        scheduledMaintenanceObj.projectId = request.projectId;
        scheduledMaintenanceObj.createdByUserId = new ObjectID(request.userId);
        scheduledMaintenanceObj.startsAt = startsAt;
        scheduledMaintenanceObj.endsAt = endsAt;

        let createdScheduledMaintenance: ScheduledMaintenance;

        try {
          createdScheduledMaintenance =
            await this.createScheduledMaintenanceInProject({
              scheduledMaintenance: scheduledMaintenanceObj,
              projectId: request.projectId,
              monitorIds,
              monitorStatusId,
              labelIds,
            });
        } catch (error) {
          MicrosoftTeamsReplies.logFailure(
            "Could not create a scheduled maintenance event from Microsoft Teams",
            error,
            {
              projectId: request.projectId.toString(),
            },
          );

          const reason: string | null =
            MicrosoftTeamsReplies.getUserFacingErrorMessage(error);

          const createInOneUptimeUrl: string | null = reason
            ? null
            : await MicrosoftTeamsReplies.getDashboardLink({
                projectId: request.projectId,
                route: "/scheduled-maintenance-events/create",
              });

          await MicrosoftTeamsReplies.sendBestEffort(
            turnContext,
            reason
              ? `❌ Could not create the scheduled maintenance event: ${reason}`
              : `❌ Could not create the scheduled maintenance event because of an unexpected error. Please try again, or create it in OneUptime${
                  createInOneUptimeUrl ? `: ${createInOneUptimeUrl}` : "."
                }`,
          );
          return;
        }

        /*
         * The event exists from here on, so nothing below may report the
         * create as failed: a user told it failed submits again and gets a
         * second event. The confirmation goes first; removing the submitted
         * form is a courtesy.
         */
        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          await this.getScheduledMaintenanceCreatedMessage({
            scheduledMaintenance: createdScheduledMaintenance,
            projectId: request.projectId,
            startsAt: startsAt,
            endsAt: endsAt,
            timezone: timezone,
          }),
        );
        await MicrosoftTeamsReplies.deleteBestEffort(
          turnContext,
          turnContext.activity.replyToId,
        );

        return;
      }

      // For all other actions, we need an existing scheduled maintenance ID
      const scheduledMaintenanceId: ObjectID = actionPayload[
        "scheduledMaintenanceId"
      ] as ObjectID;

      if (!scheduledMaintenanceId) {
        logger.error("ScheduledMaintenance ID is required", {
          actionType: actionType,
        });
        await turnContext.sendActivity("ScheduledMaintenance ID is required");
        return;
      }

      const scheduledMaintenance: ScheduledMaintenance | null =
        await ScheduledMaintenanceService.findOneBy({
          query: {
            _id: scheduledMaintenanceId,
            projectId: request.projectId,
          },
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
        logger.error("ScheduledMaintenance not found", {
          scheduledMaintenanceId: scheduledMaintenanceId.toString(),
        });
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
          await WorkspaceActionAuthorization.assertCanCreate({
            props: databaseProps,
            modelType: ScheduledMaintenanceStateTimeline,
            action: "mark this scheduled maintenance event as ongoing",
            resources: [
              {
                service: ScheduledMaintenanceService,
                id: scheduledMaintenanceId,
              },
            ],
          });

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
          await WorkspaceActionAuthorization.assertCanCreate({
            props: databaseProps,
            modelType: ScheduledMaintenanceStateTimeline,
            action: "mark this scheduled maintenance event as complete",
            resources: [
              {
                service: ScheduledMaintenanceService,
                id: scheduledMaintenanceId,
              },
            ],
          });

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

          await WorkspaceActionAuthorization.assertCanCreate({
            props: databaseProps,
            modelType: isPublic
              ? ScheduledMaintenancePublicNote
              : ScheduledMaintenanceInternalNote,
            action: isPublic
              ? "add a public note to this scheduled maintenance event"
              : "add a private note to this scheduled maintenance event",
            resources: [
              {
                service: ScheduledMaintenanceService,
                id: scheduledMaintenanceId,
              },
            ],
          });

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

          await MicrosoftTeamsReplies.sendBestEffort(
            turnContext,
            "Note added successfully",
          );

          /*
           * The action is done: a refused reply or a failed delete of the
           * form must not read as a failed action, which invites a repeat.
           */
          await MicrosoftTeamsReplies.deleteBestEffort(
            turnContext,
            turnContext.activity.replyToId,
          );

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

          await WorkspaceActionAuthorization.assertCanCreate({
            props: databaseProps,
            modelType: ScheduledMaintenanceStateTimeline,
            action: "change the state of this scheduled maintenance event",
            resources: [
              {
                service: ScheduledMaintenanceService,
                id: scheduledMaintenanceId,
              },
            ],
          });

          await ScheduledMaintenanceService.updateOneById({
            id: scheduledMaintenanceId,
            data: {
              currentScheduledMaintenanceStateId: stateId,
            },
            props: {
              isRoot: true,
            },
          });

          await MicrosoftTeamsReplies.sendBestEffort(
            turnContext,
            "ScheduledMaintenance state changed successfully",
          );

          /*
           * The action is done: a refused reply or a failed delete of the
           * form must not read as a failed action, which invites a repeat.
           */
          await MicrosoftTeamsReplies.deleteBestEffort(
            turnContext,
            turnContext.activity.replyToId,
          );

          break;
        }

        default:
          logger.error(`Unknown action type: ${actionType}`, {
            scheduledMaintenanceId: scheduledMaintenanceId.toString(),
            actionType: actionType,
          });
          await turnContext.sendActivity("Unknown action type");
          break;
      }
    } catch (error) {
      // Tell the user why they were refused; the message is written for them.
      if (error instanceof NotAuthorizedException) {
        await turnContext.sendActivity(error.message);
        return;
      }

      logger.error(`Error handling scheduled maintenance action: ${error}`, {
        actionType: actionType,
      });
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

    logger.debug("Showing new scheduled maintenance card for Microsoft Teams", {
      projectId: teamsRequest.projectId?.toString(),
    });

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

    /*
     * Send card as a message (note: in real Teams bot, this would be sent via TurnContext)
     * For now, we'll just log it. The actual sending will be done through the bot framework
     */
    logger.debug("New scheduled maintenance card built:", {
      projectId: teamsRequest.projectId.toString(),
    });
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

    logger.debug("Submitting new scheduled maintenance from Microsoft Teams", {
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

    const title: string = (value["scheduledMaintenanceTitle"] as string) || "";
    const description: string =
      (value["scheduledMaintenanceDescription"] as string) || "";
    const startDate: string = (value["startDate"] as string) || "";
    const endDate: string = (value["endDate"] as string) || "";
    const monitorIds: string =
      (value["scheduledMaintenanceMonitors"] as string) || "";
    const monitorStatusId: string = (value["monitorStatus"] as string) || "";
    const labelIds: string = (value["labels"] as string) || "";

    if (!title || !description || !startDate || !endDate) {
      logger.error(
        "Missing required fields for scheduled maintenance creation",
        {
          projectId: projectId.toString(),
        },
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

      await this.createScheduledMaintenanceInProject({
        scheduledMaintenance,
        projectId,
        monitorIds,
        monitorStatusId,
        labelIds,
      });

      logger.debug(
        "New scheduled maintenance created from Microsoft Teams successfully",
        {
          projectId: projectId.toString(),
        },
      );
    } catch (error) {
      logger.error(
        "Error creating scheduled maintenance from Microsoft Teams:",
        {
          projectId: projectId.toString(),
        },
      );
      logger.error(error);
    }
  }

  /*
   * The confirmation: when the event starts and ends in the user's time zone
   * (so a wrong zone shows at once), and a link to it when one can be built.
   */
  private static async getScheduledMaintenanceCreatedMessage(data: {
    scheduledMaintenance: ScheduledMaintenance;
    projectId: ObjectID;
    startsAt: Date;
    endsAt: Date;
    timezone: MicrosoftTeamsUserTimezone;
  }): Promise<string> {
    let message: string = `✅ Scheduled maintenance created successfully!\n\n**Starts:** ${MicrosoftTeamsTimezone.format(
      data.startsAt,
      data.timezone,
    )}\n\n**Ends:** ${MicrosoftTeamsTimezone.format(
      data.endsAt,
      data.timezone,
    )}`;

    if (MicrosoftTeamsTimezone.isUtcOffsetOnly(data.timezone)) {
      message += `\n\nMicrosoft Teams did not say which time zone you are in, so these times were read at your current offset, ${data.timezone.label}. If daylight saving time changes before then, check them in OneUptime.`;
    }

    if (data.scheduledMaintenance.id) {
      try {
        const maintenanceLink: URL =
          await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
            data.scheduledMaintenance.projectId || data.projectId,
            data.scheduledMaintenance.id,
          );

        message += `\n\nView scheduled maintenance: ${maintenanceLink.toString()}`;
      } catch (error) {
        logger.debug(
          "Could not build the link to a new scheduled maintenance event",
        );
        logger.debug(error);
      }
    }

    return message;
  }

  /*
   * Every id below comes from the submitted card, not from the form we sent,
   * and the event is created as root. So they are checked against the linked
   * project before anything is created.
   */
  private static async createScheduledMaintenanceInProject(data: {
    scheduledMaintenance: ScheduledMaintenance;
    projectId: ObjectID;
    monitorIds: string;
    monitorStatusId: string;
    labelIds: string;
  }): Promise<ScheduledMaintenance> {
    const { scheduledMaintenance, projectId } = data;

    const monitorIdArray: Array<ObjectID> =
      WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(
        data.monitorIds,
      );
    const labelIdArray: Array<ObjectID> =
      WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(data.labelIds);
    const monitorStatusId: ObjectID | undefined =
      data.monitorStatusId && monitorIdArray.length > 0
        ? new ObjectID(data.monitorStatusId)
        : undefined;

    await WorkspaceProjectReferenceValidator.validateReferencesBelongToProject({
      projectId: projectId,
      subject: "scheduled maintenance event",
      monitorIds: monitorIdArray,
      labelIds: labelIdArray,
      monitorStatusId: monitorStatusId,
    });

    if (monitorIdArray.length > 0) {
      scheduledMaintenance.monitors = monitorIdArray.map((id: ObjectID) => {
        const monitor: Monitor = new Monitor();
        monitor.id = id;
        return monitor;
      });
    }

    if (labelIdArray.length > 0) {
      scheduledMaintenance.labels = labelIdArray.map((id: ObjectID) => {
        const label: Label = new Label();
        label.id = id;
        return label;
      });
    }

    /*
     * ScheduledMaintenanceService moves the event's monitors to this status
     * when the event starts, and back when it ends, with status timeline
     * entries, as for an event scheduled in the dashboard or from Slack. Teams
     * used to write currentMonitorStatusId on the monitors directly, the
     * moment the event was created, however far off it was, and nothing ever
     * moved them back.
     */
    if (monitorStatusId) {
      scheduledMaintenance.changeMonitorStatusToId = monitorStatusId;
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
      {
        projectId: projectId.toString(),
        scheduledMaintenanceId: createdScheduledMaintenance.id?.toString(),
      },
    );

    return createdScheduledMaintenance;
  }

  // Every list the "Create New Scheduled Maintenance" card offers.
  public static async getNewScheduledMaintenanceFormChoices(
    projectId: ObjectID,
  ): Promise<MicrosoftTeamsNewScheduledMaintenanceFormChoices> {
    const [monitors, monitorStatuses, labels]: [
      MicrosoftTeamsCardChoiceList,
      MicrosoftTeamsCardChoiceList,
      MicrosoftTeamsCardChoiceList,
    ] = await Promise.all([
      MicrosoftTeamsCardChoices.getMonitorChoices(projectId),
      MicrosoftTeamsCardChoices.getMonitorStatusChoices(projectId),
      MicrosoftTeamsCardChoices.getLabelChoices(projectId),
    ]);

    return {
      monitors: monitors,
      monitorStatuses: monitorStatuses,
      labels: labels,
    };
  }

  /*
   * The "Create New Scheduled Maintenance" card for a project, fitted to the
   * first size budget. The bot itself sends the card through
   * MicrosoftTeamsCreateCommands, which also tries the smaller budgets.
   */
  public static async buildNewScheduledMaintenanceCard(
    projectId: ObjectID,
    options?:
      | {
          initialTitle?: string | undefined;
          timezone?: string | undefined;
        }
      | undefined,
  ): Promise<JSONObject> {
    return this.buildNewScheduledMaintenanceCardForBudget({
      choices: await this.getNewScheduledMaintenanceFormChoices(projectId),
      budgetInBytes: MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
      initialTitle: options?.initialTitle,
      timezone: options?.timezone,
    });
  }

  /*
   * The "Create New Scheduled Maintenance" card with its monitor and label
   * lists shortened until it fits the budget (issue #4111: listing all of
   * them made Teams refuse the card). `timezone` is the IANA zone the user
   * asked from, when Teams told us; it is named on the card and travels in
   * the submit data.
   */
  public static buildNewScheduledMaintenanceCardForBudget(data: {
    choices: MicrosoftTeamsNewScheduledMaintenanceFormChoices;
    budgetInBytes: number;
    initialTitle?: string | undefined;
    createInOneUptimeUrl?: string | null | undefined;
    timezone?: string | undefined;
  }): JSONObject {
    return MicrosoftTeamsCardChoices.fitCardToBudget<
      keyof MicrosoftTeamsNewScheduledMaintenanceFormChoices
    >({
      lists: data.choices,
      trimmableKeys: ["monitors", "labels"],
      budgetInBytes: data.budgetInBytes,
      buildCard: (
        shown: Record<
          keyof MicrosoftTeamsNewScheduledMaintenanceFormChoices,
          MicrosoftTeamsCardChoiceList
        >,
      ): JSONObject => {
        return this.buildNewScheduledMaintenanceCardBody({
          shown: shown,
          initialTitle: data.initialTitle,
          createInOneUptimeUrl: data.createInOneUptimeUrl,
          timezone: data.timezone,
        });
      },
    }).card;
  }

  private static buildNewScheduledMaintenanceCardBody(data: {
    shown: MicrosoftTeamsNewScheduledMaintenanceFormChoices;
    initialTitle?: string | undefined;
    createInOneUptimeUrl?: string | null | undefined;
    timezone?: string | undefined;
  }): JSONObject {
    const { shown } = data;
    const initialTitle: string = (data.initialTitle || "").trim();
    const timezone: string | undefined =
      MicrosoftTeamsTimezone.getKnownTimezone(data.timezone);
    let isAnythingLeftOff: boolean = false;

    const addLaterHint: string =
      "You can add them to the event in OneUptime after it is created.";

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
        maxLength: MICROSOFT_TEAMS_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH,
        ...(initialTitle
          ? {
              value: truncateToLength(
                initialTitle,
                MICROSOFT_TEAMS_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH,
              ),
            }
          : {}),
      },
      {
        type: "Input.Text",
        id: "scheduledMaintenanceDescription",
        label: "Event Description",
        placeholder: "Enter maintenance event description",
        isMultiline: true,
        isRequired: true,
      },
      MicrosoftTeamsCardChoices.buildNoteElement(
        timezone
          ? `Start and end times are in ${timezone}.`
          : "Start and end times are in the time zone Microsoft Teams reports for you, or in UTC if it does not report one.",
      ),
      {
        type: "Input.Date",
        id: "startDate",
        label: "Start Date",
        isRequired: true,
      },
      {
        type: "Input.Time",
        id: "startTime",
        label: "Start Time",
        isRequired: true,
      },
      {
        type: "Input.Date",
        id: "endDate",
        label: "End Date",
        isRequired: true,
      },
      {
        type: "Input.Time",
        id: "endTime",
        label: "End Time",
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

    // Add monitor multi-select if we have monitors
    if (shown.monitors.choices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "scheduledMaintenanceMonitors",
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
        title: "Create Maintenance Event",
        data: {
          action:
            MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
          ...(timezone ? { timezone: timezone } : {}),
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
