import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Team';
import DatabaseService, { OnDelete, OnUpdate } from './DatabaseService';
import UpdateBy from '../Types/Database/UpdateBy';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import BadDataException from 'Common/Types/Exception/BadDataException';
import DeleteBy from '../Types/Database/DeleteBy';
import ObjectID from 'Common/Types/ObjectID';
import ProjectService from './ProjectService';
import { IsBillingEnabled } from '../Config';
import BillingService from './BillingService';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeUpdate(
        updateBy: UpdateBy<Model>
    ): Promise<OnUpdate<Model>> {
        // get teams by query.

        const teams: Array<Model> = await this.findBy({
            query: updateBy.query,
            limit: LIMIT_MAX,
            skip: 0,
            select: {
                name: true,
                isTeamEditable: true,
            },
            populate: {},
            props: updateBy.props,
        });

        for (const team of teams) {
            if (!team.isTeamEditable) {
                throw new BadDataException(
                    `${
                        team.name || 'This'
                    } team cannot be updated because its a critical team for this project.`
                );
            }
        }

        return { updateBy, carryForward: null };
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {
        const teams: Array<Model> = await this.findBy({
            query: deleteBy.query,
            limit: LIMIT_MAX,
            skip: 0,
            select: {
                name: true,
                isTeamDeleteable: true,
            },
            populate: {},
            props: deleteBy.props,
        });

        for (const team of teams) {
            if (!team.isTeamDeleteable) {
                throw new BadDataException(
                    `${
                        team.name || 'This'
                    } team cannot be deleted its a critical team for this project.`
                );
            }
        }

        return { deleteBy, carryForward: null };
    }

    public async getUniqueTeamMemberCountInProject(projectId: ObjectID): Promise<number> { 
        return (await this.countBy({
            query: {
                projectId
            },
            props: {
                isRoot: true
            },
            distinctOn: "userId",
            skip: 0,
            limit: LIMIT_MAX
        })).toNumber()
    }

    public async updateSubscriptionSeatsByUnqiqueTeamMembersInProject(projectId: ObjectID): Promise<void> {
        
        if (!IsBillingEnabled) {
            return;
        }
        
        const numberOfMembers = await this.getUniqueTeamMemberCountInProject(projectId);
        const project = await ProjectService.findOneById({
            id: projectId,
            select: {
                paymentProviderSubscriptionId: true,
                paymentProviderPlanId: true
            },
            props: {
                isRoot: true
            }
        });

        

        if (project && project.paymentProviderSubscriptionId && project?.paymentProviderPlanId) {
            const plan = SubscriptionPlan.getSubscriptionPlanById(project?.paymentProviderPlanId!);
            
            if (!plan) {
                return;
            }

            await BillingService.updateSubscription(project.paymentProviderSubscriptionId, plan, numberOfMembers, plan.getYearlyPlanId() === project.paymentProviderPlanId);
        }
    }
}
export default new Service();
