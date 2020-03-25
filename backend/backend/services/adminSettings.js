/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    findOne: async function(query) {
        try {
            return await GlobalConfigModel.findOne(query);
        } catch (error) {
            ErrorService.log('adminSettings.findBy`  ', error);
            throw error;
        }
    },

    create: async function(type, settings, userId) {
        try {
            const doc = new GlobalConfigModel();
            doc.name = `${userId}-${type}-settings`;
            doc.value = settings;
            return await doc.save();
        } catch (error) {
            ErrorService.log('adminSettings.create', error);
            throw error;
        }
    },

    updateOne: async function(query = {}, data) {
        try {
            return await GlobalConfigModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
        } catch (error) {
            ErrorService.log('adminSettings.updateOneBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await GlobalConfigModel.deleteMany(query);
            return 'Setting(s) removed successfully';
        } catch (error) {
            ErrorService.log('adminSettings.hardDeleteBy', error);
            throw error;
        }
    },
};

const GlobalConfigModel = require('../models/globalConfig');
const ErrorService = require('./errorService');
