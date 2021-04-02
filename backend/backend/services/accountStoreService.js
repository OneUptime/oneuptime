const AccountModel = require('../models/account');
const ErrorService = require('./errorService');

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
    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const account = await AccountModel.findOne(query);
            return account;
        } catch (error) {
            ErrorService.log('accountStoreService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = Number(skip);

            if (typeof limit === 'string') limit = Number(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const accounts = await AccountModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

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
