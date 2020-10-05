module.exports = {
    create: async function(data) {
        try {
            const iv = Crypto.randomBytes(16);
            data.pass = await EncryptDecrypt.encrypt(data.pass, iv);
            const emailSmtpModel = new EmailSmtpModel();
            emailSmtpModel.projectId = data.projectId;
            emailSmtpModel.user = data.user;
            emailSmtpModel.pass = data.pass;
            emailSmtpModel.host = data.host;
            emailSmtpModel.port = data.port;
            emailSmtpModel.from = data.from;
            emailSmtpModel.name = data.name;
            emailSmtpModel.secure = false;
            emailSmtpModel.iv = iv;
            if (data.secure) {
                emailSmtpModel.secure = data.secure;
            }
            emailSmtpModel.enabled = true;
            const emailSmtp = await emailSmtpModel.save();
            if (emailSmtp && emailSmtp.pass && emailSmtp.iv) {
                emailSmtp.pass = await EncryptDecrypt.decrypt(
                    emailSmtp.pass,
                    emailSmtp.iv
                );
                delete emailSmtp.iv;
            }
            return emailSmtp;
        } catch (error) {
            ErrorService.log('emailSmtpService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;

            if (data.pass) {
                const iv = Crypto.randomBytes(16);
                data.pass = await EncryptDecrypt.encrypt(data.pass, iv);
                data.iv = iv;
            }

            const updatedEmailSmtp = await EmailSmtpModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            ).lean();
            if (
                updatedEmailSmtp &&
                updatedEmailSmtp.pass &&
                updatedEmailSmtp.iv
            ) {
                updatedEmailSmtp.pass = await EncryptDecrypt.decrypt(
                    updatedEmailSmtp.pass,
                    updatedEmailSmtp.iv.buffer
                );
                delete updatedEmailSmtp.iv;
            }
            return updatedEmailSmtp;
        } catch (error) {
            ErrorService.log('EmailSmtpModel.findByIdAndUpdate', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await EmailSmtpModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            for (const updatedEmailSmtp of updatedData) {
                if (
                    updatedEmailSmtp &&
                    updatedEmailSmtp.pass &&
                    updatedEmailSmtp.iv
                ) {
                    updatedEmailSmtp.pass = await EncryptDecrypt.decrypt(
                        updatedEmailSmtp.pass,
                        updatedEmailSmtp.iv.buffer
                    );
                    delete updatedEmailSmtp.iv;
                }
            }
            return updatedData;
        } catch (error) {
            ErrorService.log('emailSmtpService.updateMany', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            const emailSmtp = await EmailSmtpModel.findOneAndUpdate(
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
            return emailSmtp;
        } catch (error) {
            ErrorService.log('emailSmtpService.deleteBy', error);
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
            const emailSmtp = await EmailSmtpModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .lean();
            for (const updatedEmailSmtp of emailSmtp) {
                if (
                    updatedEmailSmtp &&
                    updatedEmailSmtp.pass &&
                    updatedEmailSmtp.iv
                ) {
                    updatedEmailSmtp.pass = await EncryptDecrypt.decrypt(
                        updatedEmailSmtp.pass,
                        updatedEmailSmtp.iv.buffer
                    );
                    delete updatedEmailSmtp.iv;
                }
            }
            return emailSmtp;
        } catch (error) {
            ErrorService.log('emailSmtpService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            let emailSmtp = await EmailSmtpModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .lean();
            if (emailSmtp && emailSmtp.pass && emailSmtp.iv) {
                emailSmtp.pass = await EncryptDecrypt.decrypt(
                    emailSmtp.pass,
                    emailSmtp.iv.buffer
                );
                delete emailSmtp.iv;
            }
            if (!emailSmtp) {
                emailSmtp = {};
            }

            return emailSmtp;
        } catch (error) {
            ErrorService.log('emailSmtpService.findOneBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const count = await EmailSmtpModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('emailSmtpService.countBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await EmailSmtpModel.deleteMany(query);
            return 'Email Smtp(s) removed successfully';
        } catch (error) {
            ErrorService.log('emailSmtpService.hardDeleteBy', error);
            throw error;
        }
    },
};

const Crypto = require('crypto');
const EmailSmtpModel = require('../models/smtp');
const ErrorService = require('./errorService');
const EncryptDecrypt = require('../config/encryptDecrypt');
