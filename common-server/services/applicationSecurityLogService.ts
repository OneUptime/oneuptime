import ApplicationSecurityLogModel from '../models/applicationSecurityLog';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default {
    create: async function ({ securityId, componentId, data }: $TSFixMe) {
        if (!securityId) {
            const error = new Error('Security ID is required');

            error.code = 400;
            throw error;
        }

        if (!componentId) {
            const error = new Error('Component ID is required');

            error.code = 400;
            throw error;
        }

        if (!data) {
            const error = new Error('Please provide a scan log');

            error.code = 400;
            throw error;
        }

        let securityLog = await this.findOneBy({
            query: { securityId },
            select: '_id',
        });

        if (!securityLog) {
            securityLog = await ApplicationSecurityLogModel.create({
                securityId,
                componentId,
                data,
            });
        } else {
            securityLog = await this.updateOneBy(
                { _id: securityLog._id },
                { data: data }
            );
        }

        return securityLog;
    },
    findOneBy: async function ({ query, populate, select, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const securityLogQuery = ApplicationSecurityLogModel.findOne(query)
            .sort(sort)
            .lean();

        securityLogQuery.select(select);
        securityLogQuery.populate(populate);

        const securityLog = await securityLogQuery;
        return securityLog;
    },
    findBy: async function ({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy) {
        if (!query['deleted']) query['deleted'] = false;

        const securityLogsQuery = ApplicationSecurityLogModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        securityLogsQuery.select(select);
        securityLogsQuery.populate(populate);

        const securityLogs = await securityLogsQuery;
        return securityLogs;
    },
    updateOneBy: async function (query: Query, data: $TSFixMe) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const applicationSecurityLog =
            await ApplicationSecurityLogModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

        if (!applicationSecurityLog) {
            const error = new Error(
                'Application Security Log not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        return applicationSecurityLog;
    },
    deleteBy: async function (query: Query) {
        let securityLog = this.findOneBy({ query, select: '_id' });

        if (!securityLog) {
            const error = new Error(
                'Application Security Log not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        securityLog = this.updateOneBy(query, {
            deleted: true,
            deleteAt: Date.now(),
        });

        return securityLog;
    },
    hardDelete: async function (query: Query) {
        await ApplicationSecurityLogModel.deleteMany(query);
        return 'Application Security logs deleted successfully';
    },
};
