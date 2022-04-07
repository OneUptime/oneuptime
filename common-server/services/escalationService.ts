import EscalationModel from '../models/escalation';
import moment from 'moment';
import DateTime from '../utils/DateTime';
import ScheduleService from './ScheduleService';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default class Service {
    async findBy({ query, limit, skip, sort, select, populate }: FindBy) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;
        const escalationsQuery = EscalationModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        escalationsQuery.select(select);
        escalationsQuery.populate(populate);

        const escalations = await escalationsQuery;
        return escalations;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const escalationQuery = EscalationModel.findOne(query)
            .sort(sort)
            .lean();

        escalationQuery.select(select);
        escalationQuery.populate(populate);

        const escalation = await escalationQuery;

        const { activeTeam, nextActiveTeam } = computeActiveTeams(escalation);
        escalation.activeTeam = activeTeam;
        escalation.nextActiveTeam = nextActiveTeam;

        return escalation;
    }

    async create(data: $TSFixMe) {
        const escalationModel = new EscalationModel({
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

        const escalation = await escalationModel.save();
        return escalation;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await EscalationModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query, userId: string) {
        const escalation = await EscalationModel.findOneAndUpdate(
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

    async updateOneBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const escalation = await EscalationModel.findOneAndUpdate(
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

    async updateBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        let updatedData = await EscalationModel.updateMany(query, {
            $set: data,
        });

        const populateEscalation = [
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
        const selectEscalation =
            'projectId callReminders emailReminders smsReminders pushReminders rotateBy rotationInterval firstRotationOn rotationTimezone call email sms push createdById scheduleId teams createdAt deleted deletedAt';

        updatedData = await this.findBy({
            query,
            populate: populateEscalation,
            select: selectEscalation,
        });
        return updatedData;
    }

    async deleteEscalationMember(
        projectId: string,
        memberId: $TSFixMe,
        deletedById: $TSFixMe
    ) {
        const _this = this;
        const escalations = await _this.findBy({
            query: { projectId },
            select: '_id teams scheduleId',
        });

        if (escalations && escalations.length > 0) {
            for (const escalation of escalations) {
                const teams = escalation.teams;
                const newTeams = [];
                for (const team of teams) {
                    const teamMembers = team.teamMembers;
                    const filtered = teamMembers
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
                        const populateSchedule = [
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

                        const selectSchedule =
                            '_id userIds name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';
                        const schedule = await ScheduleService.findOneBy({
                            query: { _id: escalation.scheduleId },
                            select: selectSchedule,
                            populate: populateSchedule,
                        });
                        const rmEscalation = schedule.escalationIds.filter(
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
                            _this.deleteBy(
                                { _id: escalation._id },
                                deletedById
                            ),
                        ]);
                    }
                }
                await _this.updateOneBy(
                    {
                        _id: escalation._id,
                    },
                    { teams: newTeams }
                );
            }
        }
    }

    async hardDeleteBy(query: Query) {
        await EscalationModel.deleteMany(query);
        return 'Escalation(s) removed successfully';
    }

    async restoreBy(query: Query) {
        const _this = this;
        query.deleted = true;
        let escalation = await _this.findBy({ query, select: '_id' });
        if (escalation && escalation.length > 1) {
            const escalations = await Promise.all(
                escalation.map(async (escalation: $TSFixMe) => {
                    const escalationId = escalation._id;
                    escalation = await _this.updateOneBy(
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
                const escalationId = escalation._id;
                escalation = await _this.updateOneBy(
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
) {
    const difference = Math.floor(intervalDifference / rotationInterval);
    return difference % numberOfTeams;
}

function computeActiveTeams(escalation: $TSFixMe) {
    const { teams, rotationInterval, rotateBy, createdAt, rotationTimezone } =
        escalation;

    let firstRotationOn = escalation.firstRotationOn;

    const currentDate = new Date();

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

        const activeTeamIndex = computeActiveTeamIndex(
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

        const activeTeamRotationEndTime = moment(
            activeTeamRotationStartTime
        ).add(rotationInterval, rotateBy);
        const activeTeam = {
            _id: teams[activeTeamIndex]._id,
            teamMembers: teams[activeTeamIndex].teamMembers,
            rotationStartTime: activeTeamRotationStartTime,
            rotationEndTime: activeTeamRotationEndTime,
        };

        let nextActiveTeamIndex = activeTeamIndex + 1;

        if (!teams[nextActiveTeamIndex]) {
            nextActiveTeamIndex = 0;
        }

        const nextActiveTeamRotationStartTime = activeTeamRotationEndTime;
        const nextActiveTeamRotationEndTime = moment(
            nextActiveTeamRotationStartTime
        ).add(rotationInterval, rotateBy);
        const nextActiveTeam = {
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
