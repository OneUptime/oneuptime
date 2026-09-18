import ObjectID from "Common/Types/ObjectID";
import { MonitorRecommendation } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import {
  RecommendationCategoryGroup,
  RecommendationCounts,
  RecommendationFilterState,
  RecommendationSeverityFilter,
  RecommendationStatus,
  RecommendationStatusFilter,
  RecommendationViewModel,
} from "./RecommendationViewModel";

/*
 * Everything the recommendations page does to a list before rendering it.
 *
 * Split out of the component on purpose. The App test suite runs in a plain
 * Node environment with no renderer, so anything left inside a `.tsx` is
 * effectively untestable — and the parts worth testing here are exactly the
 * parts that are invisible when they break. A search that quietly matches
 * nothing, a status filter that shows dismissed cards as available, a count
 * badge that disagrees with the list under it: all of those render perfectly.
 */
export default class RecommendationFilterUtil {
  /*
   * Join the stateless catalog against project state.
   *
   * `coveredMonitorIds` and `dismissals` are both keyed on recommendationId.
   * A recommendation present in both is `Created` — see the note on
   * `RecommendationStatus`.
   */
  public static buildViewModels(data: {
    recommendations: Array<MonitorRecommendation>;
    coveredMonitorIds: Map<string, ObjectID>;
    dismissals: Array<RecommendationDismissal>;
  }): Array<RecommendationViewModel> {
    const dismissalByRecommendationId: Map<string, RecommendationDismissal> =
      new Map<string, RecommendationDismissal>();

    for (const dismissal of data.dismissals) {
      if (!dismissal.recommendationId) {
        continue;
      }

      /*
       * First write wins. Duplicates should not exist (the model's
       * `@UniqueColumnBy` prevents them), but a duplicate here would otherwise
       * make which row the Restore button deletes depend on list order — and
       * deleting only one of two rows leaves the card still dismissed with no
       * visible reason.
       */
      if (!dismissalByRecommendationId.has(dismissal.recommendationId)) {
        dismissalByRecommendationId.set(dismissal.recommendationId, dismissal);
      }
    }

    return data.recommendations.map((recommendation: MonitorRecommendation) => {
      const monitorId: ObjectID | undefined = data.coveredMonitorIds.get(
        recommendation.recommendationId,
      );

      if (monitorId) {
        return {
          recommendation: recommendation,
          status: RecommendationStatus.Created,
          monitorId: monitorId,
        };
      }

      const dismissal: RecommendationDismissal | undefined =
        dismissalByRecommendationId.get(recommendation.recommendationId);

      if (dismissal) {
        return {
          recommendation: recommendation,
          status: RecommendationStatus.Dismissed,
          dismissalId: dismissal.id || undefined,
          dismissalReason: dismissal.dismissalReason || undefined,
        };
      }

      return {
        recommendation: recommendation,
        status: RecommendationStatus.Available,
      };
    });
  }

  /*
   * Counts for the summary tiles and the side-menu badge.
   *
   * Computed from the UNFILTERED list on purpose: the tiles are what the user
   * clicks to change the filter, so deriving them from the filtered list would
   * make every tile except the active one read zero.
   */
  public static getCounts(
    viewModels: Array<RecommendationViewModel>,
  ): RecommendationCounts {
    const counts: RecommendationCounts = {
      total: viewModels.length,
      available: 0,
      created: 0,
      dismissed: 0,
      availableCritical: 0,
      availableWarning: 0,
    };

    for (const viewModel of viewModels) {
      if (viewModel.status === RecommendationStatus.Created) {
        counts.created = counts.created + 1;
        continue;
      }

      if (viewModel.status === RecommendationStatus.Dismissed) {
        counts.dismissed = counts.dismissed + 1;
        continue;
      }

      counts.available = counts.available + 1;

      if (viewModel.recommendation.severity === "Critical") {
        counts.availableCritical = counts.availableCritical + 1;
      } else {
        counts.availableWarning = counts.availableWarning + 1;
      }
    }

    return counts;
  }

  /*
   * The one number that belongs on the side menu.
   *
   * Explicitly NOT the catalog size: a badge that reads "18" on a cluster
   * where every recommendation is already created is a permanent nag, and a
   * badge nobody can ever clear is a badge everybody learns to ignore.
   * Dismissed recommendations are excluded for the same reason — dismissing is
   * how you clear it.
   */
  public static getActionableCount(
    viewModels: Array<RecommendationViewModel>,
  ): number {
    return this.getCounts(viewModels).available;
  }

  /*
   * Case-insensitive substring match across the fields a user would search by.
   *
   * Descriptions are included because several are the only place a metric name
   * appears ("k8s.hpa.current_replicas"), and searching for the metric you are
   * worried about is a natural way to find the recommendation that watches it.
   */
  public static matchesSearch(data: {
    viewModel: RecommendationViewModel;
    searchText: string;
  }): boolean {
    const searchText: string = data.searchText.trim().toLowerCase();

    if (!searchText) {
      return true;
    }

    const recommendation: MonitorRecommendation = data.viewModel.recommendation;

    const haystack: Array<string> = [
      recommendation.name,
      recommendation.description,
      recommendation.category,
      recommendation.severity,
    ];

    return haystack.some((field: string) => {
      return (field || "").toLowerCase().includes(searchText);
    });
  }

  public static matchesStatus(data: {
    viewModel: RecommendationViewModel;
    status: RecommendationStatusFilter;
  }): boolean {
    if (data.status === RecommendationStatusFilter.All) {
      return true;
    }

    return data.viewModel.status.toString() === data.status.toString();
  }

  public static matchesSeverity(data: {
    viewModel: RecommendationViewModel;
    severity: RecommendationSeverityFilter;
  }): boolean {
    if (data.severity === RecommendationSeverityFilter.All) {
      return true;
    }

    return (
      data.viewModel.recommendation.severity.toString() ===
      data.severity.toString()
    );
  }

  public static filter(data: {
    viewModels: Array<RecommendationViewModel>;
    filterState: RecommendationFilterState;
  }): Array<RecommendationViewModel> {
    return data.viewModels.filter((viewModel: RecommendationViewModel) => {
      return (
        this.matchesSearch({
          viewModel: viewModel,
          searchText: data.filterState.searchText,
        }) &&
        this.matchesStatus({
          viewModel: viewModel,
          status: data.filterState.status,
        }) &&
        this.matchesSeverity({
          viewModel: viewModel,
          severity: data.filterState.severity,
        })
      );
    });
  }

  /*
   * Group into category sections, preserving the catalog's own category order.
   *
   * `categories` comes from `MonitorRecommendationCatalog.getCategories`, which
   * returns them in first-declaration order — the template modules put their
   * most important categories first, and re-sorting alphabetically would bury
   * "Workload" under "ControlPlane".
   *
   * Categories that filter down to nothing are dropped rather than rendered
   * empty, so a search for "memory" shows two sections instead of five
   * headings with nothing under them.
   */
  public static groupByCategory(data: {
    viewModels: Array<RecommendationViewModel>;
    categories: Array<string>;
  }): Array<RecommendationCategoryGroup> {
    const groups: Array<RecommendationCategoryGroup> = [];

    for (const category of data.categories) {
      const inCategory: Array<RecommendationViewModel> = data.viewModels.filter(
        (viewModel: RecommendationViewModel) => {
          return viewModel.recommendation.category === category;
        },
      );

      if (inCategory.length === 0) {
        continue;
      }

      groups.push({
        category: category,
        recommendations: this.sortForDisplay(inCategory),
      });
    }

    /*
     * A recommendation whose category is not in `categories` would otherwise
     * vanish silently. That can only happen if the catalog and the category
     * list were derived from different resource types, which is a wiring bug —
     * but losing cards is a worse symptom than an "Other" heading.
     */
    const grouped: Set<string> = new Set<string>(data.categories);

    const ungrouped: Array<RecommendationViewModel> = data.viewModels.filter(
      (viewModel: RecommendationViewModel) => {
        return !grouped.has(viewModel.recommendation.category);
      },
    );

    if (ungrouped.length > 0) {
      groups.push({
        category: "Other",
        recommendations: this.sortForDisplay(ungrouped),
      });
    }

    return groups;
  }

  /*
   * Actionable first, then loudest first, then the catalog's declaration order.
   *
   * The declaration-order tiebreak is what keeps the list stable across
   * renders: without it two Critical recommendations could swap places every
   * time React re-rendered, because `Array.prototype.sort` is only stable with
   * respect to the input array, and the input array here is a fresh `filter`
   * result each time.
   */
  public static sortForDisplay(
    viewModels: Array<RecommendationViewModel>,
  ): Array<RecommendationViewModel> {
    const statusRank: Record<string, number> = {
      [RecommendationStatus.Available]: 0,
      [RecommendationStatus.Created]: 1,
      [RecommendationStatus.Dismissed]: 2,
    };

    const indexOf: Map<string, number> = new Map<string, number>();

    viewModels.forEach((viewModel: RecommendationViewModel, index: number) => {
      indexOf.set(viewModel.recommendation.recommendationId, index);
    });

    return [...viewModels].sort(
      (a: RecommendationViewModel, b: RecommendationViewModel) => {
        const aStatus: number = statusRank[a.status] ?? 0;
        const bStatus: number = statusRank[b.status] ?? 0;

        if (aStatus !== bStatus) {
          return aStatus - bStatus;
        }

        if (a.recommendation.severity !== b.recommendation.severity) {
          return a.recommendation.severity === "Critical" ? -1 : 1;
        }

        return (
          (indexOf.get(a.recommendation.recommendationId) ?? 0) -
          (indexOf.get(b.recommendation.recommendationId) ?? 0)
        );
      },
    );
  }

  /*
   * Which of the user's selections can actually be created right now.
   *
   * Selection lives in React state and survives a background reload, so by the
   * time Create is pressed a selected recommendation may have been created in
   * another tab or dismissed by a teammate. Both are filtered out rather than
   * rejected: re-POSTing a created one silently produces a duplicate monitor,
   * and creating a dismissed one contradicts the dismissal the user can see on
   * screen.
   */
  public static getSelectableViewModels(data: {
    viewModels: Array<RecommendationViewModel>;
    selectedRecommendationIds: Set<string>;
  }): Array<RecommendationViewModel> {
    return data.viewModels.filter((viewModel: RecommendationViewModel) => {
      return (
        viewModel.status === RecommendationStatus.Available &&
        data.selectedRecommendationIds.has(
          viewModel.recommendation.recommendationId,
        )
      );
    });
  }

  /*
   * Selection state after toggling every available recommendation in a
   * subset — the "Select all" affordance on a category header.
   *
   * Selecting all when some are already selected selects the rest, rather than
   * clearing them. Only an all-selected subset toggles off. This is what makes
   * clicking "Select all" on two different categories additive.
   */
  public static toggleSelectionForGroup(data: {
    selectedRecommendationIds: Set<string>;
    groupViewModels: Array<RecommendationViewModel>;
  }): Set<string> {
    const selectable: Array<RecommendationViewModel> =
      data.groupViewModels.filter((viewModel: RecommendationViewModel) => {
        return viewModel.status === RecommendationStatus.Available;
      });

    const areAllSelected: boolean =
      selectable.length > 0 &&
      selectable.every((viewModel: RecommendationViewModel) => {
        return data.selectedRecommendationIds.has(
          viewModel.recommendation.recommendationId,
        );
      });

    const selected: Set<string> = new Set<string>(
      data.selectedRecommendationIds,
    );

    for (const viewModel of selectable) {
      if (areAllSelected) {
        selected.delete(viewModel.recommendation.recommendationId);
      } else {
        selected.add(viewModel.recommendation.recommendationId);
      }
    }

    return selected;
  }
}
