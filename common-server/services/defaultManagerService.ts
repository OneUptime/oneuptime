import DefaultManagerModel from 'common-server/models/defaultManager';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
import FindOneBy from 'common-server/types/db/FindOneBy';
import FindBy from 'common-server/types/db/FindBy';
import Query from 'common-server/types/db/Query';

export default {
    create: async function (data: $TSFixMe) {
        const defaultManager = await DefaultManagerModel.create(data);
        return defaultManager;
    },
    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        let defaultManagerQuery = DefaultManagerModel.findOne(query).sort(sort);

        defaultManagerQuery = handleSelect(select, defaultManagerQuery);
        defaultManagerQuery = handlePopulate(populate, defaultManagerQuery);

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

        let defaultManagerQuery = DefaultManagerModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        defaultManagerQuery = handleSelect(select, defaultManagerQuery);
        defaultManagerQuery = handlePopulate(populate, defaultManagerQuery);

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
