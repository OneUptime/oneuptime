module.exports = {
    create: async function(data) {
        try {
            const smsTemplateModel = new SmsTemplateModel();
            smsTemplateModel.projectId = data.projectId || null;
            smsTemplateModel.body = data.body || null;
            smsTemplateModel.smsType = data.smsType || null;
            smsTemplateModel.allowedVariables =
                smsTemplateVariables[[data.smsType]];
            const smsTemplate = await smsTemplateModel.save();

            return smsTemplate;
        } catch (error) {
            ErrorService.log('smsTemplateService.create', error);
            throw error;
        }
    },

    createMany: async function(allData) {
        try {
            allData = allData.map(data => {
                data.allowedVariables = smsTemplateVariables[data.smsType];
                return data;
            });
            return await SmsTemplateModel.insertMany(allData);
        } catch (error) {
            ErrorService.log('smsTemplateService.createMany', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
            const updatedSmsTemplate = await SmsTemplateModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
            return updatedSmsTemplate;
        } catch (error) {
            ErrorService.log('smsTemplateService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await SmsTemplateModel.updateMany(query, {
                $set: data,
            });
            const populate = [{ path: 'projectId', select: 'name' }];
            const select = 'projectId body smsType allowedVariables';
            updatedData = await this.findBy({ query, select, populate });
            return updatedData;
        } catch (error) {
            ErrorService.log('smsTemplateService.updateMany', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            const smsTemplate = await SmsTemplateModel.findOneAndUpdate(
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
            return smsTemplate;
        } catch (error) {
            ErrorService.log('smsTemplateService.deleteBy', error);
            throw error;
        }
    },

    findBy: async function({ query, skip, limit, select, populate }) {
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

            let smsTemplateQuery = SmsTemplateModel.find(query)
                .lean()
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            smsTemplateQuery = handleSelect(select, smsTemplateQuery);
            smsTemplateQuery = handlePopulate(populate, smsTemplateQuery);

            const smsTemplates = await smsTemplateQuery;
            return smsTemplates;
        } catch (error) {
            ErrorService.log('smsTemplateService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;

            let smsTemplateQuery = SmsTemplateModel.findOne(query)
                .lean()
                .sort([['createdAt', -1]]);

            smsTemplateQuery = handleSelect(select, smsTemplateQuery);
            smsTemplateQuery = handlePopulate(populate, smsTemplateQuery);

            const smsTemplate = await smsTemplateQuery;
            return smsTemplate;
        } catch (error) {
            ErrorService.log('smsTemplateService.findOneBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const count = await SmsTemplateModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('smsTemplateService.countBy', error);
            throw error;
        }
    },

    getTemplates: async function(projectId) {
        try {
            const _this = this;
            const populate = [{ path: 'projectId', select: 'name' }];
            const select = 'projectId body smsType allowedVariables';
            const templates = await Promise.all(
                defaultSmsTemplate.map(async template => {
                    const smsTemplate = await _this.findOneBy({
                        query: {
                            projectId: projectId,
                            smsType: template.smsType,
                        },
                        select,
                        populate,
                    });
                    return smsTemplate != null && smsTemplate != undefined
                        ? smsTemplate
                        : template;
                })
            );
            return templates;
        } catch (error) {
            ErrorService.log('smsTemplateService.getTemplates', error);
            throw error;
        }
    },

    resetTemplate: async function(projectId, templateId) {
        const _this = this;
        try {
            const oldTemplate = await _this.findOneBy({
                query: { _id: templateId },
                select: 'smsType _id',
            });
            const newTemplate = defaultSmsTemplate.filter(
                template => template.smsType === oldTemplate.smsType
            )[0];
            const resetTemplate = await _this.updateOneBy(
                {
                    _id: oldTemplate._id,
                },
                {
                    smsType: newTemplate.smsType,
                    body: newTemplate.body,
                    allowedVariables: newTemplate.allowedVariables,
                }
            );
            return resetTemplate;
        } catch (error) {
            ErrorService.log('smsTemplateService.resetTemplate', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await SmsTemplateModel.deleteMany(query);
            return 'SMS Template(s) removed successfully';
        } catch (error) {
            ErrorService.log('smsTemplateService.hardDeleteBy', error);
            throw error;
        }
    },
};

const SmsTemplateModel = require('../models/smsTemplate');
const ErrorService = require('./errorService');
const smsTemplateVariables = require('../config/smsTemplateVariables');
const defaultSmsTemplate = require('../config/smsTemplate');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
