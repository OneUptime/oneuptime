module.exports = {
    findBy: async function (query, limit, skip) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof (skip) === 'string') skip = parseInt(skip);

        if (typeof (limit) === 'string') limit = parseInt(limit);

        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        try {
            var SmsCount = await SmsCountModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('userIds', 'name');
        } catch (error) {
            ErrorService.log('SmsCountModel.find', error);
            throw error;
        }
        return SmsCount;
    },

    findOneBy: async function (query) {

        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
            var SmsCount = await SmsCountModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('userIds', 'name');
        } catch (error) {
            ErrorService.log('SmsCountModel.findOne', error);
            throw error;
        }

        return SmsCount;
    },

    create: async function (userId, sentTo) {

        var smsCountModel = new SmsCountModel();
        smsCountModel.userId = userId || null;
        smsCountModel.sentTo = sentTo || null;
        try {
            var smsCount = await smsCountModel.save();
        } catch (error) {
            ErrorService.log('SmsCountModel.save', error);
            throw error;
        }
        return smsCount;
    },

    countBy: async function (query) {

        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
            var count = await SmsCountModel.count(query);
        } catch (error) {
            ErrorService.log('SmsCountModel.count', error);
            throw error;
        }
        return count;
    },

    validateResend: async function (userId) {
        const _this = this;
        try {
            var smsCount = await _this.findBy({ userId: userId, createdAt: { '$gt': new Date(Date.now() - 24 * 60 * 60 * 1000) } }, 4, 0);
            if (smsCount.length > 3) {
                let time = moment(smsCount[3].createdAt).add(1, 'days');
                time = time.diff(moment(Date.now()),'minutes');
                var problem = `You have exhausted the maximum limit of sms resends in a day please wait ${Math.floor(time / 60)} Hours ${Math.floor(time % 60)} minutes before retrying.`;
            }
        } catch (error) {
            ErrorService.log('SmsCountService.validateResend', error);
            throw error;
        }
        return {validateResend : smsCount.length > 3 ? false : true,problem : problem || ''};
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
        } catch (error) {
            ErrorService.log('SmsCountModel.findOneAndUpdate', error);
            throw error;
        }
        return smsCount;
    },

    hardDeleteBy: async function (query) {
        try {
            await SmsCountModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('SmsCountModel.deleteMany', error);
            throw error;
        }
        return 'SmsCount(s) removed successfully';
    }
};

var SmsCountModel = require('../models/smsCount');
var moment = require('moment');
var ErrorService = require('../services/errorService');