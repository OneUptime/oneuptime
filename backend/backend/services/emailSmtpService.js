module.exports = {
    create: async function (data) {
        try {
            data.pass = await EncryptDecrypt.encrypt(data.pass);
            var emailSmtpModel = new EmailSmtpModel();
            emailSmtpModel.projectId = data.projectId;
            emailSmtpModel.user = data.user;
            emailSmtpModel.pass = data.pass;
            emailSmtpModel.host = data.host;
            emailSmtpModel.port = data.port;
            emailSmtpModel.from = data.from;
            emailSmtpModel.secure = false;
            if (data.secure) {
                emailSmtpModel.secure = data.secure;
            }
            emailSmtpModel.enabled = true;
            var emailSmtp = await emailSmtpModel.save();
            if (emailSmtp && emailSmtp.pass) {
                emailSmtp.pass = await EncryptDecrypt.decrypt(emailSmtp.pass);
            }
            return emailSmtp;
        } catch (error) {
            ErrorService.log('emailSmtpService.create', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;

            if (data.pass) {
                data.pass = await EncryptDecrypt.encrypt(data.pass);
            }

            var updatedEmailSmtp = await EmailSmtpModel.findOneAndUpdate(query, {
                $set: data
            }, {
                new: true
            }).lean();
            if (updatedEmailSmtp && updatedEmailSmtp.pass) {
                updatedEmailSmtp.pass = await EncryptDecrypt.decrypt(updatedEmailSmtp.pass);
            }
        } catch (error) {
            ErrorService.log('EmailSmtpModel.findByIdAndUpdate', error);
            throw error;
        }

        return updatedEmailSmtp;
    },

    updateBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var updatedData = await EmailSmtpModel.updateMany(query, {
                $set: data
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('emailSmtpService.updateMany', error);
            throw error;
        }
    },

    deleteBy: async function (query, userId) {
        try {
            var emailSmtp = await EmailSmtpModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            }, {
                new: true
            });
            return emailSmtp;
        } catch (error) {
            ErrorService.log('emailSmtpService.deleteBy', error);
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
            var emailSmtp = await EmailSmtpModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .lean();
            emailSmtp.map(async es => {
                if (es && es.pass) {
                    es.pass = await EncryptDecrypt.decrypt(es.pass);
                }
            });
            return emailSmtp;
        } catch (error) {
            ErrorService.log('emailSmtpService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var emailSmtp = await EmailSmtpModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .lean();
            if (emailSmtp && emailSmtp.pass) {
                emailSmtp.pass = await EncryptDecrypt.decrypt(emailSmtp.pass);
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

    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var count = await EmailSmtpModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('emailSmtpService.countBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function (query) {
        try {
            await EmailSmtpModel.deleteMany(query);
            return 'Email Smtp(s) removed successfully';
        } catch (error) {
            ErrorService.log('emailSmtpService.hardDeleteBy', error);
            throw error;
        }
    },
};

var EmailSmtpModel = require('../models/smtp');
var ErrorService = require('./errorService');
var EncryptDecrypt = require('../config/encryptDecrypt');
