export default {
    BillingService: {
        BILLING_NOT_ENABLED: 'Billing is not enabled for this server.',
        CLIENT_SECRET_MISSING:
            'client_secret not returned by payment provider.',
        INVOICE_NOT_GENERATED: 'Invoice not generated.',
        MIN_REQUIRED_PAYMENT_METHOD_NOT_MET:
            "There's only one payment method associated with this account. It cannot be deleted. To delete this payment method please add more payment methods to your account.",
        NO_PAYMENTS_METHODS:
            'Payment Method not added. Please go to Project Settings > Billing and add a payment method.',
        PROMO_CODE_NOT_FOUND: 'Promo code not found',
        PROMO_CODE_INVALID: 'Invalid promo code',
        SUBSCRIPTION_ITEM_NOT_FOUND: 'Subscription item not found.',
        SUBSCRIPTION_NOT_FOUND: 'Subscription not found.',
    },
};
