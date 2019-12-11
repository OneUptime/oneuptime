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
            if(data.secure){
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

    update: async function (data) {
        try {
            let _this = this;
            if (!data._id) {
                let emailSmtp = await _this.create(data);
                return emailSmtp;
            } else {
                var emailSmtp = await _this.findOneBy({ _id: data._id });
                if (emailSmtp && emailSmtp.pass) {
                    emailSmtp.pass = await EncryptDecrypt.encrypt(emailSmtp.pass);
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
                return updatedEmailSmtp;
            }
        } catch (error) {
            ErrorService.log('emailSmtpService.update', error);
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
            if (emailSmtp && emailSmtp.pass) {
                emailSmtp.pass = await EncryptDecrypt.decrypt(emailSmtp.pass);
            }

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
