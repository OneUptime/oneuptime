export default class Service {
    async create(data: $TSFixMe): void {
        let incidentMessage = new IncidentMessageModel();

        incidentMessage.content = data.content;

        incidentMessage.incidentId = data.incidentId;

        incidentMessage.createdById = data.createdById;

        incidentMessage.type = data.type;

        incidentMessage.incident_state = data.incident_state;

        incidentMessage.postOnStatusPage = data.post_statuspage;

        incidentMessage = await incidentMessage.save();

        if (!data.ignoreCounter) {
            await IncidentService.refreshInterval(data.incidentId);
        }

        const populate: $TSFixMe = [
            { path: 'incidentId', select: 'idNumber name slug' },
            { path: 'createdById', select: 'name' },
        ];

        const select: $TSFixMe =
            '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

        incidentMessage = await this.findOneBy({
            query: { _id: incidentMessage._id },
            select,
            populate,
        });

        if (incidentMessage && incidentMessage.postOnStatusPage) {
            // run in the background
            RealTimeService.addIncidentNote(incidentMessage);
        }

        return incidentMessage;
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        data.updated = true;
        let incidentMessage = await IncidentMessageModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        const populate: $TSFixMe = [
            { path: 'incidentId', select: 'idNumber name slug' },
            { path: 'createdById', select: 'name' },
        ];

        const select: $TSFixMe =
            '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

        incidentMessage = await this.findOneBy({ query, populate, select });

        // run in the background
        //RealTimeService.applicationLogKeyReset(applicationLog);
        RealTimeService.updateIncidentNote(incidentMessage);
        return incidentMessage;
    }

    async findOneBy({ query, populate, select, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const incidentMessageQuery: $TSFixMe = IncidentMessageModel.findOne(
            query
        )
            .sort(sort)
            .lean();

        incidentMessageQuery.select(select);
        incidentMessageQuery.populate(populate);

        const incidentMessage: $TSFixMe = await incidentMessageQuery;
        return incidentMessage;
    }

    async findBy({ query, skip, limit, populate, select, sort }: FindBy): void {
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
        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const incidentMessagesQuery: $TSFixMe = IncidentMessageModel.find(query)
            .lean()
            .sort(sort) // fetch from latest to oldest
            .limit(limit.toNumber())
            .skip(skip.toNumber());
        incidentMessagesQuery.select(select);
        incidentMessagesQuery.populate(populate);
        const incidentMessages: $TSFixMe = await incidentMessagesQuery;
        return incidentMessages;
    }

    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const count: $TSFixMe = await IncidentMessageModel.countDocuments(
            query
        );

        return count;
    }

    async deleteBy(query: Query, userId: ObjectID): void {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const incidentMessage: $TSFixMe =
            await IncidentMessageModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                        deletedById: userId,
                    },
                },
                { new: true }
            ).populate('deletedById', 'name');
        if (incidentMessage) {
            return incidentMessage;
        } else {
            return null;
        }
    }
}

import IncidentMessageModel from '../Models/incidentMessage';
import ObjectID from 'Common/Types/ObjectID';
import RealTimeService from './realTimeService';
import IncidentService from './IncidentService';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
