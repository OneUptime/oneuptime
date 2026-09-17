import RunCron from "../../Utils/Cron";
import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "Common/Types/Billing/SubscriptionStatus";
import Sleep from "Common/Types/Sleep";
import { EVERY_DAY, EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import BillingService, { Invoice } from "Common/Server/Services/BillingService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";
import { InvoiceStatus } from "Common/Models/DatabaseModels/BillingInvoice";

RunCron(
  "PaymentProvider:CheckSubscriptionStatus",
  { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY, runOnStartup: false },
  async () => {
    // get all projects.
    if (!IsBillingEnabled) {
      return;
    }

    const projects: Array<Project> = await ProjectService.findAllBy({
      query: {},
      select: {
        _id: true,
        paymentProviderSubscriptionId: true,
        paymentProviderMeteredSubscriptionId: true,
        paymentProviderCustomerId: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    for (const project of projects) {
      try {
        let cachedHasUnpaidInvoices: boolean | null = null;

        const hasUnpaidInvoices: () => Promise<boolean> =
          async (): Promise<boolean> => {
            if (cachedHasUnpaidInvoices !== null) {
              return cachedHasUnpaidInvoices;
            }
            if (!project.paymentProviderCustomerId) {
              cachedHasUnpaidInvoices = false;
              return cachedHasUnpaidInvoices;
            }
            const invoices: Array<Invoice> = await BillingService.getInvoices(
              project.paymentProviderCustomerId,
            );
            cachedHasUnpaidInvoices = invoices.some((invoice: Invoice) => {
              return (
                invoice.status === InvoiceStatus.Open ||
                invoice.status === InvoiceStatus.Uncollectible
              );
            });
            return cachedHasUnpaidInvoices;
          };

        if (project.paymentProviderSubscriptionId) {
          // get subscription detail.
          let subscriptionState: SubscriptionStatus =
            await BillingService.getSubscriptionStatus(
              project.paymentProviderSubscriptionId as string,
            );

          /*
           * If Stripe reports an inactive state but no Open/Uncollectible
           * invoices exist, the project has no outstanding payment obligations.
           * Treat as Active to avoid misleading "invoices unpaid" banners when
           * invoices are still in transient states (draft, etc.).
           */
          if (
            SubscriptionStatusUtil.isSubscriptionInactive(subscriptionState) &&
            !(await hasUnpaidInvoices())
          ) {
            subscriptionState = SubscriptionStatus.Active;
          }

          await ProjectService.updateOneById({
            id: project.id!,
            data: {
              paymentProviderSubscriptionStatus: subscriptionState,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });

          // after every subscription fetch, sleep for a 5 seconds to avoid stripe rate limit.
          await Sleep.sleep(1000);
        }

        if (project.paymentProviderMeteredSubscriptionId) {
          // get subscription detail.
          let subscriptionState: SubscriptionStatus =
            await BillingService.getSubscriptionStatus(
              project.paymentProviderMeteredSubscriptionId as string,
            );

          if (
            SubscriptionStatusUtil.isSubscriptionInactive(subscriptionState) &&
            !(await hasUnpaidInvoices())
          ) {
            subscriptionState = SubscriptionStatus.Active;
          }

          await ProjectService.updateOneById({
            id: project.id!,
            data: {
              paymentProviderMeteredSubscriptionStatus: subscriptionState,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });

          // after every subscription fetch, sleep for a 5 seconds to avoid stripe rate limit.
          await Sleep.sleep(1000);
        }
      } catch (err) {
        logger.error(err);
      }
    }
  },
);
