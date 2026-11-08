import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import MonitorEvaluationDetails, {
  MonitorEvaluationDetailsVersion,
  MonitorEvaluationFilterDetails,
} from "../../Types/Monitor/MonitorEvaluationDetails";

/*
 * Reads and writes the evaluation details stored on an incident or an alert
 * (Common/Types/Monitor/MonitorEvaluationDetails). Pure, so the server that
 * stores them and the Dashboard that shows them agree on the encoding.
 */
export default class MonitorEvaluationDetailsUtil {
  /*
   * Encode for the jsonb column. Dates are wrapped by JSONFunctions so they
   * come back as Dates, the way the monitor summary round-trips.
   */
  public static serialize(
    details: MonitorEvaluationDetails | null | undefined,
  ): JSONObject | null {
    if (!details) {
      return null;
    }

    return JSONFunctions.serialize(details as unknown as JSONObject);
  }

  /*
   * Read a stored record back. Null for anything this build does not
   * understand - another version, a record with no filters - rather than a
   * half-read section.
   */
  public static deserialize(
    stored: JSONObject | null | undefined,
  ): MonitorEvaluationDetails | null {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return null;
    }

    let details: MonitorEvaluationDetails | null = null;

    try {
      details = JSONFunctions.deserialize(
        stored,
      ) as unknown as MonitorEvaluationDetails;
    } catch {
      return null;
    }

    if (!details || details.version !== MonitorEvaluationDetailsVersion) {
      return null;
    }

    if (!Array.isArray(details.filters) || details.filters.length === 0) {
      return null;
    }

    const filters: Array<MonitorEvaluationFilterDetails> =
      details.filters.filter((filter: MonitorEvaluationFilterDetails) => {
        return (
          Boolean(filter) &&
          typeof filter === "object" &&
          typeof filter.checkOn === "string"
        );
      });

    if (filters.length === 0) {
      return null;
    }

    /*
     * Every record says when it was evaluated; one whose time cannot be
     * read is not one this build wrote.
     */
    const evaluatedAt: Date | undefined =
      details.evaluatedAt instanceof Date &&
      !isNaN(details.evaluatedAt.getTime())
        ? details.evaluatedAt
        : MonitorEvaluationDetailsUtil.toDate(details.evaluatedAt);

    if (!evaluatedAt) {
      return null;
    }

    return {
      ...details,
      filters: filters,
      evaluatedAt: evaluatedAt,
    };
  }

  // The filters that matched, in the criteria's order.
  public static getMatchedFilters(
    details: MonitorEvaluationDetails,
  ): Array<MonitorEvaluationFilterDetails> {
    return details.filters.filter((filter: MonitorEvaluationFilterDetails) => {
      return filter.met;
    });
  }

  private static toDate(value: unknown): Date | undefined {
    if (typeof value !== "string" && typeof value !== "number") {
      return undefined;
    }

    const date: Date = new Date(value);

    return isNaN(date.getTime()) ? undefined : date;
  }
}
