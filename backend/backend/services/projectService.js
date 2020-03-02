module.exports = {
    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;
            const projects = await ProjectModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('userId', 'name')
                .populate('parentProjectId', 'name');
            return projects;
        } catch (error) {
            ErrorService.log('projectService.findBy', error);
            throw error;
        }
    },

    create: async function(data) {
        try {
            const _this = this;
            const projectModel = new ProjectModel();
            if (data.parentProjectId) {
                const parentProject = await _this.findOneBy({
                    _id: data.parentProjectId,
                });
                projectModel.users = parentProject.users;
            } else {
                projectModel.users = [
                    {
                        userId: data.userId,
                        role: 'Owner',
                    },
                ];
            }
            projectModel.name = data.name || null;

            let name = data.name;
            name = slugify(name);
            name = `${name}-${generate('1234567890', 8)}`;
            projectModel.slug = name.toLowerCase();
            projectModel.apiKey = uuidv1();
            projectModel.stripePlanId = data.stripePlanId || null;
            projectModel.stripeSubscriptionId =
                data.stripeSubscriptionId || null;
            projectModel.parentProjectId = data.parentProjectId || null;
            projectModel.seats = '1';
            projectModel.isBlocked = data.isBlocked || false;
            projectModel.adminNotes = data.adminNotes || null;
            const project = await projectModel.save();
            return project;
        } catch (error) {
            ErrorService.log('projectService.create', error);
            throw error;
        }
    },

    countBy: async function(query) {
        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;

        const count = await ProjectModel.countDocuments(query);
        return count;
    },

    deleteBy: async function(query, userId) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const project = await ProjectModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedById: userId,
                        deletedAt: Date.now(),
                    },
                },
                {
                    new: true,
                }
            );
            if (project) {
                if (project.stripeSubscriptionId) {
                    await PaymentService.removeSubscription(
                        project.stripeSubscriptionId
                    );
                }

                const monitors = await MonitorService.findBy({
                    projectId: project._id,
                });
                await Promise.all(
                    monitors.map(async monitor => {
                        await MonitorService.deleteBy(
                            { _id: monitor._id },
                            userId
                        );
                    })
                );

                const schedules = await ScheduleService.findBy({
                    projectId: project._id,
                });
                await Promise.all(
                    schedules.map(async schedule => {
                        await ScheduleService.deleteBy({ _id: schedule._id });
                    })
                );

                const statusPages = await StatusPageService.findBy({
                    projectId: project._id,
                });
                await Promise.all(
                    statusPages.map(async statusPage => {
                        await StatusPageService.deleteBy({
                            _id: statusPage._id,
                        });
                    })
                );

                await integrationService.deleteBy(
                    { projectId: project._id },
                    userId
                );
            }
            return project;
        } catch (error) {
            ErrorService.log('projectService.deleteBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;
            const project = await ProjectModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('userId', 'name')
                .populate('parentProjectId', 'name');
            return project;
        } catch (error) {
            ErrorService.log('projectService.findOneBy', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            const _this = this;
            if (!query) {
                query = {};
            }
            const oldProject = await _this.findOneBy(
                Object.assign({}, query, { deleted: { $ne: null } })
            );
            if (!data.apiKey && !oldProject.apiKey) {
                data.apiKey = uuidv1();
            }

            if (data.name) {
                let name = data.name;
                name = slugify(name);
                name = `${name}-${generate('1234567890', 8)}`;
                data.slug = name.toLowerCase();
            }

            let updatedProject = await ProjectModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
            updatedProject = await _this.findOneBy(
                Object.assign({}, query, { deleted: { $ne: null } })
            );
            return updatedProject;
        } catch (error) {
            ErrorService.log('projectService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await ProjectModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('projectService.updateMany', error);
            throw error;
        }
    },

    updateAlertOptions: async function(data) {
        const projectId = data._id;
        const userId = data.userId;
        const project = await ProjectModel.findById(projectId).lean();
        const currentBalance = project.balance;
        const { minimumBalance, rechargeToBalance } = data.alertOptions;
        let updatedProject = {};

        if (!data.alertEnable) {
            updatedProject = await ProjectModel.findByIdAndUpdate(
                projectId,
                {
                    $set: {
                        alertEnable: false,
                    },
                },
                { new: true }
            );
            return updatedProject;
        }

        if (currentBalance >= minimumBalance) {
            // update settings, the current balance satisfies incoming project's alert settings
            updatedProject = await ProjectModel.findByIdAndUpdate(
                projectId,
                {
                    $set: {
                        alertEnable: data.alertEnable,
                        alertOptions: data.alertOptions,
                    },
                },
                { new: true }
            );
            return updatedProject;
        }
        const chargeForBalance = await StripeService.chargeCustomerForBalance(
            userId,
            rechargeToBalance,
            projectId,
            data.alertOptions
        );
        if (chargeForBalance) {
            const newBalance = rechargeToBalance + currentBalance;
            updatedProject = await ProjectModel.findByIdAndUpdate(
                projectId,
                {
                    $set: {
                        balance: newBalance,
                        alertEnable: data.alertEnable,
                        alertOptions: data.alertOptions,
                    },
                },
                { new: true }
            );
            return updatedProject;
        } else if (chargeForBalance && chargeForBalance.client_secret) {
            updatedProject = {
                ...project,
                paymentIntent: chargeForBalance.client_secret,
            };
            return updatedProject;
        } else {
            const error = new Error('Cannot save project settings');
            error.code = 403;
            ErrorService.log('projectService.updateAlertOptions', error);
            throw error;
        }
    },
    saveProject: async function(project) {
        try {
            project = await project.save();
            return project;
        } catch (error) {
            ErrorService.log('projectService.saveProject', error);
            throw error;
        }
    },

    getProjectIdsBy: async function(query) {
        try {
            const _this = this;
            const projects = await _this.findBy(query);
            const projectsId = [];

            for (let i = 0; i < projects.length; i++) {
                projectsId.push(projects[i]._id);
            }
            return projectsId;
        } catch (error) {
            ErrorService.log('projectService.getProjectIdsBy', error);
            throw error;
        }
    },

    resetApiKey: async function(projectId) {
        try {
            const _this = this;
            const apiKey = uuidv1();
            const project = await _this.updateOneBy(
                { _id: projectId },
                { apiKey: apiKey }
            );
            return project;
        } catch (error) {
            ErrorService.log('projectService.resetApiKey', error);
            throw error;
        }
    },

    changePlan: async function(projectId, planId) {
        try {
            const _this = this;
            let project = await _this.updateOneBy(
                { _id: projectId },
                { stripePlanId: planId }
            );

            if (!project.stripeSubscriptionId) {
                const error = new Error('You have not subscribed to a plan.');
                error.code = 400;
                ErrorService.log('projectService.changePlan', error);
                throw error;
            }
            const trialLeft = moment(new Date()).diff(
                moment(project.createdAt),
                'days'
            );
            const stripeSubscriptionId = await PaymentService.changePlan(
                project.stripeSubscriptionId,
                planId,
                project.users.length,
                trialLeft
            );

            project = await _this.updateOneBy(
                { _id: project._id },
                { stripeSubscriptionId: stripeSubscriptionId }
            );
            return project;
        } catch (error) {
            ErrorService.log('projectService.changePlan', error);
            throw error;
        }
    },

    exitProject: async function(projectId, userId, saveUserSeat) {
        try {
            const _this = this;
            let subProject = null;
            let project = await _this.findOneBy({
                _id: projectId,
                'users.userId': userId,
            });
            if (project.parentProjectId) {
                subProject = project;
                project = await _this.findOneBy({
                    _id: subProject.parentProjectId,
                });
            }
            if (project) {
                const users = subProject ? subProject.users : project.users;
                projectId = subProject ? subProject._id : project._id;
                const remainingUsers = [];
                for (const user of users) {
                    if (user.userId != userId) {
                        remainingUsers.push(user);
                    }
                }

                await _this.updateOneBy(
                    { _id: projectId },
                    { users: remainingUsers }
                );
                await EscalationService.removeEscalationMember(
                    projectId,
                    userId
                );
                const countUserInSubProjects = await _this.findBy({
                    parentProjectId: project._id,
                    'users.userId': userId,
                });

                if (!saveUserSeat) {
                    if (
                        countUserInSubProjects &&
                        countUserInSubProjects.length < 1
                    ) {
                        let count = 0;
                        const user_member = await UserService.findOneBy({
                            _id: userId,
                        });
                        domains.domains.forEach(async domain => {
                            if (user_member.email.indexOf(domain) > -1) {
                                count++;
                            }
                        });

                        let subProjectIds = [];
                        const subProjects = await _this.findBy({
                            parentProjectId: project._id,
                        });
                        if (subProjects && subProjects.length > 0) {
                            subProjectIds = subProjects.map(
                                project => project._id
                            );
                        }
                        subProjectIds.push(project._id);
                        const countMonitor = await MonitorService.countBy({
                            projectId: { $in: subProjectIds },
                        });
                        let projectSeats = project.seats;

                        if (typeof projectSeats === 'string') {
                            projectSeats = parseInt(projectSeats);
                        }
                        // check if project seat after reduction still caters for monitors.
                        if (
                            count < 1 &&
                            countMonitor <= (projectSeats - 1) * 5
                        ) {
                            projectSeats = projectSeats - 1;
                            await PaymentService.changeSeats(
                                project.stripeSubscriptionId,
                                projectSeats
                            );
                        }
                        await _this.updateOneBy(
                            { _id: project._id },
                            { seats: projectSeats.toString() }
                        );
                    }
                }
            }
            return 'User successfully exited the project';
        } catch (error) {
            ErrorService.log('projectService.exitProject', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await ProjectModel.deleteMany(query);
            return 'Project(s) Removed Successfully!';
        } catch (error) {
            ErrorService.log('projectService.hardDeleteBy', error);
            throw error;
        }
    },

    getAllProjects: async function(skip, limit) {
        const _this = this;
        let projects = await _this.findBy(
            { parentProjectId: null, deleted: { $ne: null } },
            limit,
            skip
        );

        projects = await Promise.all(
            projects.map(async project => {
                // get both sub-project users and project users
                let users = await TeamService.getTeamMembersBy({
                    parentProjectId: project._id,
                });
                if (users.length < 1) {
                    users = await TeamService.getTeamMembersBy({
                        _id: project._id,
                    });
                }
                const projectObj = Object.assign({}, project._doc, { users });
                return projectObj;
            })
        );
        return projects;
    },

    getUserProjects: async function(userId, skip, limit) {
        const _this = this;
        // find user subprojects and parent projects
        const userProjects = await _this.findBy({
            'users.userId': userId,
            deleted: { $ne: null },
        });
        let parentProjectIds = [];
        let projectIds = [];
        if (userProjects.length > 0) {
            const subProjects = userProjects
                .map(project => (project.parentProjectId ? project : null))
                .filter(subProject => subProject !== null);
            parentProjectIds = subProjects.map(
                subProject => subProject.parentProjectId._id
            );
            const projects = userProjects
                .map(project => (project.parentProjectId ? null : project))
                .filter(project => project !== null);
            projectIds = projects.map(project => project._id);
        }

        // query data
        const query = {
            $or: [
                { _id: { $in: parentProjectIds } },
                { _id: { $in: projectIds } },
            ],
            deleted: { $ne: null },
        };
        let projects = await _this.findBy(query, limit || 10, skip || 0);
        const count = await _this.countBy(query);

        // add project monitors
        projects = await Promise.all(
            projects.map(async project => {
                // get both sub-project users and project users
                let users = [];
                if (project.parentProjectId) {
                    users = await TeamService.getTeamMembersBy({
                        parentProjectId: project.parentProjectId,
                    });
                    project.users = users;
                } else {
                    users = await Promise.all(
                        project.users.map(async user => {
                            return await UserService.findOneBy({
                                _id: user.userId,
                                deleted: { $ne: null },
                            });
                        })
                    );
                    project.users = users;
                }
                return Object.assign({}, project._doc, { users });
            })
        );
        return { projects, count };
    },

    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;

        let project = await _this.findBy(query);
        if (project && project.length > 1) {
            const projects = await Promise.all(
                project.map(async project => {
                    const projectId = project._id;
                    let projectOwner = project.users.find(
                        user => user.role === 'Owner'
                    );
                    projectOwner = await UserService.findOneBy({
                        _id: projectOwner.userId,
                    });
                    const subscription = await PaymentService.subscribePlan(
                        project.stripePlanId,
                        projectOwner.stripeCustomerId
                    );
                    project = await _this.updateOneBy(
                        { _id: projectId },
                        {
                            deleted: false,
                            deletedBy: null,
                            deletedAt: null,
                            stripeSubscriptionId:
                                subscription.stripeSubscriptionId,
                        }
                    );
                    const projectSeats = project.seats;
                    await PaymentService.changeSeats(
                        project.stripeSubscriptionId,
                        projectSeats
                    );
                    await ScheduleService.restoreBy({
                        projectId,
                        deleted: true,
                    });
                    await StatusPageService.restoreBy({
                        projectId,
                        deleted: true,
                    });
                    await integrationService.restoreBy({
                        projectId,
                        deleted: true,
                    });
                    await MonitorService.restoreBy({
                        projectId,
                        deleted: true,
                    });
                    return project;
                })
            );
            return projects;
        } else {
            project = project[0];
            if (project) {
                const projectId = project._id;
                let projectOwner = project.users.find(
                    user => user.role === 'Owner'
                );
                projectOwner = await UserService.findOneBy({
                    _id: projectOwner.userId,
                });
                const subscription = await PaymentService.subscribePlan(
                    project.stripePlanId,
                    projectOwner.stripeCustomerId
                );
                project = await _this.updateOneBy(
                    { _id: projectId },
                    {
                        deleted: false,
                        deletedBy: null,
                        deletedAt: null,
                        stripeSubscriptionId: subscription.stripeSubscriptionId,
                    }
                );
                const projectSeats = project.seats;
                await PaymentService.changeSeats(
                    project.stripeSubscriptionId,
                    projectSeats
                );
                await integrationService.restoreBy({
                    projectId,
                    deleted: true,
                });
                await ScheduleService.restoreBy({ projectId, deleted: true });
                await StatusPageService.restoreBy({ projectId, deleted: true });
                await MonitorService.restoreBy({ projectId, deleted: true });
            }
            return project;
        }
    },

    addNotes: async function(projectId, notes) {
        const _this = this;
        const adminNotes = (
            await _this.updateOneBy(
                { _id: projectId },
                {
                    adminNotes: notes,
                }
            )
        ).adminNotes;
        return adminNotes;
    },

    searchProjects: async function(query, skip, limit) {
        const _this = this;
        let projects = await _this.findBy(query, limit, skip);

        projects = await Promise.all(
            projects.map(async project => {
                // get both sub-project users and project users
                let users = await TeamService.getTeamMembersBy({
                    parentProjectId: project._id,
                });
                if (users.length < 1) {
                    users = await TeamService.getTeamMembersBy({
                        _id: project._id,
                    });
                }
                const projectObj = Object.assign({}, project._doc, { users });
                return projectObj;
            })
        );
        return projects;
    },
};

const ProjectModel = require('../models/project');
const uuidv1 = require('uuid/v1');
const MonitorService = require('../services/monitorService');
const PaymentService = require('./paymentService');
const ErrorService = require('./errorService');
const UserService = require('./userService');
const integrationService = require('./integrationService');
const ScheduleService = require('./scheduleService');
const moment = require('moment');
const domains = require('../config/domains');
const EscalationService = require('./escalationService');
const StripeService = require('./stripeService');
const TeamService = require('./teamService');
const StatusPageService = require('./statusPageService');
const slugify = require('slugify');
const generate = require('nanoid/generate');
