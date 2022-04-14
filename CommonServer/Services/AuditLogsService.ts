export default class Service {
    async findBy({ query, skip, limit, populate, select, sort }: FindBy): void {
        const auditLogsQuery: $TSFixMe = AuditLogsModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        auditLogsQuery.select(select);
        auditLogsQuery.populate(populate);

        const auditLogs: $TSFixMe = await auditLogsQuery;

        return auditLogs;
    }

    async countBy({ query }: Query): void {
        if (!query) {
            query = {};
        }

        const count: $TSFixMe = await AuditLogsModel.countDocuments(query);
        return count;
    }

    async create(data: $TSFixMe): void {
        const auditLogsModel: $TSFixMe = new AuditLogsModel({
            userId: data.userId,
            projectId: data.projectId,
            request: data.request,
            response: data.response,
        });

        const auditLog: $TSFixMe = await auditLogsModel.save();
        return auditLog;
    }

    async search({ filter, skip, limit }: $TSFixMe): void {
        const query: $TSFixMe = {
            'request.apiSection': {
                $regex: new RegExp(filter),
                $options: 'i',
            },
        };

        const populateAuditLog: $TSFixMe = [
            { path: 'userId', select: 'name' },
            { path: 'projectId', select: 'name' },
        ];

        const selectAuditLog: string =
            'userId projectId request response createdAt';

        const [searchedAuditLogs, totalSearchCount]: $TSFixMe =
            await Promise.all([
                this.findBy({
                    query,
                    skip,
                    limit,
                    populate: populateAuditLog,
                    select: selectAuditLog,
                }),
                this.countBy({ query }),
            ]);

        return { searchedAuditLogs, totalSearchCount };
    }

    async hardDeleteBy({ query }: $TSFixMe): void {
        await AuditLogsModel.deleteMany(query);
    }
}

import AuditLogsModel from '../Models/auditLogs';

import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
