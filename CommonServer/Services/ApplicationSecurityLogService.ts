import ApplicationSecurityLogModel from '../Models/applicationSecurityLog';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    async create({ securityId, componentId, data }: $TSFixMe): void {
        if (!securityId) {
            throw new BadDataException('Security ID is required');
        }

        if (!componentId) {
            throw new BadDataException('Component ID is required');
        }

        if (!data) {
            throw new BadDataException('Please provide a scan log');
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
    }

    async findOneBy({ query, populate, select, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const securityLogQuery: $TSFixMe = ApplicationSecurityLogModel.findOne(
            query
        )
            .sort(sort)
            .lean();

        securityLogQuery.select(select);
        securityLogQuery.populate(populate);

        const securityLog: $TSFixMe = await securityLogQuery;
        return securityLog;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy): void {
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const securityLogsQuery: $TSFixMe = ApplicationSecurityLogModel.find(
            query
        )
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        securityLogsQuery.select(select);
        securityLogsQuery.populate(populate);

        const securityLogs: $TSFixMe = await securityLogsQuery;
        return securityLogs;
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const applicationSecurityLog: $TSFixMe =
            await ApplicationSecurityLogModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

        if (!applicationSecurityLog) {
            const error: $TSFixMe = new Error(
                'Application Security Log not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        return applicationSecurityLog;
    }

    async deleteBy(query: Query): void {
        let securityLog = this.findOneBy({ query, select: '_id' });

        if (!securityLog) {
            const error: $TSFixMe = new Error(
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
    }

    async hardDelete(query: Query): void {
        await ApplicationSecurityLogModel.deleteMany(query);
        return 'Application Security logs deleted successfully';
    }
}
