import ApplicationSecurityLogModel from '../models/applicationSecurityLog';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';

export default {
    create: async function({ securityId, componentId, data }: $TSFixMe) {
        if (!securityId) {
            const error = new Error('Security ID is required');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        if (!componentId) {
            const error = new Error('Component ID is required');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        if (!data) {
            const error = new Error('Please provide a scan log');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                { _id: securityLog._id },
                { data: data }
            );
        }

        return securityLog;
    },
    findOneBy: async function({ query, populate, select }: $TSFixMe) {
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let securityLogQuery = ApplicationSecurityLogModel.findOne(
            query
        ).lean();

        securityLogQuery = handleSelect(select, securityLogQuery);
        securityLogQuery = handlePopulate(populate, securityLogQuery);

        const securityLog = await securityLogQuery;
        return securityLog;
    },
    findBy: async function({ query, limit, skip, populate, select }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let securityLogsQuery = ApplicationSecurityLogModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        securityLogsQuery = handleSelect(select, securityLogsQuery);
        securityLogsQuery = handlePopulate(populate, securityLogsQuery);

        const securityLogs = await securityLogsQuery;
        return securityLogs;
    },
    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        const applicationSecurityLog = await ApplicationSecurityLogModel.findOneAndUpdate(
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        return applicationSecurityLog;
    },
    deleteBy: async function(query: $TSFixMe) {
        let securityLog = this.findOneBy({ query, select: '_id' });

        if (!securityLog) {
            const error = new Error(
                'Application Security Log not found or does not exist'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        securityLog = this.updateOneBy(query, {
            deleted: true,
            deleteAt: Date.now(),
        });

        return securityLog;
    },
    hardDelete: async function(query: $TSFixMe) {
        await ApplicationSecurityLogModel.deleteMany(query);
        return 'Application Security logs deleted successfully';
    },
};
