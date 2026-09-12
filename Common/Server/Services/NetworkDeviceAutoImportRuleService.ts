import DatabaseService from "./DatabaseService";
import MonitorTemplateService from "./MonitorTemplateService";
import NetworkAlertPolicyService from "./NetworkAlertPolicyService";
import NetworkDeviceAutoImportRuleEngineService from "./NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceOidTemplateService from "./NetworkDeviceOidTemplateService";
import Model from "../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "../../Models/DatabaseModels/NetworkAlertPolicy";
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
import QueryHelper from "../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Utils/Logger";
import {
  getRuleCriteriaValidationError,
  isValidRuleCriteria,
} from "../../Utils/Rules/RuleCriteriaMatcher";
import RuleCriteria, {
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../Types/Rules/RuleCriteria";

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

/*
 * What onUpdateSuccess needs to know about an update it did not see the
 * payload of: did this save change anything about WHICH hosts the rule
 * claims, or what it does with them?
 *
 * Only the answer travels — not the rule's resulting state, which is read
 * back from the row instead. A payload's `isEnabled` may arrive as the string
 * "false" from a form post, and a rule mis-read as enabled would re-arm the
 * project's scans on the very save that switched the rule off.
 */
interface AutoImportRuleUpdatePlan {
  isRuleReachChanged: boolean;
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
      criteria: createBy.data.criteria,
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
      dataKeys.includes("sysObjectIdPattern") ||
      dataKeys.includes("criteria");

    /*
     * `includePingOnlyHosts` is deliberately not here. A ping-only host
     * imports as a Probe device like any other under ping-first polling, so
     * whether a rule includes such hosts has no bearing on whether it may
     * carry a Network Device monitor template — toggling it validates
     * nothing and must not cost a template lookup.
     */
    const isMonitorProvisioningChange: boolean =
      RelationIdUtil.isWritten(dataKeys, MONITOR_TEMPLATE_KEYS) ||
      dataKeys.includes("isExclusion") ||
      dataKeys.includes("isEnabled");

    const isOidTemplateChange: boolean = RelationIdUtil.isWritten(
      dataKeys,
      OID_TEMPLATE_KEYS,
    );

    /*
     * Everything that can change what this rule imports, or what it creates
     * for what it imports — the trigger for re-arming the project's recent
     * scan results in onUpdateSuccess.
     *
     * `includePingOnlyHosts` is here even though it is not a "criteria
     * change" above: it decides whether a whole class of discovered host is
     * claimed, which is precisely reach. A rename or a description edit is
     * not, and must not cost the project a sweep.
     *
     * The OID template is deliberately absent: it is copied onto devices as
     * they are created and is not reconciled onto devices that already
     * exist, so pointing a rule at a different one changes nothing about
     * results already evaluated.
     */
    const plan: AutoImportRuleUpdatePlan = {
      isRuleReachChanged:
        isCriteriaChange ||
        isMonitorProvisioningChange ||
        dataKeys.includes("includePingOnlyHosts"),
    };

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
      return { updateBy, carryForward: plan };
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
        criteria: true,
        ipMatchTarget: true,
        sysNamePattern: true,
        sysDescrPattern: true,
        sysObjectIdPattern: true,
        isExclusion: true,
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
          criteria: dataKeys.includes("criteria")
            ? (data["criteria"] as RuleCriteria | null | undefined)
            : existingRule.criteria,
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
          !dataKeys.includes("isExclusion");

        if (monitorTemplateId && !isOnlyDisablingRule) {
          await this.validateMonitorTemplateSelection({
            monitorTemplateId: monitorTemplateId,
            projectId: updateBy.props.tenantId || existingRule.projectId,
            isExclusion: dataKeys.includes("isExclusion")
              ? data["isExclusion"] === true
              : existingRule.isExclusion,
            props: updateBy.props,
          });
        }
      }
    }

    return { updateBy, carryForward: plan };
  }

  /*
   * A rule that can import must not have to wait for the next scan to prove
   * it — see rearmRecentScansForRuleChange on the engine, and issue #3487.
   *
   * The sweep only ever looks at results nothing has evaluated yet, so
   * without this a rule written after a scan finished reaches nothing at all
   * until that scan runs again — never, for the one-shot scans most projects
   * start with — and the operator is left pressing "Run Now" by hand for
   * work the product describes as automatic.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    this.rearmRecentScansForRules([
      /*
       * projectId off the saved row, falling back to the tenant the write
       * ran under: a create that named the project through the relation
       * alone still has to reach the right scans.
       */
      {
        projectId: createdItem.projectId || onCreate.createBy.props.tenantId,
        isEnabled: createdItem.isEnabled,
        isExclusion: createdItem.isExclusion,
      },
    ]);

    return createdItem;
  }

  /*
   * The same re-arm for an EDIT that changes what the rule claims: enabling a
   * rule, widening its criteria, or attaching a monitor template to it all
   * make the project's recent results answer differently than they did when
   * the sweep last read them.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const plan: AutoImportRuleUpdatePlan | null =
      (onUpdate.carryForward as AutoImportRuleUpdatePlan | null) || null;

    if (!plan?.isRuleReachChanged || updatedItemIds.length === 0) {
      return onUpdate;
    }

    /*
     * The rules as they stand now that the update has landed, read back
     * rather than predicted from the payload — one update payload is shared
     * by every row its query matched, and the toggles that decide whether a
     * re-arm is worth anything arrive from a form as strings. See
     * AutoImportRuleUpdatePlan.
     */
    const updatedRules: Array<Model> = await this.findBy({
      query: {
        _id: QueryHelper.any(updatedItemIds),
      },
      select: {
        _id: true,
        projectId: true,
        isEnabled: true,
        isExclusion: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    this.rearmRecentScansForRules(updatedRules);

    return onUpdate;
  }

  /*
   * Hand every affected project's recent scan results back to the auto-import
   * sweep, once per project however many of its rules one write touched.
   *
   * Detached on purpose, in the shape NetworkDeviceService.onCreateSuccess
   * uses for its own rule chain: the caller is a rule save, the operator is
   * waiting on its response, and this is a query plus up to a hundred small
   * writes. It must also never fail that save — a re-arm that could not run
   * costs a delay until the next scan result (or one press of Run Now),
   * which is not worth failing an otherwise valid edit over.
   */
  private rearmRecentScansForRules(
    rules: Array<{
      projectId?: ObjectID | undefined;
      isEnabled?: boolean | undefined;
      isExclusion?: boolean | undefined;
    }>,
  ): void {
    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const rule of rules) {
      /*
       * A disabled rule imports nothing, and an exclusion rule only vetoes
       * what other rules claim — neither can newly take a host, so neither
       * is worth a sweep of the project's results. isEnabled is checked
       * against `false` rather than for truth because the column defaults to
       * true: a create that never mentioned it is enabled.
       *
       * The mirror case — an exclusion rule switched off or deleted, which
       * lifts a veto and so widens what the OTHER rules claim — is left to
       * the next scan result or to Run Now. Re-arming needs a write that says
       * "this now claims hosts", and lifting a veto says it only about rules
       * this write never mentioned.
       */
      if (rule.isEnabled === false || rule.isExclusion) {
        continue;
      }

      if (!rule.projectId) {
        continue;
      }

      projectIds.set(rule.projectId.toString(), rule.projectId);
    }

    for (const projectId of projectIds.values()) {
      NetworkDeviceAutoImportRuleEngineService.rearmRecentScansForRuleChange({
        projectId: projectId,
      }).catch((error: Error) => {
        logger.error(
          `Error re-arming discovery scan results after an auto-import rule was written: ${error}`,
          { projectId: projectId.toString() } as LogAttributes,
        );
      });
    }
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

  /*
   * Ping-only hosts are not a reason to refuse a template. They used to be —
   * "Rules that include ping-only hosts cannot select a Network Device
   * monitor template" — because such a host imported monitor-backed, with
   * polling off, and a Network Device monitor on it could never be fed.
   * Under ping-first polling it imports as a Probe device that is pinged on
   * schedule, and the monitor's reachability criteria evaluate from that
   * ping while its OID and interface criteria wait, unevaluated, for
   * credentials. The engine's only guard is the DEVICE's method.
   */
  private async validateMonitorTemplateSelection(data: {
    monitorTemplateId: ObjectID;
    projectId: ObjectID | undefined;
    isExclusion?: boolean | null | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.isExclusion) {
      throw new BadDataException(
        "Exclusion rules cannot select a monitor template.",
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

    /*
     * NO TEMPLATE IS SHARED WITH A NETWORK ALERT POLICY. This is the rule
     * half of the check NetworkAlertPolicyService makes from the other side,
     * and both halves have to exist or whichever thing is created second
     * wins by accident.
     *
     * A provisioned monitor's provenance is the pair (device, template) —
     * that is the partial unique index Monitor carries — so one template has
     * room for exactly one provisioner per device. If a rule and a policy
     * shared one, the rule would provision a monitor on import, the policy's
     * engine would find a monitor for its own (device, template) pair,
     * believe it provisioned it, and delete it the moment that device left
     * the policy's scope: an operator's import rule silently losing its
     * monitors because somebody edited a policy's site list.
     *
     * Read as root and keyed on the project, like every other tenancy read
     * in this file: the answer is about this project's own configuration.
     */
    const policiesOnTemplate: Array<NetworkAlertPolicy> =
      await NetworkAlertPolicyService.findBy({
        query: {
          projectId: data.projectId,
          monitorTemplateId: data.monitorTemplateId,
        },
        select: {
          _id: true,
        },
        limit: 1,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    if (policiesOnTemplate.length > 0) {
      throw new BadDataException(
        "This Monitor Template is used by a network alert policy; pick a different template.",
      );
    }
  }

  private validateCriteria(data: {
    criteria?: RuleCriteria | null | undefined;
    ipMatchTarget?: string | null | undefined;
    sysNamePattern?: string | null | undefined;
    sysDescrPattern?: string | null | undefined;
    sysObjectIdPattern?: string | null | undefined;
  }): void {
    if (data.criteria !== undefined && data.criteria !== null) {
      const validationError: string | null = getRuleCriteriaValidationError(
        data.criteria,
      );

      if (validationError) {
        throw new BadDataException(validationError);
      }

      if (!isValidRuleCriteria(data.criteria)) {
        throw new BadDataException("Rule criteria is invalid.");
      }

      if (data.criteria.filters.length === 0) {
        throw new BadDataException(
          "At least one auto-import match condition is required.",
        );
      }

      const supportedFields: Set<string> = new Set([
        "ipMatchTarget",
        "sysNamePattern",
        "sysDescrPattern",
        "sysObjectIdPattern",
      ]);

      for (const filter of data.criteria.filters) {
        if (!supportedFields.has(filter.field)) {
          throw new BadDataException(
            `Unsupported auto-import match condition: ${filter.field}`,
          );
        }

        if (Array.isArray(filter.value)) {
          throw new BadDataException(
            `${filter.field} requires a text comparison operator.`,
          );
        }

        if (
          filter.operator !== RuleCriteriaOperator.MatchesPattern &&
          filter.operator !== RuleCriteriaOperator.DoesNotMatchPattern
        ) {
          continue;
        }

        this.validateConfiguredPattern(filter);
      }

      return;
    }

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

  private validateConfiguredPattern(filter: RuleCriteriaFilter): void {
    const pattern: string = String(filter.value).trim();

    if (filter.field === "ipMatchTarget") {
      if (!ScanTargetUtil.isValid(pattern)) {
        throw new BadDataException(
          `"${pattern}" is not a valid Host IP condition. ${ScanTargetUtil.getSyntaxHint()}`,
        );
      }
      return;
    }

    if (filter.field === "sysObjectIdPattern") {
      this.validateOidPattern(pattern);
      return;
    }

    this.validatePattern(
      filter.field === "sysNamePattern"
        ? "System Name Pattern"
        : "System Description Pattern",
      pattern,
    );
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
