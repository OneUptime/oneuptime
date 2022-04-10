import incidentSMSActionModel from '../Models/incidentSMSAction';
import twilio from 'twilio';
import SmsSmtpService from './SmsSmtpService';
import Handlebars from 'handlebars';
import defaultSmsTemplates from '../config/smsTemplate';
import BadDataException from 'common/types/exception/BadDataException';
import GlobalConfigService from './GlobalConfigService';
import UserService from './UserService';
import SmsCountService from './SmsCountService';
import CallLogsService from './CallLogsService';
import AlertService from './AlertService';
import FindOneBy from '../types/db/FindOneBy';
import { IS_TESTING } from '../config/server';

export default class TwilioService {
    async findByOne({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }
        query.deleted = false;

        const twilioSettings = await SmsSmtpService.findOneBy({
            query,
            select,
            populate,
            sort,
        });

        return twilioSettings;
    }

    getClient(accountSid: $TSFixMe, authToken: $TSFixMe) {
        if (!accountSid || !authToken) {
            const error = new Error('Twilio credentials not found.');

            error.code = 400;
            return error;
        }
        return twilio(accountSid, authToken);
    }

    async getSettings() {
        const document = await GlobalConfigService.findOneBy({
            query: { name: 'twilio' },
            select: 'value name',
        });
        if (document && document.value) {
            return document.value;
        }

        const error = new Error('Twilio settings not found.');

        error.code = 400;
        throw error;
    }

    async sendIncidentCreatedMessage(
        incidentTime: $TSFixMe,
        monitorName: $TSFixMe,
        number: $TSFixMe,
        incidentId: $TSFixMe,
        userId: string,
        name: $TSFixMe,
        incidentType: $TSFixMe,
        projectId: string,
        smsProgress: $TSFixMe
    ) {
        let smsBody;
        try {
            let smsMessage;
            if (smsProgress) {
                smsMessage = `Reminder ${smsProgress.current}/${smsProgress.total}: `;
            } else {
                smsMessage = '';
            }
            const options = {
                body: `${smsMessage} OneUptime Alert: Monitor ${monitorName} is ${incidentType}. Please acknowledge or resolve this incident on OneUptime Dashboard.`,
                to: number,
            };
            smsBody = options.body;
            const customTwilioSettings = await this.findByOne({
                query: { projectId, enabled: true },
                select: 'projectId phoneNumber accountSid authToken iv enabled createdAt deletedById',
                populate: [{ path: 'projectId', select: 'name' }],
            });
            if (customTwilioSettings) {
                options.from = customTwilioSettings.phoneNumber;
                const incidentSMSAction = new incidentSMSActionModel();

                incidentSMSAction.incidentId = incidentId;

                incidentSMSAction.userId = userId;

                incidentSMSAction.number = number;

                incidentSMSAction.name = name;
                await incidentSMSAction.save();

                const twilioClient = this.getClient(
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
                const creds = await this.getSettings();
                const twilioClient = this.getClient(
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
                    const error = new BadDataException(
                        'Alerts limit reached for the day.'
                    );
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
    }

    async sendIncidentCreatedMessageToSubscriber(
        incidentTime: $TSFixMe,
        monitorName: $TSFixMe,
        number: $TSFixMe,
        smsTemplate: $TSFixMe,
        incident: $TSFixMe,
        projectName: $TSFixMe,
        projectId: string,
        componentName: $TSFixMe,
        statusPageUrl: URL,
        customFields: $TSFixMe
    ) {
        let smsBody;
        try {
            let { template } = await this.getTemplate(
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
            const customTwilioSettings = await this.findByOne({
                query: { projectId, enabled: true },
                select: 'projectId phoneNumber accountSid authToken iv enabled createdAt deletedById',
                populate: [{ path: 'projectId', select: 'name' }],
            });

            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };

                const twilioClient = this.getClient(
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
                const creds = await this.getSettings();
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
                const twilioClient = this.getClient(
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
    }

    async sendInvestigationNoteToSubscribers(
        incidentTime: $TSFixMe,
        monitorName: $TSFixMe,
        number: $TSFixMe,
        smsTemplate: $TSFixMe,
        incident: $TSFixMe,
        projectName: $TSFixMe,
        projectId: string,
        componentName: $TSFixMe,
        statusUrl: URL,
        customFields: $TSFixMe,
        note: $TSFixMe
    ) {
        let smsBody;
        try {
            let { template } = await this.getTemplate(
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
                incidentNote: note,
            };

            template = template(data);
            smsBody = template;
            const customTwilioSettings = await this.findByOne({
                query: { projectId, enabled: true },
                select: 'phoneNumber accountSid authToken',
            });

            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };

                const twilioClient = this.getClient(
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
                const creds = await this.getSettings();
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
                const twilioClient = this.getClient(
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
    }

    async sendIncidentAcknowledgedMessageToSubscriber(
        incidentTime: $TSFixMe,
        monitorName: $TSFixMe,
        number: $TSFixMe,
        smsTemplate: $TSFixMe,
        incident: $TSFixMe,
        projectName: $TSFixMe,
        projectId: string,
        componentName: $TSFixMe,
        statusPageUrl: URL,
        customFields: $TSFixMe,
        length: $TSFixMe
    ) {
        let smsBody;
        try {
            let { template } = await this.getTemplate(
                smsTemplate,
                'Subscriber Incident Acknowledged'
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
            const customTwilioSettings = await this.findByOne({
                query: { projectId, enabled: true },
                select: 'projectId phoneNumber accountSid authToken iv enabled createdAt deletedById',
                populate: [{ path: 'projectId', select: 'name' }],
            });

            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };
                const twilioClient = this.getClient(
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
                const creds = await this.getSettings();
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
                const twilioClient = this.getClient(
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
    }

    async sendIncidentResolvedMessageToSubscriber(
        incidentTime: $TSFixMe,
        monitorName: $TSFixMe,
        number: $TSFixMe,
        smsTemplate: $TSFixMe,
        incident: $TSFixMe,
        projectName: $TSFixMe,
        projectId: string,
        componentName: $TSFixMe,
        statusPageUrl: URL,
        customFields: $TSFixMe,
        length: $TSFixMe
    ) {
        let smsBody;
        try {
            let { template } = await this.getTemplate(
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
            const customTwilioSettings = await this.findByOne({
                query: { projectId, enabled: true },
                select: 'projectId phoneNumber accountSid authToken iv enabled createdAt deletedById',
                populate: [{ path: 'projectId', select: 'name' }],
            });
            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };

                const twilioClient = this.getClient(
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
                const creds = await this.getSettings();
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
                const twilioClient = this.getClient(
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
    }

    async test(data: $TSFixMe) {
        try {
            const options = {
                body: 'This is a test SMS from OneUptime',
                from: data.phoneNumber,
                to: '+19173976235',
            };

            const twilioClient = this.getClient(
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
            throw err;
        }
    }

    async sendScheduledMaintenanceCreatedToSubscriber(
        incidentTime: $TSFixMe,
        number: $TSFixMe,
        smsTemplate: $TSFixMe,
        schedule: $TSFixMe,
        projectName: $TSFixMe,
        projectId: string
    ) {
        let smsBody;
        try {
            let { template } = await this.getTemplate(
                smsTemplate,
                'Subscriber Scheduled Maintenance Created'
            );
            const data = {
                eventName: schedule.name,
                eventDescription: schedule.description,
                eventCreateTime: schedule.createdAt,
                eventStartTime: schedule.startDate,
                eventEndTime: schedule.endDate,
                projectName,
            };

            template = template(data);
            smsBody = template;
            const customTwilioSettings = await this.findByOne({
                query: { projectId, enabled: true },
                select: 'phoneNumber accountSid authToken',
            });

            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };
                const twilioClient = this.getClient(
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
                const creds = await this.getSettings();
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
                const twilioClient = this.getClient(
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
    }

    async sendScheduledMaintenanceNoteCreatedToSubscriber(
        number: $TSFixMe,
        smsTemplate: $TSFixMe,
        scheduleName: $TSFixMe,
        message: $TSFixMe,
        projectName: $TSFixMe,
        projectId: string
    ) {
        let smsBody;
        try {
            let { template } = await this.getTemplate(
                smsTemplate,
                'Subscriber Scheduled Maintenance Note'
            );

            const data = {
                eventName: scheduleName,
                eventNoteContent: message.content,
                eventNoteState: message.event_state,
                eventNoteType: message.type,
                projectName,
            };

            template = template(data);
            smsBody = template;
            const customTwilioSettings = await this.findByOne({
                query: { projectId, enabled: true },
                select: 'phoneNumber authToken accountSid',
            });

            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };
                const twilioClient = this.getClient(
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
                const creds = await this.getSettings();
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
                const twilioClient = this.getClient(
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
    }

    async sendScheduledMaintenanceResolvedToSubscriber(
        number: $TSFixMe,
        smsTemplate: $TSFixMe,
        schedule: $TSFixMe,
        projectName: $TSFixMe,
        projectId: string
    ) {
        let smsBody;
        try {
            let { template } = await this.getTemplate(
                smsTemplate,
                'Subscriber Scheduled Maintenance Resolved'
            );
            const data = {
                eventName: schedule.name,
                eventResolveTime: schedule.resolvedAt,
                projectName,
            };

            template = template(data);
            smsBody = template;
            const customTwilioSettings = await this.findByOne({
                query: { projectId, enabled: true },
                select: 'phoneNumber accountSid authToken',
            });

            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };
                const twilioClient = this.getClient(
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
                const creds = await this.getSettings();
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
                const twilioClient = this.getClient(
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
    }

    async sendScheduledMaintenanceCancelledToSubscriber(
        number: $TSFixMe,
        smsTemplate: $TSFixMe,
        schedule: $TSFixMe,
        projectName: $TSFixMe,
        projectId: string
    ) {
        let smsBody;
        try {
            let { template } = await this.getTemplate(
                smsTemplate,
                'Subscriber Scheduled Maintenance Cancelled'
            );
            const data = {
                eventName: schedule.name,
                eventCancelTime: schedule.cancelledAt,
                projectName,
            };

            template = template(data);
            smsBody = template;
            const customTwilioSettings = await this.findByOne({
                query: { projectId, enabled: true },
                select: 'phoneNumber accountSid authToken',
            });

            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };
                const twilioClient = this.getClient(
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
                const creds = await this.getSettings();
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
                const twilioClient = this.getClient(
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
    }

    async sendAnnouncementNotificationToSubscriber(
        number: $TSFixMe,
        smsTemplate: $TSFixMe,
        title: $TSFixMe,
        description: $TSFixMe,
        projectName: $TSFixMe,
        projectId: string
    ) {
        let smsBody;
        try {
            let { template } = await this.getTemplate(
                smsTemplate,
                'Subscriber Announcement Notification Created'
            );
            const data = {
                announcementTitle: title,
                announcementDescription: description,
                projectName,
            };

            template = template(data);
            smsBody = template;
            const customTwilioSettings = await this.findByOne({
                query: { projectId, enabled: true },
                select: 'phoneNumber accountSid authToken',
            });

            if (customTwilioSettings) {
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to: number,
                };
                const twilioClient = this.getClient(
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
                const creds = await this.getSettings();
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
                const twilioClient = this.getClient(
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
    }

    async sendIncidentCreatedCall(
        incidentTime: $TSFixMe,
        monitorName: $TSFixMe,
        number: $TSFixMe,
        accessToken: $TSFixMe,
        incidentId: $TSFixMe,
        projectId: string,
        incidentType: $TSFixMe,
        callProgress: $TSFixMe
    ) {
        let callBody;
        try {
            const extraInfo = callProgress
                ? `This is the ${await this.getProgressText(
                      callProgress.current
                  )} 
                    reminder.`
                : '';
            const message =
                '<Say voice="alice">This is an alert from OneUptime. Your monitor ' +
                monitorName +
                ' is ' +
                incidentType +
                '. Please go to OneUptime Dashboard or Mobile app to acknowledge or resolve this incident. ' +
                extraInfo +
                '</Say>';
            const hangUp = '<Hangup />';
            const twiml = '<Response> ' + message + hangUp + '</Response>';
            callBody = twiml;
            const options = {
                twiml: twiml,
                to: number,
            };
            const customTwilioSettings = await this.findByOne({
                query: { projectId, enabled: true },
                select: 'phoneNumber accountSid authToken',
            });

            if (customTwilioSettings) {
                options.from = customTwilioSettings.phoneNumber;
                const twilioClient = this.getClient(
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
                const creds = await this.getSettings();
                const twilioClient = this.getClient(
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
                    const error = new BadDataException(
                        'Alerts limit reached for the day.'
                    );
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
    }

    async getProgressText(number: $TSFixMe) {
        const special = [
            'zeroth',
            'first',
            'second',
            'third',
            'fourth',
            'fifth',
            'sixth',
            'seventh',
            'eighth',
            'ninth',
            'tenth',
            'eleventh',
            'twelfth',
            'thirteenth',
            'fourteenth',
            'fifteenth',
            'sixteenth',
            'seventeenth',
            'eighteenth',
            'nineteenth',
        ];
        const deca = [
            'twent',
            'thirt',
            'fort',
            'fift',
            'sixt',
            'sevent',
            'eight',
            'ninet',
        ];

        if (number < 20) return special[number];
        if (number % 10 === 0)
            return deca[Math.floor(number / 10) - 2] + 'ieth';
        return deca[Math.floor(number / 10) - 2] + 'y-' + special[number % 10];
    }

    async getTemplate(smsTemplate: $TSFixMe, smsTemplateType: $TSFixMe) {
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
    }

    async sendVerificationSMS(
        to: $TSFixMe,
        userId: string,
        projectId: string,
        validationResult: $TSFixMe
    ) {
        let smsBody;
        try {
            const customTwilioSettings = await this.findByOne({
                query: { projectId, enabled: true },
                select: 'phoneNumber accountSid authToken iv',
            });
            if (!to.startsWith('+')) {
                to = '+' + to;
            }
            const alertPhoneVerificationCode = IS_TESTING
                ? '123456'
                : Math.random().toString(10).substr(2, 6);
            if (customTwilioSettings) {
                const template = `Your verification code: ${alertPhoneVerificationCode}`;
                smsBody = template;
                const options = {
                    body: template,
                    from: customTwilioSettings.phoneNumber,
                    to,
                };

                const twilioClient = this.getClient(
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
                const creds = await this.getSettings();
                const twilioClient = this.getClient(
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
                    await Promise.all([
                        SmsCountService.create(
                            userId,
                            to,
                            projectId,
                            options.body,
                            'Success'
                        ),
                        UserService.updateOneBy(
                            { _id: userId },
                            {
                                tempAlertPhoneNumber: to,
                                alertPhoneVerificationCode,
                                alertPhoneVerificationCodeRequestTime:
                                    Date.now(),
                            }
                        ),
                    ]);

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
    }

    // Fetch Available numbers to buy from twilio
    async fetchPhoneNumbers(
        projectId: string,
        countryCode: $TSFixMe,
        numberType: $TSFixMe
    ) {
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
        const customTwilioSettings = await this.findByOne({
            query: { projectId, enabled: true },
            select: 'accountSid authToken',
        });
        if (customTwilioSettings) {
            accountSid = customTwilioSettings.accountSid;
            authToken = customTwilioSettings.authToken;
        } else {
            const creds = await this.getSettings();
            accountSid = creds['account-sid'];
            authToken = creds['authentication-token'];
        }
        const twilioClient = this.getClient(accountSid, authToken);

        const priceList = await twilioClient.pricing.v1.phoneNumbers
            .countries(countryCode)
            .fetch();
        const localPrice = {};
        const mobilePrice = {};
        const tollFreePrice = {};
        priceList &&
            priceList.phoneNumberPrices &&
            priceList.phoneNumberPrices.map((p: $TSFixMe) => {
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

            data.price = await this.calculatePrice(
                localPrice.currentPrice,

                localPrice.basePrice
            );
        } else if (numberType === 'Mobile') {
            numbers = await twilioClient

                .availablePhoneNumbers(countryCode)
                .mobile.list({ limit: 1 });

            data.price = await this.calculatePrice(
                mobilePrice.currentPrice,

                mobilePrice.basePrice
            );
        } else if (numberType === 'TollFree') {
            numbers = await twilioClient

                .availablePhoneNumbers(countryCode)
                .tollFree.list({ limit: 1 });

            data.price = await this.calculatePrice(
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
    }

    async buyPhoneNumber(projectId: string, phoneNumber: $TSFixMe) {
        let accountSid = null;
        let authToken = null;
        const customTwilioSettings = await this.findByOne({
            query: { projectId, enabled: true },
            select: 'accountSid authToken',
        });
        if (customTwilioSettings) {
            accountSid = customTwilioSettings.accountSid;
            authToken = customTwilioSettings.authToken;
        } else {
            const creds = await this.getSettings();
            accountSid = creds['account-sid'];
            authToken = creds['authentication-token'];
        }
        const twilioClient = this.getClient(accountSid, authToken);

        const numbers = await twilioClient.incomingPhoneNumbers.create({
            phoneNumber: phoneNumber,

            voiceUrl: `${global.apiHost}/callRouting/routeCalls`,
            voiceMethod: 'POST',

            statusCallback: `${global.apiHost}/callRouting/statusCallback`,
            statusCallbackMethod: 'POST',
        });
        return numbers;
    }

    async releasePhoneNumber(projectId: string, sid: $TSFixMe) {
        let accountSid = null;
        let authToken = null;
        const customTwilioSettings = await this.findByOne({
            query: { projectId, enabled: true },
            select: 'accountSid authToken',
        });
        if (customTwilioSettings) {
            accountSid = customTwilioSettings.accountSid;
            authToken = customTwilioSettings.authToken;
        } else {
            const creds = await this.getSettings();
            accountSid = creds['account-sid'];
            authToken = creds['authentication-token'];
        }
        const twilioClient = this.getClient(accountSid, authToken);

        const numbers = await twilioClient.incomingPhoneNumbers(sid).remove();
        return numbers;
    }

    async getCallDetails(projectId: string, CallSid: $TSFixMe) {
        let accountSid = null;
        let authToken = null;
        const customTwilioSettings = await this.findByOne({
            query: { projectId, enabled: true },
            select: 'accountSid authToken',
        });
        if (customTwilioSettings) {
            accountSid = customTwilioSettings.accountSid;
            authToken = customTwilioSettings.authToken;
        } else {
            const creds = await this.getSettings();
            accountSid = creds['account-sid'];
            authToken = creds['authentication-token'];
        }
        const twilioClient = this.getClient(accountSid, authToken);

        const details = await twilioClient.calls(CallSid).fetch();
        return details;
    }

    async calculatePrice(currentPrice: $TSFixMe, basePrice: $TSFixMe) {
        let price =
            currentPrice && basePrice
                ? currentPrice > basePrice
                    ? currentPrice * 10
                    : basePrice * 10
                : 'Not available';
        if (currentPrice && !basePrice) price = currentPrice * 10;
        else if (basePrice && !currentPrice) price = basePrice * 10;
        return price;
    }

    async hasCustomSettings(projectId: string) {
        return await this.findByOne({
            query: { projectId, enabled: true },
            select: '_id',
        });
    }
}
