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
   * Push the template's current configuration onto every monitor that was
   * created from it. Sync is intentionally explicit (button-triggered) so a
   * config tweak doesn't silently re-deploy across the whole fleet.
   *
   * Synced fields: monitorSteps, monitoringInterval, minimumProbeAgreement.
   * Per-monitor identity (name, description) and the monitor type are left
   * alone. Labels are left alone too — users routinely customize labels on
   * individual monitors after creation.
   */
  @CaptureSpan()
  public async syncLinkedMonitors(data: {
    monitorTemplateId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SyncLinkedMonitorsResult> {
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

    const updateData: Partial<Monitor> = {};

    if (template.monitorSteps !== undefined) {
      updateData.monitorSteps = template.monitorSteps;
    }
    if (template.monitoringInterval !== undefined) {
      updateData.monitoringInterval = template.monitoringInterval;
    }
    if (template.minimumProbeAgreement !== undefined) {
      updateData.minimumProbeAgreement = template.minimumProbeAgreement;
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
}
export default new Service();
