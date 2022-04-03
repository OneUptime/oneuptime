export default {
    findBy: async function ({
        query,
        limit,
        skip,
        sort,
        select,
        populate,
    }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) {
            query = {};
        }

        if (!sort) {
            sort = { createdAt: 'desc' };
        }

        if (!query.deleted) query.deleted = false;
        // const items = await CallLogsModel.find(query)
        //     .lean()
        //     .limit(limit)
        //     .skip(skip)
        //     .sort(sort)
        //     .populate('projectId', 'name');

        let itemQuery = CallLogsModel.find(query)
            .lean()
            .limit(limit)
            .skip(skip)
            .sort(sort);
        itemQuery = handleSelect(select, itemQuery);
        itemQuery = handlePopulate(populate, itemQuery);

        const items = await itemQuery;
        return items;
    },

    create: async function (
        from: $TSFixMe,
        to: $TSFixMe,
        projectId: $TSFixMe,
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
    },

    countBy: async function (query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await CallLogsModel.countDocuments(query);
        return count;
    },

    deleteBy: async function (query: $TSFixMe, userId: $TSFixMe) {
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
    },

    hardDeleteBy: async function ({ query }: $TSFixMe) {
        await CallLogsModel.deleteMany(query);
    },

    search: async function ({ filter, skip, limit }: $TSFixMe) {
        const _this = this;
        const query = {
            to: { $regex: new RegExp(filter), $options: 'i' },
        };

        const populate = [{ path: 'projectId', select: 'name' }];
        const select = 'from to projectId content status error';
        const [searchedCallLogs, totalSearchCount] = await Promise.all([
            _this.findBy({ query, skip, limit, select, populate }),
            _this.countBy({ query }),
        ]);

        return { searchedCallLogs, totalSearchCount };
    },
};

import CallLogsModel from 'common-server/models/callLogs';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
