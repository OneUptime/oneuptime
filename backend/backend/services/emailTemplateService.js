module.exports = {
    create: async function (data) {

        var emailTemplateModel = new EmailTemplateModel();
        emailTemplateModel.projectId = data.projectId || null;
        emailTemplateModel.subject = data.subject || null;
        emailTemplateModel.body = data.body || null;
        emailTemplateModel.emailType = data.emailType || null;
        emailTemplateModel.allowedVariables = emailTemplateVariables[[data.emailType]];
        try {
            var emailTemplate = await emailTemplateModel.save();
        } catch (error) {
            ErrorService.log('emailTemplateModel.save', error);
            throw error;
        }
        return emailTemplate;
    },

    updateBy: async function (query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        if (data.emailType && !data.allowedVariables) {
            data.allowedVariables = emailTemplateVariables[[data.emailType]];
        }
        try {
            var updatedEmailTemplate = await EmailTemplateModel.findOneAndUpdate(query, {
                $set: data
            }, {
                new: true
            });
        } catch (error) {
            ErrorService.log('EmailTemplateModel.findOneAndUpdate', error);
            throw error;
        }

        return updatedEmailTemplate;
    },

    deleteBy: async function (query, userId) {
        try {
            var emailTemplate = await EmailTemplateModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            }, {
                new: true
            });
        } catch (error) {
            ErrorService.log('EmailTemplateModel.findOneAndUpdate', error);
            throw error;
        }
        return emailTemplate;
    },

    findBy: async function (query, skip, limit) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof (skip) === 'string') {
            skip = parseInt(skip);
        }

        if (typeof (limit) === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        query.deleted = false;

        try {
            var emailTemplates = await EmailTemplateModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name');
        } catch (error) {
            ErrorService.log('EmailTemplateModel.find', error);
            throw error;
        }

        return emailTemplates;
    },

    findOneBy: async function (query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var emailTemplate = await EmailTemplateModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name');
        } catch (error) {
            ErrorService.log('EmailTemplateModel.findOne', error);
            throw error;
        }

        return emailTemplate;
    },

    countBy: async function (query) {

        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var count = await EmailTemplateModel.count(query);
        } catch (error) {
            ErrorService.log('EmailTemplateModel.count', error);
            throw error;
        }
        return count;
    },

    getTemplates: async function (projectId) {
        let _this = this;
        var templates = await Promise.all(defaultTemplate.map(async (template) => {
            var emailTemplate = await _this.findOneBy({ projectId: projectId, emailType: template.emailType });
            return emailTemplate != null && emailTemplate != undefined ? emailTemplate : template;
        }));
        return templates;
    },

    resetTemplate: async function (projectId, templateId) {
        let _this = this;
        var oldTemplate = await _this.findOneBy({ _id: templateId });
        var newTemplate = defaultTemplate.filter(template => template.emailType === oldTemplate.emailType)[0];
        var resetTemplate = await _this.updateBy({
            _id: oldTemplate._id},{
            emailType: newTemplate.emailType,
            subject: newTemplate.subject,
            body: newTemplate.body,
            allowedVariables: newTemplate.allowedVariables
        });
        return resetTemplate;
    },

    hardDeleteBy: async function (query) {
        try {
            await EmailTemplateModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('EmailTemplateModel.deleteMany', error);
            throw error;
        }
        return 'Email Template(s) removed successfully';
    },
};

var EmailTemplateModel = require('../models/emailTemplate');
var ErrorService = require('./errorService');
var emailTemplateVariables = require('../config/emailTemplateVariables');
var defaultTemplate = require('../config/emailTemplate');
