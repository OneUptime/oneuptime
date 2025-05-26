import { JSONObject } from '../../../../../Types/JSON';
import { ExpressRequest, ExpressResponse } from '../../../Utils/Express'; 
import logger from '../../../Utils/Logger'; 
import ObjectID from '../../../../../Types/ObjectID'; 
import AlertService from '../../../../Services/AlertService';
import WorkspaceUserAuthTokenService from '../../../../Services/WorkspaceUserAuthTokenService';
import WorkspaceUserAuthToken from '../../../../../Models/DatabaseModels/WorkspaceUserAuthToken';
import WorkspaceType from '../../../../../Types/Workspace/WorkspaceType';
import RequestUtil from '../../../Utils/Request';
import { DatabaseCommonInteractionProps } from '../../../../../Types/Database/DatabaseCommonInteractionProps';
import getUnlinkedUserCard from '../Cards/UnlinkedUserCard'; // Import the new card utility

export interface HandleAlertActionPayload {
    actionId: string; // This is actionName like "acknowledge", "resolve"
    data: JSONObject; // Custom data from the Adaptive Card action, includes alertId, projectId, actionModule, actionName
    request: ExpressRequest; 
    response: ExpressResponse; 
}

export class MicrosoftTeamsAlertActions {

    private static async getOneUptimeUserAndProject(
        payload: HandleAlertActionPayload
    ): Promise<{ oneUptimeUserId: ObjectID; projectId: ObjectID; teamsUserId: string } | null> {
        const teamsUserId: string | undefined = payload.request.body?.from?.id as string | undefined;
        const projectIdFromData: string | undefined = payload.data['projectId'] as string | undefined;

        if (!teamsUserId) {
            logger.error('MicrosoftTeamsAlertActions: Teams User ID not found in request body (payload.request.body.from.id). Cannot link to OneUptime user.');
            return null;
        }

        if (!projectIdFromData || !ObjectID.isValid(projectIdFromData)) {
             logger.error(`MicrosoftTeamsAlertActions: Project ID ${projectIdFromData} from action data is invalid or missing.`);
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
                // Warning is now handled by the caller sending a card
                logger.info(`MicrosoftTeamsAlertActions: No OneUptime user linked for Teams User ID: ${teamsUserId} in Project ID: ${projectId.toString()}. Will attempt to send unlinked user card.`);
                return null; 
            }
            
            logger.info(`MicrosoftTeamsAlertActions: Found linked OneUptime User ID: ${userAuthToken.userId.toString()} for Teams User ID: ${teamsUserId} in Project ID: ${userAuthToken.projectId.toString()}`);
            return {
                oneUptimeUserId: userAuthToken.userId,
                projectId: userAuthToken.projectId, 
                teamsUserId: teamsUserId
            };

        } catch (error) {
            logger.error(`MicrosoftTeamsAlertActions: Error finding WorkspaceUserAuthToken for Teams User ID ${teamsUserId}:`, error);
            return null;
        }
    }


    public static async handleAlertAction(
        payload: HandleAlertActionPayload
    ): Promise<void> {
        const { actionId, data, request, response } = payload; 

        logger.info(
            `MicrosoftTeamsAlertActions: Received alert action. ActionName: ${actionId}, Data: ${JSON.stringify(
                data
            )}`
        );
        
        const alertIdString: string | undefined = data['alertId'] as string | undefined;
        
        if (!alertIdString || !ObjectID.isValid(alertIdString)) {
            logger.error('MicrosoftTeamsAlertActions: Invalid or missing alertId in action data.');
            // Optionally send a generic error card back to Teams if appropriate
            // response.status(200).json(getErrorCard("Invalid alert data provided."));
            return;
        }
        const alertId: ObjectID = new ObjectID(alertIdString);

        let userAndProjectContext: { oneUptimeUserId: ObjectID; projectId: ObjectID; teamsUserId: string } | null = null;

        if (['acknowledge', 'resolve', 'addNote', 'changeAlertState', 'executeOnCallPolicy'].includes(actionId)) {
            userAndProjectContext = await this.getOneUptimeUserAndProject(payload);
            if (!userAndProjectContext) {
                logger.warn(`MicrosoftTeamsAlertActions: User context not found for Teams User ID: ${request.body?.from?.id}. Action: ${actionId}. Sending unlinked user card.`);
                const projectIdFromData: string | undefined = payload.data['projectId'] as string | undefined;
                if (projectIdFromData && ObjectID.isValid(projectIdFromData)) {
                    const card: JSONObject = getUnlinkedUserCard(new ObjectID(projectIdFromData));
                    response.status(200).json(card); // Send card to refresh the current one
                } else {
                    logger.error("MicrosoftTeamsAlertActions: Cannot send unlinked user card because projectId is missing or invalid in action data.");
                    // Send a generic error or do nothing, as we can't form the settings URL
                     response.status(200).send(); // Acknowledge the invoke if no card can be sent
                }
                return;
            }
        } else {
            const projectIdFromData: string | undefined = data['projectId'] as string | undefined;
             if (!projectIdFromData || !ObjectID.isValid(projectIdFromData)) {
                logger.error(`MicrosoftTeamsAlertActions: Action '${actionId}' requires a valid projectId in data, but it's missing or invalid.`);
                return;
            }
             logger.info(`MicrosoftTeamsAlertActions: Action '${actionId}' does not require specific user context or will use a generic/bot context. ProjectId from data: ${projectIdFromData}`);
        }


        switch (actionId) { 
            case 'acknowledge':
                if (!userAndProjectContext) return;  // Should be caught by the check above, but as a safeguard.
                logger.info(
                    `MicrosoftTeamsAlertActions: Acknowledge action received for alertId: ${alertId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                try {
                    const props: DatabaseCommonInteractionProps = RequestUtil.getCommonInteractionProps(payload.request);
                    props.userId = userAndProjectContext.oneUptimeUserId;
                    props.projectId = userAndProjectContext.projectId;
                    await AlertService.acknowledgeAlert(userAndProjectContext.projectId, alertId, userAndProjectContext.oneUptimeUserId, props);
                    logger.info(`MicrosoftTeamsAlertActions: Alert ${alertId.toString()} acknowledged successfully.`);
                    // TODO: Send a success confirmation card/message back to Teams.
                    // Example: response.status(200).json(getSuccessCard("Alert Acknowledged", `Alert ${alertId} has been acknowledged.`));
                } catch (err) {
                    logger.error(`MicrosoftTeamsAlertActions: Error acknowledging alert ${alertId.toString()}:`, err);
                    // TODO: Send an error message/card update back to Teams.
                    // Example: response.status(200).json(getErrorCard("Acknowledgement Failed", `Failed to acknowledge alert ${alertId}.`));
                }
                break;

            case 'resolve': 
                if (!userAndProjectContext) return; 
                logger.info(
                    `MicrosoftTeamsAlertActions: Resolve action received for alertId: ${alertId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                 try {
                    const props: DatabaseCommonInteractionProps = RequestUtil.getCommonInteractionProps(payload.request);
                    props.userId = userAndProjectContext.oneUptimeUserId;
                    props.projectId = userAndProjectContext.projectId;
                    await AlertService.resolveAlert(userAndProjectContext.projectId, alertId, userAndProjectContext.oneUptimeUserId, props);
                    logger.info(`MicrosoftTeamsAlertActions: Alert ${alertId.toString()} resolved successfully.`);
                    // TODO: Send a success confirmation card/message back to Teams.
                } catch (err) {
                    logger.error(`MicrosoftTeamsAlertActions: Error resolving alert ${alertId.toString()}:`, err);
                    // TODO: Send an error message/card update back to Teams.
                }
                break;

            case 'executeOnCallPolicy': 
                if (!userAndProjectContext) return; 
                logger.info(
                    `MicrosoftTeamsAlertActions: Execute On Call Policy action received for alertId: ${alertId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                // TODO: This action likely needs to list available on-call policies for the alert/project and allow the user to select one to execute in Teams. Then call OnCallDutyPolicyExecutionLogService or similar. For now, this action is a placeholder.
                break;
            
            case 'changeAlertState': 
                if (!userAndProjectContext) return; 
                logger.info(
                    `MicrosoftTeamsAlertActions: Change Alert State action received for alertId: ${alertId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                // TODO: Implement logic to prompt user for the new alert state in Teams (e.g., using a dropdown in a modal) and then call AlertService.changeState(projectId, alertId, newAlertStateId, oneUptimeUserId, props). For now, this action is a placeholder.
                break;

            case 'addNote': 
                if (!userAndProjectContext) return; 
                logger.info(
                    `MicrosoftTeamsAlertActions: Add Note action received for alertId: ${alertId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                // TODO: Implement logic to prompt user for note text in Teams (e.g., using a modal/Task Module) and then call AlertService.addNote(projectId, alertId, noteText, oneUptimeUserId, props). For now, this action is a placeholder.
                break;

            default:
                logger.error(
                    `MicrosoftTeamsAlertActions: Unknown alert actionName received: ${actionId} for alertId: ${alertId.toString()}`
                );
                break;
        }
    }
}

export default MicrosoftTeamsAlertActions;
