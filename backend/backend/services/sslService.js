import SslModel from '../models/ssl'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'

export default {
    create: async function(data) {
        const sslChallenge = await SslModel.create(data);
        return sslChallenge;
    },
    findOneBy: async function({ query, select, populate }) {
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let sslChallengeQuery = SslModel.findOne(query).lean();

        sslChallengeQuery = handleSelect(select, sslChallengeQuery);
        sslChallengeQuery = handlePopulate(populate, sslChallengeQuery);

        const sslChallenge = await sslChallengeQuery;
        return sslChallenge;
    },
    findBy: async function({ query, limit, skip, select, populate }) {
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
    },
    updateOneBy: async function(query, data) {
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
    },
    deleteBy: async function(query) {
        const acmeChallenge = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });
        return acmeChallenge;
    },
    hardDelete: async function(query) {
        await SslModel.deleteMany(query);
        return 'Acme challenges successfully deleted';
    },
    async countBy(query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await SslModel.countDocuments(query);
        return count;
    },
};
