import { MicrosoftTeamsRequest } from "./Auth";
import { MicrosoftTeamsScheduledMaintenanceActionType } from "./ActionTypes";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventStateOption,
  WorkspaceEventStateOptions,
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
import ScheduledMaintenanceStateTimeline from "../../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ScheduledMaintenancePublicNote from "../../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceInternalNote from "../../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNoteService from "../../../../Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../Services/ScheduledMaintenancePublicNoteService";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Label from "../../../../../Models/DatabaseModels/Label";
import OneUptimeDate from "../../../../../Types/Date";
import URL from "../../../../../Types/API/URL";
import ColumnLength from "../../../../../Types/Database/ColumnLength";
import { truncateToLength } from "../../../Database/TruncateColumnValue";
import WorkspaceProjectReferenceValidator from "../../WorkspaceProjectReferenceValidator";
import MicrosoftTeamsCardChoices, {
  MicrosoftTeamsCardChoiceList,
} from "../MicrosoftTeamsCardChoices";
import MicrosoftTeamsReplies from "../MicrosoftTeamsReplies";
import MicrosoftTeamsTimezone, {
  MicrosoftTeamsUserTimezone,
} from "../MicrosoftTeamsTimezone";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";

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
  // What a change-state card says instead of opening with nothing to pick.
  public static readonly NO_STATES_MESSAGE: string =
    "No scheduled maintenance states are available to you in this project. Ask a project admin for access to them.";

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
            mdText`Unable to create scheduled maintenance: the title can be at most ${MICROSOFT_TEAMS_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH} characters.`.toString(),
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
              mdText`Unable to create scheduled maintenance: the start time (${MicrosoftTeamsTimezone.format(
                startsAt,
                timezone,
              )}) is in the past.`.toString(),
            );
            return;
          }

          // A start picked for "now" that has just gone by: start now.
          startsAt = OneUptimeDate.getCurrentDate();
        }

        if (!OneUptimeDate.isAfter(endsAt, startsAt)) {
          await turnContext.sendActivity(
            mdText`Unable to create scheduled maintenance: the end time (${MicrosoftTeamsTimezone.format(
              endsAt,
              timezone,
            )}) must be after the start time (${MicrosoftTeamsTimezone.format(
              startsAt,
              timezone,
            )}).`.toString(),
          );
          return;
        }

        const scheduledMaintenanceObj: ScheduledMaintenance =
          new ScheduledMaintenance();
        scheduledMaintenanceObj.title = title;
        scheduledMaintenanceObj.description = description;
        scheduledMaintenanceObj.projectId = request.projectId;
        scheduledMaintenanceObj.startsAt = startsAt;
        scheduledMaintenanceObj.endsAt = endsAt;

        let createdScheduledMaintenance: ScheduledMaintenance;

        try {
          createdScheduledMaintenance =
            await this.createScheduledMaintenanceInProject({
              scheduledMaintenance: scheduledMaintenanceObj,
              projectId: request.projectId,
              props: databaseProps,
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
              ? mdText`❌ Could not create the scheduled maintenance event: ${reason}`.toString()
              : mdText`❌ Could not create the scheduled maintenance event because of an unexpected error. Please try again, or create it in OneUptime${
                  createInOneUptimeUrl ? mdText`: ${createInOneUptimeUrl}` : "."
                }`.toString(),
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
      const scheduledMaintenanceIdValue: unknown =
        actionPayload["scheduledMaintenanceId"];

      if (!scheduledMaintenanceIdValue) {
        logger.error("ScheduledMaintenance ID is required", {
          actionType: actionType,
        });
        await turnContext.sendActivity("ScheduledMaintenance ID is required");
        return;
      }

      const scheduledMaintenanceId: ObjectID = new ObjectID(
        String(scheduledMaintenanceIdValue),
      );

      /*
       * Read as the member: an event they may not read is answered like
       * one that is not there, before anything about it is shown. This is
       * the press's one read of it: it reads what View shows and what the
       * buttons below need - its state and its number - and they act on it
       * as read here.
       */
      const found: {
        record: ScheduledMaintenance;
        event: WorkspaceEventRecord;
      } | null =
        await WorkspaceMemberActions.findEventForMember<ScheduledMaintenance>({
          event: {
            type: WorkspaceEventType.ScheduledMaintenance,
            id: scheduledMaintenanceId,
          },
          props: databaseProps,
          select: {
            title: true,
            description: true,
            startsAt: true,
            endsAt: true,
            currentScheduledMaintenanceState: {
              name: true,
            },
          },
        });

      if (!found) {
        logger.error("ScheduledMaintenance not found", {
          scheduledMaintenanceId: scheduledMaintenanceId.toString(),
        });
        await turnContext.sendActivity("ScheduledMaintenance not found");
        return;
      }

      const scheduledMaintenance: ScheduledMaintenance = found.record;
      const event: WorkspaceEventRecord = found.event;

      switch (actionType) {
        case MicrosoftTeamsScheduledMaintenanceActionType.ViewScheduledMaintenance:
          // The title and the state's name are plain text; the description is Markdown.
          await turnContext.sendActivity(
            mdText`**${scheduledMaintenance.title}**\n\n${FeedMarkdown.asChatMarkdown(scheduledMaintenance.description)}\n\nStarts: ${String(scheduledMaintenance.startsAt)}\nEnds: ${String(scheduledMaintenance.endsAt)}\nStatus: ${scheduledMaintenance.currentScheduledMaintenanceState?.name}`.toString(),
          );
          break;

        case MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing: {
          // The event was read as the member above; this asks the rest.
          await WorkspaceActionAuthorization.assertCanCreate({
            props: databaseProps,
            modelType: ScheduledMaintenanceStateTimeline,
            action: "mark this scheduled maintenance event as ongoing",
          });

          /*
           * Marked by the member, as the dashboard marks it for them
           * (WorkspaceMemberActions).
           */
          await WorkspaceMemberActions.markScheduledMaintenanceAsOngoing({
            event: event,
            props: databaseProps,
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
          });

          // Marked by the member, as the dashboard marks it for them.
          await WorkspaceMemberActions.resolve({
            event: event,
            props: databaseProps,
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
          const note: string = String(actionPayload["note"] || "").trim();
          // The card's Note Type choice: "public" or "private".
          const noteType: string = String(actionPayload["noteType"] || "");

          if (!note) {
            await turnContext.sendActivity(
              "Unable to add note: missing note data.",
            );
            return;
          }

          if (noteType !== "public" && noteType !== "private") {
            await turnContext.sendActivity(
              "Unable to add note: invalid note type.",
            );
            return;
          }

          const isPublic: boolean = noteType === "public";

          await WorkspaceActionAuthorization.assertCanCreate({
            props: databaseProps,
            modelType: isPublic
              ? ScheduledMaintenancePublicNote
              : ScheduledMaintenanceInternalNote,
            action: isPublic
              ? "add a public note to this scheduled maintenance event"
              : "add a private note to this scheduled maintenance event",
          });

          // Posted by the member, as the dashboard posts it for them.
          if (isPublic) {
            await ScheduledMaintenancePublicNoteService.addNote({
              scheduledMaintenanceId: scheduledMaintenanceId,
              note: note,
              projectId: request.projectId,
              props: databaseProps,
            });
          } else {
            await ScheduledMaintenanceInternalNoteService.addNote({
              scheduledMaintenanceId: scheduledMaintenanceId,
              note: note,
              projectId: request.projectId,
              props: databaseProps,
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

        case MicrosoftTeamsScheduledMaintenanceActionType.ViewChangeScheduledMaintenanceState: {
          /*
           * Asked as the submit asks it, before the card is shown, of the
           * event as the submit reads it, with the state it is in. The card
           * then offers the states the member may read that it may move into
           * next (Common/Utils/StateMove), so it never offers a move its
           * timeline would refuse.
           */
          const scheduledMaintenance: WorkspaceEventRecord =
            await WorkspaceMemberActions.authorize({
              props: databaseProps,
              modelType: ScheduledMaintenanceStateTimeline,
              action: "change the state of this scheduled maintenance event",
              event: {
                type: WorkspaceEventType.ScheduledMaintenance,
                id: scheduledMaintenanceId,
              },
            });

          const stateOptions: WorkspaceEventStateOptions =
            await WorkspaceMemberActions.findStateOptions({
              event: scheduledMaintenance,
              props: databaseProps,
            });

          if (stateOptions.options.length === 0) {
            await turnContext.sendActivity(
              stateOptions.hasNoLaterState
                ? WorkspaceMemberActions.getNoLaterStateMessage(
                    WorkspaceEventType.ScheduledMaintenance,
                  )
                : MicrosoftTeamsScheduledMaintenanceActions.NO_STATES_MESSAGE,
            );
            break;
          }

          const card: JSONObject =
            this.buildChangeScheduledMaintenanceStateCard(
              scheduledMaintenanceId,
              stateOptions.options,
            );

          await turnContext.sendActivity({
            attachments: [
              {
                contentType: "application/vnd.microsoft.card.adaptive",
                content: card,
              },
            ],
          });
          break;
        }

        case MicrosoftTeamsScheduledMaintenanceActionType.SubmitChangeScheduledMaintenanceState: {
          const stateIdValue: unknown = actionPayload["stateId"];

          if (!stateIdValue) {
            await turnContext.sendActivity(
              "Unable to change the state: missing state id.",
            );
            return;
          }

          await WorkspaceActionAuthorization.assertCanCreate({
            props: databaseProps,
            modelType: ScheduledMaintenanceStateTimeline,
            action: "change the state of this scheduled maintenance event",
          });

          /*
           * The state change the dashboard makes: a row in the event's state
           * timeline, created by the member (WorkspaceMemberActions).
           */
          await WorkspaceMemberActions.changeState({
            event: event,
            stateId: new ObjectID(String(stateIdValue)),
            props: databaseProps,
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
      /*
       * Tell the user why they were refused; the message is written for
       * them, and placed as text - it can name a label, a record or a person.
       */
      if (error instanceof NotAuthorizedException) {
        await turnContext.sendActivity(mdText`${error.message}`.toString());
        return;
      }

      // A refusal the write gave them (a plan, a value, a record), likewise.
      const reason: string | null =
        MicrosoftTeamsReplies.getUserFacingErrorMessage(error);

      if (reason) {
        await turnContext.sendActivity(
          mdText`Sorry, that action failed: ${reason}`.toString(),
        );
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

  /*
   * The card offering the states the event may move into next, as the
   * member may read them (WorkspaceMemberActions.findStateOptions), in the
   * project's order.
   */
  private static buildChangeScheduledMaintenanceStateCard(
    scheduledMaintenanceId: ObjectID,
    scheduledMaintenanceStates: Array<WorkspaceEventStateOption>,
  ): JSONObject {
    const choices: Array<{ title: string; value: string }> =
      scheduledMaintenanceStates.map((state: WorkspaceEventStateOption) => {
        return {
          title: state.name,
          value: state.id.toString(),
        };
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
    const paragraphs: Array<MarkdownText> = [
      mdText`✅ Scheduled maintenance created successfully!`,
      mdText`**Starts:** ${MicrosoftTeamsTimezone.format(
        data.startsAt,
        data.timezone,
      )}`,
      mdText`**Ends:** ${MicrosoftTeamsTimezone.format(
        data.endsAt,
        data.timezone,
      )}`,
    ];

    if (MicrosoftTeamsTimezone.isUtcOffsetOnly(data.timezone)) {
      paragraphs.push(
        mdText`Microsoft Teams did not say which time zone you are in, so these times were read at your current offset, ${data.timezone.label}. If daylight saving time changes before then, check them in OneUptime.`,
      );
    }

    if (data.scheduledMaintenance.id) {
      try {
        const maintenanceLink: URL =
          await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
            data.scheduledMaintenance.projectId || data.projectId,
            data.scheduledMaintenance.id,
          );

        paragraphs.push(
          mdText`View scheduled maintenance: ${maintenanceLink.toString()}`,
        );
      } catch (error) {
        logger.debug(
          "Could not build the link to a new scheduled maintenance event",
        );
        logger.debug(error);
      }
    }

    return FeedMarkdown.join(paragraphs, "\n\n").toString();
  }

  /*
   * Every id below comes from the submitted card, not from the form we sent.
   * The event is created by the member the Teams account is connected to,
   * with their own props, as they would create it in OneUptime: they must be
   * allowed to create events, and every record the card names - the
   * monitors, labels and monitor status - must be one they may name.
   * ScheduledMaintenanceService checks those on the create itself, and a
   * record they may not read is answered like one that is not in the
   * project (ProjectScopedReferenceException).
   */
  private static async createScheduledMaintenanceInProject(data: {
    scheduledMaintenance: ScheduledMaintenance;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
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
        props: data.props,
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

  /*
   * Every list the "Create New Scheduled Maintenance" card offers, read in
   * one project as the member the card is for (`props`): only what they may
   * read.
   */
  public static async getNewScheduledMaintenanceFormChoices(
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<MicrosoftTeamsNewScheduledMaintenanceFormChoices> {
    const [monitors, monitorStatuses, labels]: [
      MicrosoftTeamsCardChoiceList,
      MicrosoftTeamsCardChoiceList,
      MicrosoftTeamsCardChoiceList,
    ] = await Promise.all([
      MicrosoftTeamsCardChoices.getMonitorChoices(projectId, props),
      MicrosoftTeamsCardChoices.getMonitorStatusChoices(projectId, props),
      MicrosoftTeamsCardChoices.getLabelChoices(projectId, props),
    ]);

    return {
      monitors: monitors,
      monitorStatuses: monitorStatuses,
      labels: labels,
    };
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
