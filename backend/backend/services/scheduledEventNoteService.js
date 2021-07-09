const ScheduledEventNoteModel = require('../models/scheduledEventNote');
const ErrorService = require('./errorService');
const RealTimeService = require('./realTimeService');
const AlertService = require('./alertService');
const handlePopulate = require('../utils/populate');
const handleSelect = require('../utils/select');

module.exports = {
    create: async function(data, projectId) {
        try {
            let scheduledEventMessage = await ScheduledEventNoteModel.create(
                data
            );

            const populate = [
                { path: 'createdById', select: 'name' },
                {
                    path: 'scheduledEventId',
                    select: 'name monitors alertSubscriber projectId',
                    populate: {
                        path: 'projectId',
                        select: 'name replyAddress',
                    },
                },
            ];
            const select =
                'updated content type event_state createdAt updatedAt createdById scheduledEventId';

            scheduledEventMessage = await this.findOneBy({
                query: { _id: scheduledEventMessage._id },
                select,
                populate,
            });
            if (
                scheduledEventMessage.scheduledEventId.alertSubscriber &&
                scheduledEventMessage.type === 'investigation' &&
                !(
                    scheduledEventMessage.event_state === 'Resolved' ||
                    scheduledEventMessage.event_state === 'Created' ||
                    scheduledEventMessage.event_state === 'Started' ||
                    scheduledEventMessage.event_state === 'Ended' ||
                    scheduledEventMessage.event_state === 'Cancelled'
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
            /** This deletes the scheduled notes*/
            let eventMessage = await ScheduledEventNoteModel.findOneAndUpdate(
                query,
                { $set: data },
                { new: true }
            );
            /** Since the scheduled notes has been deleted
             * The query.deleted value has changed from FALSE to TRUE
             */
            if (eventMessage) {
                query.deleted = eventMessage.deleted; // The query.deleted value is updated as TRUE.
            }

            if (!eventMessage) {
                const error = new Error(
                    'Scheduled Event Note not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            const populate = [
                { path: 'createdById', select: 'name' },
                {
                    path: 'scheduledEventId',
                    select: 'name monitors alertSubscriber projectId',
                    populate: {
                        path: 'projectId',
                        select: 'name replyAddress',
                    },
                },
            ];
            const select =
                'updated content type event_state createdAt updatedAt createdById scheduledEventId';

            eventMessage = await this.findOneBy({ query, populate, select }); // If one of the values of query is not correct, a null is returned as such document could not be found in the DB
            eventMessage.type === 'internal'
                ? RealTimeService.updateScheduledEventInternalNote(eventMessage)
                : RealTimeService.updateScheduledEventInvestigationNote(
                      eventMessage,
                      projectId
                  );

            return eventMessage;
        } catch (error) {
            ErrorService.log('scheduledEventNoteService.updateOneBy', error);
            throw error;
        }
    },
    findOneBy: async function({ query, populate, select }) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let eventMessageQuery = ScheduledEventNoteModel.findOne(
                query
            ).lean();

            eventMessageQuery = handleSelect(select, eventMessageQuery);
            eventMessageQuery = handlePopulate(populate, eventMessageQuery);
            const eventMessage = await eventMessageQuery;
            return eventMessage;
        } catch (error) {
            ErrorService.log('scheduledEventNoteService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function({ query, limit, skip, populate, select }) {
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

            let eventMessageQuery = ScheduledEventNoteModel.find(query)
                .lean()
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 });

            eventMessageQuery = handleSelect(select, eventMessageQuery);
            eventMessageQuery = handlePopulate(populate, eventMessageQuery);

            const eventMessage = await eventMessageQuery;
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
                ? RealTimeService.deleteScheduledEventInternalNote(
                      deletedEventMessage
                  )
                : RealTimeService.deleteScheduledEventInvestigationNote(
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
