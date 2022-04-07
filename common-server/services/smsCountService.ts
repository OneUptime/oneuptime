export default class Service {
    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const smsCountQuery = SmsCountModel.find(query)
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        smsCountQuery.select(select);
        smsCountQuery.populate(populate);

        const SmsCount = await smsCountQuery;
        return SmsCount;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;

        const smsCountQuery = SmsCountModel.findOne(query)
            .sort(sort)
            .lean()
            .sort(sort);

        smsCountQuery.select(select);
        smsCountQuery.populate(populate);

        const SmsCount = await smsCountQuery;
        return SmsCount;
    }

    async create(
        userId: string,
        sentTo: $TSFixMe,
        projectId: $TSFixMe,
        content: $TSFixMe,
        status: $TSFixMe,
        error: $TSFixMe
    ) {
        const smsCountModel = new SmsCountModel();

        smsCountModel.userId = userId || null;

        smsCountModel.sentTo = sentTo || null;

        smsCountModel.projectId = projectId || null;

        smsCountModel.content = content || null;

        smsCountModel.status = status || null;

        smsCountModel.error = error || null;
        const smsCount = await smsCountModel.save();
        return smsCount;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await SmsCountModel.countDocuments(query);
        return count;
    }

    async search({ filter, skip, limit }: $TSFixMe) {
        const _this = this;
        const query = {
            sendTo: { $regex: new RegExp(filter), $options: 'i' },
        };

        const populate = [
            { path: 'projectId', select: 'name' },
            { path: 'userId', select: 'name' },
        ];
        const select =
            'userId sentTo createdAt projectId parentProjectId deleted deletedAt deletedById content status error';
        const [searchedSmsLogs, totalSearchCount] = await Promise.all([
            _this.findBy({ query, skip, limit, select, populate }),
            _this.countBy({ query }),
        ]);

        return { searchedSmsLogs, totalSearchCount };
    }

    async validateResend(userId: string) {
        const _this = this;
        let problem = '';
        const select = 'createdAt';
        const smsCount = await _this.findBy({
            query: {
                userId: userId,
                createdAt: {
                    $gt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                },
            },
            limit: 4,
            skip: 0,
            select,
        });
        if (smsCount.length > 3) {
            let time = moment(smsCount[3].createdAt).add(1, 'days');

            time = time.diff(moment(Date.now()), 'minutes');
            problem = `You have exhausted the maximum limit of sms resends in a day please wait ${Math.floor(
                time / 60
            )} Hours ${Math.floor(time % 60)} minutes before retrying.`;
        }
        return {
            validateResend: smsCount.length > 3 ? false : true,
            problem: problem,
        };
    }

    async deleteBy(query: Query, userId: string) {
        const smsCount = await SmsCountModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            },
            {
                new: true,
            }
        );
        return smsCount;
    }

    async hardDeleteBy(query: Query) {
        await SmsCountModel.deleteMany(query);
        return 'SmsCount(s) removed successfully';
    }
}

import SmsCountModel from '../models/smsCount';
import moment from 'moment';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';
