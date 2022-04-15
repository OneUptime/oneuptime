export default class Service {
    async findBy({ query, limit, skip, populate, select, sort }: FindBy): void {
        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const schedulesQuery: $TSFixMe = ScheduleModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        schedulesQuery.select(select);
        schedulesQuery.populate(populate);

        const schedules: $TSFixMe = await schedulesQuery;
        return schedules;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const scheduleQuery: $TSFixMe = ScheduleModel.findOne(query)
            .sort(sort)
            .lean()
            .sort(sort);

        scheduleQuery.select(select);
        scheduleQuery.populate(populate);

        const schedule: $TSFixMe = await scheduleQuery;

        return schedule;
    }

    async create(data: $TSFixMe): void {
        const scheduleModel: $TSFixMe = new ScheduleModel();

        scheduleModel.name = data.name || null;

        scheduleModel.projectId = data.projectId || null;

        scheduleModel.createdById = data.createdById || null;

        // if userIds is array
        if (data.userIds) {
            scheduleModel.userIds = [];
            for (const userId of data.userIds) {
                scheduleModel.userIds.push(userId);
            }
        }

        // if monitorIds is array
        if (data.monitorIds) {
            scheduleModel.monitorIds = [];
            for (const monitorId of data.monitorIds) {
                scheduleModel.userIds.push(monitorId);
            }
        }

        if (data && data.name) {
            scheduleModel.slug = getSlug(data.name);
        }
        const schedule: $TSFixMe = await scheduleModel.save();
        const populate: $TSFixMe = [
            { path: 'userIds', select: 'name' },
            { path: 'createdById', select: 'name' },
            { path: 'monitorIds', select: 'name' },
            {
                path: 'projectId',
                select: '_id name slug',
            },
            {
                path: 'escalationIds',
                select: 'teamMember',
                populate: {
                    path: 'teamMember.userId',
                    select: 'name',
                },
            },
        ];

        const select: $TSFixMe =
            '_id userIds name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';

        const newSchedule: $TSFixMe = await this.findOneBy({
            query: { _id: schedule._id },
            select,
            populate,
        });
        return newSchedule;
    }

    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const count: $TSFixMe = await ScheduleModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query, userId: ObjectID): void {
        const schedule: $TSFixMe = await ScheduleModel.findOneAndUpdate(
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

        if (schedule && schedule._id) {
            const escalations: $TSFixMe = await EscalationService.findBy({
                query: { scheduleId: schedule._id },
                select: '_id',
            });
            await escalations.map(({ _id }: $TSFixMe) => {
                return EscalationService.deleteBy({ _id: _id }, userId);
            });
        }

        return schedule;
    }

    async addMonitorToSchedules(
        scheduleIds: $TSFixMe,
        monitorId: $TSFixMe
    ): void {
        await ScheduleModel.updateMany(
            {
                _id: { $in: scheduleIds },
            },
            {
                $addToSet: {
                    monitorIds: monitorId,
                },
            }
        );
    }

    async removeMonitor(monitorId: $TSFixMe): void {
        const schedule: $TSFixMe = await ScheduleModel.findOneAndUpdate(
            { monitorIds: monitorId },
            {
                $pull: { monitorIds: monitorId },
            }
        );
        return schedule;
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        let schedule: $TSFixMe = await this.findOneBy({
            query,
            select: '_id userIds monitorIds',
        });
        let userIds: $TSFixMe = [];
        if (data.userIds) {
            for (const userId of data.userIds) {
                userIds.push(userId);
            }
        } else {
            userIds = schedule.userIds;
        }
        data.userIds = userIds;
        let monitorIds: $TSFixMe = [];
        if (data.monitorIds) {
            for (const monitorId of data.monitorIds) {
                monitorIds.push(monitorId);
            }
        } else {
            monitorIds = schedule.monitorIds;
        }
        data.monitorIds = monitorIds;

        if (data.isDefault) {
            // set isDefault to false for a particular schedule in a project
            // this should only affect any schedule not equal to the currently edited schedule
            await ScheduleModel.findOneAndUpdate(
                {
                    _id: { $ne: schedule._id },
                    isDefault: true,
                    deleted: false,
                    projectId: query.projectId,
                },
                { $set: { isDefault: false } },
                { new: true }
            );
        }
        if (data && data.name) {
            data.slug = getSlug(data.name);
        }

        schedule = await ScheduleModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );

        const populate: $TSFixMe = [
            { path: 'userIds', select: 'name' },
            { path: 'createdById', select: 'name' },
            { path: 'monitorIds', select: 'name' },
            {
                path: 'projectId',
                select: '_id name slug',
            },
            {
                path: 'escalationIds',
                select: 'teams',
                populate: {
                    path: 'teams.teamMembers.userId',
                    select: 'name email',
                },
            },
        ];

        const select: $TSFixMe =
            '_id name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';

        schedule = await this.findBy({
            query: { _id: query._id },
            limit: 10,
            skip: 0,
            populate,
            select,
        });
        return schedule;
    }

    async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        let updatedData: $TSFixMe = await ScheduleModel.updateMany(query, {
            $set: data,
        });

        const populate: $TSFixMe = [
            { path: 'userIds', select: 'name' },
            { path: 'createdById', select: 'name' },
            { path: 'monitorIds', select: 'name' },
            {
                path: 'projectId',
                select: '_id name slug',
            },
            {
                path: 'escalationIds',
                select: 'teams',
                populate: {
                    path: 'teams.teamMembers.userId',
                    select: 'name email',
                },
            },
        ];

        const select: $TSFixMe =
            '_id name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';
        updatedData = await this.findBy({ query, select, populate });
        return updatedData;
    }

    async saveSchedule(schedule: $TSFixMe): void {
        schedule = await schedule.save();
        return schedule;
    }

    async deleteMonitor(monitorId: $TSFixMe): void {
        await ScheduleModel.updateMany(
            { deleted: false },
            { $pull: { monitorIds: monitorId } }
        );
    }

    async addEscalation(
        scheduleId: $TSFixMe,
        escalations: $TSFixMe,
        userId: ObjectID
    ): void {
        const escalationIds: $TSFixMe = [];
        for (const data of escalations) {
            let escalation: $TSFixMe = {};
            if (!data._id) {
                escalation = await EscalationService.create(data);
            } else {
                escalation = await EscalationService.updateOneBy(
                    { _id: data._id },
                    data
                );
            }

            escalationIds.push(escalation._id);
        }

        if (escalationIds && escalationIds.length) {
            await this.escalationCheck(escalationIds, scheduleId, userId);
        }
        await this.updateOneBy(
            { _id: scheduleId },
            { escalationIds: escalationIds }
        );

        const scheduleEscalation: $TSFixMe = await this.getEscalations(
            scheduleId
        );

        return scheduleEscalation.escalations;
    }

    async getEscalations(scheduleId: $TSFixMe): void {
        const schedule: $TSFixMe = await this.findOneBy({
            query: { _id: scheduleId },
            select: '_id escalationIds',
        });
        const selectEscalation: $TSFixMe =
            'projectId callReminders emailReminders smsReminders pushReminders rotateBy rotationInterval firstRotationOn rotationTimezone call email sms push createdById scheduleId teams createdAt deleted deletedAt';

        const populateEscalation: $TSFixMe = [
            {
                path: 'projectId',
                select: '_id name slug',
            },
            {
                path: 'scheduleId',
                select: 'name isDefault slug',
                populate: {
                    path: 'monitorIds',
                    select: 'name',
                },
            },
            {
                path: 'teams.teamMembers.user',
                select: 'name email',
            },
            {
                path: 'teams.teamMembers.groups',
                select: 'teams name',
            },
        ];

        const escalationIds: $TSFixMe = schedule.escalationIds;
        const escalations: $TSFixMe = await Promise.all(
            escalationIds.map(async (escalationId: $TSFixMe) => {
                return await EscalationService.findOneBy({
                    query: { _id: escalationId },
                    select: selectEscalation,
                    populate: populateEscalation,
                });
            })
        );
        return { escalations, count: escalationIds.length };
    }

    async getUserEscalations(subProjectIds: $TSFixMe, userId: ObjectID): void {
        const selectEscalation: $TSFixMe =
            'projectId callReminders emailReminders smsReminders pushReminders rotateBy rotationInterval firstRotationOn rotationTimezone call email sms push createdById scheduleId teams createdAt deleted deletedAt';

        const populateEscalation: $TSFixMe = [
            { path: 'projectId', select: '_id name slug' },
            {
                path: 'scheduleId',
                select: 'name isDefault slug',
                populate: { path: 'monitorIds', select: 'name' },
            },
            {
                path: 'teams.teamMembers.user',
                select: 'name email',
            },
        ];
        const escalations: $TSFixMe = await EscalationService.findBy({
            query: {
                projectId: { $in: subProjectIds },
                'teams.teamMembers': { $elemMatch: { userId } },
            },
            select: selectEscalation,
            populate: populateEscalation,
        });
        return escalations;
    }

    async escalationCheck(
        escalationIds: $TSFixMe,
        scheduleId: $TSFixMe,
        userId: ObjectID
    ): void {
        let scheduleIds: $TSFixMe = await this.findOneBy({
            query: { _id: scheduleId },
            select: '_id escalationIds',
        });

        scheduleIds = scheduleIds.escalationIds.map((i: $TSFixMe) => {
            return i.toString();
        });
        escalationIds = escalationIds.map((i: $TSFixMe) => {
            return i.toString();
        });

        scheduleIds.map(async (id: $TSFixMe) => {
            if (escalationIds.indexOf(id) < 0) {
                await EscalationService.deleteBy({ _id: id }, userId);
            }
        });
    }

    async deleteEscalation(escalationId: $TSFixMe): void {
        await ScheduleModel.update(
            { deleted: false },
            { $pull: { escalationIds: escalationId } }
        );
    }

    async getSubProjectSchedules(subProjectIds: $TSFixMe): void {
        const subProjectSchedules: $TSFixMe = await Promise.all(
            subProjectIds.map(async (id: $TSFixMe) => {
                const populate: $TSFixMe = [
                    { path: 'userIds', select: 'name' },
                    { path: 'createdById', select: 'name' },
                    { path: 'monitorIds', select: 'name' },
                    {
                        path: 'projectId',
                        select: '_id name slug',
                    },
                    {
                        path: 'escalationIds',
                        select: 'teams',
                        populate: {
                            path: 'teams.teamMembers.userId',
                            select: 'name email',
                        },
                    },
                    {
                        path: 'escalationIds',
                        select: 'teams',
                        populate: {
                            path: 'teams.teamMembers.groupId',
                            select: 'name',
                        },
                    },
                ];

                const select: $TSFixMe =
                    '_id name slug projectId createdById monitorsIds escalationIds createdAt isDefault  userIds';

                const query: $TSFixMe = { projectId: id };
                const schedules: $TSFixMe = await this.findBy({
                    query,
                    limit: 10,
                    skip: 0,
                    populate,
                    select,
                });
                const count: $TSFixMe = await this.countBy(query);
                return { schedules, count, _id: id, skip: 0, limit: 10 };
            })
        );
        return subProjectSchedules;
    }

    async restoreBy(query: Query): void {
        query.deleted = true;
        const populate: $TSFixMe = [
            { path: 'userIds', select: 'name' },
            { path: 'createdById', select: 'name' },
            { path: 'monitorIds', select: 'name' },
            {
                path: 'projectId',
                select: '_id name slug',
            },
            {
                path: 'escalationIds',
                select: 'teams',
                populate: {
                    path: 'teams.teamMembers.userId',
                    select: 'name email',
                },
            },
        ];

        const select: $TSFixMe =
            '_id name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';

        const schedule: $TSFixMe = await this.findBy({
            query,
            populate,
            select,
        });
        if (schedule && schedule.length > 1) {
            const schedules: $TSFixMe = await Promise.all(
                schedule.map(async (schedule: $TSFixMe) => {
                    const scheduleId: $TSFixMe = schedule._id;
                    schedule = await this.updateOneBy(
                        { _id: scheduleId, deleted: true },
                        {
                            deleted: false,
                            deletedAt: null,
                            deleteBy: null,
                        }
                    );
                    await EscalationService.restoreBy({
                        scheduleId,
                        deleted: true,
                    });
                    return schedule;
                })
            );
            return schedules;
        }
    }
}

import ScheduleModel from '../Models/schedule';
import ObjectID from 'Common/Types/ObjectID';
import EscalationService from './EscalationService';
import getSlug from '../Utils/getSlug';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
