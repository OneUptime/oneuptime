module.exports = {
    create: async function(data) {
        try {
            const _this = this;

            // prepare error event model
            let errorEvent = new ErrorEventModel();

            errorEvent.content = data.exception;
            errorEvent.device = data.deviceDetails;
            errorEvent.tags = data.tags;
            errorEvent.createdById = data.createdById;
            errorEvent.type = data.type;

            // generate hash from fingerprint
            const hash = sha256(data.fingerprint.join(''));
            errorEvent.fingerprintHash = hash;
            errorEvent.fingerprint = data.fingerprint;

            // set error trackerid
            errorEvent.errorTrackerId = data.errorTrackerId;

            // set timeline
            errorEvent.timeline = data.timeline;

            const savedErrorEvent = await errorEvent.save();
            errorEvent = await _this.findOneBy({
                _id: savedErrorEvent._id,
            });
            return errorEvent;
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

            if (!query.deleted) query.deleted = false;
            const errorEvent = await ErrorEventModel.findOne(query).populate(
                'errorTrackerId',
                'name'
            );
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

            if (!query.deleted) query.deleted = false;
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

            if (!query.deleted) query.deleted = false;
            // get all unique hashes
            const uniqueHashes = await this.getUniqueHashes();

            const totalErrorEvents = [];
            let index = skip; // set the skip as the starting index

            // if total unique error events length is less than limit and the next index is available in the hash, proceed
            while (totalErrorEvents.length < limit && uniqueHashes[index]) {
                const fingerprintHash = uniqueHashes[index];
                // update query with the current hash
                query.fingerprintHash = fingerprintHash._id;
                // run a query to get the first and last error event that has current error tracker id and fingerprint hash
                // todo update query to exclude resolved error events
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
                        name: latestErrorEvent.name,
                        earliestOccurennce: earliestErrorEvent.createdAt,
                        earliestId: earliestErrorEvent._id,
                        latestOccurennce: latestErrorEvent.createdAt,
                        latestId: latestErrorEvent._id,
                        totalNumberOfEvents,
                        content: {
                            type:
                                latestErrorEvent.content &&
                                latestErrorEvent.content.type,
                            message:
                                latestErrorEvent.content &&
                                latestErrorEvent.content.message,
                        },
                        type: latestErrorEvent.type,
                        fingerprintHash: fingerprintHash._id,
                    };
                    // add it to the list of error events
                    totalErrorEvents.push(errorEvent);
                }
                // increment index
                index = index + 1;
            }
            return totalErrorEvents;
        } catch (error) {
            ErrorService.log('errorEventService.findBy', error);
            throw error;
        }
    },
    async findOneWithPrevAndNext(errorEventId, errorTrackerId) {
        try {
            let previous, next;
            const errorEvent = await ErrorEventModel.findOne({
                _id: errorEventId,
                errorTrackerId: errorTrackerId,
            });
            const previousErrorEvent = await ErrorEventModel.find({
                _id: { $lt: errorEventId },
                errorTrackerId: errorEvent.errorTrackerId,
                fingerprintHash: errorEvent.fingerprintHash,
            })
                .sort({ _id: -1 })
                .limit(1);
            if (previousErrorEvent.length > 0) {
                previous = {
                    _id: previousErrorEvent[0]._id,
                    createdAt: previousErrorEvent[0].createdAt,
                };
            }

            const nextErrorEvent = await ErrorEventModel.find({
                _id: { $gt: errorEventId },
                errorTrackerId: errorEvent.errorTrackerId,
                fingerprintHash: errorEvent.fingerprintHash,
            })
                .sort({ _id: -1 })
                .limit(1);
            if (nextErrorEvent.length > 0) {
                next = {
                    _id: nextErrorEvent[0]._id,
                    createdAt: nextErrorEvent[0].createdAt,
                };
            }

            const totalEvents = await this.countBy({
                errorTrackerId: errorEvent.errorTrackerId,
                fingerprintHash: errorEvent.fingerprintHash,
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
};

const ErrorEventModel = require('../models/errorEvent');
const ErrorService = require('./errorService');
const sha256 = require('crypto-js/sha256');
