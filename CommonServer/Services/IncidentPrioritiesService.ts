export default class Service {
    public async findBy({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy): void {
        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }
        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const incidentPrioritiesQuery: $TSFixMe = incidentPriorityModel
            .find(query)
            .sort(sort)
            .lean()
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        incidentPrioritiesQuery.select(select);

        incidentPrioritiesQuery.populate(populate);

        const incidentPriorities: $TSFixMe = await incidentPrioritiesQuery;

        return incidentPriorities;
    }

    public async findOne({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;
        const incidentPrioritiesQuery: $TSFixMe = incidentPriorityModel
            .findOne(query)
            .sort(sort)
            .lean();

        incidentPrioritiesQuery.select(select);

        incidentPrioritiesQuery.populate(populate);

        const incidentPriorities: $TSFixMe = await incidentPrioritiesQuery;

        return incidentPriorities;
    }

    public async countBy(query: Query): void {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const count: $TSFixMe = await incidentPriorityModel.countDocuments(
            query
        );

        return count;
    }

    public async create(data: $TSFixMe): void {
        const incidentPriority: $TSFixMe = new incidentPriorityModel();
        const { projectId, name, color }: $TSFixMe = data;

        incidentPriority.projectId = projectId;

        incidentPriority.name = name;

        incidentPriority.color = color;
        await incidentPriority.save();
        return incidentPriority;
    }

    public async updateOne(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const updatedIncidentPriority: $TSFixMe =
            await incidentPriorityModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );
        return updatedIncidentPriority;
    }

    public async deleteBy(query: Query): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;
        const incidentPriority: $TSFixMe =
            await incidentPriorityModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                },
            });
        if (incidentPriority === null) {
            return incidentPriority;
        }
        //update existing incidents along with default incident settings
        await Promise.all([
            IncidentService.updateBy(
                {
                    incidentPriority: incidentPriority._id,
                },
                {
                    incidentPriority: null,
                }
            ),
            IncidentSettingsService.updateOne(
                {
                    incidentPriority: incidentPriority._id,
                },
                {
                    incidentPriority: null,
                }
            ),
        ]);
        return incidentPriority;
    }
}

import IncidentSettingsService from './IncidentSettingsService';
import IncidentService from './IncidentService';
import incidentPriorityModel from '../Models/incidentPriority';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
