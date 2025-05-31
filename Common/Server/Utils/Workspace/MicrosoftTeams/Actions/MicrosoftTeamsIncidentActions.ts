import { JSONObject } from '../../../../../Types/JSON';
import { ExpressRequest, ExpressResponse } from '../../../Utils/Express'; 
import logger from '../../../Utils/Logger'; 
// MicrosoftTeamsActionType might still be used for reference or if some actions are still passed with full enum string
// import MicrosoftTeamsActionType from './ActionTypes'; 
import ObjectID from '../../../../../Types/ObjectID'; 
import IncidentService from '../../../../Services/IncidentService';
import WorkspaceUserAuthTokenService from '../../../../Services/WorkspaceUserAuthTokenService';
import WorkspaceUserAuthToken from '../../../../../Models/DatabaseModels/WorkspaceUserAuthToken';
import WorkspaceType from '../../../../../Types/Workspace/WorkspaceType';
import RequestUtil from '../../../Utils/Request';
import { DatabaseCommonInteractionProps } from '../../../../../Types/Database/DatabaseCommonInteractionProps';
import getUnlinkedUserCard from '../Cards/UnlinkedUserCard'; // Import the new card utility

export interface HandleIncidentActionPayload {
    actionId: string; // This is now actionName like "acknowledge", "resolve"
    data: JSONObject; // Custom data from the Adaptive Card action, includes incidentId, projectId, actionModule, actionName
    request: ExpressRequest; 
    response: ExpressResponse; 
}

export class MicrosoftTeamsIncidentActions {

    private static async getOneUptimeUserAndProject(
        payload: HandleIncidentActionPayload
    ): Promise<{ oneUptimeUserId: ObjectID; projectId: ObjectID; teamsUserId: string } | null> {
        const teamsUserId: string | undefined = payload.request.body?.from?.id as string | undefined;
        const projectIdFromData: string | undefined = payload.data['projectId'] as string | undefined;

        if (!teamsUserId) {
            logger.error('MicrosoftTeamsIncidentActions: Teams User ID not found in request body (payload.request.body.from.id). Cannot link to OneUptime user.');
            return null;
        }

        if (!projectIdFromData || !ObjectID.isValid(projectIdFromData)) {
             logger.error(`MicrosoftTeamsIncidentActions: Project ID ${projectIdFromData} from action data is invalid or missing.`);
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
                logger.info(`MicrosoftTeamsIncidentActions: No OneUptime user linked for Teams User ID: ${teamsUserId} in Project ID: ${projectId.toString()}. Will attempt to send unlinked user card.`);
                return null; 
            }
            
            logger.info(`MicrosoftTeamsIncidentActions: Found linked OneUptime User ID: ${userAuthToken.userId.toString()} for Teams User ID: ${teamsUserId} in Project ID: ${userAuthToken.projectId.toString()}`);
            return {
                oneUptimeUserId: userAuthToken.userId,
                projectId: userAuthToken.projectId, 
                teamsUserId: teamsUserId
            };

        } catch (error) {
            logger.error(`MicrosoftTeamsIncidentActions: Error finding WorkspaceUserAuthToken for Teams User ID ${teamsUserId}:`, error);
            return null;
        }
    }

    public static async handleIncidentAction(
        payload: HandleIncidentActionPayload
    ): Promise<void> {
        const { actionId, data, request, response } = payload; 

        logger.info(
            `MicrosoftTeamsIncidentActions: Received incident action. ActionName: ${actionId}, Data: ${JSON.stringify(
                data
            )}`
        );

        const incidentIdString: string | undefined = data['incidentId'] as string | undefined;
        
        if (!incidentIdString || !ObjectID.isValid(incidentIdString)) {
            logger.error('MicrosoftTeamsIncidentActions: Invalid or missing incidentId in action data.');
            return;
        }
        const incidentId: ObjectID = new ObjectID(incidentIdString);
        
        let userAndProjectContext: { oneUptimeUserId: ObjectID; projectId: ObjectID; teamsUserId: string } | null = null;

        if (['acknowledge', 'resolve', 'addNote', 'changeIncidentState', 'executeOnCallPolicy'].includes(actionId)) {
            userAndProjectContext = await this.getOneUptimeUserAndProject(payload);
            if (!userAndProjectContext) {
                logger.warn(`MicrosoftTeamsIncidentActions: User context not found for Teams User ID: ${request.body?.from?.id}. Action: ${actionId}. Sending unlinked user card.`);
                const projectIdFromData: string | undefined = payload.data['projectId'] as string | undefined;
                if (projectIdFromData && ObjectID.isValid(projectIdFromData)) {
                    const card: JSONObject = getUnlinkedUserCard(new ObjectID(projectIdFromData));
                    response.status(200).json(card); 
                } else {
                    logger.error("MicrosoftTeamsIncidentActions: Cannot send unlinked user card because projectId is missing or invalid in action data.");
                    response.status(200).send(); 
                }
                return;
            }
        } else {
            const projectIdFromData: string | undefined = data['projectId'] as string | undefined;
             if (!projectIdFromData || !ObjectID.isValid(projectIdFromData)) {
                logger.error(`MicrosoftTeamsIncidentActions: Action '${actionId}' requires a valid projectId in data, but it's missing or invalid.`);
                return;
            }
             logger.info(`MicrosoftTeamsIncidentActions: Action '${actionId}' does not require specific user context or will use a generic/bot context. ProjectId from data: ${projectIdFromData}`);
        }


        switch (actionId) { 
            case 'acknowledge': 
                if (!userAndProjectContext) return; 
                logger.info(
                    `MicrosoftTeamsIncidentActions: Acknowledge action received for incidentId: ${incidentId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                try {
                    const props: DatabaseCommonInteractionProps = RequestUtil.getCommonInteractionProps(payload.request);
                    props.userId = userAndProjectContext.oneUptimeUserId;
                    props.projectId = userAndProjectContext.projectId;
                    await IncidentService.acknowledgeIncident(userAndProjectContext.projectId, incidentId, userAndProjectContext.oneUptimeUserId, props);
                    logger.info(`MicrosoftTeamsIncidentActions: Incident ${incidentId.toString()} acknowledged successfully.`);
                    // TODO: Send a success confirmation card/message back to Teams.
                } catch (err) {
                    logger.error(`MicrosoftTeamsIncidentActions: Error acknowledging incident ${incidentId.toString()}:`, err);
                    // TODO: Send an error message/card update back to Teams.
                }
                break;

            case 'resolve': 
                if (!userAndProjectContext) return; 
                logger.info(
                    `MicrosoftTeamsIncidentActions: Resolve action received for incidentId: ${incidentId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                 try {
                    const props: DatabaseCommonInteractionProps = RequestUtil.getCommonInteractionProps(payload.request);
                    props.userId = userAndProjectContext.oneUptimeUserId;
                    props.projectId = userAndProjectContext.projectId;
                    await IncidentService.resolveIncident(userAndProjectContext.projectId, incidentId, userAndProjectContext.oneUptimeUserId, props);
                    logger.info(`MicrosoftTeamsIncidentActions: Incident ${incidentId.toString()} resolved successfully.`);
                    // TODO: Send a success confirmation card/message back to Teams.
                } catch (err) {
                    logger.error(`MicrosoftTeamsIncidentActions: Error resolving incident ${incidentId.toString()}:`, err);
                    // TODO: Send an error message/card update back to Teams.
                }
                break;
            
            case 'executeOnCallPolicy': 
                if (!userAndProjectContext) return;
                logger.info(
                    `MicrosoftTeamsIncidentActions: Execute On Call Policy action received for incidentId: ${incidentId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                const propsForOnCall: DatabaseCommonInteractionProps = RequestUtil.getCommonInteractionProps(payload.request);
                propsForOnCall.userId = userAndProjectContext.oneUptimeUserId;
                propsForOnCall.projectId = userAndProjectContext.projectId;
                // TODO: This action likely needs to list available on-call policies for the incident/project and allow the user to select one to execute in Teams. Then call OnCallDutyPolicyExecutionLogService or similar, associating with userAndProjectContext.oneUptimeUserId and userAndProjectContext.projectId. For now, this action is a placeholder.
                break;

            case 'changeIncidentState': 
                if (!userAndProjectContext) return;
                 logger.info(
                    `MicrosoftTeamsIncidentActions: Change Incident State action received for incidentId: ${incidentId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                const propsForStateChange: DatabaseCommonInteractionProps = RequestUtil.getCommonInteractionProps(payload.request);
                propsForStateChange.userId = userAndProjectContext.oneUptimeUserId;
                propsForStateChange.projectId = userAndProjectContext.projectId;
                // TODO: Implement logic to prompt user for the new incident state in Teams (e.g., using a dropdown in a modal) and then call IncidentService.changeState(userAndProjectContext.projectId, incidentId, newIncidentStateId, userAndProjectContext.oneUptimeUserId, props). For now, this action is a placeholder.
                break;

            case 'addNote': 
                if (!userAndProjectContext) return;
                 logger.info(
                    `MicrosoftTeamsIncidentActions: Add Note action received for incidentId: ${incidentId.toString()}, projectId: ${userAndProjectContext.projectId.toString()} by User: ${userAndProjectContext.oneUptimeUserId.toString()}`
                );
                const propsForNote: DatabaseCommonInteractionProps = RequestUtil.getCommonInteractionProps(payload.request);
                propsForNote.userId = userAndProjectContext.oneUptimeUserId;
                propsForNote.projectId = userAndProjectContext.projectId;
                // TODO: Implement logic to prompt user for note text in Teams (e.g., using a modal/Task Module) and then call IncidentService.addNote(userAndProjectContext.projectId, incidentId, noteText, userAndProjectContext.oneUptimeUserId, props). For now, this action is a placeholder.
                break;

            default:
                logger.error(
                    `MicrosoftTeamsIncidentActions: Unknown incident actionName received: ${actionId} for incidentId: ${incidentId.toString()}`
                );
                break;
        }
    }
}

export default MicrosoftTeamsIncidentActions;
