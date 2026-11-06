import Model from "../../Models/DatabaseModels/OpenStackBudget";
import { readCloudBudgetThresholds } from "../../Types/Cloud/CloudCost";
import BadDataException from "../../Types/Exception/BadDataException";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * What an OpenStack project may come to in a month (OpenStackBudget). Guards it as it is written: an
 * amount above zero, and the thresholds as whole percents. The next reading of the cloud's usage
 * compares it (OpenStackBudgetEvaluator), which is at most a quarter of an hour away.
 */

export const OPENSTACK_BUDGET_AMOUNT_ERROR: string =
  "The monthly amount must be a number greater than 0.";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // An amount as a number above zero; a form's number field sends text.
  public normalizeAmount(value: unknown): number {
    const amount: number =
      typeof value === "string"
        ? value.trim() === ""
          ? Number.NaN
          : Number(value.trim())
        : typeof value === "number"
          ? value
          : Number.NaN;

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadDataException(OPENSTACK_BUDGET_AMOUNT_ERROR);
    }

    return amount;
  }

  public normalizeThresholds(value: unknown): string {
    return readCloudBudgetThresholds(value).join(",");
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    createBy.data.monthlyAmount = this.normalizeAmount(
      createBy.data.monthlyAmount as unknown,
    );

    if (createBy.data.alertThresholds !== undefined) {
      createBy.data.alertThresholds = this.normalizeThresholds(
        createBy.data.alertThresholds,
      );
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    // Each only when the request sent it: an edit of the name leaves the rest.
    if (
      updateBy.data.monthlyAmount !== undefined &&
      updateBy.data.monthlyAmount !== null
    ) {
      updateBy.data.monthlyAmount = this.normalizeAmount(
        updateBy.data.monthlyAmount as unknown,
      );
    }

    if (
      updateBy.data.alertThresholds !== undefined &&
      updateBy.data.alertThresholds !== null
    ) {
      updateBy.data.alertThresholds = this.normalizeThresholds(
        updateBy.data.alertThresholds,
      );
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
