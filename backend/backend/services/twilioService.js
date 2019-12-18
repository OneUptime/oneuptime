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
        try {
            var options = {
                body,
                from: twilioCredentials.phoneNumber,
                to,
            };
            var message = await client.messages.create(options);
            return message;
        } catch (error) {
            ErrorService.log('twillioService.sendResponseMessage', error);
            throw error;
        }
    },
    sendIncidentCreatedMessage: async function (incidentTime, monitorName, number, incidentId, userId, name, incidentType) {
        try {
            var options = {
                body: `Your monitor ${monitorName} is ${incidentType}. Acknowledge this incident by sending 1 or Resolve by sending 2 to ${twilioCredentials.phoneNumber}. You can also log into Fyipe dashboard to acknowledge or reoslve it.`,
                from: twilioCredentials.phoneNumber,
                to: number
            };
    
            // create incidentSMSAction entry for matching sms from twilio.
            const incidentSMSAction = new incidentSMSActionModel();
            incidentSMSAction.incidentId = incidentId;
            incidentSMSAction.userId = userId;
            incidentSMSAction.number = number;
            incidentSMSAction.name = name;
            await incidentSMSAction.save();
            
            var message = await client.messages.create(options);
            return message;
        } catch (error) {
            ErrorService.log('twillioService.sendIncidentCreatedMessage', error);
            throw error;
        }
    },

    sendIncidentCreatedMessageToSubscriber: async function (incidentTime, monitorName, number, smsTemplate, projectId) {
        try {
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
            var message = await newClient.messages.create(options);
            return message;
        } catch (error) {
            ErrorService.log('twillioService.sendIncidentCreatedMessageToSubscriber', error);
            throw error;
        }
    },

    test: async function (data) {
        try {
            var options = {
                body: 'This is a test message to check your twilio settings.Please do not reply',
                from: data.phoneNumber,
                to: twilioCredentials.testphoneNumber
            };
            let newClient = dynamicClient(data.accountSid, data.authToken);
            var message = await newClient.messages.create(options);
            return message;
        } catch (error) {
            let err = Object.assign({}, error);
            if (err && err.status) {
                err = new Error(error.message);
                err.code = 400;
            }
            ErrorService.log('twillioService.test', err);
            throw err;
        }
    },

    sendIncidentCreatedCall: async function (incidentTime, monitorName, number, accessToken, incidentId, projectId, redialCount, incidentType) {
        try {
            var options = {
                url: `${baseApiUrl}/twilio/voice/incident?redialCount=${redialCount || 0}&accessToken=${accessToken}&incidentId=${incidentId}&projectId=${projectId}&monitorName=${monitorName.split(' ').join('%20')}&incidentType=${incidentType}`,
                from: twilioCredentials.phoneNumber,
                to: number,
                timeout: 60,
                method: 'GET',
                statusCallback: `${baseApiUrl}/twilio/voice/status?redialCount=${redialCount || 0}&accessToken=${accessToken}&incidentId=${incidentId}&projectId=${projectId}&monitorName=${monitorName.split(' ').join('%20')}`,
                statusCallbackMethod: 'GET',
                StatusCallbackEvent: ['no-answer', 'canceled', 'failed']
            };
            var call = await client.calls.create(options);
            return call;
        } catch (error) {
            ErrorService.log('twillioService.sendIncidentCreatedCall', error);
            throw error;
        }
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
            ErrorService.log('twillioService.sendVerificationSMS', error);
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
            ErrorService.log('twillioService.verifySMSCode', error);
            throw error;
        }
    }
};