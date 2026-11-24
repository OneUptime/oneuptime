import { IsBillingEnabled } from "../EnvironmentConfig";
import FindBy from "../Types/Database/FindBy";
import { OnFind } from "../Types/Database/Hooks";
import BillingService, { Invoice } from "./BillingService";
import {
  AdminProjectInvoice,
  InvoiceBilledFor,
  isInvoiceVoidable,
} from "../../Types/Billing/AdminProjectInvoice";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import URL from "../../Types/API/URL";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import Model, {
  InvoiceStatus,
} from "../../Models/DatabaseModels/BillingInvoice";
import Project from "../../Models/DatabaseModels/Project";
import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "../../Types/Billing/SubscriptionStatus";
import ObjectID from "../../Types/ObjectID";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import logger, { LogAttributes } from "../Utils/Logger";
import OneUptimeDate from "../../Types/Date";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import TablePermission from "../Types/Database/Permissions/TablePermission";

/*
 * What OneUptime staff are told when the payment provider has no invoice by
 * the id they asked to void: it was deleted there, or the list they acted
 * from is stale.
 */
export const ADMIN_INVOICE_NOT_FOUND_MESSAGE: string =
  "The payment provider has no invoice with this ID. Reload the list, then try again.";

export const ADMIN_INVOICE_OF_ANOTHER_PROJECT_MESSAGE: string =
  "This invoice does not belong to this project.";

export const BILLING_DISABLED_NO_INVOICES_MESSAGE: string =
  "Billing is not enabled on this server, so projects have no invoices.";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.setDoNotAllowDelete(true);
  }

  /*
   * A project's invoices, newest first, as the payment provider has them -
   * for the Admin Dashboard, where OneUptime staff read them and void one the
   * customer should no longer pay. Read live: the BillingInvoice rows are the
   * customer's copy, rewritten whenever they open their own Invoices page.
   *
   * Each says which of the project's two subscriptions raised it, so staff
   * can tell the plan's invoice from the usage one before voiding either.
   */
  @CaptureSpan()
  public async getInvoicesForAdmin(
    projectId: ObjectID,
  ): Promise<Array<AdminProjectInvoice>> {
    if (!IsBillingEnabled) {
      throw new BadDataException(BILLING_DISABLED_NO_INVOICES_MESSAGE);
    }

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        _id: true,
        paymentProviderCustomerId: true,
        paymentProviderSubscriptionId: true,
        paymentProviderMeteredSubscriptionId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      throw new BadDataException(
        "This project no longer exists. It may have been deleted.",
      );
    }

    // A project with no customer at the payment provider was never invoiced.
    if (!project.paymentProviderCustomerId) {
      return [];
    }

    const invoices: Array<Invoice> = await BillingService.getInvoices(
      project.paymentProviderCustomerId,
    );

    return invoices
      .map((invoice: Invoice): AdminProjectInvoice => {
        return {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate.toISOString(),
          amount: invoice.amount,
          currencyCode: invoice.currencyCode,
          status: invoice.status,
          downloadableLink: invoice.downloadableLink || undefined,
          billedFor: this.getInvoiceBilledFor({ invoice, project }),
        };
      })
      .sort((a: AdminProjectInvoice, b: AdminProjectInvoice): number => {
        return (
          new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime()
        );
      });
  }

  private getInvoiceBilledFor(data: {
    invoice: Invoice;
    project: Project;
  }): InvoiceBilledFor | undefined {
    if (!data.invoice.subscriptionId) {
      return undefined;
    }

    if (
      data.invoice.subscriptionId === data.project.paymentProviderSubscriptionId
    ) {
      return InvoiceBilledFor.Plan;
    }

    if (
      data.invoice.subscriptionId ===
      data.project.paymentProviderMeteredSubscriptionId
    ) {
      return InvoiceBilledFor.Usage;
    }

    return undefined;
  }

  /*
   * Voids one of a project's invoices at the payment provider, from the Admin
   * Dashboard: the customer no longer owes it, and the provider stops trying
   * to collect it. Used when staff waive a charge - a plan invoice raised as a
   * trial ended, for a customer whose trial was then extended.
   *
   * The invoice is read back from the provider first. It is fetched by its id
   * alone, which reaches every customer's invoices, so it has to belong to
   * this project's customer, and it has to be one the provider can void.
   * Once it is void, the customer's copy and the project's subscription
   * statuses are brought up to date; neither may fail a void that already
   * happened, which retrying could only refuse.
   */
  @CaptureSpan()
  public async voidInvoiceForProject(data: {
    projectId: ObjectID;
    paymentProviderInvoiceId: string;
    voidedByUserId?: ObjectID | undefined;
  }): Promise<void> {
    if (!IsBillingEnabled) {
      throw new BadDataException(BILLING_DISABLED_NO_INVOICES_MESSAGE);
    }

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        _id: true,
        paymentProviderCustomerId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      throw new BadDataException(
        "This project no longer exists. It may have been deleted.",
      );
    }

    if (!project.paymentProviderCustomerId) {
      throw new BadDataException(
        "This project has no customer at the payment provider, so it has no invoices to void.",
      );
    }

    let invoice: Invoice;

    try {
      invoice = await BillingService.getInvoice(
        project.paymentProviderCustomerId,
        data.paymentProviderInvoiceId,
      );
    } catch (err) {
      // Anything but "no such invoice" says nothing about the invoice.
      if ((err as { code?: unknown } | null)?.code === "resource_missing") {
        throw new BadDataException(ADMIN_INVOICE_NOT_FOUND_MESSAGE);
      }

      throw err;
    }

    if (invoice.customerId !== project.paymentProviderCustomerId) {
      throw new BadDataException(ADMIN_INVOICE_OF_ANOTHER_PROJECT_MESSAGE);
    }

    if (!isInvoiceVoidable(invoice.status)) {
      throw new BadDataException(
        `Only an open or uncollectible invoice can be voided. This one is ${
          invoice.status || "in no status"
        }.`,
      );
    }

    await BillingService.voidInvoice(invoice.id);

    // Voiding waives what the customer owed, so it is logged with who did it.
    logger.info(
      `Invoice ${invoice.id} of project ${data.projectId.toString()} voided by master admin ${
        data.voidedByUserId?.toString() || "unknown"
      }`,
    );

    try {
      await this.updateOneBy({
        query: {
          projectId: data.projectId,
          paymentProviderInvoiceId: invoice.id,
        },
        data: {
          status: InvoiceStatus.Void,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    } catch (err) {
      logger.error(err, {
        projectId: data.projectId.toString(),
      } as LogAttributes);
    }

    try {
      await this.refreshSubscriptionStatus({ projectId: data.projectId });
    } catch (err) {
      logger.error(err, {
        projectId: data.projectId.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  public async refreshSubscriptionStatus(data: {
    projectId: ObjectID;
  }): Promise<void> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: data.projectId.toString(),
        namespace: "BillingInoviceService.refreshSubscriptionStatus",
        lockTimeout: 15000,
        acquireTimeout: 20000,
      });
      logger.debug(
        "Mutex acquired - " +
          data.projectId.toString() +
          " at " +
          OneUptimeDate.getCurrentDateAsFormattedString(),
      );
    } catch (err) {
      logger.debug(
        "Mutex acquire failed - " +
          data.projectId.toString() +
          " at " +
          OneUptimeDate.getCurrentDateAsFormattedString(),
      );
      logger.error(err, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
    }

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          paymentProviderCustomerId: true,
          paymentProviderSubscriptionId: true,
          paymentProviderMeteredSubscriptionId: true,
          billingMarketplace: true,
        },
      });

      /*
       * refresh the subscription status. This is a hack to ensure that the subscription status is always up to date.
       * This is because the subscription status can change at any time and we need to ensure that the subscription status is always up to date.
       */

      if (!project) {
        throw new BadDataException("Project not found");
      }

      /*
       * A cloud marketplace bills this project, and its status follows the
       * marketplace purchase (ProjectService.setMarketplaceBillingStatus).
       * The card invoices left from before the move must not decide it - and
       * paying one must never bring the card subscriptions back.
       */
      if (project.billingMarketplace) {
        return;
      }

      if (!project.paymentProviderCustomerId) {
        throw new BadDataException("Payment provider customer id not found.");
      }

      const subscriptionState: SubscriptionStatus =
        await BillingService.getSubscriptionStatus(
          project.paymentProviderSubscriptionId as string,
        );

      const meteredSubscriptionState: SubscriptionStatus =
        await BillingService.getSubscriptionStatus(
          project.paymentProviderMeteredSubscriptionId as string,
        );

      // update the project.

      await ProjectService.updateOneById({
        id: project.id!,
        data: {
          paymentProviderSubscriptionStatus: subscriptionState,
          paymentProviderMeteredSubscriptionStatus: meteredSubscriptionState,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      if (
        SubscriptionStatusUtil.isSubscriptionInactive(
          meteredSubscriptionState,
        ) ||
        SubscriptionStatusUtil.isSubscriptionInactive(subscriptionState)
      ) {
        // check if all invoices are paid. If yes, then reactivate the subscription.

        const invoices: Array<Invoice> = await BillingService.getInvoices(
          project.paymentProviderCustomerId,
        );

        let allInvoicesPaid: boolean = true;

        for (const invoice of invoices) {
          if (
            invoice.status === InvoiceStatus.Open ||
            invoice.status === InvoiceStatus.Uncollectible
          ) {
            allInvoicesPaid = false;
            break;
          }
        }

        if (allInvoicesPaid) {
          try {
            await ProjectService.reactiveSubscription(project.id!);
          } catch (err) {
            logger.error(err, {
              projectId: data.projectId?.toString(),
            } as LogAttributes);
          }

          /*
           * No Open/Uncollectible invoices means the project has no outstanding
           * payment obligations, so we mark the subscription as Active. Stripe may
           * still report the (re)created subscription as "incomplete" until the
           * first payment confirms, which would otherwise surface a misleading
           * "invoices are unpaid" banner.
           */
          await ProjectService.updateOneById({
            id: project.id!,
            data: {
              paymentProviderSubscriptionStatus: SubscriptionStatus.Active,
              paymentProviderMeteredSubscriptionStatus:
                SubscriptionStatus.Active,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
        }
      }
    } finally {
      /*
       * Released on every exit. A Stripe or database error used to skip the
       * release, leaving the project locked until lockTimeout and making the
       * next pay attempt or invoice list wait out acquireTimeout first.
       */
      if (mutex) {
        try {
          await Semaphore.release(mutex);
          logger.debug(
            "Mutex released - " +
              data.projectId.toString() +
              " at " +
              OneUptimeDate.getCurrentDateAsFormattedString(),
          );
        } catch (err) {
          logger.debug(
            "Mutex release failed - " +
              data.projectId.toString() +
              " at " +
              OneUptimeDate.getCurrentDateAsFormattedString(),
          );
          logger.error(err, {
            projectId: data.projectId?.toString(),
          } as LogAttributes);
        }
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    if (!findBy.props.tenantId) {
      throw new BadDataException("ProjectID not found.");
    }

    /*
     * Only someone who may read the project's invoices makes OneUptime
     * refresh its subscription, ask the payment provider for its invoices
     * and write them all again: anyone else is refused here, before any of
     * it, as the read would refuse them after.
     */
    TablePermission.assertCallerMayReadTable(Model, findBy.props);

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

    /*
     * refresh the subscription status. This is a hack to ensure that the subscription status is always up to date.
     * This is because the subscription status can change at any time and we need to ensure that the subscription status is always up to date.
     */

    await this.refreshSubscriptionStatus({ projectId: findBy.props.tenantId! });

    if (!project) {
      throw new BadDataException("Project not found");
    }

    if (!project.paymentProviderCustomerId) {
      throw new BadDataException("Payment provider customer id not found.");
    }

    const invoices: Array<Invoice> = await BillingService.getInvoices(
      project.paymentProviderCustomerId,
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

    for (const invoice of invoices) {
      const billingInvoice: Model = new Model();

      billingInvoice.projectId = project.id!;

      billingInvoice.amount = invoice.amount;
      billingInvoice.downloadableLink = URL.fromString(
        invoice.downloadableLink,
      );
      billingInvoice.currencyCode = invoice.currencyCode;
      billingInvoice.paymentProviderCustomerId = invoice.customerId || "";
      billingInvoice.paymentProviderSubscriptionId =
        invoice.subscriptionId || "";
      billingInvoice.status =
        (invoice.status as InvoiceStatus) || InvoiceStatus.Undefined;
      billingInvoice.paymentProviderInvoiceId = invoice.id;
      billingInvoice.invoiceDate = invoice.invoiceDate;
      billingInvoice.invoiceNumber = invoice.invoiceNumber || "Unknown";

      await this.create({
        data: billingInvoice,
        props: {
          isRoot: true,
        },
      });
    }

    return { findBy, carryForward: invoices };
  }
}

export default new Service();
