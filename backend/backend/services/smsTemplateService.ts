export default {
    create: async function(data: $TSFixMe) {
        const smsTemplateModel = new SmsTemplateModel();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Docum... Remove this comment to see the full error message
        smsTemplateModel.projectId = data.projectId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'body' does not exist on type 'Document<a... Remove this comment to see the full error message
        smsTemplateModel.body = data.body || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsType' does not exist on type 'Documen... Remove this comment to see the full error message
        smsTemplateModel.smsType = data.smsType || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'allowedVariables' does not exist on type... Remove this comment to see the full error message
        smsTemplateModel.allowedVariables =
            // @ts-expect-error ts-migrate(2538) FIXME: Type 'any[]' cannot be used as an index type.
            smsTemplateVariables[[data.smsType]];
        const smsTemplate = await smsTemplateModel.save();

        return smsTemplate;
    },

    createMany: async function(allData: $TSFixMe) {
        allData = allData.map((data: $TSFixMe) => {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            data.allowedVariables = smsTemplateVariables[data.smsType];
            return data;
        });
        return await SmsTemplateModel.insertMany(allData);
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
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
    },

    updateBy: async function(query: $TSFixMe, data: $TSFixMe) {
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
    },

    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
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
    },

    findBy: async function({
        query,
        skip,
        limit,
        select,
        populate
    }: $TSFixMe) {
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
    },

    findOneBy: async function({
        query,
        select,
        populate
    }: $TSFixMe) {
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
    },

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await SmsTemplateModel.countDocuments(query);
        return count;
    },

    getTemplates: async function(projectId: $TSFixMe) {
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
    },

    resetTemplate: async function(projectId: $TSFixMe, templateId: $TSFixMe) {
        const _this = this;
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
    },

    hardDeleteBy: async function(query: $TSFixMe) {
        await SmsTemplateModel.deleteMany(query);
        return 'SMS Template(s) removed successfully';
    },
};

import SmsTemplateModel from '../models/smsTemplate'
import smsTemplateVariables from '../config/smsTemplateVariables'
import defaultSmsTemplate from '../config/smsTemplate'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'
