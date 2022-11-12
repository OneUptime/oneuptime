import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import Stripe from 'stripe';
import { BillingPrivateKey, BillingPublicKey, IsBillingEnabled } from '../Config';


export class BillingService {

    private stripe: Stripe = new Stripe(BillingPrivateKey, {
        apiVersion: '2022-08-01',
    });

    public constructor() {

        if (!this.isBillingEnabled()) {
            throw new BadDataException("Billing is not enabled for this server.")
        }

        if (!BillingPrivateKey) {
            throw new BadDataException("BILLING_PRIVATE_KEY not found for this server.")
        }

        if (!BillingPublicKey) {
            throw new BadDataException("BILLING_PUBLIC_KEY not found for this server.")
        }

        this.stripe = new Stripe(BillingPrivateKey,  {
            apiVersion: '2022-08-01',
        });
    }

    // returns billing id of the customer. 
    public async createCustomer(name: string, id: ObjectID): Promise<string> {
        const customer = await this.stripe.customers.create({
            name,
            "metadata": {
                "id": id.toString()
            }
        });

        return customer.id;
    }

    public async updateCustomerName(id: string, newName: string): Promise<void> {
        await this.stripe.customers.update(
            id,
            { name: newName }
        );
    }

    public async deleteCustomer(id: string): Promise<void> {
        await this.stripe.customers.del(
            id
        );
    }

    public isBillingEnabled(): boolean {
        return IsBillingEnabled;
    }
}

export default new BillingService();
