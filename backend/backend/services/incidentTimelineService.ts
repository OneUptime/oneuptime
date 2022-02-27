export default {
    create: async function(data: $TSFixMe) {
        let incidentTimeline = new IncidentTimelineModel();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'Docu... Remove this comment to see the full error message
        incidentTimeline.incidentId = data.incidentId;
        if (data.createdById) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdById' does not exist on type 'Doc... Remove this comment to see the full error message
            incidentTimeline.createdById = data.createdById;
        }
        if (data.probeId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type 'Documen... Remove this comment to see the full error message
            incidentTimeline.probeId = data.probeId;
        }
        if (data.incident_state) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident_state' does not exist on type '... Remove this comment to see the full error message
            incidentTimeline.incident_state = data.incident_state;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdByZapier' does not exist on type ... Remove this comment to see the full error message
        incidentTimeline.createdByZapier = data.createdByZapier || false;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdByApi' does not exist on type 'Do... Remove this comment to see the full error message
        incidentTimeline.createdByApi = data.createdByApi || false;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type 'Document... Remove this comment to see the full error message
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

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
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

    updateBy: async function(query: $TSFixMe, data: $TSFixMe) {
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

    findBy: async function({ query, skip, limit, select, populate }: $TSFixMe) {
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

    findOneBy: async function({ query, select, populate }: $TSFixMe) {
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

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }
        query.deleted = false;

        const count = await IncidentTimelineModel.countDocuments(query);

        return count;
    },

    // fetches just the last/latest incident timeline
    // this timelines will be used in status page
    getIncidentLastTimelines: async function(incidents: $TSFixMe) {
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
            incidents.map(async (incident: $TSFixMe) => {
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

        // @ts-expect-error ts-migrate(2322) FIXME: Type 'any[]' is not assignable to type '[unknown, ... Remove this comment to see the full error message
        timelines = flattenArray(timelines);
        return timelines;
    },
    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
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

import IncidentTimelineModel from '../models/incidentTimeline';
import IncidentService from './incidentService';
import RealTimeService from './realTimeService';
import ErrorService from 'common-server/utils/error';
import flattenArray from '../utils/flattenArray';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
