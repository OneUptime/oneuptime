/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {

    findBy: async function (query, skip, limit) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof (skip) === 'string') skip = parseInt(skip);

        if (typeof (limit) === 'string') limit = parseInt(limit);

        if (!query) query = {};

        query.deleted = false;
        try{
            var statusPages = await StatusPageModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate('monitorIds', 'name')
                .lean();
        }catch(error){
            ErrorService.log('StatusPageModel.find', error);
            throw error;
        }
        return statusPages;
    },

    create: async function (data) {
        var statusPageModel = new StatusPageModel();
        statusPageModel.projectId = data.projectId || null;
        statusPageModel.domain = data.domain || null;
        statusPageModel.links = data.links || null;
        statusPageModel.title = data.title || null;
        statusPageModel.name = data.name || null;
        statusPageModel.isPrivate = data.isPrivate || null;
        statusPageModel.description = data.description || null;
        statusPageModel.copyright = data.copyright || null;
        statusPageModel.faviconPath = data.faviconPath || null;
        statusPageModel.logoPath = data.logoPath || null;
        statusPageModel.deleted = data.deleted || false;
        statusPageModel.isSubscriberEnabled = data.isSubscriberEnabled || false;

        if (!data.monitorIds) {
            statusPageModel.monitorIds = null;
        }
        else {
            // if monitorIds is array
            if (data.monitorIds.length !== undefined) {
                statusPageModel.monitorId = [];
                for (let monitorId of data.monitorIds) {
                    statusPageModel.monitorId.push(monitorId);
                }
            } else {
                statusPageModel.monitorId = data.monitorIds;
            }
        }
        try{
            var statusPage = await statusPageModel.save();
        }catch(error){
            ErrorService.log('statusPageModel.save', error);
            throw error;
        }
        return statusPage;
    },


    countBy: async function (query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        try{
            var count = await StatusPageModel.count(query);
        }catch(error){
            ErrorService.log('StatusPageModel.count', error);
            throw error;
        }
        return count;
    },

    deleteBy: async function (query, userId) {
        if (!query) {
            query = {};
        }

        query.deleted = false;

        try{
            var statusPage = await StatusPageModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            },{
                new: true
            });
        }catch(error){
            ErrorService.log('StatusPageModel.findOneAndUpdate', error);
            throw error;
        }
        if(statusPage){
            try{
                var subscribers = await SubscriberService.findBy({statusPageId: statusPage._id});
            }catch(error){
                ErrorService.log('SubscriberService.findBy', error);
            }
            await Promise.all(subscribers.map(async (subscriber) => {
                await SubscriberService.deleteBy({_id: subscriber}, userId);
            }));
        }
        return statusPage;
    },

    removeMonitor: async function (monitorId) {
        try{
            var statusPage = await StatusPageModel.findOneAndUpdate({monitorIds:monitorId}, {
                $pull: {monitorIds: monitorId}
            });
        }catch(error){
            ErrorService.log('StatusPageModel.findOneAndUpdate', error);
            throw error;
        }
        return statusPage;
    },

    findOneBy: async function (query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try{
            var statusPage = await StatusPageModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .populate('monitorIds', 'name');
        }catch(error){
            ErrorService.log('StatusPageModel.findOne', error);
            throw error;
        }

        return statusPage;
    },

    update: async function (data) {
        var _this = this;
        if (!data._id) {
            try{
                let statusPage = await _this.create(data);
                return statusPage;
            }catch(error){
                ErrorService.log('StatusPageService.create', error);
                throw error;
            }
        } else {
            try{
                var oldStatusPage = await _this.findOneBy({ _id: data._id, deleted: { $ne: null } });
            }catch(error){
                ErrorService.log('StatusPageService.findOneBy', error);
                throw error;
            }
            var projectId = data.projectId || oldStatusPage.projectId;
            var domain = data.domain || oldStatusPage.domain;
            var links = data.links || oldStatusPage.links;
            var title = data.title || oldStatusPage.title;
            var name = data.name || oldStatusPage.name;
            var isPrivate = data.isPrivate !== undefined ? data.isPrivate : oldStatusPage.isPrivate;
            var isGroupedByMonitorCategory = data.isGroupedByMonitorCategory !== undefined ? data.isGroupedByMonitorCategory : oldStatusPage.isGroupedByMonitorCategory;
            var showScheduledEvents = data.showScheduledEvents !== undefined ? data.showScheduledEvents : oldStatusPage.showScheduledEvents;
            var description = data.description || oldStatusPage.description;
            var copyright = data.copyright || oldStatusPage.copyright;
            var faviconPath = data.faviconPath || oldStatusPage.faviconPath;
            var logoPath = data.logoPath || oldStatusPage.logoPath;
            var isSubscriberEnabled = data.isSubscriberEnabled !== undefined ? data.isSubscriberEnabled : oldStatusPage.isSubscriberEnabled;
            var monitorIds = [];
            if (!data.monitorIds) {
                monitorIds = oldStatusPage.monitorIds;
            }
            else {
                // if monitorIds is array
                if (data.monitorIds.length !== undefined) {
                    monitorIds = [];
                    for (let monitorId of data.monitorIds) {
                        monitorIds.push(monitorId);
                    }
                } else {
                    monitorIds = data.monitorIds;
                }
            }

            try{
                var updatedStatusPage = await StatusPageModel.findByIdAndUpdate(data._id, {
                    $set: {
                        projectId: projectId,
                        monitorIds: monitorIds,
                        domain: domain,
                        links: links,
                        title: title,
                        name: name,
                        isPrivate: isPrivate,
                        isGroupedByMonitorCategory: isGroupedByMonitorCategory,
                        showScheduledEvents : showScheduledEvents,
                        description: description,
                        copyright: copyright,
                        faviconPath: faviconPath,
                        logoPath: logoPath,
                        isSubscriberEnabled: isSubscriberEnabled,
                    }
                }, {
                    new: true
                });
            }catch(error){
                ErrorService.log('StatusPageModel.findByIdAndUpdate', error);
                throw error;
            }
            return updatedStatusPage;
        }
    },

    getNotes: async function (query, skip, limit) {
        var _this = this;

        if (!skip) skip = 0;

        if (!limit) limit = 5;

        if (typeof (skip) === 'string') skip = parseInt(skip);

        if (typeof (limit) === 'string') limit = parseInt(limit);

        if (!query) query = {};
        try{
            var statuspages = await _this.findBy(query, 0, limit);
        }catch(error){
            ErrorService.log('StatusPageService.findBy', error);
            throw error;
        }
        const withMonitors = statuspages.filter((statusPage) => statusPage.monitorIds.length);
        let statuspage = withMonitors[0];
        var monitorIds = statuspage.monitorIds.map(m => m._id);
        if (monitorIds && monitorIds.length) {
            try{
                var notes = await IncidentService.findBy({ monitorId: { $in: monitorIds } }, limit, skip);
            }catch(error){
                ErrorService.log('IncidentService.findBy', error);
                throw error;
            }
            try{
                var count = await IncidentService.countBy({ monitorId: { $in: monitorIds } });
            }catch(error){
                ErrorService.log('IncidentService.countBy', error);
                throw error;
            }
            return { notes, count };
        }
        else {
            let error = new Error('no monitor to check');
            error.code = 400;
            ErrorService.log('StatusPage.getNotes', error);
            throw error;
        }
    },

    getNotesByDate: async function (query, skip, limit) {
        try{
            var incidents = await IncidentService.findBy(query, limit, skip);
        }catch(error){
            ErrorService.log('IncidentService.findBy', error);
            throw error;
        }
        let investigationNotes = incidents.map(incident => {
            return {
                investigationNote: incident.investigationNote ? incident.investigationNote : '',
                createdAt: incident.createdAt,
                monitorId: incident.monitorId,
                resolved: incident.resolved,
                _id: incident._id,
            };
        });
        try{
            var count = await IncidentService.countBy(query);
        }catch(error){
            ErrorService.log('IncidentService.countBy', error);
            throw error;
        }

        return { investigationNotes, count };
    },

    getMonitorTime: async function (monitorId) {
        var date = new Date();
        var thisObj = this;
        var time;
        try{
            var statusTime = await StatusPageTimeModel.find({ monitorId: monitorId }).sort({ date: 'desc' }).limit(89);
        }catch(error){
            ErrorService.log('StatusPageTimeModel.find', error);
            throw error;
        }
        try{
            var timeBase = await thisObj.calcTime(monitorId, date);
        }catch(error){
            ErrorService.log('StatusPageService.calcTime', error);
            throw error;
        }
        if (statusTime) {
            time = statusTime;
        } else {
            time = [];
        }
        if (timeBase) {
            time.unshift({
                date: new Date().toISOString(),
                monitorId: timeBase.monitorId,
                upTime: timeBase.uptime,
                downTime: timeBase.downtime,
                status: timeBase.status,
            });

        }
        return time;
    },

    getStatus: async function (query, user) {
        var thisObj = this;
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try{
            var statusPage = await StatusPageModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')          
                .populate({
                    path: 'monitorIds',
                    select: 'name data type monitorCategoryId',
                    populate: { path: 'monitorCategoryId', select: 'name' }
                })
                .lean();
        }catch(error){
            ErrorService.log('StatusPageModel.findOne', error);
            throw error;
        }

        if (statusPage && (statusPage._id || statusPage.id)) {
            try{
                var permitted = await thisObj.isPermitted(user, statusPage);
            }catch(error){
                ErrorService.log('StatusPageService.isPermitted', error);
                throw error;
            }
            if (permitted) {
                try{
                    statusPage = await thisObj.mapStatusWithTime(statusPage);
                }catch(error){
                    ErrorService.log('StatusPageService.mapStatusWithTime', error);
                    throw error;
                }
                try{
                    statusPage = await thisObj.calcUptime(statusPage);
                }catch(error){
                    ErrorService.log('StatusPageService.calcUptime', error);
                    throw error;
                }
                return statusPage;
            }
            else {
                let error = new Error('You are unauthorized to access the page please login to continue.');
                error.code = 401;
                ErrorService.log('StatusPageService.getStatus', error);
                throw error;
            }
        }
        else {
            let error = new Error('StatusPage Not present');
            error.code = 400;
            ErrorService.log('StatusPageService.getStatus', error);
            throw error;
        }
    },

    isPermitted: async function (user, statusPage) {
        return new Promise(async (resolve) => {
            if (statusPage.isPrivate) {
                if (user) {
                    try{
                        var project = await ProjectService.findOneBy({ _id: statusPage.projectId._id });
                    }catch(error){
                        ErrorService.log('ProjectService.findOneBy', error);
                        throw error;
                    }
                    if (project && project._id) {
                        if (project.users.some(({ userId }) => userId === user.id)) {
                            resolve(true);
                        }
                        else {
                            resolve(false);
                        }
                    }
                    else {
                        resolve(false);
                    }
                }
                else {
                    resolve(false);
                }
            }
            else {
                resolve(true);
            }
        });
    },

    // Maps statuspage object with time
    mapStatusWithTime: async function (statusobj) {
        var thisObj = this;
        if (statusobj) {
            if(!statusobj.monitorIds) statusobj.monitorIds = [];
            var status = statusobj.monitorIds.map(async (monitors) => {
                try{
                    return thisObj.addTimeToMonitors(monitors);
                }catch(error){
                    ErrorService.log('StatusPageService.addTimeToMonitors', error);
                    throw error;
                }
            });
            var data = await Promise.all(status);
            statusobj.monitorIds = data;
            return statusobj;
        }
    },

    addTimeToMonitors: async function (monitor) {
        var date = new Date();
        var thisObj = this;
        var monitorId = '';
        if (monitor.id) {
            monitorId = monitor.id;
        }
        else {
            monitorId = monitor._id;
        }

        var statusTime = [];
        var timeBase = {};

        /* if(monitor.type === 'manual'){
             statusTime = await MonitorService.getManualMonitorTime(monitorId);
         }
         else{
             statusTime = await StatusPageTimeModel.find({ monitorId }).sort({ date: 'desc' }).limit(89);
             timeBase = await thisObj.calcTime(monitorId, date);
         }*/
        try{
            statusTime = await StatusPageTimeModel.find({ monitorId }).sort({ date: 'desc' }).limit(89);
        }catch(error){
            ErrorService.log('StatusPageTimeModel.find', error);
            throw error;
        }
        try{
            timeBase = await thisObj.calcTime(monitorId, date);
        }catch(error){
            ErrorService.log('StatusPageService.calcTime', error);
            throw error;
        }
        if (statusTime && statusTime.length) {
            monitor.time = statusTime;
        } else {
            monitor.time = [];
        }
        if (timeBase && (timeBase.downtime || timeBase.uptime)) {
            monitor.time.unshift({
                date: new Date().toISOString(),
                monitorId: timeBase.monitorId,
                upTime: timeBase.uptime,
                downTime: timeBase.downtime,
            });

            monitor.stat = timeBase.status;
        } else if (statusTime && statusTime.length) {
            monitor.stat = statusTime[0].status;
        }
        if (!(statusTime && statusTime.length) && !(timeBase && (timeBase.downtime || timeBase.uptime))) {
            monitor.stat = 'online';
        }
        return monitor;
    },


    //Calculate time for whole day
    calcTime: async function (monitorId, date) {
        try{
            var monitorTime = await MonitorService.getMonitorTime(monitorId, date);
        }catch(error){
            ErrorService.log('MonitorService.getMonitorTime', error);
            throw error;
        }
        var uptime = 0;
        var downtime = 0;
        var stat = 'online';
        monitorTime.forEach((time, itr) => {
            if (itr === monitorTime.length - 1) {
                stat = time.status;
            }
            if (time.status === 'online')
                uptime++;
            else if (time.status === 'offline')
                downtime++;
        });
        var data = { uptime, downtime, monitorId, status: stat };
        return data;
    },

    calcUptime: async function (data) {
        data.monitorIds.forEach((element, itr) => {
            var uptime = 0;
            var downtime = 0;
            element.time.forEach(function (el) {
                uptime += el.upTime;
                downtime += el.downTime;
            });
            if (uptime === 0 && downtime === 0) {
                data.monitorIds[itr].totalUptimePercent = 0;
            }
            else {
                data.monitorIds[itr].totalUptimePercent = uptime / (uptime + downtime) * 100;
            }
            if (itr === data.monitorIds.length - 1) {
                return data;
            }
        });
        return data;
    },

    // Records and stores time in database
    recordTime: async function (uptime, downtime, monitorId, stat, yesterday) {

        var StatusPageTimeData = new StatusPageTimeModel();
        StatusPageTimeData.monitorId = monitorId;
        StatusPageTimeData.upTime = uptime;
        StatusPageTimeData.downTime = downtime;
        StatusPageTimeData.status = stat;
        StatusPageTimeData.date = yesterday;
        try{
            await StatusPageTimeData.save();
        }catch(error){
            ErrorService.log('StatusPageTimeData.save', error);
            throw error;
        }
        return monitorId;
    },

    getSubProjectStatusPages: async function(subProjectIds){
        var _this = this;
        let subProjectStatusPages = await Promise.all(subProjectIds.map(async (id)=>{
            let statusPages = await _this.findBy({projectId: id}, 0, 10);
            let count = await _this.countBy({projectId: id});
            return {statusPages, count, _id: id, skip: 0, limit: 10};
        }));
        return subProjectStatusPages;
    },

    hardDeleteBy: async function (query) {
        try{
            await StatusPageModel.deleteMany(query);
        }catch(error){
            ErrorService.log('StatusPageModel.deleteMany', error);
            throw error;
        }
        return 'Status Page(s) Removed Successfully!';
    },
    restoreBy: async function (query){
        const _this = this;
        query.deleted = true;
        let statusPage = await _this.findBy(query);
        if(statusPage && statusPage.length > 1){
            const statusPages = await Promise.all(statusPage.map(async (statusPage) => {
                const statusPageId = statusPage._id;
                statusPage = await _this.update({_id: statusPageId, deleted: true}, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                await SubscriberService.restoreBy({statusPageId, deleted: true});
                return statusPage;
            }));
            return statusPages;
        }else{
            statusPage = statusPage[0];
            if(statusPage){
                const statusPageId = statusPage._id;
                statusPage = await _this.update({_id: statusPage, deleted: true}, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                await SubscriberService.restoreBy({statusPageId, deleted: true});
            }
            return statusPage;
        }
    }
};

var StatusPageModel = require('../models/statusPage');
var StatusPageTimeModel = require('../models/statusPageTime');
var IncidentService = require('./incidentService');
var MonitorService = require('./monitorService');
var ErrorService = require('./errorService');
var SubscriberService = require('./subscriberService');
var ProjectService = require('./projectService');
