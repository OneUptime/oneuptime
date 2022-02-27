export default {
    create: async function(data: $TSFixMe) {
        let incidentMessage = new IncidentMessageModel();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'content' does not exist on type 'Documen... Remove this comment to see the full error message
        incidentMessage.content = data.content;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'Docu... Remove this comment to see the full error message
        incidentMessage.incidentId = data.incidentId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdById' does not exist on type 'Doc... Remove this comment to see the full error message
        incidentMessage.createdById = data.createdById;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Document<a... Remove this comment to see the full error message
        incidentMessage.type = data.type;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident_state' does not exist on type '... Remove this comment to see the full error message
        incidentMessage.incident_state = data.incident_state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'postOnStatusPage' does not exist on type... Remove this comment to see the full error message
        incidentMessage.postOnStatusPage = data.post_statuspage;

        incidentMessage = await incidentMessage.save();

        if (!data.ignoreCounter) {
            await IncidentService.refreshInterval(data.incidentId);
        }

        const populate = [
            { path: 'incidentId', select: 'idNumber name slug' },
            { path: 'createdById', select: 'name' },
        ];

        const select =
            '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

        incidentMessage = await this.findOneBy({
            query: { _id: incidentMessage._id },
            select,
            populate,
        });

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'postOnStatusPage' does not exist on type... Remove this comment to see the full error message
        if (incidentMessage && incidentMessage.postOnStatusPage) {
            // run in the background
            RealTimeService.addIncidentNote(incidentMessage);
        }

        return incidentMessage;
    },
    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        data.updated = true;
        let incidentMessage = await IncidentMessageModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        const populate = [
            { path: 'incidentId', select: 'idNumber name slug' },
            { path: 'createdById', select: 'name' },
        ];

        const select =
            '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

        incidentMessage = await this.findOneBy({ query, populate, select });

        // run in the background
        //RealTimeService.applicationLogKeyReset(applicationLog);
        RealTimeService.updateIncidentNote(incidentMessage);
        return incidentMessage;
    },
    async findOneBy({ query, populate, select }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let incidentMessageQuery = IncidentMessageModel.findOne(query).lean();

        incidentMessageQuery = handleSelect(select, incidentMessageQuery);
        incidentMessageQuery = handlePopulate(populate, incidentMessageQuery);

        const incidentMessage = await incidentMessageQuery;
        return incidentMessage;
    },
    findBy: async function({ query, skip, limit, populate, select }: $TSFixMe) {
        if (!skip) skip = 0;
        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = parseInt(skip);
        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;
        let incidentMessagesQuery = IncidentMessageModel.find(query)
            .lean()
            .sort([['createdAt', -1]]) // fetch from latest to oldest
            .limit(limit)
            .skip(skip);
        incidentMessagesQuery = handleSelect(select, incidentMessagesQuery);
        incidentMessagesQuery = handlePopulate(populate, incidentMessagesQuery);
        const incidentMessages = await incidentMessagesQuery;
        return incidentMessages;
    },
    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;

        const count = await IncidentMessageModel.countDocuments(query);

        return count;
    },
    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const incidentMessage = await IncidentMessageModel.findOneAndUpdate(
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
    },
};

import IncidentMessageModel from '../models/incidentMessage';
import RealTimeService from './realTimeService';
import IncidentService from './incidentService';
import handlePopulate from '../utils/populate';
import handleSelect from '../utils/select';
