import DefaultManagerModel from '../models/defaultManager';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default {
    create: async function (data: $TSFixMe) {
        const defaultManager = await DefaultManagerModel.create(data);
        return defaultManager;
    },
    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const defaultManagerQuery =
            DefaultManagerModel.findOne(query).sort(sort);

        defaultManagerQuery.select(select);
        defaultManagerQuery.populate(populate);

        const defaultManager = await defaultManagerQuery;
        return defaultManager;
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

        const defaultManagerQuery = DefaultManagerModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        defaultManagerQuery.select(select);
        defaultManagerQuery.populate(populate);

        const defaultManagers = await defaultManagerQuery;
        return defaultManagers;
    },
    updateOneBy: async function (query: Query, data: $TSFixMe) {
        const _this = this;
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;
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
