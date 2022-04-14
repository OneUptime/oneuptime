import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import BadDataException from 'Common/Types/Exception/BadDataException';
import request from 'request';
import IntegrationService from '../services/integrationService';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserAdmin: $TSFixMe = require('../middlewares/project').isUserAdmin;
import {
    CLIENT_ID,
    CLIENT_SECRET,
    APP_ROUTE,
    API_ROUTE,
} from '../config/slack';
import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

const router: $TSFixMe = express.getRouter();

router.get('/auth/redirect', (req: ExpressRequest, res: ExpressResponse) => {
    // get oneuptime project id from slack auth state query params
    let state = req.query.state;
    const slackCode: $TSFixMe = req.query.code;

    if (!slackCode) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Slack code missing in query, must be present',
        });
    }

    if (!state) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Slack state missing in query, must be present',
        });
    }
    // hack that gets the user authToken and project ID, not very secure, but sufficient for now

    state = state.split(',', 2);

    const projectId: $TSFixMe = state[0];

    const userToken: $TSFixMe = state[1];

    const options: $TSFixMe = {
        uri: `${API_ROUTE}/slack/${projectId}/link?code=${slackCode}`,
        method: 'POST',
        headers: {
            Authorization: userToken,
        },
    };

    request(options, (error: $TSFixMe, response: $TSFixMe) => {
        if (error || response.statusCode === 400) {
            return sendErrorResponse(req, res, error as Exception);
        } else {
            return res.redirect(
                `${APP_ROUTE}/project/${projectId}/integrations`
            );
        }
    });
});

router.post(
    '/:projectId/link',
    getUser,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const projectId: $TSFixMe = req.params.projectId;
        const code: $TSFixMe = req.query.code;

        const userId: $TSFixMe = req.user ? req.user.id : null;
        const slug: $TSFixMe = req.body.slug;

        if (!slug) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException(
                    'projectId missing in query, must be present'
                )
            );
        }

        if (!code) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('code missing in query, must be present')
            );
        }

        const options: $TSFixMe = {
            uri:
                'https://slack.com/api/oauth.access?code=' +
                code +
                '&client_id=' +
                CLIENT_ID +
                '&client_secret=' +
                CLIENT_SECRET,
            method: 'GET',
        };

        request(
            options,
            async (error: $TSFixMe, response: $TSFixMe, body: $TSFixMe) => {
                const JSONresponse: $TSFixMe = JSON.parse(body);
                if (!JSONresponse.ok) {
                    return sendErrorResponse(req, res, JSONresponse.error);
                } else {
                    // get slack response object
                    const data: $TSFixMe = {
                        userId: JSONresponse.user_id,
                        teamName: JSONresponse.team_name,
                        accessToken: JSONresponse.access_token,
                        teamId: JSONresponse.team_id,
                        channelId: JSONresponse.incoming_webhook.channel_id,
                        channel: JSONresponse.incoming_webhook.channel,
                        botUserId: JSONresponse.bot.bot_user_id,
                        botAccessToken: JSONresponse.bot.bot_access_token,
                    };

                    const integrationType: string = 'slack';
                    try {
                        const slack: $TSFixMe = await IntegrationService.create(
                            projectId,
                            userId,
                            data,
                            integrationType,
                            null
                        );
                        return sendItemResponse(req, res, slack);
                    } catch (error) {
                        return sendErrorResponse(req, res, error as Exception);
                    }
                }
            }
        );
    }
);

// req => params => {teamId, projectId}
router.delete(
    '/:projectId/unLink/:teamId',
    getUser,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const projectId: $TSFixMe = req.params.projectId;
        const teamId: $TSFixMe = req.params.teamId;

        const userId: $TSFixMe = req.user ? req.user.id : null;

        const integrationType: string = 'slack';

        try {
            const data: $TSFixMe = await IntegrationService.deleteBy(
                {
                    projectId: projectId,
                    'data.teamId': teamId,
                    integrationType: integrationType,
                },
                userId
            );
            return sendItemResponse(req, res, data);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// req => params => {projectId}
router.get(
    '/:projectId/teams',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const projectId: $TSFixMe = req.params.projectId;
        const integrationType: string = 'slack';

        try {
            const select: $TSFixMe =
                'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
            const populate: $TSFixMe = [
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: [{ path: 'componentId', select: 'name' }],
                },
            ];
            const [integrations, count]: $TSFixMe = await Promise.all([
                IntegrationService.findBy({
                    query: {
                        projectId: projectId,
                        integrationType: integrationType,
                    },
                    skip: req.query['skip'] || 0,
                    limit: req.query['limit'] || 10,
                    select,
                    populate,
                }),
                IntegrationService.countBy({
                    projectId: projectId,
                    integrationType: integrationType,
                }),
            ]);
            return sendListResponse(req, res, integrations, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
