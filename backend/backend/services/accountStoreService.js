const AccountModel = require('../models/account');
const ErrorService = require('./errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

module.exports = {
    create: async function(data) {
        try {
            const account = await AccountModel.create(data);
            return account;
        } catch (error) {
            ErrorService.log('accountStoreService.create', error);
            throw error;
        }
    },
    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let accountQuery = AccountModel.findOne(query).lean();

            accountQuery = handleSelect(select, accountQuery);
            accountQuery = handlePopulate(populate, accountQuery);

            const account = await accountQuery;
            return account;
        } catch (error) {
            ErrorService.log('accountStoreService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function({ query, limit, skip, select, populate }) {
        try {
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
        } catch (error) {
            ErrorService.log('accountStoreService.findBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        const _this = this;
        try {
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
        } catch (error) {
            ErrorService.log('accountStoreService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            const account = await this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
            });
            return account;
        } catch (error) {
            ErrorService.log('accountStoreService.deleteBy', error);
            throw error;
        }
    },
    hardDelete: async function(query) {
        try {
            await AccountModel.deleteMany(query);
            return 'Account store successfully deleted';
        } catch (error) {
            ErrorService.log('accountStoreService.hardDelete', error);
            throw error;
        }
    },
    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await AccountModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('accountStoreService.countBy', error);
            throw error;
        }
    },
};
