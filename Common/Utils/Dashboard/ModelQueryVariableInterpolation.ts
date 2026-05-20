import Includes from "../../Types/BaseDatabase/Includes";
import DashboardVariable, {
  DashboardVariableType,
} from "../../Types/Dashboard/DashboardVariable";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "./VariableInterpolation";

/*
 * Maps a dashboard variable's OpenTelemetry attribute key (e.g.
 * "host.name", "k8s.namespace.name") to the Postgres model column
 * that should be filtered for a given list widget. Each list widget
 * declares the subset of attribute keys it understands.
 */
export type AttributeToColumnMap = Record<string, string>;

/*
 * Applies dashboard variables to a Postgres model query at render time.
 *
 * Companion to `DashboardVariableInterpolation`, which targets OTel
 * attribute filters used by metric/log widgets. Resource list widgets
 * (Host, Kubernetes resources, Docker resources) query the model store
 * by column instead, so this helper translates the variable's bound
 * OTel attribute key into the matching column name before writing the
 * predicate. An empty/unset selection removes any prior filter on that
 * column so the list falls back to its widget-default view.
 */
export default class DashboardModelQueryInterpolation {
  public static applyToQuery(
    query: Record<string, unknown>,
    variables: Array<DashboardVariable> | undefined,
    attributeToColumn: AttributeToColumnMap,
  ): Record<string, unknown> {
    if (!variables || variables.length === 0) {
      return query;
    }

    const mappedAttributeKeys: Array<string> = Object.keys(attributeToColumn);
    if (mappedAttributeKeys.length === 0) {
      return query;
    }

    const relevantVariables: Array<DashboardVariable> = variables.filter(
      (v: DashboardVariable) => {
        return (
          v.type === DashboardVariableType.TelemetryAttribute &&
          Boolean(v.attributeKey) &&
          mappedAttributeKeys.includes(v.attributeKey as string)
        );
      },
    );

    if (relevantVariables.length === 0) {
      return query;
    }

    let next: Record<string, unknown> = query;
    let changed: boolean = false;

    for (const variable of relevantVariables) {
      const column: string = attributeToColumn[
        variable.attributeKey as string
      ] as string;
      const resolved: ResolvedVariableValue | undefined =
        DashboardVariableInterpolation.resolveValue(variable);

      if (!resolved) {
        if (column in next) {
          if (!changed) {
            next = { ...query };
            changed = true;
          }
          delete next[column];
        }
        continue;
      }

      if (resolved.multi && resolved.multi.length > 0) {
        if (!changed) {
          next = { ...query };
          changed = true;
        }
        next[column] = new Includes(resolved.multi);
        continue;
      }

      if (resolved.scalar !== undefined && next[column] !== resolved.scalar) {
        if (!changed) {
          next = { ...query };
          changed = true;
        }
        next[column] = resolved.scalar;
      }
    }

    return changed ? next : query;
  }
}
