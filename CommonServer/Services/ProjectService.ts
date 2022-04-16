import ProjectModel from '../Models/project';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { v1 as uuidv1 } from 'uuid';
import MonitorService from './MonitorService';
import PaymentService from './PaymentService';
import UserService from './UserService';
import IncidentPrioritiesService from './IncidentPrioritiesService';
import integrationService from './IntegrationService';
import ScheduleService from './ScheduleService';
import domains from '../config/domains'; // Removal of 'moment' due to declaration but not used.
import EscalationService from './EscalationService';
import StripeService from './StripeService';
import TeamService from './TeamService';
import StatusPageService from './StatusPageService';
import { IS_SAAS_SERVICE } from '../config/server';
import componentService from './ComponentService';
import DomainVerificationService from './DomainVerificationService';
import SsoDefaultRolesService from './SsoDefaultRolesService';
import getSlug from '../Utils/getSlug';
import flattenArray from '../Utils/flattenArray';
import IncidentSettingsService from './IncidentSettingsService';

export default class Service {
    public async create(data: $TSFixMe): void {
        const projectModel: $TSFixMe = new ProjectModel();
        const adminUser: $TSFixMe = await UserService.findOneBy({
            query: { role: 'master-admin' },
            select: '_id',
        });
        if (data.parentProjectId) {
            const parentProject: $TSFixMe = await this.findOneBy({
                query: { _id: data.parentProjectId },
                select: 'users',
            });

            projectModel.users = parentProject.users.map((user: $TSFixMe) => {
                return {
                    ...user,
                    show: false,
                };
            });
        } else if (
            adminUser?._id &&
            data.userId.toString() !== adminUser._id.toString()
        ) {
            projectModel.users = [
                {
                    userId: data.userId,
                    role: 'Owner',
                },
                {
                    userId: adminUser._id,
                    role: 'Administrator',
                    show: false,
                },
            ];
        } else {
            projectModel.users = [
                {
                    userId: data.userId,
                    role: 'Owner',
                },
            ];
        }

        projectModel.name = data.name || null;
        if (data && data.name) {
            projectModel.slug = getSlug(data.name);
        }

        projectModel.apiKey = uuidv1();

        projectModel.stripePlanId = data.stripePlanId || null;

        projectModel.stripeSubscriptionId = data.stripeSubscriptionId || null;

        projectModel.parentProjectId = data.parentProjectId || null;

        projectModel.seats = '1';

        projectModel.isBlocked = data.isBlocked || false;

        projectModel.adminNotes = data.adminNotes || null;
        const project: $TSFixMe = await projectModel.save();

        const prioritiesData: $TSFixMe = {
            high: {
                projectId: project._id,
                name: 'High',
                color: {
                    r: 255,
                    g: 0,
                    b: 0,
                    a: 1,
                },
            },
            low: {
                projectId: project._id,
                name: 'Low',
                color: {
                    r: 255,
                    g: 211,
                    b: 0,
                    a: 1,
                },
            },
        };
        const [priority]: $TSFixMe = await Promise.all([
            IncidentPrioritiesService.create(prioritiesData.high),
            IncidentPrioritiesService.create(prioritiesData.low),
        ]);
        // Create initial default incident template
        await IncidentSettingsService.create({
            name: 'Default',
            projectId: project._id,
            isDefault: true,
            incidentPriority: priority._id,
            title: '{{monitorName}} is {{incidentType}}.',
            description:
                '{{monitorName}} is {{incidentType}}. This incident is currently being investigated by our team and more information will be added soon.',
        });
        return project;
    }

    public async deleteBy(query, userId, cancelSub = true): void {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        let project: $TSFixMe = await ProjectModel.findOne(query);
        if (project) {
            if (project.stripeSubscriptionId && cancelSub) {
                await PaymentService.removeSubscription(
                    project.stripeSubscriptionId
                );
            }
            const populateSchedule: $TSFixMe = [
                { path: 'userIds', select: 'name' },
                { path: 'createdById', select: 'name' },
                { path: 'monitorIds', select: 'name' },
                {
                    path: 'projectId',
                    select: '_id name slug',
                },
                {
                    path: 'escalationIds',
                    select: 'teams',
                    populate: {
                        path: 'teams.teamMembers.userId',
                        select: 'name email',
                    },
                },
            ];

            const selectSchedule: $TSFixMe =
                '_id name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';

            const populateComponent: $TSFixMe = [
                { path: 'projectId', select: 'name' },
                { path: 'componentCategoryId', select: 'name' },
            ];

            const selectComponent: $TSFixMe =
                '_id createdAt name createdById projectId slug componentCategoryId';

            const populateStatusPage: $TSFixMe = [
                {
                    path: 'projectId',
                    select: 'name parentProjectId',
                    populate: { path: 'parentProjectId', select: '_id' },
                },
                {
                    path: 'domains.domainVerificationToken',
                    select: 'domain verificationToken verified ',
                },
                {
                    path: 'monitors.monitor',
                    select: 'name',
                },
            ];

            const selectStatusPage: $TSFixMe =
                '_id projectId domains monitors links twitterHandle slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme';

            const populateDefaultRoleSso: $TSFixMe = [
                { path: 'domain', select: '_id domain' },
                { path: 'project', select: '_id name' },
            ];

            const selectDefaultRoleSso: $TSFixMe =
                '_id domain project role createdAt deleted deletedAt deletedById';
            const [
                monitors,
                schedules,
                domains,
                statusPages,
                components,
                ssoDefaultRoles,
            ] = await Promise.all([
                MonitorService.findBy({
                    query: { projectId: project._id },
                    select: '_id',
                }),
                ScheduleService.findBy({
                    query: { projectId: project._id },
                    select: selectSchedule,
                    populate: populateSchedule,
                }),
                DomainVerificationService.findBy({
                    query: { projectId: project._id },
                    select: '_id',
                }),
                StatusPageService.findBy({
                    query: { projectId: project._id },
                    select: selectStatusPage,
                    populate: populateStatusPage,
                }),
                componentService.findBy({
                    query: { projectId: project._id },
                    select: selectComponent,
                    populate: populateComponent,
                }),
                SsoDefaultRolesService.findBy({
                    query: { project: project._id },
                    select: selectDefaultRoleSso,
                    populate: populateDefaultRoleSso,
                }),
                integrationService.deleteBy({ projectId: project._id }, userId),
            ]);

            await Promise.all(
                monitors.map(async (monitor: $TSFixMe) => {
                    await MonitorService.deleteBy({ _id: monitor._id }, userId);
                })
            );

            await Promise.all(
                schedules.map(async (schedule: $TSFixMe) => {
                    await ScheduleService.deleteBy({ _id: schedule._id });
                })
            );

            for (const domain of domains) {
                await DomainVerificationService.deleteBy({
                    _id: domain._id,
                });
            }

            await Promise.all(
                statusPages.map(async (statusPage: $TSFixMe) => {
                    await StatusPageService.deleteBy({
                        _id: statusPage._id,
                    });
                })
            );

            await Promise.all(
                components.map(async (component: $TSFixMe) => {
                    await componentService.deleteBy(
                        { _id: component._id },
                        userId
                    );
                })
            );

            for (const ssoDefaultRole of ssoDefaultRoles) {
                const { _id }: $TSFixMe = ssoDefaultRole;
                await SsoDefaultRolesService.deleteBy({ _id });
            }

            project = await ProjectModel.findOneAndUpdate(
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
        }
        return project;
    }

    public async updateAlertOptions(data: $TSFixMe): void {
        const projectId: $TSFixMe = data._id;
        const userId: $TSFixMe = data.userId;
        const project: $TSFixMe = await ProjectModel.findById(projectId).lean();
        const currentBalance: $TSFixMe = project.balance;
        const { minimumBalance, rechargeToBalance }: $TSFixMe =
            data.alertOptions;
        let updatedProject: $TSFixMe = {};

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
            // Update settings, the current balance satisfies incoming project's alert settings
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
        const chargeForBalance: $TSFixMe =
            await StripeService.chargeCustomerForBalance(
                userId,
                rechargeToBalance,
                projectId,
                data.alertOptions
            );
        if (chargeForBalance) {
            const newBalance: $TSFixMe = rechargeToBalance + currentBalance;
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
            if (chargeForBalance.client_secret) {
                updatedProject.paymentIntent = chargeForBalance.client_secret;
            }
            return updatedProject;
        }
        const error: $TSFixMe = new Error('Cannot save project settings');

        error.code = 403;
        throw error;
    }

    public async getProjectIdsBy(query: $TSFixMe): void {
        const projects: $TSFixMe = await this.findBy({ query, select: '_id' });
        const projectsId: $TSFixMe = [];

        for (let i: $TSFixMe = 0; i < projects.length; i++) {
            projectsId.push(projects[i]._id);
        }
        return projectsId;
    }

    public async getBalance(query: $TSFixMe): void {
        const project: $TSFixMe = await ProjectModel.findOne(query).select(
            'balance'
        );
        return project;
    }

    public async resetApiKey(projectId: $TSFixMe): void {
        const apiKey: $TSFixMe = uuidv1();
        const project: $TSFixMe = await this.updateOneBy(
            { _id: projectId },
            { apiKey: apiKey }
        );
        return project;
    }

    public async upgradeToEnterprise(projectId: $TSFixMe): void {
        const data: $TSFixMe = {
            stripePlanId: 'enterprise',
            stripeSubscriptionId: null,
        };

        const project: $TSFixMe = await this.findOneBy({
            query: { _id: projectId },
            select: 'stripeSubscriptionId',
        });
        if (data.stripeSubscriptionId !== null) {
            await PaymentService.removeSubscription(
                project.stripeSubscriptionId
            );
        }
        const updatedProject: $TSFixMe = await this.updateOneBy(
            { _id: projectId },
            data
        );
        return updatedProject;
    }

    public async changePlan(projectId, userId, planId): void {
        let project: $TSFixMe = await this.updateOneBy(
            { _id: projectId },
            { stripePlanId: planId }
        );

        if (!project.stripeSubscriptionId) {
            /*
             * On enterprise plan stripeSubscriptionId is null
             * Downgrading from enterprise plan
             */
            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: userId },
                select: 'stripeCustomerId',
            });

            const { stripeSubscriptionId }: $TSFixMe =
                await PaymentService.subscribePlan(
                    planId,
                    user.stripeCustomerId
                );

            project = await this.updateOneBy(
                { _id: project._id },
                { stripeSubscriptionId: stripeSubscriptionId }
            );
            return project;
        }
        const stripeSubscriptionId: $TSFixMe = await PaymentService.changePlan(
            project.stripeSubscriptionId,
            planId,
            project.users.length
        );

        project = await this.updateOneBy(
            { _id: project._id },
            { stripeSubscriptionId: stripeSubscriptionId }
        );
        return project;
    }

    public async findsubProjectId(projectId: $TSFixMe): void {
        const subProject: $TSFixMe = await this.findBy({
            query: { parentProjectId: projectId },
            select: '_id',
        });

        const subProjectId: $TSFixMe = subProject.map((sub: $TSFixMe) => {
            return String(sub._id);
        });
        const projectIdArr: $TSFixMe = [projectId, ...subProjectId];
        return projectIdArr;
    }

    public async getUniqueMembersIndividualProject({
        isFlatenArr,
        members,
    }): void {
        let result: $TSFixMe = [];
        if (!isFlatenArr) {
            for (const member of members) {
                const track: $TSFixMe = {},
                    data: $TSFixMe = [];
                for (const user of member) {
                    if (!track[user.userId]) {
                        track[user.userId] = user.userId;
                        data.push(user);
                    }
                }

                result = [...result, data];
            }
        } else {
            const track: $TSFixMe = {};
            for (const member of members) {
                if (!track[member.userId]) {
                    track[member.userId] = member.userId;
                    result.push(member);
                }
            }
        }
        return result;
    }

    public async exitProject(
        projectId,
        userId,
        deletedById,
        saveUserSeat
    ): void {
        const returnVal: string = 'User successfully exited the project';
        let teamMember: $TSFixMe = {};

        const userProject: $TSFixMe = await this.findOneBy({
            query: { _id: projectId },
            select: 'users',
        });
        teamMember = userProject.users.find((user: $TSFixMe) => {
            return String(user.userId) === String(userId);
        });
        let subProject: $TSFixMe = null;
        let subProjects: $TSFixMe = null;

        let project: $TSFixMe = await this.findOneBy({
            query: { _id: projectId, 'users.userId': userId },
            select: 'parentProjectId users _id seats stripeSubscriptionId',
        });
        if (project?.parentProjectId) {
            subProject = project;

            project = await this.findOneBy({
                query: { _id: subProject.parentProjectId },
                select: '_id users seats stripeSubscriptionId',
            });
        }

        subProjects = await this.findBy({
            query: { parentProjectId: project?._id },
            select: 'users _id seats',
        });
        const allMembers: $TSFixMe = subProjects.concat(project);

        let subMembers: $TSFixMe = subProjects.map((user: $TSFixMe) => {
            return user.users;
        });
        subMembers = await this.getUniqueMembersIndividualProject({
            members: subMembers,
            isFlatenArr: false,
        });
        const projectMembers: $TSFixMe =
            await this.getUniqueMembersIndividualProject({
                members: project?.users || [],
                isFlatenArr: true,
            });
        const flatSubMembers: $TSFixMe = flattenArray(subMembers);
        const teams: $TSFixMe = flatSubMembers.concat(projectMembers);
        const filteredTeam: $TSFixMe = teams.filter((user: $TSFixMe) => {
            return (
                String(user.userId) === String(userId) &&
                String(user._id) !== String(teamMember?._id)
            );
        });
        const teamByUserId: $TSFixMe = teams.filter((user: $TSFixMe) => {
            return String(user.userId) === String(userId);
        });
        const isViewer: $TSFixMe = filteredTeam.every((data: $TSFixMe) => {
            return data.role === 'Viewer';
        });
        if (project) {
            const users: $TSFixMe = subProject
                ? subProject.users
                : project.users;
            projectId = subProject ? subProject._id : project._id;
            const remainingUsers: $TSFixMe = [];
            for (const user of users) {
                if (user.userId !== userId) {
                    remainingUsers.push(user);
                }
            }
            await Promise.all([
                this.updateOneBy({ _id: projectId }, { users: remainingUsers }),
                EscalationService.deleteEscalationMember(
                    projectId,
                    userId,
                    deletedById
                ),
            ]);

            const countUserInSubProjects: $TSFixMe = await this.findBy({
                query: {
                    parentProjectId: project._id,
                    'users.userId': userId,
                },
                select: '_id',
            });
            if (!saveUserSeat) {
                let projectSeats: $TSFixMe = project.seats;
                if (typeof projectSeats === 'string') {
                    projectSeats = parseInt(projectSeats);
                }
                if (
                    countUserInSubProjects &&
                    countUserInSubProjects.length < 1
                ) {
                    let count: $TSFixMe = 0;
                    const user_member: $TSFixMe = await UserService.findOneBy({
                        query: { _id: userId },
                        select: 'email',
                    });
                    domains.domains.forEach(async (domain: $TSFixMe) => {
                        if (user_member.email.indexOf(domain) > -1) {
                            count++;
                        }
                    });
                    let subProjectIds: $TSFixMe = [];
                    if (subProjects && subProjects.length > 0) {
                        subProjectIds = subProjects.map((project: $TSFixMe) => {
                            return project._id;
                        });
                    }
                    subProjectIds.push(project._id);
                    const countMonitor: $TSFixMe = await MonitorService.countBy(
                        {
                            projectId: { $in: subProjectIds },
                        }
                    );
                    // Check if project seat after reduction still caters for monitors.
                    if (
                        !IS_SAAS_SERVICE ||
                        (count < 1 && countMonitor <= (projectSeats - 1) * 5)
                    ) {
                        // Check if project seat after reduction still caters for monitors.
                    }
                }
                const confirmParentProject: $TSFixMe =
                    allMembers[allMembers.length - 1]._id === projectId;
                if (confirmParentProject) {
                    if (
                        !teamByUserId.every((data: $TSFixMe) => {
                            return data.role === 'Viewer';
                        })
                    ) {
                        projectSeats = projectSeats - 1;
                        this.updateSeatDetails(project, projectSeats);
                        return returnVal;
                    }
                } else if (teamMember.role !== 'Viewer' && isViewer) {
                    projectSeats = projectSeats - 1;
                    this.updateSeatDetails(project, projectSeats);
                    return returnVal;
                }
            }
        }
        return returnVal;
    }

    public async updateSeatDetails(project, projectSeats): void {
        if (IS_SAAS_SERVICE) {
            await PaymentService.changeSeats(
                project.stripeSubscriptionId,
                projectSeats
            );
        }
        await this.updateOneBy(
            { _id: project._id },
            { seats: projectSeats.toString() }
        );
    }

    public async getAllProjects(skip, limit): void {
        const populate: $TSFixMe = [
            { path: 'parentProjectId', select: 'name' },
        ];
        const select: $TSFixMe =
            '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes';

        let projects: $TSFixMe = await this.findBy({
            query: { parentProjectId: null, deleted: { $ne: null } },
            limit,
            skip,
            populate,
            select,
        });

        projects = await Promise.all(
            projects.map(async (project: $TSFixMe) => {
                // Get both sub-project users and project users
                let users: $TSFixMe = await TeamService.getTeamMembersBy({
                    parentProjectId: project._id,
                });
                if (users.length < 1) {
                    users = await TeamService.getTeamMembersBy({
                        _id: project._id,
                    });
                }
                const projectObj: $TSFixMe = Object.assign(
                    {},
                    project._doc || project,
                    {
                        users,
                    }
                );
                return projectObj;
            })
        );
        return projects;
    }

    public async getUserProjects(userId, skip, limit): void {
        // Find user subprojects and parent projects

        const userProjects: $TSFixMe = await this.findBy({
            query: { 'users.userId': userId, deleted: { $ne: null } },
            select: 'parentProjectId',
        });
        let parentProjectIds: $TSFixMe = [];
        let projectIds: $TSFixMe = [];
        if (userProjects.length > 0) {
            const subProjects: $TSFixMe = userProjects

                .map((project: $TSFixMe) => {
                    return project.parentProjectId ? project : null;
                })

                .filter((subProject: $TSFixMe) => {
                    return subProject !== null;
                });
            parentProjectIds = subProjects.map((subProject: $TSFixMe) => {
                return (
                    subProject.parentProjectId._id || subProject.parentProjectId
                );
            });
            const projects: $TSFixMe = userProjects

                .map((project: $TSFixMe) => {
                    return project.parentProjectId ? null : project;
                })

                .filter((project: $TSFixMe) => {
                    return project !== null;
                });

            projectIds = projects.map((project: $TSFixMe) => {
                return project._id;
            });
        }

        // Query data
        const query: $TSFixMe = {
            $or: [
                { _id: { $in: parentProjectIds } },
                { _id: { $in: projectIds } },
            ],
            deleted: { $ne: null },
        };
        const populate: $TSFixMe = [
            { path: 'parentProjectId', select: 'name' },
        ];
        const select: $TSFixMe =
            '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes createdAt';

        const [allProjects, count]: $TSFixMe = await Promise.all([
            this.findBy({
                query,
                limit: limit || 10,
                skip: skip || 0,
                select,
                populate,
            }),
            this.countBy(query),
        ]);

        // Add project monitors
        const projects: $TSFixMe = await Promise.all(
            allProjects.map(async (project: $TSFixMe) => {
                // Get both sub-project users and project users
                let users: $TSFixMe = [];
                if (project.parentProjectId) {
                    users = await TeamService.getTeamMembersBy({
                        parentProjectId:
                            project.parentProjectId._id ||
                            project.parentProjectId,
                    });
                    project.users = users;
                } else {
                    const select: $TSFixMe =
                        'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
                    users = await Promise.all(
                        project.users.map(async (user: $TSFixMe) => {
                            const foundUser: $TSFixMe =
                                await UserService.findOneBy({
                                    query: {
                                        _id: user.userId,
                                        deleted: { $ne: null },
                                    },
                                    select,
                                });

                            // Append user's project role different from system role
                            return { ...foundUser, projectRole: user.role };
                        })
                    );
                    project.users = users;
                }
                return Object.assign({}, project._doc || project, {
                    users,
                });
            })
        );
        return { projects, count };
    }

    public async restoreBy(query: $TSFixMe): void {
        query.deleted = true;

        let project: $TSFixMe = await this.findOneBy({
            query,
            select: '_id users stripeCustomerId',
        });

        if (!project) {
            throw new BadDataException('Project not found or no longer exist');
        }

        const projectId: $TSFixMe = project._id;
        const projectOwners: $TSFixMe = project.users.filter(
            (user: $TSFixMe) => {
                return user.role === 'Owner';
            }
        );
        let subscription: $TSFixMe;
        await Promise.all(
            projectOwners.map(async (projectOwner: $TSFixMe) => {
                const owner: $TSFixMe = await UserService.findOneBy({
                    query: { _id: projectOwner.userId },
                    select: 'stripeCustomerId',
                });
                if (IS_SAAS_SERVICE) {
                    subscription = await PaymentService.subscribePlan(
                        project.stripePlanId,
                        owner.stripeCustomerId
                    );
                }
            })
        );

        project = await this.updateOneBy(
            { _id: projectId },
            {
                deleted: false,
                deletedBy: null,
                deletedAt: null,
                stripeSubscriptionId: subscription
                    ? subscription.stripeSubscriptionId
                    : null,
            }
        );

        const projectSeats: $TSFixMe = project.seats;
        if (IS_SAAS_SERVICE) {
            await PaymentService.changeSeats(
                project.stripeSubscriptionId,
                projectSeats
            );
        }
        await Promise.all([
            ScheduleService.restoreBy({
                projectId,
                deleted: true,
            }),
            StatusPageService.restoreBy({
                projectId,
                deleted: true,
            }),
            integrationService.restoreBy({
                projectId,
                deleted: true,
            }),
            MonitorService.restoreBy({
                projectId,
                deleted: true,
            }),
            componentService.restoreBy({
                projectId: projectId,
                deleted: true,
            }),
        ]);
        return project;
    }

    public async addNotes(projectId, notes): void {
        const project: $TSFixMe = await this.updateOneBy(
            { _id: projectId },
            {
                adminNotes: notes,
            }
        );
        return project;
    }

    public async searchProjects(query, skip, limit): void {
        const select: string = '_id slug name';

        let projects: $TSFixMe = await this.findBy({
            query,
            limit,
            skip,
            select,
        });

        projects = await Promise.all(
            projects.map(async (project: $TSFixMe) => {
                // Get both sub-project users and project users
                let users: $TSFixMe = await TeamService.getTeamMembersBy({
                    parentProjectId: project._id,
                });
                if (users.length < 1) {
                    users = await TeamService.getTeamMembersBy({
                        _id: project._id,
                    });
                }
                const projectObj: $TSFixMe = Object.assign(
                    {},
                    project._doc || project,
                    {
                        users,
                    }
                );
                return projectObj;
            })
        );
        return projects;
    }
}
