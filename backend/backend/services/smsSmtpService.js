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
            ErrorService.log('SmsSmtpService.save', error);
            throw error;
        }
    },

    update: async function (data) {
        try {
            let _this = this;
            if (!data._id) {
                let smsSmtp = await _this.create(data);
                return smsSmtp;
            } else {
                var smsSmtp = await _this.findOneBy({ _id: data._id });
                if (smsSmtp && smsSmtp.authToken) {
                    smsSmtp.authToken = await EncryptDecrypt.encrypt(smsSmtp.authToken);
                }
                    
                if (data.authToken) {
                    data.authToken = await EncryptDecrypt.encrypt(data.authToken);
                }
                let accountSid = data.accountSid || smsSmtp.accountSid;
                let authToken = data.authToken || smsSmtp.authToken;
                let phoneNumber = data.phoneNumber || smsSmtp.phoneNumber;
                let enabled = data.smssmtpswitch !== undefined ? data.smssmtpswitch : smsSmtp.enabled;
                
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
    
                return updatedSmsSmtp;
            }
        } catch (error) {
            ErrorService.log('SmsSmtpService.update', error);
            throw error;
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
            return smsSmtp;
        } catch (error) {
            ErrorService.log('SmsSmtpService.deleteBy', error);
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
            ErrorService.log('SmsSmtpService.findBy', error);
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
            ErrorService.log('SmsSmtpService.findOneBy', error);
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
            ErrorService.log('SmsSmtpService.countBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function (query) {
        try {
            await SmsSmtpModel.deleteMany(query);
            return 'Sms Smtp(s) removed successfully';
        } catch (error) {
            ErrorService.log('SmsSmtpService.hardDeleteBy', error);
            throw error;
        }
    },
};

var SmsSmtpModel = require('../models/twilio');
var ErrorService = require('./errorService');
var EncryptDecrypt = require('../config/encryptDecrypt');
