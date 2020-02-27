module.exports = {
    create: async function(data) {
        try {
            const emailTemplateModel = new EmailTemplateModel();
            emailTemplateModel.projectId = data.projectId || null;
            emailTemplateModel.subject = data.subject || null;
            emailTemplateModel.body = data.body || null;
            emailTemplateModel.emailType = data.emailType || null;
            emailTemplateModel.allowedVariables =
                emailTemplateVariables[[data.emailType]];
            const emailTemplate = await emailTemplateModel.save();
            return emailTemplate;
        } catch (error) {
            ErrorService.log('emailTemplateService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;

            if (data.emailType && !data.allowedVariables) {
                data.allowedVariables =
                    emailTemplateVariables[[data.emailType]];
            }
            const updatedEmailTemplate = await EmailTemplateModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
            return updatedEmailTemplate;
        } catch (error) {
            ErrorService.log('EmailTemplateService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await EmailTemplateModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('EmailTemplateService.updateMany', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            const emailTemplate = await EmailTemplateModel.findOneAndUpdate(
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
            return emailTemplate;
        } catch (error) {
            ErrorService.log('emailTemplateService.deleteBy', error);
            throw error;
        }
    },

    findBy: async function(query, skip, limit) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 10;

            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            query.deleted = false;
            const emailTemplates = await EmailTemplateModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name');
            return emailTemplates;
        } catch (error) {
            ErrorService.log('emailTemplateService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const emailTemplate = await EmailTemplateModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name');
            return emailTemplate;
        } catch (error) {
            ErrorService.log('emailTemplateService.findOneBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const count = await EmailTemplateModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('emailTemplateService.countBy', error);
            throw error;
        }
    },

    getTemplates: async function(projectId) {
        const _this = this;
        const templates = await Promise.all(
            defaultTemplate.map(async template => {
                const emailTemplate = await _this.findOneBy({
                    projectId: projectId,
                    emailType: template.emailType,
                });
                return emailTemplate != null && emailTemplate != undefined
                    ? emailTemplate
                    : template;
            })
        );
        return templates;
    },

    resetTemplate: async function(projectId, templateId) {
        const _this = this;
        const oldTemplate = await _this.findOneBy({ _id: templateId });
        const newTemplate = defaultTemplate.filter(
            template => template.emailType === oldTemplate.emailType
        )[0];
        const resetTemplate = await _this.updateOneBy(
            {
                _id: oldTemplate._id,
            },
            {
                emailType: newTemplate.emailType,
                subject: newTemplate.subject,
                body: newTemplate.body,
                allowedVariables: newTemplate.allowedVariables,
            }
        );
        return resetTemplate;
    },

    hardDeleteBy: async function(query) {
        try {
            await EmailTemplateModel.deleteMany(query);
            return 'Email Template(s) removed successfully';
        } catch (error) {
            ErrorService.log('emailTemplateService.hardDeleteBy', error);
            throw error;
        }
    },
};

const EmailTemplateModel = require('../models/emailTemplate');
const ErrorService = require('./errorService');
const emailTemplateVariables = require('../config/emailTemplateVariables');
const defaultTemplate = require('../config/emailTemplate');
