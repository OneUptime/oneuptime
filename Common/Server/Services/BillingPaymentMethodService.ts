import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnDelete, OnFind } from "../Types/Database/Hooks";
import BillingService, { PaymentMethod } from "./BillingService";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "Common/Models/DatabaseModels/BillingPaymentMethod";
import Project from "Common/Models/DatabaseModels/Project";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

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
      await BillingService.getPaymentMethods(project.paymentProviderCustomerId);

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
      billingPaymentMethod.paymentProviderPaymentMethodId = paymentMethod.id;
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
