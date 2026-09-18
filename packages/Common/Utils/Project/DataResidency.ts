import ColumnLength from "../../Types/Database/ColumnLength";
import BadDataException from "../../Types/Exception/BadDataException";

/*
 * Project.dataResidency is a free-text label a master admin puts on a SaaS
 * project - "EU (Frankfurt)", "US East" - to record where the customer's data
 * is meant to live. Today it is informational only: nothing routes data by it.
 *
 * The rules live here rather than in ProjectService so that the server, which
 * stores the value, and the dashboard, which decides whether to show it,
 * cannot disagree about what "not set" means.
 */
export default class DataResidencyUtil {
  // Project.dataResidency is a ShortText column.
  public static readonly MAX_LENGTH: number = ColumnLength.ShortText;

  /*
   * Surrounding whitespace is dropped, and a value that is nothing but
   * whitespace is stored as null. Without that, clearing the field in a form
   * could store "" or "  ", which the dashboard would have to treat as unset
   * anyway - and any query for projects without a residency would miss them.
   */
  public static normalize(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value !== "string") {
      throw new BadDataException("Data residency must be text.");
    }

    const trimmed: string = value.trim();

    if (!trimmed) {
      return null;
    }

    if (trimmed.length > DataResidencyUtil.MAX_LENGTH) {
      throw new BadDataException(
        `Data residency cannot be more than ${DataResidencyUtil.MAX_LENGTH} characters.`,
      );
    }

    return trimmed;
  }

  public static isSet(value: unknown): boolean {
    return typeof value === "string" && value.trim().length > 0;
  }

  /*
   * Data residency only means something on a server that bills - a
   * self-hosted install is wherever its operator put it. The project settings
   * page shows the row only when both hold, so a project with no residency
   * shows no empty "Data Residency" row.
   */
  public static shouldShowInProjectSettings(data: {
    isBillingEnabled: boolean;
    dataResidency: unknown;
  }): boolean {
    return data.isBillingEnabled && DataResidencyUtil.isSet(data.dataResidency);
  }
}
