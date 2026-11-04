import { IsBillingEnabled } from "../EnvironmentConfig";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataObservabilitySetting";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";

/*
 * A project's Data Observability settings: one row, made with the defaults
 * the first time anything asks for it (getOrCreateForProject), so a planned
 * check reads the same limits whether or not anyone opened Settings.
 */

export const MIN_GIGABYTES_SCANNED_PER_CHECK: number = 1;
export const MAX_GIGABYTES_SCANNED_PER_CHECK: number = 10_000;
export const BYTES_IN_A_GIGABYTE: number = 1024 * 1024 * 1024;

// What checkValues reads of a create or an update, as whatever was sent.
export interface DataObservabilitySettingValues {
  maxGigabytesScannedPerCheck?: unknown;
  keepFailingRows?: unknown;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public static checkValues(data: DataObservabilitySettingValues): void {
    const gigabytes: unknown = data.maxGigabytesScannedPerCheck;

    if (
      gigabytes !== undefined &&
      gigabytes !== null &&
      (typeof gigabytes !== "number" ||
        !Number.isInteger(gigabytes) ||
        gigabytes < MIN_GIGABYTES_SCANNED_PER_CHECK ||
        gigabytes > MAX_GIGABYTES_SCANNED_PER_CHECK)
    ) {
      throw new BadDataException(
        `The most a check may read is a whole number of GB from ${MIN_GIGABYTES_SCANNED_PER_CHECK} to ${MAX_GIGABYTES_SCANNED_PER_CHECK}.`,
      );
    }

    // Rows would leave the customer's network for OneUptime's: never on Cloud.
    if (data.keepFailingRows === true && IsBillingEnabled) {
      throw new BadDataException(
        "OneUptime Cloud keeps no rows of your tables. Failing rows can be kept on a self-hosted install.",
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    Service.checkValues(createBy.data as DataObservabilitySettingValues);

    return { createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    Service.checkValues(
      updateBy.data as unknown as DataObservabilitySettingValues,
    );

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
        "Data Observability settings could not be created for this project.",
      );
    }

    return created;
  }

  public static allColumns(): Record<string, true> {
    return {
      _id: true,
      projectId: true,
      maxGigabytesScannedPerCheck: true,
      waitWhenDatabaseIsBusy: true,
      keepFailingRows: true,
    };
  }
}

export default new Service();
