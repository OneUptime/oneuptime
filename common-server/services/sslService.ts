import SslModel from '../models/ssl';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default {
    create: async function (data: $TSFixMe) {
        const sslChallenge = await SslModel.create(data);
        return sslChallenge;
    },
    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const sslChallengeQuery = SslModel.findOne(query).sort(sort).lean();

        sslChallengeQuery.select(select);
        sslChallengeQuery.populate(populate);

        const sslChallenge = await sslChallengeQuery;
        return sslChallenge;
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

        const sslChallengeQuery = SslModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        sslChallengeQuery.select(select);
        sslChallengeQuery.populate(populate);

        const sslChallenges = await sslChallengeQuery;
        return sslChallenges;
    },
    updateOneBy: async function (query: Query, data: $TSFixMe) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const sslChallenge = await SslModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );

        return sslChallenge;
    },
    deleteBy: async function (query: Query) {
        const acmeChallenge = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });
        return acmeChallenge;
    },
    hardDelete: async function (query: Query) {
        await SslModel.deleteMany(query);
        return 'Acme challenges successfully deleted';
    },
    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await SslModel.countDocuments(query);
        return count;
    },
};
