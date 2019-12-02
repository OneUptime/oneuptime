module.exports = {
    findBy: async function(query, limit, skip){
        if(!skip) skip=0;

        if(!limit) limit=0;

        if(typeof(skip) === 'string') skip = parseInt(skip);

        if(typeof(limit) === 'string') limit = parseInt(limit);

        if(!query) query = {};

        if(!query.deleted) query.deleted = false;
        try{
            var escalations = await EscalationModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate('scheduleId', 'name');
        }catch(error){
            ErrorService.log('EscalationModel.find', error);
            throw error;
        }
        return escalations;
    },

    findOneBy: async function (query) {

        if (!query) {
            query = {};
        }

        if(!query.deleted) query.deleted = false;
        try{
            var escalation = await EscalationModel.findOne(query)
                .populate('projectId', 'name')
                .populate('scheduleId', 'name');
        }catch(error){
            ErrorService.log('EscalationModel.findOne', error);
            throw error;
        }

        return escalation;
    },

    create: async function (data) {
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
        try{
            var escalation = await escalationModel.save();
        }catch(error){
            ErrorService.log('escalationModel.save', error);
            throw error;
        }
        return escalation;
    },

    countBy: async function (query) {

        if(!query){
            query = {};
        }

        query.deleted = false;
        try{
            var count = await EscalationModel.count(query);
        }catch(error){
            ErrorService.log('EscalationModel.count', error);
            throw error;
        }
        return count;
    },

    deleteBy: async function(query, userId){
        try{
            var escalation = await EscalationModel.findOneAndUpdate(query, {
                $set:{
                    deleted:true,
                    deletedById:userId,
                    deletedAt:Date.now()
                }
            },{
                new: true
            });
        }catch(error){
            ErrorService.log('EscalationModel.findOneAndUpdate', error);
            throw error;
        }
        return escalation;
    },

    update: async function(data){
        let _this = this;
        if(!data._id){
            try{
                let escalation = await _this.create(data);
                return escalation;
            }catch(error){
                ErrorService.log('EscalationService.create', error);
                throw error;
            }
        }else{
            try{
                var escalation = await _this.findOneBy({_id: data._id, deleted: { $ne: null }});
            }catch(error){
                ErrorService.log('EscalationService.findOneBy', error);
                throw error;
            }
            let email = data.email || escalation.email;
            let sms = data.sms || escalation.sms;
            let call = data.call || escalation.call;
            let callFrequency = data.callFrequency || escalation.callFrequency;
            let smsFrequency = data.smsFrequency || escalation.smsFrequency;
            let emailFrequency = data.emailFrequency || escalation.smsFrequency;
            let projectId = data.projectId || escalation.projectId;
            let createdById = data.createdById || escalation.createdById;
            let teamMember = data.teamMember || escalation.teamMember;
            try{
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
            }catch(error){
                ErrorService.log('EscalationModel.findByIdAndUpdate', error);
                throw error;
            }
            return escalation;
        }
    },

    removeEscalationMember: async function(projectId, memberId){
        var _this = this;
        try{
            var escalations = await _this.findBy({projectId});
        }catch(error){
            ErrorService.log('ProjectService.findBy', error);
            throw error;
        }
        if(escalations && escalations.length > 0){
            await Promise.all(escalations.map(async(escalation)=>{
                var teamMembers = escalation.teamMember.filter(member => member.member.toString() !== memberId.toString());
                try{
                    await _this.update({ _id: escalation._id, teamMember: teamMembers });
                }catch(error){
                    ErrorService.log('EscalationService.update', error);
                    throw error;
                }
            }));
        }
    },

    hardDeleteBy: async function(query){
        try{
            await EscalationModel.deleteMany(query);
        }catch(error){
            ErrorService.log('EscalationModel.deleteMany', error);
            throw error;
        }
        return 'Escalation(s) removed successfully';
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