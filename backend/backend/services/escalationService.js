module.exports = {

    findBy: async function (query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof (skip) === 'string') skip = parseInt(skip);

            if (typeof (limit) === 'string') limit = parseInt(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;
            var escalations = await EscalationModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate('scheduleId', 'name');
            return escalations;
        } catch (error) {
            ErrorService.log('escalationService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function (query) {

        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var escalation = await EscalationModel.findOne(query)
                .populate('projectId', 'name')
                .populate('scheduleId', 'name')
                .lean();

            const { activeTeam, nextActiveTeam } = computeActiveTeams(escalation);
            escalation.activeTeam = activeTeam;
            escalation.nextActiveTeam = nextActiveTeam;

            return escalation;
        } catch (error) {
            ErrorService.log('escalationService.findOneBy', error);
            throw error;
        }

    },

    create: async function (data) {
        try {

            

            let escalationModel = new EscalationModel({
                call: data.call,
                email: data.email,
                sms: data.sms,
                callFrequency: data.callFrequency,
                smsFrequency: data.smsFrequency,
                emailFrequency: data.emailFrequency,
                rotationFrequency: data.rotationFrequency,
                rotationInterval: data.rotationInterval,
                rotationSwitchTime: data.rotationSwitchTime,
                rotationTimezone: data.rotationTimezone,
                projectId: data.projectId,
                scheduleId: data.scheduleId,
                createdById: data.createdById,
                team: data.team,
            });

            var escalation = await escalationModel.save();
            return escalation;
        } catch (error) {
            ErrorService.log('escalationService.create', error);
            throw error;
        }
    },

    countBy: async function (query) {

        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var count = await EscalationModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('escalationService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function (query, userId) {
        try {
            var escalation = await EscalationModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            }, {
                new: true
            });
            return escalation;
        } catch (error) {
            ErrorService.log('escalationService.deleteBy', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var escalation = await EscalationModel.findOneAndUpdate(query, {
                $set: data
            }, {
                new: true
            });
        } catch (error) {
            ErrorService.log('escalationService.updateOneBy', error);
            throw error;
        }
        return escalation;
    },

    updateBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var updatedData = await EscalationModel.updateMany(query, {
                $set: data
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('escalationService.updateMany', error);
            throw error;
        }
    },

    removeEscalationMember: async function (projectId, memberId) {
        try {
            var _this = this;
            var escalations = await _this.findBy({ projectId });

            if (escalations && escalations.length > 0) {
                await Promise.all(escalations.map(async (escalation) => {
                    var teamMembers = escalation.teamMembers.filter(member => member.userId.toString() !== memberId.toString());
                    await _this.updateOneBy({ _id: escalation._id }, { teamMember: teamMembers });
                }));
            }
        } catch (error) {
            ErrorService.log('escalationService.removeEscalationMember', error);
            throw error;
        }
    },

    hardDeleteBy: async function (query) {
        try {
            await EscalationModel.deleteMany(query);
            return 'Escalation(s) removed successfully';
        } catch (error) {
            ErrorService.log('escalationService.hardDeleteBy', error);
            throw error;
        }
    },

    restoreBy: async function (query) {
        const _this = this;
        query.deleted = true;
        let escalation = await _this.findBy(query);
        if (escalation && escalation.length > 1) {
            const escalations = await Promise.all(escalation.map(async (escalation) => {
                const escalationId = escalation._id;
                escalation = await _this.updateOneBy({ _id: escalationId, deleted: true }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                return escalation;
            }));
            return escalations;
        } else {
            escalation = escalation[0];
            if (escalation) {
                const escalationId = escalation._id;
                escalation = await _this.updateOneBy({ _id: escalationId, deleted: true }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
            }
            return escalation;
        }
    }
};

function computeIntervalDiffs(frequency, createdAt, currentDate, rotationSwitchTime) {
    // if (moment(currentDate).isAfter(rotationSwitchTime)) return 0;
    switch (frequency) {
        case 'days':
            return differenceInDays(currentDate, createdAt);
        case 'weeks':
            return differenceInWeeks(currentDate, createdAt);
        case 'months':
            return differenceInMonths(currentDate, createdAt);
    }
}


function computeActiveTeamIndex(numberOfTeams, diffsInInterval, rotationSwitchTime) {
    let diffInt = diffsInInterval % numberOfTeams;

    let activeTeamIndex = 0;
    // handle case 0%3 which gives the same result as 3%3
    // but will mean different things for rotation purposes
    if (diffsInInterval === 0) return activeTeamIndex;
    if (diffInt === 0) {
        activeTeamIndex = numberOfTeams - 1;
    } else {
        activeTeamIndex = diffInt - 1;
    }

    return activeTeamIndex;
}

function computeActiveTeams(escalation) {
    // eslint-disable-next-line no-useless-catch
    try {
        let {
            team, rotationInterval, rotationFrequency,
            rotationSwitchTime, createdAt, rotationTimezone
        } = escalation;

        const currentDate = new Date();
        if (rotationFrequency && rotationFrequency != "") {
            const diffsInInterval = computeIntervalDiffs(rotationFrequency, createdAt, currentDate, rotationSwitchTime);
            const activeTeamIndex = computeActiveTeamIndex(team.length, diffsInInterval);

            let activeTeamRotationStartTime = moment(createdAt).add(diffsInInterval, rotationFrequency);

            let activeTeamRotationEndTime = moment(activeTeamRotationStartTime).add(rotationInterval, rotationFrequency);

            const activeTeam = {
                _id: team[activeTeamIndex]._id,
                teamMembers: team[activeTeamIndex].teamMember,
                rotationStartTime: activeTeamRotationStartTime,
                rotationEndTime: activeTeamRotationEndTime
            };


            let nextActiveTeamIndex = activeTeamIndex + 1;

            if (!team[nextActiveTeamIndex]) {
                nextActiveTeamIndex = 0;
            }

            const nextActiveTeamRotationStartTime = activeTeamRotationEndTime;
            const nextActiveTeamRotationEndTime = moment(nextActiveTeamRotationStartTime).add(rotationInterval, rotationFrequency);
            const nextActiveTeam = {
                _id: team[nextActiveTeamIndex]._id,
                teamMembers: team[nextActiveTeamIndex].teamMember,
                rotationStartTime: nextActiveTeamRotationStartTime,
                rotationEndTime: nextActiveTeamRotationEndTime,
            };

            return { activeTeam, nextActiveTeam };
        } else {
            return {
                activeTeam: {
                    _id: team[0]._id,
                    teamMembers: team[0].teamMember,
                    rotationStartTime: null,
                    rotationEndTime: null
                },
                nextActiveTeam: null
            }
        }

    } catch (err) {
        throw err;
    }
}

module.exports.computeActiveTeams = computeActiveTeams;

var EscalationModel = require('../models/escalation');
var ErrorService = require('./errorService');
const moment = require('moment');
const differenceInDays = require('date-fns/differenceInDays');
const differenceInWeeks = require('date-fns/differenceInWeeks');
const differenceInMonths = require('date-fns/differenceInMonths');
