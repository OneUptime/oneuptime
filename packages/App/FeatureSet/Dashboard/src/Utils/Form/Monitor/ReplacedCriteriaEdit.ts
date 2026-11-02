import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";

/*
 * Whether an edit the criteria editor hands up was made to criteria the step
 * no longer holds.
 *
 * The editor's incident and alert lists hand their rows back up as they
 * mount, through the criteria they were drawn with. A new infrastructure
 * monitor's step form applies its default alert in that same pass, so the
 * step's criteria were already the alert's when the echo of the default
 * criteria arrived, and it put them back: the picker showed Stopped
 * Reporting picked while the criteria said "is offline".
 *
 * An edit of the criteria on screen always shares at least one criteria id
 * with what the step holds - even one that adds or removes a criteria. One
 * that shares none was made to criteria something else replaced since, and
 * is dropped. Criteria without ids are never judged.
 */
type CriteriaIdsFunction = (
  criteria: MonitorCriteria | undefined,
) => Array<string>;

const criteriaIds: CriteriaIdsFunction = (
  criteria: MonitorCriteria | undefined,
): Array<string> => {
  return (criteria?.data?.monitorCriteriaInstanceArray || [])
    .map((instance: MonitorCriteriaInstance): string => {
      return instance.data?.id || "";
    })
    .filter((id: string): boolean => {
      return Boolean(id);
    });
};

export default class ReplacedCriteriaEdit {
  public static isEditOfReplacedCriteria(data: {
    current: MonitorCriteria | undefined;
    edited: MonitorCriteria;
  }): boolean {
    const currentIds: Array<string> = criteriaIds(data.current);
    const editedIds: Array<string> = criteriaIds(data.edited);

    if (currentIds.length === 0 || editedIds.length === 0) {
      return false;
    }

    return !editedIds.some((id: string): boolean => {
      return currentIds.includes(id);
    });
  }
}
