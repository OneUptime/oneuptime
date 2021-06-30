module.exports = {
    create: async function(data) {
        try {
            const _this = this;
            let lighthouseKey;
            if (data.lighthouseKey) {
                lighthouseKey = data.lighthouseKey;
            } else {
                lighthouseKey = uuidv1();
            }
            const storedlighthouse = await _this.findOneBy({
                lighthouseName: data.lighthouseName,
            });
            if (storedlighthouse && storedlighthouse.lighthouseName) {
                const error = new Error('lighthouse name already exists.');
                error.code = 400;
                ErrorService.log('lighthouse.create', error);
                throw error;
            } else {
                const lighthouse = new LighthouseModel();
                lighthouse.lighthouseKey = lighthouseKey;
                lighthouse.lighthouseName = data.lighthouseName;
                lighthouse.version = data.lighthouseVersion;
                const savedlighthouse = await lighthouse.save();
                return savedlighthouse;
            }
        } catch (error) {
            ErrorService.log('lighthouseService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const lighthouse = await LighthouseModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );
            return lighthouse;
        } catch (error) {
            ErrorService.log('lighthouseService.updateOneBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const lighthouse = await LighthouseModel.findOne(query, {
                deleted: false,
            }).lean();
            return lighthouse;
        } catch (error) {
            ErrorService.log('lighthouseService.findOneBy', error);
            throw error;
        }
    },

}
const LighthouseModel = require('../models/lighthouse');
const ErrorService = require('./errorService');