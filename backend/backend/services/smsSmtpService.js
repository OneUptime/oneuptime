module.exports = {
    create: async function(data) {
        try {
            data.authToken = await EncryptDecrypt.encrypt(data.authToken);
            const smsSmtpModel = new SmsSmtpModel();
            smsSmtpModel.projectId = data.projectId;
            smsSmtpModel.accountSid = data.accountSid;
            smsSmtpModel.authToken = data.authToken;
            smsSmtpModel.phoneNumber = data.phoneNumber;
            smsSmtpModel.enabled = true;
            const smsSmtp = await smsSmtpModel.save();
            if (smsSmtp && smsSmtp.authToken) {
                smsSmtp.authToken = await EncryptDecrypt.decrypt(
                    smsSmtp.authToken
                );
            }
            return smsSmtp;
        } catch (error) {
            ErrorService.log('smsSmtpService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        if (data.authToken) {
            data.authToken = await EncryptDecrypt.encrypt(data.authToken);
        }
        try {
            const updatedSmsSmtp = await SmsSmtpModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            ).lean();
            if (updatedSmsSmtp && updatedSmsSmtp.authToken) {
                updatedSmsSmtp.authToken = await EncryptDecrypt.decrypt(
                    updatedSmsSmtp.authToken
                );
            }
            return updatedSmsSmtp;
        } catch (error) {
            ErrorService.log('smsSmtpService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await SmsSmtpModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('smsSmtpService.updateMany', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            const smsSmtp = await SmsSmtpModel.findOneAndUpdate(
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
            return smsSmtp;
        } catch (error) {
            ErrorService.log('smsSmtpService.deleteBy', error);
            throw error;
        }
    },

    findBy: async function(query, skip, limit) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 10;

            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            query.deleted = false;
            const smsSmtp = await SmsSmtpModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .lean();
            if (smsSmtp && smsSmtp.authToken) {
                smsSmtp.authToken = await EncryptDecrypt.decrypt(
                    smsSmtp.authToken
                );
            }

            return smsSmtp;
        } catch (error) {
            ErrorService.log('smsSmtpService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            let smsSmtp = await SmsSmtpModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .lean();
            if (smsSmtp && smsSmtp.authToken) {
                smsSmtp.authToken = await EncryptDecrypt.decrypt(
                    smsSmtp.authToken
                );
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

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const count = await SmsSmtpModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('smsSmtpService.countBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await SmsSmtpModel.deleteMany(query);
            return 'Sms Smtp(s) removed successfully';
        } catch (error) {
            ErrorService.log('smsSmtpService.hardDeleteBy', error);
            throw error;
        }
    },
};

const SmsSmtpModel = require('../models/twilio');
const ErrorService = require('./errorService');
const EncryptDecrypt = require('../config/encryptDecrypt');
