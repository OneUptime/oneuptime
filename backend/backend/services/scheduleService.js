module.exports = {
    findBy: async function (query, limit, skip) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof (skip) === 'string') skip = parseInt(skip);

        if (typeof (limit) === 'string') limit = parseInt(limit);

        if (!query) query = {};

        query.deleted = false;

        try{
            var schedules = await ScheduleModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('userIds', 'name')
                .populate('createdById', 'name')
                .populate('monitorIds', 'name')
                .populate('projectId', 'name')
                .populate({
                    path: 'escalationIds',
                    select: 'teamMember',
                    populate: {path:'teamMember.member',select:'name'}
                });
        }catch(error){
            ErrorService.log('ScheduleModel.find', error);
            throw error;
        }
        return schedules;
    },

    findOneBy: async function (query) {

        if (!query) {
            query = {};
        }

        query.deleted = false;
        try{
            var schedule = await ScheduleModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('userIds', 'name')
                .populate('createdById', 'name')
                .populate('monitorIds', 'name')
                .populate('projectId', 'name')
                .populate({
                    path: 'escalationIds',
                    select: 'teamMember',
                    populate: {path:'teamMember.member',select:'name'}
                });
        }catch(error){
            ErrorService.log('ScheduleModel.findOne', error);
            throw error;
        }

        return schedule;
    },

    create: async function (data) {

        var scheduleModel = new ScheduleModel();
        scheduleModel.name = data.name || null;
        scheduleModel.projectId = data.projectId || null;
        scheduleModel.createdById = data.createdById || null;

        // if userIds is array
        if (data.userIds) {
            scheduleModel.userIds = [];
            for (let userId of data.userIds) {
                scheduleModel.userIds.push(userId);
            }
        }

        // if monitorIds is array
        if (data.monitorIds) {
            scheduleModel.monitorIds = [];
            for (let monitorId of data.monitorIds) {
                scheduleModel.userIds.push(monitorId);
            }
        }

        try{
            var schedule = await scheduleModel.save();
        }catch(error){
            ErrorService.log('scheduleModel.save', error);
            throw error;
        }
        return schedule;
    },

    countBy: async function (query) {

        if (!query) {
            query = {};
        }

        query.deleted = false;
        try{
            var count = await ScheduleModel.count(query);
        }catch(error){
            ErrorService.log('ScheduleModel.count', error);
            throw error;
        }
        return count;
    },

    deleteBy: async function (query, userId) {
        try{
            var schedule = await ScheduleModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            }, {
                new: true
            });
        }catch(error){
            ErrorService.log('ScheduleModel.findOneAndUpdate', error);
            throw error;
        }
        if (schedule && schedule._id) {
            try{
                var escalations = await EscalationService.findBy({ scheduleId: schedule._id });
            }catch(error){
                ErrorService.log('EscalationService.findBy', error);
                throw error;
            }
            try{
                await escalations.map(({ _id }) => EscalationService.deleteBy({ _id: _id }, userId));
            }catch(error){
                ErrorService.log('EscalationService.deleteBy', error);
                throw error;
            }
        }
        return schedule;
    },

    removeMonitor: async function (monitorId) {
        try{
            var schedule = await ScheduleModel.findOneAndUpdate({monitorIds:monitorId}, {
                $pull: {monitorIds: monitorId}
            });
        }catch(error){
            ErrorService.log('ScheduleModel.findOneAndUpdate', error);
            throw error;
        }
        return schedule;
    },

    update: async function (data) {
        var _this = this;
        if (!data._id) {
            try{
                let schedule = await _this.create(data);
                return schedule;
            }catch(error){
                ErrorService.log('ScheduleService.create', error);
                throw error;
            }
        } else {
            try{
                var schedule = await _this.findOneBy({ _id: data._id });
            }catch(error){
                ErrorService.log('ScheduleService.findOneBy', error);
                throw error;
            }
            var name = data.name || schedule.name;
            var projectId = data.projectId || schedule.projectId;
            var createdById = data.createdById || schedule.createdById;
            var userIds = [];
            if (data.userIds) {
                for (let userId of data.userIds) {
                    userIds.push(userId);
                }
            }
            else {
                userIds = schedule.userIds;
            }
            var monitorIds = [];
            if (data.monitorIds) {
                for (let monitorId of data.monitorIds) {
                    monitorIds.push(monitorId);
                }
            }
            else {
                monitorIds = schedule.monitorIds;
            }
            var escalationIds = data.escalationIds || schedule.escalationIds;
            try{
                schedule = await ScheduleModel.findByIdAndUpdate(data._id, {
                    $set: {
                        name: name,
                        projectId: projectId,
                        createdById: createdById,
                        userIds: userIds,
                        monitorIds: monitorIds,
                        escalationIds: escalationIds,
                        createdAt: Date.now(),
                    }
                }, {
                    new: true
                });
            }catch(error){
                ErrorService.log('ScheduleModel.findByIdAndUpdate', error);
                throw error;
            }
            try{
                schedule = await _this.findBy({ _id: data._id }, 10, 0);
            }catch(error){
                ErrorService.log('ScheduleService.findBy', error);
                throw error;
            }
            return schedule;
        }
    },

    saveSchedule: async function (schedule) {
        try{
            schedule = await schedule.save();
        }catch(error){
            ErrorService.log('schedule.save', error);
            throw error;
        }
        return schedule;
    },

    deleteMonitor: async function (monitorId) {
        try{
            await ScheduleModel.update({ deleted: false }, { $pull: { monitorIds: monitorId } });
        }catch(error){
            ErrorService.log('ScheduleModel.update', error);
            throw error;
        }
    },

    addEscalation: async function (scheduleId, escalationData, userId) {

        let _this = this;
        let escalationIds = [];

        for (let data of escalationData) {
            try{
                var escalation = await EscalationService.update(data);
            }catch(error){
                ErrorService.log('EscalationService.update', error);
                throw error;
            }
            escalationIds.push(escalation._id);
        }

        if (escalationIds && escalationIds.length) {
            try{
                await _this.escalationCheck(escalationIds, scheduleId, userId);
            }catch(error){
                ErrorService.log('ScheduleService.escalationCheck', error);
                throw error;
            }
        }

        try{
            await _this.update({ _id: scheduleId, escalationIds: escalationIds });
        }catch(error){
            ErrorService.log('ScheduleService.update', error);
            throw error;
        }
        try{
            var escalations = await _this.getEscalation(scheduleId);
        }catch(error){
            ErrorService.log('ScheduleService.getEscalation', error);
            throw error;
        }
        return escalations.escalations;
    },

    getEscalation: async function (scheduleId) {
        let _this = this;
        try{
            var schedule = await _this.findOneBy({ _id: scheduleId });
        }catch(error){
            ErrorService.log('ScheduleService.findOneBy', error);
            throw error;
        }
        let escalationIds = schedule.escalationIds;
        let escalations = await Promise.all(escalationIds.map(async (escalationId) => {
            try{
                return await EscalationService.findOneBy({ _id: escalationId._id });
            }catch(error){
                ErrorService.log('EscalationService.findOneBy', error);
                throw error;
            }
        }));
        return { escalations, count: escalationIds.length };
    },

    escalationCheck: async function (escalationIds, scheduleId, userId) {
        let _this = this;
        try{
            var scheduleIds = await _this.findOneBy({ _id: scheduleId });
        }catch(error){
            ErrorService.log('', error);
            throw error;
        }
        scheduleIds = scheduleIds.escalationIds.map(i => i._id.toString());
        escalationIds = escalationIds.map(i => i.toString());

        scheduleIds.map(async (id) => {
            if (escalationIds.indexOf(id) < 0) {
                try{
                    await EscalationService.deleteBy({ _id: id }, userId);
                }catch(error){
                    ErrorService.log('EscalationService.deleteBy', error);
                    throw error;
                }
            }
        });
    },

    deleteEscalation: async function (escalationId) {
        try{
            await ScheduleModel.update({ deleted: false }, { $pull: { escalationIds: escalationId } });
        }catch(error){
            ErrorService.log('ScheduleModel.update', error);
            throw error;
        }
    },

    getSubProjectSchedules: async function(subProjectIds){
        var _this = this;
        let subProjectSchedules = await Promise.all(subProjectIds.map(async (id)=>{
            let schedules = await _this.findBy({projectId: id}, 10, 0);
            let count = await _this.countBy({projectId: id});
            return {schedules, count, _id: id, skip: 0, limit: 10};
        }));
        return subProjectSchedules;
    },

    hardDeleteBy: async function (query) {
        try{
            await ScheduleModel.deleteMany(query);
        }catch(error){
            ErrorService.log('ScheduleModel.deleteMany', error);
            throw error;
        }
        return 'Schedule(s) removed successfully';
    },
};

var ScheduleModel = require('../models/schedule');
let EscalationService = require('../services/escalationService');
let ErrorService = require('../services/errorService');