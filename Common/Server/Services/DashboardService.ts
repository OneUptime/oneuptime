import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/Dashboard";
import { IsBillingEnabled } from "../EnvironmentConfig";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import DashboardViewConfigUtil from "../../Utils/Dashboard/DashboardViewConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (IsBillingEnabled) {
      // then if free plan, make sure it can only have 1 dashboard.

      if (createBy.props.currentPlan === PlanType.Free) {
        // get count by project id.
        const count: number = (
          await this.countBy({
            query: {
              projectId: createBy.data.projectId,
            },
            props: {
              isRoot: true,
            },
          })
        ).toNumber();

        if (count > 0) {
          throw new BadDataException(
            "Free plan can only have 1 dashboard. Please upgrade your plan.",
          );
        }
      }
    }

    // make sure dashboard config is empty.
    createBy.data.dashboardViewConfig =
      DashboardViewConfigUtil.createDefaultDashboardViewConfig();

    return Promise.resolve({ createBy, carryForward: null });
  }
}

export default new Service();
