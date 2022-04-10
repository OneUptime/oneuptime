import EmailStatusModel from '../models/emailStatus';
import GlobalConfigService from './GlobalConfigService';

import FindOneBy from '../types/db/FindOneBy';
import Query from '../types/db/Query';
import FindBy from '../types/db/FindBy';

export default class Service {
    async findBy({ query, limit, skip, sort, populate, select }: FindBy) {
        if (!query['deleted']) query['deleted'] = false;
        const itemsQuery = EmailStatusModel.find(query)
            .lean()
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort);

        itemsQuery.select(select);
        itemsQuery.populate(populate);

        const items = await itemsQuery;

        return items;
    }

    async create({
        from,
        to,
        status,
        subject,
        body,
        template,
        content,
        error,
        smtpServer,
    }: $TSFixMe) {
        const globalConfig = await GlobalConfigService.findOneBy({
            query: { name: 'emailLogMonitoringStatus' },
            select: 'value',
        });
        if (globalConfig && globalConfig.value) {
            let item = new EmailStatusModel();

            item.status = status;

            item.from = from;

            item.to = to;

            item.subject = subject;

            item.body = body;

            item.template = template;

            item.content = content;

            item.error = error;

            item.smtpServer = smtpServer;
            item = await item.save();

            return item;
        }
        return;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await EmailStatusModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query, userId: string) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const items = await EmailStatusModel.findOneAndUpdate(query, {
            $set: {
                deleted: true,
                deletedAt: Date.now(),
                deletedById: userId,
            },
        });
        return items;
    }

    async hardDeleteBy({ query }: $TSFixMe) {
        await EmailStatusModel.deleteMany(query);
    }

    // Description: Get EmailStatus by item Id.
    // Params:
    // Param 1: monitorId: monitor Id
    // Returns: promise with item or error.
    async findOneBy({ query, populate, select, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const itemQuery = EmailStatusModel.findOne(query).sort(sort).lean();

        itemQuery.select(select);
        itemQuery.populate(populate);

        const item = await itemQuery;
        return item;
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;

        const updatedEmailStatus = await EmailStatusModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );
        return updatedEmailStatus;
    }

    async updateBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        let updatedData = await EmailStatusModel.updateMany(query, {
            $set: data,
        });
        const selectEmailStatus =
            'from to subject body createdAt template status content error deleted deletedAt deletedById replyTo smtpServer';

        updatedData = await this.findBy({
            query,
            select: selectEmailStatus,
        });
        return updatedData;
    }

    async search({ filter, skip, limit }: $TSFixMe) {
        const query = {
            to: { $regex: new RegExp(filter), $options: 'i' },
        };

        const selectEmailStatus =
            'from to subject body createdAt template status content error deleted deletedAt deletedById replyTo smtpServer';

        const [searchedEmailLogs, totalSearchCount] = await Promise.all([
            this.findBy({ query, skip, limit, select: selectEmailStatus }),
            this.countBy({ query }),
        ]);

        return { searchedEmailLogs, totalSearchCount };
    }
}
