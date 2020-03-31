/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const incidentSMSActionModel = require('../models/incidentSMSAction');
const twilio = require('twilio');
const ErrorService = require('./errorService');
const Handlebars = require('handlebars');
const defaultSmsTemplates = require('../config/smsTemplate');
const GlobalConfigService = require('./globalConfigService');
const UserModel = require('../models/user');
const UserService = require('./userService');
const SmsCountService = require('./smsCountService');
const AlertService = require('./alertService');

const _this = {
    getClient: (accountSid, authToken) => {
        if (!accountSid || !authToken) {
            const error = new Error('Twilio credentials not found.');
            error.code = 400;
            return error;
        }
        return twilio(accountSid, authToken);
    },

    getSettings: async () => {
        const document = await GlobalConfigService.findOneBy({
            name: 'twilio',
        });
        if (document && document.value) {
            return {
                'account-sid': document.value['account-sid'],
                'authentication-token': document.value['authentication-token'],
                phone: document.value['phone'],
                'sms-enabled': document.value['sms-enabled'],
                'call-enabled': document.value['call-enabled'],
            };
        }

        const error = new Error('Twilio settings not found.');
        ErrorService.log('twillioService.getSettings', error);
        throw error;
    },
    sendResponseMessage: async function(to, body) {
        try {
            const creds = await _this.getSettings();

            const options = {
                body,
                from: creds.phone,
                to,
            };

            const twilioClient = _this.getClient(
                creds['account-sid'],
                creds['authentication-token']
            );

            if (creds['sms-enabled']) {
                const message = await twilioClient.messages.create(options);
                return message;
            } else {
                const error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
        } catch (error) {
            ErrorService.log('twillioService.sendResponseMessage', error);
            throw error;
        }
    },
    sendIncidentCreatedMessage: async function(
        incidentTime,
        monitorName,
        number,
        incidentId,
        userId,
        name,
        incidentType,
        projectId
    ) {
        try {
            const creds = await _this.getSettings();
            const twilioClient = _this.getClient(
                creds['account-sid'],
                creds['authentication-token']
            );

            if (!creds['sms-enabled']) {
                const error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            const alertLimit = await AlertService.checkPhoneAlertsLimit(
                projectId
            );
            if (alertLimit) {
                const options = {
                    body: `Fyipe Alert: Monitor ${monitorName} is ${incidentType}. Please acknowledge or resolve this incident on Fyipe Dashboard.`,
                    from: creds.phone,
                    to: number,
                };

                // create incidentSMSAction entry for matching sms from twilio.
                const incidentSMSAction = new incidentSMSActionModel();
                incidentSMSAction.incidentId = incidentId;
                incidentSMSAction.userId = userId;
                incidentSMSAction.number = number;
                incidentSMSAction.name = name;
                await incidentSMSAction.save();

                const message = await twilioClient.messages.create(options);
                return message;
            } else {
                const error = new Error('Alerts limit reached for the day.');
                error.code = 400;
                return error;
            }
        } catch (error) {
            ErrorService.log(
                'twillioService.sendIncidentCreatedMessage',
                error
            );
            throw error;
        }
    },

    sendIncidentCreatedMessageToSubscriber: async function(
        incidentTime,
        monitorName,
        number,
        smsTemplate,
        incident,
        projectName,
        projectId
    ) {
        try {
            const _this = this;
            let { template } = await _this.getTemplate(
                smsTemplate,
                'Subscriber Incident Created'
            );
            const data = {
                projectName,
                monitorName: monitorName,
                incidentTime: incidentTime,
                incidentType: incident.incidentType,
            };
            template = template(data);
            const creds = await _this.getSettings();
            if (!creds['sms-enabled']) {
                const error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            const options = {
                body: template,
                from: creds.phone,
                to: number,
            };
            const twilioClient = _this.getClient(
                creds['account-sid'],
                creds['authentication-token']
            );
            let alertLimit = true;

            alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);

            if (alertLimit) {
                const message = await twilioClient.messages.create(options);
                return message;
            } else {
                const error = new Error('Alerts limit reached for the day.');
                error.code = 400;
                return error;
            }
        } catch (error) {
            ErrorService.log(
                'twillioService.sendIncidentCreatedMessageToSubscriber',
                error
            );
            throw error;
        }
    },

    sendIncidentAcknowldegedMessageToSubscriber: async function(
        incidentTime,
        monitorName,
        number,
        smsTemplate,
        incident,
        projectName,
        projectId
    ) {
        try {
            const _this = this;
            let { template } = await _this.getTemplate(
                smsTemplate,
                'Subscriber Incident Acknowldeged'
            );
            const data = {
                projectName,
                monitorName: monitorName,
                incidentTime: incidentTime,
                incidentType: incident.incidentType,
            };
            template = template(data);
            const creds = await _this.getSettings();
            if (!creds['sms-enabled']) {
                const error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            const options = {
                body: template,
                from: creds.phone,
                to: number,
            };
            const twilioClient = _this.getClient(
                creds['account-sid'],
                creds['authentication-token']
            );
            let alertLimit = true;

            alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);

            if (alertLimit) {
                const message = await twilioClient.messages.create(options);
                return message;
            } else {
                const error = new Error('Alerts limit reached for the day.');
                error.code = 400;
                return error;
            }
        } catch (error) {
            ErrorService.log(
                'twillioService.sendIncidentAcknowldegedMessageToSubscriber',
                error
            );
            throw error;
        }
    },

    sendIncidentResolvedMessageToSubscriber: async function(
        incidentTime,
        monitorName,
        number,
        smsTemplate,
        incident,
        projectName,
        projectId
    ) {
        try {
            const _this = this;
            let { template } = await _this.getTemplate(
                smsTemplate,
                'Subscriber Incident Resolved'
            );
            const data = {
                projectName,
                monitorName: monitorName,
                incidentTime: incidentTime,
                incidentType: incident.incidentType,
            };
            template = template(data);
            const creds = await _this.getSettings();
            if (!creds['sms-enabled']) {
                const error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }
            const options = {
                body: template,
                from: creds.phone,
                to: number,
            };
            const twilioClient = _this.getClient(
                creds['account-sid'],
                creds['authentication-token']
            );
            let alertLimit = true;

            alertLimit = await AlertService.checkPhoneAlertsLimit(projectId);

            if (alertLimit) {
                const message = await twilioClient.messages.create(options);
                return message;
            } else {
                const error = new Error('Alerts limit reached for the day.');
                error.code = 400;
                return error;
            }
        } catch (error) {
            ErrorService.log(
                'twillioService.sendIncidentResolvedMessageToSubscriber',
                error
            );
            throw error;
        }
    },

    test: async function(data) {
        try {
            const options = {
                body:
                    'This is a test message from Fyipe to check your Twilio credentials.',
                from: data.phoneNumber,
                to: data.testphoneNumber,
            };

            const twilioClient = _this.getClient(
                data.accountSid,
                data.authToken
            );

            const message = await twilioClient.messages.create(options);

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

    sendIncidentCreatedCall: async function(
        incidentTime,
        monitorName,
        number,
        accessToken,
        incidentId,
        projectId,
        redialCount,
        incidentType
    ) {
        try {
            const creds = await _this.getSettings();
            const twilioClient = _this.getClient(
                creds['account-sid'],
                creds['authentication-token']
            );
            if (!creds['call-enabled']) {
                const error = new Error('Call Not Enabled');
                error.code = 400;
                return error;
            }

            const alertLimit = await AlertService.checkPhoneAlertsLimit(
                projectId
            );
            if (alertLimit) {
                const message =
                    '<Say voice="alice">This is an alert from Fyipe. Your monitor ' +
                    monitorName +
                    ' is ' +
                    incidentType +
                    '. Please go to Fyipe Dashboard or Mobile app to acknowledge or resolve this incident.</Say>';
                const hangUp = '<Hangup />';
                const twiml = '<Response> ' + message + hangUp + '</Response>';

                const options = {
                    twiml: twiml,
                    from: creds.phone,
                    to: number,
                };

                if (twilioClient) {
                    const call = await twilioClient.calls.create(options);
                    return call;
                }
            } else {
                const error = new Error('Alerts limit reached for the day.');
                error.code = 400;
                return error;
            }
        } catch (error) {
            ErrorService.log('twillioService.sendIncidentCreatedCall', error);
            throw error;
        }
    },

    getTemplate: async function(smsTemplate, smsTemplateType) {
        const defaultTemplate = defaultSmsTemplates.filter(
            template => template.smsType === smsTemplateType
        )[0];
        let smsContent = defaultTemplate.body;
        if (
            smsTemplate != null &&
            smsTemplate != undefined &&
            smsTemplate.body
        ) {
            smsContent = smsTemplate.body;
        }
        const template = await Handlebars.compile(smsContent);
        return { template };
    },
    sendVerificationSMS: async function(to, userId, projectId) {
        try {
            const creds = await _this.getSettings();
            const twilioClient = _this.getClient(
                creds['account-sid'],
                creds['authentication-token']
            );

            const alertLimit = await AlertService.checkPhoneAlertsLimit(
                projectId
            );
            if (alertLimit) {
                if (!to.startsWith('+')) {
                    to = '+' + to;
                }
                const channel = 'sms';

                if (!creds['sms-enabled']) {
                    const error = new Error('SMS Not Enabled');
                    error.code = 400;
                    return error;
                }

                const verificationRequest = await twilioClient.verify
                    .services(creds['verification-sid'])
                    .verifications.create({ to, channel });

                await SmsCountService.create(userId, to, projectId);
                await UserService.updateOneBy(
                    { _id: userId },
                    { tempAlertPhoneNumber: to }
                );
                return verificationRequest;
            } else {
                const error = new Error('Alerts limit reached for the day.');
                error.code = 400;
                throw error;
            }
        } catch (error) {
            ErrorService.log('twillioService.sendVerificationSMS', error);
            throw error;
        }
    },
    verifySMSCode: async function(to, code, userId, projectId) {
        try {
            const creds = await _this.getSettings();

            const twilioClient = _this.getClient(
                creds['account-sid'],
                creds['authentication-token']
            );

            if (!creds['sms-enabled']) {
                const error = new Error('SMS Not Enabled');
                error.code = 400;
                return error;
            }

            const alertLimit = await AlertService.checkPhoneAlertsLimit(
                projectId
            );
            if (alertLimit) {
                if (!to.startsWith('+')) {
                    to = '+' + to;
                }

                const verificationResult = await twilioClient.verify
                    .services(creds['verification-sid'])
                    .verificationChecks.create({ to, code });
                if (verificationResult.status === 'pending') {
                    const error = new Error('Incorrect code');
                    error.code = 400;
                    throw error;
                }
                if (verificationResult.status === 'approved') {
                    await UserModel.findByIdAndUpdate(userId, {
                        $set: {
                            alertPhoneNumber: to,
                            tempAlertPhoneNumber: null,
                        },
                    });
                }
                return verificationResult;
            } else {
                const newError = new Error('Alerts limit reached for the day.');
                newError.code = 400;
                throw newError;
            }
        } catch (error) {
            if (error.message === 'Invalid parameter: To') {
                const invalidNumbererror = new Error('Invalid number');
                error.code = 400;
                throw invalidNumbererror;
            }
            ErrorService.log('twillioService.verifySMSCode', error);
            throw error;
        }
    },
};

module.exports = _this;
