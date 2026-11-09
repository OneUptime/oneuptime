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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getAlertTemplateCategoryLabel } from "../Form/Monitor/AlertTemplatePicker/AlertTemplateCategories";

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
 * How many recommendations a section has left to set up before its heading
 * offers "Select all": a section of one has its card's own checkbox one line
 * below, and "Select all 1" ("Alle 1 auswählen") read as a slip.
 */
export const SELECT_ALL_MINIMUM: number = 2;

// The test id of a category's section, which every category has.
export const RECOMMENDATION_CATEGORY_TEST_ID_PREFIX: string =
  "recommendation-category-";

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
  const translator: Translator = useTranslator();

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

        const handledInGroup: number =
          group.recommendations.length - availableInGroup.length;

        const areAllSelected: boolean =
          availableInGroup.length > 0 &&
          availableInGroup.every((viewModel: RecommendationViewModel) => {
            return props.selectedRecommendationIds.has(
              viewModel.recommendation.recommendationId,
            );
          });

        // Several left to set up, and nothing being created meanwhile.
        const offersSelectAll: boolean =
          availableInGroup.length >= SELECT_ALL_MINIMUM && !props.isDisabled;

        /*
         * The heading the monitor form's template picker gives this
         * category ("Control Plane", not the catalog's "ControlPlane"), in
         * the reader's language; a category it names no heading for (a
         * host's, a service's) is looked up as it is, so a word the
         * product translates elsewhere ("Memory", "Errors") is not left in
         * English.
         */
        const categoryLabel: string | undefined = group.recommendations[0]
          ? getAlertTemplateCategoryLabel(
              group.recommendations[0].recommendation.resourceType,
              group.category,
            )
          : undefined;

        return (
          <div
            key={group.category}
            data-testid={`${RECOMMENDATION_CATEGORY_TEST_ID_PREFIX}${group.category}`}
          >
            {/*
             * The heading carries the category, then the two numbers that
             * decide whether it is worth reading: how much is left to do here,
             * and how much has already been handled. They used to run together
             * in one grey sentence a shade lighter than the cards' own body
             * text; the counts are chips now, so the heading row scans as a
             * heading rather than as more prose.
             */}
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-gray-100 pb-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <h4 className="truncate text-sm font-semibold text-gray-900">
                  {translator.translateText(categoryLabel || group.category) ||
                    group.category}
                </h4>
                {availableInGroup.length > 0 ? (
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200/80">
                    {translator.translateTemplate("{{count}} to set up", {
                      count: translator.formatNumber(availableInGroup.length),
                    })}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200/80">
                    {translator.translateText("All handled")}
                  </span>
                )}
                {handledInGroup > 0 && availableInGroup.length > 0 ? (
                  <span className="max-sm:hidden text-xs text-gray-400 sm:inline">
                    {translator.translateTemplate("{{count}} handled", {
                      count: translator.formatNumber(handledInGroup),
                    })}
                  </span>
                ) : (
                  <></>
                )}
              </div>

              {offersSelectAll ? (
                <button
                  type="button"
                  className="flex-shrink-0 rounded text-xs font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                  data-testid={`recommendation-group-select-all-${group.category}`}
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
                  {areAllSelected
                    ? translator.translateText("Clear all")
                    : translator.translateTemplate("Select all {{count}}", {
                        count: translator.formatNumber(availableInGroup.length),
                      })}
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
