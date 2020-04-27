module.exports = {
    //Description: Upsert function for component.
    //Params:
    //Param 1: data: ComponentModal.
    //Returns: promise with component model or error.
    create: async function(data) {
        try {
            const _this = this;
            let subProject = null;
            const existingComponent = await _this.findBy({
                name: data.name,
                projectId: data.projectId,
            });
            if (existingComponent && existingComponent.length > 0) {
                const error = new Error(
                    'Component with that name already exists.'
                );
                error.code = 400;
                ErrorService.log('componentService.create', error);
                throw error;
            }
            let project = await ProjectService.findOneBy({
                _id: data.projectId,
            });
            if (project.parentProjectId) {
                subProject = project;
                project = await ProjectService.findOneBy({
                    _id: subProject.parentProjectId,
                });
            }
            let subProjectIds = [];
            const subProjects = await ProjectService.findBy({
                parentProjectId: project._id,
            });
            if (subProjects && subProjects.length > 0) {
                subProjectIds = subProjects.map(project => project._id);
            }
            subProjectIds.push(project._id);
            const count = await _this.countBy({
                projectId: { $in: subProjectIds },
            });
            const plan = await Plans.getPlanById(project.stripePlanId);
            let projectSeats = project.seats;
            if (typeof projectSeats === 'string') {
                projectSeats = parseInt(projectSeats);
            }
            if (!plan && IS_SAAS_SERVICE) {
                const error = new Error('Invalid project plan.');
                error.code = 400;
                ErrorService.log('componentService.create', error);
                throw error;
            } else {
                if (count < projectSeats * 5 || !IS_SAAS_SERVICE) {
                    let component = new ComponentModel();
                    component.name = data.name;
                    component.createdById = data.createdById;
                    component.visibleOnStatusPage = data.visibleOnStatusPage;
                    component.projectId = data.projectId;
                    const savedComponent = await component.save();
                    component = await _this.findOneBy({
                        _id: savedComponent._id,
                    });
                    return component;
                } else {
                    const error = new Error(
                        "You can't add any more components. Please add an extra seat to add more components."
                    );
                    error.code = 400;
                    ErrorService.log('componentService.create', error);
                    throw error;
                }
            }
        } catch (error) {
            ErrorService.log('componentService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data, unsetData) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
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
            component = await this.findOneBy(query);

            await RealTimeService.componentEdit(component);

            return component;
        } catch (error) {
            ErrorService.log('componentService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await ComponentModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('componentService.updateMany', error);
            throw error;
        }
    },

    //Description: Gets all components by project.
    //Params:
    //Param 1: data: ComponentModal.
    //Returns: promise with component model or error.
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
            const components = await ComponentModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate('componentCategoryId', 'name');
            return components;
        } catch (error) {
            ErrorService.log('componentService.findBy', error);
            throw error;
        }
    },

    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const component = await ComponentModel.findOne(query)
                .populate('projectId', 'name')
                .populate('componentCategoryId', 'name');
            return component;
        } catch (error) {
            ErrorService.log('componentService.findOneBy', error);
            throw error;
        }
    },

    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await ComponentModel.countDocuments(query).populate(
                'project',
                'name'
            );
            return count;
        } catch (error) {
            ErrorService.log('componentService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
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
                    _id: component.projectId,
                });
                if (project.parentProjectId) {
                    subProject = project;
                    project = await ProjectService.findOneBy({
                        _id: subProject.parentProjectId,
                    });
                }

                let subProjectIds = [];
                const subProjects = await ProjectService.findBy({
                    parentProjectId: project._id,
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
                    componentId: component._id,
                });

                await Promise.all(
                    monitors.map(async monitor => {
                        await MonitorService.deleteBy(
                            { _id: monitor._id },
                            userId
                        );
                    })
                );
                await NotificationService.create(
                    component.projectId,
                    `A Component ${component.name} was deleted from the project by ${component.deletedById.name}`,
                    component.deletedById._id,
                    'componentaddremove'
                );
                await RealTimeService.sendComponentDelete(component);

                return component;
            } else {
                return null;
            }
        } catch (error) {
            ErrorService.log('componentService.deleteBy', error);
            throw error;
        }
    },

    async getComponentsBySubprojects(subProjectIds, limit, skip) {
        try {
            if (typeof limit === 'string') limit = parseInt(limit);
            if (typeof skip === 'string') skip = parseInt(skip);
            const _this = this;

            const subProjectComponents = await Promise.all(
                subProjectIds.map(async id => {
                    const components = await _this.findBy(
                        { projectId: id },
                        limit,
                        skip
                    );
                    const count = await _this.countBy({ projectId: id });
                    return { components, count, _id: id, skip, limit };
                })
            );
            return subProjectComponents;
        } catch (error) {
            ErrorService.log(
                'componentService.getComponentsBySubprojects',
                error
            );
            throw error;
        }
    },

    addSeat: async function(query) {
        try {
            const project = await ProjectService.findOneBy(query);
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
            project.seats = projectSeats.toString();
            await ProjectService.saveProject(project);
            return 'A new seat added. Now you can add a component';
        } catch (error) {
            ErrorService.log('componentService.addSeat', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await ComponentModel.deleteMany(query);
            return 'Component(s) removed successfully!';
        } catch (error) {
            ErrorService.log('componentService.hardDeleteBy', error);
            throw error;
        }
    },

    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;
        let component = await _this.findBy(query);
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
                await MonitorService.restoreBy({ componentId, deleted: true });
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
const ErrorService = require('./errorService');
// const moment = require('moment');
// const _ = require('lodash');
const { IS_SAAS_SERVICE } = require('../config/server');
