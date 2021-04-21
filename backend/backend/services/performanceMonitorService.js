const PerformanceMonitorModel = require('../models/performanceMonitor');
const ErrorService = require('./errorService');
const ComponentService = require('./componentService');
const generate = require('nanoid/generate');
const slugify = require('slugify');
// const RealTimeService = require('./realTimeService');
const NotificationService = require('./notificationService');
const uuid = require('uuid');

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
                ErrorService.log('performanceMonitorService.create', error);
                throw error;
            }
            // check if a performance monitor already exist with the same name for a particular component
            const existingPerformanceMonitor = await _this.findBy({
                name: data.name,
                componentId: data.componentId,
            });
            if (
                existingPerformanceMonitor &&
                existingPerformanceMonitor.length > 0
            ) {
                const error = new Error(
                    'Performance monitor with that name already exists.'
                );
                error.code = 400;
                ErrorService.log('performanceMonitorService.create', error);
                throw error;
            }

            data.key = uuid.v4();
            // handle the slug
            let name = data.name;
            name = slugify(name);
            name = `${name}-${generate('1234567890', 8)}`;
            data.slug = name.toLowerCase();

            let performanceMonitor = await PerformanceMonitorModel.create(data);
            performanceMonitor = await performanceMonitor
                .populate({
                    path: 'componentId',
                    select: 'name slug',
                    populate: {
                        path: 'projectId',
                        select: 'name slug',
                    },
                })
                .populate('createdById', 'name email')
                .execPopulate();
            return performanceMonitor;
        } catch (error) {
            ErrorService.log('performanceMonitorService.create', error);
            throw error;
        }
    },
    //Description: Gets all application logs by component.
    findBy: async function(query, limit, skip) {
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

            const performanceMonitor = await PerformanceMonitorModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate({
                    path: 'componentId',
                    select: 'name slug',
                    populate: {
                        path: 'projectId',
                        select: 'name slug',
                    },
                })
                .populate('createdById', 'name email');
            return performanceMonitor;
        } catch (error) {
            ErrorService.log('performanceMonitorService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;

            const performanceMonitor = await PerformanceMonitorModel.findOne(
                query
            )
                .populate({
                    path: 'componentId',
                    select: 'name slug',
                    populate: {
                        path: 'projectId',
                        select: 'name slug',
                    },
                })
                .populate('createdById', 'name email');
            return performanceMonitor;
        } catch (error) {
            ErrorService.log('performanceMonitorService.findOneBy', error);
            throw error;
        }
    },

    getPerformanceMonitorByComponentId: async function(
        componentId,
        limit,
        skip
    ) {
        const _this = this;
        // try to get the component by the ID
        const component = await ComponentService.findOneBy({
            _id: componentId,
        });
        // send an error if the component doesnt exist
        if (!component) {
            const error = new Error('Component does not exist.');
            error.code = 400;
            ErrorService.log(
                'performanceMonitorService.getPerformanceMonitorByComponentId',
                error
            );
            throw error;
        }

        try {
            if (typeof limit === 'string') limit = parseInt(limit);
            if (typeof skip === 'string') skip = parseInt(skip);

            const performanceMonitor = await _this.findBy(
                { componentId: componentId },
                limit,
                skip
            );
            return performanceMonitor;
        } catch (error) {
            ErrorService.log(
                'performanceMonitorService.getPerformanceMonitorByComponentId',
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

            const performanceMonitor = await PerformanceMonitorModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                        deletedById: userId,
                    },
                },
                { new: true }
            )
                .populate('deletedById', 'name')
                .populate({
                    path: 'componentId',
                    select: 'name slug',
                    populate: {
                        path: 'projectId',
                        select: 'name slug',
                    },
                });
            if (performanceMonitor) {
                await NotificationService.create(
                    performanceMonitor.componentId.projectId,
                    `The performance monitor ${performanceMonitor.name} was deleted from the component ${performanceMonitor.componentId.name} by ${performanceMonitor.deletedById.name}`,
                    performanceMonitor.deletedById._id,
                    'performanceMonitoraddremove'
                );
                // await RealTimeService.sendPerformanceMonitorDelete(
                //     performanceMonitor
                // );
                return performanceMonitor;
            } else {
                return null;
            }
        } catch (error) {
            ErrorService.log('performanceMonitorService.deleteBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data, unsetData = null) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;

            if (data && data.name) {
                let name = data.name;
                name = slugify(name);
                name = `${name}-${generate('1234567890', 8)}`;
                data.slug = name.toLowerCase();
            }
            let performanceMonitor = await PerformanceMonitorModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

            if (unsetData) {
                performanceMonitor = await PerformanceMonitorModel.findOneAndUpdate(
                    query,
                    { $unset: unsetData },
                    {
                        new: true,
                    }
                );
            }

            performanceMonitor = await this.findOneBy(query);

            // await RealTimeService.performanceMonitorKeyReset(
            //     performanceMonitor
            // );

            return performanceMonitor;
        } catch (error) {
            ErrorService.log('performanceMonitorService.updateOneBy', error);
            throw error;
        }
    },
    hardDeleteBy: async function(query) {
        try {
            await PerformanceMonitorModel.deleteMany(query);
            return 'Performance Monitor removed successfully!';
        } catch (error) {
            ErrorService.log('performanceMonitorService.hardDeleteBy', error);
            throw error;
        }
    },
    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;

            const count = await PerformanceMonitorModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('performanceMonitorService.countBy', error);
            throw error;
        }
    },
};
