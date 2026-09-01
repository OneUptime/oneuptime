import DatabaseService from "./DatabaseService";
import NetworkDeviceAutoImportRuleService from "./NetworkDeviceAutoImportRuleService";
import NetworkDeviceService from "./NetworkDeviceService";
import Model from "../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Query from "../Types/Database/Query";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import SnmpOid from "../../Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpOidListUtil, {
  MAX_OIDS_PER_TEMPLATE,
} from "../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * OID Collection Templates carry COLLECTION config for a whole device type,
 * so this service has exactly three jobs and deliberately no fourth:
 *
 *   1. Refuse a malformed OID list at save time. Nothing validated snmpOids
 *      before, which was survivable when one bad row broke one device; with
 *      a template it would break every device linked to it.
 *   2. Answer "how many devices use this?" for the UI.
 *   3. Refuse to delete a template that devices are still using.
 *
 * There is no syncToDevices, no onUpdateSuccess, and no fan-out of any kind.
 * The template is resolved live against each device at poll time in
 * NetworkDevicePoll, so there is nothing to push and nothing to reconcile -
 * see the model's class comment for why that inverts MonitorTemplate.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (createBy.data.oids !== undefined) {
      createBy.data.oids = SnmpOidListUtil.validateOidList(createBy.data.oids, {
        max: MAX_OIDS_PER_TEMPLATE,
        label: "OID Collection Template",
      });
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * `!== undefined` rather than a truthiness check: an explicit empty array
     * is a legitimate "this template collects nothing" edit, and
     * validateOidList accepts it.
     */
    if (updateBy.data.oids !== undefined) {
      updateBy.data.oids = SnmpOidListUtil.validateOidList(
        updateBy.data.oids as Array<SnmpOid>,
        {
          max: MAX_OIDS_PER_TEMPLATE,
          label: "OID Collection Template",
        },
      );
    }

    return { updateBy, carryForward: null };
  }

  /*
   * Deleting a template devices still use would silently drop OIDs from every
   * one of them: the FK is ON DELETE SET NULL, so those devices just quietly
   * fall back to their own lists on the next poll with nothing to tell
   * anyone. Refuse, and say how many devices are in the way.
   *
   * Counting rather than keeping a rollup column is deliberate - a maintained
   * counter would make this row hot under every device create and rebind, and
   * MonitorTemplateService.countLinkedMonitors already set the precedent.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const templatesToDelete: Array<Model> = await this.findBy({
      /*
       * This hook runs BEFORE DatabaseService permission-checks the query, so
       * a raw isRoot read of deleteBy.query would hand back other tenants'
       * templates. Re-apply the caller's tenant, exactly as NetworkSiteService
       * does for the same reason.
       */
      query: this.scopeQueryToCallerTenant(deleteBy.query, deleteBy.props),
      select: {
        _id: true,
        name: true,
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const template of templatesToDelete) {
      if (!template.id || !template.projectId) {
        continue;
      }

      const linkedDeviceCount: number = await this.countLinkedDevices({
        templateId: template.id,
        projectId: template.projectId,
      });

      if (linkedDeviceCount > 0) {
        throw new BadDataException(
          `${template.name || "This OID Collection Template"} is still used by ${linkedDeviceCount} network device(s). Move those devices to another template, or clear their template, before deleting it.`,
        );
      }

      /*
       * Auto-import rules count too, and for the same reason.
       *
       * The FK there is also ON DELETE SET NULL, so deleting a template a rule
       * still names does not fail - it silently turns that rule back into one
       * that imports devices collecting nothing, and the next discovery scan
       * quietly produces a fleet nobody configured. A rule can hold the last
       * reference to a template with zero devices linked yet (it was created
       * ahead of the scan), which is exactly when the device count alone says
       * the delete is safe.
       */
      const linkedRuleCount: PositiveNumber =
        await NetworkDeviceAutoImportRuleService.countBy({
          query: {
            projectId: template.projectId,
            oidTemplateId: template.id,
          },
          props: {
            isRoot: true,
          },
        });

      if (linkedRuleCount.toNumber() > 0) {
        throw new BadDataException(
          `${template.name || "This OID Collection Template"} is still used by ${linkedRuleCount.toNumber()} auto-import rule(s). Clear it from those rules before deleting it, or devices they import will collect nothing.`,
        );
      }
    }

    return { deleteBy, carryForward: null };
  }

  /**
   * How many devices collect this template's OIDs. Used by the template page
   * and by the delete guard above.
   */
  @CaptureSpan()
  public async countLinkedDevices(data: {
    templateId: ObjectID;
    projectId: ObjectID;
  }): Promise<number> {
    const count: PositiveNumber = await NetworkDeviceService.countBy({
      query: {
        projectId: data.projectId,
        oidTemplateId: data.templateId,
      },
      props: {
        isRoot: true,
      },
    });

    return count.toNumber();
  }

  /*
   * See NetworkSiteService for the full explanation: hooks run before
   * ModelPermission scopes the caller's query, so anything a hook reads with
   * isRoot has to be re-scoped by hand or it spans projects.
   */
  private scopeQueryToCallerTenant(
    query: Query<Model>,
    props: DatabaseCommonInteractionProps,
  ): Query<Model> {
    if (props.isRoot || !props.tenantId) {
      return query;
    }

    return {
      ...query,
      projectId: props.tenantId,
    };
  }
}

export default new Service();
