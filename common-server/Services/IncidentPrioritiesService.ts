export default class Service {
    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        if (typeof limit === 'string') limit = parseInt(limit);
        if (typeof skip === 'string') skip = parseInt(skip);
        if (!query) query = {};
        if (!query['deleted']) query['deleted'] = false;

        const incidentPrioritiesQuery = incidentPriorityModel
            .find(query)
            .sort(sort)
            .lean()
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        incidentPrioritiesQuery.select(select);

        incidentPrioritiesQuery.populate(populate);

        const incidentPriorities = await incidentPrioritiesQuery;

        return incidentPriorities;
    }

    async findOne({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const incidentPrioritiesQuery = incidentPriorityModel
            .findOne(query)
            .sort(sort)
            .lean();

        incidentPrioritiesQuery.select(select);

        incidentPrioritiesQuery.populate(populate);

        const incidentPriorities = await incidentPrioritiesQuery;

        return incidentPriorities;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) query['deleted'] = false;

        const count = await incidentPriorityModel.countDocuments(query);

        return count;
    }

    async create(data: $TSFixMe) {
        const incidentPriority = new incidentPriorityModel();
        const { projectId, name, color } = data;

        incidentPriority.projectId = projectId;

        incidentPriority.name = name;

        incidentPriority.color = color;
        await incidentPriority.save();
        return incidentPriority;
    }

    async updateOne(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) query['deleted'] = false;
        const updatedIncidentPriority =
            await incidentPriorityModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );
        return updatedIncidentPriority;
    }

    async deleteBy(query: Query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const incidentPriority = await incidentPriorityModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                },
            }
        );
        if (incidentPriority === null) return incidentPriority;
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

    async hardDeleteBy(query: Query) {
        await incidentPriorityModel.deleteMany(query);
        return 'Incident priorities removed successfully!';
    }
}

import IncidentSettingsService from './IncidentSettingsService';
import IncidentService from './IncidentService';
import incidentPriorityModel from '../models/incidentPriority';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';
