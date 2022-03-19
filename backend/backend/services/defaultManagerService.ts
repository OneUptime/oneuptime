import DefaultManagerModel from '../models/defaultManager';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';

export default {
    create: async function (data: $TSFixMe) {
        const defaultManager = await DefaultManagerModel.create(data);
        return defaultManager;
    },
    findOneBy: async function ({ query, select, populate }: $TSFixMe) {
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let defaultManagerQuery = DefaultManagerModel.findOne(query);

        defaultManagerQuery = handleSelect(select, defaultManagerQuery);
        defaultManagerQuery = handlePopulate(populate, defaultManagerQuery);

        const defaultManager = await defaultManagerQuery;
        return defaultManager;
    },
    findBy: async function ({
        query,
        limit,
        skip,
        select,
        populate,
    }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let defaultManagerQuery = DefaultManagerModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        defaultManagerQuery = handleSelect(select, defaultManagerQuery);
        defaultManagerQuery = handlePopulate(populate, defaultManagerQuery);

        const defaultManagers = await defaultManagerQuery;
        return defaultManagers;
    },
    updateOneBy: async function (query: $TSFixMe, data: $TSFixMe) {
        const _this = this;
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;
        let defaultManager = await DefaultManagerModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );

        if (!defaultManager) {
            defaultManager = await _this.create(data);
        }

        return defaultManager;
    },
};
