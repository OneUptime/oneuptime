import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import RecommendationCard from "./RecommendationCard";
import RecommendationFilterUtil from "./RecommendationFilterUtil";
import {
  RecommendationCategoryGroup,
  RecommendationStatus,
  RecommendationViewModel,
} from "./RecommendationViewModel";

export interface ComponentProps {
  groups: Array<RecommendationCategoryGroup>;
  selectedRecommendationIds: Set<string>;
  onSelectionChange: (selectedRecommendationIds: Set<string>) => void;
  onDismiss: (viewModel: RecommendationViewModel) => void;
  onRestore: (viewModel: RecommendationViewModel) => void;
  getMonitorRoute: (monitorId: ObjectID) => Route;
  isDisabled?: boolean | undefined;
}

/*
 * Category sections of recommendation cards.
 *
 * Categories come from the catalog in declaration order — the template modules
 * put their most important category first — so this renders them in the order
 * given rather than sorting. Empty groups never reach here; the filter util
 * drops them so a narrow search shows two headings instead of five with
 * nothing under them.
 */
const RecommendationsList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type ToggleOneFunction = (
    recommendationId: string,
    isChecked: boolean,
  ) => void;

  const toggleOne: ToggleOneFunction = (
    recommendationId: string,
    isChecked: boolean,
  ): void => {
    const selected: Set<string> = new Set<string>(
      props.selectedRecommendationIds,
    );

    if (isChecked) {
      selected.add(recommendationId);
    } else {
      selected.delete(recommendationId);
    }

    props.onSelectionChange(selected);
  };

  return (
    <div className="space-y-8">
      {props.groups.map((group: RecommendationCategoryGroup) => {
        const availableInGroup: Array<RecommendationViewModel> =
          group.recommendations.filter((viewModel: RecommendationViewModel) => {
            return viewModel.status === RecommendationStatus.Available;
          });

        const areAllSelected: boolean =
          availableInGroup.length > 0 &&
          availableInGroup.every((viewModel: RecommendationViewModel) => {
            return props.selectedRecommendationIds.has(
              viewModel.recommendation.recommendationId,
            );
          });

        return (
          <div key={group.category}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <h4 className="text-sm font-semibold text-gray-700">
                  {group.category}
                </h4>
                <span className="text-xs text-gray-400">
                  {availableInGroup.length > 0
                    ? `${availableInGroup.length} to set up`
                    : "nothing to set up"}
                  {group.recommendations.length !== availableInGroup.length
                    ? ` · ${
                        group.recommendations.length - availableInGroup.length
                      } handled`
                    : ""}
                </span>
              </div>

              {availableInGroup.length > 0 && !props.isDisabled ? (
                <button
                  type="button"
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  onClick={() => {
                    props.onSelectionChange(
                      RecommendationFilterUtil.toggleSelectionForGroup({
                        selectedRecommendationIds:
                          props.selectedRecommendationIds,
                        groupViewModels: group.recommendations,
                      }),
                    );
                  }}
                >
                  {areAllSelected ? "Clear all" : "Select all"}
                </button>
              ) : (
                <></>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {group.recommendations.map(
                (viewModel: RecommendationViewModel) => {
                  return (
                    <RecommendationCard
                      key={viewModel.recommendation.recommendationId}
                      viewModel={viewModel}
                      isSelected={props.selectedRecommendationIds.has(
                        viewModel.recommendation.recommendationId,
                      )}
                      isDisabled={props.isDisabled}
                      monitorRoute={
                        viewModel.monitorId
                          ? props.getMonitorRoute(viewModel.monitorId)
                          : undefined
                      }
                      onSelectChange={(isSelected: boolean) => {
                        toggleOne(
                          viewModel.recommendation.recommendationId,
                          isSelected,
                        );
                      }}
                      onDismiss={() => {
                        props.onDismiss(viewModel);
                      }}
                      onRestore={() => {
                        props.onRestore(viewModel);
                      }}
                    />
                  );
                },
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default RecommendationsList;
