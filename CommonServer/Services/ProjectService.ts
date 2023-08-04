import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Project';
import DatabaseService, {
    OnCreate,
    OnDelete,
    OnFind,
    OnUpdate,
} from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import TeamService from './TeamService';
import Team from 'Model/Models/Team';
import TeamMemberService from './TeamMemberService';
import TeamMember from 'Model/Models/TeamMember';
import TeamPermission from 'Model/Models/TeamPermission';
import Permission from 'Common/Types/Permission';
import TeamPermissionService from './TeamPermissionService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FindBy from '../Types/Database/FindBy';
import { In } from 'typeorm';
import QueryHelper from '../Types/Database/QueryHelper';
import ObjectID from 'Common/Types/ObjectID';
import OneUptimeDate from 'Common/Types/Date';
import MonitorStatus from 'Model/Models/MonitorStatus';
import { Yellow, Green, Red, Moroon, Black } from 'Common/Types/BrandColors';
import MonitorStatusService from './MonitorStatusService';
import IncidentState from 'Model/Models/IncidentState';
import IncidentStateService from './IncidentStateService';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import IncidentSeverityService from './IncidentSeverityService';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import ScheduledMaintenanceStateService from './ScheduledMaintenanceStateService';
import { getAllEnvVars, IsBillingEnabled } from '../Config';
import BillingService from './BillingService';
import DeleteBy from '../Types/Database/DeleteBy';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import SubscriptionPlan, {
    PlanSelect,
} from 'Common/Types/Billing/SubscriptionPlan';
import UpdateBy from '../Types/Database/UpdateBy';
import AllMeteredPlans from '../Types/Billing/MeteredPlan/AllMeteredPlans';
import AccessTokenService from './AccessTokenService';
import User from 'Model/Models/User';
import NotificationService from './NotificationService';
import MailService from './MailService';
import logger from '../Utils/Logger';
import Email from 'Common/Types/Email';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import UserService from './UserService';
import UserNotificationRuleService from './UserNotificationRuleService';
import UserNotificationSettingService from './UserNotificationSettingService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        data: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!data.data.name) {
            throw new BadDataException('Project name is required');
        }

        if (IsBillingEnabled) {
            if (!data.data.paymentProviderPlanId) {
                throw new BadDataException(
                    'Plan required to create the project.'
                );
            }

            if (
                data.data.paymentProviderPromoCode &&
                !(await BillingService.isPromoCodeValid(
                    data.data.paymentProviderPromoCode
                ))
            ) {
                throw new BadDataException('Promo code is invalid.');
            }

            if (
                !SubscriptionPlan.isValidPlanId(
                    data.data.paymentProviderPlanId,
                    getAllEnvVars()
                )
            ) {
                throw new BadDataException('Plan is invalid.');
            }

            data.data.planName = SubscriptionPlan.getPlanSelect(
                data.data.paymentProviderPlanId
            );
        }

        // check if the user has the project with the same name. If yes, reject.

        let existingProjectWithSameNameCount: number = 0;
        if (
            data.props.userGlobalAccessPermission &&
            data.props.userGlobalAccessPermission?.projectIds.length > 0
        ) {
            existingProjectWithSameNameCount = (
                await this.countBy({
                    query: {
                        _id: QueryHelper.in(
                            data.props.userGlobalAccessPermission?.projectIds.map(
                                (item: ObjectID) => {
                                    return item.toString();
                                }
                            ) || []
                        ),
                        name: QueryHelper.findWithSameText(data.data.name!),
                    },
                    props: {
                        isRoot: true,
                    },
                })
            ).toNumber();
        }

        if (existingProjectWithSameNameCount > 0) {
            throw new BadDataException(
                'Project with the same name already exists'
            );
        }

        if (data.props.userId) {
            data.data.createdByUserId = data.props.userId;
        } else {
            throw new NotAuthorizedException(
                'User should be logged in to create the project.'
            );
        }

        const user: User | null = await UserService.findOneById({
            id: data.props.userId,
            select: {
                name: true,
                email: true,
                companyPhoneNumber: true,
                companyName: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!user) {
            throw new BadDataException('User not found.');
        }

        data.data.createdOwnerName = user.name!;
        data.data.createdOwnerEmail = user.email!;
        data.data.createdOwnerPhone = user.companyPhoneNumber!;
        data.data.createdOwnerCompanyName = user.companyName!;

        return Promise.resolve({ createBy: data, carryForward: null });
    }

    protected override async onBeforeUpdate(
        updateBy: UpdateBy<Model>
    ): Promise<OnUpdate<Model>> {
        if (IsBillingEnabled) {
            if (updateBy.data.enableAutoRechargeSmsOrCallBalance) {
                await NotificationService.rechargeIfBalanceIsLow(
                    new ObjectID(updateBy.query._id! as string),
                    {
                        autoRechargeSmsOrCallByBalanceInUSD: updateBy.data
                            .autoRechargeSmsOrCallByBalanceInUSD as number,
                        autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD:
                            updateBy.data
                                .autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD as number,
                        enableAutoRechargeSmsOrCallBalance: updateBy.data
                            .enableAutoRechargeSmsOrCallBalance as boolean,
                    }
                );
            }

            if (updateBy.data.paymentProviderPlanId) {
                // payment provider id changed.
                const project: Model | null = await this.findOneById({
                    id: new ObjectID(updateBy.query._id! as string),
                    select: {
                        paymentProviderSubscriptionId: true,
                        paymentProviderMeteredSubscriptionId: true,
                        paymentProviderSubscriptionSeats: true,
                        paymentProviderPlanId: true,
                        trialEndsAt: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

                if (!project) {
                    throw new BadDataException('Project not found');
                }

                if (
                    project.paymentProviderPlanId !==
                    updateBy.data.paymentProviderPlanId
                ) {
                    const plan: SubscriptionPlan | undefined =
                        SubscriptionPlan.getSubscriptionPlanById(
                            updateBy.data.paymentProviderPlanId! as string,
                            getAllEnvVars()
                        );

                    if (!plan) {
                        throw new BadDataException('Invalid plan');
                    }

                    if (!project.paymentProviderSubscriptionSeats) {
                        project.paymentProviderSubscriptionSeats =
                            await TeamMemberService.getUniqueTeamMemberCountInProject(
                                project.id!
                            );
                    }

                    const subscription: {
                        subscriptionId: string;
                        meteredSubscriptionId: string;
                        trialEndsAt?: Date | undefined;
                    } = await BillingService.changePlan({
                        projectId: project.id!,
                        subscriptionId:
                            project.paymentProviderSubscriptionId as string,
                        meteredSubscriptionId:
                            project.paymentProviderMeteredSubscriptionId as string,
                        serverMeteredPlans: AllMeteredPlans,
                        newPlan: plan,
                        quantity:
                            project.paymentProviderSubscriptionSeats as number,
                        isYearly:
                            plan.getYearlyPlanId() ===
                            updateBy.data.paymentProviderPlanId,
                        endTrialAt: project.trialEndsAt,
                    });

                    await this.updateOneById({
                        id: new ObjectID(updateBy.query._id! as string),
                        data: {
                            paymentProviderSubscriptionId:
                                subscription.subscriptionId,
                            paymentProviderMeteredSubscriptionId:
                                subscription.meteredSubscriptionId,
                            trialEndsAt: subscription.trialEndsAt || new Date(),
                            planName: SubscriptionPlan.getPlanSelect(
                                updateBy.data.paymentProviderPlanId! as string
                            ),
                        },
                        props: {
                            isRoot: true,
                            ignoreHooks: true,
                        },
                    });
                }
            }
        }

        return { updateBy, carryForward: [] };
    }

    private async addDefaultScheduledMaintenanceState(
        createdItem: Model
    ): Promise<Model> {
        let createdScheduledMaintenanceState: ScheduledMaintenanceState =
            new ScheduledMaintenanceState();
        createdScheduledMaintenanceState.name = 'Scheduled';
        createdScheduledMaintenanceState.description =
            'When an event is scheduled, it belongs to this state';
        createdScheduledMaintenanceState.color = Black;
        createdScheduledMaintenanceState.isScheduledState = true;
        createdScheduledMaintenanceState.projectId = createdItem.id!;
        createdScheduledMaintenanceState.order = 1;

        createdScheduledMaintenanceState =
            await ScheduledMaintenanceStateService.create({
                data: createdScheduledMaintenanceState,
                props: {
                    isRoot: true,
                },
            });

        let ongoingScheduledMaintenanceState: ScheduledMaintenanceState =
            new ScheduledMaintenanceState();
        ongoingScheduledMaintenanceState.name = 'Ongoing';
        ongoingScheduledMaintenanceState.description =
            'When an event is ongoing, it belongs to this state.';
        ongoingScheduledMaintenanceState.color = Yellow;
        ongoingScheduledMaintenanceState.isOngoingState = true;
        ongoingScheduledMaintenanceState.projectId = createdItem.id!;
        ongoingScheduledMaintenanceState.order = 2;

        ongoingScheduledMaintenanceState =
            await ScheduledMaintenanceStateService.create({
                data: ongoingScheduledMaintenanceState,
                props: {
                    isRoot: true,
                },
            });

        let completedScheduledMaintenanceState: ScheduledMaintenanceState =
            new ScheduledMaintenanceState();
        completedScheduledMaintenanceState.name = 'Completed';
        completedScheduledMaintenanceState.description =
            'When an event is completed, it belongs to this state.';
        completedScheduledMaintenanceState.color = Green;
        completedScheduledMaintenanceState.isResolvedState = true;
        completedScheduledMaintenanceState.projectId = createdItem.id!;
        completedScheduledMaintenanceState.order = 3;

        completedScheduledMaintenanceState =
            await ScheduledMaintenanceStateService.create({
                data: completedScheduledMaintenanceState,
                props: {
                    isRoot: true,
                },
            });

        return createdItem;
    }

    protected override async onCreateSuccess(
        _onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        // Create billing.

        if (IsBillingEnabled) {
            const customerId: string = await BillingService.createCustomer({
                name: createdItem.name!,
                email: createdItem.createdOwnerEmail!,
                id: createdItem.id!,
            });

            const plan: SubscriptionPlan | undefined =
                SubscriptionPlan.getSubscriptionPlanById(
                    createdItem.paymentProviderPlanId!,
                    getAllEnvVars()
                );

            if (!plan) {
                throw new BadDataException('Invalid plan.');
            }
            // add subscription to this customer.

            const { subscriptionId, meteredSubscriptionId, trialEndsAt } =
                await BillingService.subscribeToPlan({
                    projectId: createdItem.id!,
                    customerId,
                    serverMeteredPlans: AllMeteredPlans,
                    plan,
                    quantity: 1,
                    isYearly:
                        plan.getYearlyPlanId() ===
                        createdItem.paymentProviderPlanId!,
                    trial: true,
                    promoCode: createdItem.paymentProviderPromoCode,
                });

            await this.updateOneById({
                id: createdItem.id!,
                data: {
                    paymentProviderCustomerId: customerId,
                    paymentProviderSubscriptionId: subscriptionId,
                    paymentProviderMeteredSubscriptionId: meteredSubscriptionId,
                    paymentProviderSubscriptionSeats: 1,
                    trialEndsAt: (trialEndsAt || null) as any,
                },
                props: {
                    isRoot: true,
                },
            });
        }

        createdItem = await this.addDefaultIncidentSeverity(createdItem);
        createdItem = await this.addDefaultProjectTeams(createdItem);
        createdItem = await this.addDefaultMonitorStatus(createdItem);
        createdItem = await this.addDefaultIncidentState(createdItem);
        createdItem = await this.addDefaultScheduledMaintenanceState(
            createdItem
        );

        return createdItem;
    }

    private async addDefaultIncidentState(createdItem: Model): Promise<Model> {
        let createdIncidentState: IncidentState = new IncidentState();
        createdIncidentState.name = 'Identified';
        createdIncidentState.description =
            'When an incident is created, it belongs to this state';
        createdIncidentState.color = Red;
        createdIncidentState.isCreatedState = true;
        createdIncidentState.projectId = createdItem.id!;
        createdIncidentState.order = 1;

        createdIncidentState = await IncidentStateService.create({
            data: createdIncidentState,
            props: {
                isRoot: true,
            },
        });

        let acknowledgedIncidentState: IncidentState = new IncidentState();
        acknowledgedIncidentState.name = 'Acknowledged';
        acknowledgedIncidentState.description =
            'When an incident is acknowledged, it belongs to this state.';
        acknowledgedIncidentState.color = Yellow;
        acknowledgedIncidentState.isAcknowledgedState = true;
        acknowledgedIncidentState.projectId = createdItem.id!;
        acknowledgedIncidentState.order = 2;

        acknowledgedIncidentState = await IncidentStateService.create({
            data: acknowledgedIncidentState,
            props: {
                isRoot: true,
            },
        });

        let resolvedIncidentState: IncidentState = new IncidentState();
        resolvedIncidentState.name = 'Resolved';
        resolvedIncidentState.description =
            'When an incident is resolved, it belongs to this state.';
        resolvedIncidentState.color = Green;
        resolvedIncidentState.isResolvedState = true;
        resolvedIncidentState.projectId = createdItem.id!;
        resolvedIncidentState.order = 3;

        resolvedIncidentState = await IncidentStateService.create({
            data: resolvedIncidentState,
            props: {
                isRoot: true,
            },
        });

        return createdItem;
    }

    private async addDefaultIncidentSeverity(
        createdItem: Model
    ): Promise<Model> {
        let criticalIncident: IncidentSeverity = new IncidentSeverity();
        criticalIncident.name = 'Critical Incident';
        criticalIncident.description =
            'Issues causing very high impact to customers. Immediate response is required. Examples include a full outage, or a data breach.';
        criticalIncident.color = Moroon;
        criticalIncident.projectId = createdItem.id!;
        criticalIncident.order = 1;

        criticalIncident = await IncidentSeverityService.create({
            data: criticalIncident,
            props: {
                isRoot: true,
            },
        });

        let majorIncident: IncidentSeverity = new IncidentSeverity();
        majorIncident.name = 'Major Incident';
        majorIncident.description =
            'Issues causing significant impact. Immediate response is usually required. We might have some workarounds that mitigate the impact on customers. Examples include an important sub-system failing.';
        majorIncident.color = Red;
        majorIncident.projectId = createdItem.id!;
        majorIncident.order = 2;

        majorIncident = await IncidentSeverityService.create({
            data: majorIncident,
            props: {
                isRoot: true,
            },
        });

        let minorIncident: IncidentSeverity = new IncidentSeverity();
        minorIncident.name = 'Minor Incident';
        minorIncident.description =
            'Issues with low impact, which can usually be handled within working hours. Most customers are unlikely to notice any problems. Examples include a slight drop in application performance.';
        minorIncident.color = Yellow;
        minorIncident.projectId = createdItem.id!;
        minorIncident.order = 3;

        minorIncident = await IncidentSeverityService.create({
            data: minorIncident,
            props: {
                isRoot: true,
            },
        });

        return createdItem;
    }

    private async addDefaultMonitorStatus(createdItem: Model): Promise<Model> {
        let operationalStatus: MonitorStatus = new MonitorStatus();
        operationalStatus.name = 'Operational';
        operationalStatus.description = 'Monitor operating normally';
        operationalStatus.projectId = createdItem.id!;
        operationalStatus.priority = 1;
        operationalStatus.isOperationalState = true;
        operationalStatus.color = Green;

        operationalStatus = await MonitorStatusService.create({
            data: operationalStatus,
            props: {
                isRoot: true,
            },
        });

        let degradedStatus: MonitorStatus = new MonitorStatus();
        degradedStatus.name = 'Degraded';
        degradedStatus.description =
            'Monitor is operating at reduced performance.';
        degradedStatus.priority = 2;
        degradedStatus.projectId = createdItem.id!;
        degradedStatus.color = Yellow;

        degradedStatus = await MonitorStatusService.create({
            data: degradedStatus,
            props: {
                isRoot: true,
            },
        });

        let downStatus: MonitorStatus = new MonitorStatus();
        downStatus.name = 'Offline';
        downStatus.description = 'Monitor is offline.';
        downStatus.isOfflineState = true;
        downStatus.projectId = createdItem.id!;
        downStatus.priority = 3;
        downStatus.color = Red;

        downStatus = await MonitorStatusService.create({
            data: downStatus,
            props: {
                isRoot: true,
            },
        });

        return createdItem;
    }

    private async addDefaultProjectTeams(createdItem: Model): Promise<Model> {
        // add a team member.

        // Owner Team.
        let ownerTeam: Team = new Team();
        ownerTeam.projectId = createdItem.id!;
        ownerTeam.name = 'Owners';
        ownerTeam.shouldHaveAtLeastOneMember = true;
        ownerTeam.isPermissionsEditable = false;
        ownerTeam.isTeamEditable = false;
        ownerTeam.isTeamDeleteable = false;
        ownerTeam.description =
            'This team is for project owners. Adding team members to this team will give them root level permissions.';

        ownerTeam = await TeamService.create({
            data: ownerTeam,
            props: {
                isRoot: true,
            },
        });

        // Add current user to owners team.

        let ownerTeamMember: TeamMember = new TeamMember();
        ownerTeamMember.projectId = createdItem.id!;
        ownerTeamMember.userId = createdItem.createdByUserId!;
        ownerTeamMember.hasAcceptedInvitation = true;
        ownerTeamMember.invitationAcceptedAt = OneUptimeDate.getCurrentDate();
        ownerTeamMember.teamId = ownerTeam.id!;

        ownerTeamMember = await TeamMemberService.create({
            data: ownerTeamMember,
            props: {
                isRoot: true,
                ignoreHooks: true,
            },
        });

        // Add permissions for this team.

        const ownerPermissions: TeamPermission = new TeamPermission();
        ownerPermissions.permission = Permission.ProjectOwner;
        ownerPermissions.teamId = ownerTeam.id!;
        ownerPermissions.projectId = createdItem.id!;

        await TeamPermissionService.create({
            data: ownerPermissions,
            props: {
                isRoot: true,
                ignoreHooks: true,
            },
        });

        // Admin Team.
        const adminTeam: Team = new Team();
        adminTeam.projectId = createdItem.id!;
        adminTeam.name = 'Admin';
        adminTeam.isPermissionsEditable = false;
        adminTeam.isTeamDeleteable = false;
        adminTeam.isTeamEditable = false;
        adminTeam.description =
            'This team is for project admins. Admins can invite members to any team and create project resources.';

        await TeamService.create({
            data: adminTeam,
            props: {
                isRoot: true,
            },
        });

        const adminPermissions: TeamPermission = new TeamPermission();
        adminPermissions.permission = Permission.ProjectAdmin;
        adminPermissions.teamId = adminTeam.id!;
        adminPermissions.projectId = createdItem.id!;

        await TeamPermissionService.create({
            data: adminPermissions,
            props: {
                isRoot: true,
                ignoreHooks: true,
            },
        });

        // Members Team.
        const memberTeam: Team = new Team();
        memberTeam.projectId = createdItem.id!;
        memberTeam.isPermissionsEditable = true;
        memberTeam.name = 'Members';
        memberTeam.isTeamDeleteable = true;
        memberTeam.description =
            'This team is for project members. Members can interact with any project resources like monitors, incidents, etc.';

        await TeamService.create({
            data: memberTeam,
            props: {
                isRoot: true,
            },
        });

        const memberPermissions: TeamPermission = new TeamPermission();
        memberPermissions.permission = Permission.ProjectMember;
        memberPermissions.teamId = memberTeam.id!;
        memberPermissions.projectId = createdItem.id!;

        await TeamPermissionService.create({
            data: memberPermissions,
            props: {
                isRoot: true,
                ignoreHooks: true,
            },
        });

        await AccessTokenService.refreshUserAllPermissions(
            createdItem.createdByUserId!
        );

        const user: User | null = await UserService.findOneById({
            id: createdItem.createdByUserId!,
            props: {
                isRoot: true,
            },
            select: {
                isEmailVerified: true,
                email: true,
            },
        });

        if (user && user.isEmailVerified) {
            await UserNotificationRuleService.addDefaultNotificationRuleForUser(
                createdItem.id!,
                user.id!,
                user.email!
            );

            await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
                user.id!,
                createdItem.id!
            );
        }

        return createdItem;
    }

    public async updateLastActive(projectId: ObjectID): Promise<void> {
        await this.updateOneById({
            id: projectId,
            data: {
                lastActive: OneUptimeDate.getCurrentDate(),
            },
            props: {
                isRoot: true,
            },
        });
    }

    public async getOwners(projectId: ObjectID): Promise<Array<User>> {
        if (!projectId) {
            throw new BadDataException('Project ID is required');
        }

        // get teams with project owner permissions.
        const teamPermissions: Array<TeamPermission> =
            await TeamPermissionService.findBy({
                query: {
                    projectId: projectId,
                    permission: Permission.ProjectOwner,
                },
                props: {
                    isRoot: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                select: {
                    teamId: true,
                },
            });

        if (teamPermissions.length === 0) {
            return [];
        }

        const teamIds: Array<ObjectID> = teamPermissions.map(
            (item: TeamPermission) => {
                return item.teamId!;
            }
        );

        return TeamMemberService.getUsersInTeams(teamIds);
    }

    protected override async onBeforeFind(
        findBy: FindBy<Model>
    ): Promise<OnFind<Model>> {
        // if user has no project id, then he should not be able to access any project.
        if (
            (!findBy.props.isRoot &&
                !findBy.props.userGlobalAccessPermission?.projectIds) ||
            findBy.props.userGlobalAccessPermission?.projectIds.length === 0
        ) {
            findBy.props.isRoot = true;
            findBy.query._id = In([]); // should not get any projects.
        }

        return { findBy, carryForward: null };
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {
        if (IsBillingEnabled) {
            const projects: Array<Model> = await this.findBy({
                query: deleteBy.query,
                props: deleteBy.props,
                limit: LIMIT_MAX,
                skip: 0,
                select: {
                    _id: true,
                    paymentProviderSubscriptionId: true,
                    paymentProviderMeteredSubscriptionId: true,
                },
            });

            return { deleteBy, carryForward: projects };
        }

        return { deleteBy, carryForward: [] };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<Model>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<Model>> {
        // get project id
        if (IsBillingEnabled) {
            for (const project of onDelete.carryForward) {
                if (project.paymentProviderSubscriptionId) {
                    await BillingService.cancelSubscription(
                        project.paymentProviderSubscriptionId
                    );
                }

                if (project.paymentProviderMeteredSubscriptionId) {
                    await BillingService.cancelSubscription(
                        project.paymentProviderMeteredSubscriptionId
                    );
                }
            }
        }

        return onDelete;
    }

    public async getCurrentPlan(
        projectId: ObjectID
    ): Promise<{ plan: PlanSelect | null; isSubscriptionUnpaid: boolean }> {
        if (!IsBillingEnabled) {
            return { plan: null, isSubscriptionUnpaid: false };
        }

        const project: Model | null = await this.findOneById({
            id: projectId,
            select: {
                paymentProviderPlanId: true,
                paymentProviderSubscriptionStatus: true,
                paymentProviderMeteredSubscriptionStatus: true,
            },
            props: {
                isRoot: true,
                ignoreHooks: true,
            },
        });

        if (!project) {
            throw new BadDataException('Project ID is invalid');
        }

        if (!project.paymentProviderPlanId) {
            throw new BadDataException('Project does not have any plans');
        }

        const plan: PlanSelect = SubscriptionPlan.getPlanSelect(
            project.paymentProviderPlanId,
            getAllEnvVars()
        );

        return {
            plan: plan,
            isSubscriptionUnpaid:
                !BillingService.isSubscriptionActive(
                    project.paymentProviderSubscriptionStatus!
                ) ||
                !BillingService.isSubscriptionActive(
                    project.paymentProviderMeteredSubscriptionStatus!
                ),
        };
    }

    public async sendEmailToProjectOwners(
        projectId: ObjectID,
        subject: string,
        message: string
    ): Promise<void> {
        const owners: Array<User> = await this.getOwners(projectId);

        if (owners.length === 0) {
            return;
        }

        const emails: Array<Email> = owners.map((owner: User) => {
            return owner.email!;
        });

        for (const email of emails) {
            MailService.sendMail(
                {
                    toEmail: email,
                    templateType: EmailTemplateType.SimpleMessage,
                    vars: {
                        subject: subject,
                        message: message,
                    },
                    subject: subject,
                },
                {
                    projectId,
                }
            ).catch((err: Error) => {
                logger.error(err);
            });
        }
    }
}
export default new Service();
