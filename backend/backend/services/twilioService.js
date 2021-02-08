/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const incidentSMSActionModel = require('../models/incidentSMSAction');
const twilio = require('twilio');
const SmsSmtpService = require('./smsSmtpService');
const ErrorService = require('./errorService');
const Handlebars = require('handlebars');
const defaultSmsTemplates = require('../config/smsTemplate');
const GlobalConfigService = require('./globalConfigService');
const UserService = require('./userService');
const SmsCountService = require('./smsCountService');
const CallLogsService = require('./callLogsService');
const AlertService = require('./alertService');
const { IS_TESTING } = require('../config/server');

const _this = {
    findByOne: async function (query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const twilioSettings = await SmsSmtpService.findOneBy(query);
            return twilioSettings;
        } catch (error) {
            ErrorService.log('SubscriberService.findByOne', error);
            throw error;
        }
    },

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
            return document.value;
        }

        const error = new Error('Twilio settings not found.');
        ErrorService.log('twillioService.getSettings', error);
        throw error;
    },

    sendIncidentCreatedMessage: async function (
        incidentTime,
        monitorName,
        number,
        incidentId,
        userId,
        name,
        incidentType,
        projectId,
        smsProgress
    ) {
        let smsBody;
        try {
            let smsMessage;
            if(smsProgress) {
                smsMessage = `Reminder ${smsProgress.current}/${smsProgress.total}: `
            } else {
                smsMessage = ''
            }
            const options = {
                body: `${smsMessage} Fyipe Alert: Monitor ${monitorName} is ${incidentType}. Please acknowledge or resolve this incident on Fyipe Dashboard.`,
                to: number,
            };
            smsBody = options.body;
            const customTwilioSettings = await _this.findByOne({
                projectId,
                enabled: true,
            });
            if (customTwilioSettings) {
                options.from = customTwilioSettings.phoneNumber;
                const incidentSMSAction = new incidentSMSActionModel();
                incidentSMSAction.incidentId = incidentId;
                incidentSMSAction.userId = userId;
                incidentSMSAction.number = number;
                incidentSMSAction.name = name;
                await incidentSMSAction.save();

                const twilioClient = _this.getClient(
                    customTwilioSettings.accountSid,
                    customTwilioSettings.authToken
                );
                const message = await twilioClient.messages.create(options);
                await SmsCountService.create(
                    userId,
                    number,
                    projectId,
                    smsBody,
                    'Success'
                );
                return message;
            } else {
                const creds = await _this.getSettings();
                const twilioClient = _this.getClient(
                    creds['account-sid'],
                    creds['authentication-token']
                );

                if (!creds['sms-enabled']) {
                    const error = new Error('SMS Not Enabled');
                    error.code = 400;
                    await SmsCountService.create(
                        userId,
                        number,
                        projectId,
                        smsBody,
                        'Error',
                        error.message
                    );
                    return error;
                }
                const alertLimit = await AlertService.checkPhoneAlertsLimit(
                    projectId
                );
                if (alertLimit) {
                    options.from = creds.phone;
                    // create incidentSMSAction entry for matching sms from twilio.
                    const incidentSMSAction = new incidentSMSActionModel();
                    incidentSMSAction.incidentId = incidentId;
                    incidentSMSAction.userId = userId;
                    incidentSMSAction.number = number;
                    incidentSMSAction.name = name;
                    await incidentSMSAction.save();
                    const message = await twilioClient.messages.create(options);
                    await SmsCountService.create(
                        userId,
                        number,
                        projectId,
                        smsBody,
                        'Success'
                    );
                    return message;
                } else {
                    const error = new Error(
                        'Alerts limit reached for the day.'
                    );
                    error.code = 400;
                    await SmsCountService.create(
                        userId,
                        number,
                        projectId,
                        smsBody,
                        'Error',
                        error.message
                    );
                    return error;
                }
            }
        } catch (error) {
            ErrorService.log(
                'twillioService.sendIncidentCreatedMessage',
                error
            );
            await SmsCountService.create(
                userId,
                number,
                projectId,
                smsBody,
                'Error',
                error.message
            );
            throw error;
        }
    },

    sendIncidentCreatedMessageToSubscriber: async function (
        incidentTime,
        monitorName,
        number,
        smsTemplate,
        incident,
        projectName,
        projectId,
        componentName,
        statusPageUrl,
        customFields
    ) {
        let smsBody;
        try {
            let { template } = await _this.getTemplate(
                smsTemplate,
                'Subscriber Incident Created'
            );
            const data = {
                projectName,
                monitorName: monitorName,
                incidentTime: incidentTime,
                incidentType: incident.incidentType,
                componentName,
                statusPageUrl,
                ...customFields,
            };
            template = template(data);
            smsBody = template;
            const customTwilioSettings = await _this.findByOne({
                projectId,
                enabled: true,
            });

            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };

                const twilioClient = _this.getClient(
                    customTwilioSettings.accountSid,
                    customTwilioSettings.authToken
                );

                const message = await twilioClient.messages.create(options);
                await SmsCountService.create(
                    null,
                    number,
                    projectId,
                    smsBody,
                    'Success'
                );
                return message;
            } else {
                const creds = await _this.getSettings();
                if (!creds['sms-enabled']) {
                    const error = new Error('SMS Not Enabled');
                    error.code = 400;
                    await SmsCountService.create(
                        null,
                        number,
                        projectId,
                        smsBody,
                        'Error',
                        error.message
                    );
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

                alertLimit = await AlertService.checkPhoneAlertsLimit(
                    projectId
                );

                if (alertLimit) {
                    const message = await twilioClient.messages.create(options);
                    await SmsCountService.create(
                        null,
                        number,
                        projectId,
                        smsBody,
                        'Success'
                    );
                    return message;
                } else {
                    const error = new Error(
                        'Alerts limit reached for the day.'
                    );
                    await SmsCountService.create(
                        null,
                        number,
                        projectId,
                        smsBody,
                        'Error',
                        error.message
                    );
                    error.code = 400;
                    return error;
                }
            }
        } catch (error) {
            ErrorService.log(
                'twillioService.sendIncidentCreatedMessageToSubscriber',
                error
            );
            await SmsCountService.create(
                null,
                number,
                projectId,
                smsBody,
                'Error',
                error.message
            );
            throw error;
        }
    },

    sendInvestigationNoteToSubscribers: async function (
        incidentTime,
        monitorName,
        number,
        smsTemplate,
        incident,
        projectName,
        projectId,
        componentName,
        statusUrl,
        customFields
    ) {
        let smsBody;
        try {
            let { template } = await _this.getTemplate(
                smsTemplate,
                'Investigation note is created'
            );
            const data = {
                projectName,
                monitorName: monitorName,
                incidentTime: incidentTime,
                incidentType: incident.incidentType,
                componentName,
                statusPageUrl: statusUrl,
                ...customFields,
            };
            template = template(data);
            smsBody = template;
            const customTwilioSettings = await _this.findByOne({
                projectId,
                enabled: true,
            });

            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };

                const twilioClient = _this.getClient(
                    customTwilioSettings.accountSid,
                    customTwilioSettings.authToken
                );

                const message = await twilioClient.messages.create(options);
                await SmsCountService.create(
                    null,
                    number,
                    projectId,
                    smsBody,
                    'Success'
                );
                return message;
            } else {
                const creds = await _this.getSettings();
                if (!creds['sms-enabled']) {
                    const error = new Error('SMS Not Enabled');
                    error.code = 400;
                    await SmsCountService.create(
                        null,
                        number,
                        projectId,
                        smsBody,
                        'Error',
                        error.message
                    );
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

                alertLimit = await AlertService.checkPhoneAlertsLimit(
                    projectId
                );

                if (alertLimit) {
                    const message = await twilioClient.messages.create(options);
                    await SmsCountService.create(
                        null,
                        number,
                        projectId,
                        smsBody,
                        'Success'
                    );
                    return message;
                } else {
                    const error = new Error(
                        'Alerts limit reached for the day.'
                    );
                    await SmsCountService.create(
                        null,
                        number,
                        projectId,
                        smsBody,
                        'Error',
                        error.message
                    );
                    error.code = 400;
                    return error;
                }
            }
        } catch (error) {
            ErrorService.log(
                'twillioService.sendInvestigationNoteToSubscribers',
                error
            );
            await SmsCountService.create(
                null,
                number,
                projectId,
                smsBody,
                'Error',
                error.message
            );
            throw error;
        }
    },

    sendIncidentAcknowldegedMessageToSubscriber: async function (
        incidentTime,
        monitorName,
        number,
        smsTemplate,
        incident,
        projectName,
        projectId,
        componentName,
        statusPageUrl,
        customFields,
        length
    ) {
        let smsBody;
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
                componentName,
                statusPageUrl,
                ...customFields,
                length,
            };
            template = template(data);
            smsBody = template;
            const customTwilioSettings = await _this.findByOne({
                projectId,
                enabled: true,
            });

            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };
                const twilioClient = _this.getClient(
                    customTwilioSettings.accountSid,
                    customTwilioSettings.authToken
                );
                const message = await twilioClient.messages.create(options);
                await SmsCountService.create(
                    null,
                    number,
                    projectId,
                    smsBody,
                    'Success'
                );
                return message;
            } else {
                const creds = await _this.getSettings();
                if (!creds['sms-enabled']) {
                    const error = new Error('SMS Not Enabled');
                    error.code = 400;
                    await SmsCountService.create(
                        null,
                        number,
                        projectId,
                        smsBody,
                        'Error',
                        error.message
                    );
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

                alertLimit = await AlertService.checkPhoneAlertsLimit(
                    projectId
                );

                if (alertLimit) {
                    const message = await twilioClient.messages.create(options);
                    await SmsCountService.create(
                        null,
                        number,
                        projectId,
                        smsBody,
                        'Success'
                    );
                    return message;
                } else {
                    const error = new Error(
                        'Alerts limit reached for the day.'
                    );
                    await SmsCountService.create(
                        null,
                        number,
                        projectId,
                        smsBody,
                        'Error',
                        error.message
                    );
                    error.code = 400;
                    return error;
                }
            }
        } catch (error) {
            ErrorService.log(
                'twillioService.sendIncidentAcknowldegedMessageToSubscriber',
                error
            );
            await SmsCountService.create(
                null,
                number,
                projectId,
                smsBody,
                'Error',
                error.message
            );
            throw error;
        }
    },

    sendIncidentResolvedMessageToSubscriber: async function (
        incidentTime,
        monitorName,
        number,
        smsTemplate,
        incident,
        projectName,
        projectId,
        componentName,
        statusPageUrl,
        customFields,
        length
    ) {
        let smsBody;
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
                componentName,
                statusPageUrl,
                ...customFields,
                length,
            };
            template = template(data);
            smsBody = template;
            const customTwilioSettings = await _this.findByOne({
                projectId,
                enabled: true,
            });
            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };

                const twilioClient = _this.getClient(
                    customTwilioSettings.accountSid,
                    customTwilioSettings.authToken
                );
                const message = await twilioClient.messages.create(options);
                await SmsCountService.create(
                    null,
                    number,
                    projectId,
                    smsBody,
                    'Success'
                );
                return message;
            } else {
                const creds = await _this.getSettings();
                if (!creds['sms-enabled']) {
                    const error = new Error('SMS Not Enabled');
                    error.code = 400;
                    await SmsCountService.create(
                        null,
                        number,
                        projectId,
                        smsBody,
                        'Error',
                        error.message
                    );
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

                alertLimit = await AlertService.checkPhoneAlertsLimit(
                    projectId
                );

                if (alertLimit) {
                    const message = await twilioClient.messages.create(options);
                    await SmsCountService.create(
                        null,
                        number,
                        projectId,
                        smsBody,
                        'Success'
                    );
                    return message;
                } else {
                    const error = new Error(
                        'Alerts limit reached for the day.'
                    );
                    await SmsCountService.create(
                        null,
                        number,
                        projectId,
                        smsBody,
                        'Error',
                        error.message
                    );
                    error.code = 400;
                    return error;
                }
            }
        } catch (error) {
            ErrorService.log(
                'twillioService.sendIncidentResolvedMessageToSubscriber',
                error
            );
            await SmsCountService.create(
                null,
                number,
                projectId,
                smsBody,
                'Error',
                error.message
            );
            throw error;
        }
    },

    test: async function (data) {
        try {
            const options = {
                body: 'This is a test SMS from Fyipe',
                from: data.phoneNumber,
                to: '+19173976235',
            };

            const twilioClient = _this.getClient(
                data.accountSid,
                data.authToken
            );

            const message = await twilioClient.messages.create(options);
            await SmsCountService.create(
                null,
                options.to,
                null,
                options.body,
                'Success'
            );

            return message;
        } catch (error) {
            let err = Object.assign({}, error);
            if (
                (err && err.status) ||
                error.message === 'accountSid must start with AC'
            ) {
                err = new Error(error.message);
                err.code = 400;
            }
            ErrorService.log('twillioService.test', err);
            throw err;
        }
    },

    sendIncidentCreatedCall: async function (
        incidentTime,
        monitorName,
        number,
        accessToken,
        incidentId,
        projectId,
        incidentType,
        callProgress
    ) {
        let callBody;
        try {
            const extraInfo = callProgress ?
                `This is the ${await _this.getProgressText(callProgress.current)} 
                    reminder.` : '';
            const message =
                '<Say voice="alice">This is an alert from Fyipe. Your monitor ' +
                monitorName +
                ' is ' +
                incidentType +
                '. Please go to Fyipe Dashboard or Mobile app to acknowledge or resolve this incident. ' +
                extraInfo + '</Say>';
            const hangUp = '<Hangup />';
            const twiml = '<Response> ' + message + hangUp + '</Response>';
            callBody = twiml;
            const options = {
                twiml: twiml,
                to: number,
            };
            const customTwilioSettings = await _this.findByOne({
                projectId,
                enabled: true,
            });

            if (customTwilioSettings) {
                options.from = customTwilioSettings.phoneNumber;
                const twilioClient = _this.getClient(
                    customTwilioSettings.accountSid,
                    customTwilioSettings.authToken
                );
                const call = await twilioClient.calls.create(options);
                await CallLogsService.create(
                    '+15005550006',
                    number,
                    projectId,
                    callBody,
                    'Success'
                );
                return call;
            } else {
                const creds = await _this.getSettings();
                const twilioClient = _this.getClient(
                    creds['account-sid'],
                    creds['authentication-token']
                );
                if (!creds['call-enabled']) {
                    const error = new Error('Call Not Enabled');
                    error.code = 400;
                    await CallLogsService.create(
                        '+15005550006',
                        number,
                        projectId,
                        callBody,
                        'Error',
                        error.message
                    );
                    return error;
                }

                const alertLimit = await AlertService.checkPhoneAlertsLimit(
                    projectId
                );
                if (alertLimit) {
                    options.from = creds.phone;
                    if (twilioClient) {
                        const call = await twilioClient.calls.create(options);
                        await CallLogsService.create(
                            '+15005550006',
                            number,
                            projectId,
                            callBody,
                            'Success'
                        );
                        return call;
                    }
                } else {
                    const error = new Error(
                        'Alerts limit reached for the day.'
                    );
                    error.code = 400;
                    await CallLogsService.create(
                        '+15005550006',
                        number,
                        projectId,
                        callBody,
                        'Error',
                        error.message
                    );
                    return error;
                }
            }
        } catch (error) {
            ErrorService.log('twillioService.sendIncidentCreatedCall', error);
            await CallLogsService.create(
                '+15005550006',
                number,
                projectId,
                callBody,
                'Error',
                error.message
            );
            throw error;
        }
    },

    getProgressText: async function (number) {
        var special = ['zeroth', 'first', 'second', 'third', 
            'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 
            'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 
            'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 
            'eighteenth', 'nineteenth'];
        var deca = ['twent', 'thirt', 'fort', 
                'fift', 'sixt', 'sevent', 'eight', 
                'ninet'];

        if (number < 20) return special[number];
        if (number % 10 === 0) return deca[Math.floor(number / 10) - 2] + 'ieth';
        return deca[Math.floor(number / 10) - 2] + 'y-' + special[number % 10];
    },

    getTemplate: async function (smsTemplate, smsTemplateType) {
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
    sendVerificationSMS: async function (
        to,
        userId,
        projectId,
        validationResult
    ) {
        let smsBody;
        try {
            const customTwilioSettings = await _this.findByOne({
                projectId,
                enabled: true,
            });
            if (!to.startsWith('+')) {
                to = '+' + to;
            }
            const alertPhoneVerificationCode = IS_TESTING
                ? '123456'
                : Math.random()
                    .toString(10)
                    .substr(2, 6);
            if (customTwilioSettings) {
                const template = `Your verification code: ${alertPhoneVerificationCode}`;
                smsBody = template;
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to,
                };

                const twilioClient = _this.getClient(
                    customTwilioSettings.accountSid,
                    customTwilioSettings.authToken
                );
                await twilioClient.messages.create(options);
                await UserService.updateOneBy(
                    { _id: userId },
                    {
                        tempAlertPhoneNumber: to,
                        alertPhoneVerificationCode,
                        alertPhoneVerificationCodeRequestTime: Date.now(),
                    }
                );
                return {};
            } else {
                if (!validationResult.validateResend) {
                    throw new Error(validationResult.problem);
                }
                const creds = await _this.getSettings();
                const twilioClient = _this.getClient(
                    creds['account-sid'],
                    creds['authentication-token']
                );

                const alertLimit = await AlertService.checkPhoneAlertsLimit(
                    projectId
                );
                if (alertLimit) {
                    if (!creds['sms-enabled']) {
                        const error = new Error('SMS Not Enabled');
                        error.code = 400;
                        throw error;
                    }
                    const template = `Your verification code: ${alertPhoneVerificationCode}`;
                    smsBody = template;
                    const options = {
                        body: template,
                        from: creds.phone,
                        to,
                    };
                    await twilioClient.messages.create(options);
                    await SmsCountService.create(
                        userId,
                        to,
                        projectId,
                        options.body,
                        'Success'
                    );
                    await UserService.updateOneBy(
                        { _id: userId },
                        {
                            tempAlertPhoneNumber: to,
                            alertPhoneVerificationCode,
                            alertPhoneVerificationCodeRequestTime: Date.now(),
                        }
                    );
                    return {};
                } else {
                    const error = new Error(
                        'Alerts limit reached for the day.'
                    );
                    await SmsCountService.create(
                        userId,
                        to,
                        projectId,
                        smsBody,
                        'Error',
                        error.message
                    );
                    error.code = 400;
                    throw error;
                }
            }
        } catch (error) {
            ErrorService.log('twillioService.sendVerificationSMS', error);
            await SmsCountService.create(
                userId,
                to,
                projectId,
                smsBody,
                'Error',
                error.message
            );
            throw error;
        }
    },

    // Fetch Available numbers to buy from twilio
    fetchPhoneNumbers: async (projectId, countryCode, numberType) => {
        let accountSid = null;
        let authToken = null;
        let numbers;
        const data = {
            phoneNumber: '',
            locality: '',
            region: '',
            capabilities: {},
            price: '',
            priceUnit: '',
        };
        try {
            const customTwilioSettings = await _this.findByOne({
                projectId,
                enabled: true,
            });
            if (customTwilioSettings) {
                accountSid = customTwilioSettings.accountSid;
                authToken = customTwilioSettings.authToken;
            } else {
                const creds = await _this.getSettings();
                accountSid = creds['account-sid'];
                authToken = creds['authentication-token'];
            }
            const twilioClient = _this.getClient(accountSid, authToken);
            const priceList = await twilioClient.pricing.v1.phoneNumbers
                .countries(countryCode)
                .fetch();
            const localPrice = {};
            const mobilePrice = {};
            const tollFreePrice = {};
            priceList &&
                priceList.phoneNumberPrices &&
                priceList.phoneNumberPrices.map(p => {
                    if (p.number_type && p.number_type === 'local') {
                        localPrice.basePrice = p.base_price;
                        localPrice.currentPrice = p.current_price;
                    } else if (p.number_type && p.number_type === 'toll free') {
                        mobilePrice.basePrice = p.base_price;
                        mobilePrice.currentPrice = p.current_price;
                    } else if (p.number_type && p.number_type === 'mobile') {
                        tollFreePrice.basePrice = p.base_price;
                        tollFreePrice.currentPrice = p.current_price;
                    }
                    return p;
                });

            data.priceUnit = priceList.priceUnit;

            if (numberType === 'Local') {
                numbers = await twilioClient
                    .availablePhoneNumbers(countryCode)
                    .local.list({ limit: 1 });
                data.price = await _this.calculatePrice(
                    localPrice.currentPrice,
                    localPrice.basePrice
                );
            } else if (numberType === 'Mobile') {
                numbers = await twilioClient
                    .availablePhoneNumbers(countryCode)
                    .mobile.list({ limit: 1 });
                data.price = await _this.calculatePrice(
                    mobilePrice.currentPrice,
                    mobilePrice.basePrice
                );
            } else if (numberType === 'TollFree') {
                numbers = await twilioClient
                    .availablePhoneNumbers(countryCode)
                    .tollFree.list({ limit: 1 });
                data.price = await _this.calculatePrice(
                    tollFreePrice.currentPrice,
                    tollFreePrice.basePrice
                );
            }

            if (numbers && numbers[0] && numbers[0].phoneNumber) {
                numbers = numbers[0];
            }
            data.phoneNumber = numbers.phoneNumber;
            data.locality = numbers.locality;
            data.region = numbers.region;
            data.capabilities = numbers.capabilities;
            return data;
        } catch (error) {
            ErrorService.log('twillioService.fetchNumbers', error);
            throw error;
        }
    },

    buyPhoneNumber: async (projectId, phoneNumber) => {
        let accountSid = null;
        let authToken = null;
        try {
            const customTwilioSettings = await _this.findByOne({
                projectId,
                enabled: true,
            });
            if (customTwilioSettings) {
                accountSid = customTwilioSettings.accountSid;
                authToken = customTwilioSettings.authToken;
            } else {
                const creds = await _this.getSettings();
                accountSid = creds['account-sid'];
                authToken = creds['authentication-token'];
            }
            const twilioClient = _this.getClient(accountSid, authToken);

            const numbers = await twilioClient.incomingPhoneNumbers.create({
                phoneNumber: phoneNumber,
                voiceUrl: `${global.apiHost}/callRouting/routeCalls`,
                voiceMethod: 'POST',
                statusCallback: `${global.apiHost}/callRouting/statusCallback`,
                statusCallbackMethod: 'POST',
            });
            return numbers;
        } catch (error) {
            ErrorService.log('twillioService.buyPhoneNumber', error);
            throw error;
        }
    },

    releasePhoneNumber: async (projectId, sid) => {
        let accountSid = null;
        let authToken = null;
        try {
            const customTwilioSettings = await _this.findByOne({
                projectId,
                enabled: true,
            });
            if (customTwilioSettings) {
                accountSid = customTwilioSettings.accountSid;
                authToken = customTwilioSettings.authToken;
            } else {
                const creds = await _this.getSettings();
                accountSid = creds['account-sid'];
                authToken = creds['authentication-token'];
            }
            const twilioClient = _this.getClient(accountSid, authToken);

            const numbers = await twilioClient
                .incomingPhoneNumbers(sid)
                .remove();
            return numbers;
        } catch (error) {
            ErrorService.log('twillioService.releasePhoneNumber', error);
            throw error;
        }
    },

    getCallDetails: async (projectId, CallSid) => {
        let accountSid = null;
        let authToken = null;
        try {
            const customTwilioSettings = await _this.findByOne({
                projectId,
                enabled: true,
            });
            if (customTwilioSettings) {
                accountSid = customTwilioSettings.accountSid;
                authToken = customTwilioSettings.authToken;
            } else {
                const creds = await _this.getSettings();
                accountSid = creds['account-sid'];
                authToken = creds['authentication-token'];
            }
            const twilioClient = _this.getClient(accountSid, authToken);

            const details = await twilioClient.calls(CallSid).fetch();
            return details;
        } catch (error) {
            ErrorService.log('twillioService.getCallDetails', error);
            throw error;
        }
    },

    calculatePrice: async (currentPrice, basePrice) => {
        let price =
            currentPrice && basePrice
                ? currentPrice > basePrice
                    ? currentPrice * 10
                    : basePrice * 10
                : 'Not available';
        if (currentPrice && !basePrice) price = currentPrice * 10;
        else if (basePrice && !currentPrice) price = basePrice * 10;
        return price;
    },

    hasCustomSettings: async function (projectId) {
        return await _this.findByOne({
            projectId,
            enabled: true,
        });
    },
};

module.exports = _this;
