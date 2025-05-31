import { JSONObject } from '../../../../../Types/JSON';
import { ExpressRequest, ExpressResponse } from '../../../Utils/Express'; // Adjusted path
import logger from '../../../Utils/Logger'; // Adjusted path
import MicrosoftTeamsActionType from './ActionTypes';
import ObjectID from '../../../../../Types/ObjectID';

export interface HandleOnCallDutyActionPayload {
    actionId: string;
    data: JSONObject; // e.g., { projectId: "...", onCallPolicyId: "...", onCallDutyExecutionLogId: "..." }
    request: ExpressRequest; 
    response: ExpressResponse; 
}

export class MicrosoftTeamsOnCallDutyActions {
    public static async handleOnCallDutyAction(
        payload: HandleOnCallDutyActionPayload
    ): Promise<void> {
        const { actionId, data, request } = payload;

        logger.info(
            `MicrosoftTeamsOnCallDutyActions: Received action. Action ID: ${actionId}, Data: ${JSON.stringify(
                data
            )}`
        );

        const projectIdString: string | undefined = data['projectId'] as string | undefined;
        const onCallPolicyIdString: string | undefined = data['onCallPolicyId'] as string | undefined;
        const onCallDutyExecutionLogIdString: string | undefined = data['onCallDutyExecutionLogId'] as string | undefined;

        let projectId: ObjectID | null = null;
        let onCallPolicyId: ObjectID | null = null;
        // let onCallDutyExecutionLogId: ObjectID | null = null; // Not used in switch, but extracted for completeness

        if (projectIdString && ObjectID.isValid(projectIdString)) {
            projectId = new ObjectID(projectIdString);
        } else {
            // For some actions, projectId might not be strictly required if the action itself is global or identifiable by other means.
            // However, most on-call actions would be project-specific.
            logger.warn(`MicrosoftTeamsOnCallDutyActions: Invalid or missing projectId in action data for actionId: ${actionId}.`);
        }

        if (onCallPolicyIdString && ObjectID.isValid(onCallPolicyIdString)) {
            onCallPolicyId = new ObjectID(onCallPolicyIdString);
        }
        
        // if (onCallDutyExecutionLogIdString && ObjectID.isValid(onCallDutyExecutionLogIdString)) {
        //     onCallDutyExecutionLogId = new ObjectID(onCallDutyExecutionLogIdString);
        // }


        // Placeholder for extracting OneUptime User ID (updatedByUserId).
        // const teamsUserAadObjectId: string | undefined = (request as any).botIdentity?.oid; 
        // let oneUptimeUserId: ObjectID | null = null;
        // if (teamsUserAadObjectId && projectId) { // Assuming projectId is needed for mapping
        //    // oneUptimeUserId = await mapTeamsUserToLocalUser(teamsUserAadObjectId, projectId); 
        //    if(!oneUptimeUserId){
        //        logger.error(`MicrosoftTeamsOnCallDutyActions: Could not map Teams User ${teamsUserAadObjectId} to OneUptime User ID for project ${projectId.toString()}.`);
        //    }
        // } else if (teamsUserAadObjectId) {
        //     logger.warn(`MicrosoftTeamsOnCallDutyActions: ProjectId is missing, cannot map Teams user without it for action ${actionId}.`);
        // }


        switch (actionId) {
            // Example of a hypothetical future Action.Execute for on-call duties
            case 'acknowledgeOnCallNotification': // This is a made-up action for example
                logger.info(
                    `MicrosoftTeamsOnCallDutyActions: Acknowledge On-Call Notification action received for projectId: ${projectId?.toString()}, policyId: ${onCallPolicyId?.toString()}`
                );
                // TODO: Implement this action. For example, update a notification status.
                // if (projectId && onCallDutyExecutionLogId && oneUptimeUserId) {
                //    await OnCallDutyExecutionLogService.acknowledgeNotification(projectId, onCallDutyExecutionLogId, oneUptimeUserId);
                // } else {
                //    logger.error("Missing necessary data (projectId, onCallDutyExecutionLogId, or mapped oneUptimeUserId) to acknowledge on-call notification.");
                // }
                break;

            // ViewOnCallSchedule is Action.OpenUrl, so it won't be handled here.
            // This switch is for Action.Execute types.
            default:
                if (actionId === MicrosoftTeamsActionType.ViewOnCallSchedule) {
                     logger.info(
                        `MicrosoftTeamsOnCallDutyActions: Received actionId '${actionId}', which is typically an Action.OpenUrl and handled by the Teams client, not via Action.Execute backend processing.`
                    );
                } else {
                    logger.error(
                        `MicrosoftTeamsOnCallDutyActions: Unknown or unhandled on-call duty action ID received: ${actionId}`
                    );
                }
                break;
        }
    }
}

export default MicrosoftTeamsOnCallDutyActions;
