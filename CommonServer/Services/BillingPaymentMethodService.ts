import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/BillingPaymentMethod';
import DatabaseService, { OnDelete, OnFind } from './DatabaseService';
import FindBy from '../Types/Database/FindBy';
import ProjectService from './ProjectService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Project from 'Model/Models/Project';
import BillingService, { PaymentMethod } from './BillingService';
import DeleteBy from '../Types/Database/DeleteBy';
import LIMIT_MAX, { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeFind(
        findBy: FindBy<Model>
    ): Promise<OnFind<Model>> {
        if (!findBy.props.tenantId) {
            throw new BadDataException('ProjectID not found.');
        }

        const project: Project | null = await ProjectService.findOneById({
            id: findBy.props.tenantId!,
            props: {
                ...findBy.props,
                isRoot: true,
                ignoreHooks: true,
            },
            select: {
                _id: true,
                paymentProviderCustomerId: true,
            },
        });

        if (!project) {
            throw new BadDataException('Project not found');
        }

        if (!project.paymentProviderCustomerId) {
            throw new BadDataException(
                'Payment provider customer id not found.'
            );
        }

        const paymentMethods: Array<PaymentMethod> =
            await BillingService.getPaymentMethods(
                project.paymentProviderCustomerId
            );

        await this.deleteBy({
            query: {
                projectId: findBy.props.tenantId!,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
                isRoot: true,
                ignoreHooks: true,
            },
        });

        for (const paymentMethod of paymentMethods) {
            const billingPaymentMethod: Model = new Model();

            billingPaymentMethod.projectId = project.id!;

            billingPaymentMethod.type = paymentMethod.type;
            billingPaymentMethod.last4Digits = paymentMethod.last4Digits;
            billingPaymentMethod.isDefault = paymentMethod.isDefault;
            billingPaymentMethod.paymentProviderPaymentMethodId =
                paymentMethod.id;
            billingPaymentMethod.paymentProviderCustomerId =
                project.paymentProviderCustomerId;

            await this.create({
                data: billingPaymentMethod,
                props: {
                    isRoot: true,
                },
            });
        }

        return { findBy, carryForward: paymentMethods };
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {
        const items: Array<Model> = await this.findBy({
            query: deleteBy.query,
            select: {
                _id: true,
                paymentProviderPaymentMethodId: true,
                paymentProviderCustomerId: true,
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
                isRoot: true,
                ignoreHooks: true,
            },
        });

        for (const item of items) {
            if (
                item.paymentProviderPaymentMethodId &&
                item.paymentProviderCustomerId
            ) {
                await BillingService.deletePaymentMethod(
                    item.paymentProviderCustomerId,
                    item.paymentProviderPaymentMethodId
                );
            }
        }

        return { deleteBy, carryForward: null };
    }
}

export default new Service();
