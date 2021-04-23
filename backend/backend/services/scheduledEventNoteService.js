const ScheduledEventNoteModel = require('../models/scheduledEventNote');
const ErrorService = require('./errorService');
const RealTimeService = require('./realTimeService');
const AlertService = require('./alertService');

module.exports = {
    create: async function(data, projectId) {
        try {
            let scheduledEventMessage = await ScheduledEventNoteModel.create(
                data
            );
            scheduledEventMessage = await scheduledEventMessage
                .populate('scheduledEventId', 'name')
                .populate({
                    path: 'scheduledEventId',
                    select: 'name monitors alertSubscriber',
                    populate: {
                        path: 'projectId',
                        select: 'name replyAddress',
                    },
                })
                .populate('createdById', 'name')
                .execPopulate();
            if (
                scheduledEventMessage.scheduledEventId.alertSubscriber &&
                scheduledEventMessage.type === 'investigation' &&
                !(
                    scheduledEventMessage.event_state === 'Resolved' ||
                    scheduledEventMessage.event_state === 'Created' ||
                    scheduledEventMessage.event_state === 'Started'
                )
            ) {
                AlertService.sendScheduledEventInvestigationNoteToSubscribers(
                    scheduledEventMessage
                );
            }

            scheduledEventMessage.type === 'internal'
                ? await RealTimeService.addScheduledEventInternalNote(
                      scheduledEventMessage
                  )
                : await RealTimeService.addScheduledEventInvestigationNote(
                      scheduledEventMessage,
                      projectId
                  );

            return scheduledEventMessage;
        } catch (error) {
            ErrorService.log('scheduledEventNoteService.create', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data, projectId) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;

            let eventMessage = await ScheduledEventNoteModel.findOneAndUpdate(
                query,
                { $set: data },
                { new: true }
            );

            if (!eventMessage) {
                const error = new Error(
                    'Scheduled Event Note not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            eventMessage = await eventMessage
                .populate('scheduledEventId')
                .populate('createdById', 'name')
                .execPopulate();

            eventMessage.type === 'internal'
                ? await RealTimeService.updateScheduledEventInternalNote(
                      eventMessage
                  )
                : await RealTimeService.updateScheduledEventInvestigationNote(
                      eventMessage,
                      projectId
                  );

            return eventMessage;
        } catch (error) {
            ErrorService.log('scheduledEventNoteService.updateOneBy', error);
            throw error;
        }
    },
    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const eventMessage = await ScheduledEventNoteModel.findOne(query)
                .populated('scheduledEventId')
                .populate('createdById', 'name')
                .lean();

            return eventMessage;
        } catch (error) {
            ErrorService.log('scheduledEventNoteService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') {
                skip = Number(skip);
            }

            if (typeof limit === 'string') {
                limit = Number(limit);
            }

            if (!query) query = {};

            const eventMessage = await ScheduledEventNoteModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 })
                .populate('scheduledEventId')
                .populate('createdById', 'name')
                .lean();

            return eventMessage;
        } catch (error) {
            ErrorService.log('scheduledEventNoteService.findBy', error);
            throw error;
        }
    },
    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            const count = await ScheduledEventNoteModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('scheduledEventNoteService.countBy', error);
            throw error;
        }
    },
    deleteBy: async function(query, userId, projectId) {
        try {
            const data = {
                deleted: true,
                event_state: 'Deleted',
                deletedAt: Date.now(),
                deletedById: userId,
            };
            const deletedEventMessage = await this.updateOneBy(query, data);

            if (!deletedEventMessage) {
                const error = new Error(
                    'Scheduled Event Note not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            deletedEventMessage.type === 'internal'
                ? await RealTimeService.deleteScheduledEventInternalNote(
                      deletedEventMessage
                  )
                : await RealTimeService.deleteScheduledEventInvestigationNote(
                      deletedEventMessage,
                      projectId
                  );

            return deletedEventMessage;
        } catch (error) {
            ErrorService.log('scheduledEventNoteService.deleteBy', error);
            throw error;
        }
    },
    hardDelete: async function(query) {
        try {
            await ScheduledEventNoteModel.deleteMany(query);
            return 'Scheduled Event Note(s) removed successfully!';
        } catch (error) {
            ErrorService.log('scheduledEventNoteService.hardDelete', error);
            throw error;
        }
    },
};
