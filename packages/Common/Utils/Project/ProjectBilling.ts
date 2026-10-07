import Permission from "../../Types/Permission";

/*
 * WHAT THE THREE BILLING ROLES DO - and who does the rest.
 *
 *   Billing Viewer  reads every billing page and record: the plan and the
 *                   subscription, invoices, usage, the balance for SMS,
 *                   calls, WhatsApp and Telegram, the AI credits, the
 *                   payment methods and the billing contact details. It
 *                   changes nothing.
 *   Billing Member  does what Billing Viewer does, and downloads invoices
 *                   and changes the billing contact details: the billing
 *                   address, its country, the finance email and whether
 *                   invoices are emailed to it.
 *   Billing Admin   does what Billing Member does, and turns the project's
 *                   SMS, phone call, WhatsApp and Telegram notifications on
 *                   and off (Utils/Project/NotificationChannels).
 *
 * Changing the plan, payment methods, the balances or their Auto Recharge,
 * and paying an invoice - everything that charges the card - stays with a
 * project owner and Manage Billing.
 *
 * The models (Project, BillingInvoice, TelemetryUsageBilling,
 * BillingPaymentMethod, PromoCode) name these roles in their own lists, and
 * the billing routes read the lists below; tests hold the two together
 * (Tests/Server/Types/Database/Permissions/BillingRolesPermissionMatrix).
 * Kept free of server and React code, so the server, the dashboard and the
 * tests read the same lists.
 */

// The three billing roles: each reads every billing record.
export const PROJECT_BILLING_READ_ROLES: ReadonlyArray<Permission> = [
  Permission.BillingAdmin,
  Permission.BillingMember,
  Permission.BillingViewer,
];

// The billing roles that also download invoices and change contact details.
export const PROJECT_BILLING_CONTACT_ROLES: ReadonlyArray<Permission> = [
  Permission.BillingAdmin,
  Permission.BillingMember,
];

export type ProjectBillingContactColumn =
  | "businessDetails"
  | "businessDetailsCountry"
  | "financeAccountingEmail"
  | "sendInvoicesByEmail";

/*
 * The billing contact details: what invoices say about the customer and
 * where they are sent (Settings > Billing > Business Details / Billing
 * Address).
 */
export const PROJECT_BILLING_CONTACT_COLUMNS: ReadonlyArray<ProjectBillingContactColumn> =
  [
    "businessDetails",
    "businessDetailsCountry",
    "financeAccountingEmail",
    "sendInvoicesByEmail",
  ];

/*
 * Who may change the billing contact details: the update permissions of
 * each contact column.
 */
export const PROJECT_BILLING_CONTACT_UPDATE_PERMISSIONS: ReadonlyArray<Permission> =
  [
    Permission.ProjectOwner,
    Permission.ManageProjectBilling,
    ...PROJECT_BILLING_CONTACT_ROLES,
  ];

/*
 * The project's billing record: its columns every billing role reads, on the
 * billing pages and through the API - the plan and subscription, the
 * reseller it was bought from, the contact details, both balances and their
 * Auto Recharge, the paid channel switches, the AI spend settings and the
 * usage the plan counts. Every
 * member reads most of these anyway (Project User); the billing roles read
 * them by name, so an API key given only a billing role reads them too.
 */
export const PROJECT_BILLING_READ_COLUMNS: ReadonlyArray<string> = [
  "paymentProviderPlanId",
  "planName",
  "paymentProviderSubscriptionId",
  "paymentProviderMeteredSubscriptionId",
  "paymentProviderSubscriptionSeats",
  "paymentProviderSubscriptionStatus",
  "paymentProviderMeteredSubscriptionStatus",
  "trialEndsAt",
  "paymentProviderCustomerId",
  "paymentProviderPromoCode",
  "reseller",
  "resellerId",
  "resellerPlan",
  "resellerPlanId",
  ...PROJECT_BILLING_CONTACT_COLUMNS,
  "smsOrCallCurrentBalanceInUSDCents",
  "enableAutoRechargeSmsOrCallBalance",
  "autoRechargeSmsOrCallByBalanceInUSD",
  "autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD",
  "enableSmsNotifications",
  "enableCallNotifications",
  "enableWhatsAppNotifications",
  "enableTelegramNotifications",
  "disableOnCallNotificationFallback",
  "aiCurrentBalanceInUSDCents",
  "enableAutoRechargeAiBalance",
  "autoAiRechargeByBalanceInUSD",
  "autoRechargeAiWhenCurrentBalanceFallsInUSD",
  "enableAi",
  "aiDailyTokenLimit",
  "aiDailySpendLimitInUSD",
  // Usage the plan counts.
  "workflowRunsInLast30Days",
];

/*
 * Who reads the project's invoices (BillingInvoice): number, date, amount
 * and status.
 */
export const PROJECT_INVOICE_READ_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ManageProjectBilling,
  Permission.ReadInvoices,
  ...PROJECT_BILLING_READ_ROLES,
];

/*
 * Who downloads an invoice: its download link (BillingInvoice
 * .downloadableLink), which opens the PDF without signing in. Not Billing
 * Viewer, who reads the list.
 */
export const PROJECT_INVOICE_DOWNLOAD_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ManageProjectBilling,
  Permission.ReadInvoices,
  ...PROJECT_BILLING_CONTACT_ROLES,
];

// Who pays an open invoice (POST /billing-invoices/pay): it charges the card.
export const PROJECT_INVOICE_PAY_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ManageProjectBilling,
  Permission.EditInvoices,
];

/*
 * Who reads the credit the payment provider holds for the project (GET
 * /billing/customer-balance), shown on the Billing page.
 */
export const PROJECT_CUSTOMER_BALANCE_READ_PERMISSIONS: ReadonlyArray<Permission> =
  [
    Permission.ProjectOwner,
    Permission.ManageProjectBilling,
    ...PROJECT_BILLING_READ_ROLES,
  ];

// Who reads the project's usage history (TelemetryUsageBilling).
export const PROJECT_USAGE_READ_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ManageProjectBilling,
  ...PROJECT_BILLING_READ_ROLES,
];

/*
 * Who adds a payment method (POST /billing-payment-methods/setup, and the
 * table's create permissions).
 */
export const PAYMENT_METHOD_ADD_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ManageProjectBilling,
  Permission.CreateBillingPaymentMethod,
];

/*
 * Who makes a payment method the default (POST
 * /billing-payment-methods/set-default): the dashboard makes a newly added
 * card the default straight after adding it, so everyone who may add one
 * may finish that, and choosing the default is what editing a payment
 * method is.
 */
export const PAYMENT_METHOD_SET_DEFAULT_PERMISSIONS: ReadonlyArray<Permission> =
  [...PAYMENT_METHOD_ADD_PERMISSIONS, Permission.EditBillingPaymentMethod];
