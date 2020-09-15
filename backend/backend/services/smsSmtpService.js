module.exports = {
    create: async function(data) {
        try {
            const iv = Crypto.randomBytes(16);
            data.authToken = await EncryptDecrypt.encrypt(data.authToken, iv);
            const twilioModel = new TwilioModel();
            twilioModel.projectId = data.projectId;
            twilioModel.accountSid = data.accountSid;
            twilioModel.authToken = data.authToken;
            twilioModel.phoneNumber = data.phoneNumber;
            twilioModel.iv = iv;
            twilioModel.enabled = true;
            const twilioSettings = await twilioModel.save();
            if (
                twilioSettings &&
                twilioSettings.authToken &&
                twilioSettings.iv
            ) {
                twilioSettings.authToken = await EncryptDecrypt.decrypt(
                    twilioSettings.authToken,
                    twilioSettings.iv
                );
                delete twilioSettings.iv;
            }
            return twilioSettings;
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
            const iv = Crypto.randomBytes(16);
            data.authToken = await EncryptDecrypt.encrypt(data.authToken, iv);
            data.iv = iv;
        }
        try {
            const updatedTwilioSettings = await TwilioModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            ).lean();
            if (
                updatedTwilioSettings &&
                updatedTwilioSettings.authToken &&
                updatedTwilioSettings.iv
            ) {
                updatedTwilioSettings.authToken = await EncryptDecrypt.decrypt(
                    updatedTwilioSettings.authToken,
                    updatedTwilioSettings.iv.buffer
                );
                delete updatedTwilioSettings.iv;
            }
            return updatedTwilioSettings;
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
            let updatedData = await TwilioModel.updateMany(query, {
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
            const deletedData = await TwilioModel.findOneAndUpdate(
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
            if (deletedData && deletedData.authToken && deletedData.iv) {
                deletedData.authToken = await EncryptDecrypt.decrypt(
                    deletedData.authToken,
                    deletedData.iv.buffer
                );
                delete deletedData.iv;
            }
            return deletedData;
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
            const twilioSettings = await TwilioModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .lean();

            for (const config of twilioSettings) {
                if (config && config.authToken && config.iv) {
                    config.authToken = await EncryptDecrypt.decrypt(
                        config.authToken,
                        config.iv.buffer
                    );
                    delete config.iv;
                }
            }
            return twilioSettings;
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
            const twilio = await TwilioModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .lean();
            if (twilio && twilio.authToken && twilio.iv) {
                twilio.authToken = await EncryptDecrypt.decrypt(
                    twilio.authToken,
                    twilio.iv.buffer
                );
                delete twilio.iv;
            }

            return twilio;
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
            const count = await TwilioModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('smsSmtpService.countBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await TwilioModel.deleteMany(query);
            return 'SMS Smtp(s) removed successfully';
        } catch (error) {
            ErrorService.log('smsSmtpService.hardDeleteBy', error);
            throw error;
        }
    },
};

const Crypto = require('crypto');
const TwilioModel = require('../models/twilio');
const ErrorService = require('./errorService');
const EncryptDecrypt = require('../config/encryptDecrypt');
