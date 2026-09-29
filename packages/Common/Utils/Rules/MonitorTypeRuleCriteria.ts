import MonitorType from "../../Types/Monitor/MonitorType";
import {
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../Types/Rules/RuleCriteria";

const MONITOR_TYPES: ReadonlySet<string> = new Set(Object.values(MonitorType));

export function isMonitorTypeCriteriaValue(
  value: unknown,
): value is MonitorType {
  return typeof value === "string" && MONITOR_TYPES.has(value);
}

/** Monitor types are enum choices, so text and relation operators do not apply. */
export function getMonitorTypeCriteriaValidationError(
  filter: RuleCriteriaFilter,
): string | null {
  if (
    filter.operator !== RuleCriteriaOperator.Equals &&
    filter.operator !== RuleCriteriaOperator.NotEquals
  ) {
    return "Monitor type criteria only support Equals and Does not equal operators.";
  }

  if (!isMonitorTypeCriteriaValue(filter.value)) {
    return "Monitor type criteria require a valid monitor type.";
  }

  return null;
}
