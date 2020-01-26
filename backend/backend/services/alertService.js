/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    checkBalance: async function (projectId, alertPhoneNumber, userId, alertType) {
        var project = await ProjectService.findOneBy({ _id: projectId });
        var balance = project.balance;
        var countryCode = alertPhoneNumber.split(' ')[0];
        var countryType = getCountryType(countryCode);
        var alertChargeAmount = getAlertChargeAmount(alertType, countryType);
        if (balance > alertChargeAmount.minimumBalance) {
            await PaymentService.chargeAlert(userId, projectId, alertChargeAmount.price);
            return true;
        } else {
            return false;
        }
    },
    checkConfig: async function(projectId, alertPhoneNumber) {
        var project = await ProjectService.findOneBy({ _id: projectId });
        var alertOptions = project.alertOptions;
        var countryCode = alertPhoneNumber.split(' ')[0];
        var countryType = getCountryType(countryCode);
        if(countryType === 'us' ) {
            countryType = 'billingUS';
        } else if (countryType === 'non-us') {
            countryType = 'billingNonUSCountries';
        } else if (countryType === 'risk') {
            countryType = 'billingRiskCountries';
        }
        if(alertOptions[countryType]) {
            return true;
        }
        return false;
    },
    findBy: async function (query, skip, limit, sort) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 10;

            if (!sort) sort = -1;

            if (typeof (skip) === 'string') {
                skip = parseInt(skip);
            }

            if (typeof (limit) === 'string') {
                limit = parseInt(limit);
            }

            if (typeof (sort) === 'string') {
                sort = parseInt(sort);
            }

            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var alerts = await AlertModel.find(query)
                .sort([['createdAt', sort]])
                .limit(limit)
                .skip(skip)
                .populate('userId', 'name')
                .populate('monitorId', 'name')
                .populate('projectId', 'name');
            return alerts;
        } catch (error) {
            ErrorService.log('alertService.findBy`  ', error);
            throw error;
        }
    },


    create: async function (projectId, monitorId, alertVia, userId, incidentId, alertStatus,error,errorMessage) {
        try {
            var alert = new AlertModel();
            alert.projectId = projectId;
            alert.monitorId = monitorId;
            alert.alertVia = alertVia;
            alert.userId = userId;
            alert.incidentId = incidentId;
            alert.alertStatus = alertStatus;
            if(error){
                alert.error = error;
                alert.errorMessage = errorMessage;
            }
            var savedAlert = await alert.save();
            return savedAlert;
        } catch (error) {
            ErrorService.log('alertService.create', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var count = await AlertModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('alertService.countBy', error);
            throw error;
        }

    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var updatedAlert = await AlertModel.findOneAndUpdate(query,
                {
                    $set: data
                },
                {
                    new: true
                });
        } catch (error) {
            ErrorService.log('AlertService.updateOneBy', error);
            throw error;
        }
        return updatedAlert;
    },

    updateBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var updatedData = await AlertModel.updateMany(query, {
                $set: data
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('alertService.updateMany', error);
            throw error;
        }
    },

    deleteBy: async function (query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var alerts = await AlertModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId
                }
            }, {
                new: true
            });
            return alerts;
        } catch (error) {
            ErrorService.log('alertService.deleteBy', error);
            throw error;
        }
    },

    sendIncidentCreated: async function (incident) {
        try {
            if (incident) {
                var _this = this;
                var date = new Date();
                var monitorId = incident.monitorId._id ? incident.monitorId._id : incident.monitorId;
                var projectId = incident.projectId._id ? incident.projectId._id : incident.projectId;
                var monitor = await MonitorService.findOneBy({ _id: monitorId });
                var schedules = await ScheduleService.findBy({ monitorIds: monitorId });
                var project = await ProjectService.findOneBy({ _id: projectId });

                if (schedules.length > 0 && project.alertEnable) {
                    schedules.forEach(async schedule => {
                        let monitorName = monitor.name;
                        if (schedule.escalationIds.length) {
                            schedule.escalationIds.forEach(async escalationId => {
                                if (escalationId && escalationId._id) {
                                    escalationId = escalationId._id;
                                }
                                var escalation = await EscalationService.findOneBy({ _id: escalationId });
                                if (escalation) {
                                    // handle both schedules with rotations and schedules without rotations
                                    const activeTeam = escalation.activeTeamForAlerts ? escalation.activeTeamForAlerts : escalation.team[0];
                                    
                                    activeTeam.teamMember.forEach(async (teamMember) => {
                                        const { currentTime, startTime, endTime } = await _this.getEscalationTime(teamMember.timezone, teamMember.startTime, teamMember.endTime);
                                        if ((currentTime >= startTime && currentTime <= endTime) || (startTime === '' && endTime === '')) {
                                            var user = await UserService.findOneBy({ _id: teamMember.member });

                                            if (user) {
                                                let accessToken = jwt.sign({
                                                    id: user._id
                                                }, jwtKey.jwtSecretKey, { expiresIn: 12 * 60 * 60 * 1000 });
                                                if (escalation.email) {
                                                    const queryString = `projectId=${incident.projectId}&&userId=${user._id}&&accessToken=${accessToken}`;
                                                    let ack_url = `${baseApiUrl}/incident/${incident.projectId}/acknowledge/${incident._id}?${queryString}`;
                                                    let resolve_url = `${baseApiUrl}/incident/${incident.projectId}/resolve/${incident._id}?${queryString}`;
                                                    let firstName = user.name;
                                                    if(user.timezone && TimeZoneNames.indexOf(user.timezone) > -1){
                                                        date = momentTz(date).tz(user.timezone).format();
                                                    }
                                                    await MailService.sendIncidentCreatedMail(date, monitorName, user.email, user._id, firstName.split(' ')[0], incident.projectId, ack_url, resolve_url, accessToken, incident.incidentType,project.name);
                                                    await _this.create(incident.projectId, monitorId, AlertType.Email, user._id, incident._id);
                                                }
                                                if (escalation.sms) {
                                                    let alertStatus, alert, balanceStatus;
                                                    let balanceCheckStatus = await _this.checkBalance(incident.projectId, user.alertPhoneNumber, user._id, AlertType.SMS);
                                                    let configCheckStatus = await _this.checkConfig(incident.projectId, user.alertPhoneNumber);
                                                    if (balanceCheckStatus && configCheckStatus) {
                                                        let alertSuccess = await TwilioService.sendIncidentCreatedMessage(date, monitorName, user.alertPhoneNumber, incident._id, user._id, user.name, incident.incidentType,projectId);
                                                        if(alertSuccess && alertSuccess.code && alertSuccess.code === 400){
                                                            await _this.create(incident.projectId, monitorId, AlertType.SMS, user._id, incident._id, null,true,alertSuccess.message);
                                                        }
                                                        else if (alertSuccess) {
                                                            alertStatus = 'success';
                                                            alert = await _this.create(incident.projectId, monitorId, AlertType.SMS, user._id, incident._id, alertStatus);
                                                            balanceStatus = await _this.getBalanceStatus(incident.projectId, user.alertPhoneNumber, AlertType.SMS);
                                                            AlertChargeService.create(incident.projectId, balanceStatus.chargeAmount, balanceStatus.closingBalance, alert._id, monitorId, incident._id, user.alertPhoneNumber);
                                                        }
                                                    } else if (!balanceCheckStatus && configCheckStatus) {
                                                        alertStatus = 'Blocked - Low balance';
                                                        await _this.create(incident.projectId, monitorId, AlertType.SMS, user._id, incident._id, alertStatus);
                                                    }
                                                }
                                                if (escalation.call) {
                                                    let alertStatus, alert, balanceStatus;
                                                    let balanceCheckStatus = await _this.checkBalance(incident.projectId, user.alertPhoneNumber, user._id, AlertType.Call);
                                                    if (balanceCheckStatus) {

                                                        let alertSuccess = await TwilioService.sendIncidentCreatedCall(date, monitorName, user.alertPhoneNumber, accessToken, incident._id, incident.projectId, incident.incidentType);
                                                        if(alertSuccess && alertSuccess.code && alertSuccess.code === 400){
                                                            await _this.create(incident.projectId, monitorId, AlertType.Call, user._id, incident._id, null,true,alertSuccess.message);
                                                        }
                                                        else if (alertSuccess) {
                                                            alertStatus = 'success';
                                                            alert = await _this.create(incident.projectId, monitorId, AlertType.Call, user._id, incident._id, alertStatus);
                                                            balanceStatus = await _this.getBalanceStatus(incident.projectId, user.alertPhoneNumber, AlertType.Call);
                                                            AlertChargeService.create(incident.projectId, balanceStatus.chargeAmount, balanceStatus.closingBalance, alert._id, monitorId, incident._id, user.alertPhoneNumber);
                                                        }
                                                    } else {
                                                        alertStatus = 'Blocked - Low balance';
                                                        await _this.create(incident.projectId, monitorId, AlertType.Call, user._id, incident._id, alertStatus);
                                                    }
                                                }
                                            }
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
            }
        } catch (error) {
            ErrorService.log('alertService.sendIncidentCreated', error);
            throw error;
        }
    },

    sendIncidentCreatedToSubscribers: async function (incident) {
        try {
            let _this = this;
            if (incident) {
                let monitorId = incident.monitorId._id ? incident.monitorId._id : incident.monitorId;
                var subscribers = await SubscriberService.findBy({ monitorId: monitorId });
                subscribers.forEach(async (subscriber) => {
                    if (subscriber.statusPageId) {
                        var enabledStatusPage = await StatusPageService.findOneBy({ _id: subscriber.statusPageId, isSubscriberEnabled: true });
                        if (enabledStatusPage) {
                            await _this.sendSubscriberAlert(subscriber, incident);
                        }
                    } else {
                        await _this.sendSubscriberAlert(subscriber, incident);
                    }
                });
            }
        } catch (error) {
            ErrorService.log('alertService.sendIncidentCreatedToSubscribers', error);
            throw error;
        }
    },

    sendIncidentAcknowledgedToSubscribers: async function (incident) {
        try {
            let _this = this;
            if (incident) {
                let monitorId = incident.monitorId._id ? incident.monitorId._id : incident.monitorId;
                var subscribers = await SubscriberService.findBy({ monitorId: monitorId });
                subscribers.forEach(async (subscriber) => {
                    if (subscriber.statusPageId) {
                        var enabledStatusPage = await StatusPageService.findOneBy({ _id: subscriber.statusPageId, isSubscriberEnabled: true });
                        if (enabledStatusPage) {
                            await _this.sendSubscriberAlert(subscriber, incident, 'Subscriber Incident Acknowldeged');
                        }
                    } else {
                        await _this.sendSubscriberAlert(subscriber, incident, 'Subscriber Incident Acknowldeged');
                    }
                });
            }
        } catch (error) {
            ErrorService.log('alertService.sendIncidentAcknowledgedToSubscribers', error);
            throw error;
        }
    },

    sendIncidentResolvedToSubscribers: async function (incident) {
        try {
            let _this = this;
            if (incident) {
                let monitorId = incident.monitorId._id ? incident.monitorId._id : incident.monitorId;
                var subscribers = await SubscriberService.findBy({ monitorId: monitorId });
                subscribers.forEach(async (subscriber) => {
                    if (subscriber.statusPageId) {
                        var enabledStatusPage = await StatusPageService.findOneBy({ _id: subscriber.statusPageId, isSubscriberEnabled: true });
                        if (enabledStatusPage) {
                            await _this.sendSubscriberAlert(subscriber, incident, 'Subscriber Incident Resolved');
                        }
                    } else {
                        await _this.sendSubscriberAlert(subscriber, incident, 'Subscriber Incident Resolved');
                    }
                });
            }
        } catch (error) {
            ErrorService.log('alertService.sendIncidentResolvedToSubscribers', error);
            throw error;
        }
    },

    sendSubscriberAlert: async function (subscriber, incident, templateType = 'Subscriber Incident Created') {
        try {
            let _this = this;
            let date = new Date();
            var project = await ProjectService.findOneBy({ _id: incident.projectId });
            if (subscriber.alertVia == AlertType.Email) {
                var emailTemplate = await EmailTemplateService.findOneBy({ projectId: incident.projectId, emailType: templateType });
                if (templateType === 'Subscriber Incident Acknowldeged') {
                    await MailService.sendIncidentAcknowledgedMailToSubscriber(date, subscriber.monitorId.name, subscriber.contactEmail, subscriber._id, subscriber.contactEmail, incident, project.name, emailTemplate);
                } else if (templateType === 'Subscriber Incident Resolved') {
                    await MailService.sendIncidentResolvedMailToSubscriber(date, subscriber.monitorId.name, subscriber.contactEmail, subscriber._id, subscriber.contactEmail, incident, project.name, emailTemplate);
                } else {
                    await MailService.sendIncidentCreatedMailToSubscriber(date, subscriber.monitorId.name, subscriber.contactEmail, subscriber._id, subscriber.contactEmail, incident, project.name, emailTemplate);
                }
                await SubscriberAlertService.create({ projectId: incident.projectId, incidentId: incident._id, subscriberId: subscriber._id, alertVia: AlertType.Email, alertStatus: 'Sent' });
            } else if (subscriber.alertVia == AlertType.SMS) {
                var countryCode = await _this.mapCountryShortNameToCountryCode(subscriber.countryCode);
                let contactPhone = subscriber.contactPhone;
                if (countryCode) {
                    contactPhone = countryCode + contactPhone;
                }
                var sendResult;
                var smsTemplate = await SmsTemplateService.findOneBy({ projectId: incident.projectId, smsType: templateType });
                if (templateType === 'Subscriber Incident Acknowldeged') {
                    sendResult = await TwilioService.sendIncidentAcknowldegedMessageToSubscriber(date, subscriber.monitorId.name, contactPhone, smsTemplate, incident, project.name,incident.projectId);
                } else if (templateType === 'Subscriber Incident Resolved') {
                    sendResult = await TwilioService.sendIncidentResolvedMessageToSubscriber(date, subscriber.monitorId.name, contactPhone, smsTemplate, incident, project.name,incident.projectId);
                } else {
                    sendResult = await TwilioService.sendIncidentCreatedMessageToSubscriber(date, subscriber.monitorId.name, contactPhone, smsTemplate, incident, project.name,incident.projectId);
                }
                if(sendResult && sendResult.code && sendResult.code === 400){
                    await SubscriberAlertService.create({ projectId: incident.projectId, incidentId: incident._id, subscriberId: subscriber._id, alertVia: AlertType.SMS, alertStatus: null,error:true,errorMessage:sendResult.message });
                }
                else {
                    await SubscriberAlertService.create({ projectId: incident.projectId, incidentId: incident._id, subscriberId: subscriber._id, alertVia: AlertType.SMS, alertStatus: 'Success' });
                }
            }
        } catch (error) {
            ErrorService.log('alertService.sendSubscriberAlert', error);
            throw error;
        }
    },

    getSendIncidentInterval: async function (incident) {
        try {
            let _this = this;
            let monitorId = incident.monitorId._id ? incident.monitorId._id : incident.monitorId;
            var schedules = await ScheduleService.findOneBy({ monitorIds: monitorId });
            let escalationIds = schedules.escalationIds;
            for (let value of escalationIds) {
                var escalation = await EscalationService.findOneBy({ _id: value._id });
                let callFrequency = parseInt(escalation.callFrequency);

                for (let teamMember of escalation.teamMember) {
                    const { currentTime, startTime, endTime } = await _this.getEscalationTime(teamMember.timezone, teamMember.startTime, teamMember.endTime);
                    if (currentTime >= startTime && currentTime <= endTime) {
                        // time difference in hours
                        let timeDiff = endTime - startTime;
                        // convert to minutes
                        timeDiff *= 60;

                        let interval = timeDiff / callFrequency; // minutes
                        return interval;
                    }
                }
            }
        } catch (error) {
            ErrorService.log('alertService.getSendIncidentInterval', error);
            throw error;
        }
    },

    mapCountryShortNameToCountryCode(shortName) {
        return countryCode[[shortName]];
    },

    clientTimeZoneTime(offset) {
        // create Date object for current location
        var d = new Date();

        // convert to msec
        // subtract local time zone offset
        // get UTC time in msec
        var utc = d.getTime() + (d.getTimezoneOffset() * 60000);

        // create new Date object for different timezone
        // using supplied offset
        var nd = new Date(utc + (3600000 * offset));

        // return time as a string
        return nd.toLocaleString();
    },

    async getEscalationTime(timezone, escalationStartTime, escalationEndTime) {
        var _this = this;
        let offset = timezone.substr(timezone.lastIndexOf(' '), 7).trim().replace(':', '.');
        let currentDateTime = await _this.clientTimeZoneTime(offset);
        let currentTime = currentDateTime.substr(currentDateTime.indexOf(' '), currentDateTime.indexOf(':') - currentDateTime.indexOf(' ')).trim();
        let currentHr = currentDateTime.substr(currentDateTime.lastIndexOf(' ')).trim();
        let startTime = escalationStartTime.substr(0, escalationStartTime.indexOf(':')).trim();
        let endTime = escalationEndTime.substr(0, escalationEndTime.indexOf(':')).trim();
        let startHr = escalationStartTime.substr(escalationStartTime.lastIndexOf(' ')).trim();
        let endHr = escalationEndTime.substr(escalationEndTime.lastIndexOf(' ')).trim();

        if (currentHr === 'AM') {
            currentTime = parseInt(currentTime) === 12 ? 0 : parseInt(currentTime);
        } else if (currentHr === 'PM') {
            currentTime = parseInt(currentTime) === 12 ? parseInt(currentTime) : parseInt(currentTime) + 12;
        } else {
            currentTime = parseInt(currentTime);
        }

        var startTimeDate = new Date(escalationStartTime);
        var endTimeDate = new Date(escalationEndTime);

        var startDate = moment(startTimeDate).toObject().date;
        var endDate = moment(endTimeDate).toObject().date;

        startTime = moment(startTimeDate).toObject().hours;
        endTime = moment(endTimeDate).toObject().hours;

        if(startDate !== endDate){
            endTime = ((endDate - startDate) * 24) + endTime;
        }
        return { currentTime, startTime, endTime };
    },

    getSubProjectAlerts: async function (subProjectIds) {
        var _this = this;
        let subProjectAlerts = await Promise.all(subProjectIds.map(async (id) => {
            let alerts = await _this.findBy({ projectId: id }, 0, 10);
            let count = await _this.countBy({ projectId: id });
            return { alerts, count, _id: id, skip: 0, limit: 10 };
        }));
        return subProjectAlerts;
    },

    hardDeleteBy: async function (query) {
        try {
            await AlertModel.deleteMany(query);
            return 'Alert(s) removed successfully';
        } catch (error) {
            ErrorService.log('alertService.hardDeleteBy', error);
            throw error;
        }
    },

    restoreBy: async function (query) {
        const _this = this;
        query.deleted = true;
        let alert = await _this.findBy(query);
        if (alert && alert.length > 1) {
            const alerts = await Promise.all(alert.map(async (alert) => {
                const alertId = alert._id;
                alert = await _this.updateOneBy({
                    _id: alertId
                }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                return alert;
            }));
            return alerts;
        } else {
            alert = alert[0];
            if (alert) {
                const alertId = alert._id;
                alert = await _this.updateOneBy({
                    _id: alertId
                }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
            }
            return alert;
        }
    },
    getBalanceStatus: async function (projectId, alertPhoneNumber, alertType) {
        var project = await ProjectService.findOneBy({ _id: projectId });
        var balance = project.balance;
        var countryCode = alertPhoneNumber.split(' ')[0];
        var countryType = getCountryType(countryCode);
        var alertChargeAmount = getAlertChargeAmount(alertType, countryType);
        return {
            chargeAmount: alertChargeAmount.price,
            closingBalance: balance
        };
    },

    checkPhoneAlertsLimit: async function (projectId) {
        var _this = this;
        var yesterday = new Date(new Date().getTime() - (24*60*60*1000));
        let alerts = await _this.countBy({ projectId: projectId ,alertVia : {$in: [AlertType.Call, AlertType.SMS]},error : {$in: [null, undefined,false]},createdAt:{$gte: yesterday}});
        let smsCounts = await SmsCountService.countBy({ projectId: projectId, createdAt: { '$gte': yesterday } });
        let project = await ProjectService.findOneBy({ _id: projectId });
        let limit = project && project.alertLimit ? project.alertLimit : twilioAlertLimit;
        if(limit && typeof limit === 'string'){
            limit = parseInt(limit,10);
        }
        if((alerts + smsCounts) <= limit){
            return true;
        }
        else {
            await ProjectService.updateOneBy({_id:projectId},{alertLimitReached:true});
            return false;
        }
    },
};

let AlertModel = require('../models/alert');
let ProjectService = require('./projectService');
let PaymentService = require('./paymentService');
let AlertType = require('../config/alertType');
let ScheduleService = require('./scheduleService');
let SubscriberService = require('./subscriberService');
let SubscriberAlertService = require('./subscriberAlertService');
let EmailTemplateService = require('./emailTemplateService');
let SmsTemplateService = require('./smsTemplateService');
let EscalationService = require('./escalationService');
let MailService = require('./mailService');
let UserService = require('./userService');
let MonitorService = require('./monitorService');
let TwilioService = require('./twilioService');
let ErrorService = require('./errorService');
let StatusPageService = require('./statusPageService');
let AlertChargeService = require('./alertChargeService');
let jwtKey = require('../config/keys');
let countryCode = require('../config/countryCode');
let jwt = require('jsonwebtoken');
const baseApiUrl = require('../config/baseApiUrl');
let { getAlertChargeAmount, getCountryType } = require('../config/alertType');
var moment = require('moment');
var { twilioAlertLimit } = require('../config/twilio');
var SmsCountService = require('./smsCountService');
const momentTz = require('moment-timezone');
const TimeZoneNames = momentTz.tz.names();
const computeActiveTeams = require('./escalationService').computeActiveTeams;
