module.exports = {
    findBy: async function (query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 10;

            if (typeof (skip) === 'string') skip = parseInt(skip);

            if (typeof (limit) === 'string') limit = parseInt(limit);

            if (!query) query = {};

            if(!query.deleted) query.deleted = false;
            const schedules = await ScheduleModel.find(query)
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
                    populate: { path: 'teamMember.userId', select: 'name' }
                });
            return schedules;
        } catch (error) {
            ErrorService.log('scheduleService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            if(!query.deleted) query.deleted = false;
            const schedule = await ScheduleModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('userIds', 'name')
                .populate('createdById', 'name')
                .populate('monitorIds', 'name')
                .populate('projectId', 'name')
                .populate({
                    path: 'escalationIds',
                    select: 'teamMember',
                    populate: { path: 'teamMember.userId', select: 'name' }
                });
            return schedule;
        } catch (error) {
            ErrorService.log('scheduleService.findOneBy', error);
            throw error;
        }
    },

    create: async function (data) {
        try {
            const scheduleModel = new ScheduleModel();
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
            const schedule = await scheduleModel.save();
            return schedule;
        } catch (error) {
            ErrorService.log('scheduleService.create', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            if(!query.deleted) query.deleted = false;
            const count = await ScheduleModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('scheduleService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function (query, userId) {
        try {
            const schedule = await ScheduleModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            }, {
                new: true
            });

            if (schedule && schedule._id) {
                const escalations = await EscalationService.findBy({query: { scheduleId: schedule._id }});
                await escalations.map(({ _id }) => EscalationService.deleteBy({ _id: _id }, userId));
            }

            return schedule;
        } catch (error) {
            ErrorService.log('scheduleService.deleteBy', error);
            throw error;
        }
    },

    removeMonitor: async function (monitorId) {
        try {
            const schedule = await ScheduleModel.findOneAndUpdate({monitorIds:monitorId}, {
                $pull: {monitorIds: monitorId}
            });
            return schedule;
        } catch (error) {
            ErrorService.log('scheduleService.removeMonitor', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const _this = this;
            let schedule = await _this.findOneBy(query);
            let userIds = [];
            if (data.userIds) {
                for (const userId of data.userIds) {
                    userIds.push(userId);
                }
            }
            else {
                userIds = schedule.userIds;
            }
            data.userIds = userIds;
            let monitorIds = [];
            if (data.monitorIds) {
                for (const monitorId of data.monitorIds) {
                    monitorIds.push(monitorId);
                }
            }
            else {
                monitorIds = schedule.monitorIds;
            }
            data.monitorIds = monitorIds;
            schedule = await ScheduleModel.findOneAndUpdate(query, {
                $set: data
            }, {
                new: true
            });
            schedule = await _this.findBy({ _id: query._id }, 10, 0);
            return schedule;
        } catch (error) {
            ErrorService.log('scheduleService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await ScheduleModel.updateMany(query, {
                $set: data
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('scheduleService.updateMany', error);
            throw error;
        }
    },

    saveSchedule: async function (schedule) {
        try {
            schedule = await schedule.save();
            return schedule;
        } catch (error) {
            ErrorService.log('scheduleService.saveSchedule', error);
            throw error;
        }
    },

    deleteMonitor: async function (monitorId) {
        try {
            await ScheduleModel.update({ deleted: false }, { $pull: { monitorIds: monitorId } });
        }catch(error){
            ErrorService.log('scheduleService.deleteMonitor', error);
            throw error;
        }
    },

    addEscalation: async function (scheduleId, escalations, userId) {
        try {
            const _this = this;
            const escalationIds = [];
            for (const data of escalations) {
                let escalation = {};
                if (!data._id) {
                    escalation = await EscalationService.create(data);
                } else {
                    escalation = await EscalationService.updateOneBy({ _id: data._id }, data);
                }
                escalationIds.push(escalation._id);
            }

            if (escalationIds && escalationIds.length) {
                await _this.escalationCheck(escalationIds, scheduleId, userId);
            }
            await _this.updateOneBy({ _id: scheduleId }, { escalationIds: escalationIds });

            const scheduleEscalation = await _this.getEscalations(scheduleId);

            return scheduleEscalation.escalations;
        } catch (error) {
            ErrorService.log('scheduleService.addEscalation', error);
            throw error;
        }
    },

    getEscalations: async function (scheduleId) {
        try {
            const _this = this;
            const schedule = await _this.findOneBy({ _id: scheduleId });

            const escalationIds = schedule.escalationIds;
            const escalations = await Promise.all(escalationIds.map(async (escalationId) => {
                return await EscalationService.findOneBy({ _id: escalationId._id });
            }));
            return { escalations, count: escalationIds.length };
        } catch (error) {
            ErrorService.log('scheduleService.getEscalations', error);
            throw error;
        }
    },

    escalationCheck: async function (escalationIds, scheduleId, userId) {
        try {
            const _this = this;
            let scheduleIds = await _this.findOneBy({ _id: scheduleId });

            scheduleIds = scheduleIds.escalationIds.map(i => i._id.toString());
            escalationIds = escalationIds.map(i => i.toString());

            scheduleIds.map(async (id) => {
                if (escalationIds.indexOf(id) < 0) {
                    await EscalationService.deleteBy({ _id: id }, userId);
                }
            });
        } catch (error) {
            ErrorService.log('scheduleService.escalationCheck', error);
            throw error;
        }
    },

    deleteEscalation: async function (escalationId) {
        try {
            await ScheduleModel.update({ deleted: false }, { $pull: { escalationIds: escalationId } });
        }catch(error){
            ErrorService.log('scheduleService.deleteEscalation', error);
            throw error;
        }
    },

    getSubProjectSchedules: async function (subProjectIds) {
        const _this = this;
        const subProjectSchedules = await Promise.all(subProjectIds.map(async (id) => {
            const schedules = await _this.findBy({ projectId: id }, 10, 0);
            const count = await _this.countBy({ projectId: id });
            return { schedules, count, _id: id, skip: 0, limit: 10 };
        }));
        return subProjectSchedules;
    },

    hardDeleteBy: async function (query) {
        try {
            await ScheduleModel.deleteMany(query);
            return 'Schedule(s) removed successfully';
        } catch(error) {
            ErrorService.log('scheduleService.hardDeleteBy', error);
            throw error;
        }
    },

    restoreBy: async function (query) {
        const _this = this;
        query.deleted = true;
        let schedule = await _this.findBy(query);
        if (schedule && schedule.length > 1) {
            const schedules = await Promise.all(schedule.map(async (schedule) => {
                const scheduleId = schedule._id;
                schedule = await _this.updateOneBy({ _id: scheduleId, deleted: true }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                await EscalationService.restoreBy({ scheduleId, deleted: true });
                return schedule;
            }));
            return schedules;
        } else {
            schedule = schedule[0];
            if (schedule) {
                const scheduleId = schedule._id;
                schedule = await _this.updateOneBy({ _id: scheduleId, deleted: true }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                await EscalationService.restoreBy({ scheduleId, deleted: true });
            }
            return schedule;
        }
    }
};

const ScheduleModel = require('../models/schedule');
const EscalationService = require('../services/escalationService');
const ErrorService = require('../services/errorService');
