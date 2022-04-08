import SiteManagerModel from '../models/siteManager';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default class Service {
    async create(data: $TSFixMe) {
        const siteManager = await SiteManagerModel.create(data);
        return siteManager;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const siteManagerQuery = SiteManagerModel.findOne(query)
            .sort(sort)
            .lean();

        siteManagerQuery.select(select);
        siteManagerQuery.populate(populate);

        const siteManager = await siteManagerQuery;
        return siteManager;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const siteManagerQuery = SiteManagerModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        siteManagerQuery.select(select);
        siteManagerQuery.populate(populate);

        const siteManagers = await siteManagerQuery;
        return siteManagers;
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
        const _this = this;
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        let siteManager = await SiteManagerModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );

        if (!siteManager) {
            siteManager = await _this.create(data);
        }

        return siteManager;
    }

    async deleteBy(query: Query) {
        const siteManager = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });
        return siteManager;
    }

    async hardDelete(query: Query) {
        await SiteManagerModel.deleteMany(query);
        return 'siteManager store successfully deleted';
    }
}
