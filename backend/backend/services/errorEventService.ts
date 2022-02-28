export default {
    create: async function(data: $TSFixMe) {
        // prepare error event model
        const errorEvent = new ErrorEventModel();

        // used this to sort java-sdk having a different stack trace structure
        data.exception.stackTraceFrame
            ? (data.exception.stacktrace = {
                  ...data.exception.stacktrace,
                  frames: data.exception.stackTraceFrame,
              })
            : null;

        errorEvent.content = data.exception;

        errorEvent.device = data.deviceDetails;

        errorEvent.tags = data.tags;

        errorEvent.type = data.type;

        errorEvent.sdk = data.sdk;

        errorEvent.fingerprintHash = data.fingerprintHash;

        errorEvent.fingerprint = data.fingerprint;

        // set error trackerid

        errorEvent.errorTrackerId = data.errorTrackerId;

        // set issueId

        errorEvent.issueId = data.issueId;

        // set timeline

        errorEvent.timeline = data.timeline;

        const savedErrorEvent = await errorEvent.save();

        return savedErrorEvent;
    },
    async findOneBy({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) delete query.deleted;
        let errorEventQuery = ErrorEventModel.findOne(query).lean();
        errorEventQuery = handleSelect(select, errorEventQuery);
        errorEventQuery = handlePopulate(populate, errorEventQuery);
        const result = await errorEventQuery;
        return result;
    },
    // get all error events that matches the specified query
    async findBy({ query, limit, skip, select, populate }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query.deleted) delete query.deleted;
        let errorEventsQuery = ErrorEventModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);
        errorEventsQuery = handleSelect(select, errorEventsQuery);
        errorEventsQuery = handlePopulate(populate, errorEventsQuery);
        const result = await errorEventsQuery;
        return result;
    },
    // get all error events that matches the specified query
    async findDistinct(query: $TSFixMe, limit: $TSFixMe, skip: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query.deleted) delete query.deleted;
        // get all unique hashes by error tracker Id

        const populateIssue = [
            { path: 'errorTrackerId', select: 'name' },
            { path: 'resolvedById', select: 'name' },
            { path: 'ignoredById', select: 'name' },
        ];

        const selectIssue =
            'name description errorTrackerId type fingerprint fingerprintHash createdAt deleted deletedAt deletedById resolved resolvedAt resolvedById ignored ignoredAt ignoredById';

        const populateIssueTimeline = [
            { path: 'issueId', select: 'name' },
            { path: 'createdById', select: 'name' },
        ];

        const selectIssueTimeline =
            'issueId createdById createdAt status deleted';

        const selectIssueMember =
            'issueId userId createdAt createdById removed removedAt removedById';

        const populateIssueMember = [
            { path: 'issueId', select: 'name' },

            { path: 'userId', select: 'name email' },
        ];

        const errorTrackerIssues = await IssueService.findBy({
            query,
            limit: 0, // set limit to 0 to get ALL issues related by query
            skip,
            select: selectIssue,
            populate: populateIssue,
        });

        const totalErrorEvents = [];
        let index = 0;

        // if the next index is available in the issue tracker, proceed
        while (
            errorTrackerIssues[index] &&
            totalErrorEvents.length < limit // the limit will be used here to fetch limited issues from the ALL issues fetched before
        ) {
            const issue = errorTrackerIssues[index];

            if (issue) {
                // set query with the current error tracker and issue ID
                const innerQuery = {
                    errorTrackerId: query.errorTrackerId,
                    issueId: issue._id,
                };
                // run a query to get the first and last error event that has current error tracker id and fingerprint hash
                const [
                    earliestErrorEvent,
                    latestErrorEvent,
                ] = await Promise.all([
                    ErrorEventModel.findOne(innerQuery).sort({
                        createdAt: 1,
                    }),
                    ErrorEventModel.findOne(innerQuery).sort({
                        createdAt: -1,
                    }),
                ]);
                // if we have an earliest and latest error event
                if (earliestErrorEvent && latestErrorEvent) {
                    const [
                        totalNumberOfEvents,
                        members,
                        timeline,
                    ] = await Promise.all([
                        // get total number of events for that issue
                        this.countBy(innerQuery),
                        // we get the memebrs attached to this issue
                        IssueMemberService.findBy({
                            query: { issueId: issue._id, removed: false },
                            select: selectIssueMember,
                            populate: populateIssueMember,
                        }),
                        // we get the timeline to attach to this issue
                        IssueTimelineService.findBy({
                            issueId: issue._id,
                            populate: populateIssueTimeline,
                            select: selectIssueTimeline,
                        }),
                    ]);

                    // fill in its biodata with the latest error event details
                    const errorEvent = {
                        _id: issue._id,
                        name: issue.name,
                        description: issue.description,
                        type: issue.type,
                        fingerprintHash: issue.fingerprintHash,
                        ignored: issue.ignored,
                        resolved: issue.resolved,
                        earliestOccurennce: earliestErrorEvent.createdAt,
                        earliestId: earliestErrorEvent._id,
                        latestOccurennce: latestErrorEvent.createdAt,
                        latestId: latestErrorEvent._id,
                        totalNumberOfEvents,
                        members,
                        timeline,
                    };
                    // add it to the list of error events
                    totalErrorEvents.push(errorEvent);
                }
            }
            // increment index
            index = index + 1;
        }
        // sort total error events by latest occurence date

        totalErrorEvents.sort((eventA, eventB) =>
            moment(eventB.latestOccurennce).isAfter(eventA.latestOccurennce)
        );
        let dateRange = { startDate: '', endDate: '' };
        // set the date time range
        if (query.createdAt) {
            dateRange = {
                startDate: query.createdAt.$gte,
                endDate: query.createdAt.$lte,
            };
        } else {
            totalErrorEvents.length > 0
                ? (dateRange = {
                      startDate:
                          totalErrorEvents[totalErrorEvents.length - 1]
                              .earliestOccurennce,
                      endDate: totalErrorEvents[0].latestOccurennce,
                  })
                : null;
            errorTrackerIssues.length > 0
                ? (dateRange = {
                      startDate:
                          errorTrackerIssues[errorTrackerIssues.length - 1]
                              .createdAt,
                      endDate:
                          totalErrorEvents.length > 0
                              ? totalErrorEvents[0].latestOccurennce
                              : errorTrackerIssues[0].createdAt,
                  })
                : null;
        }

        return {
            totalErrorEvents,
            dateRange,
            count: errorTrackerIssues.length,
        };
    },
    async findOneWithPrevAndNext(
        errorEventId: $TSFixMe,
        errorTrackerId: $TSFixMe
    ) {
        let previous, next;
        const selectErrorTracker =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt issueId';
        const populateErrorTracker = [
            { path: 'componentId', select: 'name' },
            { path: 'resourceCategory', select: 'name' },
            { path: 'issueId', select: 'name' },
        ];
        let errorEvent = await this.findOneBy({
            query: { _id: errorEventId, errorTrackerId: errorTrackerId },
            select: selectErrorTracker,
            populate: populateErrorTracker,
        });

        const populateIssueTimeline = [
            { path: 'issueId', select: 'name' },
            { path: 'createdById', select: 'name' },
        ];

        const selectIssueTimeline =
            'issueId createdById createdAt status deleted';

        // add issue timeline to this error event
        const issueTimeline = await IssueTimelineService.findBy({
            query: { issueId: errorEvent.issueId._id },
            select: selectIssueTimeline,
            populate: populateIssueTimeline,
        });

        errorEvent = JSON.parse(JSON.stringify(errorEvent));
        errorEvent.issueId.timeline = issueTimeline;

        const [
            previousErrorEvent,
            oldestErrorEvent,
            nextErrorEvent,
            latestErrorEvent,
        ] = await Promise.all([
            ErrorEventModel.find({
                _id: { $lt: errorEventId },
                errorTrackerId: errorEvent.errorTrackerId,
                issueId: errorEvent.issueId,
            })
                .sort({ _id: -1 })
                .limit(1),
            ErrorEventModel.find({
                _id: { $lt: errorEventId },
                errorTrackerId: errorEvent.errorTrackerId,
                issueId: errorEvent.issueId,
            })
                .sort({ _id: 1 })
                .limit(1),
            ErrorEventModel.find({
                _id: { $gt: errorEventId },
                errorTrackerId: errorEvent.errorTrackerId,
                issueId: errorEvent.issueId,
            })
                .sort({ _id: 1 })
                .limit(1),
            ErrorEventModel.find({
                _id: { $gt: errorEventId },
                errorTrackerId: errorEvent.errorTrackerId,
                issueId: errorEvent.issueId,
            })
                .sort({ _id: -1 })
                .limit(1),
        ]);

        if (previousErrorEvent.length > 0) {
            previous = {
                _id: previousErrorEvent[0]._id,
                createdAt: previousErrorEvent[0].createdAt,
            };
        }
        if (oldestErrorEvent.length > 0) {
            previous.oldest = oldestErrorEvent[0]._id;
        }
        if (nextErrorEvent.length > 0) {
            next = {
                _id: nextErrorEvent[0]._id,
                createdAt: nextErrorEvent[0].createdAt,
            };
        }
        if (latestErrorEvent.length > 0) {
            next.latest = latestErrorEvent[0]._id;
        }

        const totalEvents = await this.countBy({
            errorTrackerId: errorEvent.errorTrackerId,
            issueId: errorEvent.issueId,
        });

        return {
            previous: previous || null,
            errorEvent,
            next: next || null,
            totalEvents: totalEvents,
        };
    },
    async countBy(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        const count = await ErrorEventModel.countDocuments(query);

        return count;
    },
    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let errorEvent = await ErrorEventModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );
        const select =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';
        const populate = [
            { path: 'componentId', select: 'name' },
            { path: 'resourceCategory', select: 'name' },
        ];

        errorEvent = await this.findOneBy({ query, select, populate });

        return errorEvent;
    },
    updateBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const updateProcess = await ErrorEventModel.updateMany(query, {
            $set: data,
        });

        return updateProcess;
    },
};

import ErrorEventModel from '../models/errorEvent';
import IssueService from './issueService';
import IssueMemberService from './issueMemberService';
import IssueTimelineService from './issueTimelineService';
import moment from 'moment';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
