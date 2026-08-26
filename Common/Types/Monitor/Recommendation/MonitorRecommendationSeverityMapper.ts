import ObjectID from "../../ObjectID";
import {
  MonitorRecommendationSeverity,
  MonitorRecommendationSeverityMap,
} from "./MonitorRecommendationTypes";

/*
 * The slice of an IncidentSeverity / AlertSeverity row this mapping needs.
 *
 * Deliberately structural rather than the model classes: this module lives in
 * `Common/Types` and is imported by both the dashboard and the tests, neither
 * of which should have to construct a full database model to ask "which
 * severity does Warning map to".
 */
export interface MonitorRecommendationSeverityOption {
  id: ObjectID;
  name: string;
  // Project-defined rank. 1 is the most severe. May be absent on legacy rows.
  order?: number | undefined;
}

/*
 * Maps a recommendation's declared severity (`Critical` / `Warning`) onto one
 * of the project's own incident or alert severities.
 *
 * Why this exists: the templates take a single `defaultIncidentSeverityId`
 * argument, and the page filled it with the project's first severity. So
 * "Deployment Replica Mismatch" (Warning) and "Node Not Ready" (Critical)
 * both opened a Critical Incident. Every recommendation paged at the same
 * level, and the Critical/Warning badge on the card described nothing that
 * happened afterwards.
 *
 * The rule is intentionally boring and order-based rather than name-based:
 * severities are user-renameable ("Sev1", "P0", "Critical Incident", localized
 * names), so matching on a name works for the default seed and for nothing
 * else. `order` is the field the product itself treats as rank.
 */
export default class MonitorRecommendationSeverityMapper {
  /*
   * Severities ranked most-severe first.
   *
   * Sorted by `order` ascending, with rows missing an order pushed to the end
   * rather than treated as order 0 — an unset order is "unranked", and
   * silently promoting it to most-severe would map every Critical
   * recommendation onto it.
   *
   * Ties (two severities sharing an order, which the product permits) fall
   * back to the incoming array order, so the mapping is stable across calls
   * given the same input. Callers pass the list already sorted by order from
   * the API, so in practice this is the API's own ordering.
   */
  public static rankSeverities(
    options: Array<MonitorRecommendationSeverityOption>,
  ): Array<MonitorRecommendationSeverityOption> {
    return [...options].sort(
      (
        a: MonitorRecommendationSeverityOption,
        b: MonitorRecommendationSeverityOption,
      ) => {
        const aOrder: number =
          typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
        const bOrder: number =
          typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;

        return aOrder - bOrder;
      },
    );
  }

  /*
   * The default Critical -> ? / Warning -> ? mapping for a project.
   *
   * Critical takes the most severe row. Warning takes the next one down, and
   * falls back to the same row as Critical when the project only defines one
   * severity — a project with a single severity has no way to express the
   * distinction, and refusing to map Warning at all would leave those monitors
   * on the template's own choice, which is the bug this class exists to fix.
   *
   * Warning deliberately takes the SECOND severity rather than the LAST. On
   * the default seed those are the same row (incidents: Critical/Major/Minor
   * -> Major either way is second, Minor is last), but a project with five
   * severities means "Warning" much closer to Major than to the bottom of the
   * scale, and a recommendation the catalog calls Warning is a real
   * production problem, not a nitpick.
   */
  public static getDefaultSeverityMapping(
    options: Array<MonitorRecommendationSeverityOption>,
  ): MonitorRecommendationSeverityMap {
    const ranked: Array<MonitorRecommendationSeverityOption> =
      this.rankSeverities(options);

    if (ranked.length === 0) {
      return {};
    }

    const mostSevere: MonitorRecommendationSeverityOption = ranked[0]!;
    const nextSevere: MonitorRecommendationSeverityOption =
      ranked[1] || mostSevere;

    return {
      Critical: mostSevere.id,
      Warning: nextSevere.id,
    };
  }

  /*
   * Resolve one recommendation's severity through a mapping.
   *
   * Returns undefined when the mapping has no entry, which callers must treat
   * as "leave the template's own severity alone" rather than as "no severity"
   * — a criteria instance that creates incidents (`createIncidents`) and has a
   * populated incident with no severity id fails
   * `MonitorCriteriaInstance.getValidationError` and the whole create fails.
   */
  public static resolveSeverityId(data: {
    severity: MonitorRecommendationSeverity;
    severityMap?: MonitorRecommendationSeverityMap | undefined;
  }): ObjectID | undefined {
    if (!data.severityMap) {
      return undefined;
    }

    return data.severityMap[data.severity];
  }

  /*
   * Human-readable "Critical -> Critical Incident" pairs, for the create form
   * to show what it is about to do. Rendering the mapping is the only thing
   * that makes an automatic choice reviewable instead of surprising.
   */
  public static describeMapping(data: {
    options: Array<MonitorRecommendationSeverityOption>;
    severityMap?: MonitorRecommendationSeverityMap | undefined;
  }): Array<{ severity: MonitorRecommendationSeverity; name: string }> {
    const severities: Array<MonitorRecommendationSeverity> = [
      "Critical",
      "Warning",
    ];

    const described: Array<{
      severity: MonitorRecommendationSeverity;
      name: string;
    }> = [];

    for (const severity of severities) {
      const id: ObjectID | undefined = this.resolveSeverityId({
        severity: severity,
        severityMap: data.severityMap,
      });

      if (!id) {
        continue;
      }

      const match: MonitorRecommendationSeverityOption | undefined =
        data.options.find((option: MonitorRecommendationSeverityOption) => {
          return option.id.toString() === id.toString();
        });

      if (!match) {
        continue;
      }

      described.push({ severity: severity, name: match.name });
    }

    return described;
  }
}
