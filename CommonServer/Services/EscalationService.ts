import EscalationModel from '../Models/escalation';
import ObjectID from 'Common/Types/ObjectID';
import moment from 'moment';
import DateTime from '../Utils/DateTime';
import ScheduleService from './ScheduleService';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    async findBy({ query, limit, skip, sort, select, populate }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 10;
        }

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const escalationsQuery: $TSFixMe = EscalationModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        escalationsQuery.select(select);
        escalationsQuery.populate(populate);

        const escalations: $TSFixMe = await escalationsQuery;
        return escalations;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const escalationQuery: $TSFixMe = EscalationModel.findOne(query)
            .sort(sort)
            .lean();

        escalationQuery.select(select);
        escalationQuery.populate(populate);

        const escalation: $TSFixMe = await escalationQuery;

        const { activeTeam, nextActiveTeam }: $TSFixMe =
            computeActiveTeams(escalation);
        escalation.activeTeam = activeTeam;
        escalation.nextActiveTeam = nextActiveTeam;

        return escalation;
    }

    async create(data: $TSFixMe): void {
        const escalationModel: $TSFixMe = new EscalationModel({
            call: data.call,
            email: data.email,
            sms: data.sms,
            push: data.push,
            callReminders: data.callReminders,
            smsReminders: data.smsReminders,
            emailReminders: data.emailReminders,
            pushReminders: data.pushReminders,
            rotateBy: data.rotateBy,
            rotationInterval: data.rotationInterval,
            firstRotationOn: data.firstRotationOn,
            rotationTimezone: data.rotationTimezone,
            projectId: data.projectId,
            scheduleId: data.scheduleId,
            createdById: data.createdById,
            teams: data.teams,
            groups: data.groups,
        });

        const escalation: $TSFixMe = await escalationModel.save();
        return escalation;
    }

    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const count: $TSFixMe = await EscalationModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query, userId: ObjectID): void {
        const escalation: $TSFixMe = await EscalationModel.findOneAndUpdate(
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
        return escalation;
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const escalation: $TSFixMe = await EscalationModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        return escalation;
    }

    async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        let updatedData = await EscalationModel.updateMany(query, {
            $set: data,
        });

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
        const selectEscalation: $TSFixMe =
            'projectId callReminders emailReminders smsReminders pushReminders rotateBy rotationInterval firstRotationOn rotationTimezone call email sms push createdById scheduleId teams createdAt deleted deletedAt';

        updatedData = await this.findBy({
            query,
            populate: populateEscalation,
            select: selectEscalation,
        });
        return updatedData;
    }

    async deleteEscalationMember(
        projectId: ObjectID,
        memberId: $TSFixMe,
        deletedById: $TSFixMe
    ): void {
        const escalations: $TSFixMe = await this.findBy({
            query: { projectId },
            select: '_id teams scheduleId',
        });

        if (escalations && escalations.length > 0) {
            for (const escalation of escalations) {
                const teams: $TSFixMe = escalation.teams;
                const newTeams: $TSFixMe = [];
                for (const team of teams) {
                    const teamMembers: $TSFixMe = team.teamMembers;
                    const filtered: $TSFixMe = teamMembers
                        .filter(
                            (meamber: $TSFixMe) =>
                                meamber['groupId'] !== memberId
                        )
                        .filter(
                            (member: $TSFixMe) => member['userId'] !== memberId
                        );
                    newTeams.push({
                        _id: team._id,
                        teamMembers: filtered,
                    });
                    if (filtered.length < 1) {
                        const populateSchedule: $TSFixMe = [
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

                        const selectSchedule: $TSFixMe =
                            '_id userIds name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';
                        const schedule: $TSFixMe =
                            await ScheduleService.findOneBy({
                                query: { _id: escalation.scheduleId },
                                select: selectSchedule,
                                populate: populateSchedule,
                            });
                        const rmEscalation: $TSFixMe =
                            schedule.escalationIds.filter(
                                (escalationId: $TSFixMe) =>
                                    String(escalationId._id) !==
                                    String(escalation._id)
                            );
                        schedule.escalationIds = rmEscalation;
                        await Promise.all([
                            ScheduleService.updateOneBy(
                                { _id: schedule._id },
                                { escalationIds: rmEscalation }
                            ),
                            this.deleteBy({ _id: escalation._id }, deletedById),
                        ]);
                    }
                }
                await this.updateOneBy(
                    {
                        _id: escalation._id,
                    },
                    { teams: newTeams }
                );
            }
        }
    }

    async restoreBy(query: Query): void {
        query.deleted = true;
        let escalation = await this.findBy({ query, select: '_id' });
        if (escalation && escalation.length > 1) {
            const escalations: $TSFixMe = await Promise.all(
                escalation.map(async (escalation: $TSFixMe) => {
                    const escalationId: $TSFixMe = escalation._id;
                    escalation = await this.updateOneBy(
                        { _id: escalationId, deleted: true },
                        {
                            deleted: false,
                            deletedAt: null,
                            deleteBy: null,
                        }
                    );
                    return escalation;
                })
            );
            return escalations;
        } else {
            escalation = escalation[0];
            if (escalation) {
                const escalationId: $TSFixMe = escalation._id;
                escalation = await this.updateOneBy(
                    { _id: escalationId, deleted: true },
                    {
                        deleted: false,
                        deletedAt: null,
                        deleteBy: null,
                    }
                );
            }
            return escalation;
        }
    }
}

function computeActiveTeamIndex(
    numberOfTeams: $TSFixMe,
    intervalDifference: $TSFixMe,
    rotationInterval: $TSFixMe
): void {
    const difference: $TSFixMe = Math.floor(
        intervalDifference / rotationInterval
    );
    return difference % numberOfTeams;
}

function computeActiveTeams(escalation: $TSFixMe): void {
    const {
        teams,
        rotationInterval,
        rotateBy,
        createdAt,
        rotationTimezone,
    }: $TSFixMe = escalation;

    let firstRotationOn = escalation.firstRotationOn;

    const currentDate: $TSFixMe = new Date();

    if (rotateBy && rotateBy != '') {
        let intervalDifference = 0;

        //convert rotation switch time to timezone.
        firstRotationOn = DateTime.changeDateTimezone(
            firstRotationOn,
            rotationTimezone
        );

        if (rotateBy === 'months') {
            intervalDifference = DateTime.getDifferenceInMonths(
                firstRotationOn,
                currentDate
            );
        }

        if (rotateBy === 'weeks') {
            intervalDifference = DateTime.getDifferenceInWeeks(
                firstRotationOn,
                currentDate
            );
        }

        if (rotateBy === 'days') {
            intervalDifference = DateTime.getDifferenceInDays(
                firstRotationOn,
                currentDate
            );
        }

        const activeTeamIndex: $TSFixMe = computeActiveTeamIndex(
            teams.length,
            intervalDifference,
            rotationInterval
        );
        let activeTeamRotationStartTime = null;

        //if the first rotation hasn't kicked in yet.
        if (DateTime.lessThan(currentDate, firstRotationOn)) {
            activeTeamRotationStartTime = createdAt;
        } else {
            activeTeamRotationStartTime = moment(firstRotationOn).add(
                intervalDifference,
                rotateBy
            );
        }

        const activeTeamRotationEndTime: $TSFixMe = moment(
            activeTeamRotationStartTime
        ).add(rotationInterval, rotateBy);
        const activeTeam: $TSFixMe = {
            _id: teams[activeTeamIndex]._id,
            teamMembers: teams[activeTeamIndex].teamMembers,
            rotationStartTime: activeTeamRotationStartTime,
            rotationEndTime: activeTeamRotationEndTime,
        };

        let nextActiveTeamIndex = activeTeamIndex + 1;

        if (!teams[nextActiveTeamIndex]) {
            nextActiveTeamIndex = 0;
        }

        const nextActiveTeamRotationStartTime: $TSFixMe =
            activeTeamRotationEndTime;
        const nextActiveTeamRotationEndTime: $TSFixMe = moment(
            nextActiveTeamRotationStartTime
        ).add(rotationInterval, rotateBy);
        const nextActiveTeam: $TSFixMe = {
            _id: teams[nextActiveTeamIndex]._id,
            teamMembers: teams[nextActiveTeamIndex].teamMembers,
            rotationStartTime: nextActiveTeamRotationStartTime,
            rotationEndTime: nextActiveTeamRotationEndTime,
        };

        return { activeTeam, nextActiveTeam };
    } else {
        return {
            activeTeam: {
                _id: teams[0]._id,
                teamMembers: teams[0].teamMembers,
                rotationStartTime: null,
                rotationEndTime: null,
            },
            nextActiveTeam: null,
        };
    }
}

module.exports.computeActiveTeams = computeActiveTeams;
