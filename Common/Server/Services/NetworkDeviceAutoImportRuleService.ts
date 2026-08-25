import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import ScanTargetUtil from "../../Utils/NetworkDiscovery/ScanTargetUtil";

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

    if (!isCriteriaChange) {
      return { updateBy, carryForward: null };
    }

    /*
     * The update may clear one criterion while another only exists on the
     * stored row, so validate the RESULTING state of every matched row.
     */
    const existingRules: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        ipMatchTarget: true,
        sysNamePattern: true,
        sysDescrPattern: true,
        sysObjectIdPattern: true,
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

    for (const existingRule of existingRules) {
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

    return { updateBy, carryForward: null };
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
