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
import NetworkDeviceMonitorTemplateUtil from "../../Utils/Monitor/NetworkDeviceMonitorTemplateUtil";
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
  | "labels";

const ALL_SYNCABLE_FIELDS: ReadonlyArray<SyncableTemplateField> = [
  "monitorSteps",
  "monitoringInterval",
  "minimumProbeAgreement",
  "labels",
];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
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
    if (!updateBy.data.monitorSteps) {
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
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    for (const template of templates) {
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
        monitorType: true,
        monitorSteps: true,
        monitoringInterval: true,
        minimumProbeAgreement: true,
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

    if (Object.keys(updateData).length === 0) {
      return {
        totalLinkedMonitors,
        syncedMonitors: 0,
      };
    }

    /*
     * A Network Device template contains a design-time device reference,
     * while each linked monitor has its own device. A bulk JSON assignment
     * would retarget the entire fleet to the template editor's device. Sync
     * those rows individually and rebind cloned template steps to each
     * monitor's current (or provenance-backed) device instead.
     */
    if (
      template.monitorType === MonitorType.NetworkDevice &&
      fields.includes("monitorSteps")
    ) {
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
       */
      const authorizedMonitorQuery: Query<Monitor> =
        await ModelPermission.checkUpdateQueryPermissions(
          Monitor,
          linkedMonitorQuery,
          updateData as any,
          data.props,
        );
      const monitorsToSync: Array<Monitor> = [];

      for (let skip: number = 0; ; skip += LIMIT_MAX) {
        const monitors: Array<Monitor> = await MonitorService.findBy({
          query: authorizedMonitorQuery,
          select: {
            _id: true,
            monitorSteps: true,
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
            ...updateData,
            monitorSteps: monitor.autoProvisionedNetworkDeviceId
              ? NetworkDeviceMonitorTemplateUtil.rebindMonitorSteps({
                  monitorSteps: template.monitorSteps,
                  networkDeviceId: monitor.autoProvisionedNetworkDeviceId,
                })
              : NetworkDeviceMonitorTemplateUtil.buildSyncedMonitorSteps({
                  templateMonitorSteps: template.monitorSteps,
                  currentMonitorSteps: monitor.monitorSteps,
                }),
          },
        };
      });

      for (const update of updates) {
        syncedMonitors += await MonitorService.updateOneById({
          id: update.monitor.id!,
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
        monitorType: true,
        monitorSteps: true,
        monitoringInterval: true,
        minimumProbeAgreement: true,
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

    const updateData: Partial<Monitor> = this.buildUpdateData(template, fields);

    if (
      template.monitorType === MonitorType.NetworkDevice &&
      fields.includes("monitorSteps")
    ) {
      updateData.monitorSteps = monitor.autoProvisionedNetworkDeviceId
        ? NetworkDeviceMonitorTemplateUtil.rebindMonitorSteps({
            monitorSteps: template.monitorSteps,
            networkDeviceId: monitor.autoProvisionedNetworkDeviceId,
          })
        : NetworkDeviceMonitorTemplateUtil.buildSyncedMonitorSteps({
            templateMonitorSteps: template.monitorSteps,
            currentMonitorSteps: monitor.monitorSteps,
          });
    }

    if (Object.keys(updateData).length === 0) {
      return;
    }

    await MonitorService.updateOneById({
      id: data.monitorId,
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
