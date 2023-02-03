import type PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/BillingInvoice';
import type { OnDelete, OnFind } from './DatabaseService';
import DatabaseService from './DatabaseService';
import type FindBy from '../Types/Database/FindBy';
import ProjectService from './ProjectService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import type Project from 'Model/Models/Project';
import type { Invoice } from './BillingService';
import BillingService from './BillingService';
import type DeleteBy from '../Types/Database/DeleteBy';
import URL from 'Common/Types/API/URL';

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

        const invoices: Array<Invoice> = await BillingService.getInvoices(
            project.paymentProviderCustomerId
        );

        await this.deleteBy({
            query: {
                projectId: findBy.props.tenantId!,
            },
            props: {
                isRoot: true,
                ignoreHooks: true,
            },
        });

        for (const invoice of invoices) {
            const billingInvoice: Model = new Model();

            billingInvoice.projectId = project.id!;

            billingInvoice.amount = invoice.amount;
            billingInvoice.downloadableLink = URL.fromString(
                invoice.downloadableLink
            );
            billingInvoice.currencyCode = invoice.currencyCode;
            billingInvoice.paymentProviderCustomerId = invoice.customerId || '';
            billingInvoice.paymentProviderSubscriptionId =
                invoice.subscriptionId || '';
            billingInvoice.status = invoice.status || '';
            billingInvoice.paymentProviderInvoiceId = invoice.id;

            await this.create({
                data: billingInvoice,
                props: {
                    isRoot: true,
                },
            });
        }

        return { findBy, carryForward: invoices };
    }

    protected override async onBeforeDelete(
        _deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {
        throw new BadDataException('Invoice should not be deleted.');
    }
}

export default new Service();
