import DatabaseService from "./DatabaseService";
import VMwareResourceService from "./VMwareResourceService";
import VMwareVCenterService from "./VMwareVCenterService";
import Model from "../../Models/DatabaseModels/VMwareHealthRuleOverride";
import VMwareResource from "../../Models/DatabaseModels/VMwareResource";
import VMwareVCenter from "../../Models/DatabaseModels/VMwareVCenter";
import BadDataException from "../../Types/Exception/BadDataException";
import { VMwareResourceKind } from "../../Types/Monitor/MonitorStepVMwareMonitor";
import ObjectID from "../../Types/ObjectID";
import {
  VMWARE_HEALTH_RULE_SCOPE_KIND,
  VMwareHealthRuleScope,
  cleanVMwareHealthRuleOverrideRules,
  getVMwareHealthRuleOverrideRulesRefusal,
} from "../../Types/VMware/VMwareHealthRuleOverrides";
import QueryHelper from "../Types/Database/QueryHelper";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * A vCenter's, a cluster's, an ESXi host's or a VM's own health rules
 * (VMwareHealthRuleOverride, #11469). It keeps what it is told only when it
 * makes sense:
 *
 *   - the vCenter is one the caller may read, and the cluster, host or VM is
 *     in it - found among its parts as the caller may read them, so nobody
 *     names a part they cannot see;
 *   - where the part sits is copied from its row, never taken from the
 *     caller: an override's reach is worked out from it;
 *   - one override per part;
 *   - each rule is one the part's kind is judged by, at a value the rule can
 *     take (Common/Types/VMware/VMwareHealthRuleOverrides).
 *
 * What it is about - its vCenter, its scope, its part - is fixed once made:
 * an override is changed by its rules, and moved by making another.
 */

export const VMWARE_HEALTH_RULE_OVERRIDE_SCOPE_ERROR: string =
  "Choose what the rules apply to: a whole vCenter, a cluster, an ESXi host or a VM.";
export const VMWARE_HEALTH_RULE_OVERRIDE_VCENTER_ERROR: string =
  "That vCenter is not in this project, or you may not read it. Choose one of the project's vCenters.";
export const VMWARE_HEALTH_RULE_OVERRIDE_PART_ERROR: string =
  "That part is not in the vCenter, or you may not read it. Choose one the vCenter reports.";
export const VMWARE_HEALTH_RULE_OVERRIDE_TAKEN_ERROR: string =
  "That already has rules of its own. Edit them instead of adding another.";

function isScope(value: unknown): value is VMwareHealthRuleScope {
  return Object.values(VMwareHealthRuleScope).includes(
    value as VMwareHealthRuleScope,
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
    const data: Model = createBy.data;

    if (!isScope(data.scope)) {
      throw new BadDataException(VMWARE_HEALTH_RULE_OVERRIDE_SCOPE_ERROR);
    }

    const projectId: ObjectID | undefined =
      data.projectId || createBy.props.tenantId;

    if (!projectId || !data.vmwareVCenterId) {
      throw new BadDataException(VMWARE_HEALTH_RULE_OVERRIDE_VCENTER_ERROR);
    }

    const vcenter: VMwareVCenter | null = await VMwareVCenterService.findOneBy({
      query: {
        _id: data.vmwareVCenterId,
        projectId: projectId,
      },
      select: { _id: true },
      props: createBy.props,
    });

    if (!vcenter) {
      throw new BadDataException(VMWARE_HEALTH_RULE_OVERRIDE_VCENTER_ERROR);
    }

    const kind: VMwareResourceKind | null =
      VMWARE_HEALTH_RULE_SCOPE_KIND[data.scope];

    if (kind === null) {
      // The whole vCenter: no part, and nothing to copy.
      data.resourceExternalId = null as unknown as string;
      data.resourceName = null as unknown as string;
      data.datacenterName = null as unknown as string;
      data.clusterName = null as unknown as string;
      data.hostName = null as unknown as string;
    } else {
      const externalId: string = (data.resourceExternalId || "").trim();

      if (!externalId) {
        throw new BadDataException(VMWARE_HEALTH_RULE_OVERRIDE_PART_ERROR);
      }

      const part: VMwareResource | null = await VMwareResourceService.findOneBy(
        {
          query: {
            projectId: projectId,
            vmwareVCenterId: data.vmwareVCenterId,
            kind: kind,
            externalId: externalId,
          },
          select: {
            externalId: true,
            name: true,
            datacenterName: true,
            clusterName: true,
            hostName: true,
          },
          props: createBy.props,
        },
      );

      if (!part) {
        throw new BadDataException(VMWARE_HEALTH_RULE_OVERRIDE_PART_ERROR);
      }

      data.resourceExternalId = externalId;
      data.resourceName = (part.name || null) as unknown as string;
      data.datacenterName = (part.datacenterName || null) as unknown as string;
      /*
       * A cluster's and a host's own name is what its hosts and VMs name it
       * by: the cluster's row names it as its cluster, a host's as its name.
       */
      data.clusterName = (part.clusterName ||
        (kind === VMwareResourceKind.Cluster ? part.name : null) ||
        null) as unknown as string;
      data.hostName = (part.hostName ||
        (kind === VMwareResourceKind.Host ? part.name : null) ||
        null) as unknown as string;
    }

    const taken: Model | null = await this.findOneBy({
      query: {
        projectId: projectId,
        vmwareVCenterId: data.vmwareVCenterId,
        scope: data.scope,
        resourceExternalId: data.resourceExternalId
          ? data.resourceExternalId
          : QueryHelper.isNull(),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (taken) {
      throw new BadDataException(VMWARE_HEALTH_RULE_OVERRIDE_TAKEN_ERROR);
    }

    const refusal: string | null = getVMwareHealthRuleOverrideRulesRefusal(
      data.scope,
      data.rules,
    );

    if (refusal) {
      throw new BadDataException(refusal);
    }

    data.rules = cleanVMwareHealthRuleOverrideRules(data.scope, data.rules);

    return { createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    if (data["rules"] === undefined) {
      return { updateBy, carryForward: undefined };
    }

    /*
     * Each override's rules are checked against its own scope: the rows
     * this update writes, read as it will write them.
     */
    const overrides: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      { _id: true, scope: true },
    );

    for (const override of overrides) {
      if (!isScope(override.scope)) {
        continue;
      }

      const refusal: string | null = getVMwareHealthRuleOverrideRulesRefusal(
        override.scope,
        data["rules"],
      );

      if (refusal) {
        throw new BadDataException(refusal);
      }
    }

    /*
     * One scope per update in practice (an override is edited by its id).
     * The rules are kept as sent once every row allows them; the clean
     * copy drops keys sent as undefined.
     */
    const scope: VMwareHealthRuleScope | undefined = overrides.find(
      (override: Model): boolean => {
        return isScope(override.scope);
      },
    )?.scope;

    if (scope) {
      data["rules"] = cleanVMwareHealthRuleOverrideRules(scope, data["rules"]);
    }

    return { updateBy, carryForward: undefined };
  }
}

export default new Service();
