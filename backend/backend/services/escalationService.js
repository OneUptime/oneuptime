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
            ErrorService.log('EscalationModel.find', error);
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
            ErrorService.log('EscalationService.findOneBy', error);
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
            ErrorService.log('EscalationService.create', error);
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
            ErrorService.log('EscalationService.count', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId){
        try {
            var escalation = await EscalationModel.findOneAndUpdate(query, {
                $set:{
                    deleted:true,
                    deletedById:userId,
                    deletedAt:Date.now()
                }
            },{
                new: true
            });
            return escalation;
        } catch (error) {
            ErrorService.log('EscalationService.findOneAndUpdate', error);
            throw error;
        }
    },

    update: async function(data){
        try {
            let _this = this;
            if(!data._id){
                let escalation = await _this.create(data);
                return escalation;
            } else {
                var escalation = await _this.findOneBy({_id: data._id, deleted: { $ne: null }});
    
                let email = (data.email !== null || data.email) !== undefined ? data.email : escalation.email;
                let sms = (data.sms !== null || data.sms !== undefined) ? data.sms : escalation.sms;
                let call = (data.call !== null || data.call !== undefined) ? data.call : escalation.call;
                let callFrequency = data.callFrequency || escalation.callFrequency;
                let smsFrequency = data.smsFrequency || escalation.smsFrequency;
                let emailFrequency = data.emailFrequency || escalation.smsFrequency;
                let projectId = data.projectId || escalation.projectId;
                let createdById = data.createdById || escalation.createdById;
                let teamMember = data.teamMember || escalation.teamMember;

                escalation = await EscalationModel.findByIdAndUpdate(data._id, {
                    $set:{
                        call,
                        sms,
                        email,
                        callFrequency,
                        smsFrequency,
                        emailFrequency,
                        projectId,
                        createdById,
                        teamMember,
                        createdAt : Date.now(),
                    }
                }, {
                    new: true
                });

                return escalation;
            }
        } catch (error) {
            ErrorService.log('EscalationService.findByIdAndUpdate', error);
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
                    await _this.update({ _id: escalation._id, teamMember: teamMembers });
                }));
            }
        } catch (error) {
            ErrorService.log('EscalationService.removeEscalationMember', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query){
        try {
            await EscalationModel.deleteMany(query);
            return 'Escalation(s) removed successfully';
        } catch (error) {
            ErrorService.log('EscalationService.deleteMany', error);
            throw error;
        }
    },

    restoreBy: async function (query) {
        const _this = this;
        query.deleted = true;
        let escalation = await _this.findBy(query);
        if(escalation && escalation.length > 1){
            const escalations = await Promise.all(escalation.map(async (escalation) => {
                const escalationId = escalation._id;
                escalation = await _this.update({_id: escalationId, deleted: true}, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                return escalation;
            }));
            return escalations;
        }else{
            escalation = escalation[0];
            if(escalation){
                const escalationId = escalation._id;
                escalation = await _this.update({_id: escalationId, deleted: true }, {
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