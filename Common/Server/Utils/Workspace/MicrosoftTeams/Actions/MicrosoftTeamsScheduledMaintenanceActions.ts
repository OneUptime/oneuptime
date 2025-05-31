import { JSONObject } from '../../../../../Types/JSON';
import { ExpressRequest, ExpressResponse } from '../../../Utils/Express'; 
import logger from '../../../Utils/Logger'; 
// MicrosoftTeamsActionType might still be used for reference or if some actions are still passed with full enum string
// import MicrosoftTeamsActionType from './ActionTypes'; 
import ObjectID from '../../../../../Types/ObjectID'; 
import ScheduledMaintenanceService from '../../../../Services/ScheduledMaintenanceService';
import ScheduledMaintenanceStateService from '../../../../Services/ScheduledMaintenanceStateService';
import ScheduledMaintenanceState from '../../../../../Models/DatabaseModels/ScheduledMaintenanceState';
import WorkspaceUserAuthTokenService from '../../../../Services/WorkspaceUserAuthTokenService';
import WorkspaceUserAuthToken from '../../../../../Models/DatabaseModels/WorkspaceUserAuthToken';
import WorkspaceType from '../../../../../Types/Workspace/WorkspaceType';
import RequestUtil from '../../../Utils/Request';
import { DatabaseCommonInteractionProps } from '../../../../../Types/Database/DatabaseCommonInteractionProps';
// import { SortOrder } from '../../../../../Types/BaseDatabase/SortOrder'; // Not strictly needed for findOneBy, but good for consistency
// import { LIMIT_PER_PROJECT } from '../../../../../Types/Database/LimitMax'; // Not strictly needed for findOneBy
import getUnlinkedUserCard from '../Cards/UnlinkedUserCard'; // Import the new card utility


export interface HandleScheduledMaintenanceActionPayload {
    actionId: string; // This is now actionName like "markOngoing", "markCompleted"
    data: JSONObject; // Custom data from the Adaptive Card action, includes scheduledMaintenanceId, projectId, actionModule, actionName
    request: ExpressRequest; 
    response: ExpressResponse; 
}

export class MicrosoftTeamsScheduledMaintenanceActions {

    private static async getOneUptimeUserAndProject(
        payload: HandleScheduledMaintenanceActionPayload
    ): Promise<{ oneUptimeUserId: ObjectID; projectId: ObjectID; teamsUserId: string } | null> {
        const teamsUserId: string | undefined = payload.request.body?.from?.id as string | undefined;
        const projectIdFromData: string | undefined = payload.data['projectId'] as string | undefined;

        if (!teamsUserId) {
            logger.error('MicrosoftTeamsScheduledMaintenanceActions: Teams User ID not found in request body (payload.request.body.from.id). Cannot link to OneUptime user.');
            return null;
        }

        if (!projectIdFromData || !ObjectID.isValid(projectIdFromData)) {
             logger.error(`MicrosoftTeamsScheduledMaintenanceActions: Project ID ${projectIdFromData} from action data is invalid or missing.`);
             return null;
        }
        
        const projectId: ObjectID = new ObjectID(projectIdFromData);

        try {
            const userAuthToken: WorkspaceUserAuthToken | null = await WorkspaceUserAuthTokenService.findOneBy({
                query: {
                    workspaceUserId: teamsUserId, 
                    workspaceType: WorkspaceType.MicrosoftTeams,
                    projectId: projectId,
                },
                select: {
                    userId: true,
                    projectId: true,
                },
                props: {
                    isRoot: true, 
                }
            });

            if (!userAuthToken || !userAuthToken.userId || !userAuthToken.projectId) {
                logger.info(`MicrosoftTeamsScheduledMaintenanceActions: No OneUptime user linked for Teams User ID: ${teamsUserId} in Project ID: ${projectId.toString()}. Will attempt to send unlinked user card.`);
                return null; 
            }
            
            logger.info(`MicrosoftTeamsScheduledMaintenanceActions: Found linked OneUptime User ID: ${userAuthToken.userId.toString()} for Teams User ID: ${teamsUserId} in Project ID: ${userAuthToken.projectId.toString()}`);
            return {
                oneUptimeUserId: userAuthToken.userId,
                projectId: userAuthToken.projectId, 
                teamsUserId: teamsUserId
            };

        } catch (error) {
            logger.error(`MicrosoftTeamsScheduledMaintenanceActions: Error finding WorkspaceUserAuthToken for Teams User ID ${teamsUserId}:`, error);
            return null;
        }
    }

    public static async handleScheduledMaintenanceAction(
        payload: HandleScheduledMaintenanceActionPayload
    ): Promise<void> {
        const { actionId, data, request, response } = payload; 

        logger.info(
            `MicrosoftTeamsScheduledMaintenanceActions: Received action. ActionName: ${actionId}, Data: ${JSON.stringify(
                data
            )}`
        );

        const scheduledMaintenanceIdString: string | undefined = data['scheduledMaintenanceId'] as string | undefined;
        
        if (!scheduledMaintenanceIdString || !ObjectID.isValid(scheduledMaintenanceIdString)) {
            logger.error('MicrosoftTeamsScheduledMaintenanceActions: Invalid or missing scheduledMaintenanceId in action data.');
            return;
        }
        const scheduledMaintenanceId: ObjectID = new ObjectID(scheduledMaintenanceIdString);
        
        let userAndProjectContext: { oneUptimeUserId: ObjectID; projectId: ObjectID; teamsUserId: string } | null = null;

        if (['markOngoing', 'markCompleted', 'addNote', 'changeState'].includes(actionId)) {
            userAndProjectContext = await this.getOneUptimeUserAndProject(payload);
            if (!userAndProjectContext) {
                logger.warn(`MicrosoftTeamsScheduledMaintenanceActions: User context not found for Teams User ID: ${request.body?.from?.id}. Action: ${actionId}. Sending unlinked user card.`);
                const projectIdFromData: string | undefined = payload.data['projectId'] as string | undefined;
                if (projectIdFromData && ObjectID.isValid(projectIdFromData)) {
                    const card: JSONObject = getUnlinkedUserCard(new ObjectID(projectIdFromData));
                    response.status(200).json(card); 
                } else {
                    logger.error("MicrosoftTeamsScheduledMaintenanceActions: Cannot send unlinked user card because projectId is missing or invalid in action data.");
                    response.status(200).send(); 
                }
                return;
            }
        } else {
            const projectIdFromData: string | undefined = data['projectId'] as string | undefined;
             if (!projectIdFromData || !ObjectID.isValid(projectIdFromData)) {
                logger.error(`MicrosoftTeamsScheduledMaintenanceActions: Action '${actionId}' requires a valid projectId in data, but it's missing or invalid, and user context was not required/fetched.`);
                return;
            }
             logger.info(`MicrosoftTeamsScheduledMaintenanceActions: Action '${actionId}' does not require specific user context or will use a generic/bot context. ProjectId from data: ${projectIdFromData}`);
        }


        switch (actionId) { 
            case 'markOngoing': 
                if (!userAndProjectContext) return; 
                logger.info(
                    `MicrosoftTeamsScheduledMaintenanceActions: Mark as Ongoing action received for SM ID: ${scheduledMaintenanceId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                try {
                    const props: DatabaseCommonInteractionProps = RequestUtil.getCommonInteractionProps(payload.request);
                    props.userId = userAndProjectContext.oneUptimeUserId;
                    props.projectId = userAndProjectContext.projectId;

                    const ongoingState: ScheduledMaintenanceState | null = await ScheduledMaintenanceStateService.findOneBy({
                        query: { 
                            projectId: userAndProjectContext.projectId, 
                            isOngoingState: true 
                        },
                        select: { _id: true },
                        props: { isRoot: true } 
                    });

                    if (!ongoingState || !ongoingState.id) {
                        logger.error(`MicrosoftTeamsScheduledMaintenanceActions: 'Ongoing' state not found for project ${userAndProjectContext.projectId.toString()}. Cannot change SM state.`);
                        // TODO: Send error feedback to Teams user (e.g. an error card or message)
                        return;
                    }

                    await ScheduledMaintenanceService.changeState(userAndProjectContext.projectId, scheduledMaintenanceId, ongoingState.id, userAndProjectContext.oneUptimeUserId, props);
                    logger.info(`MicrosoftTeamsScheduledMaintenanceActions: Scheduled Maintenance ${scheduledMaintenanceId.toString()} marked as Ongoing successfully.`);
                    // TODO: Send a confirmation message/card update back to Teams.
                } catch (err) {
                    logger.error(`MicrosoftTeamsScheduledMaintenanceActions: Error marking SM ${scheduledMaintenanceId.toString()} as Ongoing:`, err);
                    // TODO: Send an error message/card update back to Teams.
                }
                break;

            case 'markCompleted': 
                if (!userAndProjectContext) return; 
                logger.info(
                    `MicrosoftTeamsScheduledMaintenanceActions: Mark as Complete action received for SM ID: ${scheduledMaintenanceId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                try {
                    const props: DatabaseCommonInteractionProps = RequestUtil.getCommonInteractionProps(payload.request);
                    props.userId = userAndProjectContext.oneUptimeUserId;
                    props.projectId = userAndProjectContext.projectId;

                    const completedState: ScheduledMaintenanceState | null = await ScheduledMaintenanceStateService.findOneBy({
                        query: { 
                            projectId: userAndProjectContext.projectId, 
                            isCompletedState: true 
                        },
                        select: { _id: true },
                        props: { isRoot: true }
                    });

                    if (!completedState || !completedState.id) {
                        logger.error(`MicrosoftTeamsScheduledMaintenanceActions: 'Completed' state not found for project ${userAndProjectContext.projectId.toString()}. Cannot change SM state.`);
                        // TODO: Send error feedback to Teams user
                        return;
                    }
                    
                    await ScheduledMaintenanceService.changeState(userAndProjectContext.projectId, scheduledMaintenanceId, completedState.id, userAndProjectContext.oneUptimeUserId, props);
                    logger.info(`MicrosoftTeamsScheduledMaintenanceActions: Scheduled Maintenance ${scheduledMaintenanceId.toString()} marked as Completed successfully.`);
                    // TODO: Send a confirmation message/card update back to Teams.
                } catch (err) {
                    logger.error(`MicrosoftTeamsScheduledMaintenanceActions: Error marking SM ${scheduledMaintenanceId.toString()} as Completed:`, err);
                    // TODO: Send an error message/card update back to Teams.
                }
                break;
            
            case 'changeState': 
                if (!userAndProjectContext) return;
                logger.info(
                    `MicrosoftTeamsScheduledMaintenanceActions: Change State action received for SM ID: ${scheduledMaintenanceId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                // TODO: Implement logic to prompt user for the new SM state in Teams (e.g., using a dropdown in a modal) and then call ScheduledMaintenanceService.changeState(userAndProjectContext.projectId, scheduledMaintenanceId, newSMStateId, userAndProjectContext.oneUptimeUserId, props). For now, this action is a placeholder.
                break;

            case 'addNote': 
                if (!userAndProjectContext) return;
                 logger.info(
                    `MicrosoftTeamsScheduledMaintenanceActions: Add Note action received for SM ID: ${scheduledMaintenanceId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                // TODO: Implement logic to prompt user for note text in Teams (e.g., using a modal/Task Module) and then call ScheduledMaintenanceService.addNote(userAndProjectContext.projectId, scheduledMaintenanceId, noteText, userAndProjectContext.oneUptimeUserId, props). For now, this action is a placeholder.
                break;

            default:
                logger.error(
                    `MicrosoftTeamsScheduledMaintenanceActions: Unknown actionName received: ${actionId} for SM ID: ${scheduledMaintenanceId.toString()}`
                );
                break;
        }
    }
}

export default MicrosoftTeamsScheduledMaintenanceActions;
