import DatabaseService from "./DatabaseService";
import MonitorService from "./MonitorService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Model from "../../Models/DatabaseModels/MonitorTemplate";
import Monitor from "../../Models/DatabaseModels/Monitor";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface SyncLinkedMonitorsResult {
  totalLinkedMonitors: number;
  syncedMonitors: number;
}

/**
 * Subset of Monitor fields that a template push can overwrite. Anything
 * outside this set (name, description, labels, monitorType, etc.) is
 * intentionally never touched by sync — those are per-monitor concerns.
 */
export type SyncableTemplateField =
  | "monitorSteps"
  | "monitoringInterval"
  | "minimumProbeAgreement";

const ALL_SYNCABLE_FIELDS: ReadonlyArray<SyncableTemplateField> = [
  "monitorSteps",
  "monitoringInterval",
  "minimumProbeAgreement",
];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Count monitors created from this template.
   * Caller must already have read access on the template via the API layer.
   */
  @CaptureSpan()
  public async countLinkedMonitors(data: {
    monitorTemplateId: ObjectID;
    projectId: ObjectID;
  }): Promise<number> {
    const count: PositiveNumber = await MonitorService.countBy({
      query: {
        monitorTemplateId: data.monitorTemplateId,
        projectId: data.projectId,
      },
      props: {
        isRoot: true,
      },
    });

    return count.toNumber();
  }

  /**
   * Validate and narrow a list of field names to the syncable subset.
   * Anything not in the whitelist throws — we never silently drop a field the
   * caller asked for, that would mask UI bugs.
   */
  private validateSyncableFields(
    fields: Array<string> | undefined,
  ): Array<SyncableTemplateField> {
    if (!fields || fields.length === 0) {
      return [...ALL_SYNCABLE_FIELDS];
    }

    const allowed: Set<string> = new Set(ALL_SYNCABLE_FIELDS);
    for (const field of fields) {
      if (!allowed.has(field)) {
        throw new BadDataException(
          `Field "${field}" is not syncable from a monitor template`,
        );
      }
    }
    return fields as Array<SyncableTemplateField>;
  }

  private buildUpdateData(
    template: Model,
    fields: Array<SyncableTemplateField>,
  ): Partial<Monitor> {
    const updateData: Partial<Monitor> = {};

    for (const field of fields) {
      const value: unknown = (template as unknown as Record<string, unknown>)[
        field
      ];
      if (value === undefined) {
        continue;
      }
      (updateData as unknown as Record<string, unknown>)[field] = value;
    }

    return updateData;
  }

  /**
   * Push the template's current configuration onto every monitor that was
   * created from it. Sync is intentionally explicit (button-triggered) so a
   * config tweak doesn't silently re-deploy across the whole fleet.
   *
   * Pass `fields` to scope the sync — e.g. `["monitorSteps"]` to push only the
   * criteria. If omitted, every syncable field is pushed.
   */
  @CaptureSpan()
  public async syncLinkedMonitors(data: {
    monitorTemplateId: ObjectID;
    props: DatabaseCommonInteractionProps;
    fields?: Array<string>;
  }): Promise<SyncLinkedMonitorsResult> {
    const fields: Array<SyncableTemplateField> = this.validateSyncableFields(
      data.fields,
    );

    const template: Model | null = await this.findOneById({
      id: data.monitorTemplateId,
      select: {
        _id: true,
        projectId: true,
        monitorSteps: true,
        monitoringInterval: true,
        minimumProbeAgreement: true,
      },
      props: data.props,
    });

    if (!template) {
      throw new BadDataException("Monitor template not found");
    }

    if (!template.projectId) {
      throw new BadDataException("Monitor template is missing projectId");
    }

    const totalLinkedMonitors: number = await this.countLinkedMonitors({
      monitorTemplateId: template.id!,
      projectId: template.projectId,
    });

    if (totalLinkedMonitors === 0) {
      return {
        totalLinkedMonitors: 0,
        syncedMonitors: 0,
      };
    }

    const updateData: Partial<Monitor> = this.buildUpdateData(template, fields);

    if (Object.keys(updateData).length === 0) {
      return {
        totalLinkedMonitors,
        syncedMonitors: 0,
      };
    }

    const syncedMonitors: number = await MonitorService.updateBy({
      query: {
        monitorTemplateId: template.id!,
        projectId: template.projectId,
      },
      data: updateData as any,
      limit: LIMIT_MAX,
      skip: 0,
      props: data.props,
    });

    return {
      totalLinkedMonitors,
      syncedMonitors,
    };
  }

  /**
   * Sync the template's current configuration onto a single monitor that was
   * created from it. The monitor must be linked to this template — passing an
   * arbitrary monitor ID is rejected so the endpoint can't be tricked into
   * pushing config to an unrelated monitor.
   *
   * Pass `fields` to scope the sync; if omitted, every syncable field is
   * pushed.
   */
  @CaptureSpan()
  public async syncToMonitor(data: {
    monitorTemplateId: ObjectID;
    monitorId: ObjectID;
    props: DatabaseCommonInteractionProps;
    fields?: Array<string>;
  }): Promise<void> {
    const fields: Array<SyncableTemplateField> = this.validateSyncableFields(
      data.fields,
    );

    const template: Model | null = await this.findOneById({
      id: data.monitorTemplateId,
      select: {
        _id: true,
        projectId: true,
        monitorSteps: true,
        monitoringInterval: true,
        minimumProbeAgreement: true,
      },
      props: data.props,
    });

    if (!template) {
      throw new BadDataException("Monitor template not found");
    }

    if (!template.projectId) {
      throw new BadDataException("Monitor template is missing projectId");
    }

    const monitor: Monitor | null = await MonitorService.findOneById({
      id: data.monitorId,
      select: {
        _id: true,
        projectId: true,
        monitorTemplateId: true,
      },
      props: { isRoot: true },
    });

    if (!monitor) {
      throw new BadDataException("Monitor not found");
    }

    if (
      !monitor.monitorTemplateId ||
      monitor.monitorTemplateId.toString() !== template.id!.toString()
    ) {
      throw new BadDataException("Monitor is not linked to this template");
    }

    if (
      !monitor.projectId ||
      monitor.projectId.toString() !== template.projectId.toString()
    ) {
      throw new BadDataException(
        "Monitor and template belong to different projects",
      );
    }

    const updateData: Partial<Monitor> = this.buildUpdateData(template, fields);

    if (Object.keys(updateData).length === 0) {
      return;
    }

    await MonitorService.updateOneById({
      id: data.monitorId,
      data: updateData as any,
      props: data.props,
    });
  }
}
export default new Service();
