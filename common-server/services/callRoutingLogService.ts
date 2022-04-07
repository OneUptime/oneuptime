export default class Service {
    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        if (!query['deleted']) query['deleted'] = false;

        const callRoutingLogQuery = CallRoutingLogModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());
        callRoutingLogQuery.select(select);
        callRoutingLogQuery.populate(populate);

        const callRoutingLog = await callRoutingLogQuery;
        return callRoutingLog;
    }

    async create(data: $TSFixMe) {
        const callRoutingLogModel = new CallRoutingLogModel();

        callRoutingLogModel.callRoutingId = data.callRoutingId;

        callRoutingLogModel.calledFrom = data.calledFrom;

        callRoutingLogModel.calledTo = data.calledTo;

        callRoutingLogModel.callSid = data.callSid;

        callRoutingLogModel.dialTo = data.dialTo;

        const logs = await callRoutingLogModel.save();
        return logs;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await CallRoutingLogModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query, userId: string) {
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
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) query['deleted'] = false;

        const logQuery = CallRoutingLogModel.findOne(query)
            .sort(sort)
            .lean()
            .sort(sort);
        logQuery.select(select);
        logQuery.populate(populate);

        const log = await logQuery;
        return log;
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
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
    }

    async updateBy(query: Query, data: $TSFixMe) {
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
    }

    async hardDeleteBy(query: Query) {
        await CallRoutingLogModel.deleteMany(query);
        return 'Call routing Log(s) Removed Successfully!';
    }
}

import CallRoutingLogModel from '../models/callRoutingLog';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';
