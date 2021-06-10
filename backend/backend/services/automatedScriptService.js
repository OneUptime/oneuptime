const ScriptModel = require('../models/automatedScripts');
const getSlug = require('../utils/getSlug');
const ErrorService = require('./errorService');

module.exports = {
    findBy: async function(query, skip, limit) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 10;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) query = {};

            query.deleted = false;

            const sortDataList = await ScriptModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);
            return sortDataList;
        } catch (error) {
            ErrorService.log('automatedScript.findBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const count = await ScriptModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('automatedScript.countBy', error);
            throw error;
        }
    },

    create: async function(data) {
        try {
            const script = new ScriptModel();
            script.name = data.name || null;
            script.script = data.script || null;
            script.slug = getSlug(data.name) || null;
            script.scriptType = data.scriptType || null;
            script.successEvent = data.successEvent || null;
            script.failureEvent = data.failureEvent || null;
            script.projectId = data.projectId || null;
            script.createdById = data.createdById || null;
            const newScript = await script.save();

            return newScript;
        } catch (error) {
            ErrorService.log('automatedScript.create', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const response = await ScriptModel.findOne(query).populate(
                'createdById',
                'name'
            );
            return response;
        } catch (error) {
            ErrorService.log('automatedScript.findOneBy', error);
            throw error;
        }
    },

    getAutomatedService: async function(query) {
        try {
            const _this = this;
            const response = await _this.findOneBy(query);
            return response;
        } catch (error) {
            ErrorService.log('automatedScript.getAutomatedService', error);
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
