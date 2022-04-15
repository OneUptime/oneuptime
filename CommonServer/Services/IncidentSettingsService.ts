import BadDataException from 'Common/Types/Exception/BadDataException';
export default class Service {
    public async create(data: $TSFixMe): void {
        const {
            projectId,
            title,
            description,
            incidentPriority,
            isDefault,
            name,
        } = data;

        const query: $TSFixMe = { projectId, name };
        const select: string =
            '_id projectId title description incidentPriority name';
        const incidentSetting: $TSFixMe = await this.findOne({
            query,
            select,
        });

        if (incidentSetting) {
            const error: $TSFixMe = new Error(
                'Incident template with this name already exist in project'
            );

            error.code = 400;
            throw error;
        }

        const incidentSettings: $TSFixMe = new incidentSettingsModel();
        if (isDefault) {
            // there can only be one default incident settings per project
            await incidentSettingsModel.findOneAndUpdate(
                {
                    projectId,
                    isDefault: true,
                },
                {
                    $set: { isDefault: false },
                }
            );
        }

        incidentSettings.projectId = projectId;

        incidentSettings.title = title;

        incidentSettings.description = description;

        incidentSettings.incidentPriority = incidentPriority;

        incidentSettings.isDefault = isDefault || false;

        incidentSettings.name = name;
        return await incidentSettings.save();
    }

    public async findBy({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 0;
        }

        if (typeof skip === 'string') {
            skip = Number(skip);
        }

        if (typeof limit === 'string') {
            limit = Number(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const responseQuery: $TSFixMe = incidentSettingsModel
            .find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        responseQuery.select(select);
        responseQuery.populate(populate);
        const result: $TSFixMe = await responseQuery;

        return result;
    }
    public async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        return await incidentSettingsModel.countDocuments(query);
    }
    public async findOne({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const responseQuery: $TSFixMe = incidentSettingsModel
            .findOne(query)
            .sort(sort)
            .lean();
        responseQuery.select(select);
        responseQuery.populate(populate);

        const incidentSettings: $TSFixMe = await responseQuery;
        return incidentSettings;
    }

    public async updateOne(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        if (data.name && query.projectId && query._id) {
            const incidentSetting: $TSFixMe = await this.findOne({
                query: {
                    projectId: query.projectId,
                    name: data.name,
                    _id: { $ne: query._id },
                },
                select: '_id',
            });

            if (incidentSetting) {
                const error: $TSFixMe = new Error(
                    'Incident template with this name already exist in project'
                );

                error.code = 400;
                throw error;
            }
        }

        if (data.isDefault && query.projectId && query._id) {
            // there can only be one default incident settings per project
            // set any previous isDefault to false
            await incidentSettingsModel.findOneAndUpdate(
                {
                    projectId: query.projectId,
                    _id: { $ne: query._id },
                    isDefault: true,
                },
                { $set: { isDefault: false } }
            );
        }

        await incidentSettingsModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                upsert: true,
            }
        );
        const incidentSettings: $TSFixMe = await this.findOne({
            query,
            select: 'projectId title description incidentPriority isDefault name createdAt',
        });
        return incidentSettings;
    }
    public async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        let updatedData: $TSFixMe = await incidentSettingsModel.updateMany(
            query,
            {
                $set: data,
            }
        );
        const populate: $TSFixMe = [
            { path: 'incidentPriority', select: 'name color' },
        ];
        const select: $TSFixMe =
            'projectId title description incidentPriority isDefault name createdAt';

        updatedData = await this.findBy({ query, select, populate });
        return updatedData;
    }

    public async deleteBy(query: Query): void {
        const incidentSetting: $TSFixMe = await this.findOne({
            query,
            select: 'projectId title description incidentPriority isDefault name createdAt',
        });
        if (incidentSetting.isDefault) {
            throw new BadDataException('Default template cannot be deleted');
        }

        const deletedIncidentSetting: $TSFixMe =
            await incidentSettingsModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                    },
                },
                { new: true }
            );

        return deletedIncidentSetting;
    }
}

import incidentSettingsModel from '../Models/incidentSettings';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
