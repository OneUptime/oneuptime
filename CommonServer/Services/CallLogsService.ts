export default class Service {
    async findBy({ query, limit, skip, sort, select, populate }: FindBy): void {
        if (!query['deleted']) {
            query['deleted'] = false;
        }

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
        projectId: ObjectID,
        content: $TSFixMe,
        status: $TSFixMe,
        error: $TSFixMe
    ): void {
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

    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const count = await CallLogsModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query, userId: ObjectID): void {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const items = await CallLogsModel.findOneAndUpdate(query, {
            $set: {
                deleted: true,
                deletedAt: Date.now(),
                deletedById: userId,
            },
        });
        return items;
    }

    async hardDeleteBy({ query }: $TSFixMe): void {
        await CallLogsModel.deleteMany(query);
    }

    async search({ filter, skip, limit }: $TSFixMe): void {
        const query: $TSFixMe = {
            to: { $regex: new RegExp(filter), $options: 'i' },
        };

        const populate = [{ path: 'projectId', select: 'name' }];
        const select: string = 'from to projectId content status error';
        const [searchedCallLogs, totalSearchCount] = await Promise.all([
            this.findBy({ query, skip, limit, select, populate }),
            this.countBy({ query }),
        ]);

        return { searchedCallLogs, totalSearchCount };
    }
}

import CallLogsModel from '../Models/callLogs';
import ObjectID from 'Common/Types/ObjectID';

import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
