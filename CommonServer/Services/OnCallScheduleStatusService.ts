export default class Service {
    async findBy({ query, skip, limit, sort, populate, select }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 10;
        }

        if (!sort) {
            sort = -1;
        }

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (typeof sort === 'string') {
            sort = parseInt(sort);
        }

        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const itemsQuery: $TSFixMe = OnCallScheduleStatusModel.find(query)
            .lean()
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        itemsQuery.select(select);
        itemsQuery.populate(populate);

        const items: $TSFixMe = await itemsQuery;

        return items;
    }

    async create({
        project,
        incident,
        activeEscalation,
        schedule,
        escalations,
        incidentAcknowledged,
    }: $TSFixMe): void {
        let item = new OnCallScheduleStatusModel();

        item.project = project;

        item.activeEscalation = activeEscalation;

        item.schedule = schedule;

        item.incidentAcknowledged = incidentAcknowledged;

        item.incident = incident;

        item.escalations = escalations;

        item = await item.save();
        return item;
    }

    async countBy({ query }: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const count: $TSFixMe = await OnCallScheduleStatusModel.countDocuments(
            query
        );
        return count;
    }

    async updateOneBy({ query, data }: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const item: $TSFixMe = await OnCallScheduleStatusModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        return item;
    }

    async updateBy({ query, data }: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        await OnCallScheduleStatusModel.updateMany(query, {
            $set: data,
        });

        const selectOnCallScheduleStatus: $TSFixMe =
            'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

        const populateOnCallScheduleStatus: $TSFixMe = [
            { path: 'incidentId', select: 'name slug' },
            { path: 'project', select: 'name slug' },
            { path: 'scheduleId', select: 'name slug' },
            { path: 'schedule', select: '_id name slug' },
            {
                path: 'activeEscalationId',
                select: 'projectId teams scheduleId',
            },
        ];
        const items: $TSFixMe = await this.findBy({
            query,
            select: selectOnCallScheduleStatus,
            populate: populateOnCallScheduleStatus,
        });
        return items;
    }

    async deleteBy({ query, userId }: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const items: $TSFixMe =
            await OnCallScheduleStatusModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                        deletedById: userId,
                    },
                },
                {
                    new: true,
                }
            );
        return items;
    }

    async hardDeleteBy({ query }: $TSFixMe): void {
        await OnCallScheduleStatusModel.deleteMany(query);
    }
}

import OnCallScheduleStatusModel from '../Models/onCallScheduleStatus';

import FindBy from '../Types/DB/FindBy';
