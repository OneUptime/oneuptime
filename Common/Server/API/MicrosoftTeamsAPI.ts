import express, { Router, Response, Request } from 'express';
import { BadDataException } from '../Types/Exception/BadDataException'; // Existing
import { URL } from 'url'; // Existing
import API from './API'; // Existing
import { WorkspaceProjectAuthTokenService } from '../Services/WorkspaceProjectAuthTokenService'; // Existing
import { WorkspaceUserAuthTokenService } from '../Services/WorkspaceUserAuthTokenService'; // Existing
import { ObjectID } from 'bson'; // Existing
import { WorkspaceType } from '../Types/WorkspaceType'; // Existing
import {
    MSAL_CLIENT_ID,
    MSAL_CLIENT_SECRET,
    DASHBOARD_CLIENT_URL,
    APP_API_CLIENT_URL,
} from '../Config'; // Existing

// For making HTTP requests
import axios from 'axios'; // Existing

// Additional imports
import OneUptimeDate from '../Types/Date'; 
import logger from '../Utils/Logger'; 
import { JSONObject } from '../Types/JSON'; 

// Middleware
import { MicrosoftTeamsAuthorization } from '../Middleware/MicrosoftTeamsAuthorization';

// Action Handlers
import MicrosoftTeamsAlertActions, { HandleAlertActionPayload } from '../Utils/Workspace/MicrosoftTeams/Actions/MicrosoftTeamsAlertActions';
import MicrosoftTeamsIncidentActions, { HandleIncidentActionPayload } from '../Utils/Workspace/MicrosoftTeams/Actions/MicrosoftTeamsIncidentActions';
import MicrosoftTeamsScheduledMaintenanceActions, { HandleScheduledMaintenanceActionPayload } from '../Utils/Workspace/MicrosoftTeams/Actions/MicrosoftTeamsScheduledMaintenanceActions';
import MicrosoftTeamsOnCallDutyActions, { HandleOnCallDutyActionPayload } from '../Utils/Workspace/MicrosoftTeams/Actions/MicrosoftTeamsOnCallDutyActions';
// MicrosoftTeamsActionType is not directly used in the dispatcher with the new logic, but handlers might still use it.
// import MicrosoftTeamsActionType from '../Utils/Workspace/MicrosoftTeams/Actions/ActionTypes'; 

// Action Handler Registry
const actionHandlers: { [key: string]: any } = {
    "alert": MicrosoftTeamsAlertActions,
    "incident": MicrosoftTeamsIncidentActions,
    "scheduledMaintenance": MicrosoftTeamsScheduledMaintenanceActions,
    "onCallDuty": MicrosoftTeamsOnCallDutyActions,
};

export class MicrosoftTeamsAPI extends API {
    public constructor() {
        super(APP_API_CLIENT_URL); 
    }

    private static decodeJwtPayload(token: string): JSONObject | null {
        try {
            const base64Url: string = token.split('.')[1] as string;
            if (!base64Url) {
                return null;
            }
            const base64: string = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload: string = decodeURIComponent(
                Buffer.from(base64, 'base64')
                    .toString()
                    .split('')
                    .map((c: string) => {
                        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                    })
                    .join('')
            );
            return JSON.parse(jsonPayload) as JSONObject;
        } catch (e) {
            logger.error('Error decoding JWT payload:', e);
            return null;
        }
    }

    public override getRouter(): Router {
        const router: Router = express.Router();
        const dashboardClientUrl: URL = new URL(DASHBOARD_CLIENT_URL.toString());

        router.get('/msteams/auth/:projectId/:userId', async (req: Request, res: Response) => {
            const { projectId, userId } = req.params; 
            const { code, error, error_description, state, admin_consent } = req.query;

            const tokenExchangeRedirectUri: string = `${APP_API_CLIENT_URL.toString()}/msteams/auth/${projectId}/${userId}`;
            const finalRedirectUrl: URL = new URL(`${dashboardClientUrl.toString()}/${projectId}/settings/msteams-integration`);

            if (!MSAL_CLIENT_ID || !MSAL_CLIENT_SECRET) {
                logger.error('MSAL_CLIENT_ID or MSAL_CLIENT_SECRET is not configured for Teams Integration.');
                finalRedirectUrl.searchParams.set('status', 'error_config_missing');
                return res.redirect(finalRedirectUrl.toString());
            }

            if (error) {
                logger.error(`Microsoft Teams Auth Error (Project/Bot): ${error} - ${error_description}`);
                finalRedirectUrl.searchParams.set('status', `error_ms_auth_${error}`);
                if (error_description) {
                    finalRedirectUrl.searchParams.set('error_message', error_description as string);
                }
                return res.redirect(finalRedirectUrl.toString());
            }
            
            if (admin_consent !== 'True') {
                logger.error('Microsoft Teams Auth Error (Project/Bot): Admin consent not granted.');
                finalRedirectUrl.searchParams.set('status', 'error_admin_consent_required');
                finalRedirectUrl.searchParams.set('error_message', 'Admin consent is required for project-level (bot) integration.');
                return res.redirect(finalRedirectUrl.toString());
            }

            if (!code) {
                logger.error('No authorization code provided by Microsoft for project/bot auth.');
                finalRedirectUrl.searchParams.set('status', 'error_ms_auth_no_code');
                return res.redirect(finalRedirectUrl.toString());
            }

            const tokenRequestBody: URLSearchParams = new URLSearchParams();
            tokenRequestBody.append('client_id', MSAL_CLIENT_ID.toString());
            tokenRequestBody.append('scope', 'https://graph.microsoft.com/.default'); 
            tokenRequestBody.append('code', code as string);
            tokenRequestBody.append('redirect_uri', tokenExchangeRedirectUri);
            tokenRequestBody.append('grant_type', 'authorization_code');
            tokenRequestBody.append('client_secret', MSAL_CLIENT_SECRET.toString());

            logger.info('Microsoft Teams Token Request Body (Project/Bot):', tokenRequestBody.toString().replace(MSAL_CLIENT_SECRET.toString(), '********'));

            try {
                const response = await axios.post(
                    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
                    tokenRequestBody,
                    {
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                    }
                );

                const responseData: JSONObject = response.data as JSONObject;
                logger.info('Microsoft Teams Token Response (Project/Bot):', responseData);

                const accessToken: string = responseData['access_token'] as string;
                const refreshToken: string = responseData['refresh_token'] as string;
                const expiresIn: number = responseData['expires_in'] as number; 
                const tokenScope: string = responseData['scope'] as string;

                if (!accessToken) {
                    throw new BadDataException('Access token not found in Microsoft response.');
                }

                const decodedToken: JSONObject | null = MicrosoftTeamsAPI.decodeJwtPayload(accessToken);
                if (!decodedToken) {
                    throw new BadDataException('Failed to decode access token.');
                }

                const tenantId: string = decodedToken['tid'] as string; 
                const botObjectId: string = decodedToken['oid'] as string; 

                if(!tenantId){
                    throw new BadDataException('Tenant ID (tid) not found in access token.');
                }
                 if(!botObjectId){
                    throw new BadDataException('Bot Object ID (oid) not found in access token.');
                }

                const tokenExpiresAt: Date = OneUptimeDate.getNSecondsLater(expiresIn);
                
                await WorkspaceProjectAuthTokenService.refreshAuthToken({
                    projectId: new ObjectID(projectId),
                    workspaceType: WorkspaceType.MicrosoftTeams,
                    authToken: accessToken,
                    refreshToken: refreshToken,
                    tokenExpiresAt: tokenExpiresAt,
                    workspaceProjectId: tenantId, 
                    miscData: {
                        tenantId: tenantId,
                        botAppId: MSAL_CLIENT_ID.toString(), 
                        botObjectId: botObjectId, 
                        tokenScope: tokenScope,
                        oneUptimeUserIdInitiated: new ObjectID(userId) 
                    },
                });

                finalRedirectUrl.searchParams.set('status', 'success_project_auth');
                return res.redirect(finalRedirectUrl.toString());

            } catch (e: any) {
                logger.error('Error exchanging code for token or storing token (Project/Bot):', e);
                const errorMessage: string = e.response?.data?.error_description || e.message || 'token_exchange_failed';
                finalRedirectUrl.searchParams.set('status', 'error_token_exchange');
                finalRedirectUrl.searchParams.set('error_message', encodeURIComponent(errorMessage));
                return res.redirect(finalRedirectUrl.toString());
            }
        });

        router.get('/msteams/auth/:projectId/:userId/user', async (req: Request, res: Response) => {
            const { projectId, userId: oneUptimeUserId } = req.params; 
            const { code, error, error_description, state } = req.query;
            
            const tokenExchangeRedirectUriUser: string = `${APP_API_CLIENT_URL.toString()}/msteams/auth/${projectId}/${oneUptimeUserId}/user`;
            const finalRedirectUrl: URL = new URL(`${dashboardClientUrl.toString()}/${projectId}/settings/msteams-integration`);
            finalRedirectUrl.searchParams.set('userId', oneUptimeUserId); 

            if (!MSAL_CLIENT_ID || !MSAL_CLIENT_SECRET) {
                logger.error('MSAL_CLIENT_ID or MSAL_CLIENT_SECRET is not configured for Teams User Integration.');
                finalRedirectUrl.searchParams.set('status', 'error_config_missing');
                return res.redirect(finalRedirectUrl.toString());
            }

            if (error) {
                logger.error(`Microsoft Teams Auth Error (User): ${error} - ${error_description}`);
                finalRedirectUrl.searchParams.set('status', `error_ms_auth_${error}`);
                 if (error_description) {
                    finalRedirectUrl.searchParams.set('error_message', error_description as string);
                }
                return res.redirect(finalRedirectUrl.toString());
            }

            if (!code) {
                logger.error('No authorization code provided by Microsoft for user auth.');
                finalRedirectUrl.searchParams.set('status', 'error_ms_auth_no_code');
                return res.redirect(finalRedirectUrl.toString());
            }

            const tokenRequestBody: URLSearchParams = new URLSearchParams();
            tokenRequestBody.append('client_id', MSAL_CLIENT_ID.toString());
            tokenRequestBody.append('scope', 'User.Read Chat.ReadWrite offline_access openid profile email'); 
            tokenRequestBody.append('code', code as string);
            tokenRequestBody.append('redirect_uri', tokenExchangeRedirectUriUser);
            tokenRequestBody.append('grant_type', 'authorization_code');
            tokenRequestBody.append('client_secret', MSAL_CLIENT_SECRET.toString());

            logger.info('Microsoft Teams Token Request Body (User):', tokenRequestBody.toString().replace(MSAL_CLIENT_SECRET.toString(), '********'));

            try {
                const response = await axios.post(
                    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
                    tokenRequestBody,
                    {
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                    }
                );

                const responseData: JSONObject = response.data as JSONObject;
                logger.info('Microsoft Teams Token Response (User):', responseData);

                const accessToken: string = responseData['access_token'] as string;
                const refreshToken: string = responseData['refresh_token'] as string;
                const expiresIn: number = responseData['expires_in'] as number; 
                const tokenScope: string = responseData['scope'] as string;
                const idToken: string = responseData['id_token'] as string; 

                if (!accessToken || !idToken) {
                    throw new BadDataException('Access token or ID token not found in Microsoft response.');
                }

                const decodedIdToken: JSONObject | null = MicrosoftTeamsAPI.decodeJwtPayload(idToken);
                if (!decodedIdToken) {
                    throw new BadDataException('Failed to decode ID token.');
                }

                const teamsUserId: string = decodedIdToken['oid'] as string; 
                const teamsTenantId: string = decodedIdToken['tid'] as string; 
                const teamsUserEmail: string = (decodedIdToken['email'] || decodedIdToken['preferred_username']) as string;
                const teamsUserName: string = decodedIdToken['name'] as string;

                if(!teamsUserId || !teamsTenantId || !teamsUserEmail){
                     throw new BadDataException('Essential user information (oid, tid, email/preferred_username) not found in ID token.');
                }

                const tokenExpiresAt: Date = OneUptimeDate.getNSecondsLater(expiresIn);

                await WorkspaceUserAuthTokenService.refreshAuthToken({
                    projectId: new ObjectID(projectId),
                    userId: new ObjectID(oneUptimeUserId), 
                    workspaceType: WorkspaceType.MicrosoftTeams,
                    authToken: accessToken,
                    refreshToken: refreshToken,
                    tokenExpiresAt: tokenExpiresAt,
                    workspaceUserId: teamsUserId, 
                    miscData: {
                        teamsUserId: teamsUserId,
                        teamsTenantId: teamsTenantId,
                        teamsUserEmail: teamsUserEmail,
                        teamsUserName: teamsUserName,
                        tokenScope: tokenScope,
                        idToken: idToken, 
                    },
                });
                
                finalRedirectUrl.searchParams.set('status', 'success_user_auth');
                return res.redirect(finalRedirectUrl.toString());

            } catch (e: any) {
                logger.error('Error exchanging code for token or storing token (User):', e);
                const errorMessage: string = e.response?.data?.error_description || e.message || 'token_exchange_failed_user';
                finalRedirectUrl.searchParams.set('status', 'error_token_exchange_user');
                finalRedirectUrl.searchParams.set('error_message', encodeURIComponent(errorMessage));
                return res.redirect(finalRedirectUrl.toString());
            }
        });

        router.post('/msteams/events', 
            MicrosoftTeamsAuthorization.isAuthorizedTeamsRequest, 
            async (req: Request, res: Response) => {
            
            logger.info('Teams Event Received:', req.body);
            const activity: JSONObject = req.body;

            if (activity && activity['type'] === 'invoke' && activity['name'] === 'adaptiveCard/action') {
                // const actionIdFromCard: string | undefined = activity['value']?.['action']?.['id'] as string | undefined; // Original ID from card
                const actionData: JSONObject | undefined = activity['value']?.['action']?.['data'] as JSONObject | undefined;
                
                const actionModule: string | undefined = actionData?.['actionModule'] as string | undefined;
                const actionName: string | undefined = actionData?.['actionName'] as string | undefined;

                if (actionModule && actionName && actionData) {
                    logger.info(`Adaptive Card action received. Module: ${actionModule}, ActionName: ${actionName}, Data: ${JSON.stringify(actionData)}`);
                    
                    const handlerClass: any = actionHandlers[actionModule];

                    if (handlerClass) {
                        try {
                            if (actionModule === 'alert' && typeof handlerClass.handleAlertAction === 'function') {
                                const payload: HandleAlertActionPayload = { actionId: actionName, data: actionData, request: req, response: res };
                                await handlerClass.handleAlertAction(payload);
                            } else if (actionModule === 'incident' && typeof handlerClass.handleIncidentAction === 'function') {
                                const payload: HandleIncidentActionPayload = { actionId: actionName, data: actionData, request: req, response: res };
                                await handlerClass.handleIncidentAction(payload);
                            } else if (actionModule === 'scheduledMaintenance' && typeof handlerClass.handleScheduledMaintenanceAction === 'function') {
                                const payload: HandleScheduledMaintenanceActionPayload = { actionId: actionName, data: actionData, request: req, response: res };
                                await handlerClass.handleScheduledMaintenanceAction(payload);
                            } else if (actionModule === 'onCallDuty' && typeof handlerClass.handleOnCallDutyAction === 'function') {
                                const payload: HandleOnCallDutyActionPayload = { actionId: actionName, data: actionData, request: req, response: res };
                                await handlerClass.handleOnCallDutyAction(payload);
                            } else {
                                logger.error(`Handler method not found in class for module: ${actionModule}. Expected a method like 'handle${actionModule.charAt(0).toUpperCase() + actionModule.slice(1)}Action' or the specific existing method.`);
                            }
                        } catch (e: any) {
                            logger.error(`Error handling action for module ${actionModule}, action name ${actionName}:`, e);
                        }
                    } else {
                        logger.warn(`No handler found for actionModule: ${actionModule}`);
                    }
                } else {
                    logger.error('Received Adaptive Card invoke action, but actionModule, actionName, or actionData is missing from the data payload.');
                }
            } else {
                 logger.info('Received non-adaptive card invoke event or other activity type. No specific handler implemented beyond this point.');
            }

            if (!res.headersSent) {
                res.status(200).send();
            }
        });

        return router;
    }
}
