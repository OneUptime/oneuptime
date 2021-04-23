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
            incidentTimeline = await this.findOneBy({
                _id: incidentTimeline._id,
            });

            const incident = await IncidentService.findOneBy({
                _id: data.incidentId,
            });

            if (incident) {
                const _incidentTimeline = Object.assign(
                    {},
                    incidentTimeline._doc,
                    { projectId: incident.projectId }
                );
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
            incidentTimeline = await this.findOneBy(query);

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
            incidentTimelines = await this.findBy(query);

            return incidentTimelines;
        } catch (error) {
            ErrorService.log('incidentTimelineService.updateMany', error);
            throw error;
        }
    },

    findBy: async function(query, skip, limit) {
        try {
            if (!skip) skip = 0;
            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);
            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) {
                query = {};
            }
            query.deleted = false;

            const incidentTimelines = await IncidentTimelineModel.find(query)
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip(skip)
                .populate('createdById', 'name')
                .populate({ path: 'probeId', select: 'probeName probeImage' });

            return incidentTimelines;
        } catch (error) {
            ErrorService.log('incidentTimelineService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;

            const incidentTimeline = await IncidentTimelineModel.findOne(query)
                .populate('createdById', 'name')
                .populate('probeId', 'probeName');

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

            let timelines = await Promise.all(
                incidents.map(async incident => {
                    const timeline = await _this.findBy(
                        { incidentId: incident._id },
                        skip,
                        limit
                    );
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
