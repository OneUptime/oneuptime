const ScriptModel = require('../models/automatedScripts');
const ErrorService = require('./errorService');

module.exports = {
    findBy: async function(page, limit) {
        try {
            if (!page) {
                page = 1;
            }
            const sortDataList = await ScriptModel.find({}, '-__v')
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip((page - 1) * limit);
            return sortDataList;
        } catch (error) {
            ErrorService.log('automatedScript.findBy', error);
            throw error;
        }
    },

    create: async function(data) {
        try {
            let item = new ScriptModel();

            item.name = data.name;
            item.script = data.script;
            item = await item.save();

            return item;
        } catch (error) {
            ErrorService.log('automatedScript.create', error);
            throw error;
        }
    },

    deleteBy: async function(scriptId) {
        try {
            const items = await ScriptModel.findOneAndDelete({ _id: scriptId });
            return items;
        } catch (error) {
            ErrorService.log('automatedScript.findOneAndUpdate', error);
            throw error;
        }
    },

    hardDeleteBy: async function({ query }) {
        try {
            await ScriptModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('callLogs.hardDeleteBy', error);
            throw error;
        }
    },
};
