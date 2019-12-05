/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const twilioCredentials = require('../config/twilio');
const incidentSMSActionModel = require('../models/incidentSMSAction');
const twilio = require('twilio');
const client = twilio(twilioCredentials.accountSid, twilioCredentials.authToken);
const baseApiUrl = require('../config/baseApiUrl');
const ErrorService = require('./errorService');
var Handlebars = require('handlebars');
var defaultSmsTemplates = require('../config/smsTemplate');
var SmsSmtpService = require('./smsSmtpService');
var UserModel = require('../models/user');
var SmsCountService = require('./smsCountService');

var getTwilioSettings = async (projectId) => {
    let { accountSid, authToken, phoneNumber } = twilioCredentials;
    var twilioDb = await SmsSmtpService.findOneBy({ projectId, enabled: true });
    if (twilioDb && twilioDb.accountSid && twilioDb.accountSid !== null && twilioDb.accountSid !== undefined) {
        accountSid = accountSid.accountSid;
        authToken = accountSid.authToken;
        phoneNumber = accountSid.phoneNumber;
    }

    return { accountSid, authToken, phoneNumber };
};

const dynamicClient = (accountSid, authToken) => {
    return twilio(accountSid, authToken);
};

module.exports = {
    sendResponseMessage: async function (to, body) {
        var options = {
            body,
            from: twilioCredentials.phoneNumber,
            to,
        };
        try {
            var message = await client.messages.create(options);
        } catch (error) {
            ErrorService.log('client.messages.create', error);
            throw error;
        }
        return message;
    },
    sendIncidentCreatedMessage: async function (incidentTime, monitorName, number, incidentId, userId, name) {
        var options = {
            body: `Your monitor ${monitorName} is down. Acknowledge this incident by sending 1 or Resolve by sending 2 to ${twilioCredentials.phoneNumber}. You can also log into Fyipe dashboard to acknowledge or reoslve it.`,
            from: twilioCredentials.phoneNumber,
            to: number
        };

        // create incidentSMSAction entry for matching sms from twilio.
        const incidentSMSAction = new incidentSMSActionModel();
        incidentSMSAction.incidentId = incidentId;
        incidentSMSAction.userId = userId;
        incidentSMSAction.number = number;
        incidentSMSAction.name = name;
        try {
            await incidentSMSAction.save();
            
            var message = await client.messages.create(options);
        } catch (error) {
            if (error.message.indexOf('"IncidentSMSAction"') !== -1) {
                ErrorService.log('incidentSMSAction.save', error);
            } else {
                ErrorService.log('client.messages.create', error);
            }
            throw error;
        }
        return message;
    },

    sendIncidentCreatedMessageToSubscriber: async function (incidentTime, monitorName, number, smsTemplate, projectId) {
        let _this = this;
        var { template } = await _this.getTemplate(smsTemplate);
        let data = {
            monitorName: monitorName,
            incidentTime: incidentTime
        };
        template = template(data);
        let creds = getTwilioSettings(projectId);
        var options = {
            body: template,
            from: creds.phoneNumber,
            to: number
        };
        let newClient = dynamicClient(creds.accountSid, creds.authToken);
        try {
            var message = await newClient.messages.create(options);
        } catch (error) {
            ErrorService.log('newClient.messages.create', error);
            throw error;
        }
        return message;
    },

    test: async function (data) {
        var options = {
            body: 'This is a test message to check your twilio settings.Please do not reply',
            from: data.phoneNumber,
            to: twilioCredentials.testphoneNumber
        };
        let newClient = dynamicClient(data.accountSid, data.authToken);
        try {
            var message = await newClient.messages.create(options);
        } catch (error) {
            let err = Object.assign({}, error);
            if (err && err.status) {
                err = new Error(error.message);
                err.code = 400;
            }
            ErrorService.log('newClient.messages.create', err);
            throw err;
        }
        return message;
    },

    sendIncidentCreatedCall: async function (incidentTime, monitorName, number, accessToken, incidentId, projectId, redialCount) {

        var options = {
            url: `${baseApiUrl}/twilio/voice/incident?redialCount=${redialCount || 0}&accessToken=${accessToken}&incidentId=${incidentId}&projectId=${projectId}&monitorName=${monitorName.split(' ').join('%20')}`,
            from: twilioCredentials.phoneNumber,
            to: number,
            timeout: 60,
            method: 'GET',
            statusCallback: `${baseApiUrl}/twilio/voice/status?redialCount=${redialCount || 0}&accessToken=${accessToken}&incidentId=${incidentId}&projectId=${projectId}&monitorName=${monitorName.split(' ').join('%20')}`,
            statusCallbackMethod: 'GET',
            StatusCallbackEvent: ['no-answer', 'canceled', 'failed']
        };
        try {
            var call = await client.calls.create(options);
        } catch (error) {
            ErrorService.log('client.calls.create', error);
            throw error;
        }
        return call;
    },

    getTemplate: async function (smsTemplate) {
        var defaultTemplate = defaultSmsTemplates.filter(template => template.smsType === 'Subscriber Incident')[0];
        var smsContent = defaultTemplate.body;
        if (smsTemplate != null && smsTemplate != undefined && smsTemplate.body) {
            smsContent = smsTemplate.body;
        }
        var template = await Handlebars.compile(smsContent);
        return { template };
    },
    sendVerificationSMS: async function (to, userId) {
        try {
            if (!to.startsWith('+')) {
                to = '+' + to;
            }
            var channel = 'sms';
            var verificationRequest = await client.verify.services(twilioCredentials.verificationSid)
                .verifications
                .create({ to, channel });
            await SmsCountService.create(userId, to);
            return verificationRequest;
        } catch (error) {
            ErrorService.log('client.sms.sendVerificationSMS', error);
            throw error;
        }
    },
    verifySMSCode: async function (to, code, userId) {
        try {
            if (!to.startsWith('+')) {
                to = '+' + to;
            }
            var verificationResult = await client.verify.services(twilioCredentials.verificationSid)
                .verificationChecks
                .create({ to, code });
            if (verificationResult.status === 'pending') {
                var error = new Error('Incorrect code');
                error.code = 400;
                throw error;
            }
            if (verificationResult.status === 'approved') {
                await UserModel.findByIdAndUpdate(userId, {
                    $set: {
                        alertPhoneNumber: to
                    }
                });
            }
            return verificationResult;
        } catch (error) {
            if (error.message === 'Invalid parameter: To') {
                var invalidNumbererror = new Error('Invalid number');
                error.code = 400;
                throw invalidNumbererror;
            }
            ErrorService.log('client.sms.verifySMSCode', error);
            throw error;
        }
    }
};