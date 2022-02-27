import AccountModel from '../models/account';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';

export default {
    create: async function(data: $TSFixMe) {
        const account = await AccountModel.create(data);
        return account;
    },
    findOneBy: async function({ query, select, populate }: $TSFixMe) {
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let accountQuery = AccountModel.findOne(query).lean();

        accountQuery = handleSelect(select, accountQuery);
        accountQuery = handlePopulate(populate, accountQuery);

        const account = await accountQuery;
        return account;
    },
    findBy: async function({ query, limit, skip, select, populate }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let accountQuery = AccountModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        accountQuery = handleSelect(select, accountQuery);
        accountQuery = handlePopulate(populate, accountQuery);

        const accounts = await accountQuery;
        return accounts;
    },
    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        const _this = this;
        if (!query) query = {};

        // if (!query.deleted) query.deleted = false;

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
    deleteBy: async function(query: $TSFixMe) {
        const account = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });
        return account;
    },
    hardDelete: async function(query: $TSFixMe) {
        await AccountModel.deleteMany(query);
        return 'Account store successfully deleted';
    },
    async countBy(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await AccountModel.countDocuments(query);
        return count;
    },
};
