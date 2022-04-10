export default class Service {
    async findBy({ query, limit, skip, sort, select, populate }: FindBy) {
        if (!query['deleted']) query['deleted'] = false;

        const itemQuery = CallLogsModel.find(query)
            .lean()
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort);
        itemQuery.select(select);
        itemQuery.populate(populate);

        const items = await itemQuery;
        return items;
    }

    async create(
        from: $TSFixMe,
        to: $TSFixMe,
        projectId: string,
        content: $TSFixMe,
        status: $TSFixMe,
        error: $TSFixMe
    ) {
        let item = new CallLogsModel();

        item.from = from;

        item.to = to;

        item.projectId = projectId;

        item.content = content;

        item.status = status;

        item.error = error;
        item = await item.save();

        return item;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await CallLogsModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query, userId: string) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const items = await CallLogsModel.findOneAndUpdate(query, {
            $set: {
                deleted: true,
                deletedAt: Date.now(),
                deletedById: userId,
            },
        });
        return items;
    }

    async hardDeleteBy({ query }: $TSFixMe) {
        await CallLogsModel.deleteMany(query);
    }

    async search({ filter, skip, limit }: $TSFixMe) {
        const query = {
            to: { $regex: new RegExp(filter), $options: 'i' },
        };

        const populate = [{ path: 'projectId', select: 'name' }];
        const select = 'from to projectId content status error';
        const [searchedCallLogs, totalSearchCount] = await Promise.all([
            this.findBy({ query, skip, limit, select, populate }),
            this.countBy({ query }),
        ]);

        return { searchedCallLogs, totalSearchCount };
    }
}

import CallLogsModel from '../Models/callLogs';

import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';
