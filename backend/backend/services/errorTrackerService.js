module.exports = {
    create: async function(data) {
        try {
            const _this = this;
            // try to get the component by the ID
            const component = await ComponentService.findOneBy({
                _id: data.componentId,
            });
            // send an error if the component doesnt exist
            if (!component) {
                const error = new Error('Component does not exist.');
                error.code = 400;
                ErrorService.log('errorTrackerService.create', error);
                throw error;
            }
            // try to find in the application log if the name already exist for that component
            const existingErrorTracker = await _this.findBy({
                name: data.name,
                componentId: data.componentId,
            });
            if (existingErrorTracker && existingErrorTracker.length > 0) {
                const error = new Error(
                    'Error Tracker with that name already exists.'
                );
                error.code = 400;
                ErrorService.log('errorTrackerService.create', error);
                throw error;
            }
            const resourceCategory = await ResourceCategoryService.findBy({
                _id: data.resourceCategory,
            });
            // prepare error tracker model
            let errorTracker = new ErrorTrackerModel();
            errorTracker.name = data.name;
            errorTracker.key = uuid.v4(); // generate random string here
            errorTracker.componentId = data.componentId;
            errorTracker.createdById = data.createdById;
            if (resourceCategory) {
                errorTracker.resourceCategory = data.resourceCategory;
            }
            const savedErrorTracker = await errorTracker.save();
            errorTracker = await _this.findOneBy({
                _id: savedErrorTracker._id,
            });
            return errorTracker;
        } catch (error) {
            ErrorService.log('errorTrackerService.create', error);
            throw error;
        }
    },
    // find a list of error trackers
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
            const errorTrackers = await ErrorTrackerModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('componentId', 'name')
                .populate('resourceCategory', 'name');
            return errorTrackers;
        } catch (error) {
            ErrorService.log('errorTrackerService.findBy', error);
            throw error;
        }
    },
    // find a particular error tracker
    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const errorTracker = await ErrorTrackerModel.findOne(query)
                .populate('componentId', 'name')
                .populate('resourceCategory', 'name');
            return errorTracker;
        } catch (error) {
            ErrorService.log('errorTrackerService.findOneBy', error);
            throw error;
        }
    },
};

const ErrorTrackerModel = require('../models/errorTracker');
const ErrorService = require('./errorService');
const ComponentService = require('./componentService');
const ResourceCategoryService = require('./resourceCategoryService');
const uuid = require('uuid');
