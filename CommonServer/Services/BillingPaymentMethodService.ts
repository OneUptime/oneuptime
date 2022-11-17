import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/BillingPaymentMethod';
import DatabaseService, { OnFind } from './DatabaseService';
import FindBy from '../Types/Database/FindBy';
import ProjectService from './ProjectService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Project from 'Model/Models/Project';
import BillingService from './BillingService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeFind(findBy: FindBy<Model>): Promise<OnFind<Model>> {

        console.log(findBy.props);

        if (!findBy.props.tenantId) {
            throw new BadDataException("ProjectID not found.")
        }
        
        const project: Project | null = await ProjectService.findOneById({
            id: findBy.props.tenantId!,
            props: {
                ...findBy.props, 
                isRoot: true
            },
            select: {
                _id: true,
                paymentProviderCustomerId: true
            }
        });

        if (!project) {
            throw new BadDataException("Project not found");
        }


        if (!project.paymentProviderCustomerId) {
            throw new BadDataException("Payment provider customer id not found.")
        }
        
        const paymentMethods = await BillingService.getPaymentMethods(project.paymentProviderCustomerId);

        await this.deleteBy({
            query: {
                projectId: findBy.props.tenantId!
            },
            props: {
                isRoot: true
            }
        });


        for (const paymentMethod of paymentMethods) {
            const billingPaymentMethod = new Model();
            billingPaymentMethod.projectId = findBy.props.tenantId!;
            billingPaymentMethod.type = paymentMethod.type;
            billingPaymentMethod.last4Digits = paymentMethod.last4Digits;
            billingPaymentMethod.isDefault = paymentMethod.isDefault;
            billingPaymentMethod.paymentProviderPaymentMethodId = paymentMethod.id;
            
            await this.create({
                data: billingPaymentMethod,
                props: {
                    isRoot: true
                }
            });
        }


        return { findBy, carryForward: paymentMethods };
    }

}

export default new Service();
