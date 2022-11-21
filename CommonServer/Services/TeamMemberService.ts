import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/TeamMember';
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

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.data.hasAcceptedInvitation) {
            createBy.data.hasAcceptedInvitation = false;
        }

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

            const project = await ProjectService.findOneById({
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
                }).catch((err) => {
                    logger.error(err);
                });
            }
        }

        return { createBy, carryForward: null };
    }

    private async refreshTokens(
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
        onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
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
        onUpdate: OnUpdate<Model>,
        updatedItemIds: Array<ObjectID>
    ): Promise<OnUpdate<Model>> {
        const updateBy: UpdateBy<Model> = onUpdate.updateBy;
        const items: Array<Model> = await this.findBy({
            query: {
                _id: QueryHelper.in(updatedItemIds),
            },
            select: {
                userId: true,
                projectId: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            populate: {},
            props: {
                isRoot: true,
            },
        });

        for (const item of items) {
            await this.refreshTokens(item.userId!, item.projectId!);
        }

        return { updateBy, carryForward: onUpdate.carryForward };
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {



        const members: Array<Model> = await this.findBy({
            query: deleteBy.query,
            select: {
                userId: true,
                projectId: true,
                team: true,
                teamId: true
            },
            limit: LIMIT_MAX,
            skip: 0,
            populate: {
                team: {
                    _id: true,
                    shouldHaveAtleastOneMember: true
                }
            },
            props: {
                isRoot: true,
            },
        });


        // check if there's one member in the team. 
        for (const member of members) {
            if (member.team?.shouldHaveAtleastOneMember) {
                const membersInTeam = await this.countBy({
                    query: {
                        _id: member.teamId?.toString() as string
                    },
                    skip: 0,
                    limit: LIMIT_MAX,
                    props: {
                        isRoot: true
                    }
                });

                if (membersInTeam.toNumber() <= 1) {
                    throw new BadDataException("This team should have atleast 1 member");
                }
            }
        }

        return {
            deleteBy: deleteBy,
            carryForward: members,
        };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<Model>
    ): Promise<OnDelete<Model>> {
        for (const item of onDelete.carryForward as Array<Model>) {
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
        const members = await this.findBy({
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

        const emmberIds = members
            .map((member) => {
                return member.userId?.toString();
            })
            .filter((memberId) => {
                return Boolean(memberId);
            });
        return [...new Set(emmberIds)].length; //get unique member ids.
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
export default new Service();
