import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnDelete, OnFind } from "../Types/Database/Hooks";
import BillingService, { PaymentMethod } from "./BillingService";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/BillingPaymentMethod";
import Project from "../../Models/DatabaseModels/Project";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Dictionary from "../../Types/Dictionary";
import ObjectID from "../../Types/ObjectID";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Every read of this model re-syncs it from the payment provider, and one
   * billing page render issues two list requests at once (the table itself,
   * and the unfiltered count beside it). That was 10 provider reads - four
   * payment-method types plus the customer, twice - fired simultaneously for a
   * single page, on top of a hard delete and re-insert of the same rows from
   * both requests at once. Against a rate-limited account that is what makes a
   * read fail; it also raced the two re-syncs against each other in Postgres.
   *
   * Collapse only requests that genuinely overlap in time: a caller arriving
   * while a sync is in flight awaits that one instead of starting a second.
   * Nothing is cached beyond the in-flight window, so a payment method added
   * a moment ago is still read fresh by the next request.
   */
  private syncsInFlight: Dictionary<Promise<Array<PaymentMethod>>> = {};

  private syncPaymentMethodsFromProvider(data: {
    projectId: ObjectID;
    customerId: string;
  }): Promise<Array<PaymentMethod>> {
    const key: string = data.projectId.toString();

    const inFlight: Promise<Array<PaymentMethod>> | undefined =
      this.syncsInFlight[key];
    if (inFlight) {
      return inFlight;
    }

    const sync: Promise<Array<PaymentMethod>> = this.runPaymentMethodSync(
      data,
    ).finally(() => {
      delete this.syncsInFlight[key];
    });

    this.syncsInFlight[key] = sync;

    return sync;
  }

  private async runPaymentMethodSync(data: {
    projectId: ObjectID;
    customerId: string;
  }): Promise<Array<PaymentMethod>> {
    const paymentMethods: Array<PaymentMethod> =
      await BillingService.getPaymentMethods(data.customerId);

    await this.deleteBy({
      query: {
        projectId: data.projectId,
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

      billingPaymentMethod.projectId = data.projectId;

      billingPaymentMethod.paymentMethodType = paymentMethod.type;
      billingPaymentMethod.last4Digits = paymentMethod.last4Digits;
      billingPaymentMethod.isDefault = paymentMethod.isDefault;
      billingPaymentMethod.paymentProviderPaymentMethodId = paymentMethod.id;
      billingPaymentMethod.paymentProviderCustomerId = data.customerId;

      await this.create({
        data: billingPaymentMethod,
        props: {
          isRoot: true,
        },
      });
    }

    return paymentMethods;
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

    if (!project) {
      throw new BadDataException("Project not found");
    }

    if (!project.paymentProviderCustomerId) {
      throw new BadDataException("Payment provider customer id not found.");
    }

    const paymentMethods: Array<PaymentMethod> =
      await this.syncPaymentMethodsFromProvider({
        projectId: project.id!,
        customerId: project.paymentProviderCustomerId,
      });

    return { findBy, carryForward: paymentMethods };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
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
          item.paymentProviderPaymentMethodId,
        );
      }
    }

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
