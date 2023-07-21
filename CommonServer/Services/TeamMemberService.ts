import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService, {
    OnCreate,
    OnDelete,
    OnUpdate,
} from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import AccessTokenService from './AccessTokenService';
import Email from 'Common/Types/Email';
import UserService from './UserService';
import User from 'Model/Models/User';
import UpdateBy from '../Types/Database/UpdateBy';
import DeleteBy from '../Types/Database/DeleteBy';
import ObjectID from 'Common/Types/ObjectID';
import QueryHelper from '../Types/Database/QueryHelper';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import ProjectService from './ProjectService';
import {
    DashboardRoute,
    Domain,
    HttpProtocol,
    IsBillingEnabled,
} from '../Config';
import BillingService from './BillingService';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import Project from 'Model/Models/Project';
import MailService from './MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import URL from 'Common/Types/API/URL';
import logger from '../Utils/Logger';
import BadDataException from 'Common/Types/Exception/BadDataException';
import PositiveNumber from 'Common/Types/PositiveNumber';
import TeamMember from 'Model/Models/TeamMember';
import UserNotificationRuleService from './UserNotificationRuleService';
import UserNotificationSettingService from './UserNotificationSettingService';

export class TeamMemberService extends DatabaseService<TeamMember> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(TeamMember, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<TeamMember>
    ): Promise<OnCreate<TeamMember>> {
        // check if this project can have more members.

        if (IsBillingEnabled && createBy.data.projectId) {
            const project: Project | null = await ProjectService.findOneById({
                id: createBy.data.projectId!,
                select: {
                    seatLimit: true,
                    paymentProviderSubscriptionSeats: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (
                project &&
                project.seatLimit &&
                project.paymentProviderSubscriptionSeats &&
                project.paymentProviderSubscriptionSeats >= project.seatLimit
            ) {
                throw new BadDataException(
                    'You have reached the user limit. You cannot invite any more users to this project. Please contact billing@oneuptime.com to increase your user limit.'
                );
            }
        }

        createBy.data.hasAcceptedInvitation = false;

        if (createBy.miscDataProps && createBy.miscDataProps['email']) {
            const email: Email = new Email(
                createBy.miscDataProps['email'] as string
            );

            let user: User | null = await UserService.findByEmail(email, {
                isRoot: true,
            });

            if (!user) {
                user = await UserService.createByEmail(email, {
                    isRoot: true,
                });
            }

            createBy.data.userId = user.id!;

            const project: Project | null = await ProjectService.findOneById({
                id: createBy.data.projectId!,
                select: {
                    name: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (project) {
                MailService.sendMail({
                    toEmail: email,
                    templateType: EmailTemplateType.InviteMember,
                    vars: {
                        dashboardUrl: new URL(
                            HttpProtocol,
                            Domain,
                            DashboardRoute
                        ).toString(),
                        projectName: project.name!,
                        homeUrl: new URL(HttpProtocol, Domain).toString(),
                    },
                    subject: 'You have been invited to ' + project.name,
                }).catch((err: Error) => {
                    logger.error(err);
                });
            }
        }

        //check if this user is already ivnited.

        const member: TeamMember | null = await this.findOneBy({
            query: {
                userId: createBy.data.userId!,
                teamId: createBy.data.teamId!,
            },
            props: {
                isRoot: true,
            },
            select: {
                _id: true,
            },
        });

        if (member) {
            throw new BadDataException(
                'This user has already been invited to this team'
            );
        }

        return { createBy, carryForward: null };
    }

    public async refreshTokens(
        userId: ObjectID,
        projectId: ObjectID
    ): Promise<void> {
        /// Refresh tokens.
        await AccessTokenService.refreshUserGlobalAccessPermission(userId);

        await AccessTokenService.refreshUserTenantAccessPermission(
            userId,
            projectId
        );
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<TeamMember>,
        createdItem: TeamMember
    ): Promise<TeamMember> {
        await this.refreshTokens(
            onCreate.createBy.data.userId!,
            onCreate.createBy.data.projectId!
        );

        await this.updateSubscriptionSeatsByUnqiqueTeamMembersInProject(
            onCreate.createBy.data.projectId!
        );

        return createdItem;
    }

    protected override async onUpdateSuccess(
        onUpdate: OnUpdate<TeamMember>,
        updatedItemIds: Array<ObjectID>
    ): Promise<OnUpdate<TeamMember>> {
        const updateBy: UpdateBy<TeamMember> = onUpdate.updateBy;
        const items: Array<TeamMember> = await this.findBy({
            query: {
                _id: QueryHelper.in(updatedItemIds),
            },
            select: {
                userId: true,
                user: {
                    email: true,
                    isEmailVerified: true,
                },
                projectId: true,
            },
            limit: LIMIT_MAX,
            skip: 0,

            props: {
                isRoot: true,
            },
        });

        for (const item of items) {
            await this.refreshTokens(item.userId!, item.projectId!);

            if (
                updateBy.data.hasAcceptedInvitation &&
                item.user?.isEmailVerified
            ) {
                await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
                    item.userId!,
                    item.projectId!
                );
                await UserNotificationRuleService.addDefaultNotifictionRuleForUser(
                    item.projectId!,
                    item.userId!,
                    item.user?.email!
                );
            }
        }

        return { updateBy, carryForward: onUpdate.carryForward };
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<TeamMember>
    ): Promise<OnDelete<TeamMember>> {
        const members: Array<TeamMember> = await this.findBy({
            query: deleteBy.query,
            select: {
                userId: true,
                projectId: true,
                teamId: true,
                hasAcceptedInvitation: true,
                team: {
                    _id: true,
                    shouldHaveAtleastOneMember: true,
                },
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
            },
        });

        // check if there's one member in the team.
        for (const member of members) {
            if (member.team?.shouldHaveAtleastOneMember) {
                if (!member.hasAcceptedInvitation) {
                    continue;
                }

                const membersInTeam: PositiveNumber = await this.countBy({
                    query: {
                        teamId: member.teamId!,
                        hasAcceptedInvitation: true,
                    },
                    skip: 0,
                    limit: LIMIT_MAX,
                    props: {
                        isRoot: true,
                    },
                });

                if (membersInTeam.toNumber() <= 1) {
                    throw new BadDataException(
                        'This team should have atleast 1 member who has accepted the invitation.'
                    );
                }
            }
        }

        return {
            deleteBy: deleteBy,
            carryForward: members,
        };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<TeamMember>
    ): Promise<OnDelete<TeamMember>> {
        for (const item of onDelete.carryForward as Array<TeamMember>) {
            await this.refreshTokens(item.userId!, item.projectId!);
            await this.updateSubscriptionSeatsByUnqiqueTeamMembersInProject(
                item.projectId!
            );
        }

        return onDelete;
    }

    public async getUniqueTeamMemberCountInProject(
        projectId: ObjectID
    ): Promise<number> {
        const members: Array<TeamMember> = await this.findBy({
            query: {
                projectId: projectId!,
            },
            props: {
                isRoot: true,
            },
            select: {
                userId: true,
            },
            skip: 0,
            limit: LIMIT_MAX,
        });

        const memberIds: Array<string | undefined> = members
            .map((member: TeamMember) => {
                return member.userId?.toString();
            })
            .filter((memberId: string | undefined) => {
                return Boolean(memberId);
            });

        return [...new Set(memberIds)].length; //get unique member ids.
    }

    public async getUsersInTeams(
        teamIds: Array<ObjectID>
    ): Promise<Array<User>> {
        const members: Array<TeamMember> = await this.findBy({
            query: {
                teamId: QueryHelper.in(teamIds),
            },
            props: {
                isRoot: true,
            },
            select: {
                _id: true,
                user: {
                    _id: true,
                    email: true,
                    name: true,
                },
            },

            skip: 0,
            limit: LIMIT_MAX,
        });

        return members.map((member: TeamMember) => {
            return member.user!;
        });
    }

    public async getUsersInTeam(teamId: ObjectID): Promise<Array<User>> {
        const members: Array<TeamMember> = await this.findBy({
            query: {
                teamId: teamId,
            },
            props: {
                isRoot: true,
            },
            select: {
                _id: true,
                user: {
                    _id: true,
                    email: true,
                    name: true,
                },
            },

            skip: 0,
            limit: LIMIT_MAX,
        });

        return members.map((member: TeamMember) => {
            return member.user!;
        });
    }

    public async updateSubscriptionSeatsByUnqiqueTeamMembersInProject(
        projectId: ObjectID
    ): Promise<void> {
        if (!IsBillingEnabled) {
            return;
        }

        const numberOfMembers: number =
            await this.getUniqueTeamMemberCountInProject(projectId);
        const project: Project | null = await ProjectService.findOneById({
            id: projectId,
            select: {
                paymentProviderSubscriptionId: true,
                paymentProviderPlanId: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (
            project &&
            project.paymentProviderSubscriptionId &&
            project?.paymentProviderPlanId
        ) {
            const plan: SubscriptionPlan | undefined =
                SubscriptionPlan.getSubscriptionPlanById(
                    project?.paymentProviderPlanId!
                );

            if (!plan) {
                return;
            }

            await BillingService.changeQuantity(
                project.paymentProviderSubscriptionId,
                numberOfMembers
            );

            await ProjectService.updateOneById({
                id: projectId,
                data: {
                    paymentProviderSubscriptionSeats: numberOfMembers,
                },
                props: {
                    isRoot: true,
                },
            });
        }
    }
}

export default new TeamMemberService();
