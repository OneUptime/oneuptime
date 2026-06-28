import { JSONObject, JSONValue } from "../../../Types/JSON";
import { NoDataPolicy } from "../../../Types/Monitor/CriteriaFilter";

/*
 * No-data policies whose outcome DEPENDS on whether data arrived. Trigger fires
 * on absence; Treat-As-Zero evaluates a missing window as 0, which can itself
 * breach a threshold (e.g. `value < 1`). Ignore (and the evaluator's default
 * for an unset policy — see MetricMonitorCriteria, `... || NoDataPolicy.Ignore`)
 * cannot change the outcome when data is missing.
 */
const ABSENCE_SENSITIVE_POLICIES: ReadonlyArray<string> = [
  NoDataPolicy.Trigger,
  NoDataPolicy.TreatAsZero,
];

const walk: (value: JSONValue | undefined) => boolean = (
  value: JSONValue | undefined,
): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (walk(item as JSONValue)) {
        return true;
      }
    }
    return false;
  }

  const obj: JSONObject = value as JSONObject;
  const policy: JSONValue | undefined = obj["onNoDataPolicy"];
  if (
    typeof policy === "string" &&
    ABSENCE_SENSITIVE_POLICIES.includes(policy)
  ) {
    return true;
  }

  for (const key of Object.keys(obj)) {
    if (walk(obj[key] as JSONValue)) {
      return true;
    }
  }
  return false;
};

/**
 * True if any criterion on this monitor step could change its alert outcome
 * when a metric stops arriving — i.e. carries an `onNoDataPolicy` of Trigger or
 * Treat-As-Zero. Unset / Ignore policies cannot, so they return false.
 *
 * Used by the Phase 4 scheduler skip so it NEVER skips a monitor whose outcome
 * depends on absence. The walk is deliberately structure-agnostic (it scans the
 * whole serialized step) so it stays correct if the criteria nesting changes —
 * a present Trigger/TreatAsZero is always found, which keeps the skip on the
 * safe side.
 */
export default function monitorStepCanAlertOnAbsence(
  monitorStepData: JSONValue | undefined,
): boolean {
  return walk(monitorStepData);
}
