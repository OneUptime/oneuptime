import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataSecuritySetting";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";

/*
 * A project's Data Security settings: one row, made with the defaults the
 * first time anything asks for it (getOrCreateForProject), so every job and
 * page reads the same switches whether or not anyone opened Settings. The
 * scan limits are held to ranges a scan can honour: enough to find data,
 * never enough to read a store whole or hold a worker for an hour.
 */

export interface DataSecurityLimitRange {
  min: number;
  max: number;
  label: string;
}

export const DATA_SECURITY_LIMITS: Readonly<
  Record<string, DataSecurityLimitRange>
> = {
  maxObjectsPerScan: { min: 10, max: 50000, label: "Objects per scan" },
  maxBytesPerObject: { min: 1024, max: 4194304, label: "Bytes per object" },
  maxBytesPerScan: { min: 65536, max: 1073741824, label: "Bytes per scan" },
  maxRowsPerTable: { min: 10, max: 100000, label: "Rows per table" },
  maxTablesPerScan: { min: 1, max: 5000, label: "Tables per scan" },
  telemetrySampleSize: { min: 10, max: 10000, label: "Telemetry sample size" },
  contentScanIntervalInHours: {
    min: 1,
    max: 720,
    label: "Scan every (hours)",
  },
};

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public static checkLimits(data: Record<string, unknown>): void {
    for (const [column, range] of Object.entries(DATA_SECURITY_LIMITS)) {
      const value: unknown = data[column];

      if (value === undefined || value === null) {
        continue;
      }

      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < range.min ||
        value > range.max
      ) {
        throw new BadDataException(
          `${range.label} must be a whole number from ${range.min} to ${range.max}.`,
        );
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    Service.checkLimits(createBy.data as unknown as Record<string, unknown>);

    return { createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    Service.checkLimits(updateBy.data as unknown as Record<string, unknown>);

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
        "Data Security settings could not be created for this project.",
      );
    }

    return created;
  }

  public static allColumns(): Record<string, true> {
    return {
      _id: true,
      projectId: true,
      isConfigurationScanEnabled: true,
      isContentScanEnabled: true,
      isTelemetryScanEnabled: true,
      keepMaskedSamples: true,
      openCasesForCriticalIssues: true,
      raiseAlertsForCriticalIssues: true,
      alertSeverityId: true,
      notifyOwners: true,
      maxObjectsPerScan: true,
      maxBytesPerObject: true,
      maxBytesPerScan: true,
      maxRowsPerTable: true,
      maxTablesPerScan: true,
      telemetrySampleSize: true,
      contentScanIntervalInHours: true,
      allowedValues: true,
      disabledDataTypeIds: true,
      useAiForAmbiguousFields: true,
    };
  }
}

export default new Service();
