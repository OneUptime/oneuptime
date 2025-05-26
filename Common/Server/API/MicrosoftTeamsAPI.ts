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
    // Assuming these might be needed based on snippet context, add if they exist in Config
    // ONEUPTIME_URL 
} from '../Config'; // Existing

// For making HTTP requests
import axios from 'axios'; // Existing

// Additional imports from snippets
import OneUptimeDate from '../Types/Date'; // From snippets
import logger from '../Utils/Logger'; // From snippets
import { JSONObject } from '../Types/JSON'; // From snippets

// Import the new middleware
import { MicrosoftTeamsAuthorization } from '../Middleware/MicrosoftTeamsAuthorization';

// Import the new Action Handler
import MicrosoftTeamsAlertActions, { HandleAlertActionPayload } from '../Utils/Workspace/MicrosoftTeams/Actions/MicrosoftTeamsAlertActions';


export class MicrosoftTeamsAPI extends API {
    public constructor() {
        super(APP_API_CLIENT_URL); 
    }

    // Helper function from snippets - placing as private static method
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

        // Endpoint for Project-level Bot Authentication (Application Permissions)
        router.get('/msteams/auth/:projectId/:userId', async (req: Request, res: Response) => {
            const { projectId, userId } = req.params; // OneUptime UserID who initiated
            const { code, error, error_description, state, admin_consent } = req.query;

            // Construct redirect URIs
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
            tokenRequestBody.append('scope', 'https://graph.microsoft.com/.default'); // Application permissions scope
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
                const expiresIn: number = responseData['expires_in'] as number; // in seconds
                const tokenScope: string = responseData['scope'] as string;

                if (!accessToken) {
                    throw new BadDataException('Access token not found in Microsoft response.');
                }

                const decodedToken: JSONObject | null = MicrosoftTeamsAPI.decodeJwtPayload(accessToken);
                if (!decodedToken) {
                    throw new BadDataException('Failed to decode access token.');
                }

                const tenantId: string = decodedToken['tid'] as string; // Tenant ID
                const botObjectId: string = decodedToken['oid'] as string; // Object ID of the app registration's service principal

                if(!tenantId){
                    throw new BadDataException('Tenant ID (tid) not found in access token.');
                }
                 if(!botObjectId){
                    throw new BadDataException('Bot Object ID (oid) not found in access token.');
                }


                const tokenExpiresAt: Date = OneUptimeDate.getNSecondsLater(expiresIn);
                
                // Assuming WorkspaceProjectAuthTokenService.refreshAuthToken handles both create and update
                await WorkspaceProjectAuthTokenService.refreshAuthToken({
                    projectId: new ObjectID(projectId),
                    workspaceType: WorkspaceType.MicrosoftTeams,
                    authToken: accessToken,
                    refreshToken: refreshToken,
                    tokenExpiresAt: tokenExpiresAt,
                    workspaceProjectId: tenantId, // Using tenantId as the workspace specific project identifier
                    miscData: {
                        tenantId: tenantId,
                        botAppId: MSAL_CLIENT_ID.toString(), // The App ID of your bot registration
                        botObjectId: botObjectId, 
                        tokenScope: tokenScope,
                        oneUptimeUserIdInitiated: new ObjectID(userId) // OneUptime User ID who initiated
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

        // Endpoint for User-specific Authentication (Delegated Permissions)
        router.get('/msteams/auth/:projectId/:userId/user', async (req: Request, res: Response) => {
            const { projectId, userId: oneUptimeUserId } = req.params; // oneUptimeUserId is the OneUptime user
            const { code, error, error_description, state } = req.query;
            
            const tokenExchangeRedirectUriUser: string = `${APP_API_CLIENT_URL.toString()}/msteams/auth/${projectId}/${oneUptimeUserId}/user`;
            const finalRedirectUrl: URL = new URL(`${dashboardClientUrl.toString()}/${projectId}/settings/msteams-integration`);
            finalRedirectUrl.searchParams.set('userId', oneUptimeUserId); // Keep userId for context in redirect

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
            tokenRequestBody.append('scope', 'User.Read Chat.ReadWrite offline_access openid profile email'); // Delegated permissions
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
                const expiresIn: number = responseData['expires_in'] as number; // in seconds
                const tokenScope: string = responseData['scope'] as string;
                const idToken: string = responseData['id_token'] as string; // Contains user info

                if (!accessToken || !idToken) {
                    throw new BadDataException('Access token or ID token not found in Microsoft response.');
                }

                const decodedIdToken: JSONObject | null = MicrosoftTeamsAPI.decodeJwtPayload(idToken);
                if (!decodedIdToken) {
                    throw new BadDataException('Failed to decode ID token.');
                }

                const teamsUserId: string = decodedIdToken['oid'] as string; // User's object ID in Azure AD
                const teamsTenantId: string = decodedIdToken['tid'] as string; // Tenant ID
                const teamsUserEmail: string = (decodedIdToken['email'] || decodedIdToken['preferred_username']) as string;
                const teamsUserName: string = decodedIdToken['name'] as string;

                if(!teamsUserId || !teamsTenantId || !teamsUserEmail){
                     throw new BadDataException('Essential user information (oid, tid, email/preferred_username) not found in ID token.');
                }

                const tokenExpiresAt: Date = OneUptimeDate.getNSecondsLater(expiresIn);

                // Assuming WorkspaceUserAuthTokenService.refreshAuthToken handles both create and update
                await WorkspaceUserAuthTokenService.refreshAuthToken({
                    projectId: new ObjectID(projectId),
                    userId: new ObjectID(oneUptimeUserId), // OneUptime User ID
                    workspaceType: WorkspaceType.MicrosoftTeams,
                    authToken: accessToken,
                    refreshToken: refreshToken,
                    tokenExpiresAt: tokenExpiresAt,
                    workspaceUserId: teamsUserId, // Microsoft Teams User ID (oid from id_token)
                    miscData: {
                        teamsUserId: teamsUserId,
                        teamsTenantId: teamsTenantId,
                        teamsUserEmail: teamsUserEmail,
                        teamsUserName: teamsUserName,
                        tokenScope: tokenScope,
                        idToken: idToken, // Store id_token if needed for later use (e.g., logout)
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

        // Endpoint for Bot Framework Events
        router.post('/msteams/events', 
            MicrosoftTeamsAuthorization.isAuthorizedTeamsRequest, // Apply the middleware here
            async (req: Request, res: Response) => {
            
            logger.info('Teams Event Received:', req.body);

            // TODO: Parse request.body (it's a JSON payload from Teams Bot Framework)
            // Example: const activity = req.body;
            const activity: JSONObject = req.body;


            if (activity && activity['type'] === 'invoke' && activity['name'] === 'adaptiveCard/action') {
                const actionId: string | undefined = activity['value']?.['action']?.['id'] as string | undefined;
                const actionData: JSONObject | undefined = activity['value']?.['action']?.['data'] as JSONObject | undefined;

                if (actionId && actionData) {
                    logger.info(`Adaptive Card action invoked. Action ID: ${actionId}, Data: ${JSON.stringify(actionData)}`);

                    // Conditionally call alert actions
                    if (actionId.startsWith('alert') || actionId === 'acknowledgeAlert' || actionId === 'resolveAlert') {
                        const payload: HandleAlertActionPayload = {
                            actionId: actionId,
                            data: actionData,
                            request: req,
                            response: res 
                        };
                        try {
                            await MicrosoftTeamsAlertActions.handleAlertAction(payload);
                            // Note: handleAlertAction might modify the response if it needs to send a specific
                            // card update back for an invoke. If so, the final res.status(200).send() might need adjustment.
                            // For now, assume handleAlertAction does its work and this main handler sends the final 200 OK.
                        } catch (e: any) {
                            logger.error(`Error handling alert action ${actionId}:`, e);
                            // If handleAlertAction throws, we still need to send a 200 OK to Teams,
                            // unless the error was in sending a response itself.
                        }
                    } else {
                        logger.info(`Received Adaptive Card action '${actionId}' not related to alerts. No specific handler implemented yet.`);
                    }
                } else {
                    logger.error('Received Adaptive Card invoke action, but actionId or actionData is missing from value.action.');
                }
            } else {
                 logger.info('Received non-adaptive card invoke or non-alert action. No specific handler implemented yet.');
            }


            // Always respond with 200 OK to acknowledge receipt of the event,
            // unless a specific response was already sent by an action handler for an invoke.
            if (!res.headersSent) {
                res.status(200).send();
            }
        });

        return router;
    }
}
