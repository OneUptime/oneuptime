import DefaultManagerModel from '../Models/defaultManager';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    async create(data: $TSFixMe): void {
        const defaultManager: $TSFixMe = await DefaultManagerModel.create(data);
        return defaultManager;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const defaultManagerQuery: $TSFixMe =
            DefaultManagerModel.findOne(query).sort(sort);

        defaultManagerQuery.select(select);
        defaultManagerQuery.populate(populate);

        const defaultManager: $TSFixMe = await defaultManagerQuery;
        return defaultManager;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 0;
        }

        if (typeof skip === 'string') {
            skip = Number(skip);
        }

        if (typeof limit === 'string') {
            limit = Number(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const defaultManagerQuery: $TSFixMe = DefaultManagerModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        defaultManagerQuery.select(select);
        defaultManagerQuery.populate(populate);

        const defaultManagers: $TSFixMe = await defaultManagerQuery;
        return defaultManagers;
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        let defaultManager: $TSFixMe =
            await DefaultManagerModel.findOneAndUpdate(
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
