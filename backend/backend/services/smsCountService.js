module.exports = {
    findBy: async function (query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 10;

            if (typeof (skip) === 'string') skip = parseInt(skip);

            if (typeof (limit) === 'string') limit = parseInt(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            var SmsCount = await SmsCountModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('userIds', 'name');
            return SmsCount;
        } catch (error) {
            ErrorService.log('smsCountService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var SmsCount = await SmsCountModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('userIds', 'name');
            return SmsCount;
        } catch (error) {
            ErrorService.log('smsCountService.findOneBy', error);
            throw error;
        }
    },

    create: async function (userId, sentTo,projectId) {
        try {
            var smsCountModel = new SmsCountModel();
            smsCountModel.userId = userId || null;
            smsCountModel.sentTo = sentTo || null;
            smsCountModel.projectId = projectId || null;
            var smsCount = await smsCountModel.save();
            return smsCount;
        } catch (error) {
            ErrorService.log('smsCountService.create', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var count = await SmsCountModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('smsCountService.countBy', error);
            throw error;
        }
    },

    validateResend: async function (userId) {
        try {
            const _this = this;
            var smsCount = await _this.findBy({ userId: userId, createdAt: { '$gt': new Date(Date.now() - 24 * 60 * 60 * 1000) } }, 4, 0);
            if (smsCount.length > 3) {
                let time = moment(smsCount[3].createdAt).add(1, 'days');
                time = time.diff(moment(Date.now()),'minutes');
                var problem = `You have exhausted the maximum limit of sms resends in a day please wait ${Math.floor(time / 60)} Hours ${Math.floor(time % 60)} minutes before retrying.`;
            }
            return {validateResend : smsCount.length > 3 ? false : true,problem : problem || ''};
        } catch (error) {
            ErrorService.log('smsCountService.validateResend', error);
            throw error;
        }
    },

    deleteBy: async function (query, userId) {
        try {
            var smsCount = await SmsCountModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            }, {
                new: true
            });
            return smsCount;
        } catch (error) {
            ErrorService.log('smsCountService.deleteBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function (query) {
        try {
            await SmsCountModel.deleteMany(query);
            return 'SmsCount(s) removed successfully';
        } catch (error) {
            ErrorService.log('smsCountService.hardDeleteBy', error);
            throw error;
        }
    }
};

var SmsCountModel = require('../models/smsCount');
var moment = require('moment');
var ErrorService = require('../services/errorService');
