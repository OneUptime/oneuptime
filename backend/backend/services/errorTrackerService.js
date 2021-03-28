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
            let name = data.name;
            name = slugify(name);
            name = `${name}-${generate('1234567890', 8)}`;
            errorTracker.slug = name.toLowerCase();
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
    // get all error trackers by component ID
    async getErrorTrackersByComponentId(componentId, limit, skip) {
        // try to get the component by the ID
        const component = await ComponentService.findOneBy({
            _id: componentId,
        });
        // send an error if the component doesnt exist
        if (!component) {
            const error = new Error('Component does not exist.');
            error.code = 400;
            ErrorService.log(
                'errorTrackerService.getApplicationLogsByComponentId',
                error
            );
            throw error;
        }

        try {
            if (typeof limit === 'string') limit = parseInt(limit);
            if (typeof skip === 'string') skip = parseInt(skip);
            const _this = this;

            const errorTrackers = await _this.findBy(
                { componentId: componentId },
                limit,
                skip
            );
            return errorTrackers;
        } catch (error) {
            ErrorService.log(
                'errorTrackerService.getErrorTrackersByComponentId',
                error
            );
            throw error;
        }
    },
    deleteBy: async function(query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const errorTracker = await ErrorTrackerModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                        deletedById: userId,
                    },
                },
                { new: true }
            ).populate('deletedById', 'name');
            if (errorTracker) {
                const component = ComponentService.findOneBy({
                    _id: errorTracker.componentId._id,
                });
                await NotificationService.create(
                    component.projectId,
                    `An Error Tracker ${errorTracker.name} was deleted from the component ${errorTracker.componentId.name} by ${errorTracker.deletedById.name}`,
                    errorTracker.deletedById._id,
                    'errorTrackeraddremove'
                );
                await RealTimeService.sendErrorTrackerDelete(errorTracker);
                return errorTracker;
            } else {
                return null;
            }
        } catch (error) {
            ErrorService.log('errorTrackerService.deleteBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data, unsetData = null) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            if (data.name) {
                let name = data.name;
                name = slugify(name);
                name = `${name}-${generate('1234567890', 8)}`;
                data.slug = name.toLowerCase();
            }
            let errorTracker = await ErrorTrackerModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

            if (unsetData) {
                errorTracker = await ErrorTrackerModel.findOneAndUpdate(
                    query,
                    { $unset: unsetData },
                    {
                        new: true,
                    }
                );
            }

            errorTracker = await this.findOneBy(query);

            await RealTimeService.errorTrackerKeyReset(errorTracker);

            return errorTracker;
        } catch (error) {
            ErrorService.log('errorTrackerService.updateOneBy', error);
            throw error;
        }
    },
};

const ErrorTrackerModel = require('../models/errorTracker');
const ErrorService = require('./errorService');
const ComponentService = require('./componentService');
const ResourceCategoryService = require('./resourceCategoryService');
const RealTimeService = require('./realTimeService');
const NotificationService = require('./notificationService');
const uuid = require('uuid');
const generate = require('nanoid/generate');
const slugify = require('slugify');
