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
        let start = moment(startDate).toDate();
        let end = moment(endDate).toDate();

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }
        // Use aggregate to proccess data
        try {
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
        } catch (error) {
            ErrorService.log('IncidentModel.aggregate', error);
            throw error;
        }
        let arr = [];
        let wrapper = {};
        const filterMembers = result[0].members.filter(member => member._id !== null);
        for (const member of filterMembers) {
            try {
                var response = await UserService.findOneBy({ _id: member._id });
            } catch (error) {
                ErrorService.log('', error);
                throw error;
            }
            let result = { memberId: member._id, memberName: response.name, incidents: member.incidents, averageAcknowledgeTime: member.averageAcknowledge, averageResolved: member.averageResolved };
            arr.push(result);
        }
        wrapper['members'] = arr;
        wrapper['count'] = result[0].total[0] ? result[0].total[0].count : 0;
        return wrapper;
    },
    /**
   * @method getMostActiveMonitor
   * @description get total number of incident for the month
   * the most incidents
   * @param { string } projectId of project to query
   * @returns {Promise} rejected if their is an error resolves if all is good
   */
    async getMostActiveMonitors(subProjectIds, startDate, endDate, skip, limit) {
        let start = moment(startDate).toDate();
        let end = moment(endDate).toDate();

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }
        // Use aggregate to proccess data
        try {
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
        } catch (error) {
            ErrorService.log('IncidentModel.aggregate', error);
            throw error;
        }
        let arr = [];
        let wrapper = {};
        for (const monitor of result[0].monitors) {
            try {
                var response = await MonitorService.findOneBy({ _id: monitor._id });
            } catch (error) {
                ErrorService.log('', error);
                throw error;
            }
            if (!response) response = {};
            let monitorObj = { monitorId: monitor._id, monitorName: response.name, incidents: monitor.incidents, averageAcknowledgeTime: monitor.averageAcknowledge, averageResolved: monitor.averageResolved };
            arr.push(monitorObj);
        }
        wrapper['monitors'] = arr;
        wrapper['count'] = result[0].total[0] ? result[0].total[0].count : 0;
        return wrapper;
    },
    /**
   * @param { String } projectId id of current project
   * @description get the average resolve time for the current month
   * @returns { Promise } array if resolved || error if rejected
   */
    async getAverageTimeMonth(subProjectIds) {
        const endDate = new Date();
        const startDate = moment(endDate).subtract(11, 'months').toDate();
        try {
            var result = await IncidentModel.aggregate([
                { $match: { $and: [{ projectId: { $in: subProjectIds } }, { resolved: true }, { createdAt: { $gte: startDate, $lte: endDate } }] } },
                { $project: { resolveTime: { $subtract: ['$resolvedAt', '$createdAt'] }, createdAt: 1 } },
                { $group: { _id: { month: { $month: '$createdAt' } }, count: { $sum: 1 }, averageResolveTime: { $avg: '$resolveTime' } } },
                { $sort: { '_id.month': 1 } }
            ]);
        } catch (error) {
            ErrorService.log('IncidentModel.aggregate', error);
            throw error;
        }
        const formarted = [];
        for (const month of result) {
            formarted.push({
                month: moment(month._id.month, 'MM').format('MMMM'),
                incidents: month.count,
                averageResolved: parseInt(moment.duration(month.averageResolveTime).asSeconds().toFixed(0), 10)
            });
        }
        return formarted;
    },
    /**
   * @param { String } projectId id of current project
   * @description get the number of incidents for the past 12 months
   * @returns { Promise } array if resolved || error if rejected
   */
    async getMonthlyIncidentCount(subProjectIds) {
        const endDate = new Date();
        const startDate = moment(endDate).subtract(11, 'months').toDate();
        try {
            var result = await IncidentModel.aggregate([
                { $match: { $and: [{ projectId: { $in: subProjectIds } }, { createdAt: { $gte: startDate, $lte: endDate } }] } },
                { $group: { _id: { month: { $month: '$createdAt' } }, count: { $sum: 1 } } },
                { $sort: { '_id.month': 1 } }
            ]);
        } catch (error) {
            ErrorService.log('IncidentModel.aggregate', error);
            throw error;
        }
        const formarted = [];
        for (const month of result) {
            formarted.push({
                month: moment(month._id.month, 'MM').format('MMMM'),
                incidents: month.count,
            });
        }
        return formarted;
    },

};

const moment = require('moment');
const IncidentModel = require('../models/incident');
const UserService = require('./userService');
const MonitorService = require('./monitorService');
const ErrorService = require('./errorService');
