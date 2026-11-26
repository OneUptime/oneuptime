import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/CloudCostSetting";
import {
  isCloudCommitmentExpiryDaysText,
  readCloudCommitmentExpiryDays,
} from "../../Types/Cloud/CloudCommitmentAlerts";
import {
  CLOUD_COST_DEFAULT_BASIS,
  CloudCostBasis,
  isCloudCostBasis,
} from "../../Types/Cloud/CloudCostBasis";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * A project's cloud cost settings (CloudCostSetting): one row, made with
 * the defaults the first time anything asks for it (getOrCreateForProject),
 * so budgets and commitment alerts read the same defaults whether or not
 * anyone opened Cloud > Settings > Costs. It guards what is written: a
 * cost basis that is one, days before a commitment ends as whole days,
 * and thresholds as percents.
 */

export const CLOUD_COST_BASIS_ERROR: string =
  "The cost basis must be billed, amortized or net.";
export const CLOUD_COMMITMENT_EXPIRY_DAYS_ERROR: string =
  "Write the days before a commitment ends as whole days, separated by commas, such as 90, 30, 7.";
export const CLOUD_COMMITMENT_THRESHOLD_ERROR: string =
  "A threshold is a percent from 1 to 100.";

// What checkValues reads of a create or an update, as whatever was sent.
export interface CloudCostSettingValues {
  costBasis?: unknown;
  commitmentExpiryAlertDays?: unknown;
  commitmentUtilizationThreshold?: unknown;
  commitmentCoverageThreshold?: unknown;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // A percent from 1 to 100; empty only where the setting may be off.
  private static checkPercent(value: unknown, mayBeEmpty: boolean): void {
    if (value === undefined) {
      return;
    }

    if (value === null || value === "") {
      if (mayBeEmpty) {
        return;
      }

      throw new BadDataException(CLOUD_COMMITMENT_THRESHOLD_ERROR);
    }

    const percent: number = Number(value);

    if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
      throw new BadDataException(CLOUD_COMMITMENT_THRESHOLD_ERROR);
    }
  }

  /*
   * Throws, in words the person can act on, for anything that is not a
   * setting's value. Returns the days before an end as they are kept: the
   * furthest first, "90, 30, 7".
   */
  public static checkValues(data: CloudCostSettingValues): string | undefined {
    if (
      data.costBasis !== undefined &&
      data.costBasis !== null &&
      !isCloudCostBasis(data.costBasis)
    ) {
      throw new BadDataException(CLOUD_COST_BASIS_ERROR);
    }

    Service.checkPercent(data.commitmentUtilizationThreshold, false);
    Service.checkPercent(data.commitmentCoverageThreshold, true);

    if (
      data.commitmentExpiryAlertDays === undefined ||
      data.commitmentExpiryAlertDays === null
    ) {
      return undefined;
    }

    if (
      typeof data.commitmentExpiryAlertDays !== "string" ||
      !isCloudCommitmentExpiryDaysText(data.commitmentExpiryAlertDays)
    ) {
      throw new BadDataException(CLOUD_COMMITMENT_EXPIRY_DAYS_ERROR);
    }

    return readCloudCommitmentExpiryDays(data.commitmentExpiryAlertDays).join(
      ", ",
    );
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const days: string | undefined = Service.checkValues(
      createBy.data as unknown as CloudCostSettingValues,
    );

    if (days !== undefined) {
      createBy.data.commitmentExpiryAlertDays = days;
    }

    return { createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const days: string | undefined = Service.checkValues(
      updateBy.data as unknown as CloudCostSettingValues,
    );

    if (days !== undefined) {
      updateBy.data.commitmentExpiryAlertDays = days;
    }

    return { updateBy, carryForward: undefined };
  }

  /*
   * The project's settings, made with every default when there are none
   * yet. Two callers racing to make the row both end up reading the one the
   * unique index kept.
   */
  @CaptureSpan()
  public async getOrCreateForProject(projectId: ObjectID): Promise<Model> {
    const existing: Model | null = await this.findOneBy({
      query: { projectId },
      select: Service.allColumns(),
      props: { isRoot: true },
    });

    if (existing) {
      return existing;
    }

    const setting: Model = new Model();
    setting.projectId = projectId;

    try {
      await this.create({ data: setting, props: { isRoot: true } });
    } catch {
      // Another caller made it first; read theirs below.
    }

    const created: Model | null = await this.findOneBy({
      query: { projectId },
      select: Service.allColumns(),
      props: { isRoot: true },
    });

    if (!created) {
      throw new BadDataException(
        "Cloud cost settings could not be created for this project.",
      );
    }

    return created;
  }

  /*
   * The project's cost basis, without making its settings: the default
   * when it has none yet. What budgets that follow the project read.
   */
  @CaptureSpan()
  public async getCostBasisOfProject(
    projectId: ObjectID,
  ): Promise<CloudCostBasis> {
    const setting: Model | null = await this.findOneBy({
      query: { projectId },
      select: { costBasis: true },
      props: { isRoot: true },
    });

    return isCloudCostBasis(setting?.costBasis)
      ? setting!.costBasis!
      : CLOUD_COST_DEFAULT_BASIS;
  }

  public static allColumns(): Record<string, unknown> {
    return {
      _id: true,
      projectId: true,
      costBasis: true,
      isCommitmentAlertsEnabled: true,
      commitmentExpiryAlertDays: true,
      commitmentUtilizationThreshold: true,
      commitmentCoverageThreshold: true,
      commitmentAlertSeverityId: true,
      commitmentOnCallDutyPolicies: { _id: true },
      commitmentAlertOwnerUsers: { _id: true },
      commitmentAlertOwnerTeams: { _id: true },
      commitmentAlertState: true,
    };
  }
}

export default new Service();
