export default {
    create: async function (data: $TSFixMe) {
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
    },

    updateOneBy: async function (query: $TSFixMe, data: $TSFixMe) {
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
        if (updatedEmailSmtp && updatedEmailSmtp.pass && updatedEmailSmtp.iv) {
            updatedEmailSmtp.pass = await EncryptDecrypt.decrypt(
                updatedEmailSmtp.pass,
                updatedEmailSmtp.iv.buffer
            );
            delete updatedEmailSmtp.iv;
        }
        return updatedEmailSmtp;
    },

    updateBy: async function (query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedData = await EmailSmtpModel.updateMany(query, {
            $set: data,
        });
        const select =
            'projectId user pass host port from name iv secure enabled createdAt';
        const populate = [{ path: 'projectId', select: 'name' }];
        updatedData = await this.findBy({ query, select, populate });
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
    },

    deleteBy: async function (query: $TSFixMe, userId: $TSFixMe) {
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
    },

    findBy: async function ({
        query,
        skip,
        limit,
        select,
        populate,
    }: $TSFixMe) {
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
        let emailSmtpQuery = EmailSmtpModel.find(query)
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip)
            .lean();
        emailSmtpQuery = handleSelect(select, emailSmtpQuery);
        emailSmtpQuery = handlePopulate(populate, emailSmtpQuery);
        const emailSmtp = await emailSmtpQuery;
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
    },

    findOneBy: async function ({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        let emailSmtpQuery = EmailSmtpModel.findOne(query)
            .sort([['createdAt', -1]])
            .lean();
        emailSmtpQuery = handleSelect(select, emailSmtpQuery);
        emailSmtpQuery = handlePopulate(populate, emailSmtpQuery);
        let emailSmtp = await emailSmtpQuery;
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
    },

    countBy: async function (query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await EmailSmtpModel.countDocuments(query);
        return count;
    },

    hardDeleteBy: async function (query: $TSFixMe) {
        await EmailSmtpModel.deleteMany(query);
        return 'Email Smtp(s) removed successfully';
    },
};

import Crypto from 'crypto';
import EmailSmtpModel from '../models/smtp';
import EncryptDecrypt from '../config/encryptDecrypt';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
