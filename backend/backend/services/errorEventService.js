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
};

const ErrorEventModel = require('../models/errorEvent');
const ErrorService = require('./errorService');
const sha256 = require('crypto-js/sha256');
