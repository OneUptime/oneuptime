module.exports = {
    create: async function (data) {
        data.authToken = await EncryptDecrypt.encrypt(data.authToken);
        var smsSmtpModel = new SmsSmtpModel();
        smsSmtpModel.projectId = data.projectId;
        smsSmtpModel.accountSid = data.accountSid;
        smsSmtpModel.authToken = data.authToken;
        smsSmtpModel.phoneNumber = data.phoneNumber;
        smsSmtpModel.enabled = true;
        try {
            var smsSmtp = await smsSmtpModel.save();
            if (smsSmtp && smsSmtp.authToken) {
                smsSmtp.authToken = await EncryptDecrypt.decrypt(smsSmtp.authToken);
            }
        } catch (error) {
            ErrorService.log('smsSmtpModel.save', error);
            throw error;
        }
        return smsSmtp;
    },

    update: async function (data) {
        let _this = this;
        if (!data._id) {
            try {
                let smsSmtp = await _this.create(data);
                return smsSmtp;
            } catch (error) {
                ErrorService.log('SmsSmtpService.create', error);
                throw error;
            }
        } else {
            try {
                var smsSmtp = await _this.findOneBy({ _id: data._id });
                if (smsSmtp && smsSmtp.authToken) {
                    smsSmtp.authToken = await EncryptDecrypt.encrypt(smsSmtp.authToken);
                }
            } catch (error) {
                ErrorService.log('SmsSmtpService.findOneBy', error);
                throw error;
            }
            if (data.authToken) {
                data.authToken = await EncryptDecrypt.encrypt(data.authToken);
            }
            let accountSid = data.accountSid || smsSmtp.accountSid;
            let authToken = data.authToken || smsSmtp.authToken;
            let phoneNumber = data.phoneNumber || smsSmtp.phoneNumber;
            let enabled = data.smssmtpswitch !== undefined ? data.smssmtpswitch : smsSmtp.enabled;
            try {
                var updatedSmsSmtp = await SmsSmtpModel.findByIdAndUpdate(data._id, {
                    $set: {
                        accountSid: accountSid,
                        authToken: authToken,
                        phoneNumber: phoneNumber,
                        enabled: enabled
                    }
                }, {
                    new: true
                }).lean();
                if (updatedSmsSmtp && updatedSmsSmtp.authToken) {
                    updatedSmsSmtp.authToken = await EncryptDecrypt.decrypt(updatedSmsSmtp.authToken);
                }
            } catch (error) {
                ErrorService.log('SmsSmtpModel.findByIdAndUpdate', error);
                throw error;
            }

            return updatedSmsSmtp;
        }
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
        } catch (error) {
            ErrorService.log('SmsSmtpModel.findOneAndUpdate', error);
            throw error;
        }
        return smsSmtp;
    },

    findBy: async function (query, skip, limit) {
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

        try {
            var smsSmtp = await SmsSmtpModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .lean();
            if (smsSmtp && smsSmtp.authToken) {
                smsSmtp.authToken = await EncryptDecrypt.decrypt(smsSmtp.authToken);
            }

        } catch (error) {
            ErrorService.log('SmsSmtpModel.find', error);
            throw error;
        }

        return smsSmtp;
    },

    findOneBy: async function (query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var smsSmtp = await SmsSmtpModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .lean();
            if (smsSmtp && smsSmtp.authToken) {
                smsSmtp.authToken = await EncryptDecrypt.decrypt(smsSmtp.authToken);
            }
        } catch (error) {
            ErrorService.log('SmsSmtpModel.findOne', error);
            throw error;
        }
        if (!smsSmtp) {
            smsSmtp = {};
        }

        return smsSmtp;
    },

    countBy: async function (query) {

        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var count = await SmsSmtpModel.count(query);
        } catch (error) {
            ErrorService.log('SmsSmtpModel.count', error);
            throw error;
        }
        return count;
    },

    hardDeleteBy: async function (query) {
        try {
            await SmsSmtpModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('SmsSmtpModel.deleteMany', error);
            throw error;
        }
        return 'Sms Smtp(s) removed successfully';
    },
};

var SmsSmtpModel = require('../models/twilio');
var ErrorService = require('./errorService');
var EncryptDecrypt = require('../config/encryptDecrypt');
