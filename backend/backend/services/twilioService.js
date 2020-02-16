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
let Handlebars = require('handlebars');
let defaultSmsTemplates = require('../config/smsTemplate');
let SmsSmtpService = require('./smsSmtpService');
let UserModel = require('../models/user');
let UserService = require('./userService');
let SmsCountService = require('./smsCountService');
let AlertService = require('./alertService');
let CallEnabled = !!process.env['CALL_ENABLED'];
let SMSEnabled = !!process.env['SMS_ENABLE'];

let getTwilioSettings = async (projectId) => {
    let { accountSid, authToken, phoneNumber } = twilioCredentials;
    let twilioDb = await SmsSmtpService.findOneBy({ projectId, enabled: true });
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
            let options = {
                body,
                from: twilioCredentials.phoneNumber,
                to,
            };
            if (SMSEnabled) {
                let message = await client.messages.create(options);
                return message;
            } else {
                let error = new Error('SMS Not Enabled');
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
                let error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            let alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            if (alertLimit) {
                let options = {
                    body: `Fyipe Alert: Monitor ${monitorName} is ${incidentType}. Please acknowledge or resolve this incident on Fyipe Dashboard.`,
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
                    let message = await client.messages.create(options);
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
                let error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            let _this = this;
            let { template } = await _this.getTemplate(smsTemplate, 'Subscriber Incident Created');
            let data = {
                projectName,
                monitorName: monitorName,
                incidentTime: incidentTime,
                incidentType: incident.incidentType
            };
            template = template(data);
            let creds = await getTwilioSettings(incident.projectId);
            let options = {
                body: template,
                from: creds.phoneNumber,
                to: number
            };
            let newClient = dynamicClient(creds.accountSid, creds.authToken);
            let alertLimit = true;
            if (twilioCredentials.accountSid === creds.accountSid) {
                alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            }
            if (alertLimit) {
                let message = await newClient.messages.create(options);
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
                let error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            let _this = this;
            let { template } = await _this.getTemplate(smsTemplate, 'Subscriber Incident Acknowldeged');
            let data = {
                projectName,
                monitorName: monitorName,
                incidentTime: incidentTime,
                incidentType: incident.incidentType
            };
            template = template(data);
            let creds = await getTwilioSettings(incident.projectId);
            let options = {
                body: template,
                from: creds.phoneNumber,
                to: number
            };
            let newClient = dynamicClient(creds.accountSid, creds.authToken);
            let alertLimit = true;
            if (twilioCredentials.accountSid === creds.accountSid) {
                alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            }
            if (alertLimit) {
                let message = await newClient.messages.create(options);
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
                let error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            let _this = this;
            let { template } = await _this.getTemplate(smsTemplate, 'Subscriber Incident Resolved');
            let data = {
                projectName,
                monitorName: monitorName,
                incidentTime: incidentTime,
                incidentType: incident.incidentType
            };
            template = template(data);
            let creds = await getTwilioSettings(incident.projectId);
            let options = {
                body: template,
                from: creds.phoneNumber,
                to: number
            };
            let newClient = dynamicClient(creds.accountSid, creds.authToken);
            let alertLimit = true;
            if (twilioCredentials.accountSid === creds.accountSid) {
                alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            }
            if (alertLimit) {
                let message = await newClient.messages.create(options);
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
                let error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            let options = {
                body: 'This is a test message from Fyipe to check your Twilio credentials.',
                from: data.phoneNumber,
                to: twilioCredentials.testphoneNumber
            };
            let newClient = dynamicClient(data.accountSid, data.authToken);

            let message = await newClient.messages.create(options);

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
                let error = new Error('Call Not Enabled');
                error.code = 400;
                return error;
            }

            let alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            if (alertLimit && CallEnabled) {
                const message = '<Say voice="alice">This is an alert from Fyipe. Your monitor ' + monitorName + ' is ' + incidentType + '. Please go to Fyipe Dashboard or Mobile app to acknowledge or resolve this incident.</Say>';
                const hangUp = '<Hangup />';
                const twiml = '<Response> ' + message + hangUp + '</Response>';

                let options = {
                    twiml: twiml,
                    from: twilioCredentials.phoneNumber,
                    to: number
                };

                let call = await client.calls.create(options);
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
        let defaultTemplate = defaultSmsTemplates.filter(template => template.smsType === smsTemplateType)[0];
        let smsContent = defaultTemplate.body;
        if (smsTemplate != null && smsTemplate != undefined && smsTemplate.body) {
            smsContent = smsTemplate.body;
        }
        let template = await Handlebars.compile(smsContent);
        return { template };
    },
    sendVerificationSMS: async function (to, userId, projectId) {
        try {
            if (!SMSEnabled) {
                let error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            let alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            if (alertLimit) {
                if (!to.startsWith('+')) {
                    to = '+' + to;
                }
                let channel = 'sms';

                let verificationRequest = await client.verify.services(twilioCredentials.verificationSid)
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
                let error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            let alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);
            if (alertLimit) {
                if (!to.startsWith('+')) {
                    to = '+' + to;
                }

                let verificationResult = await client.verify.services(twilioCredentials.verificationSid)
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
                let newError = new Error('Alerts limit reached for the day.');
                newError.code = 400;
                throw newError;
            }
        } catch (error) {
            if (error.message === 'Invalid parameter: To') {
                let invalidNumbererror = new Error('Invalid number');
                error.code = 400;
                throw invalidNumbererror;
            }
            ErrorService.log('twillioService.verifySMSCode', error);
            throw error;
        }
    }
};
