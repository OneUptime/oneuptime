import Crypto from 'crypto';
import EmailSmtpModel from '../Models/smtp';
import EncryptDecrypt from '../config/encryptDecrypt';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    async create(data: $TSFixMe) {
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
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;

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
    }

    async updateBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
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
    }

    async deleteBy(query: Query, userId: string) {
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
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        query.deleted = false;
        const emailSmtpQuery = EmailSmtpModel.find(query)
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .lean();
        emailSmtpQuery.select(select);
        emailSmtpQuery.populate(populate);
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
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const emailSmtpQuery = EmailSmtpModel.findOne(query).sort(sort).lean();
        emailSmtpQuery.select(select);
        emailSmtpQuery.populate(populate);
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
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await EmailSmtpModel.countDocuments(query);
        return count;
    }

    async hardDeleteBy(query: Query) {
        await EmailSmtpModel.deleteMany(query);
        return 'Email Smtp(s) removed successfully';
    }
}
