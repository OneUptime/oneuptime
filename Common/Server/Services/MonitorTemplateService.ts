import DatabaseService from "./DatabaseService";
import MonitorService from "./MonitorService";
import NetworkAlertPolicyEngineService from "./NetworkAlertPolicyEngineService";
import NetworkAlertPolicyService from "./NetworkAlertPolicyService";
import NetworkDeviceAutoImportRuleService from "./NetworkDeviceAutoImportRuleService";
import NetworkAlertPolicy from "../../Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDeviceAutoImportRule from "../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import MonitorStepsProjectValidator from "../Utils/Monitor/MonitorStepsProjectValidator";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import Includes from "../../Types/BaseDatabase/Includes";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import { JSONObject } from "../../Types/JSON";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Model from "../../Models/DatabaseModels/MonitorTemplate";
import Monitor from "../../Models/DatabaseModels/Monitor";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import MonitorTemplateCustomFieldUtil from "../../Utils/Monitor/MonitorTemplateCustomFieldUtil";
import NetworkDeviceMonitorTemplateUtil from "../../Utils/Monitor/NetworkDeviceMonitorTemplateUtil";
import MonitorTemplateDestinationUtil from "../../Utils/Monitor/MonitorTemplateDestinationUtil";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import ModelPermission from "../Types/Database/Permissions/Index";
import Query from "../Types/Database/Query";

export interface SyncLinkedMonitorsResult {
  totalLinkedMonitors: number;
  syncedMonitors: number;
}

/**
 * Subset of Monitor fields that a template push can overwrite. Anything
 * outside this set (name, description, monitorType, etc.) is intentionally
 * never touched by sync — those are per-monitor concerns.
 */
export type SyncableTemplateField =
  | "monitorSteps"
  | "monitoringInterval"
  | "minimumProbeAgreement"
  | "labels"
  | "customFields";

const SYNCABLE_FIELDS: ReadonlyArray<SyncableTemplateField> = [
  "monitorSteps",
  "monitoringInterval",
  "minimumProbeAgreement",
  "labels",
  "customFields",
];

/*
 * What an UNSCOPED sync pushes — every syncable field except custom field
 * defaults.
 *
 * Custom fields are the one syncable thing whose per-monitor value is
 * ordinarily typed in by hand: a monitor's Configuration Item or Vendor is
 * about that device, not about the template. A caller that names no fields is
 * saying "push the template", not "and also rewrite every operator-entered
 * value in the fleet", so custom fields ship only when asked for by name —
 * which is what the dedicated button on the template's Custom Field Defaults
 * card does. The dashboard always scopes its syncs, so this only decides what
 * an API caller gets by default.
 */
const DEFAULT_SYNCABLE_FIELDS: ReadonlyArray<SyncableTemplateField> = [
  "monitorSteps",
  "monitoringInterval",
  "minimumProbeAgreement",
  "labels",
];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  private validateTemplateMonitorSteps(
    monitorSteps: MonitorSteps | JSONObject | undefined,
    monitorType: MonitorType | undefined,
  ): void {
    if (!monitorSteps) {
      return;
    }

    if (!monitorType) {
      throw new BadDataException("Monitor type is required");
    }

    const error: string | null = MonitorSteps.getValidationError(
      MonitorSteps.fromJSON(monitorSteps),
      monitorType,
      { isMonitorTemplate: true },
    );

    if (error) {
      throw new BadDataException(error);
    }
  }

  /*
   * A template's monitorSteps embeds the same reference ids a monitor's does,
   * and every one of them reaches a real monitor eventually — through "create
   * monitor from template" and through syncLinkedMonitors, which pushes the
   * blob onto every linked monitor. Validating it here is what makes the error
   * land on the template the bad id was typed into, rather than on a monitor
   * sync days later. Without this the template is the one place a dangling id
   * can still enter the system.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    this.validateTemplateMonitorSteps(
      createBy.data.monitorSteps,
      createBy.data.monitorType,
    );

    await MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
      monitorSteps: createBy.data.monitorSteps,
      projectId: createBy.props.tenantId || createBy.data.projectId,
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (!updateBy.data.monitorSteps && !updateBy.data.monitorType) {
      return { updateBy, carryForward: null };
    }

    /*
     * Per matched template, so each is checked against its own project and its
     * own currently-stored ids — see MonitorService.onBeforeUpdate for why the
     * stored ids matter.
     */
    const templates: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        projectId: true,
        monitorSteps: true,
        monitorType: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    for (const template of templates) {
      this.validateTemplateMonitorSteps(
        updateBy.data.monitorSteps === undefined
          ? template.monitorSteps
          : (updateBy.data.monitorSteps as MonitorSteps | JSONObject),
        (updateBy.data.monitorType as MonitorType | undefined) ||
          template.monitorType,
      );

      if (!updateBy.data.monitorSteps) {
        continue;
      }

      await MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: updateBy.data.monitorSteps as MonitorSteps | JSONObject,
        projectId: updateBy.props.tenantId || template.projectId,
        alreadyStoredMonitorSteps: template.monitorSteps,
      });
    }

    return { updateBy, carryForward: null };
  }

  /*
   * A template that something PROVISIONS FROM cannot be deleted.
   *
   * Both foreign keys pointing here are ON DELETE SET NULL, so without this
   * guard the delete succeeds and the damage is silent and deferred:
   *
   *   - A NETWORK ALERT POLICY loses its template and stops provisioning.
   *     Its existing monitors stay (they are the fleet's incident history)
   *     but nothing new is ever covered, and the settings table shows a
   *     policy that looks live and is not. The operator finds out when a
   *     switch they added last month turns out never to have been alerted
   *     on. There is no undo either: pointing the policy at a replacement
   *     template makes the engine tear the old fleet down and re-clone it.
   *   - An AUTO-IMPORT RULE loses its template and quietly imports devices
   *     with no monitor at all, which is the same failure one scan later.
   *
   * So the delete is refused, by name and by count, and the operator is
   * told which thing to detach first. This is the same contract
   * NetworkDeviceOidTemplateService.onBeforeDelete enforces for OID
   * templates, and it is the reason the policy's SET NULL branch is a
   * backstop rather than a path anything takes on purpose.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const templatesToDelete: Array<Model> = await this.findBy({
      /*
       * This hook runs BEFORE DatabaseService permission-checks the query, so
       * a raw isRoot read of deleteBy.query would hand back other tenants'
       * templates — and their policy names in the refusal message with them.
       */
      query: this.scopeQueryToCallerTenant(deleteBy.query, deleteBy.props),
      select: {
        _id: true,
        templateName: true,
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

      const templateName: string =
        template.templateName || "This monitor template";

      const policies: Array<NetworkAlertPolicy> =
        await NetworkAlertPolicyService.findBy({
          query: {
            projectId: template.projectId,
            monitorTemplateId: template.id,
          },
          select: {
            _id: true,
            name: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      if (policies.length > 0) {
        throw new BadDataException(
          `${templateName} is used by ${policies.length} network alert ${
            policies.length === 1 ? "policy" : "policies"
          } (${this.describeNames(
            policies.map((policy: NetworkAlertPolicy): string => {
              return policy.name || policy.id?.toString() || "unnamed";
            }),
          )}). Point ${
            policies.length === 1 ? "it" : "them"
          } at another template, or delete ${
            policies.length === 1 ? "it" : "them"
          }, before deleting this template.`,
        );
      }

      const rules: Array<NetworkDeviceAutoImportRule> =
        await NetworkDeviceAutoImportRuleService.findBy({
          query: {
            projectId: template.projectId,
            monitorTemplateId: template.id,
          },
          select: {
            _id: true,
            name: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      if (rules.length > 0) {
        throw new BadDataException(
          `${templateName} is used by ${rules.length} network device auto-import ${
            rules.length === 1 ? "rule" : "rules"
          } (${this.describeNames(
            rules.map((rule: NetworkDeviceAutoImportRule): string => {
              return rule.name || rule.id?.toString() || "unnamed";
            }),
          )}). Clear it from ${
            rules.length === 1 ? "that rule" : "those rules"
          } before deleting this template, or devices they import will have no monitor.`,
        );
      }
    }

    return { deleteBy, carryForward: null };
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

  /*
   * "Warehouse switches", "Warehouse switches and Core routers",
   * "Warehouse switches, Core routers and 3 more" — enough for the operator
   * to recognise what they have to detach, without pasting a hundred names
   * into a toast.
   */
  private describeNames(names: Array<string>): string {
    const MAX_NAMED: number = 3;

    if (names.length <= MAX_NAMED) {
      if (names.length === 1) {
        return names[0] as string;
      }

      return `${names.slice(0, names.length - 1).join(", ")} and ${
        names[names.length - 1]
      }`;
    }

    return `${names.slice(0, MAX_NAMED).join(", ")} and ${
      names.length - MAX_NAMED
    } more`;
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
      return [...DEFAULT_SYNCABLE_FIELDS];
    }

    const allowed: Set<string> = new Set(SYNCABLE_FIELDS);
    for (const field of fields) {
      if (!allowed.has(field)) {
        throw new BadDataException(
          `Field "${field}" is not syncable from a monitor template`,
        );
      }
    }
    return fields as Array<SyncableTemplateField>;
  }

  /*
   * The part of the push that is identical for every linked monitor, so it can
   * ride a single bulk update.
   *
   * `customFields` is deliberately absent: a template's custom fields are
   * DEFAULTS overlaid on whatever the monitor already holds, which is a
   * different value per monitor and therefore cannot be one shared payload.
   * The two sync entry points below compute it per monitor instead — see
   * buildCustomFieldsUpdate.
   */
  private buildUpdateData(
    template: Model,
    fields: Array<SyncableTemplateField>,
  ): Partial<Monitor> {
    const updateData: Partial<Monitor> = {};

    for (const field of fields) {
      if (field === "customFields") {
        continue;
      }

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

  /*
   * Does this push carry custom field defaults that are worth a write?
   *
   * A template whose bag is absent, empty, or holds nothing but blanks has no
   * defaults to give, and saying so here is what stops a custom-fields-only
   * sync from taking the per-monitor path (and reporting a fleet-wide write)
   * to push nothing at all.
   */
  private hasCustomFieldDefaultsToSync(
    template: Model,
    fields: Array<SyncableTemplateField>,
  ): boolean {
    return (
      fields.includes("customFields") &&
      MonitorTemplateCustomFieldUtil.hasDefaults(template.customFields)
    );
  }

  /*
   * One monitor's custom field bag after the template's defaults are laid over
   * it: the template wins every field it actually defaults, and every other
   * value the operator entered on that monitor survives untouched.
   */
  private buildCustomFieldsUpdate(data: {
    template: Model;
    monitor: Monitor;
  }): JSONObject {
    return MonitorTemplateCustomFieldUtil.applyDefaults({
      templateCustomFields: data.template.customFields,
      monitorCustomFields: data.monitor.customFields,
    });
  }

  private buildMonitorUpdateData(
    template: Model,
    monitor: Monitor,
    fields: Array<SyncableTemplateField>,
  ): Partial<Monitor> {
    const updateData: Partial<Monitor> = this.buildUpdateData(template, fields);

    if (updateData.monitorSteps === undefined) {
      return updateData;
    }

    if (template.monitorType === MonitorType.NetworkDevice) {
      updateData.monitorSteps = monitor.autoProvisionedNetworkDeviceId
        ? NetworkDeviceMonitorTemplateUtil.rebindMonitorSteps({
            monitorSteps: template.monitorSteps,
            networkDeviceId: monitor.autoProvisionedNetworkDeviceId,
          })
        : NetworkDeviceMonitorTemplateUtil.buildSyncedMonitorSteps({
            templateMonitorSteps: template.monitorSteps,
            currentMonitorSteps: monitor.monitorSteps,
          });
    } else if (
      template.monitorType &&
      MonitorTemplateDestinationUtil.supportsMonitorType(template.monitorType)
    ) {
      updateData.monitorSteps =
        MonitorTemplateDestinationUtil.buildSyncedMonitorSteps({
          templateMonitorSteps: template.monitorSteps,
          currentMonitorSteps: monitor.monitorSteps,
          monitorType: template.monitorType,
        });
    }

    return updateData;
  }

  /**
   * Push the template's current configuration onto every monitor that was
   * created from it. Sync is intentionally explicit (button-triggered) so a
   * config tweak doesn't silently re-deploy across the whole fleet.
   *
   * Pass `fields` to scope the sync — e.g. `["monitorSteps"]` to push only the
   * criteria and check settings. Blank template targets retain monitor values.
   * If omitted, DEFAULT_SYNCABLE_FIELDS is pushed.
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
        monitorType: true,
        monitorSteps: true,
        monitoringInterval: true,
        minimumProbeAgreement: true,
        customFields: true,
        labels: {
          _id: true,
        },
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

    /*
     * Custom field defaults never ride in updateData — the value written
     * depends on what each monitor already holds — so they are their own
     * reason for this push to have work to do.
     */
    const syncCustomFields: boolean = this.hasCustomFieldDefaultsToSync(
      template,
      fields,
    );

    if (Object.keys(updateData).length === 0 && !syncCustomFields) {
      return {
        totalLinkedMonitors,
        syncedMonitors: 0,
      };
    }

    /*
     * Target fields left blank in the template retain each monitor's values.
     * Merge them independently before writing. Network Device provisioning
     * additionally retains the device that owns the discovered monitor.
     */
    const rebindMonitorSteps: boolean =
      (template.monitorType === MonitorType.NetworkDevice ||
        MonitorTemplateDestinationUtil.supportsMonitorType(
          template.monitorType,
        )) &&
      updateData.monitorSteps !== undefined;

    /*
     * Custom field defaults take the same row-at-a-time path for their own
     * reason: they are overlaid on the monitor's existing bag, so the payload
     * is read from the row being written and cannot be shared.
     */
    if (rebindMonitorSteps || syncCustomFields) {
      let syncedMonitors: number = 0;
      const linkedMonitorQuery: Query<Monitor> = {
        monitorTemplateId: template.id!,
        projectId: template.projectId,
      };

      /*
       * Resolve the caller's complete update-authorized set before the first
       * per-monitor write. Root-enumerating every linked row made a mixed
       * label scope order-dependent: accessible rows could update before a
       * later hidden row threw. This is the same permission-narrowed subset
       * the ordinary bulk update path applies atomically.
       *
       * The probe names `customFields` when this push writes them — the
       * per-monitor values are not known yet, and only the KEYS decide the
       * column check — so a caller who may not update that column is refused
       * up front rather than on an arbitrary row partway through the fleet.
       */
      const authorizedMonitorQuery: Query<Monitor> =
        await ModelPermission.checkUpdateQueryPermissions(
          Monitor,
          linkedMonitorQuery,
          {
            ...updateData,
            ...(syncCustomFields ? { customFields: {} } : {}),
          } as any,
          data.props,
        );
      const monitorsToSync: Array<Monitor> = [];

      for (let skip: number = 0; ; skip += LIMIT_MAX) {
        const monitors: Array<Monitor> = await MonitorService.findBy({
          query: authorizedMonitorQuery,
          select: {
            _id: true,
            monitorSteps: true,
            customFields: true,
            autoProvisionedNetworkDeviceId: true,
          },
          sort: { createdAt: SortOrder.Ascending, _id: SortOrder.Ascending },
          limit: LIMIT_MAX,
          skip: skip,
          props: { isRoot: true },
        });

        monitorsToSync.push(...monitors);

        if (monitors.length < LIMIT_MAX) {
          break;
        }
      }

      /* Validate and materialize every instance-specific rebind first. */
      const updates: Array<{
        monitor: Monitor;
        data: Partial<Monitor>;
      }> = monitorsToSync.map((monitor: Monitor) => {
        return {
          monitor,
          data: {
            ...this.buildMonitorUpdateData(template, monitor, fields),
            ...(syncCustomFields
              ? {
                  customFields: this.buildCustomFieldsUpdate({
                    template,
                    monitor,
                  }),
                }
              : {}),
          },
        };
      });

      for (const update of updates) {
        syncedMonitors += await MonitorService.updateOneBy({
          query: {
            _id: update.monitor.id!,
            monitorTemplateId: template.id!,
            projectId: template.projectId,
          },
          data: update.data as any,
          props: data.props,
        });
      }

      await this.stampPolicyTemplateSync({
        monitorTemplateId: template.id!,
        projectId: template.projectId,
        totalLinkedMonitors,
        syncedMonitors,
      });

      return { totalLinkedMonitors, syncedMonitors };
    }

    /*
     * A single updateBy is capped at its `limit`, so a template with more
     * linked monitors than LIMIT_MAX used to leave the remainder on the old
     * config and still return success. Offset paging cannot fix that here:
     * updateBy takes no sort, and rewriting a row moves its tuple, so a
     * second page at a higher skip can step over rows the first page moved.
     * Page the ids first instead, then update by id batch.
     *
     * `_id` rides along in the sort because skip/limit paging is only stable
     * over a total order: a fleet provisioned by one auto-import run shares a
     * createdAt, and without the tiebreaker a tie straddling a page boundary
     * returns one row twice and another never — which here would inflate
     * syncedMonitors by exactly the number of rows it dropped.
     */
    const linkedMonitorIds: Array<ObjectID> = [];

    for (let skip: number = 0; ; skip += LIMIT_MAX) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          monitorTemplateId: template.id!,
          projectId: template.projectId,
        },
        select: { _id: true },
        sort: { createdAt: SortOrder.Ascending, _id: SortOrder.Ascending },
        limit: LIMIT_MAX,
        skip: skip,
        props: { isRoot: true },
      });

      for (const monitor of monitors) {
        linkedMonitorIds.push(monitor.id!);
      }

      if (monitors.length < LIMIT_MAX) {
        break;
      }
    }

    let syncedMonitors: number = 0;

    for (
      let batchStart: number = 0;
      batchStart < linkedMonitorIds.length;
      batchStart += LIMIT_MAX
    ) {
      const batch: Array<ObjectID> = linkedMonitorIds.slice(
        batchStart,
        batchStart + LIMIT_MAX,
      );

      /*
       * Still scoped by template and project, so a stale id from the paging
       * read above cannot widen the write beyond this template's fleet.
       * props stays the caller's — updateBy narrows each batch to what they
       * may actually update.
       */
      syncedMonitors += await MonitorService.updateBy({
        query: {
          _id: new Includes(batch),
          monitorTemplateId: template.id!,
          projectId: template.projectId,
        },
        data: updateData as any,
        limit: LIMIT_MAX,
        skip: 0,
        props: data.props,
      });
    }

    await this.stampPolicyTemplateSync({
      monitorTemplateId: template.id!,
      projectId: template.projectId,
      totalLinkedMonitors,
      syncedMonitors,
    });

    return {
      totalLinkedMonitors,
      syncedMonitors,
    };
  }

  /*
   * "Template Synced" on the alert-policies table means one thing: every
   * monitor the policy owns is running the template's current
   * configuration. This push is what makes that true, so this is where the
   * column is stamped — not in the policy engine, which reconciles the
   * device SET and has no opinion about a criteria edit that left the set
   * unchanged.
   *
   * Only stamped when the push reached EVERY linked monitor. A caller whose
   * label scopes hide half the fleet has synced half the fleet, and a date
   * against that would read as "your criteria edit has landed" when it has
   * landed on some of the devices.
   */
  private async stampPolicyTemplateSync(data: {
    monitorTemplateId: ObjectID;
    projectId: ObjectID;
    totalLinkedMonitors: number;
    syncedMonitors: number;
  }): Promise<void> {
    if (
      data.syncedMonitors <= 0 ||
      data.syncedMonitors < data.totalLinkedMonitors
    ) {
      return;
    }

    await NetworkAlertPolicyEngineService.onMonitorTemplateSynced({
      monitorTemplateId: data.monitorTemplateId,
      projectId: data.projectId,
    });
  }

  /**
   * Sync the template's current configuration onto a single monitor that was
   * created from it. The monitor must be linked to this template — passing an
   * arbitrary monitor ID is rejected so the endpoint can't be tricked into
   * pushing config to an unrelated monitor.
   *
   * Pass `fields` to scope the sync; if omitted, DEFAULT_SYNCABLE_FIELDS is
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
        monitorType: true,
        monitorSteps: true,
        monitoringInterval: true,
        minimumProbeAgreement: true,
        customFields: true,
        labels: {
          _id: true,
        },
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
        monitorSteps: true,
        customFields: true,
        autoProvisionedNetworkDeviceId: true,
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

    const updateData: Partial<Monitor> = this.buildMonitorUpdateData(
      template,
      monitor,
      fields,
    );

    /*
     * Overlaid on this monitor's own bag, so a value the operator entered on
     * a field the template does not default survives the push.
     */
    if (this.hasCustomFieldDefaultsToSync(template, fields)) {
      updateData.customFields = this.buildCustomFieldsUpdate({
        template,
        monitor,
      });
    }

    if (Object.keys(updateData).length === 0) {
      return;
    }

    await MonitorService.updateOneBy({
      query: {
        _id: data.monitorId,
        monitorTemplateId: template.id!,
        projectId: template.projectId,
      },
      data: updateData as any,
      props: data.props,
    });
  }

  /**
   * Link an existing monitor to this template. The monitor must be in the same
   * project AND have the same monitorType as the template — anything else is
   * rejected, so a user can't (e.g.) link an API monitor to a Server-monitor
   * template and then sync incompatible criteria onto it.
   */
  @CaptureSpan()
  public async linkMonitor(data: {
    monitorTemplateId: ObjectID;
    monitorId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const template: Model | null = await this.findOneById({
      id: data.monitorTemplateId,
      select: {
        _id: true,
        projectId: true,
        monitorType: true,
      },
      props: data.props,
    });

    if (!template) {
      throw new BadDataException("Monitor template not found");
    }
    if (!template.projectId) {
      throw new BadDataException("Monitor template is missing projectId");
    }
    if (!template.monitorType) {
      throw new BadDataException("Monitor template is missing monitorType");
    }

    const monitor: Monitor | null = await MonitorService.findOneById({
      id: data.monitorId,
      select: {
        _id: true,
        projectId: true,
        monitorType: true,
      },
      props: data.props,
    });

    if (!monitor) {
      throw new BadDataException("Monitor not found");
    }
    if (
      !monitor.projectId ||
      monitor.projectId.toString() !== template.projectId.toString()
    ) {
      throw new BadDataException(
        "Monitor and template belong to different projects",
      );
    }
    if (monitor.monitorType !== template.monitorType) {
      throw new BadDataException(
        `Monitor type "${monitor.monitorType}" does not match template type "${template.monitorType}"`,
      );
    }

    await MonitorService.updateOneById({
      id: data.monitorId,
      data: {
        monitorTemplateId: template.id!,
      } as any,
      props: data.props,
    });
  }

  /**
   * Detach a monitor from this template. The monitor must currently be linked
   * to *this* template — passing a monitor linked elsewhere (or unlinked) is
   * rejected so a stale UI can't accidentally clear someone else's link.
   */
  @CaptureSpan()
  public async unlinkMonitor(data: {
    monitorTemplateId: ObjectID;
    monitorId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: data.monitorId,
      select: {
        _id: true,
        monitorTemplateId: true,
      },
      props: data.props,
    });

    if (!monitor) {
      throw new BadDataException("Monitor not found");
    }
    if (
      !monitor.monitorTemplateId ||
      monitor.monitorTemplateId.toString() !== data.monitorTemplateId.toString()
    ) {
      throw new BadDataException("Monitor is not linked to this template");
    }

    await MonitorService.updateOneById({
      id: data.monitorId,
      data: {
        monitorTemplateId: null,
      } as any,
      props: data.props,
    });
  }
}
export default new Service();
