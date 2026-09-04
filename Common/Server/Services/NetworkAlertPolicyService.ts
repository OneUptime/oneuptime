import DatabaseService from "./DatabaseService";
import LabelService from "./LabelService";
import MonitorTemplateService from "./MonitorTemplateService";
import NetworkAlertPolicyEngineService from "./NetworkAlertPolicyEngineService";
import NetworkDeviceAutoImportRuleService from "./NetworkDeviceAutoImportRuleService";
import NetworkDeviceRoleService from "./NetworkDeviceRoleService";
import NetworkSiteService from "./NetworkSiteService";
import Model from "../../Models/DatabaseModels/NetworkAlertPolicy";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../Models/DatabaseModels/MonitorTemplate";
import NetworkDeviceAutoImportRule from "../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceRole from "../../Models/DatabaseModels/NetworkDeviceRole";
import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../Types/Database/Permissions/Index";
import TablePermission from "../Types/Database/Permissions/TablePermission";
import Query from "../Types/Database/Query";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../Types/BaseDatabase/Includes";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import MonitorType from "../../Types/Monitor/MonitorType";
import NetworkAlertPolicyScope, {
  NetworkAlertPolicyScopeUtil,
} from "../../Types/NetworkDevice/NetworkAlertPolicyScope";
import ObjectID from "../../Types/ObjectID";

/*
 * Write-time guards for Network Alert Policies.
 *
 * A policy is "alert on a SET of devices": one Network Device monitor per
 * matching device, cloned from the policy's monitor template and kept in
 * step as devices come and go. This service owns the row; it does NOT own
 * the monitors. Everything that touches a Monitor — provisioning one per
 * matching device on create, reconciling the set on an update to the scope
 * or the template, tearing them down on delete — belongs to the engine
 * (NetworkAlertPolicyEngineService), which hangs off the hooks at the bottom
 * of this file: a create and an update hand it the policy detached from the
 * request, and a delete waits for it to remove the monitors before the row
 * goes.
 *
 * What this service DOES guarantee, at the write, where the operator can see
 * the error:
 *
 *   - The name is trimmed, and a name that is nothing but whitespace is
 *     refused. `name` is unique per project, and "Warehouse " and
 *     "Warehouse" would otherwise be two policies.
 *   - The scope is stored in its canonical form (NetworkAlertPolicyScopeUtil
 *     .normalize): deduplicated, blanks dropped, junk shapes flattened. The
 *     engine reads the column on every device event, so it has to be able to
 *     trust what is in it.
 *   - The monitor template belongs to the caller's project. The FK only
 *     proves the MonitorTemplate row exists; without this check a policy
 *     could name another tenant's template and the engine would later clone
 *     it as root, monitor by monitor, into this project. Same hole
 *     NetworkDeviceService closes for OID templates, monitors and sites.
 *   - The monitor template is a Network Device template. Any other type
 *     would produce monitors the device page cannot show and the engine
 *     cannot bind to a device.
 *   - THE TEMPLATE IS USED BY NOTHING ELSE IN THE PROJECT: not by another
 *     policy, and not by an auto-import rule. A provisioned monitor's
 *     provenance is the pair (device, template) — that is the unique index
 *     Monitor itself carries — so it is the only key the engine has for
 *     "is this monitor mine?". Two policies on one template would both claim
 *     the same monitor and neither could tear it down when a device left its
 *     scope; a template shared with an auto-import rule would have the rule
 *     provision a monitor the policy then believes it owns. The database
 *     backs the policy-to-policy half with a partial unique index on
 *     (projectId, monitorTemplateId); the checks here exist so the operator
 *     gets a sentence instead of a constraint violation, and so the
 *     rule-to-policy half is refused at all.
 *   - THE CALLER MAY CAUSE MONITORS TO EXIST. Saving or enabling a policy
 *     provisions billable monitors, so it takes the Monitor table's create
 *     permission and a read of the template with the caller's own scopes —
 *     see assertCallerMayProvisionFromTemplate.
 *   - EVERY ID IN THE SCOPE BELONGS TO THIS PROJECT. The scope is jsonb with
 *     no foreign keys behind it, so this is the only thing standing between
 *     a pasted cross-tenant site id and a policy that silently matches
 *     nothing forever. Stale is not wrong: an id whose row was deleted after
 *     the fact simply matches nothing, and the engine never rewrites a scope.
 *
 * The template is read under BOTH spellings a relation arrives in —
 * `monitorTemplateId` from server callers and `monitorTemplate: { _id }` from
 * the dashboard form — and a payload that points the two at different rows
 * is refused outright rather than trusting TypeORM's precedence (see
 * RelationIdUtil).
 */

const MONITOR_TEMPLATE_KEYS: Array<string> = [
  "monitorTemplateId",
  "monitorTemplate",
];

function readMonitorTemplateId(data: Record<string, unknown>): ObjectID | null {
  return RelationIdUtil.readConsistent(
    data,
    MONITOR_TEMPLATE_KEYS,
    "Monitor Template",
  );
}

/*
 * What onBeforeUpdate hands onUpdateSuccess: the pre-write state of every
 * policy the update matched.
 *
 * `isEnabled` is the one the engine cannot do without. By the time
 * onUpdateSuccess runs only the NEW value is on the row, and a payload that
 * says `isEnabled: false` matched a policy that was ALREADY disabled is not
 * a transition — pausing its monitors again would be a write per monitor on
 * every save of an already-disabled policy. `monitorTemplateId` is here for
 * the same reason: re-saving a policy with the template it already has is
 * not a template change, and only a real one may stamp templateSyncedAt.
 */
interface PolicyUpdateCarryForward {
  previousPolicies: Array<Model>;
}

/*
 * The write shapes that need the engine — and therefore the pre-write
 * snapshot. A rename or a description edit changes neither which devices are
 * covered nor what they are watched for, so it costs no read and starts no
 * reconciliation.
 */
function isEngineRelevantUpdate(dataKeys: Array<string>): boolean {
  return (
    RelationIdUtil.isWritten(dataKeys, MONITOR_TEMPLATE_KEYS) ||
    dataKeys.includes("isEnabled") ||
    dataKeys.includes("scope")
  );
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * DatabaseService stamps data.projectId from props.tenantId before this
     * runs, so for an API caller the two agree; a root caller (a worker, a
     * seeder) supplies projectId in the data directly.
     */
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId || undefined;

    if (!projectId) {
      throw new BadDataException(
        "Project ID is required to create a network alert policy.",
      );
    }

    createBy.data.name = this.trimName(createBy.data.name);

    /*
     * Always, even when the client sent nothing: the column is NOT NULL and
     * an absent scope means "all devices", which normalize spells as `{}`
     * with three empty lists — the same form every reader expects.
     */
    createBy.data.scope = NetworkAlertPolicyScopeUtil.normalize(
      createBy.data.scope,
    );

    await this.assertScopeIdsBelongToProject({
      scope: createBy.data.scope,
      projectId: projectId,
    });

    const monitorTemplateId: ObjectID | null = readMonitorTemplateId(
      createBy.data as unknown as Record<string, unknown>,
    );

    /*
     * Refused here rather than left to checkRequiredFields so the message
     * names the field the operator understands, and so an explicit `null`
     * (which the required check treats as "use the default", of which there
     * is none) cannot slip through to a NOT-provisionable policy.
     */
    if (!monitorTemplateId) {
      throw new BadDataException("Monitor Template is required.");
    }

    await this.assertMonitorTemplateBelongsToProject({
      monitorTemplateId: monitorTemplateId,
      projectId: projectId,
    });

    await this.assertMonitorTemplateIsUnclaimed({
      monitorTemplateId: monitorTemplateId,
      projectId: projectId,
      excludePolicyIds: [],
    });

    await this.assertCallerMayProvisionFromTemplate({
      monitorTemplateId: monitorTemplateId,
      props: createBy.props,
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Record<string, unknown> = (updateBy.data ||
      {}) as unknown as Record<string, unknown>;
    const dataKeys: Array<string> = Object.keys(data);

    if (dataKeys.includes("name")) {
      updateBy.data.name = this.trimName(
        data["name"] as string | undefined | null,
      );
    }

    if (dataKeys.includes("scope")) {
      updateBy.data.scope = NetworkAlertPolicyScopeUtil.normalize(
        updateBy.data.scope,
      );
    }

    if (!isEngineRelevantUpdate(dataKeys)) {
      return { updateBy, carryForward: null };
    }

    /*
     * The rows this update will touch. They are three things at once: what
     * the uniqueness check has to leave out of "another policy" (re-saving a
     * policy with the template it already has is not a conflict), where the
     * project comes from for a tenant-less caller, and the pre-write
     * snapshot onUpdateSuccess needs to tell a real enable/disable or
     * template change from a form re-sending what was already there.
     */
    const matchedPolicies: Array<Model> =
      await this.getMatchedPoliciesForUpdate(updateBy);

    const carryForward: PolicyUpdateCarryForward = {
      previousPolicies: matchedPolicies,
    };

    const projectIds: Array<ObjectID> = this.getProjectIdsForUpdate(
      updateBy,
      matchedPolicies,
    );

    if (dataKeys.includes("scope")) {
      for (const projectId of projectIds) {
        await this.assertScopeIdsBelongToProject({
          /*
           * Normalized onto the payload a few lines above, so this is the
           * canonical object rather than whatever shape the client sent. The
           * cast is only to shed QueryDeepPartialEntity's SQL-expression arm,
           * which normalize cannot produce.
           */
          scope: updateBy.data.scope as NetworkAlertPolicyScope | undefined,
          projectId: projectId,
        });
      }
    }

    /*
     * Enabling a policy is a provisioning decision, not a label edit: the
     * moment it is on, the engine starts creating billable monitors. So it
     * takes the same "may this caller cause monitors to exist" check the
     * template selection takes, even on a payload that touches nothing else.
     */
    const isBeingEnabled: boolean =
      dataKeys.includes("isEnabled") && data["isEnabled"] === true;

    if (!RelationIdUtil.isWritten(dataKeys, MONITOR_TEMPLATE_KEYS)) {
      if (isBeingEnabled) {
        if (!updateBy.props.isRoot && !updateBy.props.isMasterAdmin) {
          TablePermission.checkTableLevelPermissions(
            Monitor,
            updateBy.props,
            DatabaseRequestType.Create,
          );
          TablePermission.checkTableLevelBlockPermissions(
            Monitor,
            updateBy.props,
            DatabaseRequestType.Create,
          );
        }

        for (const policy of matchedPolicies) {
          if (!policy.monitorTemplateId) {
            continue;
          }

          await this.assertCallerMayProvisionFromTemplate({
            monitorTemplateId: policy.monitorTemplateId,
            props: updateBy.props,
          });
        }
      }

      return { updateBy, carryForward: carryForward };
    }

    const monitorTemplateId: ObjectID | null = readMonitorTemplateId(data);

    /*
     * The column is nullable in the database — the FK is SET NULL so that
     * deleting a template disables the policies that used it rather than
     * deleting them — but that is the database's move to make, not the
     * API's. A policy with no template can provision nothing, so an operator
     * who wants one switched off has `isEnabled` for it.
     */
    if (!monitorTemplateId) {
      throw new BadDataException("Monitor Template is required.");
    }

    const excludePolicyIds: Array<ObjectID> = [];

    for (const policy of matchedPolicies) {
      if (policy._id) {
        excludePolicyIds.push(new ObjectID(policy._id));
      }
    }

    for (const projectId of projectIds) {
      await this.assertMonitorTemplateBelongsToProject({
        monitorTemplateId: monitorTemplateId,
        projectId: projectId,
      });

      await this.assertMonitorTemplateIsUnclaimed({
        monitorTemplateId: monitorTemplateId,
        projectId: projectId,
        excludePolicyIds: excludePolicyIds,
      });
    }

    await this.assertCallerMayProvisionFromTemplate({
      monitorTemplateId: monitorTemplateId,
      props: updateBy.props,
    });

    return { updateBy, carryForward: carryForward };
  }

  /*
   * The policies an update's query matches, read as root — onBeforeUpdate
   * runs before DatabaseService has permission-checked the query — and
   * therefore re-scoped to the caller's own tenant first, so a guessed id
   * from another project cannot become a state oracle through the checks
   * that follow.
   */
  private async getMatchedPoliciesForUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<Model>> {
    return await this.findBy({
      query:
        !updateBy.props.isRoot && updateBy.props.tenantId
          ? { ...updateBy.query, projectId: updateBy.props.tenantId }
          : updateBy.query,
      select: {
        _id: true,
        projectId: true,
        /*
         * The two columns onUpdateSuccess compares the payload against. Both
         * are read here rather than in the success hook because by then the
         * new values are already on the row.
         */
        isEnabled: true,
        monitorTemplateId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The project(s) an update's template must belong to.
   *
   * An API caller carries its tenant in props, and that is the only project
   * its query can touch, so the answer is that one id. A root caller with no
   * tenant (a worker updating by id) is answered from the matched rows.
   */
  private getProjectIdsForUpdate(
    updateBy: UpdateBy<Model>,
    matchedPolicies: Array<Model>,
  ): Array<ObjectID> {
    if (updateBy.props.tenantId) {
      return [updateBy.props.tenantId];
    }

    const projectIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();

    for (const policy of matchedPolicies) {
      if (policy.projectId && !seen.has(policy.projectId.toString())) {
        seen.add(policy.projectId.toString());
        projectIds.push(policy.projectId);
      }
    }

    return projectIds;
  }

  /*
   * The template exists IN THIS PROJECT and is a Network Device template.
   *
   * One query, keyed on both id and project, and one "not found" for either
   * miss: a template that exists in some other project must be
   * indistinguishable from one that does not exist at all, or the error
   * becomes an oracle for other tenants' template ids. Read as root because
   * the projectId in the query is the whole of the tenancy check, and the
   * caller's own read scopes would only turn a wrong-project answer into a
   * permission error with the same information in it.
   */
  private async assertMonitorTemplateBelongsToProject(data: {
    monitorTemplateId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const monitorTemplate: MonitorTemplate | null =
      await MonitorTemplateService.findOneBy({
        query: {
          _id: data.monitorTemplateId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          monitorType: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      !monitorTemplate ||
      !monitorTemplate.projectId ||
      monitorTemplate.projectId.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException("Monitor Template not found.");
    }

    if (monitorTemplate.monitorType !== MonitorType.NetworkDevice) {
      throw new BadDataException(
        "Monitor Template must be a Network Device monitor template.",
      );
    }
  }

  /*
   * Nothing else in the project provisions from this template.
   *
   * The engine recognises its monitors by (device, template) — the unique
   * index Monitor carries on (autoProvisionedNetworkDeviceId,
   * monitorTemplateId) — so one template has room for exactly one owner per
   * device. Another policy on the same template would collide on the first
   * device both scopes contain, and whichever provisioned second would fail
   * forever on the index while both believed the monitor was theirs. An
   * auto-import rule on the same template is the same collision from the
   * other side: the rule provisions on import, the policy then finds a
   * monitor that looks like its own and takes it down when the device leaves
   * the scope.
   *
   * Both reads are root and project-keyed. The policy half is also what the
   * partial unique index on (projectId, monitorTemplateId) enforces; this
   * check runs first so the operator gets a sentence rather than a
   * constraint violation. `excludePolicyIds` are the rows an update is
   * about to write — a policy keeping its own template is not a conflict.
   */
  private async assertMonitorTemplateIsUnclaimed(data: {
    monitorTemplateId: ObjectID;
    projectId: ObjectID;
    excludePolicyIds: Array<ObjectID>;
  }): Promise<void> {
    const excluded: Set<string> = new Set<string>(
      data.excludePolicyIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    const policiesOnTemplate: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        monitorTemplateId: data.monitorTemplateId,
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    const otherPolicy: Model | undefined = policiesOnTemplate.find(
      (policy: Model): boolean => {
        return !policy._id || !excluded.has(policy._id.toString());
      },
    );

    if (otherPolicy) {
      throw new BadDataException(
        "Another alert policy already uses this Monitor Template.",
      );
    }

    const rulesOnTemplate: Array<NetworkDeviceAutoImportRule> =
      await NetworkDeviceAutoImportRuleService.findBy({
        query: {
          projectId: data.projectId,
          monitorTemplateId: data.monitorTemplateId,
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: 1,
        props: {
          isRoot: true,
        },
      });

    if (rulesOnTemplate.length > 0) {
      throw new BadDataException(
        "This Monitor Template is used by an auto-import rule; pick a different template.",
      );
    }
  }

  /*
   * The caller may cause monitors to exist, and may see the template they
   * would be cloned from.
   *
   * Two separate questions, and the policy's own permissions answer neither.
   * A policy row is cheap; the monitors it provisions are billed, so saving
   * one takes the MONITOR table's create permission — the same check
   * NetworkDeviceAutoImportRuleService makes before a rule may name a
   * template, and for the same reason. And selecting a template is also a
   * read of it: without the caller-props read below, a user who may edit
   * policies could point one at a template their label scopes hide, and the
   * engine would clone it as root for the whole fleet.
   *
   * The refusal is the same "not found" the project check gives, so this
   * cannot become an oracle for template ids the caller may not see.
   */
  private async assertCallerMayProvisionFromTemplate(data: {
    monitorTemplateId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    TablePermission.checkTableLevelPermissions(
      Monitor,
      data.props,
      DatabaseRequestType.Create,
    );
    TablePermission.checkTableLevelBlockPermissions(
      Monitor,
      data.props,
      DatabaseRequestType.Create,
    );

    const monitorTemplate: MonitorTemplate | null =
      await MonitorTemplateService.findOneById({
        id: data.monitorTemplateId,
        select: {
          _id: true,
        },
        props: data.props,
      });

    if (!monitorTemplate) {
      throw new BadDataException("Monitor Template not found.");
    }
  }

  /*
   * Prerequisite 9: every id in a scope belongs to this project, checked
   * where the operator typed it.
   *
   * The scope is a jsonb blob of ids with no foreign keys behind it, so
   * nothing else can catch a site id pasted from another tenant's URL. It
   * would not leak that tenant's data — the engine's device query is keyed
   * on the project first — but it would produce a policy that silently
   * matches nothing forever, and a settings table that says "Devices in 1
   * site" about a site the operator cannot see.
   *
   * STALE is not the same as WRONG, and only the second is refused here. An
   * id that was valid when the policy was saved and whose site has since
   * been deleted simply matches nothing; the engine never rewrites a scope,
   * so the id stays where the operator put it and reappears if the row does.
   */
  private async assertScopeIdsBelongToProject(data: {
    scope: NetworkAlertPolicyScope | null | undefined;
    projectId: ObjectID;
  }): Promise<void> {
    const scope: NetworkAlertPolicyScope =
      NetworkAlertPolicyScopeUtil.normalize(data.scope);

    await this.assertIdsExistInProject({
      ids: scope.siteIds || [],
      projectId: data.projectId,
      subject: "Network Site",
      read: async (query: Query<NetworkSite>): Promise<Array<NetworkSite>> => {
        return await NetworkSiteService.findBy({
          query: query,
          select: { _id: true },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        });
      },
    });

    await this.assertIdsExistInProject({
      ids: scope.networkDeviceRoleIds || [],
      projectId: data.projectId,
      subject: "Network Device Role",
      read: async (
        query: Query<NetworkDeviceRole>,
      ): Promise<Array<NetworkDeviceRole>> => {
        return await NetworkDeviceRoleService.findBy({
          query: query,
          select: { _id: true },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        });
      },
    });

    await this.assertIdsExistInProject({
      ids: scope.labelIds || [],
      projectId: data.projectId,
      subject: "Label",
      read: async (query: Query<Label>): Promise<Array<Label>> => {
        return await LabelService.findBy({
          query: query,
          select: { _id: true },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        });
      },
    });
  }

  private async assertIdsExistInProject<
    TModel extends { id?: ObjectID | null },
  >(data: {
    ids: Array<string>;
    projectId: ObjectID;
    subject: string;
    read: (query: Query<never>) => Promise<Array<TModel>>;
  }): Promise<void> {
    if (data.ids.length === 0) {
      return;
    }

    /*
     * A non-UUID never reaches Postgres: `uuid = 'nonsense'` is a statement
     * error, not an empty result, and it would take the whole save down with
     * a message nobody can act on.
     */
    for (const id of data.ids) {
      if (!ObjectID.isValidUUID(id)) {
        throw new BadDataException(
          `"${id}" is not a valid ${data.subject} ID.`,
        );
      }
    }

    const objectIds: Array<ObjectID> = data.ids.map((id: string): ObjectID => {
      return new ObjectID(id);
    });

    const rows: Array<TModel> = await data.read({
      _id: new Includes(objectIds),
      projectId: data.projectId,
    } as unknown as Query<never>);

    const found: Set<string> = new Set<string>(
      rows.flatMap((row: TModel): Array<string> => {
        return row.id ? [row.id.toString()] : [];
      }),
    );

    const missing: Array<string> = data.ids.filter((id: string): boolean => {
      return !found.has(id);
    });

    if (missing.length > 0) {
      throw new BadDataException(
        `${data.subject} ${missing[0]} does not belong to this project.`,
      );
    }
  }

  private trimName(name: string | undefined | null): string {
    const trimmed: string = (name || "").trim();

    if (!trimmed) {
      throw new BadDataException("Name is required.");
    }

    return trimmed;
  }

  /*
   * ENGINE ATTACHMENT POINTS.
   *
   * NetworkAlertPolicyEngineService is where a saved policy turns into
   * monitors: provision one per matching device after a create, reconcile
   * the set after an update (a narrower scope removes monitors, a different
   * template re-clones them, isEnabled off pauses the lot), and tear them
   * down before a delete. It also owns the four columns the API cannot write
   * — lastSyncAt, lastSyncError, coveredDeviceCount, templateSyncedAt.
   *
   * The create and update hooks hand the engine the work DETACHED, and that
   * is not a shortcut. Provisioning a policy that covers a warehouse is
   * hundreds of monitor creates, each running MonitorService's full pipeline;
   * doing it inside the save would hold the operator's request open for
   * minutes and time out. The row is what the operator saved, the monitors
   * are the consequence, and the settings table shows the consequence
   * arriving through lastSyncAt. A pass lost to a process restart is picked
   * up by the five-minute sweep, which computes the same difference.
   *
   * The DELETE is not detached, for the opposite reason: the monitors must be
   * gone before the row is, or nothing is left that knows they were the
   * policy's.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const projectId: ObjectID | undefined =
      createdItem.projectId || onCreate.createBy.props.tenantId || undefined;

    if (!createdItem.id || !projectId) {
      return createdItem;
    }

    const policyId: ObjectID = createdItem.id;

    Promise.resolve()
      .then(async () => {
        /*
         * A brand new policy has no monitors, so every monitor its first
         * pass makes comes from the template it names — which is exactly
         * what templateSyncedAt claims.
         */
        await NetworkAlertPolicyEngineService.syncPolicy({
          policyId: policyId,
          stampTemplateSyncedOnCleanPass: true,
        });
      })
      .catch((error: Error) => {
        logger.error(
          `Error provisioning monitors for new network alert policy ${policyId.toString()}: ${error}`,
        );
      });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const dataKeys: Array<string> = Object.keys(onUpdate.updateBy.data || {});

    if (!isEngineRelevantUpdate(dataKeys) || updatedItemIds.length === 0) {
      return onUpdate;
    }

    const data: Record<string, unknown> = (onUpdate.updateBy.data ||
      {}) as unknown as Record<string, unknown>;

    const previousPolicies: Array<Model> =
      (onUpdate.carryForward as PolicyUpdateCarryForward | null)
        ?.previousPolicies || [];

    const previousById: Map<string, Model> = new Map<string, Model>();

    for (const policy of previousPolicies) {
      if (policy.id) {
        previousById.set(policy.id.toString(), policy);
      }
    }

    const isEnabledWritten: boolean = dataKeys.includes("isEnabled");
    const becomesEnabled: boolean =
      isEnabledWritten && data["isEnabled"] === true;
    const becomesDisabled: boolean =
      isEnabledWritten && data["isEnabled"] === false;
    const isTemplateWritten: boolean = RelationIdUtil.isWritten(
      dataKeys,
      MONITOR_TEMPLATE_KEYS,
    );
    const writtenTemplateId: ObjectID | null = isTemplateWritten
      ? readMonitorTemplateId(data)
      : null;

    Promise.resolve()
      .then(async () => {
        for (const policyId of updatedItemIds) {
          const previous: Model | undefined = previousById.get(
            policyId.toString(),
          );

          /*
           * A real transition, never the payload alone: the settings form
           * re-sends `isEnabled` on every save, and pausing an already
           * disabled policy would be one write per monitor every time
           * somebody fixed a typo in its description.
           */
          const wasEnabled: boolean | undefined = previous?.isEnabled;

          if (previous?.projectId && becomesDisabled && wasEnabled !== false) {
            await NetworkAlertPolicyEngineService.setPolicyMonitorsPaused({
              projectId: previous.projectId,
              policyId: policyId,
              isPaused: true,
            });
          }

          if (previous?.projectId && becomesEnabled && wasEnabled !== true) {
            /*
             * Resume BEFORE the sync, so a monitor that was paused when the
             * policy went off is running again by the time the sync counts
             * the fleet as covered.
             */
            await NetworkAlertPolicyEngineService.setPolicyMonitorsPaused({
              projectId: previous.projectId,
              policyId: policyId,
              isPaused: false,
            });
          }

          const isRealTemplateChange: boolean = Boolean(
            isTemplateWritten &&
              writtenTemplateId &&
              previous &&
              previous.monitorTemplateId?.toString() !==
                writtenTemplateId.toString(),
          );

          await NetworkAlertPolicyEngineService.syncPolicy({
            policyId: policyId,
            /*
             * Only a policy pointed at a DIFFERENT template has had its
             * whole fleet re-cloned from the template it names now. Re-saving
             * the same template has re-synced nothing, and stamping
             * "Template Synced" for it would tell an operator their criteria
             * edit had landed when it had not.
             */
            stampTemplateSyncedOnCleanPass: isRealTemplateChange,
          });
        }
      })
      .catch((error: Error) => {
        logger.error(
          `Error reconciling monitors after a network alert policy update: ${error}`,
        );
      });

    return onUpdate;
  }

  /*
   * The policy's monitors go BEFORE the policy row does.
   *
   * Deleting them afterwards would mean a window — and, if the process died
   * in it, forever — in which billable monitors exist whose owner is a
   * soft-deleted row nothing looks at. The Monitor FK's SET NULL is the
   * backstop for a monitor this could not reach, not the mechanism: it turns
   * such a row into an ordinary auto-provisioned monitor instead of a
   * dangling reference.
   *
   * Only policies the caller may actually delete are cleaned up: the query
   * is narrowed by the same permission check DatabaseService is about to
   * apply, so a bulk delete that the permission layer will trim cannot take
   * another project's monitors with it on the way through.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const authorizedQuery: Query<Model> =
      await ModelPermission.checkDeleteQueryPermission(
        Model,
        deleteBy.query,
        deleteBy.props,
      );

    const policies: Array<Model> = await this.findBy({
      query: authorizedQuery,
      select: {
        _id: true,
        projectId: true,
      },
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      props: { isRoot: true },
    });

    for (const policy of policies) {
      if (!policy.id || !policy.projectId) {
        continue;
      }

      const deleted: number =
        await NetworkAlertPolicyEngineService.deleteMonitorsOwnedByPolicy({
          projectId: policy.projectId,
          policyId: policy.id,
        });

      if (deleted > 0) {
        logger.debug(
          `NetworkAlertPolicy ${policy.id.toString()} deleted; removed ${deleted} monitor(s) it owned.`,
        );
      }
    }

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
