import ContainerSecurityLogModel from '../Models/containerSecurityLog';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    async create({ securityId, componentId, data }: $TSFixMe) {
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
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const securityLogQuery = ContainerSecurityLogModel.findOne(query)
            .sort(sort)
            .lean();

        securityLogQuery.select(select);
        securityLogQuery.populate(populate);

        const securityLog = await securityLogQuery;
        return securityLog;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const securityLogsQuery = ContainerSecurityLogModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        securityLogsQuery.select(select);
        securityLogsQuery.populate(populate);

        const securityLogs = await securityLogsQuery;
        return securityLogs;
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
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
    }

    async deleteBy(query: Query) {
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
    }

    async hardDelete(query: Query) {
        await ContainerSecurityLogModel.deleteMany(query);
        return 'Container Security logs deleted successfully';
    }
}
