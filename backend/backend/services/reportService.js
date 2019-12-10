/* eslint-disable quotes */

/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

module.exports = {
    /**
   * @method getMostActiveMembers
   * @description get the most active member who resolved 
   * the most incidents
   * @param { string } projectId of project to query
   * @returns {Promise} rejected if their is an error resolves if all is good
   */
    async getMostActiveMembers(subProjectIds, startDate, endDate, skip, limit) {
        try {
            let start = moment(startDate).toDate();
            let end = moment(endDate).toDate();
            
            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }
            
            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }
            // Use aggregate to proccess data
            var result = await IncidentModel.aggregate([
                { $match: { $and: [{ projectId: { $in: subProjectIds } }, { resolved: true }, { createdAt: { $gte: start, $lte: end } }] } },
                { $project: { resolveTime: { $subtract: ['$resolvedAt', '$createdAt'] }, acknowledgeTime: { $subtract: ['$acknowledgedAt', '$createdAt'] }, createdAt: 1, resolvedBy: 1 } },
                { $group: { _id: '$resolvedBy', incidents: { $sum: 1 }, averageAcknowledge: { $avg: '$acknowledgeTime' }, averageResolved: { $avg: '$resolveTime' } } },
                { $sort: { incidents: -1 } },
                {
                    $facet: {
                        members: [
                            { $skip: skip || 0 }, { $limit: limit || 10 }
                        ],
                        total: [{ $count: 'count' }]
                    }
                }
            ]);

            var arr = [];
            var wrapper = {};
            const filterMembers = result[0].members.filter(member => member._id !== null);
            for (const member of filterMembers) {
                var response = await UserService.findOneBy({ _id: member._id });

                let result = { memberId: member._id, memberName: response.name, incidents: member.incidents, averageAcknowledgeTime: member.averageAcknowledge, averageResolved: member.averageResolved };
                arr.push(result);
            }
            wrapper['members'] = arr;
            wrapper['count'] = result[0].total[0] ? result[0].total[0].count : 0;
            return wrapper;
        } catch (error) {
            ErrorService.log('reportService.getMostActiveMembers', error);
            throw error;
        }
    },
    /**
   * @method getMostActiveMonitor
   * @description get total number of incident for the month
   * the most incidents
   * @param { string } projectId of project to query
   * @returns {Promise} rejected if their is an error resolves if all is good
   */
    async getMostActiveMonitors(subProjectIds, startDate, endDate, skip, limit) {
        try {
            let start = moment(startDate).toDate();
            let end = moment(endDate).toDate();
    
            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }
    
            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }
            // Use aggregate to proccess data
            var result = await IncidentModel.aggregate([
                { $match: { $and: [{ projectId: { $in: subProjectIds } }, { resolved: true }, { createdAt: { $gte: start, $lte: end } }] } },
                { $project: { resolveTime: { $subtract: ['$resolvedAt', '$createdAt'] }, acknowledgeTime: { $subtract: ['$acknowledgedAt', '$createdAt'] }, createdAt: 1, monitorId: 1 } },
                { $group: { _id: '$monitorId', incidents: { $sum: 1 }, averageAcknowledge: { $avg: '$acknowledgeTime' }, averageResolved: { $avg: '$resolveTime' } } },
                { $sort: { incidents: -1 } },
                {
                    $facet: {
                        monitors: [
                            { $skip: skip || 0 }, { $limit: limit || 10 }
                        ],
                        total: [{ $count: 'count' }]
                    }
                }
            ]);

            var arr = [];
            var wrapper = {};
            for (const monitor of result[0].monitors) {
                var response = await MonitorService.findOneBy({ _id: monitor._id });

                if (!response) response = {};
                let monitorObj = { monitorId: monitor._id, monitorName: response.name, incidents: monitor.incidents, averageAcknowledgeTime: monitor.averageAcknowledge, averageResolved: monitor.averageResolved };
                arr.push(monitorObj);
            }
            wrapper['monitors'] = arr;
            wrapper['count'] = result[0].total[0] ? result[0].total[0].count : 0;
            return wrapper;
        } catch (error) {
            ErrorService.log('reportService.getMostActiveMonitors', error);
            throw error;
        }
    },
    /**
   * @param { String } subProjectIds id of current project
   * @param { String } startDate start date of range
   * @param { String } startDate end date of range
   * @param { String } filter date filter
   * @description get the average resolve time for the current month
   * @returns { Promise } array if resolved || error if rejected
   */
    async getAverageTimeBy(subProjectIds, startDate, endDate, filter) {
        try {
            let start = moment(startDate).toDate();
            let end = moment(endDate).toDate();
            let group, sort, inputFormat, outputFormat;
    
            if (filter === 'day') {
                group = { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } } }, count: { $sum: 1 }, averageResolveTime: { $avg: '$resolveTime' } };
                sort = { '_id.day': 1 };
    
                inputFormat = 'YYYY-MM-DD';
                outputFormat = 'MMM Do YYYY';
            }
            if (filter === 'week') {
                group = { _id: { week: { $dateToString: { format: "%Y-%U", date: "$createdAt" } } }, count: { $sum: 1 }, averageResolveTime: { $avg: '$resolveTime' } };
                sort = { '_id.week': 1 };
    
                inputFormat = 'YYYY-ww';
                outputFormat = 'wo [week of] YYYY';
            }
            if (filter === 'month') {
                group = { _id: { month: { $dateToString: { format: "%Y-%m", date: "$createdAt" } } }, count: { $sum: 1 }, averageResolveTime: { $avg: '$resolveTime' } };
                sort = { '_id.month': 1 };
    
                inputFormat = 'YYYY-MM';
                outputFormat = 'MMM YYYY';
            }
            if (filter === 'year') {
                group = { _id: { year: { $year: '$createdAt' } }, count: { $sum: 1 }, averageResolveTime: { $avg: '$resolveTime' } };
                sort = { '_id.year': 1 };
    
                inputFormat = 'YYYY';
                outputFormat = 'YYYY';
            }
            var result = await IncidentModel.aggregate([
                { $match: { $and: [{ projectId: { $in: subProjectIds } }, { resolved: true }, { createdAt: { $gte: start, $lte: end } }] } },
                { $project: { resolveTime: { $subtract: ['$resolvedAt', '$createdAt'] }, createdAt: 1 } },
                { $group: group },
                { $sort: sort }
            ]);

            const formarted = [];
    
            for (const period of result) {
                const data = {
                    incidents: period.count,
                    averageResolved: parseInt(moment.duration(period.averageResolveTime).asSeconds().toFixed(0), 10)
                };
                data[filter] = moment(period._id[filter], inputFormat).format(outputFormat);
    
                formarted.push(data);
            }
            return formarted;
        } catch (error) {
            ErrorService.log('reportService.getAverageTimeBy', error);
            throw error;
        }
    },
    /**
      * @param { String } subProjectIds id of current project
      * @param { String } startDate start date of range
      * @param { String } startDate end date of range
      * @param { String } filter date filter
      * @description get the number of incidents for the past 12 months
      * @returns { Promise } array if resolved || error if rejected
      */
    async getIncidentCountBy(subProjectIds, startDate, endDate, filter) {
        try {
            let start = moment(startDate).toDate();
            let end = moment(endDate).toDate();
            let group, sort, inputFormat, outputFormat;
    
            if (filter === 'day') {
                group = { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } } }, count: { $sum: 1 } };
                sort = { '_id.day': 1 };
    
                inputFormat = 'YYYY-MM-DD';
                outputFormat = 'MMM Do YYYY';
            }
            if (filter === 'week') {
                group = { _id: { week: { $dateToString: { format: "%Y-%U", date: "$createdAt" } } }, count: { $sum: 1 } };
                sort = { '_id.week': 1 };
    
                inputFormat = 'YYYY-ww';
                outputFormat = 'wo [week of] YYYY';
            }
            if (filter === 'month') {
                group = { _id: { month: { $dateToString: { format: "%Y-%m", date: "$createdAt" } } }, count: { $sum: 1 } };
                sort = { '_id.month': 1 };
    
                inputFormat = 'YYYY-MM';
                outputFormat = 'MMM YYYY';
            }
            if (filter === 'year') {
                group = { _id: { year: { $year: '$createdAt' } }, count: { $sum: 1 } };
                sort = { '_id.year': 1 };
    
                inputFormat = 'YYYY';
                outputFormat = 'YYYY';
            }
            var result = await IncidentModel.aggregate([
                { $match: { $and: [{ projectId: { $in: subProjectIds } }, { createdAt: { $gte: start, $lte: end } }] } },
                { $group: group },
                { $sort: sort }
            ]);
            const formarted = [];
    
            for (const period of result) {
                const data = {
                    incidents: period.count
                };
                data[filter] = moment(period._id[filter], inputFormat).format(outputFormat);
    
                formarted.push(data);
            }
            return formarted;
        } catch (error) {
            ErrorService.log('reportService.getIncidentCountBy', error);
            throw error;
        }
    },
};

const moment = require('moment');
const IncidentModel = require('../models/incident');
const UserService = require('./userService');
const MonitorService = require('./monitorService');
const ErrorService = require('./errorService');
