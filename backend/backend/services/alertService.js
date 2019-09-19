/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    checkBalance: async function (projectId, alertPhoneNumber, userId, alertType) { 
        var project = await ProjectService.findOneBy({_id: projectId});
        var balance = project.balance;
        var countryCode = alertPhoneNumber.split(' ')[0];
        var countryType = getCountryType(countryCode);
        var alertChargeAmount = getAlertChargeAmount(alertType, countryType);
        if( balance > alertChargeAmount.minimumBalance){
            await PaymentService.chargeAlert(userId, projectId, alertChargeAmount.price);
            return true;
        } else {
            return false;
        }
    },
    findBy: async function (query, skip, limit, sort) {

        if(!skip) skip=0;

        if(!limit) limit=10;

        if(!sort) sort=-1;

        if(typeof(skip) === 'string'){
            skip = parseInt(skip);
        }

        if(typeof(limit) === 'string'){
            limit = parseInt(limit);
        }

        if(typeof(sort) === 'string'){
            sort = parseInt(sort);
        }

        if(!query){
            query = {};
        }

        if(!query.deleted) query.deleted = false;
        try{
            var alerts = await AlertModel.find(query)
                .sort([['createdAt', sort]])
                .limit(limit)
                .skip(skip)
                .populate('userId', 'name')
                .populate('monitorId', 'name')
                .populate('projectId', 'name');
        }catch(error){
            ErrorService.log('AlertModel.find`  ', error);
            throw error;
        }
        return alerts;
    },


    create: async function (projectId, monitorId, alertVia, userId, incidentId, alertStatus) {
        try {
            var alert = new AlertModel();
            alert.projectId = projectId;
            alert.monitorId = monitorId;
            alert.alertVia = alertVia;
            alert.userId = userId;
            alert.incidentId = incidentId;
            alert.alertStatus = alertStatus;
            var savedAlert = await alert.save();
            return savedAlert;
        } catch (error) {
            ErrorService.log('alert.save', error);
            throw error;
        }
    },

    countBy: async function (query) {
        if (!query) {
            query = {};
        }

        if(!query.deleted) query.deleted = false;
        try{
            var count = await AlertModel.count(query);
        }catch(error){
            ErrorService.log('AlertModel.count', error);
            throw error;
        }

        return count;
    },

    update: async function (data) {
        var _this = this;
        if(!data._id){
            try{
                var alert = await _this.create(data);
            }catch(error){
                ErrorService.log('AlertService.create', error);
                throw error;
            }
            return alert;
        }else{
            try{
                var oldAlert = await _this.findOneBy({_id: data._id, deleted: { $ne: null }});
            }catch(error){
                ErrorService.log('AlertService.findOneBy', error);
                throw error;
            }
            var projectId = data.projectId || oldAlert.projectId;
            var monitorId = data.monitorId || oldAlert.monitorId;
            var userId = data.userId || oldAlert.userId;
            var incidentId = data.incidentId || oldAlert.incidentId;
            var alertVia = data.alertVia || oldAlert.alertVia;
            var alertStatus = data.alertStatus || oldAlert.alertStatus;
            var deleted = oldAlert.deleted;
            var deletedById = oldAlert.deletedById;
            var deletedAt = oldAlert.deletedAt;

            if(data.deleted === false){
                deleted = false;
                deletedById = null;
                deletedAt = null;
            }
            try{
                var updatedAlert = await AlertModel.findByIdAndUpdate(data._id, {
                    $set: {
                        projectId,
                        monitorId,
                        userId,
                        incidentId,
                        alertVia,
                        alertStatus,
                        deleted,
                        deletedById,
                        deletedAt
                    }
                }, {
                    new: true
                });
            }catch(error){
                ErrorService.log('AlertModel.findByIdAndUpdate', error);
                throw error;
            }
            return updatedAlert;
        }
    },

    deleteBy : async function (query, userId) {
        if(!query){
            query = {};
        }

        query.deleted = false;
        try{
            var alerts = await AlertModel.findOneAndUpdate(query, {
                $set:{
                    deleted: true, 
                    deletedAt: Date.now(),
                    deletedById: userId
                }
            },{
                new: true
            });
        }catch(error){
            ErrorService.log('AlertModel.findOneAndUpdate', error);
            throw error;
        }
        return alerts;
    },

    sendIncidentCreated: async function (incident) {
        if(incident){
            var _this = this;
            var date = new Date();
            let monitorId = incident.monitorId._id ? incident.monitorId._id : incident.monitorId;
            try{
                var monitor = await MonitorService.findOneBy({_id: monitorId});
            }catch(error){
                ErrorService.log('MonitorService.findOneBy', error);
                throw error;
            }
            try{
                var schedules = await ScheduleService.findBy({monitorIds: monitorId});
            }catch(error){
                ErrorService.log('ScheduleService.findBy', error);
                throw error;
            }

            if (schedules.length > 0) {
                schedules.forEach(async schedule => {
                    let monitorName = monitor.name;
                    if (schedule.escalationIds.length) {
                        schedule.escalationIds.forEach(async escalationId => {
                            try{
                                if(escalationId && escalationId._id){
                                    escalationId = escalationId._id;
                                }
                                var escalation = await EscalationService.findOneBy({_id: escalationId});
                            }catch(error){
                                ErrorService.log('EscalationService.findOneBy', error);
                                throw error;
                            }
                            if(escalation){
                                escalation.teamMember.forEach(async (teamMember)=>{
                                    const {currentTime, startTime, endTime} = await _this.getEscalationTime(teamMember.timezone, teamMember.startTime, teamMember.endTime);
                                    if(currentTime >= startTime && currentTime <= endTime){
                                        try{
                                            var user = await UserService.findOneBy({_id: teamMember.member});
                                        }catch(error){
                                            ErrorService.log('UserService.findOneBy', error);
                                            throw error;
                                        }

                                        if (user) {
                                            let accessToken = jwt.sign({
                                                id: user._id,
                                                name: user.name,
                                                email: user.email
                                            }, jwtKey.jwtSecretKey, { expiresIn: 12 * 60 * 60 * 1000 });
                                            if (teamMember.email) {
                                                const queryString = `projectId=${incident.projectId}&&userId=${user._id}&&accessToken=${accessToken}`;
                                                let ack_url = `${baseApiUrl}/incident/${incident.projectId}/acknowledge/${incident._id}?${queryString}`;
                                                let resolve_url = `${baseApiUrl}/incident/${incident.projectId}/resolve/${incident._id}?${queryString}`;
                                                let firstName = user.name;
                                                try{
                                                    var emailTemplate = await EmailTemplateService.findOneBy({projectId: incident.projectId, emailType: 'Team Member Incident'});
                                                }catch(error){
                                                    ErrorService.log('EmailTemplateService.findOneBy', error);
                                                }
                                                try{
                                                    await MailService.sendIncidentCreatedMail(date, monitorName, user.email, user._id, firstName.split(' ')[0], incident.projectId, ack_url, resolve_url, accessToken, emailTemplate);
                                                }catch(error){
                                                    ErrorService.log('MailService.sendIncidentCreatedMail', error);
                                                    throw error;
                                                }
                                                try{
                                                    await _this.create(incident.projectId, monitorId, AlertType.Email, user._id, incident._id);
                                                }catch(error){
                                                    ErrorService.log('AlertService.create', error);
                                                    throw error;
                                                }
                                            }
                                            if (teamMember.sms) {
                                                try{
                                                    let alertStatus;
                                                    let balanceCheckStatus = await _this.checkBalance(incident.projectId, user.alertPhoneNumber, user._id, AlertType.SMS);
                                                    if(balanceCheckStatus){
                                                        let alertSuccess = await TwilioService.sendIncidentCreatedMessage(date, monitorName, user.alertPhoneNumber, incident._id, user._id, user.name);
                                                        if(alertSuccess){
                                                            alertStatus = 'success';
                                                            await _this.create(incident.projectId, monitorId, AlertType.SMS, user._id, incident._id, alertStatus);
                                                        }
                                                    } else { 
                                                        alertStatus = 'Blocked - Low balance';
                                                        await _this.create(incident.projectId, monitorId, AlertType.SMS, user._id, incident._id, alertStatus);
                                                    }
                                                }catch(error){
                                                    ErrorService.log('TwilioService.sendIncidentCreatedMessage', error);
                                                    throw error;
                                                }
                                            }
                                            if (teamMember.call) {
                                                try{
                                                    let alertStatus;
                                                    let balanceCheckStatus = await _this.checkBalance(incident.projectId, user.alertPhoneNumber, user._id, AlertType.Call);
                                                    if(balanceCheckStatus){
                                                        let alertSuccess = await TwilioService.sendIncidentCreatedCall(date, monitorName, user.alertPhoneNumber, incident._id, user._id, user.name);
                                                        if(alertSuccess){
                                                            alertStatus = 'success';
                                                            await _this.create(incident.projectId, monitorId, AlertType.Call, user._id, incident._id, alertStatus);
                                                        }
                                                    } else { 
                                                        alertStatus = 'Blocked - Low balance';
                                                        await _this.create(incident.projectId, monitorId, AlertType.Call, user._id, incident._id, alertStatus);
                                                    }
                                                }catch(error){
                                                    ErrorService.log('TwilioService.sendIncidentCreatedCall', error);
                                                    throw error;
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
    },

    sendIncidentCreatedToSubscribers: async function(incident){
        let _this = this;
        if(incident){
            let monitorId = incident.monitorId._id ? incident.monitorId._id : incident.monitorId;
            try{
                var subscribers = await SubscriberService.findBy({monitorId: monitorId});
            }catch(error){
                ErrorService.log('SubscriberService.findBy', error);
                throw error;
            }
            subscribers.forEach(async (subscriber)=>{
                if(subscriber.statusPageId){
                    try{
                        var enabledStatusPage = await StatusPageService.findOneBy({_id: subscriber.statusPageId, isSubscriberEnabled: true});
                    }catch(error){
                        ErrorService.log('StatusPageService.findOneBy', error);
                        throw error;
                    }
                    if(enabledStatusPage){
                        await _this.sendSubscriberAlert(subscriber, incident);
                    }
                }else{
                    await _this.sendSubscriberAlert(subscriber, incident);
                }
            });
        }
    },

    sendSubscriberAlert: async function(subscriber, incident){
        let _this = this;
        let date = new Date();
        if (subscriber.alertVia == AlertType.Email) {
            try{
                var emailTemplate = await EmailTemplateService.findOneBy({projectId: incident.projectId, emailType: 'Subscriber Incident'});
            }catch(error){
                ErrorService.log('EmailTemplateService.findOneBy', error);
            }
            try{
                await MailService.sendIncidentCreatedMailToSubscriber(date, subscriber.monitorId.name, subscriber.contactEmail, subscriber._id, subscriber.contactEmail, incident.projectId, emailTemplate);
            }catch(error){
                ErrorService.log('MailService.sendIncidentCreatedMailToSubscriber', error);
                throw error;
            }
            try{
                await SubscriberAlertService.create({projectId: incident.projectId, incidentId: incident._id, subscriberId: subscriber._id, alertVia: AlertType.Email, alertStatus: 'Sent'});
            }catch(error){
                ErrorService.log('SubscriberAlertService.create', error);
                throw error;
            }
        } else if (subscriber.alertVia == AlertType.SMS) {
            try{
                var countryCode = await _this.mapCountryShortNameToCountryCode(subscriber.countryCode);
            }catch(error){
                ErrorService.log('AlertService.mapCountryShortNameToCountryCode', error);
                throw error;
            }
            let contactPhone = subscriber.contactPhone;
            if(countryCode){
                contactPhone = countryCode+contactPhone;
            }
            try{
                var smsTemplate = await SmsTemplateService.findOneBy({projectId: incident.projectId, smsType: 'Subscriber Incident'});
            }catch(error){
                ErrorService.log('SmsTemplateService.findOneBy', error);
            }
            try{
                await TwilioService.sendIncidentCreatedMessageToSubscriber(date, subscriber.monitorId.name, contactPhone, smsTemplate,incident.projectId);
            }catch(error){
                ErrorService.log('TwilioService.sendIncidentCreatedMessageToSubscriber', error);
                throw error;
            }
            try{
                await SubscriberAlertService.create({projectId: incident.projectId, incidentId: incident._id, subscriberId: subscriber._id, alertVia: AlertType.SMS, alertStatus: 'Success'});
            }catch(error){
                ErrorService.log('SubscriberAlertService.create', error);
                throw error;
            }
        }
    },

    getSendIncidentInterval: async function(incident){
        let _this = this;
        let monitorId = incident.monitorId._id ? incident.monitorId._id : incident.monitorId;
        try{
            var schedules = await ScheduleService.findOneBy({monitorIds: monitorId});
        }catch(error){
            ErrorService.log('ScheduleService.findOneBy', error);
            throw error;
        }
        let escalationIds = schedules.escalationIds;
        for(let value of escalationIds){
            try{
                var escalation = await EscalationService.findOneBy({_id: value._id});
            }catch(error){
                ErrorService.log('EscalationService.findOneBy', error);
                throw error;
            }

            let callFrequency = parseInt(escalation.callFrequency);
            for(let teamMember of escalation.teamMember){
                const {currentTime, startTime, endTime} = await _this.getEscalationTime(teamMember.timezone, teamMember.startTime, teamMember.endTime);
                if(currentTime >= startTime && currentTime <= endTime){
                    // time difference in hours
                    let timeDiff = endTime - startTime;
                    // convert to minutes
                    timeDiff *= 60;

                    let interval = timeDiff/callFrequency; // minutes
                    return interval;
                }
            }
        }
    },

    mapCountryShortNameToCountryCode(shortName){
        return countryCode[[shortName]];
    },

    clientTimeZoneTime(offset){
        // create Date object for current location
        var d = new Date();

        // convert to msec
        // subtract local time zone offset
        // get UTC time in msec
        var utc = d.getTime() + (d.getTimezoneOffset() * 60000);

        // create new Date object for different timezone
        // using supplied offset
        var nd = new Date(utc + (3600000*offset));

        // return time as a string
        return nd.toLocaleString();
    },

    async getEscalationTime(timezone, escalationStartTime, escalationEndTime){
        var _this = this;
        let offset = timezone.substr(timezone.lastIndexOf(' '), 7).trim().replace(':', '.');
        let currentDateTime = await _this.clientTimeZoneTime(offset);
        let currentTime = currentDateTime.substr(currentDateTime.indexOf(' '), currentDateTime.indexOf(':') - currentDateTime.indexOf(' ')).trim();
        let currentHr = currentDateTime.substr(currentDateTime.lastIndexOf(' ')).trim();
        let startTime = escalationStartTime.substr(0, escalationStartTime.indexOf(':')).trim();
        let endTime = escalationEndTime.substr(0, escalationEndTime.indexOf(':')).trim();
        let startHr = escalationStartTime.substr(escalationStartTime.lastIndexOf(' ')).trim();
        let endHr =  escalationEndTime.substr(escalationEndTime.lastIndexOf(' ')).trim();

        if(currentHr === 'AM'){
            currentTime = parseInt(currentTime) === 12 ? 0 : parseInt(currentTime);
        }else if(currentHr === 'PM'){
            currentTime = parseInt(currentTime) === 12 ? parseInt(currentTime) : parseInt(currentTime) + 12;
        }else{
            currentTime = parseInt(currentTime);
        }

        if(startHr === 'AM'){
            startTime = parseInt(startTime) === 12 ? 0 : parseInt(startTime);
        }else if(startHr === 'PM'){
            startTime = parseInt(startTime) === 12 ? parseInt(startTime) : parseInt(startTime) + 12;
        }else{
            startTime = parseInt(startTime);
        }

        if(endHr === 'AM'){
            endTime = parseInt(endTime) === 12 ? 0 : parseInt(endTime);
        }else if(endHr === 'PM'){
            endTime = parseInt(endTime) === 12 ? parseInt(endTime) : parseInt(endTime) + 12;
        }else{
            endTime = parseInt(endTime);
        }

        return {currentTime, startTime, endTime};
    },

    getSubProjectAlerts: async function(subProjectIds){
        var _this = this;
        let subProjectAlerts = await Promise.all(subProjectIds.map(async (id)=>{
            let alerts = await _this.findBy({projectId: id}, 0, 10);
            let count = await _this.countBy({projectId: id});
            return {alerts, count, _id: id, skip: 0, limit: 10};
        }));
        return subProjectAlerts;
    },

    hardDeleteBy: async function(query){
        try{
            await AlertModel.deleteMany(query);
        }catch(error){
            ErrorService.log('AlertModel.deleteMany', error);
            throw error;
        }
        return 'Alert(s) removed successfully';
    },

    restoreBy: async function(query){
        const _this = this;
        query.deleted = true;
        let alert = await _this.findBy(query);
        if(alert && alert.length > 1){
            const alerts = await Promise.all(alert.map(async (alert) => {
                const alertId = alert._id;
                alert = await _this.update({
                    _id: alertId,
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                return alert;
            }));
            return alerts;
        }else{
            alert = alert[0];
            if(alert){
                const alertId = alert._id;
                alert = await _this.update({
                    _id: alertId,
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
            }
            return alert;
        }
    }
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
let jwtKey = require('../config/keys');
let countryCode = require('../config/countryCode');
let jwt = require('jsonwebtoken');
const baseApiUrl = require('../config/baseApiUrl');
let { getAlertChargeAmount, getCountryType } = require('../config/alertType');