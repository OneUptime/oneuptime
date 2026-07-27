import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import CidrMatchUtil from "../../Utils/NetworkSite/CidrMatchUtil";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
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
      subnetCidr: createBy.data.subnetCidr,
      hostnamePattern: createBy.data.hostnamePattern,
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const dataKeys: Array<string> = Object.keys(updateBy.data || {});

    if (
      !dataKeys.includes("subnetCidr") &&
      !dataKeys.includes("hostnamePattern")
    ) {
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
        subnetCidr: true,
        hostnamePattern: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const existingRule of existingRules) {
      this.validateCriteria({
        subnetCidr: dataKeys.includes("subnetCidr")
          ? ((updateBy.data as any)["subnetCidr"] as string | null)
          : existingRule.subnetCidr,
        hostnamePattern: dataKeys.includes("hostnamePattern")
          ? ((updateBy.data as any)["hostnamePattern"] as string | null)
          : existingRule.hostnamePattern,
      });
    }

    return { updateBy, carryForward: null };
  }

  private validateCriteria(data: {
    subnetCidr?: string | null | undefined;
    hostnamePattern?: string | null | undefined;
  }): void {
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
}

export default new Service();
