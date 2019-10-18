/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const IncidentService = require('../services/incidentService');
const { sendIncidentCreatedCall, sendResponseMessage, sendVerificationSMS, verifySMSCode } = require('../services/twilioService');
const baseApiUrl = require('../config/baseApiUrl');
const incidentSMSActionService = require('../services/IncidentSMSActionService');
const {
    isAuthorized
} = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;

const router = express.Router();
const errorResponse = '<Response><Say voice="alice">The incident status was not updated. Please go to Fyipe Dashboard to update. Thank you.</Say></Response>';

/**
 * @param { accessToken, projectId, incidentId }: Come in the query string, passed in twilio service.
 * @description Route Description: XMl for Twilio voice Api.
 * @description Twilio gets user message from this API, we send with input Gather set to take a single key press.
 * @returns Twiml with 'Content-Type', 'text/xml' in headers for twilio to understand.
 */
router.get('/voice/incident', async function (req, res) {
    const { accessToken, projectId, incidentId } = req.query;
    let actionPath = `${baseApiUrl}/twilio/voice/incident/action?projectId=${projectId}&amp;incidentId=${incidentId}&amp;accessToken=${accessToken}`;

    // Twilio says this message first. The gather listens for keyboard clicks
    const message = '<Say voice=\'alice\'>This is an alert from Fyipe. Your monitor ' + req.query.monitorName + ' is down. Press one to acknowledge or two to resolve.</Say>';
    const gather = `<Gather numDigits="1" input="dtmf"  action="${actionPath}" > ` + message + '</Gather>';

    // This is said when user hits no key.
    const onNoKeyPress = '<Say voice=\'alice\'>No response received. This call will end.</Say>';
    const hangUp = '<Hangup />';
    res.set('Content-Type', 'text/xml');
    return sendItemResponse(req, res, '<Response> ' + gather + onNoKeyPress + hangUp + '</Response>');
});

router.get('/voice/status', async (req, res) => {
    const { accessToken, monitorName, projectId, incidentId, CallStatus, To, redialCount } = req.query;
    try {
        const incident = await IncidentService.findOneBy({ _id: incidentId });
        const newRedialCount = parseInt(redialCount) + 1;

        switch (CallStatus) {
        case 'failed':
        case 'busy':
        case 'no-answer':
            // redial call in 45 seconds. upon 5 times.
            if (newRedialCount > 5) return sendItemResponse(req, res, { status: 'call redial reached maximum' });
            setTimeout(() => sendIncidentCreatedCall(null, monitorName, To, accessToken, incidentId, projectId, newRedialCount), 1000 * 60);
            return sendItemResponse(req, res, { status: 'call redial success' });
        default:
            // call is okay. check if incident was not ack, if not redial upto 5 times else  Exit with no redial
            if (incident && !incident.acknowledged && newRedialCount < 6) {
                setTimeout(() => sendIncidentCreatedCall(null, monitorName, To, accessToken, incidentId, projectId, redialCount, newRedialCount), 1000 * 60);
                return sendItemResponse(req, res, { status: 'call redial success' });
            }
            return sendItemResponse(req, res, { staus: 'initial call was okay' });
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
router.post('/voice/incident/action', getUser, isAuthorized, async function (req, res) {
    const { accessToken, projectId, incidentId } = req.query;

    let actionPath = `${baseApiUrl}/twilio/voice/incident/action?projectId=${projectId}&amp;incidentId=${incidentId}&amp;accessToken=${accessToken}`;
    var userId = req.user ? req.user.id : null;

    var data = { decoded: userId, incidentId: incidentId, projectId: req.query.projectId };

    res.set('Content-Type', 'text/xml');

    if (!data.incidentId) {
        return sendItemResponse(res, res, errorResponse);
    }

    if (typeof data.incidentId !== 'string') {
        return sendItemResponse(req, res, errorResponse);
    }

    try {

        switch (req.body.Digits) {
        // eslint-disable-next-line no-case-declarations
        case '1': {
            // Call the IncidentService
            await IncidentService.acknowledge(incidentId, userId, req.user.name);
            // Ask the user to resolve incident after acknowledging
            const onAcknowledge = `<Gather numDigits="1" input="dtmf"  action="${actionPath}"> <Say voice="alice">The incident status has been acknowledged. Press 2 to resolve this incident</Say> </Gather>`;
            const onTimeout = `<Gather numDigits="1" input="dtmf"  action="${actionPath}"> <Say voice="alice">You did not press any key. Press 2 to resolve this incident.</Say> </Gather>`;
            const exitMessage = '<Say voice="alice">You did not press any key, Good bye.</Say>';
            return sendItemResponse(req, res, '<Response>' + onAcknowledge + onTimeout + exitMessage + '</Response>');
        }
        case '2': {
            // Call the IncidentService
            await IncidentService.resolve(incidentId, userId);
            return sendItemResponse(req, res, '<Response><Say voice="alice">The incident status has been resolved. Log on to your dashboard to see the status. Thank you for using Fyipe.</Say></Response>');
        }
        default: {
            // Request user to press 1 or 2
            return sendItemResponse(req, res, `<Response><Gather numDigits="1" input="dtmf"  action="${actionPath}" ><Say voice="alice">You have pressed unknown key, Please press 1 to acknowledge or 2 to resolve the incident.</Say></Gather></Response>`);
        }
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/sms/incoming', async (req, res) => {
    const { Body, From, To } = req.body;
    const actionType = parseInt(Body);
    // Fetch the incident action record created when sms is dispatched.
    try {
        const action = await incidentSMSActionService.get({ number: From, resolved: false });
        // There should only be one pending incident to act upon. If not then this can not be done over sms.
        if (action[1] || !action[0]) {
            sendResponseMessage(From, 'You have many pending incidents. Please go to your Dashbard to perform actions on each. Thank you.');
            return sendItemResponse(req, res, { status: 'two incidents available, action not possible' });
        }
        switch (actionType) {
        case 1:
            await IncidentService.acknowledge(action[0], action[0].userId, action[0].name);
            await incidentSMSActionService.update(action[0]._id, { acknowledged: true });
            sendResponseMessage(From, `Incident status acknowledged. Send 2 to ${To} to resolve incident`);
            return sendItemResponse(req, res, { status: 'acknowledged' });
        case 2:
            await IncidentService.resolve(action[0], action[0].userId);
            await incidentSMSActionService.update(action[0]._id, { acknowledged: true, resolved: true });
            sendResponseMessage(From, 'Incient status resolved. Thank you.');
            return sendItemResponse(req, res, { status: 'resolved' });
        default:
            sendResponseMessage(From, 'We could not perform with action. Please logon to Fyipe Dashboard to complete. Thank you.');
            return sendItemResponse(req, res, 'invalid no, ask again.');
        }
    } catch (e) {
        sendResponseMessage(From, 'We could not perform with action. Please logon to Fyipe Dashboard to complete. Thank you.');
        return sendErrorResponse(req, res, { status: 'action failed' });
    }
});

router.post('/sms/sendVerificationToken', getUser, isAuthorized, async function (req, res) {
    var { to } = req.body;
    try{
        var sendVerifyToken = await sendVerificationSMS(to);
        return sendItemResponse(req, res, sendVerifyToken);
    } catch(error) {
        return sendErrorResponse(req, res, { status: 'action failed' });
    }
});


router.post('/sms/verify', getUser, isAuthorized, async function (req, res) {
    var { to, code } = req.body;
    var userId = req.user ? req.user.id : null;

    try{
        var sendVerifyToken = await verifySMSCode(to, code, userId);
        return sendItemResponse(req, res, sendVerifyToken);
    } catch(error) {
        return sendErrorResponse(req, res, { 
            code: 400,
            message: error.message
        });
    }
});

module.exports = router;