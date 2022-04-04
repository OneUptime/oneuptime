import ContainerSecurityLogModel from 'common-server/models/containerSecurityLog';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
import FindOneBy from 'common-server/types/db/FindOneBy';
import FindBy from 'common-server/types/db/FindBy';
import Query from 'common-server/types/db/Query';

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
            securityLog = await ContainerSecurityLogModel.create({
                securityId,
                componentId,
                data,
            });
        } else {
            securityLog = await this.updateOneBy(
                { _id: securityLog._id },
                data
            );
        }

        return securityLog;
    },
    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        let securityLogQuery = ContainerSecurityLogModel.findOne(query)
            .sort(sort)
            .lean();

        securityLogQuery = handleSelect(select, securityLogQuery);
        securityLogQuery = handlePopulate(populate, securityLogQuery);

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
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        let securityLogsQuery = ContainerSecurityLogModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        securityLogsQuery = handleSelect(select, securityLogsQuery);
        securityLogsQuery = handlePopulate(populate, securityLogsQuery);

        const securityLogs = await securityLogsQuery;
        return securityLogs;
    },
    updateOneBy: async function (query: Query, data: $TSFixMe) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const containerSecurityLog =
            await ContainerSecurityLogModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

        if (!containerSecurityLog) {
            const error = new Error(
                'Container Security Log not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        return containerSecurityLog;
    },
    deleteBy: async function (query: Query) {
        let securityLog = await this.findOneBy({ query, select: '_id' });

        if (!securityLog) {
            const error = new Error(
                'Container Security Log not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        securityLog = await this.updateOneBy(query, {
            deleted: true,
            deleteAt: Date.now(),
        });

        return securityLog;
    },
    hardDelete: async function (query: Query) {
        await ContainerSecurityLogModel.deleteMany(query);
        return 'Container Security logs deleted successfully';
    },
};
