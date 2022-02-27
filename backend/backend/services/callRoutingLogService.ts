export default {
    findBy: async function({ query, skip, limit, select, populate }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let callRoutingLogQuery = CallRoutingLogModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);
        callRoutingLogQuery = handleSelect(select, callRoutingLogQuery);
        callRoutingLogQuery = handlePopulate(populate, callRoutingLogQuery);

        const callRoutingLog = await callRoutingLogQuery;
        return callRoutingLog;
    },

    create: async function(data: $TSFixMe) {
        const callRoutingLogModel = new CallRoutingLogModel();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'callRoutingId' does not exist on type 'D... Remove this comment to see the full error message
        callRoutingLogModel.callRoutingId = data.callRoutingId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'calledFrom' does not exist on type 'Docu... Remove this comment to see the full error message
        callRoutingLogModel.calledFrom = data.calledFrom;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'calledTo' does not exist on type 'Docume... Remove this comment to see the full error message
        callRoutingLogModel.calledTo = data.calledTo;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'callSid' does not exist on type 'Documen... Remove this comment to see the full error message
        callRoutingLogModel.callSid = data.callSid;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'dialTo' does not exist on type 'Document... Remove this comment to see the full error message
        callRoutingLogModel.dialTo = data.dialTo;

        const logs = await callRoutingLogModel.save();
        return logs;
    },

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await CallRoutingLogModel.countDocuments(query);
        return count;
    },

    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const logs = await CallRoutingLogModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            },
            {
                new: true,
            }
        );
        return logs;
    },

    findOneBy: async function({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;

        let logQuery = CallRoutingLogModel.findOne(query)
            .lean()
            .sort([['createdAt', -1]]);
        logQuery = handleSelect(select, logQuery);
        logQuery = handlePopulate(populate, logQuery);

        const log = await logQuery;
        return log;
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        const updatedCallRoutingLog = await CallRoutingLogModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        return updatedCallRoutingLog;
    },

    updateBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedData = await CallRoutingLogModel.updateMany(query, {
            $set: data,
        });
        const select =
            'callRoutingId callSid price calledFrom calledTo duration dialTo';
        updatedData = await this.findBy({ query, select });
        return updatedData;
    },

    hardDeleteBy: async function(query: $TSFixMe) {
        await CallRoutingLogModel.deleteMany(query);
        return 'Call routing Log(s) Removed Successfully!';
    },
};

import CallRoutingLogModel from '../models/callRoutingLog';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
