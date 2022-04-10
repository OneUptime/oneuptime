export default class Service {
    async create({ name, value }: $TSFixMe) {
        if (name === 'smtp' && value.internalSmtp && !value.customSmtp) {
            value = {
                internalSmtp: true,
                customSmtp: false,
                'email-enabled': true,
            };
        }

        if (name === 'twilio' && value['authentication-token']) {
            const iv = Crypto.randomBytes(16);
            value['authentication-token'] = await EncryptDecrypt.encrypt(
                value['authentication-token'],
                iv
            );
            value['iv'] = iv;
        } else if (name === 'smtp' && value['password']) {
            const iv = Crypto.randomBytes(16);
            value['password'] = await EncryptDecrypt.encrypt(
                value['password'],
                iv
            );
            value['iv'] = iv;
        }

        let globalConfig = new GlobalConfigModel();

        globalConfig.name = name;

        globalConfig.value = value;
        globalConfig = await globalConfig.save();

        if (globalConfig.name === 'twilio') {
            globalConfig.value['authentication-token'] =
                await EncryptDecrypt.decrypt(
                    globalConfig.value['authentication-token'],

                    globalConfig.value['iv']
                );

            delete globalConfig.value['iv'];
        }
        if (
            globalConfig.name === 'smtp' &&
            (!globalConfig.value.internalSmtp ||
                (globalConfig.value.internalSmtp &&
                    globalConfig.value.customSmtp))
        ) {
            globalConfig.value['password'] = await EncryptDecrypt.decrypt(
                globalConfig.value['password'],

                globalConfig.value['iv']
            );

            delete globalConfig.value['iv'];
        }

        return globalConfig;
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (
            query.name === 'smtp' &&
            data.value.internalSmtp &&
            !data.value.customSmtp
        ) {
            data.value = {
                internalSmtp: true,
                customSmtp: false,
                'email-enabled': true,
            };
        }

        if (
            query.name === 'twilio' &&
            data &&
            data.value &&
            data.value['authentication-token']
        ) {
            const { value } = data;
            const iv = Crypto.randomBytes(16);
            value['authentication-token'] = await EncryptDecrypt.encrypt(
                value['authentication-token'],
                iv
            );
            value['iv'] = iv;
        } else if (
            query.name === 'smtp' &&
            data &&
            data.value &&
            data.value['password']
        ) {
            const { value } = data;
            const iv = Crypto.randomBytes(16);
            value['password'] = await EncryptDecrypt.encrypt(
                value['password'],
                iv
            );
            value['iv'] = iv;
        }

        const globalConfig = await GlobalConfigModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        if (globalConfig.name === 'twilio') {
            globalConfig.value['authentication-token'] =
                await EncryptDecrypt.decrypt(
                    globalConfig.value['authentication-token'],
                    globalConfig.value['iv'].buffer
                );
            delete globalConfig.value['iv'];
        } else if (
            globalConfig.name === 'smtp' &&
            (!globalConfig.value.internalSmtp ||
                (globalConfig.value.internalSmtp &&
                    globalConfig.value.customSmtp))
        ) {
            globalConfig.value['password'] = await EncryptDecrypt.decrypt(
                globalConfig.value['password'],
                globalConfig.value['iv'].buffer
            );
            delete globalConfig.value['iv'];
        }

        return globalConfig;
    }

    async updateBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        let globalConfigs = await GlobalConfigModel.updateMany(query, {
            $set: data,
        });

        const selectConfig = 'name value createdAt';
        globalConfigs = await this.findBy({ query, select: selectConfig });

        return globalConfigs;
    }

    async findBy({ query, skip, limit, populate, select, sort }: FindBy) {
        if (!skip) skip = 0;
        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = parseInt(skip);
        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) {
            query = {};
        }

        const globalConfigsQuery = GlobalConfigModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        globalConfigsQuery.select(select);
        globalConfigsQuery.populate(populate);

        const globalConfigs = await globalConfigsQuery;
        for (const globalConfig of globalConfigs) {
            if (globalConfig.name === 'twilio') {
                if (
                    globalConfig.value['iv'] &&
                    globalConfig.value['authentication-token']
                ) {
                    globalConfig.value['authentication-token'] =
                        await EncryptDecrypt.decrypt(
                            globalConfig.value['authentication-token'],
                            globalConfig.value['iv'].buffer
                        );
                    delete globalConfig.value['iv'];
                }
            } else if (
                globalConfig.name === 'smtp' &&
                (!globalConfig.value.internalSmtp ||
                    (globalConfig.value.internalSmtp &&
                        globalConfig.value.customSmtp))
            ) {
                if (
                    globalConfig.value['iv'] &&
                    globalConfig.value['password']
                ) {
                    globalConfig.value['password'] =
                        await EncryptDecrypt.decrypt(
                            globalConfig.value['password'],
                            globalConfig.value['iv'].buffer
                        );
                    delete globalConfig.value['iv'];
                }
            }
        }

        return globalConfigs;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        // we won't use lean here because of iv that should be a buffer
        const globalConfigQuery = GlobalConfigModel.findOne(query).sort(sort);

        globalConfigQuery.select(select);
        globalConfigQuery.populate(populate);

        const globalConfig = await globalConfigQuery;

        if (globalConfig && globalConfig.name === 'twilio') {
            if (
                globalConfig.value['iv'] &&
                globalConfig.value['authentication-token']
            ) {
                globalConfig.value['authentication-token'] =
                    await EncryptDecrypt.decrypt(
                        globalConfig.value['authentication-token'],
                        globalConfig.value['iv'].buffer
                    );
                delete globalConfig.value['iv'];
            }
        } else if (
            globalConfig &&
            globalConfig.name === 'smtp' &&
            (!globalConfig.value.internalSmtp ||
                (globalConfig.value.internalSmtp &&
                    globalConfig.value.customSmtp))
        ) {
            if (globalConfig.value['iv'] && globalConfig.value['password']) {
                globalConfig.value['password'] = await EncryptDecrypt.decrypt(
                    globalConfig.value['password'],
                    globalConfig.value['iv'].buffer
                );
                delete globalConfig.value['iv'];
            }
        }
        return globalConfig;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        const count = await GlobalConfigModel.countDocuments(query);

        return count;
    }

    async hardDeleteBy(query: Query) {
        await GlobalConfigModel.deleteMany(query);
        return 'Global Config(s) Removed Successfully!';
    }
}

import Crypto from 'crypto';
import GlobalConfigModel from '../Models/globalConfig';
import EncryptDecrypt from '../config/encryptDecrypt';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';
