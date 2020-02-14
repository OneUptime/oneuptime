/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const twilioCredentials = require('../config/twilio');
const incidentSMSActionModel = require('../models/incidentSMSAction');
const twilio = require('twilio');
const client = twilio(twilioCredentials.accountSid, twilioCredentials.authToken);
const baseApiUrl = process.env.BACKEND_HOST;
const ErrorService = require('./errorService');
var Handlebars = require('handlebars');
var defaultSmsTemplates = require('../config/smsTemplate');
var SmsSmtpService = require('./smsSmtpService');
var UserModel = require('../models/user');
var UserService = require('./userService');
var SmsCountService = require('./smsCountService');
var AlertService = require('./alertService');
var CallEnabled = !!process.env['CALL_ENABLED'];
var SMSEnabled = !!process.env['SMS_ENABLE'];

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
            if (SMSEnabled) {
                var message = await client.messages.create(options);
                return message;
            } else {
                var error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
        } catch (error) {
            ErrorService.log('twillioService.sendResponseMessage', error);
            throw error;
        }
    },
    sendIncidentCreatedMessage: async function (incidentTime, monitorName, number, incidentId, userId, name, incidentType, projectId) {
        try {
            if (!SMSEnabled) {
                var error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            var alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            if (alertLimit) {
                var options = {
                    body: `Your monitor ${monitorName} is ${incidentType}. Reply 1 to this SMS to Acknowledge OR 2 to resolve. Check more details about this incident on Fyipe Dashboard.`,
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
                if (SMSEnabled) {
                    var message = await client.messages.create(options);
                    return message;
                }
            }
            else {
                error = new Error('Alerts limit reached for the day.');
                error.code = 400;
                return error;
            }
        } catch (error) {
            ErrorService.log('twillioService.sendIncidentCreatedMessage', error);
            throw error;
        }
    },

    sendIncidentCreatedMessageToSubscriber: async function (incidentTime, monitorName, number, smsTemplate, incident, projectName, projectId) {
        try {
            if (!SMSEnabled) {
                var error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            let _this = this;
            var { template } = await _this.getTemplate(smsTemplate, 'Subscriber Incident Created');
            let data = {
                projectName,
                monitorName: monitorName,
                incidentTime: incidentTime,
                incidentType: incident.incidentType
            };
            template = template(data);
            let creds = await getTwilioSettings(incident.projectId);
            var options = {
                body: template,
                from: creds.phoneNumber,
                to: number
            };
            let newClient = dynamicClient(creds.accountSid, creds.authToken);
            var alertLimit = true;
            if (twilioCredentials.accountSid === creds.accountSid) {
                alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            }
            if (alertLimit) {
                var message = await newClient.messages.create(options);
                return message;
            }
            else {
                error = new Error('Alerts limit reached for the day.');
                error.code = 400;
                return error;
            }
        } catch (error) {
            ErrorService.log('twillioService.sendIncidentCreatedMessageToSubscriber', error);
            throw error;
        }
    },

    sendIncidentAcknowldegedMessageToSubscriber: async function (incidentTime, monitorName, number, smsTemplate, incident, projectName, projectId) {
        try {
            if (!SMSEnabled) {
                var error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            let _this = this;
            var { template } = await _this.getTemplate(smsTemplate, 'Subscriber Incident Acknowldeged');
            let data = {
                projectName,
                monitorName: monitorName,
                incidentTime: incidentTime,
                incidentType: incident.incidentType
            };
            template = template(data);
            let creds = await getTwilioSettings(incident.projectId);
            var options = {
                body: template,
                from: creds.phoneNumber,
                to: number
            };
            let newClient = dynamicClient(creds.accountSid, creds.authToken);
            var alertLimit = true;
            if (twilioCredentials.accountSid === creds.accountSid) {
                alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            }
            if (alertLimit) {
                var message = await newClient.messages.create(options);
                return message;
            } else {
                error = new Error('Alerts limit reached for the day.');
                error.code = 400;
                return error;
            }
        } catch (error) {
            ErrorService.log('twillioService.sendIncidentAcknowldegedMessageToSubscriber', error);
            throw error;
        }
    },

    sendIncidentResolvedMessageToSubscriber: async function (incidentTime, monitorName, number, smsTemplate, incident, projectName, projectId) {
        try {
            if (!SMSEnabled) {
                var error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            let _this = this;
            var { template } = await _this.getTemplate(smsTemplate, 'Subscriber Incident Resolved');
            let data = {
                projectName,
                monitorName: monitorName,
                incidentTime: incidentTime,
                incidentType: incident.incidentType
            };
            template = template(data);
            let creds = await getTwilioSettings(incident.projectId);
            var options = {
                body: template,
                from: creds.phoneNumber,
                to: number
            };
            let newClient = dynamicClient(creds.accountSid, creds.authToken);
            var alertLimit = true;
            if (twilioCredentials.accountSid === creds.accountSid) {
                alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            }
            if (alertLimit) {
                var message = await newClient.messages.create(options);
                return message;
            } else {
                error = new Error('Alerts limit reached for the day.');
                error.code = 400;
                return error;
            }
        } catch (error) {
            ErrorService.log('twillioService.sendIncidentResolvedMessageToSubscriber', error);
            throw error;
        }
    },

    test: async function (data) {
        try {
            if (!SMSEnabled) {
                var error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            var options = {
                body: 'This is a test message from Fyipe to check your Twilio credentials.',
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
            if (!CallEnabled) {
                var error = new Error('Call Not Enabled');
                error.code = 400;
                return error;
            }
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
            var alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            if (alertLimit && CallEnabled) {
                var call = await client.calls.create(options);
                return call;
            } else {
                error = new Error('Alerts limit reached for the day.');
                error.code = 400;
                return error;
            }
        } catch (error) {
            ErrorService.log('twillioService.sendIncidentCreatedCall', error);
            throw error;
        }
    },

    getTemplate: async function (smsTemplate, smsTemplateType) {
        var defaultTemplate = defaultSmsTemplates.filter(template => template.smsType === smsTemplateType)[0];
        var smsContent = defaultTemplate.body;
        if (smsTemplate != null && smsTemplate != undefined && smsTemplate.body) {
            smsContent = smsTemplate.body;
        }
        var template = await Handlebars.compile(smsContent);
        return { template };
    },
    sendVerificationSMS: async function (to, userId, projectId) {
        try {
            if (!SMSEnabled) {
                var error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            var alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            if (alertLimit) {
                if (!to.startsWith('+')) {
                    to = '+' + to;
                }
                var channel = 'sms';

                var verificationRequest = await client.verify.services(twilioCredentials.verificationSid)
                    .verifications
                    .create({ to, channel });

                await SmsCountService.create(userId, to, projectId);
                await UserService.updateOneBy({ _id: userId }, { tempAlertPhoneNumber: to });
                return verificationRequest;

            } else {
                error = new Error('Alerts limit reached for the day.');
                error.code = 400;
                throw error;
            }
        } catch (error) {
            ErrorService.log('twillioService.sendVerificationSMS', error);
            throw error;
        }
    },
    verifySMSCode: async function (to, code, userId, projectId) {
        try {
            if (!SMSEnabled) {
                var error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            var alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            if (alertLimit) {
                if (!to.startsWith('+')) {
                    to = '+' + to;
                }

                var verificationResult = await client.verify.services(twilioCredentials.verificationSid)
                    .verificationChecks
                    .create({ to, code });
                if (verificationResult.status === 'pending') {
                    error = new Error('Incorrect code');
                    error.code = 400;
                    throw error;
                }
                if (verificationResult.status === 'approved') {
                    await UserModel.findByIdAndUpdate(userId, {
                        $set: {
                            alertPhoneNumber: to,
                            tempAlertPhoneNumber: null
                        }
                    });
                }
                return verificationResult;
            } else {
                var newError = new Error('Alerts limit reached for the day.');
                newError.code = 400;
                throw newError;
            }
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
