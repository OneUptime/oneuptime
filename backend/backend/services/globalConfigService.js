module.exports = {
    create: async function({ name, value }) {
        try {
            if(name === 'twilio'){
                value['encrypted-authentication-token']= await EncryptDecrypt.encrypt(value['authentication-token']);
                delete value['authentication-token'];
            }

            let globalConfig = new GlobalConfigModel();
            globalConfig.name = name;
            globalConfig.value = value;
            globalConfig = await globalConfig.save();

            if(globalConfig.name === 'twilio'){
                globalConfig.value['authentication-token']= await EncryptDecrypt.decrypt(value['encrypted-authentication-token']);
                delete value['encrypted-authentication-token'];
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

            if( query.name ==='twilio' && 
                    data && 
                    data.value && 
                    data.value['authentication-token']
            ){
                const {value}= data;
                value['encrypted-authentication-token']= await EncryptDecrypt.encrypt(value['authentication-token']);
                delete value['authentication-token'];
            }

            const globalConfig = await GlobalConfigModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

            if(globalConfig.name === 'twilio'){
                globalConfig.value['authentication-token']= await EncryptDecrypt.decrypt(globalConfig.value['encrypted-authentication-token']);
                delete globalConfig.value['encrypted-authentication-token'];
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

            if(globalConfig && globalConfig.name === 'twilio'){
                globalConfig.value['authentication-token']= await EncryptDecrypt.decrypt(globalConfig.value['encrypted-authentication-token']);
                delete globalConfig.value['encrypted-authentication-token'];
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

const GlobalConfigModel = require('../models/globalConfig');
const ErrorService = require('./errorService');
const EncryptDecrypt = require('../config/encryptDecrypt');
