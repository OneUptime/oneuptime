const SslModel = require('../models/ssl');
const ErrorService = require('./errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

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
    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let sslChallengeQuery = SslModel.findOne(query).lean();

            sslChallengeQuery = handleSelect(select, sslChallengeQuery);
            sslChallengeQuery = handlePopulate(populate, sslChallengeQuery);

            const sslChallenge = await sslChallengeQuery;
            return sslChallenge;
        } catch (error) {
            ErrorService.log('sslService.findOneBy', error);
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

            let sslChallengeQuery = SslModel.find(query)
                .lean()
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            sslChallengeQuery = handleSelect(select, sslChallengeQuery);
            sslChallengeQuery = handlePopulate(populate, sslChallengeQuery);

            const sslChallenges = await sslChallengeQuery;
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
