import ScheduledEventNoteModel from '../models/scheduledEventNote'
import ErrorService from 'common-server/utils/error'
import RealTimeService from './realTimeService'
import AlertService from './alertService'
import handlePopulate from '../utils/populate'
import handleSelect from '../utils/select'

export default {
    create: async function(data: $TSFixMe, projectId: $TSFixMe) {
        let scheduledEventMessage = await ScheduledEventNoteModel.create(data);

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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEventId' does not exist on type... Remove this comment to see the full error message
            scheduledEventMessage.scheduledEventId.alertSubscriber &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Document<a... Remove this comment to see the full error message
            scheduledEventMessage.type === 'investigation' &&
            !(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'event_state' does not exist on type 'Doc... Remove this comment to see the full error message
                scheduledEventMessage.event_state === 'Resolved' ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'event_state' does not exist on type 'Doc... Remove this comment to see the full error message
                scheduledEventMessage.event_state === 'Created' ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'event_state' does not exist on type 'Doc... Remove this comment to see the full error message
                scheduledEventMessage.event_state === 'Started' ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'event_state' does not exist on type 'Doc... Remove this comment to see the full error message
                scheduledEventMessage.event_state === 'Ended' ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'event_state' does not exist on type 'Doc... Remove this comment to see the full error message
                scheduledEventMessage.event_state === 'Cancelled'
            )
        ) {
            AlertService.sendScheduledEventInvestigationNoteToSubscribers(
                scheduledEventMessage
            ).catch(error => {
                ErrorService.log(
                    'AlertService.sendScheduledEventInvestigationNoteToSubscribers',
                    error
                );
            });
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Document<a... Remove this comment to see the full error message
        scheduledEventMessage.type === 'internal'
            ? RealTimeService.addScheduledEventInternalNote(
                  scheduledEventMessage
              )
            : RealTimeService.addScheduledEventInvestigationNote(
                  scheduledEventMessage,
                  projectId
              );

        return scheduledEventMessage;
    },
    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe, projectId: $TSFixMe) {
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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
    },
    findOneBy: async function({
        query,
        populate,
        select
    }: $TSFixMe) {
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let eventMessageQuery = ScheduledEventNoteModel.findOne(query).lean();

        eventMessageQuery = handleSelect(select, eventMessageQuery);
        eventMessageQuery = handlePopulate(populate, eventMessageQuery);
        const eventMessage = await eventMessageQuery;
        return eventMessage;
    },
    findBy: async function({
        query,
        limit,
        skip,
        populate,
        select
    }: $TSFixMe) {
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
    },
    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }
        const count = await ScheduledEventNoteModel.countDocuments(query);
        return count;
    },
    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe, projectId: $TSFixMe) {
        const data = {
            deleted: true,
            event_state: 'Deleted',
            deletedAt: Date.now(),
            deletedById: userId,
        };
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const deletedEventMessage = await this.updateOneBy(query, data);

        if (!deletedEventMessage) {
            const error = new Error(
                'Scheduled Event Note not found or does not exist'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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
    },
    hardDelete: async function(query: $TSFixMe) {
        await ScheduledEventNoteModel.deleteMany(query);
        return 'Scheduled Event Note(s) removed successfully!';
    },
};
