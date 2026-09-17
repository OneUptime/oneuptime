import DatabaseService from "./DatabaseService";
import NetworkSiteService from "./NetworkSiteService";
import Model from "../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import RuleCriteria, {
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../Types/Rules/RuleCriteria";
import CidrMatchUtil from "../../Utils/NetworkSite/CidrMatchUtil";
import { getRuleCriteriaValidationError } from "../../Utils/Rules/RuleCriteriaMatcher";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";

/*
 * The dashboard posts the `site` relation while server-side callers write the
 * `siteId` column; read whichever is present. See RelationIdUtil.
 */
const SITE_KEYS: Array<string> = ["siteId", "site"];

const HOSTNAME_OPERATORS: ReadonlySet<RuleCriteriaOperator> = new Set([
  RuleCriteriaOperator.Equals,
  RuleCriteriaOperator.NotEquals,
  RuleCriteriaOperator.Contains,
  RuleCriteriaOperator.DoesNotContain,
  RuleCriteriaOperator.StartsWith,
  RuleCriteriaOperator.EndsWith,
  RuleCriteriaOperator.MatchesPattern,
  RuleCriteriaOperator.DoesNotMatchPattern,
]);

function readSiteId(data: Record<string, unknown>): ObjectID | null {
  return RelationIdUtil.read(data, SITE_KEYS);
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The FK behind siteId only requires the NetworkSite row to exist, not that
   * it belongs to the rule's project. A rule pointing at a foreign site is
   * both a cross-tenant read (the rules table renders `site.name`) and a rule
   * that can never assign anything - NetworkDeviceService's own tenancy guard
   * rejects the resulting device update. Fail at write time instead, where
   * the user can see it.
   */
  private async assertSiteBelongsToProject(data: {
    siteId: ObjectID;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      return;
    }

    const site: NetworkSite | null = await NetworkSiteService.findOneById({
      id: data.siteId,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!site) {
      throw new BadDataException("Network site not found.");
    }

    if (
      site.projectId &&
      site.projectId.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException(
        "Network site must belong to the same project.",
      );
    }
  }

  /*
   * A rule with neither criterion would match nothing (or, worse, read as
   * "match everything" to a future maintainer) - reject it at write time.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    this.validateCriteria({
      criteria: createBy.data.criteria,
      subnetCidr: createBy.data.subnetCidr,
      hostnamePattern: createBy.data.hostnamePattern,
    });

    const siteId: ObjectID | null = readSiteId(
      createBy.data as unknown as Record<string, unknown>,
    );

    if (siteId) {
      await this.assertSiteBelongsToProject({
        siteId: siteId,
        projectId: createBy.data.projectId,
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
      dataKeys.includes("criteria") ||
      dataKeys.includes("subnetCidr") ||
      dataKeys.includes("hostnamePattern");

    const newSiteId: ObjectID | null = readSiteId(
      updateBy.data as unknown as Record<string, unknown>,
    );

    if (!isCriteriaChange && !newSiteId) {
      return { updateBy, carryForward: null };
    }

    /*
     * The update may clear one criterion while the other only exists on the
     * stored row, so validate the RESULTING state of every matched row.
     */
    const existingRules: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        projectId: true,
        subnetCidr: true,
        hostnamePattern: true,
        criteria: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const existingRule of existingRules) {
      if (isCriteriaChange) {
        this.validateCriteria({
          criteria: dataKeys.includes("criteria")
            ? (updateBy.data as { criteria?: unknown }).criteria
            : existingRule.criteria,
          subnetCidr: dataKeys.includes("subnetCidr")
            ? ((updateBy.data as any)["subnetCidr"] as string | null)
            : existingRule.subnetCidr,
          hostnamePattern: dataKeys.includes("hostnamePattern")
            ? ((updateBy.data as any)["hostnamePattern"] as string | null)
            : existingRule.hostnamePattern,
        });
      }

      if (newSiteId) {
        await this.assertSiteBelongsToProject({
          siteId: newSiteId,
          projectId: existingRule.projectId,
        });
      }
    }

    return { updateBy, carryForward: null };
  }

  private validateCriteria(data: {
    criteria?: unknown;
    subnetCidr?: string | null | undefined;
    hostnamePattern?: string | null | undefined;
  }): void {
    if (data.criteria !== undefined && data.criteria !== null) {
      const validationError: string | null = getRuleCriteriaValidationError(
        data.criteria,
      );

      if (validationError) {
        throw new BadDataException(validationError);
      }

      const criteria: RuleCriteria = data.criteria as RuleCriteria;

      if (criteria.filters.length === 0) {
        throw new BadDataException(
          "At least one network site assignment condition is required.",
        );
      }

      for (const filter of criteria.filters) {
        this.validateConfiguredFilter(filter);
      }

      return;
    }

    const subnetCidr: string = (data.subnetCidr || "").trim();
    const hostnamePattern: string = (data.hostnamePattern || "").trim();

    if (!subnetCidr && !hostnamePattern) {
      throw new BadDataException(
        "At least one of Subnet CIDR or Hostname Pattern is required.",
      );
    }

    if (subnetCidr && !CidrMatchUtil.isValidCidr(subnetCidr)) {
      throw new BadDataException(
        `${subnetCidr} is not a valid IPv4 CIDR (expected e.g. 10.0.0.0/24).`,
      );
    }
  }

  private validateConfiguredFilter(filter: RuleCriteriaFilter): void {
    const value: string = String(filter.value).trim();

    if (filter.field === "subnetCidr") {
      if (
        filter.operator !== RuleCriteriaOperator.MatchesPattern &&
        filter.operator !== RuleCriteriaOperator.DoesNotMatchPattern
      ) {
        throw new BadDataException(
          "Subnet CIDR conditions must use a CIDR match operator.",
        );
      }

      if (!CidrMatchUtil.isValidCidr(value)) {
        throw new BadDataException(
          `${value} is not a valid IPv4 CIDR (expected e.g. 10.0.0.0/24).`,
        );
      }

      return;
    }

    if (filter.field !== "hostnamePattern") {
      throw new BadDataException(
        `${filter.field} is not a supported network site assignment condition.`,
      );
    }

    if (!HOSTNAME_OPERATORS.has(filter.operator)) {
      throw new BadDataException(
        `${filter.operator} is not supported for Hostname Pattern.`,
      );
    }

    if (value.length > CidrMatchUtil.MAX_HOSTNAME_PATTERN_LENGTH) {
      throw new BadDataException(
        `Hostname Pattern cannot exceed ${CidrMatchUtil.MAX_HOSTNAME_PATTERN_LENGTH} characters.`,
      );
    }
  }
}

export default new Service();
