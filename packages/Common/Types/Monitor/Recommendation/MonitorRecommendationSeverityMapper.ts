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
 * The pair of ids one `<X>AlertTemplate.getMonitorStep` call needs.
 *
 * Non-optional on both fields: every `<X>AlertTemplateArgs` declares
 * `defaultIncidentSeverityId: ObjectID` and `defaultAlertSeverityId: ObjectID`
 * as required, so a resolver that could return undefined would just move the
 * `|| ObjectID.generate()` fallback back into the eight call sites.
 */
export interface MonitorRecommendationTemplateSeverityIds {
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
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
   * Warning deliberately takes the SECOND severity rather than the LAST.
   *
   * On the default seeds those are not the same answer, and the two seeds are
   * not the same shape. `ProjectService.addDefaultIncidentSeverity` seeds
   * three rows (Critical Incident 1 / Major Incident 2 / Minor Incident 3), so
   * Warning gets Major and NOT Minor — the rule doing real work.
   * `addDefaultAlertSeverity` seeds only two (High 1 / Low 2), so for alerts
   * second IS last and every Warning recommendation resolves to "Low". That is
   * intended and is the only option that preserves the distinction: with two
   * severities, anything else collapses Critical and Warning onto one row,
   * which is the exact bug this class exists to fix. It is also why an alert
   * email can read "SEVERITY: Low" for a template the catalog card labels
   * "Warning" — the create side over shows the user that mapping before they
   * confirm.
   *
   * On a project with five severities the two answers diverge and second is
   * the right one: a recommendation the catalog calls Warning is a real
   * production problem, not the bottom of the scale.
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
   * `getDefaultSeverityMapping` for a list that is ALREADY ranked and carries
   * no `order` column.
   *
   * The monitor form builds its severity dropdowns from an API list sorted
   * `{ order: SortOrder.Ascending }` and keeps only `{ value, label }` (see
   * App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps.tsx), so
   * position IS the rank by the time it reaches a template picker.
   * Synthesising `order` from the index rather than adding a second ranking
   * rule keeps `getDefaultSeverityMapping` the only place that decides what
   * Critical and Warning mean.
   */
  public static getMappingFromRankedIds(
    rankedIds: Array<ObjectID>,
  ): MonitorRecommendationSeverityMap {
    return this.getDefaultSeverityMapping(
      rankedIds.map((id: ObjectID, index: number) => {
        return { id: id, name: "", order: index + 1 };
      }),
    );
  }

  /*
   * The severity ids a template should BUILD its criteria with, given the
   * severity the template itself declares.
   *
   * This is the monitor-edit template picker's half of the job
   * `MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep` does
   * for the recommendations page. That page can rewrite the ids after the
   * fact because it owns the whole create; a picker hands its ids to
   * `getMonitorStep` up front and never sees the criteria instances again, so
   * it has to choose correctly the first time. Without this, every template a
   * picker applies was built with the project's FIRST severity — so "Task
   * Down" (Critical) and "High Task CPU Usage" (Warning) opened records at the
   * same level and the Critical/Warning badge on the picker card described
   * nothing that subsequently happened.
   *
   * Falls back to the caller's own default when the project list is empty,
   * because `getMonitorStep` requires a non-optional id in both slots.
   */
  public static resolveTemplateSeverityIds(data: {
    severity: MonitorRecommendationSeverity;
    rankedIncidentSeverityIds?: Array<ObjectID> | undefined;
    rankedAlertSeverityIds?: Array<ObjectID> | undefined;
    fallbackIncidentSeverityId: ObjectID;
    fallbackAlertSeverityId: ObjectID;
  }): MonitorRecommendationTemplateSeverityIds {
    const incidentSeverityId: ObjectID | undefined = this.resolveSeverityId({
      severity: data.severity,
      severityMap: this.getMappingFromRankedIds(
        data.rankedIncidentSeverityIds || [],
      ),
    });

    const alertSeverityId: ObjectID | undefined = this.resolveSeverityId({
      severity: data.severity,
      severityMap: this.getMappingFromRankedIds(
        data.rankedAlertSeverityIds || [],
      ),
    });

    return {
      incidentSeverityId: incidentSeverityId || data.fallbackIncidentSeverityId,
      alertSeverityId: alertSeverityId || data.fallbackAlertSeverityId,
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
