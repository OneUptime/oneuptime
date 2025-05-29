import FindBy from "../Types/Database/FindBy";
import { OnFind } from "../Types/Database/Hooks";
import BillingService, { Invoice } from "./BillingService";
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
import logger from "../Utils/Logger";
import OneUptimeDate from "../../Types/Date";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.setDoNotAllowDelete(true);
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
      logger.error(err);
    }

    let project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        paymentProviderCustomerId: true,
        paymentProviderSubscriptionId: true,
        paymentProviderMeteredSubscriptionId: true,
      },
    });

    // refresh the subscription status. This is a hack to ensure that the subscription status is always up to date.
    // This is because the subscription status can change at any time and we need to ensure that the subscription status is always up to date.

    if (!project) {
      throw new BadDataException("Project not found");
    }

    if (!project.paymentProviderCustomerId) {
      throw new BadDataException("Payment provider customer id not found.");
    }

    let subscriptionState: SubscriptionStatus =
      await BillingService.getSubscriptionStatus(
        project.paymentProviderSubscriptionId as string,
      );

    let meteredSubscriptionState: SubscriptionStatus =
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
      SubscriptionStatusUtil.isSubscriptionInactive(meteredSubscriptionState) ||
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
        await ProjectService.reactiveSubscription(project.id!);
        project = await ProjectService.findOneById({
          id: data.projectId,
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            paymentProviderCustomerId: true,
            paymentProviderSubscriptionId: true,
            paymentProviderMeteredSubscriptionId: true,
          },
        });

        if (!project) {
          throw new BadDataException("Project not found");
        }

        subscriptionState = await BillingService.getSubscriptionStatus(
          project.paymentProviderSubscriptionId as string,
        );

        meteredSubscriptionState = await BillingService.getSubscriptionStatus(
          project.paymentProviderMeteredSubscriptionId as string,
        );

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
      }
    }

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
        logger.error(err);
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

    // refresh the subscription status. This is a hack to ensure that the subscription status is always up to date.
    // This is because the subscription status can change at any time and we need to ensure that the subscription status is always up to date.

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
