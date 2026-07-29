import React, { FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Checkbox from "Common/UI/Components/Checkbox/Checkbox";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import { MonitorRecommendation } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

export interface ComponentProps {
  recommendations: Array<MonitorRecommendation>;
  categories: Array<string>;
  coveredRecommendationIds: Set<string>;
  selectedRecommendationIds: Set<string>;
  onSelectionChange: (selectedRecommendationIds: Set<string>) => void;
  isDisabled?: boolean | undefined;
}

const MonitorRecommendationsList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type ToggleFunction = (recommendationId: string, isChecked: boolean) => void;

  const toggleRecommendation: ToggleFunction = (
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

  type ToggleCategoryFunction = (category: string) => void;

  const toggleCategory: ToggleCategoryFunction = (category: string): void => {
    const inCategory: Array<MonitorRecommendation> =
      props.recommendations.filter((recommendation: MonitorRecommendation) => {
        return (
          recommendation.category === category &&
          !props.coveredRecommendationIds.has(recommendation.recommendationId)
        );
      });

    const areAllSelected: boolean =
      inCategory.length > 0 &&
      inCategory.every((recommendation: MonitorRecommendation) => {
        return props.selectedRecommendationIds.has(
          recommendation.recommendationId,
        );
      });

    const selected: Set<string> = new Set<string>(
      props.selectedRecommendationIds,
    );

    for (const recommendation of inCategory) {
      if (areAllSelected) {
        selected.delete(recommendation.recommendationId);
      } else {
        selected.add(recommendation.recommendationId);
      }
    }

    props.onSelectionChange(selected);
  };

  return (
    <div className="space-y-6">
      {props.categories.map((category: string) => {
        const inCategory: Array<MonitorRecommendation> =
          props.recommendations.filter(
            (recommendation: MonitorRecommendation) => {
              return recommendation.category === category;
            },
          );

        if (inCategory.length === 0) {
          return null;
        }

        const selectableCount: number = inCategory.filter(
          (recommendation: MonitorRecommendation) => {
            return !props.coveredRecommendationIds.has(
              recommendation.recommendationId,
            );
          },
        ).length;

        const createdCount: number = inCategory.length - selectableCount;

        return (
          <div key={category}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center">
                <h4 className="text-sm font-semibold text-gray-700">
                  {category}
                </h4>
                <span className="ml-2 text-xs text-gray-400">
                  {createdCount > 0
                    ? `${selectableCount} available, ${createdCount} already created`
                    : `${selectableCount} available`}
                </span>
              </div>
              {selectableCount > 0 && !props.isDisabled ? (
                <button
                  type="button"
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
                  onClick={() => {
                    toggleCategory(category);
                  }}
                >
                  Select all
                </button>
              ) : (
                <></>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {inCategory.map((recommendation: MonitorRecommendation) => {
                const isCovered: boolean = props.coveredRecommendationIds.has(
                  recommendation.recommendationId,
                );
                const isSelected: boolean = props.selectedRecommendationIds.has(
                  recommendation.recommendationId,
                );

                return (
                  <div
                    key={recommendation.recommendationId}
                    className={`rounded-lg border p-4 transition-all ${
                      isCovered
                        ? "border-gray-200 bg-gray-50 opacity-70"
                        : isSelected
                          ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                          : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-start">
                      <div className="flex-shrink-0 pt-0.5">
                        {isCovered ? (
                          <Icon
                            icon={IconProp.CheckCircle}
                            className="h-5 w-5 text-green-500"
                          />
                        ) : (
                          <Checkbox
                            value={isSelected}
                            disabled={props.isDisabled}
                            onChange={(value: boolean) => {
                              toggleRecommendation(
                                recommendation.recommendationId,
                                value,
                              );
                            }}
                          />
                        )}
                      </div>

                      <div className="ml-3 flex-1">
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="text-sm font-medium text-gray-900">
                            {recommendation.name}
                          </span>
                          <StatusBadge
                            text={recommendation.severity}
                            type={
                              recommendation.severity === "Critical"
                                ? StatusBadgeType.Danger
                                : StatusBadgeType.Warning
                            }
                          />
                          {isCovered ? (
                            <StatusBadge
                              text="Already created"
                              type={StatusBadgeType.Success}
                            />
                          ) : (
                            <></>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {recommendation.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default MonitorRecommendationsList;
