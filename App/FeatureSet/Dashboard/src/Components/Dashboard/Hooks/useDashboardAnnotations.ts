import { useEffect, useState } from "react";
import DashboardAnnotation, {
  DashboardAnnotationsConfig,
} from "Common/Types/Dashboard/DashboardAnnotation";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import DashboardAnnotationFetcher from "../Utils/AnnotationFetcher";

export interface UseAnnotationsInput {
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  config: DashboardAnnotationsConfig | undefined;
  refreshTick?: number | undefined;
}

const useDashboardAnnotations: (
  input: UseAnnotationsInput,
) => Array<DashboardAnnotation> = (
  input: UseAnnotationsInput,
): Array<DashboardAnnotation> => {
  const [annotations, setAnnotations] = useState<Array<DashboardAnnotation>>(
    [],
  );

  useEffect(() => {
    let cancelled: boolean = false;
    if (!input.config || !input.config.enabled) {
      setAnnotations([]);
      return;
    }
    DashboardAnnotationFetcher.fetch({
      dashboardStartAndEndDate: input.dashboardStartAndEndDate,
      config: input.config,
    })
      .then((result: Array<DashboardAnnotation>): void => {
        if (!cancelled) {
          setAnnotations(result);
        }
      })
      .catch((): void => {
        /*
         * Failure already swallowed inside the fetcher; if it re-throws
         * we just skip the overlay for this tick.
         */
        if (!cancelled) {
          setAnnotations([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    input.dashboardStartAndEndDate,
    input.refreshTick,
    input.config?.enabled,
    input.config?.incidents,
    input.config?.alerts,
    input.config?.scheduledMaintenance,
    input.config?.monitorStatusChanges,
  ]);

  return annotations;
};

export default useDashboardAnnotations;
