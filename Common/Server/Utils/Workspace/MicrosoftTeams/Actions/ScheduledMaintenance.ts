import { ExpressRequest, ExpressResponse } from "../../../Express";
import Response from "../../../Response";
import { MicrosoftTeamsAction, MicrosoftTeamsRequest } from "./Auth";
import { MicrosoftTeamsScheduledMaintenanceActionType } from "./ActionTypes";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from 'botbuilder';
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNoteService from "../../../../Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceStateService from "../../../../Services/ScheduledMaintenanceStateService";

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
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitChangeScheduledMaintenanceState
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
    request: MicrosoftTeamsRequest
  ): Promise<void> {
    try {
      const scheduledMaintenanceId: ObjectID = actionPayload['scheduledMaintenanceId'] as ObjectID;

      if (!scheduledMaintenanceId) {
        logger.error('ScheduledMaintenance ID is required');
        await turnContext.sendActivity('ScheduledMaintenance ID is required');
        return;
      }

      const scheduledMaintenance: ScheduledMaintenance | null = await ScheduledMaintenanceService.findOneById({
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
        logger.error('ScheduledMaintenance not found');
        await turnContext.sendActivity('ScheduledMaintenance not found');
        return;
      }

      switch (actionType) {
        case MicrosoftTeamsScheduledMaintenanceActionType.ViewScheduledMaintenance:
          await turnContext.sendActivity(`**${scheduledMaintenance.title}**\n\n${scheduledMaintenance.description}\n\nStarts: ${scheduledMaintenance.startsAt}\nEnds: ${scheduledMaintenance.endsAt}\nStatus: ${scheduledMaintenance.currentScheduledMaintenanceState?.name}`);
          break;

        case MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing:
          const ongoingState = await ScheduledMaintenanceStateService.getOngoingScheduledMaintenanceState({
            projectId: scheduledMaintenance.projectId!,
            props: {
              isRoot: true,
            },
          });
          await ScheduledMaintenanceService.updateOneById({
            id: scheduledMaintenanceId,
            data: {
              currentScheduledMaintenanceStateId: ongoingState.id!,
            },
            props: {
              isRoot: true,
            },
          });
          await turnContext.sendActivity('ScheduledMaintenance marked as ongoing');
          break;

        case MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete:
          const completedState = await ScheduledMaintenanceStateService.getCompletedScheduledMaintenanceState({
            projectId: scheduledMaintenance.projectId!,
            props: {
              isRoot: true,
            },
          });
          await ScheduledMaintenanceService.updateOneById({
            id: scheduledMaintenanceId,
            data: {
              currentScheduledMaintenanceStateId: completedState.id!,
            },
            props: {
              isRoot: true,
            },
          });
          await turnContext.sendActivity('ScheduledMaintenance marked as complete');
          break;

        case MicrosoftTeamsScheduledMaintenanceActionType.ViewAddScheduledMaintenanceNote:
          await turnContext.sendActivity({
            attachments: [
              {
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: this.buildAddScheduledMaintenanceNoteCard(scheduledMaintenanceId),
              },
            ],
          });
          break;

        case MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote:
          const note: string = actionPayload['note'] as string;
          const isPublic: boolean = actionPayload['isPublic'] as boolean;

          if (!request.userId) {
            await turnContext.sendActivity('User ID is required to add notes');
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

          await turnContext.sendActivity('Note added successfully');
          break;

        case MicrosoftTeamsScheduledMaintenanceActionType.ViewChangeScheduledMaintenanceState:
          await turnContext.sendActivity({
            attachments: [
              {
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: await this.buildChangeScheduledMaintenanceStateCard(scheduledMaintenanceId, scheduledMaintenance.projectId!),
              },
            ],
          });
          break;

        case MicrosoftTeamsScheduledMaintenanceActionType.SubmitChangeScheduledMaintenanceState:
          const stateId: ObjectID = actionPayload['stateId'] as ObjectID;

          await ScheduledMaintenanceService.updateOneById({
            id: scheduledMaintenanceId,
            data: {
              currentScheduledMaintenanceStateId: stateId,
            },
            props: {
              isRoot: true,
            },
          });

          await turnContext.sendActivity('ScheduledMaintenance state changed successfully');
          break;

        default:
          logger.error(`Unknown action type: ${actionType}`);
          await turnContext.sendActivity('Unknown action type');
          break;
      }
    } catch (error) {
      logger.error(`Error handling scheduled maintenance action: ${error}`);
      await turnContext.sendActivity('An error occurred while processing the action');
    }
  }

  private static buildAddScheduledMaintenanceNoteCard(scheduledMaintenanceId: ObjectID): JSONObject {
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
            action: MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote,
            scheduledMaintenanceId: scheduledMaintenanceId.toString(),
          },
        },
      ],
    };
  }

  private static async buildChangeScheduledMaintenanceStateCard(scheduledMaintenanceId: ObjectID, projectId: ObjectID): Promise<JSONObject> {
    const scheduledMaintenanceStates = await ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates({
      projectId: projectId,
      props: {
        isRoot: true,
      },
    });

    const choices = scheduledMaintenanceStates.map(state => ({
      title: state.name || "",
      value: state._id?.toString() || "",
    })).filter(choice => choice.title && choice.value);

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
            action: MicrosoftTeamsScheduledMaintenanceActionType.SubmitChangeScheduledMaintenanceState,
            scheduledMaintenanceId: scheduledMaintenanceId.toString(),
          },
        },
      ],
    };
  }
}
