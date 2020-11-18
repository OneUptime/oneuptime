module.exports = {
    create: async function(data) {
        try {
            // prepare error event model
            const errorEvent = new ErrorEventModel();

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
        } catch (error) {
            ErrorService.log('errorEventService.create', error);
            throw error;
        }
    },
    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) delete query.deleted;
            const errorEvent = await ErrorEventModel.findOne(query)
                .populate('errorTrackerId', 'name')
                .populate('resolvedById', 'name')
                .populate('ignoredById', 'name');
            return errorEvent;
        } catch (error) {
            ErrorService.log('errorEventService.findOneBy', error);
            throw error;
        }
    },
    // get all error events that matches the specified query
    async findBy(query, limit, skip) {
        try {
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
            const errorEvents = await ErrorEventModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('errorTrackerId', 'name');
            return errorEvents;
        } catch (error) {
            ErrorService.log('errorEventService.findBy', error);
            throw error;
        }
    },
    // get all error events that matches the specified query
    async findDistinct(query, limit, skip) {
        try {
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
            const uniqueHashes = await this.getTotalUniqueHashesForErrorTracker(
                query.errorTrackerId
            );

            const totalErrorEvents = [];
            let index = skip; // set the skip as the starting index

            // if total unique error events length is less than limit and the next index is available in the hash, proceed
            while (totalErrorEvents.length < limit && uniqueHashes[index]) {
                const fingerprintHash = uniqueHashes[index];

                const issue = await IssueService.findOneBy({ fingerprintHash });

                if (issue) {
                    // update query with the current hash
                    query.issueId = issue._id;
                    // run a query to get the first and last error event that has current error tracker id and fingerprint hash
                    const earliestErrorEvent = await ErrorEventModel.findOne(
                        query
                    ).sort({ createdAt: 1 });
                    const latestErrorEvent = await ErrorEventModel.findOne(
                        query
                    ).sort({ createdAt: -1 });
                    // if we have an earliest and latest error event
                    if (earliestErrorEvent && latestErrorEvent) {
                        // get total number of events for that hash
                        const totalNumberOfEvents = await this.countBy(query);
                        // fill in its biodata with the latest error event details
                        const errorEvent = {
                            name: issue.name,
                            description: issue.description,
                            type: issue.type,
                            fingerprintHash: issue.fingerprintHash,
                            ignored: issue.ignored,
                            earliestOccurennce: earliestErrorEvent.createdAt,
                            earliestId: earliestErrorEvent._id,
                            latestOccurennce: latestErrorEvent.createdAt,
                            latestId: latestErrorEvent._id,
                            totalNumberOfEvents,
                        };
                        // add it to the list of error events
                        totalErrorEvents.push(errorEvent);
                    }
                }
                // increment index
                index = index + 1;
            }
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
            }

            return { totalErrorEvents, dateRange, count: uniqueHashes.length };
        } catch (error) {
            ErrorService.log('errorEventService.findBy', error);
            throw error;
        }
    },
    async findOneWithPrevAndNext(errorEventId, errorTrackerId) {
        try {
            let previous, next;
            const errorEvent = await this.findOneBy({
                _id: errorEventId,
                errorTrackerId: errorTrackerId,
            });
            const previousErrorEvent = await ErrorEventModel.find({
                _id: { $lt: errorEventId },
                errorTrackerId: errorEvent.errorTrackerId,
                issueId: errorEvent.issueId,
            })
                .sort({ _id: -1 })
                .limit(1);
            if (previousErrorEvent.length > 0) {
                previous = {
                    _id: previousErrorEvent[0]._id,
                    createdAt: previousErrorEvent[0].createdAt,
                };
            }
            const oldestErrorEvent = await ErrorEventModel.find({
                _id: { $lt: errorEventId },
                errorTrackerId: errorEvent.errorTrackerId,
                issueId: errorEvent.issueId,
            })
                .sort({ _id: 1 })
                .limit(1);
            if (oldestErrorEvent.length > 0) {
                previous.oldest = oldestErrorEvent[0]._id;
            }

            const nextErrorEvent = await ErrorEventModel.find({
                _id: { $gt: errorEventId },
                errorTrackerId: errorEvent.errorTrackerId,
                issueId: errorEvent.issueId,
            })
                .sort({ _id: 1 })
                .limit(1);
            if (nextErrorEvent.length > 0) {
                next = {
                    _id: nextErrorEvent[0]._id,
                    createdAt: nextErrorEvent[0].createdAt,
                };
            }
            const latestErrorEvent = await ErrorEventModel.find({
                _id: { $gt: errorEventId },
                errorTrackerId: errorEvent.errorTrackerId,
                issueId: errorEvent.issueId,
            })
                .sort({ _id: -1 })
                .limit(1);
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
        } catch (error) {
            ErrorService.log('errorEventService.findOneWithPrevAndNext', error);
            throw error;
        }
    },
    async getUniqueHashes() {
        try {
            const uniqueHashes = await ErrorEventModel.aggregate([
                {
                    $group: {
                        _id: '$fingerprintHash',
                    },
                },
            ]);
            return uniqueHashes;
        } catch (error) {
            ErrorService.log('errorEventService.uniqueHashes', error);
            throw error;
        }
    },
    async getTotalUniqueHashesForErrorTracker(errorTrackerId) {
        try {
            const uniqueHashes = await ErrorEventModel.distinct(
                'fingerprintHash',
                { errorTrackerId }
            );
            return uniqueHashes;
        } catch (error) {
            ErrorService.log(
                'errorEventService.getTotalUniqueHashesForErrorTracker',
                error
            );
            throw error;
        }
    },
    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            const count = await ErrorEventModel.countDocuments(query);

            return count;
        } catch (error) {
            ErrorService.log('errorEventService.countBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        try {
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

            errorEvent = await this.findOneBy(query);

            return errorEvent;
        } catch (error) {
            ErrorService.log('errorTrackerService.updateOneBy', error);
            throw error;
        }
    },
    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const updateProcess = await ErrorEventModel.updateMany(query, {
                $set: data,
            });

            return updateProcess;
        } catch (error) {
            ErrorService.log('errorTrackerService.updateBy', error);
            throw error;
        }
    },
};

const ErrorEventModel = require('../models/errorEvent');
const ErrorService = require('./errorService');
const IssueService = require('./issueService');
