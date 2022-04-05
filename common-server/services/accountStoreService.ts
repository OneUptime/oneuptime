import AccountModel from '../models/account';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default {
    create: async function (data: $TSFixMe) {
        const account = await AccountModel.create(data);
        return account;
    },
    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const accountQuery = AccountModel.findOne(query).sort(sort).lean();

        accountQuery.select(select);
        accountQuery.populate(populate);

        const account = await accountQuery;
        return account;
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

        const accountQuery = AccountModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        accountQuery.select(select);
        accountQuery.populate(populate);

        const accounts = await accountQuery;
        return accounts;
    },
    updateOneBy: async function (query: Query, data: $TSFixMe) {
        const _this = this;
        if (!query) query = {};

        // if (!query['deleted']) query['deleted'] = false;

        let account = await AccountModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );

        // create account details if does not already exist
        if (!account) {
            account = await _this.create(data);
        }

        return account;
    },
    deleteBy: async function (query: Query) {
        const account = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });
        return account;
    },
    hardDelete: async function (query: Query) {
        await AccountModel.deleteMany(query);
        return 'Account store successfully deleted';
    },
    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await AccountModel.countDocuments(query);
        return count;
    },
};
