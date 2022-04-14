export default class Service {
    async create(data: $TSFixMe): void {
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

        const populateIncTimeline: $TSFixMe = [
            { path: 'createdById', select: 'name' },
            {
                path: 'probeId',
                select: 'probeName probeImage',
            },
            { path: 'incidentId', select: 'idNumber slug' },
        ];
        const selectIncTimeline: $TSFixMe =
            'incidentId createdById probeId createdByZapier createdAt status incident_state';

        const [timeline, incident]: $TSFixMe = await Promise.all([
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
            const _incidentTimeline: $TSFixMe = Object.assign(
                {},
                incidentTimeline,
                {
                    projectId: incident.projectId._id || incident.projectId,
                }
            );
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
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;

        let incidentTimeline: $TSFixMe = await IncidentTimelineModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );
        const populateIncTimeline: $TSFixMe = [
            { path: 'createdById', select: 'name' },
            {
                path: 'probeId',
                select: 'probeName probeImage',
            },
            { path: 'incidentId', select: 'idNumber slug' },
        ];
        const selectIncTimeline: $TSFixMe =
            'incidentId createdById probeId createdByZapier createdAt status incident_state';
        incidentTimeline = await this.findOneBy({
            query,
            populate: populateIncTimeline,
            select: selectIncTimeline,
        });

        return incidentTimeline;
    }

    async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;

        let incidentTimelines: $TSFixMe = await IncidentTimelineModel.updateMany(query, {
            $set: data,
        });

        const populateIncTimeline: $TSFixMe = [
            { path: 'createdById', select: 'name' },
            {
                path: 'probeId',
                select: 'probeName probeImage',
            },
        ];
        const selectIncTimeline: $TSFixMe =
            'incidentId createdById probeId createdByZapier createdAt status incident_state';
        incidentTimelines = await this.findBy({
            query,
            select: selectIncTimeline,
            populate: populateIncTimeline,
        });

        return incidentTimelines;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy): void {
        if (!skip) {
            skip = 0;
        }
        if (!limit) {
            limit = 0;
        }

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }
        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }
        query['deleted'] = false;

        const incidentTimelinesQuery: $TSFixMe = IncidentTimelineModel.find(
            query
        )
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        incidentTimelinesQuery.select(select);
        incidentTimelinesQuery.populate(populate);

        const incidentTimelines: $TSFixMe = await incidentTimelinesQuery;

        return incidentTimelines;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;

        const incidentTimelineQuery: $TSFixMe = IncidentTimelineModel.findOne(
            query
        )
            .sort(sort)
            .lean();

        incidentTimelineQuery.select(select);
        incidentTimelineQuery.populate(populate);

        const incidentTimeline: $TSFixMe = await incidentTimelineQuery;
        return incidentTimeline;
    }

    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;

        const count: $TSFixMe = await IncidentTimelineModel.countDocuments(
            query
        );

        return count;
    }

    // fetches just the last/latest incident timeline
    // this timelines will be used in status page
    async getIncidentLastTimelines(incidents: $TSFixMe): void {
        const skip: $TSFixMe = 0,
            limit = 1;

        const populateIncTimeline: $TSFixMe = [
            { path: 'createdById', select: 'name' },
            {
                path: 'probeId',
                select: 'probeName probeImage',
            },
        ];
        const selectIncTimeline: $TSFixMe =
            'incidentId createdById probeId createdByZapier createdAt status incident_state';
        let timelines: $TSFixMe = await Promise.all(
            incidents.map(async (incident: $TSFixMe) => {
                const timeline: $TSFixMe = await this.findBy({
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
    }

    async deleteBy(query: Query, userId: ObjectID): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;

        const incidentTimelineModel: $TSFixMe =
            await IncidentTimelineModel.findOneAndUpdate(
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
    }
}

import IncidentTimelineModel from '../Models/incidentTimeline';
import ObjectID from 'Common/Types/ObjectID';
import IncidentService from './IncidentService';
import RealTimeService from './realTimeService';
import ErrorService from '../Utils/error';
import flattenArray from '../Utils/flattenArray';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
