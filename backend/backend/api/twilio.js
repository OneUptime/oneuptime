/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const IncidentService = require('../services/incidentService');
const {
    sendIncidentCreatedCall,
    sendVerificationSMS,
    verifySMSCode,
    test
} = require('../services/twilioService');
const { isAuthorized } = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;
const isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const router = express.Router();
const SmsCountService = require('../services/smsCountService');
/**
 * @param { accessToken, projectId, incidentId }: Come in the query string, passed in twilio service.
 * @description Route Description: XMl for Twilio voice Api.
 * @description Twilio gets user message from this API, we send with input Gather set to take a single key press.
 * @returns Twiml with 'Content-Type', 'text/xml' in headers for twilio to understand.
 */

router.get('/voice/status', async (req, res) => {
    try {
        const {
            accessToken,
            monitorName,
            projectId,
            incidentId,
            CallStatus,
            To,
            redialCount,
        } = req.query;
        const incident = await IncidentService.findOneBy({ _id: incidentId });
        const newRedialCount = parseInt(redialCount) + 1;

        switch (CallStatus) {
            case 'failed':
            case 'busy':
            case 'no-answer':
                // redial call in 45 seconds. upon 5 times.
                if (newRedialCount > 5)
                    return sendItemResponse(req, res, {
                        status: 'call redial reached maximum',
                    });
                setTimeout(
                    () =>
                        sendIncidentCreatedCall(
                            null,
                            monitorName,
                            To,
                            accessToken,
                            incidentId,
                            projectId,
                            newRedialCount
                        ),
                    1000 * 60
                );
                return sendItemResponse(req, res, {
                    status: 'call redial success',
                });
            default:
                // call is okay. check if incident was not ack, if not redial upto 5 times else  Exit with no redial
                if (incident && !incident.acknowledged && newRedialCount < 6) {
                    setTimeout(
                        () =>
                            sendIncidentCreatedCall(
                                null,
                                monitorName,
                                To,
                                accessToken,
                                incidentId,
                                projectId,
                                newRedialCount
                            ),
                        1000 * 60
                    );
                    return sendItemResponse(req, res, {
                        status: 'call redial success',
                    });
                }
                return sendItemResponse(req, res, {
                    staus: 'initial call was okay',
                });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

/**
 * @param {string} accessToken : Access token for accessing this endpoint.
 * @param {string} projectId : Id of the project whose monitor had incident created
 * @param {string} incidentId : Id of the incident to change.
 * @description Resolves or Acks an incident based on what key is hit by user.
 * @returns Twiml with with action status.
 */

router.post('/sms/sendVerificationToken', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const { to } = req.body;
        const userId = req.user ? req.user.id : null;
        const projectId = req.query.projectId;
        const {
            validateResend,
            problem,
        } = await SmsCountService.validateResend(userId);
        if (validateResend) {
            const sendVerifyToken = await sendVerificationSMS(
                to,
                userId,
                projectId
            );
            return sendItemResponse(req, res, sendVerifyToken);
        } else {
            return sendErrorResponse(req, res, {
                statusCode: 400,
                message: problem,
            });
        }
    } catch (error) {
        return sendErrorResponse(
            req,
            res,
            error.message
                ? { statusCode: 400, message: error.message }
                : { status: 'action failed' }
        );
    }
});

router.post('/sms/verify', getUser, isAuthorized, async function(req, res) {
    try {
        const { to, code } = req.body;
        const userId = req.user ? req.user.id : null;
        const projectId = req.query.projectId;
        const sendVerifyToken = await verifySMSCode(
            to,
            code,
            userId,
            projectId
        );
        return sendItemResponse(req, res, sendVerifyToken);
    } catch (error) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: error.message,
        });
    }
});

router.post('/test', getUser, isUserMasterAdmin, async function(req, res) {
    try {
        const data = req.body;

        if (!data.accountSid) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Account Sid is required.',
            });
        }

        if (!data.authToken) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Auth Token is required.',
            });
        }

        if (!data.phoneNumber) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Phone Number is required.',
            });
        }

        const testResult = await test(data);
        return sendItemResponse(req, res, testResult);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
