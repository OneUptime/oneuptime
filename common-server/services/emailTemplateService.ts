export default {
    create: async function (data: $TSFixMe) {
        const emailTemplateModel = new EmailTemplateModel();

        emailTemplateModel.projectId = data.projectId || null;

        emailTemplateModel.subject = data.subject || null;

        emailTemplateModel.body = data.body || null;

        emailTemplateModel.emailType = data.emailType || null;

        emailTemplateModel.allowedVariables =
            emailTemplateVariables[[data.emailType]];
        const emailTemplate = await emailTemplateModel.save();
        return emailTemplate;
    },

    updateOneBy: async function (query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;

        if (data.emailType && !data.allowedVariables) {
            data.allowedVariables = emailTemplateVariables[[data.emailType]];
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
    },

    updateBy: async function (query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        let updatedData = await EmailTemplateModel.updateMany(query, {
            $set: data,
        });
        const select = 'projectId subject body emailType allowedVariables';
        updatedData = await this.findBy({
            query,
            select,
            populate: [{ path: 'projectId', select: 'nmae' }],
        });
        return updatedData;
    },

    deleteBy: async function (query: Query, userId: string) {
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
    },

    findBy: async function ({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy) {
        query.deleted = false;
        const emailTemplates = EmailTemplateModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());
        emailTemplates.select(select);
        emailTemplates.populate(populate);
        const result = await emailTemplates;

        return result;
    },

    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const emailTemplate = EmailTemplateModel.findOne(query)
            .sort(sort)
            .lean()
            .sort(sort);

        emailTemplate.select(select);
        emailTemplate.populate(populate);
        const result = await emailTemplate;
        return result;
    },

    countBy: async function (query: Query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await EmailTemplateModel.countDocuments(query);
        return count;
    },

    getTemplates: async function (projectId: $TSFixMe) {
        const _this = this;
        const select = 'projectId subject body emailType allowedVariables';
        const templates = await Promise.all(
            defaultTemplate.map(async template => {
                const emailTemplate = await _this.findOneBy({
                    query: {
                        projectId: projectId,
                        emailType: template.emailType,
                    },
                    select,
                    populate: [{ path: 'projectId', select: 'nmae' }],
                });
                return emailTemplate != null && emailTemplate != undefined
                    ? emailTemplate
                    : template;
            })
        );
        return templates;
    },

    resetTemplate: async function (projectId: $TSFixMe, templateId: $TSFixMe) {
        const _this = this;
        const select = 'projectId subject body emailType allowedVariables';
        const oldTemplate = await _this.findOneBy({
            query: { _id: templateId },
            select,
            populate: [{ path: 'projectId', select: 'nmae' }],
        });
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

    hardDeleteBy: async function (query: Query) {
        await EmailTemplateModel.deleteMany(query);
        return 'Email Template(s) removed successfully';
    },
};

import EmailTemplateModel from '../models/emailTemplate';
import emailTemplateVariables from '../config/emailTemplateVariables';
import defaultTemplate from '../config/emailTemplate';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';
