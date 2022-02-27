export default {
    //Description: Upsert function for component.
    //Params:
    //Param 1: data: ComponentModal.
    //Returns: promise with component model or error.
    create: async function(data: $TSFixMe) {
        const _this = this;

        const existingComponentCount = await _this.countBy({
            name: data.name,
            projectId: data.projectId,
        });

        if (existingComponentCount && existingComponentCount > 0) {
            const error = new Error('Component with that name already exists.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
                error.code = 400;
                throw error;
            }
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
            project = await ProjectService.findOneBy({
                query: { _id: project.parentProjectId },
                select: '_id stripePlanId seats',
            });
        }
        let subProjectIds = [];
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { parentProjectId: any;... Remove this comment to see the full error message
        const subProjects = await ProjectService.findBy({
            query: { parentProjectId: project._id },
            select: '_id',
        });
        if (subProjects && subProjects.length > 0) {
            subProjectIds = subProjects.map((project: $TSFixMe) => project._id);
        }
        subProjectIds.push(project._id);
        const count = await _this.countBy({
            projectId: { $in: subProjectIds },
        });
        let plan = Plans.getPlanById(project.stripePlanId);
        // null plan => enterprise plan
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ category: string; planId: string; type: st... Remove this comment to see the full error message
        plan = plan && plan.category ? plan : { category: 'Enterprise' };

        let projectSeats = project.seats;
        if (typeof projectSeats === 'string') {
            projectSeats = parseInt(projectSeats);
        }
        if (!plan && IS_SAAS_SERVICE) {
            const error = new Error('Invalid project plan.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        } else {
            const unlimitedComponent = ['Scale', 'Enterprise'];
            const componentCount =
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                plan.category === 'Startup'
                    ? 5
                    : // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    plan.category === 'Growth'
                    ? 10
                    : 0;

            if (
                count < projectSeats * componentCount ||
                !IS_SAAS_SERVICE ||
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                unlimitedComponent.includes(plan.category)
            ) {
                const component = new ComponentModel();
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Document<a... Remove this comment to see the full error message
                component.name = data.name;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdById' does not exist on type 'Doc... Remove this comment to see the full error message
                component.createdById = data.createdById;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'visibleOnStatusPage' does not exist on t... Remove this comment to see the full error message
                component.visibleOnStatusPage = data.visibleOnStatusPage;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Docum... Remove this comment to see the full error message
                component.projectId = data.projectId;
                if (data && data.name) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Document<a... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
                error.code = 400;
                throw error;
            }
        }
    },

    updateOneBy: async function(
        query: $TSFixMe,
        data: $TSFixMe,
        unsetData: $TSFixMe
    ) {
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

    updateBy: async function(query: $TSFixMe, data: $TSFixMe) {
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

    async findOneBy({ query, select, populate }: $TSFixMe) {
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

    async countBy(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await ComponentModel.countDocuments(query);
        return count;
    },

    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
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
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
            let project = await ProjectService.findOneBy({
                query: { _id: component.projectId },
                select: 'parentProjectId _id seats stripeSubscriptionId',
            });
            if (project.parentProjectId) {
                subProject = project;
                // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
                project = await ProjectService.findOneBy({
                    query: { _id: subProject.parentProjectId },
                    select: '_id seats stripeSubscriptionId',
                });
            }

            let subProjectIds = [];
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { parentProjectId: any;... Remove this comment to see the full error message
            const subProjects = await ProjectService.findBy({
                query: { parentProjectId: project._id },
                select: '_id',
            });
            if (subProjects && subProjects.length > 0) {
                subProjectIds = subProjects.map(
                    (project: $TSFixMe) => project._id
                );
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 4.
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

    async getComponentsBySubprojects(
        subProjectIds: $TSFixMe,
        limit: $TSFixMe,
        skip: $TSFixMe
    ) {
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
            subProjectIds.map(async (id: $TSFixMe) => {
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

    async getComponentsByPaginate(
        projectId: $TSFixMe,
        limit: $TSFixMe,
        skip: $TSFixMe
    ) {
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

    addSeat: async function(query: $TSFixMe) {
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: any; select: string; }'... Remove this comment to see the full error message
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

    hardDeleteBy: async function(query: $TSFixMe) {
        await ComponentModel.deleteMany(query);
        return 'Component(s) removed successfully!';
    },

    restoreBy: async function(query: $TSFixMe) {
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
                component.map(async (component: $TSFixMe) => {
                    const componentId = component._id;
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

import ComponentModel from '../models/component';
// import ComponentModel from '../models/component'
// import ProbeService from './probeService'
// import ComponentStatusService from './componentStatusService'
// import ComponentLogService from './componentLogService'
// import ComponentLogByHourService from './componentLogByHourService'
// import ComponentLogByDayService from './componentLogByDayService'
// import ComponentLogByWeekService from './componentLogByWeekService'
// import ComponentCategoryService from './componentCategoryService'
// import ComponentCriteriaService from './componentCriteriaService'
import Plans from '../config/plans';
import RealTimeService from './realTimeService';
import NotificationService from './notificationService';
import ProjectService from './projectService';
import PaymentService from './paymentService';
import MonitorService from './monitorService';
// import StatusPageService from './statusPageService'
// import ScheduleService from './scheduleService'
// import IntegrationService from './integrationService'
import TeamService from './teamService';
// import moment from 'moment'
// import _ from 'lodash'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../config/server"' has no exported member... Remove this comment to see the full error message
import { IS_SAAS_SERVICE } from '../config/server';
import getSlug from '../utils/getSlug';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
import errorService from 'common-server/utils/error';
