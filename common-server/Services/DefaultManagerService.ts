import DefaultManagerModel from '../Models/defaultManager';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default class Service {
    async create(data: $TSFixMe) {
        const defaultManager = await DefaultManagerModel.create(data);
        return defaultManager;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const defaultManagerQuery =
            DefaultManagerModel.findOne(query).sort(sort);

        defaultManagerQuery.select(select);
        defaultManagerQuery.populate(populate);

        const defaultManager = await defaultManagerQuery;
        return defaultManager;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
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
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
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
            defaultManager = await this.create(data);
        }

        return defaultManager;
    }
}
