const SslModel = require('../models/ssl');
const ErrorService = require('./errorService');

module.exports = {
    create: async function(data) {
        try {
            const sslChallenge = await SslModel.create(data);
            return sslChallenge;
        } catch (error) {
            ErrorService.log('sslService.create', error);
            throw error;
        }
    },
    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const sslChallenge = await SslModel.findOne(query);
            return sslChallenge;
        } catch (error) {
            ErrorService.log('sslService.findOneBy', error);
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

            const sslChallenges = await SslModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            return sslChallenges;
        } catch (error) {
            ErrorService.log('sslService.findBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const sslChallenge = await SslModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

            return sslChallenge;
        } catch (error) {
            ErrorService.log('sslService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            const acmeChallenge = await this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
            });
            return acmeChallenge;
        } catch (error) {
            ErrorService.log('sslService.deleteBy', error);
            throw error;
        }
    },
    hardDelete: async function(query) {
        try {
            await SslModel.deleteMany(query);
            return 'Acme challenges successfully deleted';
        } catch (error) {
            ErrorService.log('sslService.hardDelete', error);
            throw error;
        }
    },
    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await SslModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('sslService.countBy', error);
            throw error;
        }
    },
};
