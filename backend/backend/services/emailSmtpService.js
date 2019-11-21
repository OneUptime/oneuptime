module.exports = {
    create: async function (data) {
        data.pass = await EncryptDecrypt.encrypt(data.pass);
        var emailSmtpModel = new EmailSmtpModel();
        emailSmtpModel.projectId = data.projectId;
        emailSmtpModel.user = data.user;
        emailSmtpModel.pass = data.pass;
        emailSmtpModel.host = data.host;
        emailSmtpModel.port = data.port;
        emailSmtpModel.from = data.from;
        emailSmtpModel.secure = false;
        if(data.secure){
            emailSmtpModel.secure = data.secure;
        }
        emailSmtpModel.enabled = true;
        try {
            var emailSmtp = await emailSmtpModel.save();
            if (emailSmtp && emailSmtp.pass) {
                emailSmtp.pass = await EncryptDecrypt.decrypt(emailSmtp.pass);
            }
        } catch (error) {
            ErrorService.log('emailSmtpModel.save', error);
            throw error;
        }
        return emailSmtp;
    },

    update: async function (data) {
        let _this = this;
        if (!data._id) {
            try {
                let emailSmtp = await _this.create(data);
                return emailSmtp;
            } catch (error) {
                ErrorService.log('EmailSmtpService.create', error);
                throw error;
            }
        } else {
            try {
                var emailSmtp = await _this.findOneBy({ _id: data._id });
                if (emailSmtp && emailSmtp.pass) {
                    emailSmtp.pass = await EncryptDecrypt.encrypt(emailSmtp.pass);
                }
            } catch (error) {
                ErrorService.log('EmailSmtpService.findOneBy', error);
                throw error;
            }
            if (data.pass) {
                data.pass = await EncryptDecrypt.encrypt(data.pass);
            }
            let user = data.user || emailSmtp.user;
            let pass = data.pass || emailSmtp.pass;
            let host = data.host || emailSmtp.host;
            let port = data.port || emailSmtp.port;
            let from = data.from || emailSmtp.from;
            let secure = data.secure !== undefined ? data.secure : emailSmtp.secure;
            let enabled = data.smtpswitch !== undefined ? data.smtpswitch : emailSmtp.enabled;
            try {
                var updatedEmailSmtp = await EmailSmtpModel.findByIdAndUpdate(data._id, {
                    $set: {
                        user: user,
                        pass: pass,
                        host: host,
                        port: port,
                        from: from,
                        secure:secure,
                        enabled: enabled
                    }
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
        } catch (error) {
            ErrorService.log('EmailSmtpModel.findOneAndUpdate', error);
            throw error;
        }
        return emailSmtp;
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
            var emailSmtp = await EmailSmtpModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .lean();
            if (emailSmtp && emailSmtp.pass) {
                emailSmtp.pass = await EncryptDecrypt.decrypt(emailSmtp.pass);
            }

        } catch (error) {
            ErrorService.log('EmailSmtpModel.find', error);
            throw error;
        }

        return emailSmtp;
    },

    findOneBy: async function (query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var emailSmtp = await EmailSmtpModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .lean();
            if (emailSmtp && emailSmtp.pass) {
                emailSmtp.pass = await EncryptDecrypt.decrypt(emailSmtp.pass);
            }
        } catch (error) {
            ErrorService.log('EmailSmtpModel.findOne', error);
            throw error;
        }
        if (!emailSmtp) {
            emailSmtp = {};
        }

        return emailSmtp;
    },

    countBy: async function (query) {

        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var count = await EmailSmtpModel.count(query);
        } catch (error) {
            ErrorService.log('EmailSmtpModel.count', error);
            throw error;
        }
        return count;
    },

    hardDeleteBy: async function (query) {
        try {
            await EmailSmtpModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('EmailSmtpModel.deleteMany', error);
            throw error;
        }
        return 'Email Smtp(s) removed successfully';
    },
};

var EmailSmtpModel = require('../models/smtp');
var ErrorService = require('./errorService');
var EncryptDecrypt = require('../config/encryptDecrypt');
