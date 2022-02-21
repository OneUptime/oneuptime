module.exports = {
    create: async function(data) {
        let incidentTimeline = new IncidentTimelineModel();

        incidentTimeline.incidentId = data.incidentId;
        if (data.createdById) {
            incidentTimeline.createdById = data.createdById;
        }
        if (data.probeId) {
            incidentTimeline.probeId = data.probeId;
        }
        if (data.incident_state) {
            incidentTimeline.incident_state = data.incident_state;
        }
        incidentTimeline.createdByZapier = data.createdByZapier || false;
        incidentTimeline.createdByApi = data.createdByApi || false;
        incidentTimeline.status = data.status;

        incidentTimeline = await incidentTimeline.save();

        const populateIncTimeline = [
            { path: 'createdById', select: 'name' },
            {
                path: 'probeId',
                select: 'probeName probeImage',
            },
            { path: 'incidentId', select: 'idNumber slug' },
        ];
        const selectIncTimeline =
            'incidentId createdById probeId createdByZapier createdAt status incident_state';

        const [timeline, incident] = await Promise.all([
            this.findOneBy({
                query: { _id: incidentTimeline._id },
                select: selectIncTimeline,
                populate: populateIncTimeline,
            }),
            IncidentService.findOneBy({
                query: { _id: data.incidentId },
                select: 'projectId',
            }),
        ]);
        incidentTimeline = timeline;

        if (incident && incidentTimeline) {
            const _incidentTimeline = Object.assign({}, incidentTimeline, {
                projectId: incident.projectId._id || incident.projectId,
            });
            try {
                RealTimeService.updateIncidentTimeline(_incidentTimeline);
            } catch (error) {
                ErrorService.log(
                    'realtimeService.updateIncidentTimeline',
                    error
                );
            }
        }

        return incidentTimeline;
    },

    updateOneBy: async function(query, data) {
        if (!query) {
            query = {};
        }
        query.deleted = false;

        let incidentTimeline = await IncidentTimelineModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );
        const populateIncTimeline = [
            { path: 'createdById', select: 'name' },
            {
                path: 'probeId',
                select: 'probeName probeImage',
            },
            { path: 'incidentId', select: 'idNumber slug' },
        ];
        const selectIncTimeline =
            'incidentId createdById probeId createdByZapier createdAt status incident_state';
        incidentTimeline = await this.findOneBy({
            query,
            populate: populateIncTimeline,
            select: selectIncTimeline,
        });

        return incidentTimeline;
    },

    updateBy: async function(query, data) {
        if (!query) {
            query = {};
        }
        query.deleted = false;

        let incidentTimelines = await IncidentTimelineModel.updateMany(query, {
            $set: data,
        });

        const populateIncTimeline = [
            { path: 'createdById', select: 'name' },
            {
                path: 'probeId',
                select: 'probeName probeImage',
            },
        ];
        const selectIncTimeline =
            'incidentId createdById probeId createdByZapier createdAt status incident_state';
        incidentTimelines = await this.findBy({
            query,
            select: selectIncTimeline,
            populate: populateIncTimeline,
        });

        return incidentTimelines;
    },

    findBy: async function({ query, skip, limit, select, populate }) {
        if (!skip) skip = 0;
        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = parseInt(skip);
        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) {
            query = {};
        }
        query.deleted = false;

        let incidentTimelinesQuery = IncidentTimelineModel.find(query)
            .lean()
            .sort({ createdAt: 1 })
            .limit(limit)
            .skip(skip);

        incidentTimelinesQuery = handleSelect(select, incidentTimelinesQuery);
        incidentTimelinesQuery = handlePopulate(
            populate,
            incidentTimelinesQuery
        );

        const incidentTimelines = await incidentTimelinesQuery;

        return incidentTimelines;
    },

    findOneBy: async function({ query, select, populate }) {
        if (!query) {
            query = {};
        }
        query.deleted = false;

        let incidentTimelineQuery = IncidentTimelineModel.findOne(query).lean();

        incidentTimelineQuery = handleSelect(select, incidentTimelineQuery);
        incidentTimelineQuery = handlePopulate(populate, incidentTimelineQuery);

        const incidentTimeline = await incidentTimelineQuery;
        return incidentTimeline;
    },

    countBy: async function(query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;

        const count = await IncidentTimelineModel.countDocuments(query);

        return count;
    },

    // fetches just the last/latest incident timeline
    // this timelines will be used in status page
    getIncidentLastTimelines: async function(incidents) {
        const _this = this;
        const skip = 0,
            limit = 1;

        const populateIncTimeline = [
            { path: 'createdById', select: 'name' },
            {
                path: 'probeId',
                select: 'probeName probeImage',
            },
        ];
        const selectIncTimeline =
            'incidentId createdById probeId createdByZapier createdAt status incident_state';
        let timelines = await Promise.all(
            incidents.map(async incident => {
                const timeline = await _this.findBy({
                    query: { incidentId: incident._id },
                    skip,
                    limit,
                    select: selectIncTimeline,
                    populate: populateIncTimeline,
                });
                return timeline;
            })
        );

        timelines = flattenArray(timelines);
        return timelines;
    },
    deleteBy: async function(query, userId) {
        if (!query) {
            query = {};
        }
        query.deleted = false;

        const incidentTimelineModel = await IncidentTimelineModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            },
            {
                new: true,
            }
        );
        return incidentTimelineModel;
    },
};

const IncidentTimelineModel = require('../models/incidentTimeline');
const IncidentService = require('./incidentService');
const RealTimeService = require('./realTimeService');
const ErrorService = require('common-server/utils/error');
const flattenArray = require('../utils/flattenArray');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
