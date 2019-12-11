module.exports = {
    create: async function (data) {
        try {
            data.authToken = await EncryptDecrypt.encrypt(data.authToken);
            var smsSmtpModel = new SmsSmtpModel();
            smsSmtpModel.projectId = data.projectId;
            smsSmtpModel.accountSid = data.accountSid;
            smsSmtpModel.authToken = data.authToken;
            smsSmtpModel.phoneNumber = data.phoneNumber;
            smsSmtpModel.enabled = true;
            var smsSmtp = await smsSmtpModel.save();
            if (smsSmtp && smsSmtp.authToken) {
                smsSmtp.authToken = await EncryptDecrypt.decrypt(smsSmtp.authToken);
            }
            return smsSmtp;
        } catch (error) {
            ErrorService.log('smsSmtpService.create', error);
            throw error;
        }
    },

    updateBy: async function (query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        if (data.authToken) {
            data.authToken = await EncryptDecrypt.encrypt(data.authToken);
        }
        try {
            var updatedSmsSmtp = await SmsSmtpModel.findOneAndUpdate(query, {
                $set: data
            }, {
                new: true
            }).lean();
            if (updatedSmsSmtp && updatedSmsSmtp.authToken) {
                updatedSmsSmtp.authToken = await EncryptDecrypt.decrypt(updatedSmsSmtp.authToken);
            }
        } catch (error) {
            ErrorService.log('smsSmtpService.updateBy', error);
            throw error;
        }

        return updatedSmsSmtp;
    },

    deleteBy: async function (query, userId) {
        try {
            var smsSmtp = await SmsSmtpModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            }, {
                new: true
            });
            return smsSmtp;
        } catch (error) {
            ErrorService.log('smsSmtpService.deleteBy', error);
            throw error;
        }
    },

    findBy: async function (query, skip, limit) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 10;

            if (typeof (skip) === 'string') {
                skip = parseInt(skip);
            }

            if (typeof (limit) === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            query.deleted = false;
            var smsSmtp = await SmsSmtpModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .lean();
            if (smsSmtp && smsSmtp.authToken) {
                smsSmtp.authToken = await EncryptDecrypt.decrypt(smsSmtp.authToken);
            }

            return smsSmtp;
        } catch (error) {
            ErrorService.log('smsSmtpService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var smsSmtp = await SmsSmtpModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .lean();
            if (smsSmtp && smsSmtp.authToken) {
                smsSmtp.authToken = await EncryptDecrypt.decrypt(smsSmtp.authToken);
            }
            if (!smsSmtp) {
                smsSmtp = {};
            }

            return smsSmtp;
        } catch (error) {
            ErrorService.log('smsSmtpService.findOneBy', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var count = await SmsSmtpModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('smsSmtpService.countBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function (query) {
        try {
            await SmsSmtpModel.deleteMany(query);
            return 'Sms Smtp(s) removed successfully';
        } catch (error) {
            ErrorService.log('smsSmtpService.hardDeleteBy', error);
            throw error;
        }
    },
};

var SmsSmtpModel = require('../models/twilio');
var ErrorService = require('./errorService');
var EncryptDecrypt = require('../config/encryptDecrypt');
