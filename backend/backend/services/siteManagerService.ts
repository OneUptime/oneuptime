import SiteManagerModel from 'common-server/models/siteManager';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
import FindOneBy from 'common-server/types/db/FindOneBy';
import FindBy from 'common-server/types/db/FindBy';
import Query from 'common-server/types/db/Query';

export default {
    create: async function (data: $TSFixMe) {
        const siteManager = await SiteManagerModel.create(data);
        return siteManager;
    },
    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        let siteManagerQuery = SiteManagerModel.findOne(query)
            .sort(sort)
            .lean();

        siteManagerQuery = handleSelect(select, siteManagerQuery);
        siteManagerQuery = handlePopulate(populate, siteManagerQuery);

        const siteManager = await siteManagerQuery;
        return siteManager;
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

        let siteManagerQuery = SiteManagerModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        siteManagerQuery = handleSelect(select, siteManagerQuery);
        siteManagerQuery = handlePopulate(populate, siteManagerQuery);

        const siteManagers = await siteManagerQuery;
        return siteManagers;
    },
    updateOneBy: async function (query: Query, data: $TSFixMe) {
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
    },
    deleteBy: async function (query: Query) {
        const siteManager = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });
        return siteManager;
    },
    hardDelete: async function (query: Query) {
        await SiteManagerModel.deleteMany(query);
        return 'siteManager store successfully deleted';
    },
};
