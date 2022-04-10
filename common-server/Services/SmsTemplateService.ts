export default class Service {
    async create(data: $TSFixMe) {
        const smsTemplateModel = new SmsTemplateModel();

        smsTemplateModel.projectId = data.projectId || null;

        smsTemplateModel.body = data.body || null;

        smsTemplateModel.smsType = data.smsType || null;

        smsTemplateModel.allowedVariables =
            smsTemplateVariables[[data.smsType]];
        const smsTemplate = await smsTemplateModel.save();

        return smsTemplate;
    }

    async createMany(allData: $TSFixMe) {
        allData = allData.map((data: $TSFixMe) => {
            data.allowedVariables = smsTemplateVariables[data.smsType];
            return data;
        });
        return await SmsTemplateModel.insertMany(allData);
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
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
    }

    async updateBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        let updatedData = await SmsTemplateModel.updateMany(query, {
            $set: data,
        });
        const populate = [{ path: 'projectId', select: 'name' }];
        const select = 'projectId body smsType allowedVariables';
        updatedData = await this.findBy({ query, select, populate });
        return updatedData;
    }

    async deleteBy(query: Query, userId: string) {
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
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        query.deleted = false;

        const smsTemplateQuery = SmsTemplateModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        smsTemplateQuery.select(select);
        smsTemplateQuery.populate(populate);

        const smsTemplates = await smsTemplateQuery;
        return smsTemplates;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        query.deleted = false;

        const smsTemplateQuery = SmsTemplateModel.findOne(query)
            .lean()
            .sort(sort);

        smsTemplateQuery.select(select);
        smsTemplateQuery.populate(populate);

        const smsTemplate = await smsTemplateQuery;
        return smsTemplate;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await SmsTemplateModel.countDocuments(query);
        return count;
    }

    async getTemplates(projectId: string) {
        const populate = [{ path: 'projectId', select: 'name' }];
        const select = 'projectId body smsType allowedVariables';
        const templates = await Promise.all(
            defaultSmsTemplate.map(async template => {
                const smsTemplate = await this.findOneBy({
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
    }

    async resetTemplate(projectId: string, templateId: $TSFixMe) {
        const oldTemplate = await this.findOneBy({
            query: { _id: templateId },
            select: 'smsType _id',
        });
        const newTemplate = defaultSmsTemplate.filter(
            template => template.smsType === oldTemplate.smsType
        )[0];
        const resetTemplate = await this.updateOneBy(
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
    }

    async hardDeleteBy(query: Query) {
        await SmsTemplateModel.deleteMany(query);
        return 'SMS Template(s) removed successfully';
    }
}

import SmsTemplateModel from '../models/smsTemplate';
import smsTemplateVariables from '../config/smsTemplateVariables';
import defaultSmsTemplate from '../config/smsTemplate';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';
