/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const request = require('request');
const IntegrationService = require('../services/integrationService');
const getUser = require('../middlewares/user').getUser;
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const {
    CLIENT_ID,
    CLIENT_SECRET,
    APP_ROUTE,
    API_ROUTE,
} = require('../config/slack');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

const router = express.Router();

router.get('/auth/redirect', function(req, res) {
    // get fyipe project id from slack auth state query params
    let state = req.query.state;
    const slackCode = req.query.code;

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

    const projectId = state[0];
    const userToken = state[1];

    const options = {
        uri: `${API_ROUTE}/slack/${projectId}/link?code=${slackCode}`,
        method: 'POST',
        headers: {
            Authorization: userToken,
        },
    };

    request(options, (error, response) => {
        if (error || response.statusCode === 400) {
            return sendErrorResponse(req, res, error);
        } else {
            return res.redirect(
                `${APP_ROUTE}/project/${projectId}/integrations`
            );
        }
    });
});

router.post('/:projectId/link', getUser, isUserAdmin, async function(req, res) {
    const projectId = req.params.projectId;
    const code = req.query.code;
    const userId = req.user ? req.user.id : null;
    const slug = req.body.slug;

    if (!slug) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'projectId missing in query, must be present',
        });
    }

    if (!code) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'code missing in query, must be present',
        });
    }

    const options = {
        uri:
            'https://slack.com/api/oauth.access?code=' +
            code +
            '&client_id=' +
            CLIENT_ID +
            '&client_secret=' +
            CLIENT_SECRET,
        method: 'GET',
    };

    request(options, async (error, response, body) => {
        const JSONresponse = JSON.parse(body);
        if (!JSONresponse.ok) {
            return sendErrorResponse(req, res, JSONresponse.error);
        } else {
            // get slack response object
            const data = {
                userId: JSONresponse.user_id,
                teamName: JSONresponse.team_name,
                accessToken: JSONresponse.access_token,
                teamId: JSONresponse.team_id,
                channelId: JSONresponse.incoming_webhook.channel_id,
                channel: JSONresponse.incoming_webhook.channel,
                botUserId: JSONresponse.bot.bot_user_id,
                botAccessToken: JSONresponse.bot.bot_access_token,
            };

            const integrationType = 'slack';
            try {
                const slack = await IntegrationService.create(
                    projectId,
                    userId,
                    data,
                    integrationType,
                    null
                );
                return sendItemResponse(req, res, slack);
            } catch (error) {
                return sendErrorResponse(req, res, error);
            }
        }
    });
});

// req => params => {teamId, projectId}
router.delete(
    '/:projectId/unLink/:teamId',
    getUser,
    isUserAdmin,
    async function(req, res) {
        const projectId = req.params.projectId;
        const teamId = req.params.teamId;
        const userId = req.user ? req.user.id : null;

        const integrationType = 'slack';

        try {
            const data = await IntegrationService.deleteBy(
                {
                    projectId: projectId,
                    'data.teamId': teamId,
                    integrationType: integrationType,
                },
                userId
            );
            return sendItemResponse(req, res, data);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// req => params => {projectId}
router.get('/:projectId/teams', getUser, async function(req, res) {
    const projectId = req.params.projectId;
    const integrationType = 'slack';

    try {
        const integrations = await IntegrationService.findBy(
            { projectId: projectId, integrationType: integrationType },
            req.query.skip || 0,
            req.query.limit || 10
        );
        const count = await IntegrationService.countBy({
            projectId: projectId,
            integrationType: integrationType,
        });
        return sendListResponse(req, res, integrations, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
