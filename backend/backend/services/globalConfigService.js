module.exports = {
    create: async function({ name, value }) {
        try {
            let globalConfig = new GlobalConfigModel();

            globalConfig.name = name;
            globalConfig.value = value;

            globalConfig = await globalConfig.save();

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

            const globalConfig = await GlobalConfigModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

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
