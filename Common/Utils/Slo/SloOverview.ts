import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";

export enum SloOverviewStatusFilter {
  All = "all",
  Healthy = "healthy",
  AtRisk = "at-risk",
  BudgetExhausted = "budget-exhausted",
  NotEvaluating = "not-evaluating",
}

export interface SloOverviewCounts {
  total: number;
  healthy: number;
  atRisk: number;
  budgetExhausted: number;
  notEvaluating: number;
}

export interface SloOverviewFilters {
  search?: string | undefined;
  monitorId?: string | undefined;
  labelId?: string | undefined;
  status?: SloOverviewStatusFilter | undefined;
}

type RelatedModel = Monitor | Label;

function getRelatedModelId(item: RelatedModel): string {
  if (item.id) {
    return item.id.toString();
  }

  return typeof item._id === "string" ? item._id : "";
}

export function getSloOverviewStatusFilter(
  slo: ServiceLevelObjective,
): SloOverviewStatusFilter {
  if (slo.isEnabled === false) {
    return SloOverviewStatusFilter.NotEvaluating;
  }

  if (slo.sloStatus === SloStatus.Healthy) {
    return SloOverviewStatusFilter.Healthy;
  }

  if (slo.sloStatus === SloStatus.AtRisk) {
    return SloOverviewStatusFilter.AtRisk;
  }

  if (slo.sloStatus === SloStatus.BudgetExhausted) {
    return SloOverviewStatusFilter.BudgetExhausted;
  }

  return SloOverviewStatusFilter.NotEvaluating;
}

export function hasCurrentSloOverviewEvaluation(
  slo: ServiceLevelObjective,
): boolean {
  if (slo.isEnabled === false) {
    return false;
  }

  return (
    slo.sloStatus === SloStatus.Healthy ||
    slo.sloStatus === SloStatus.AtRisk ||
    slo.sloStatus === SloStatus.BudgetExhausted
  );
}

export function getSloOverviewCounts(
  slos: Array<ServiceLevelObjective>,
): SloOverviewCounts {
  const counts: SloOverviewCounts = {
    total: slos.length,
    healthy: 0,
    atRisk: 0,
    budgetExhausted: 0,
    notEvaluating: 0,
  };

  for (const slo of slos) {
    const status: SloOverviewStatusFilter = getSloOverviewStatusFilter(slo);

    if (status === SloOverviewStatusFilter.Healthy) {
      counts.healthy++;
    } else if (status === SloOverviewStatusFilter.AtRisk) {
      counts.atRisk++;
    } else if (status === SloOverviewStatusFilter.BudgetExhausted) {
      counts.budgetExhausted++;
    } else {
      counts.notEvaluating++;
    }
  }

  return counts;
}

export function filterSloOverviewItems(
  slos: Array<ServiceLevelObjective>,
  filters: SloOverviewFilters,
): Array<ServiceLevelObjective> {
  const search: string = (filters.search || "").trim().toLocaleLowerCase();

  return slos.filter((slo: ServiceLevelObjective): boolean => {
    if (
      filters.status &&
      filters.status !== SloOverviewStatusFilter.All &&
      getSloOverviewStatusFilter(slo) !== filters.status
    ) {
      return false;
    }

    if (
      filters.monitorId &&
      !(slo.monitors || []).some((monitor: Monitor): boolean => {
        return getRelatedModelId(monitor) === filters.monitorId;
      })
    ) {
      return false;
    }

    if (
      filters.labelId &&
      !(slo.labels || []).some((label: Label): boolean => {
        return getRelatedModelId(label) === filters.labelId;
      })
    ) {
      return false;
    }

    if (!search) {
      return true;
    }

    const searchableValues: Array<string> = [
      slo.name || "",
      ...(slo.monitors || []).map((monitor: Monitor): string => {
        return monitor.name || "";
      }),
      ...(slo.labels || []).map((label: Label): string => {
        return label.name || "";
      }),
    ];

    return searchableValues.some((value: string): boolean => {
      return value.toLocaleLowerCase().includes(search);
    });
  });
}

const STATUS_SORT_ORDER: Record<SloOverviewStatusFilter, number> = {
  [SloOverviewStatusFilter.BudgetExhausted]: 0,
  [SloOverviewStatusFilter.AtRisk]: 1,
  [SloOverviewStatusFilter.NotEvaluating]: 2,
  [SloOverviewStatusFilter.Healthy]: 3,
  [SloOverviewStatusFilter.All]: 4,
};

export function sortSloOverviewItems(
  slos: Array<ServiceLevelObjective>,
): Array<ServiceLevelObjective> {
  return [...slos].sort(
    (first: ServiceLevelObjective, second: ServiceLevelObjective): number => {
      const statusDifference: number =
        STATUS_SORT_ORDER[getSloOverviewStatusFilter(first)] -
        STATUS_SORT_ORDER[getSloOverviewStatusFilter(second)];

      if (statusDifference !== 0) {
        return statusDifference;
      }

      return (first.name || "").localeCompare(second.name || "");
    },
  );
}
