import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "Common/Types/ObjectID";

/**
 * Duplicating a criteria.
 *
 * Criteria are the most expensive thing on the monitor form to fill in -
 * a name, a description, a list of filters, and up to three action
 * sub-forms each with severities, on-call policies, owners and
 * templates. "Warn at 80%, page at 95%" was two of those from scratch.
 *
 * Every id in the copy has to be fresh. Alerts and incidents are deduped
 * server-side on (criteria id, alert id), so a copy that kept the
 * original's ids would be treated as the same alert and the second
 * threshold would silently never fire.
 */
export default class MonitorCriteriaDuplicateUtil {
  /** Suffix appended to the copied criteria's name. */
  public static readonly COPY_SUFFIX: string = " (Copy)";

  public static duplicate(
    criteriaInstance: MonitorCriteriaInstance,
  ): MonitorCriteriaInstance {
    const copy: MonitorCriteriaInstance =
      MonitorCriteriaInstance.clone(criteriaInstance);

    if (!copy.data) {
      return copy;
    }

    copy.data.id = ObjectID.generate().toString();

    copy.data.name = `${criteriaInstance.data?.name || ""}${
      MonitorCriteriaDuplicateUtil.COPY_SUFFIX
    }`;

    copy.data.alerts = (copy.data.alerts || []).map(
      (alert: CriteriaAlert): CriteriaAlert => {
        return {
          ...alert,
          id: ObjectID.generate().toString(),
        };
      },
    );

    copy.data.incidents = (copy.data.incidents || []).map(
      (incident: CriteriaIncident): CriteriaIncident => {
        return {
          ...incident,
          id: ObjectID.generate().toString(),
        };
      },
    );

    return copy;
  }

  /**
   * The array with `criteriaInstance`'s copy inserted directly after it,
   * so the copy lands next to what it was copied from instead of at the
   * bottom of a list the user then has to drag it up through.
   */
  public static insertDuplicateAfter(data: {
    criteriaInstances: Array<MonitorCriteriaInstance>;
    criteriaId: string | undefined;
  }): {
    criteriaInstances: Array<MonitorCriteriaInstance>;
    duplicate: MonitorCriteriaInstance | undefined;
  } {
    const index: number = data.criteriaInstances.findIndex(
      (instance: MonitorCriteriaInstance) => {
        return instance.data?.id === data.criteriaId;
      },
    );

    const original: MonitorCriteriaInstance | undefined =
      index >= 0 ? data.criteriaInstances[index] : undefined;

    if (!original) {
      return {
        criteriaInstances: data.criteriaInstances,
        duplicate: undefined,
      };
    }

    const duplicate: MonitorCriteriaInstance =
      MonitorCriteriaDuplicateUtil.duplicate(original);

    const next: Array<MonitorCriteriaInstance> = [...data.criteriaInstances];
    next.splice(index + 1, 0, duplicate);

    return {
      criteriaInstances: next,
      duplicate: duplicate,
    };
  }
}
