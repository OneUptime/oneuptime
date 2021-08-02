module.exports = {
    create: async function(data) {
        try {
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
            incidentTimeline.status = data.status;

            incidentTimeline = await incidentTimeline.save();

            const populateIncTimeline = [
                { path: 'createdById', select: 'name' },
                {
                    path: 'probeId',
                    select: 'probeName probeImage',
                },
                { path: 'incidentId', select: 'idNumber' },
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
                RealTimeService.updateIncidentTimeline(_incidentTimeline);
            }

            return incidentTimeline;
        } catch (error) {
            ErrorService.log('incidentTimelineService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
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
                { path: 'incidentId', select: 'idNumber' },
            ];
            const selectIncTimeline =
                'incidentId createdById probeId createdByZapier createdAt status incident_state';
            incidentTimeline = await this.findOneBy({
                query,
                populate: populateIncTimeline,
                select: selectIncTimeline,
            });

            return incidentTimeline;
        } catch (error) {
            ErrorService.log('incidentTimelineService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;

            let incidentTimelines = await IncidentTimelineModel.updateMany(
                query,
                {
                    $set: data,
                }
            );

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
        } catch (error) {
            ErrorService.log('incidentTimelineService.updateMany', error);
            throw error;
        }
    },

    findBy: async function({ query, skip, limit, select, populate }) {
        try {
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

            incidentTimelinesQuery = handleSelect(
                select,
                incidentTimelinesQuery
            );
            incidentTimelinesQuery = handlePopulate(
                populate,
                incidentTimelinesQuery
            );

            const incidentTimelines = await incidentTimelinesQuery;

            return incidentTimelines;
        } catch (error) {
            ErrorService.log('incidentTimelineService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;

            let incidentTimelineQuery = IncidentTimelineModel.findOne(
                query
            ).lean();

            incidentTimelineQuery = handleSelect(select, incidentTimelineQuery);
            incidentTimelineQuery = handlePopulate(
                populate,
                incidentTimelineQuery
            );

            const incidentTimeline = await incidentTimelineQuery;
            return incidentTimeline;
        } catch (error) {
            ErrorService.log('incidentTimelineService.findOneBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;

            const count = await IncidentTimelineModel.countDocuments(query);

            return count;
        } catch (error) {
            ErrorService.log('incidentTimelineService.countBy', error);
            throw error;
        }
    },

    // fetches just the last/latest incident timeline
    // this timelines will be used in status page
    getIncidentLastTimelines: async function(incidents) {
        const _this = this;
        try {
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
        } catch (error) {
            ErrorService.log(
                'incidentTimelineService.statusPageTimelines',
                error
            );
            throw error;
        }
    },
    deleteBy: async function(query, userId) {
        try {
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
        } catch (error) {
            ErrorService.log('incidentTimelineService.deletedBy', error);
            throw error;
        }
    },
};

const IncidentTimelineModel = require('../models/incidentTimeline');
const IncidentService = require('./incidentService');
const RealTimeService = require('./realTimeService');
const ErrorService = require('./errorService');
const flattenArray = require('../utils/flattenArray');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
