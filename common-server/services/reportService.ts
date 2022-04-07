import PositiveNumber from 'common/types/PositiveNumber';

export default class Service {
    /**
     * @method getMostActiveMembers
     * @description get the most active member who resolved
     * the most incidents
     * @param { string } projectId of project to query
     * @returns {Promise} rejected if their is an error resolves if all is good
     */
    async getMostActiveMembers(
        subProjectIds: $TSFixMe,
        startDate: $TSFixMe,
        endDate: $TSFixMe,
        skip: PositiveNumber,
        limit: PositiveNumber
    ) {
        const format = 'ddd MMM DD YYYY H:m:s GMT';
        const start = moment(startDate, format).toDate();
        const end = moment(endDate, format).toDate();

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }
        // Use aggregate to proccess data
        const result = await IncidentModel.aggregate([
            {
                $match: {
                    $and: [
                        { projectId: { $in: subProjectIds } },
                        { resolved: true },
                        { createdAt: { $gte: start, $lte: end } },
                    ],
                    $or: [{ deleted: false }],
                },
            },
            {
                $project: {
                    resolveTime: {
                        $subtract: ['$resolvedAt', '$createdAt'],
                    },
                    acknowledgeTime: {
                        $subtract: ['$acknowledgedAt', '$createdAt'],
                    },
                    createdAt: 1,
                    resolvedBy: 1,
                },
            },
            {
                $group: {
                    _id: '$resolvedBy',
                    incidents: { $sum: 1 },
                    averageAcknowledge: { $avg: '$acknowledgeTime' },
                    averageResolved: { $avg: '$resolveTime' },
                },
            },
            { $sort: { incidents: -1 } },
            {
                $facet: {
                    members: [{ $skip: skip || 0 }, { $limit: limit || 10 }],
                    total: [{ $count: 'count' }],
                },
            },
        ]).option({ allowDiskUse: true });

        const arr = [];
        const wrapper = {};
        const filterMembers = result[0].members.filter(
            (member: $TSFixMe) => member._id !== null
        );
        for (const member of filterMembers) {
            const response = await UserService.findOneBy({
                query: { _id: member._id },
                select: 'name',
            });

            const result = {
                memberId: member._id,
                memberName: response.name,
                incidents: member.incidents,
                averageAcknowledgeTime: member.averageAcknowledge,
                averageResolved: member.averageResolved,
            };
            arr.push(result);
        }

        wrapper['members'] = arr;

        wrapper['count'] = result[0].total[0] ? result[0].total[0].count : 0;
        return wrapper;
    }
    /**
     * @method getMostActiveMonitor
     * @description get total number of incident for the month
     * the most incidents
     * @param { string } projectId of project to query
     * @returns {Promise} rejected if their is an error resolves if all is good
     */
    async getMostActiveMonitors(
        subProjectIds: $TSFixMe,
        startDate: $TSFixMe,
        endDate: $TSFixMe,
        skip: PositiveNumber,
        limit: PositiveNumber
    ) {
        const format = 'ddd MMM DD YYYY H:m:s GMT';
        const start = moment(startDate, format).toDate();
        const end = moment(endDate, format).toDate();

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }
        // Use aggregate to process data
        const result = await IncidentModel.aggregate([
            { $unwind: '$monitors' },
            {
                $match: {
                    $and: [
                        { projectId: { $in: subProjectIds } },
                        { resolved: true },
                        { createdAt: { $gte: start, $lte: end } },
                        { deleted: false },
                    ],
                },
            },
            {
                $project: {
                    resolveTime: {
                        $subtract: ['$resolvedAt', '$createdAt'],
                    },
                    acknowledgeTime: {
                        $subtract: ['$acknowledgedAt', '$createdAt'],
                    },
                    createdAt: 1,
                    monitors: 1,
                },
            },
            {
                $group: {
                    _id: '$monitors.monitorId',
                    incidents: { $sum: 1 },
                    averageAcknowledge: { $avg: '$acknowledgeTime' },
                    averageResolved: { $avg: '$resolveTime' },
                },
            },
            { $sort: { incidents: -1 } },
            {
                $facet: {
                    monitors: [{ $skip: skip || 0 }, { $limit: limit || 10 }],
                    total: [{ $count: 'count' }],
                },
            },
        ]).option({ allowDiskUse: true });

        const arr = [];
        const wrapper = {};
        for (const monitor of result[0].monitors) {
            let response = await MonitorService.findOneBy({
                query: { _id: monitor._id },
                select: 'name',
            });

            if (!response) response = {};
            const monitorObj = {
                monitorId: monitor._id,
                monitorName: response.name,
                incidents: monitor.incidents,
                averageAcknowledgeTime: monitor.averageAcknowledge,
                averageResolved: monitor.averageResolved,
            };
            arr.push(monitorObj);
        }

        wrapper['monitors'] = arr;

        wrapper['count'] = result[0].total[0] ? result[0].total[0].count : 0;
        return wrapper;
    }
    /**
     * @param { String } subProjectIds id of current project
     * @param { String } startDate start date of range
     * @param { String } startDate end date of range
     * @param { String } filter date filter
     * @description get the average resolve time for the current month
     * @returns { Promise } array if resolved || error if rejected
     */
    async getAverageTimeBy(
        subProjectIds: $TSFixMe,
        startDate: $TSFixMe,
        endDate: $TSFixMe,
        filter: $TSFixMe
    ) {
        const format = 'ddd MMM DD YYYY H:m:s GMT';
        const start = moment(startDate, format).toDate();
        const end = moment(endDate, format).toDate();
        let group, sort, inputFormat, outputFormat;

        if (filter === 'day') {
            group = {
                _id: {
                    day: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$createdAt',
                        },
                    },
                },
                count: { $sum: 1 },
                averageResolveTime: { $avg: '$resolveTime' },
            };
            sort = { '_id.day': 1 };

            inputFormat = 'YYYY-MM-DD';
            outputFormat = 'MMM Do YYYY';
        }
        if (filter === 'week') {
            group = {
                _id: {
                    week: {
                        $dateToString: {
                            format: '%Y-%U',
                            date: '$createdAt',
                        },
                    },
                },
                count: { $sum: 1 },
                averageResolveTime: { $avg: '$resolveTime' },
            };
            sort = { '_id.week': 1 };

            inputFormat = 'YYYY-ww';
            outputFormat = 'wo [week of] YYYY';
        }
        if (filter === 'month') {
            group = {
                _id: {
                    month: {
                        $dateToString: {
                            format: '%Y-%m',
                            date: '$createdAt',
                        },
                    },
                },
                count: { $sum: 1 },
                averageResolveTime: { $avg: '$resolveTime' },
            };
            sort = { '_id.month': 1 };

            inputFormat = 'YYYY-MM';
            outputFormat = 'MMM YYYY';
        }
        if (filter === 'year') {
            group = {
                _id: { year: { $year: '$createdAt' } },
                count: { $sum: 1 },
                averageResolveTime: { $avg: '$resolveTime' },
            };
            sort = { '_id.year': 1 };

            inputFormat = 'YYYY';
            outputFormat = 'YYYY';
        }
        const result = await IncidentModel.aggregate([
            {
                $match: {
                    $and: [
                        { projectId: { $in: subProjectIds } },
                        { resolved: true },
                        { createdAt: { $gte: start, $lte: end } },
                    ],
                },
            },
            {
                $project: {
                    resolveTime: {
                        $subtract: ['$resolvedAt', '$createdAt'],
                    },
                    createdAt: 1,
                },
            },
            { $group: group },
            { $sort: sort },
        ]).option({ allowDiskUse: true });

        const formarted = [];

        for (const period of result) {
            const data = {
                incidents: period.count,
                averageResolved: parseInt(
                    moment
                        .duration(period.averageResolveTime)
                        .asMinutes()
                        .toFixed(0),
                    10
                ),
            };

            data[filter] = moment(period._id[filter], inputFormat).format(
                outputFormat
            );

            formarted.push(data);
        }
        return formarted;
    }
    /**
     * @param { String } subProjectIds id of current project
     * @param { String } startDate start date of range
     * @param { String } startDate end date of range
     * @param { String } filter date filter
     * @description get the number of incidents for the past 12 months
     * @returns { Promise } array if resolved || error if rejected
     */
    async getIncidentCountBy(
        subProjectIds: $TSFixMe,
        startDate: $TSFixMe,
        endDate: $TSFixMe,
        filter: $TSFixMe
    ) {
        const format = 'ddd MMM DD YYYY H:m:s GMT';
        const start = moment(startDate, format).toDate();
        const end = moment(endDate, format).toDate();
        let group, sort, inputFormat, outputFormat;

        if (filter === 'day') {
            group = {
                _id: {
                    day: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$createdAt',
                        },
                    },
                },
                count: { $sum: 1 },
            };
            sort = { '_id.day': 1 };

            inputFormat = 'YYYY-MM-DD';
            outputFormat = 'MMM Do YYYY';
        }
        if (filter === 'week') {
            group = {
                _id: {
                    week: {
                        $dateToString: {
                            format: '%Y-%U',
                            date: '$createdAt',
                        },
                    },
                },
                count: { $sum: 1 },
            };
            sort = { '_id.week': 1 };

            inputFormat = 'YYYY-ww';
            outputFormat = 'wo [week of] YYYY';
        }
        if (filter === 'month') {
            group = {
                _id: {
                    month: {
                        $dateToString: {
                            format: '%Y-%m',
                            date: '$createdAt',
                        },
                    },
                },
                count: { $sum: 1 },
            };
            sort = { '_id.month': 1 };

            inputFormat = 'YYYY-MM';
            outputFormat = 'MMM YYYY';
        }
        if (filter === 'year') {
            group = {
                _id: { year: { $year: '$createdAt' } },
                count: { $sum: 1 },
            };
            sort = { '_id.year': 1 };

            inputFormat = 'YYYY';
            outputFormat = 'YYYY';
        }
        const result = await IncidentModel.aggregate([
            {
                $match: {
                    $and: [
                        { projectId: { $in: subProjectIds } },
                        { createdAt: { $gte: start, $lte: end } },
                    ],
                },
            },
            { $group: group },
            { $sort: sort },
        ]).option({ allowDiskUse: true });
        const formarted = [];

        for (const period of result) {
            const data = {
                incidents: period.count,
            };

            data[filter] = moment(period._id[filter], inputFormat).format(
                outputFormat
            );

            formarted.push(data);
        }
        return formarted;
    }
}

import moment from 'moment';
import IncidentModel from '../models/incident';
import UserService from './UserService';
import MonitorService from './MonitorService';
