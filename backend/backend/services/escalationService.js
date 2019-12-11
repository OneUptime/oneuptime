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
            let escalationModel = new EscalationModel();
            escalationModel.call = data.call || null;
            escalationModel.email = data.email || null;
            escalationModel.sms = data.sms || null;
            escalationModel.callFrequency = data.callFrequency || null;
            escalationModel.smsFrequency = data.smsFrequency || null;
            escalationModel.emailFrequency = data.emailFrequency || null;
            escalationModel.projectId = data.projectId || null;
            escalationModel.scheduleId = data.scheduleId || null;
            escalationModel.createdById = data.createdById || null;
            escalationModel.teamMember = data.teamMember || null;
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

var EscalationModel = require('../models/escalation');
var ErrorService = require('./errorService');