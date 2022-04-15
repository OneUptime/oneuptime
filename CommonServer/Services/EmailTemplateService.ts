export default class Service {
    public async create(data: $TSFixMe): void {
        const emailTemplateModel: $TSFixMe = new EmailTemplateModel();

        emailTemplateModel.projectId = data.projectId || null;

        emailTemplateModel.subject = data.subject || null;

        emailTemplateModel.body = data.body || null;

        emailTemplateModel.emailType = data.emailType || null;

        emailTemplateModel.allowedVariables =
            emailTemplateVariables[[data.emailType]];
        const emailTemplate: $TSFixMe = await emailTemplateModel.save();
        return emailTemplate;
    }

    public async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }

        if (data.emailType && !data.allowedVariables) {
            data.allowedVariables = emailTemplateVariables[[data.emailType]];
        }
        const updatedEmailTemplate: $TSFixMe =
            await EmailTemplateModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
        return updatedEmailTemplate;
    }

    public async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        let updatedData: $TSFixMe = await EmailTemplateModel.updateMany(query, {
            $set: data,
        });
        const select: string =
            'projectId subject body emailType allowedVariables';
        updatedData = await this.findBy({
            query,
            select,
            populate: [{ path: 'projectId', select: 'nmae' }],
        });
        return updatedData;
    }

    public async deleteBy(query: Query, userId: ObjectID): void {
        const emailTemplate: $TSFixMe =
            await EmailTemplateModel.findOneAndUpdate(
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
    }

    public async findBy({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy): void {
        query.deleted = false;
        const emailTemplates: $TSFixMe = EmailTemplateModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());
        emailTemplates.select(select);
        emailTemplates.populate(populate);
        const result: $TSFixMe = await emailTemplates;

        return result;
    }

    public async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const emailTemplate: $TSFixMe = EmailTemplateModel.findOne(query)
            .sort(sort)
            .lean()
            .sort(sort);

        emailTemplate.select(select);
        emailTemplate.populate(populate);
        const result: $TSFixMe = await emailTemplate;
        return result;
    }

    public async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count: $TSFixMe = await EmailTemplateModel.countDocuments(query);
        return count;
    }

    public async getTemplates(projectId: ObjectID): void {
        const select: string =
            'projectId subject body emailType allowedVariables';
        const templates: $TSFixMe = await Promise.all(
            defaultTemplate.map(async (template: $TSFixMe) => {
                const emailTemplate: $TSFixMe = await this.findOneBy({
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
    }

    public async resetTemplate(
        projectId: ObjectID,
        templateId: $TSFixMe
    ): void {
        const select: string =
            'projectId subject body emailType allowedVariables';
        const oldTemplate: $TSFixMe = await this.findOneBy({
            query: { _id: templateId },
            select,
            populate: [{ path: 'projectId', select: 'nmae' }],
        });
        const newTemplate: $TSFixMe = defaultTemplate.filter(
            (template: $TSFixMe) => {
                return template.emailType === oldTemplate.emailType;
            }
        )[0];
        const resetTemplate: $TSFixMe = await this.updateOneBy(
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
    }
}

import EmailTemplateModel from '../Models/emailTemplate';
import ObjectID from 'Common/Types/ObjectID';
import emailTemplateVariables from '../config/emailTemplateVariables';
import defaultTemplate from '../config/emailTemplate';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
