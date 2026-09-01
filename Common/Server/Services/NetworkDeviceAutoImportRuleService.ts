import DatabaseService from "./DatabaseService";
import MonitorTemplateService from "./MonitorTemplateService";
import NetworkDeviceOidTemplateService from "./NetworkDeviceOidTemplateService";
import Model from "../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../Models/DatabaseModels/MonitorTemplate";
import NetworkDeviceOidTemplate from "../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import ScanTargetUtil from "../../Utils/NetworkDiscovery/ScanTargetUtil";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../Types/Database/Permissions/TablePermission";
import NetworkDeviceMonitorTemplateUtil from "../../Utils/Monitor/NetworkDeviceMonitorTemplateUtil";

/*
 * Write-time validation for auto-import rules, following the
 * NetworkSiteAssignmentRuleService contract: a condition that can only ever
 * match nothing is rejected where the user can see it, not logged about by
 * the engine long after they left the form.
 */

/*
 * What a sysObjectID condition may contain: an optional leading dot, then
 * digits, dots and '*' wildcards. Hoisted so the literal is not the object
 * of a member expression, which `wrap-regex` and Prettier cannot agree on —
 * same reason as CidrMatchUtil.
 */
const OID_PATTERN_SHAPE: RegExp = /^\.?[\d.*]+$/;
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

const OID_TEMPLATE_KEYS: Array<string> = ["oidTemplateId", "oidTemplate"];

function readOidTemplateId(data: Record<string, unknown>): ObjectID | null {
  return RelationIdUtil.readConsistent(
    data,
    OID_TEMPLATE_KEYS,
    "OID Collection Template",
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
    this.validateCriteria({
      ipMatchTarget: createBy.data.ipMatchTarget,
      sysNamePattern: createBy.data.sysNamePattern,
      sysDescrPattern: createBy.data.sysDescrPattern,
      sysObjectIdPattern: createBy.data.sysObjectIdPattern,
    });

    const monitorTemplateId: ObjectID | null = readMonitorTemplateId(
      createBy.data as unknown as Record<string, unknown>,
    );

    if (monitorTemplateId) {
      await this.validateMonitorTemplateSelection({
        monitorTemplateId: monitorTemplateId,
        projectId: createBy.props.tenantId || createBy.data.projectId,
        isExclusion: createBy.data.isExclusion,
        includePingOnlyHosts: createBy.data.includePingOnlyHosts,
        props: createBy.props,
      });
    }

    const oidTemplateId: ObjectID | null = readOidTemplateId(
      createBy.data as unknown as Record<string, unknown>,
    );

    if (oidTemplateId) {
      await this.validateOidTemplateSelection({
        oidTemplateId: oidTemplateId,
        projectId: createBy.props.tenantId || createBy.data.projectId,
        props: createBy.props,
      });
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const dataKeys: Array<string> = Object.keys(updateBy.data || {});

    const isCriteriaChange: boolean =
      dataKeys.includes("ipMatchTarget") ||
      dataKeys.includes("sysNamePattern") ||
      dataKeys.includes("sysDescrPattern") ||
      dataKeys.includes("sysObjectIdPattern");

    const isMonitorProvisioningChange: boolean =
      RelationIdUtil.isWritten(dataKeys, MONITOR_TEMPLATE_KEYS) ||
      dataKeys.includes("isExclusion") ||
      dataKeys.includes("includePingOnlyHosts") ||
      dataKeys.includes("isEnabled");

    const isOidTemplateChange: boolean = RelationIdUtil.isWritten(
      dataKeys,
      OID_TEMPLATE_KEYS,
    );

    /*
     * Validated before the early return and independently of the rest: an OID
     * Collection Template is the collect half of the rule, so pointing at one
     * is legitimate on its own and must not need a criteria or monitor change
     * to be checked.
     */
    if (isOidTemplateChange) {
      const writtenOidTemplateId: ObjectID | null = readOidTemplateId(
        updateBy.data as unknown as Record<string, unknown>,
      );

      if (writtenOidTemplateId) {
        await this.validateOidTemplateSelection({
          oidTemplateId: writtenOidTemplateId,
          projectId: updateBy.props.tenantId,
          props: updateBy.props,
        });
      }
    }

    if (!isCriteriaChange && !isMonitorProvisioningChange) {
      return { updateBy, carryForward: null };
    }

    /*
     * The update may clear one criterion while another only exists on the
     * stored row, so validate the RESULTING state of every matched row.
     */
    const existingRules: Array<Model> = await this.findBy({
      /*
       * Hooks run before DatabaseService applies tenant permissions. Scope
       * this privileged snapshot now so a guessed cross-project rule ID
       * cannot become a state oracle through template validation errors.
       */
      query:
        !updateBy.props.isRoot && updateBy.props.tenantId
          ? { ...updateBy.query, projectId: updateBy.props.tenantId }
          : updateBy.query,
      select: {
        _id: true,
        projectId: true,
        ipMatchTarget: true,
        sysNamePattern: true,
        sysDescrPattern: true,
        sysObjectIdPattern: true,
        isExclusion: true,
        includePingOnlyHosts: true,
        isEnabled: true,
        monitorTemplateId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;
    const isMonitorTemplateWritten: boolean = RelationIdUtil.isWritten(
      dataKeys,
      MONITOR_TEMPLATE_KEYS,
    );
    const writtenMonitorTemplateId: ObjectID | null =
      readMonitorTemplateId(data);

    for (const existingRule of existingRules) {
      if (isCriteriaChange) {
        this.validateCriteria({
          ipMatchTarget: dataKeys.includes("ipMatchTarget")
            ? (data["ipMatchTarget"] as string | null)
            : existingRule.ipMatchTarget,
          sysNamePattern: dataKeys.includes("sysNamePattern")
            ? (data["sysNamePattern"] as string | null)
            : existingRule.sysNamePattern,
          sysDescrPattern: dataKeys.includes("sysDescrPattern")
            ? (data["sysDescrPattern"] as string | null)
            : existingRule.sysDescrPattern,
          sysObjectIdPattern: dataKeys.includes("sysObjectIdPattern")
            ? (data["sysObjectIdPattern"] as string | null)
            : existingRule.sysObjectIdPattern,
        });
      }

      const isCriteriaChangeOnEnabledTemplateRule: boolean = Boolean(
        isCriteriaChange &&
          existingRule.monitorTemplateId &&
          (dataKeys.includes("isEnabled")
            ? data["isEnabled"] === true
            : existingRule.isEnabled),
      );

      if (
        isMonitorProvisioningChange ||
        isCriteriaChangeOnEnabledTemplateRule
      ) {
        const monitorTemplateId: ObjectID | null = isMonitorTemplateWritten
          ? writtenMonitorTemplateId
          : existingRule.monitorTemplateId || null;

        const isOnlyDisablingRule: boolean =
          dataKeys.includes("isEnabled") &&
          data["isEnabled"] === false &&
          !isMonitorTemplateWritten &&
          !dataKeys.includes("isExclusion") &&
          !dataKeys.includes("includePingOnlyHosts");

        if (monitorTemplateId && !isOnlyDisablingRule) {
          await this.validateMonitorTemplateSelection({
            monitorTemplateId: monitorTemplateId,
            projectId: updateBy.props.tenantId || existingRule.projectId,
            isExclusion: dataKeys.includes("isExclusion")
              ? data["isExclusion"] === true
              : existingRule.isExclusion,
            includePingOnlyHosts: dataKeys.includes("includePingOnlyHosts")
              ? data["includePingOnlyHosts"] === true
              : existingRule.includePingOnlyHosts,
            props: updateBy.props,
          });
        }
      }
    }

    return { updateBy, carryForward: null };
  }

  /*
   * A rule may only name an OID Collection Template from its own project.
   *
   * Without this, a rule could hold a cross-project reference: the read is
   * tenant-scoped only at the ROOT query, so the rules list would render
   * another project's template name, and every device the rule imported would
   * be created pointing at it. NetworkDeviceService refuses that link, so the
   * devices would simply come out unconfigured — a silent, confusing failure
   * whose cause is one field on a rule nobody is looking at.
   *
   * The read carries the caller's own props, exactly as the monitor-template
   * check does: selecting a template is also a read of it, so a user who
   * cannot see it must not be able to attach it.
   */
  private async validateOidTemplateSelection(data: {
    oidTemplateId: ObjectID;
    projectId: ObjectID | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (!data.projectId) {
      return;
    }

    const oidTemplate: NetworkDeviceOidTemplate | null =
      await NetworkDeviceOidTemplateService.findOneById({
        id: data.oidTemplateId,
        select: {
          _id: true,
          projectId: true,
        },
        props: data.props,
      });

    if (!oidTemplate) {
      throw new BadDataException("OID Collection Template not found.");
    }

    if (
      !oidTemplate.projectId ||
      oidTemplate.projectId.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException(
        "OID Collection Template must belong to the same project.",
      );
    }
  }

  private async validateMonitorTemplateSelection(data: {
    monitorTemplateId: ObjectID;
    projectId: ObjectID | undefined;
    isExclusion?: boolean | null | undefined;
    includePingOnlyHosts?: boolean | null | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.isExclusion) {
      throw new BadDataException(
        "Exclusion rules cannot select a monitor template.",
      );
    }

    if (data.includePingOnlyHosts) {
      throw new BadDataException(
        "Rules that include ping-only hosts cannot select a Network Device monitor template.",
      );
    }

    if (!data.projectId) {
      throw new BadDataException(
        "A project is required when selecting a monitor template.",
      );
    }

    if (!data.props.isRoot && !data.props.isMasterAdmin) {
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
    }

    const monitorTemplate: MonitorTemplate | null =
      await MonitorTemplateService.findOneById({
        id: data.monitorTemplateId,
        select: {
          _id: true,
          projectId: true,
          monitorType: true,
          monitorSteps: true,
        },
        /*
         * Selecting a template is also a read of that template. Preserve the
         * caller's tenant, ownership and label scopes here; otherwise a user
         * who may edit rules and create monitors could attach a template they
         * cannot see, and the background worker would later clone it as root.
         */
        props: data.props,
      });

    if (!monitorTemplate) {
      throw new BadDataException("Monitor template not found.");
    }

    if (
      !monitorTemplate.projectId ||
      monitorTemplate.projectId.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException(
        "Monitor template must belong to the same project.",
      );
    }

    if (monitorTemplate.monitorType !== MonitorType.NetworkDevice) {
      throw new BadDataException(
        "Monitor template must be a Network Device monitor template.",
      );
    }

    NetworkDeviceMonitorTemplateUtil.validateMonitorSteps(
      monitorTemplate.monitorSteps,
      "Monitor template",
    );
  }

  private validateCriteria(data: {
    ipMatchTarget?: string | null | undefined;
    sysNamePattern?: string | null | undefined;
    sysDescrPattern?: string | null | undefined;
    sysObjectIdPattern?: string | null | undefined;
  }): void {
    const ipMatchTarget: string = (data.ipMatchTarget || "").trim();
    const sysNamePattern: string = (data.sysNamePattern || "").trim();
    const sysDescrPattern: string = (data.sysDescrPattern || "").trim();
    const sysObjectIdPattern: string = (data.sysObjectIdPattern || "").trim();

    /*
     * A rule with no conditions matches nothing (see AutoImportRuleMatcher) —
     * and would read as "match everything" to whoever finds it later.
     */
    if (
      !ipMatchTarget &&
      !sysNamePattern &&
      !sysDescrPattern &&
      !sysObjectIdPattern
    ) {
      throw new BadDataException(
        "At least one of Host IP Is In, System Name Pattern, System Description Pattern, or System Object ID Pattern is required.",
      );
    }

    /*
     * Well-formedness only, deliberately NOT the scan-size ceiling: matching
     * an address against 10.0.0.0/8 is a containment check, not a sweep, so
     * a condition covering a huge block is legitimate here even though a
     * scan target that size is not.
     */
    if (ipMatchTarget && !ScanTargetUtil.isValid(ipMatchTarget)) {
      throw new BadDataException(
        `"${ipMatchTarget}" is not a valid Host IP condition. ${ScanTargetUtil.getSyntaxHint()}`,
      );
    }

    this.validatePattern("System Name Pattern", sysNamePattern);
    this.validatePattern("System Description Pattern", sysDescrPattern);
    this.validateOidPattern(sysObjectIdPattern);
  }

  private validatePattern(title: string, pattern: string): void {
    if (!pattern || RulePatternMatchUtil.isSupportedPattern(pattern)) {
      return;
    }

    throw new BadDataException(
      `${title} is neither a valid regular expression nor a '*' wildcard pattern, so it would never match: ${pattern}`,
    );
  }

  /*
   * The sysObjectID condition is NOT free-text: an OID is a dotted numeric
   * arc, matched as a literal-dot '*' glob or an arc prefix (see
   * AutoImportRuleMatcher.matchesOidPattern — regex-first matching would make
   * "1.3.6.1.4.1.9.*" match enterprise 94 too). So the only characters that
   * can ever match anything are digits, dots and '*'; anything else is a
   * pattern that silently never fires, which is exactly what this service
   * exists to reject at the write.
   */
  private validateOidPattern(pattern: string): void {
    if (!pattern) {
      return;
    }

    if (!OID_PATTERN_SHAPE.test(pattern)) {
      throw new BadDataException(
        `System Object ID Pattern must be an OID prefix (1.3.6.1.4.1.9) or a '*' wildcard OID pattern (1.3.6.1.4.1.9.*) — digits, dots and '*' only: ${pattern}`,
      );
    }
  }
}

export default new Service();
