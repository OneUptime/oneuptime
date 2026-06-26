import Includes from "../../Types/BaseDatabase/Includes";
import DashboardVariable, {
  DashboardVariableType,
} from "../../Types/Dashboard/DashboardVariable";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";

export interface ResolvedVariableValue {
  /*
   * Single-value selection. Becomes a `attributes[key] = '...'` predicate
   * server-side.
   */
  scalar?: string | undefined;
  /*
   * Multi-value selection. Becomes a `attributes[key] IN (...)` predicate.
   * Always non-empty when present; an empty multi-select is treated as
   * "All" and produces neither field.
   */
  multi?: Array<string> | undefined;
}

/*
 * Applies dashboard variables to a metric query at render time.
 *
 * For each TelemetryAttribute variable with a selected value, the
 * variable's bound attribute key is injected into the query's attribute
 * filter. An empty/unset selection means "All" — no filter is applied,
 * and any previously-set filter on that key is removed so the widget
 * shows the cross-cluster view by default.
 *
 * Multi-select variables emit an `Includes` operator on the same map
 * key so the server's WHERE-builder produces `attributes[key] IN (...)`.
 */
export default class DashboardVariableInterpolation {
  public static resolveValue(
    variable: DashboardVariable,
  ): ResolvedVariableValue | undefined {
    if (variable.isMultiSelect) {
      const values: Array<string> = (variable.selectedValues || []).filter(
        (v: string) => {
          return Boolean(v);
        },
      );
      if (values.length > 0) {
        return { multi: values };
      }
      // No multi-select picks. Fall through to default value handling.
    }

    const v: string | undefined =
      variable.selectedValue ?? variable.defaultValue ?? undefined;
    if (v === undefined || v === null || v === "") {
      return undefined;
    }
    return { scalar: v };
  }

  /*
   * Generic helper: take a plain attributes map and return a new map
   * with all TelemetryAttribute variables applied. Used by every widget
   * type whose filter is shaped like `{ [attrKey]: value | operator }`
   * (metric charts, log streams). Returns the original reference when
   * nothing changes so React.memo can short-circuit.
   */
  public static applyToAttributes(
    attributes: Record<string, unknown> | undefined,
    variables: Array<DashboardVariable> | undefined,
  ): Record<string, unknown> {
    const source: Record<string, unknown> = attributes || {};
    if (!variables || variables.length === 0) {
      return source;
    }

    const telemetryAttributeVariables: Array<DashboardVariable> =
      variables.filter((v: DashboardVariable) => {
        return (
          v.type === DashboardVariableType.TelemetryAttribute &&
          Boolean(v.attributeKey)
        );
      });

    if (telemetryAttributeVariables.length === 0) {
      return source;
    }

    const next: Record<string, unknown> = { ...source };
    let changed: boolean = false;

    for (const variable of telemetryAttributeVariables) {
      const key: string = variable.attributeKey as string;
      const resolved: ResolvedVariableValue | undefined =
        DashboardVariableInterpolation.resolveValue(variable);

      if (!resolved) {
        if (key in next) {
          delete next[key];
          changed = true;
        }
        continue;
      }

      if (resolved.multi && resolved.multi.length > 0) {
        next[key] = new Includes(resolved.multi);
        changed = true;
        continue;
      }

      if (resolved.scalar !== undefined && next[key] !== resolved.scalar) {
        next[key] = resolved.scalar;
        changed = true;
      }
    }

    return changed ? next : source;
  }

  public static applyToQueryConfig(
    queryConfig: MetricQueryConfigData,
    variables: Array<DashboardVariable> | undefined,
  ): MetricQueryConfigData {
    if (!variables || variables.length === 0) {
      return queryConfig;
    }

    const filterData: typeof queryConfig.metricQueryData.filterData =
      queryConfig.metricQueryData?.filterData;

    if (!filterData) {
      return queryConfig;
    }

    const originalAttributes: Record<string, unknown> =
      (filterData.attributes as Record<string, unknown> | undefined) || {};
    const nextAttributes: Record<string, unknown> =
      DashboardVariableInterpolation.applyToAttributes(
        originalAttributes,
        variables,
      );

    if (nextAttributes === originalAttributes) {
      return queryConfig;
    }

    return {
      ...queryConfig,
      metricQueryData: {
        ...queryConfig.metricQueryData,
        filterData: {
          ...filterData,
          attributes: nextAttributes,
        } as typeof queryConfig.metricQueryData.filterData,
      },
    };
  }

  public static applyToQueryConfigs(
    queryConfigs: Array<MetricQueryConfigData>,
    variables: Array<DashboardVariable> | undefined,
  ): Array<MetricQueryConfigData> {
    if (!variables || variables.length === 0) {
      return queryConfigs;
    }
    return queryConfigs.map((config: MetricQueryConfigData) => {
      return DashboardVariableInterpolation.applyToQueryConfig(
        config,
        variables,
      );
    });
  }
}
