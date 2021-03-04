module.exports = {
    create: async function({ name, value }) {
        try {
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
                globalConfig.value[
                    'authentication-token'
                ] = await EncryptDecrypt.decrypt(
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
        } catch (error) {
            ErrorService.log('globalConfigService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
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
                globalConfig.value[
                    'authentication-token'
                ] = await EncryptDecrypt.decrypt(
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
        } catch (error) {
            ErrorService.log('globalConfigService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            let globalConfigs = await GlobalConfigModel.updateMany(query, {
                $set: data,
            });
            globalConfigs = await this.findBy(query);

            return globalConfigs;
        } catch (error) {
            ErrorService.log('globalConfigService.updateMany', error);
            throw error;
        }
    },

    findBy: async function(query, skip, limit) {
        try {
            if (!skip) skip = 0;
            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);
            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) {
                query = {};
            }

            const globalConfigs = await GlobalConfigModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            for (const globalConfig of globalConfigs) {
                if (globalConfig.name === 'twilio') {
                    globalConfig.value[
                        'authentication-token'
                    ] = await EncryptDecrypt.decrypt(
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
                    globalConfig.value[
                        'password'
                    ] = await EncryptDecrypt.decrypt(
                        globalConfig.value['password'],
                        globalConfig.value['iv'].buffer
                    );
                    delete globalConfig.value['iv'];
                }
            }

            return globalConfigs;
        } catch (error) {
            ErrorService.log('globalConfigService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            const globalConfig = await GlobalConfigModel.findOne(query);

            if (globalConfig && globalConfig.name === 'twilio') {
                globalConfig.value[
                    'authentication-token'
                ] = await EncryptDecrypt.decrypt(
                    globalConfig.value['authentication-token'],
                    globalConfig.value['iv'].buffer
                );
                delete globalConfig.value['iv'];
            } else if (
                globalConfig &&
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
        } catch (error) {
            ErrorService.log('globalConfigService.findOneBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            const count = await GlobalConfigModel.countDocuments(query);

            return count;
        } catch (error) {
            ErrorService.log('globalConfigService.countBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await GlobalConfigModel.deleteMany(query);
            return 'Global Config(s) Removed Successfully!';
        } catch (error) {
            ErrorService.log('globalConfigService.hardDeleteBy', error);
            throw error;
        }
    },
};

const Crypto = require('crypto');
const GlobalConfigModel = require('../models/globalConfig');
const ErrorService = require('./errorService');
const EncryptDecrypt = require('../config/encryptDecrypt');
