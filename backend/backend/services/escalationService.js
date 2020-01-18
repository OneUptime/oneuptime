module.exports = {
    findBy: async function(query, limit, skip){
        try {
            if(!skip) skip=0;

            if(!limit) limit=0;

            if(typeof(skip) === 'string') skip = parseInt(skip);

            if(typeof(limit) === 'string') limit = parseInt(limit);

            if(!query) query = {};

            if(!query.deleted) query.deleted = false;
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

            if(!query.deleted) query.deleted = false;
            var escalation = await EscalationModel.findOne(query)
                .populate('projectId', 'name')
                .populate('scheduleId', 'name');
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
                projectId: data.projectId,
                scheduleId: data.scheduleId,
                createdById: data.createdById,
                team: data.team,
            });

            const activeTeam = composeActiveTeam(
                escalationModel.team[0]._id,
                escalationModel.team,
                escalationModel.rotationInterval,
                escalationModel.rotationFrequency
            );

            escalationModel.activeTeamId = activeTeam._id;
            escalationModel.activeTeam = activeTeam;
            escalationModel.estimatedSwitchTime = activeTeam.rotationEndTime;

            var escalation = await escalationModel.save();
            return escalation;
        } catch (error) {
            ErrorService.log('escalationService.create', error);
            throw error;
        }
    },

    countBy: async function (query) {

        try {
            if(!query){
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

    deleteBy: async function(query, userId){
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

    removeEscalationMember: async function(projectId, memberId){
        try {
            var _this = this;
            var escalations = await _this.findBy({projectId});

            if (escalations && escalations.length > 0) {
                await Promise.all(escalations.map(async(escalation)=>{
                    var teamMembers = escalation.teamMember.filter(member => member.member.toString() !== memberId.toString());
                    await _this.updateOneBy({ _id: escalation._id }, { teamMember: teamMembers });
                }));
            }
        } catch (error) {
            ErrorService.log('escalationService.removeEscalationMember', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query){
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

function composeActiveTeam (id, teams, interval, frequency, date = new Date(), incrementBy = date) {
    const activeTeam = teams.find(team => team._id === id);
    activeTeam.rotationStartTime = date;
    activeTeam.rotationEndTime = moment(incrementBy).add(interval, frequency);

    return activeTeam;
}

async function switchActiveTeam() {
    try {
        const escalations = await EscalationModel.find();
        escalations.forEach(async escalation => {
            let {
                estimatedSwitchTime, activeTeamId, _id,
                team, rotationInterval, rotationFrequency,
            } = escalation;
      
            const currentDate = new Date();
            if (moment(estimatedSwitchTime).isSameOrBefore(currentDate)) {
                const activeTeamIndex = escalation.team.findIndex(team => team._id.toString() === activeTeamId.toString());
                let nextTeamIndex = activeTeamIndex + 1;
                if (!escalation.team[nextTeamIndex]) {
                    nextTeamIndex = 0;
                }
    
                const nextActiveTeamId = escalation.team[nextTeamIndex]._id;

                const nextActiveTeam = composeActiveTeam(
                    nextActiveTeamId,
                    team,
                    rotationInterval,
                    rotationFrequency,
                    escalation.estimatedSwitchTime
                );
                team.splice(nextTeamIndex, 1, nextActiveTeam);
                team.forEach(indTeam => {
                    if (indTeam._id.toString() !== nextActiveTeam._id.toString()) {
                        indTeam.rotationStartTime = null;
                        indTeam.rotationEndTime = null;
                    }
                });
                await EscalationModel
                    .findByIdAndUpdate(_id, {
                        activeTeam: nextActiveTeam,
                        activeTeamId: nextActiveTeam._id,
                        team,
                        estimatedSwitchTime: nextActiveTeam.rotationEndTime
                    })
                    .exec();
            }
          
        });
    } catch (err) {
        throw err;
    }
}

module.exports.switchActiveTeam = switchActiveTeam;

var EscalationModel = require('../models/escalation');
var ErrorService = require('./errorService');
const moment = require('moment');