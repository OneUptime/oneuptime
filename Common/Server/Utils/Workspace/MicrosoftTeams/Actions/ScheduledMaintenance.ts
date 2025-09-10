import MicrosoftTeamsActionType from "./ActionTypes";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Services/ScheduledMaintenanceStateService";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationActionType from "../../../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../../../Types/Workspace/WorkspaceNotificationStatus";

export default class ScheduledMaintenanceActions {
  public static async executeAction(
    actionType: MicrosoftTeamsActionType,
    scheduledMaintenanceId: ObjectID,
    userId: string,
  ): Promise<void> {
    switch (actionType) {
      case MicrosoftTeamsActionType.MarkScheduledMaintenanceAsOngoing:
        await this.acknowledgeScheduledMaintenance(
          scheduledMaintenanceId,
          userId,
        );
        break;
      case MicrosoftTeamsActionType.MarkScheduledMaintenanceAsComplete:
        await this.resolveScheduledMaintenance(
          scheduledMaintenanceId,
          userId,
        );
        break;
      default:
        throw new Error(`Unknown action type: ${actionType}`);
    }
  }

  private static async acknowledgeScheduledMaintenance(
    scheduledMaintenanceId: ObjectID,
    userId: string,
  ): Promise<void> {
    try {
      // Get the scheduled maintenance to get project ID
      const scheduledMaintenance =
        await ScheduledMaintenanceService.findOneById({
          id: scheduledMaintenanceId,
          select: {
            _id: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!scheduledMaintenance) {
        throw new Error("Scheduled maintenance not found");
      }

      // Get the ongoing state
      const ongoingState =
        await ScheduledMaintenanceStateService.findOneBy({
          query: {
            name: "Ongoing",
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!ongoingState) {
        throw new Error("Ongoing state not found");
      }

      // Update the scheduled maintenance state to ongoing
      await ScheduledMaintenanceService.updateOneById({
        id: scheduledMaintenanceId,
        data: {
          currentScheduledMaintenanceStateId: ongoingState.id!,
        },
        props: {
          isRoot: true,
        },
      });

      // Log the action
      await WorkspaceNotificationLogService.createWorkspaceLog(
        {
          projectId: scheduledMaintenance.projectId!,
          workspaceType: WorkspaceType.MicrosoftTeams,
          userId: new ObjectID(userId),
          scheduledMaintenanceId: scheduledMaintenanceId,
          actionType: WorkspaceNotificationActionType.ButtonPressed,
          status: WorkspaceNotificationStatus.Success,
          statusMessage: `Scheduled maintenance acknowledged by user ${userId}`,
        },
        {
          isRoot: true,
        },
      );
    } catch (error) {
      // Get the scheduled maintenance to get project ID for error logging
      let projectId: ObjectID = scheduledMaintenanceId; // fallback
      try {
        const scheduledMaintenance =
          await ScheduledMaintenanceService.findOneById({
            id: scheduledMaintenanceId,
            select: {
              _id: true,
              projectId: true,
            },
            props: {
              isRoot: true,
            },
          });
        if (scheduledMaintenance?.projectId) {
          projectId = scheduledMaintenance.projectId;
        }
      } catch (e) {
        // Ignore error getting project ID
      }

      // Log the error
      await WorkspaceNotificationLogService.createWorkspaceLog(
        {
          projectId: projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
          userId: new ObjectID(userId),
          scheduledMaintenanceId: scheduledMaintenanceId,
          actionType: WorkspaceNotificationActionType.ButtonPressed,
          status: WorkspaceNotificationStatus.Error,
          statusMessage: `Failed to acknowledge scheduled maintenance: ${error}`,
        },
        {
          isRoot: true,
        },
      );
      throw error;
    }
  }

  private static async resolveScheduledMaintenance(
    scheduledMaintenanceId: ObjectID,
    userId: string,
  ): Promise<void> {
    try {
      // Get the scheduled maintenance to get project ID
      const scheduledMaintenance =
        await ScheduledMaintenanceService.findOneById({
          id: scheduledMaintenanceId,
          select: {
            _id: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!scheduledMaintenance) {
        throw new Error("Scheduled maintenance not found");
      }

      // Get the completed state
      const completedState =
        await ScheduledMaintenanceStateService.findOneBy({
          query: {
            name: "Completed",
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!completedState) {
        throw new Error("Completed state not found");
      }

      // Update the scheduled maintenance state to completed
      await ScheduledMaintenanceService.updateOneById({
        id: scheduledMaintenanceId,
        data: {
          currentScheduledMaintenanceStateId: completedState.id!,
        },
        props: {
          isRoot: true,
        },
      });

      // Log the action
      await WorkspaceNotificationLogService.createWorkspaceLog(
        {
          projectId: scheduledMaintenance.projectId!,
          workspaceType: WorkspaceType.MicrosoftTeams,
          userId: new ObjectID(userId),
          scheduledMaintenanceId: scheduledMaintenanceId,
          actionType: WorkspaceNotificationActionType.ButtonPressed,
          status: WorkspaceNotificationStatus.Success,
          statusMessage: `Scheduled maintenance resolved by user ${userId}`,
        },
        {
          isRoot: true,
        },
      );
    } catch (error) {
      // Get the scheduled maintenance to get project ID for error logging
      let projectId: ObjectID = scheduledMaintenanceId; // fallback
      try {
        const scheduledMaintenance =
          await ScheduledMaintenanceService.findOneById({
            id: scheduledMaintenanceId,
            select: {
              _id: true,
              projectId: true,
            },
            props: {
              isRoot: true,
            },
          });
        if (scheduledMaintenance?.projectId) {
          projectId = scheduledMaintenance.projectId;
        }
      } catch (e) {
        // Ignore error getting project ID
      }

      // Log the error
      await WorkspaceNotificationLogService.createWorkspaceLog(
        {
          projectId: projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
          userId: new ObjectID(userId),
          scheduledMaintenanceId: scheduledMaintenanceId,
          actionType: WorkspaceNotificationActionType.ButtonPressed,
          status: WorkspaceNotificationStatus.Error,
          statusMessage: `Failed to resolve scheduled maintenance: ${error}`,
        },
        {
          isRoot: true,
        },
      );
      throw error;
    }
  }
}
