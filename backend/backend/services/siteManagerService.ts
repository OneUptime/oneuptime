import SiteManagerModel from '../models/siteManager'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'

export default {
    create: async function(data: $TSFixMe) {
        const siteManager = await SiteManagerModel.create(data);
        return siteManager;
    },
    findOneBy: async function({
        query,
        select,
        populate
    }: $TSFixMe) {
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let siteManagerQuery = SiteManagerModel.findOne(query).lean();

        siteManagerQuery = handleSelect(select, siteManagerQuery);
        siteManagerQuery = handlePopulate(populate, siteManagerQuery);

        const siteManager = await siteManagerQuery;
        return siteManager;
    },
    findBy: async function({
        query,
        limit,
        skip,
        select,
        populate
    }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let siteManagerQuery = SiteManagerModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        siteManagerQuery = handleSelect(select, siteManagerQuery);
        siteManagerQuery = handlePopulate(populate, siteManagerQuery);

        const siteManagers = await siteManagerQuery;
        return siteManagers;
    },
    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        const _this = this;
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

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
    deleteBy: async function(query: $TSFixMe) {
        const siteManager = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });
        return siteManager;
    },
    hardDelete: async function(query: $TSFixMe) {
        await SiteManagerModel.deleteMany(query);
        return 'siteManager store successfully deleted';
    },
};
