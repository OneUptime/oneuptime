module.exports = {
    //Description: Upsert function for component.
    //Params:
    //Param 1: data: ComponentModal.
    //Returns: promise with component model or error.
    create: async function(data) {
        const _this = this;

        const existingComponentCount = await _this.countBy({
            name: data.name,
            projectId: data.projectId,
        });

        if (existingComponentCount && existingComponentCount > 0) {
            const error = new Error('Component with that name already exists.');
            error.code = 400;
            throw error;
        }
        let project = await ProjectService.findOneBy({
            query: { _id: data.projectId },
            select: 'parentProjectId _id stripePlanId seats',
        });
        if (project.parentProjectId) {
            const subProjectComponentsCount = await _this.countBy({
                name: data.name,
                projectId: project.parentProjectId,
            });
            if (subProjectComponentsCount && subProjectComponentsCount > 0) {
                const error = new Error(
                    'Component with that name already exists.'
                );
                error.code = 400;
                throw error;
            }
            project = await ProjectService.findOneBy({
                query: { _id: project.parentProjectId },
                select: '_id stripePlanId seats',
            });
        }
        let subProjectIds = [];
        const subProjects = await ProjectService.findBy({
            query: { parentProjectId: project._id },
            select: '_id',
        });
        if (subProjects && subProjects.length > 0) {
            subProjectIds = subProjects.map(project => project._id);
        }
        subProjectIds.push(project._id);
        const count = await _this.countBy({
            projectId: { $in: subProjectIds },
        });
        let plan = Plans.getPlanById(project.stripePlanId);
        // null plan => enterprise plan
        plan = plan && plan.category ? plan : { category: 'Enterprise' };

        let projectSeats = project.seats;
        if (typeof projectSeats === 'string') {
            projectSeats = parseInt(projectSeats);
        }
        if (!plan && IS_SAAS_SERVICE) {
            const error = new Error('Invalid project plan.');
            error.code = 400;
            throw error;
        } else {
            const unlimitedComponent = ['Scale', 'Enterprise'];
            const componentCount =
                plan.category === 'Startup'
                    ? 5
                    : plan.category === 'Growth'
                    ? 10
                    : 0;

            if (
                count < projectSeats * componentCount ||
                !IS_SAAS_SERVICE ||
                unlimitedComponent.includes(plan.category)
            ) {
                const component = new ComponentModel();
                component.name = data.name;
                component.createdById = data.createdById;
                component.visibleOnStatusPage = data.visibleOnStatusPage;
                component.projectId = data.projectId;
                if (data && data.name) {
                    component.slug = getSlug(data.name);
                }
                const savedComponent = await component.save();

                const populateComponent = [
                    { path: 'projectId', select: 'name' },
                    { path: 'componentCategoryId', select: 'name' },
                ];

                const selectComponent =
                    '_id createdAt name createdById projectId slug componentCategoryId';

                const populatedComponent = await _this.findOneBy({
                    query: { _id: savedComponent._id },
                    select: selectComponent,
                    populate: populateComponent,
                });

                return populatedComponent || savedComponent;
            } else {
                const error = new Error(
                    "You can't add any more components. Please add an extra seat to add more components."
                );
                error.code = 400;
                throw error;
            }
        }
    },

    updateOneBy: async function(query, data, unsetData) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        if (data && data.name) {
            data.slug = getSlug(data.name);
        }
        let component = await ComponentModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );
        if (unsetData) {
            component = await ComponentModel.findOneAndUpdate(
                query,
                { $unset: unsetData },
                {
                    new: true,
                }
            );
        }
        query.deleted = false;

        const populateComponent = [
            { path: 'projectId', select: 'name' },
            { path: 'componentCategoryId', select: 'name' },
        ];

        const selectComponent =
            '_id createdAt name createdById projectId slug componentCategoryId';
        component = await this.findOneBy({
            query,
            select: selectComponent,
            populate: populateComponent,
        });

        // run in the background
        RealTimeService.componentEdit(component);

        return component;
    },

    updateBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedData = await ComponentModel.updateMany(query, {
            $set: data,
        });
        const populateComponent = [
            { path: 'projectId', select: 'name' },
            { path: 'componentCategoryId', select: 'name' },
        ];

        const selectComponent =
            '_id createdAt name createdById projectId slug componentCategoryId';
        updatedData = await this.findBy({
            query,
            populate: populateComponent,
            select: selectComponent,
        });
        return updatedData;
    },

    //Description: Gets all components by project.
    //Params:
    //Param 1: data: ComponentModal.
    //Returns: promise with component model or error.
    async findBy({ query, limit, skip, select, populate }) {
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
        let componentsQuery = ComponentModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        componentsQuery = handleSelect(select, componentsQuery);
        componentsQuery = handlePopulate(populate, componentsQuery);

        const components = await componentsQuery;
        return components;
    },

    async findOneBy({ query, select, populate }) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let componentQuery = ComponentModel.findOne(query).lean();

        componentQuery = handleSelect(select, componentQuery);
        componentQuery = handlePopulate(populate, componentQuery);

        const component = await componentQuery;
        return component;
    },

    async countBy(query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await ComponentModel.countDocuments(query);
        return count;
    },

    deleteBy: async function(query, userId) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const component = await ComponentModel.findOneAndUpdate(
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

        if (component) {
            let subProject = null;
            let project = await ProjectService.findOneBy({
                query: { _id: component.projectId },
                select: 'parentProjectId _id seats stripeSubscriptionId',
            });
            if (project.parentProjectId) {
                subProject = project;
                project = await ProjectService.findOneBy({
                    query: { _id: subProject.parentProjectId },
                    select: '_id seats stripeSubscriptionId',
                });
            }

            let subProjectIds = [];
            const subProjects = await ProjectService.findBy({
                query: { parentProjectId: project._id },
                select: '_id',
            });
            if (subProjects && subProjects.length > 0) {
                subProjectIds = subProjects.map(project => project._id);
            }
            subProjectIds.push(project._id);
            const componentsCount = await this.countBy({
                projectId: { $in: subProjectIds },
            });
            let projectSeats = project.seats;
            if (typeof projectSeats === 'string') {
                projectSeats = parseInt(projectSeats);
            }
            const projectUsers = await TeamService.getTeamMembersBy({
                parentProjectId: project._id,
            }); // eslint-disable-next-line no-console
            const seats = await TeamService.getSeats(projectUsers);
            // check if project seats are more based on users in project or by count of components
            if (
                !IS_SAAS_SERVICE ||
                (projectSeats &&
                    projectSeats > seats &&
                    componentsCount > 0 &&
                    componentsCount <= (projectSeats - 1) * 5)
            ) {
                projectSeats = projectSeats - 1;
                if (IS_SAAS_SERVICE) {
                    await PaymentService.changeSeats(
                        project.stripeSubscriptionId,
                        projectSeats
                    );
                }
                await ProjectService.updateOneBy(
                    { _id: project._id },
                    { seats: projectSeats.toString() }
                );
            }
            const monitors = await MonitorService.findBy({
                query: { componentId: component._id },
                select: '_id',
            });

            for (const monitor of monitors) {
                await MonitorService.deleteBy({ _id: monitor._id }, userId);
            }
            NotificationService.create(
                component.projectId,
                `A Component ${component.name} was deleted from the project by ${component.deletedById.name}`,
                component.deletedById._id,
                'componentaddremove'
            ).catch(error => {
                errorService.log('NotificationService.create', error);
            });
            // run in the background
            RealTimeService.sendComponentDelete(component);

            return component;
        } else {
            return null;
        }
    },

    async getComponentsBySubprojects(subProjectIds, limit, skip) {
        if (typeof limit === 'string') limit = parseInt(limit);
        if (typeof skip === 'string') skip = parseInt(skip);
        const _this = this;

        const populateComponent = [
            { path: 'projectId', select: 'name' },
            { path: 'componentCategoryId', select: 'name' },
        ];

        const selectComponent =
            '_id createdAt name createdById projectId slug componentCategoryId';

        const subProjectComponents = await Promise.all(
            subProjectIds.map(async id => {
                const components = await _this.findBy({
                    query: { projectId: id },
                    limit,
                    skip,
                    populate: populateComponent,
                    select: selectComponent,
                });
                const count = await _this.countBy({ projectId: id });
                return { components, count, _id: id, skip, limit };
            })
        );
        return subProjectComponents;
    },

    async getComponentsByPaginate(projectId, limit, skip) {
        if (typeof limit === 'string') limit = parseInt(limit);
        if (typeof skip === 'string') skip = parseInt(skip);
        const _this = this;

        const populate = [
            { path: 'projectId', select: 'name' },
            { path: 'componentCategoryId', select: 'name' },
        ];

        const select =
            '_id createdAt name createdById projectId slug componentCategoryId';

        const [components, count] = await Promise.all([
            _this.findBy({
                query: { projectId },
                limit,
                skip,
                populate,
                select,
            }),
            _this.countBy({ projectId }),
        ]);
        return { components, count, _id: projectId, skip, limit };
    },

    addSeat: async function(query) {
        const project = await ProjectService.findOneBy({
            query,
            select: 'seats stripeSubscriptionId _id',
        });
        let projectSeats = project.seats;
        if (typeof projectSeats === 'string') {
            projectSeats = parseInt(projectSeats);
        }
        projectSeats = projectSeats + 1;
        if (IS_SAAS_SERVICE) {
            await PaymentService.changeSeats(
                project.stripeSubscriptionId,
                projectSeats
            );
        }
        await ProjectService.updateOneBy(
            { _id: project._id },
            { seats: String(projectSeats) }
        );
        return 'A new seat added. Now you can add a component';
    },

    hardDeleteBy: async function(query) {
        await ComponentModel.deleteMany(query);
        return 'Component(s) removed successfully!';
    },

    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;
        const populateComponent = [
            { path: 'projectId', select: 'name' },
            { path: 'componentCategoryId', select: 'name' },
        ];

        const selectComponent =
            '_id createdAt name createdById projectId slug componentCategoryId';
        let component = await _this.findBy({
            query,
            populate: populateComponent,
            select: selectComponent,
        });
        if (component && component.length > 1) {
            const components = await Promise.all(
                component.map(async component => {
                    const componentId = component._id;
                    component = await _this.updateOneBy(
                        { _id: componentId, deleted: true },
                        {
                            deleted: false,
                            deletedAt: null,
                            deleteBy: null,
                        }
                    );
                    await MonitorService.restoreBy({
                        componentId,
                        deleted: true,
                    });
                    return component;
                })
            );
            return components;
        } else {
            component = component[0];
            if (component) {
                const componentId = component._id;
                component = await _this.updateOneBy(
                    { _id: componentId, deleted: true },
                    {
                        deleted: false,
                        deletedAt: null,
                        deleteBy: null,
                    }
                );
                await MonitorService.restoreBy({
                    componentId,
                    deleted: true,
                });
            }
            return component;
        }
    },
};

const ComponentModel = require('../models/component');
// const ComponentModel = require('../models/component');
// const ProbeService = require('./probeService');
// const ComponentStatusService = require('./componentStatusService');
// const ComponentLogService = require('./componentLogService');
// const ComponentLogByHourService = require('./componentLogByHourService');
// const ComponentLogByDayService = require('./componentLogByDayService');
// const ComponentLogByWeekService = require('./componentLogByWeekService');
// const ComponentCategoryService = require('./componentCategoryService');
// const ComponentCriteriaService = require('./componentCriteriaService');
const Plans = require('../config/plans');
const RealTimeService = require('./realTimeService');
const NotificationService = require('./notificationService');
const ProjectService = require('./projectService');
const PaymentService = require('./paymentService');
const MonitorService = require('./monitorService');
// const StatusPageService = require('./statusPageService');
// const ScheduleService = require('./scheduleService');
// const IntegrationService = require('./integrationService');
const TeamService = require('./teamService');
// const moment = require('moment');
// const _ = require('lodash');
const { IS_SAAS_SERVICE } = require('../config/server');
const getSlug = require('../utils/getSlug');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
const errorService = require('common-server/utils/error');
