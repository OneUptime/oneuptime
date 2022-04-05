export default {
    findBy: async function ({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy) {
        if (!query['deleted']) query['deleted'] = false;

        let callRoutingLogQuery = CallRoutingLogModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());
        callRoutingLogQuery = handleSelect(select, callRoutingLogQuery);
        callRoutingLogQuery = handlePopulate(populate, callRoutingLogQuery);

        const callRoutingLog = await callRoutingLogQuery;
        return callRoutingLog;
    },

    create: async function (data: $TSFixMe) {
        const callRoutingLogModel = new CallRoutingLogModel();

        callRoutingLogModel.callRoutingId = data.callRoutingId;

        callRoutingLogModel.calledFrom = data.calledFrom;

        callRoutingLogModel.calledTo = data.calledTo;

        callRoutingLogModel.callSid = data.callSid;

        callRoutingLogModel.dialTo = data.dialTo;

        const logs = await callRoutingLogModel.save();
        return logs;
    },

    countBy: async function (query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await CallRoutingLogModel.countDocuments(query);
        return count;
    },

    deleteBy: async function (query: Query, userId: string) {
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

    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) query['deleted'] = false;

        let logQuery = CallRoutingLogModel.findOne(query)
            .sort(sort)
            .lean()
            .sort(sort);
        logQuery = handleSelect(select, logQuery);
        logQuery = handlePopulate(populate, logQuery);

        const log = await logQuery;
        return log;
    },

    updateOneBy: async function (query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;

        const updatedCallRoutingLog =
            await CallRoutingLogModel.findOneAndUpdate(
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

    updateBy: async function (query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        let updatedData = await CallRoutingLogModel.updateMany(query, {
            $set: data,
        });
        const select =
            'callRoutingId callSid price calledFrom calledTo duration dialTo';
        updatedData = await this.findBy({ query, select });
        return updatedData;
    },

    hardDeleteBy: async function (query: Query) {
        await CallRoutingLogModel.deleteMany(query);
        return 'Call routing Log(s) Removed Successfully!';
    },
};

import CallRoutingLogModel from 'common-server/models/callRoutingLog';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
import FindOneBy from 'common-server/types/db/FindOneBy';
import FindBy from 'common-server/types/db/FindBy';
import Query from 'common-server/types/db/Query';
