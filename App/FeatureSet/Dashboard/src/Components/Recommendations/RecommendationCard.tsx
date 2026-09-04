import React, { FunctionComponent, ReactElement, useState } from "react";
import Checkbox from "Common/UI/Components/Checkbox/Checkbox";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import Route from "Common/Types/API/Route";
import UILink from "Common/UI/Components/Link/Link";
import {
  RecommendationStatus,
  RecommendationViewModel,
} from "./RecommendationViewModel";

export interface ComponentProps {
  viewModel: RecommendationViewModel;
  isSelected: boolean;
  isDisabled?: boolean | undefined;
  // Where "View monitor" points when this recommendation is already created.
  monitorRoute?: Route | undefined;
  onSelectChange: (isSelected: boolean) => void;
  onDismiss: () => void;
  onRestore: () => void;
}

/*
 * Descriptions longer than this get clamped to three lines with a Show more.
 *
 * A length test rather than measuring the rendered box: measuring means a
 * layout effect and a ResizeObserver per card on a page that renders up to
 * seventy-six of them, and it makes the control appear and disappear as the
 * grid reflows. The catalogue's descriptions are either one sentence or four
 * — there is nothing near the boundary — so the cheap test is also the
 * accurate one. Cards in a row share a height, so before this the single
 * longest description in a category set the height of every card beside it:
 * one four-line explanation of CFS quota accounting left a hand's width of
 * white space next to "Alert when Kubernetes jobs fail."
 */
export const DESCRIPTION_CLAMP_CHARACTER_COUNT: number = 170;

/*
 * One recommendation, in whichever of its three states it is in.
 *
 * The three states share a card rather than getting three components because
 * they are the same object at different points in its life, and a user
 * scanning the list needs to be able to tell them apart at a glance without
 * re-reading the layout each time. So: same geometry, same title position,
 * different left-hand affordance (checkbox / tick / crossed-out eye) and a
 * different accent.
 */
const RecommendationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const status: RecommendationStatus = props.viewModel.status;
  const isAvailable: boolean = status === RecommendationStatus.Available;
  const isCreated: boolean = status === RecommendationStatus.Created;
  const isDismissed: boolean = status === RecommendationStatus.Dismissed;
  const isCritical: boolean =
    props.viewModel.recommendation.severity === "Critical";

  const [isDescriptionExpanded, setIsDescriptionExpanded] =
    useState<boolean>(false);

  const description: string = props.viewModel.recommendation.description || "";

  const isDescriptionClampable: boolean =
    description.length > DESCRIPTION_CLAMP_CHARACTER_COUNT;

  const isSelectable: boolean = isAvailable && !props.isDisabled;

  type GetContainerClassFunction = () => string;

  const getContainerClass: GetContainerClassFunction = (): string => {
    if (isCreated) {
      return "border-gray-200 bg-gray-50";
    }

    if (isDismissed) {
      return "border-dashed border-gray-300 bg-white";
    }

    if (props.isSelected) {
      return "border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500";
    }

    return "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm";
  };

  /*
   * The severity rail. Severity was previously carried only by a pill beside
   * the title, which put the one attribute you scan a list of eighteen for
   * behind a read of each title. A 2px edge is legible in peripheral vision;
   * the pill stays, because colour alone is not an accessible signal.
   */
  type GetSeverityRailClassFunction = () => string;

  const getSeverityRailClass: GetSeverityRailClassFunction = (): string => {
    if (isCreated) {
      return "bg-green-400";
    }

    if (isDismissed) {
      return "bg-gray-300";
    }

    return isCritical ? "bg-red-400" : "bg-amber-400";
  };

  type ToggleSelectionFunction = () => void;

  const toggleSelection: ToggleSelectionFunction = (): void => {
    if (!isSelectable) {
      return;
    }

    props.onSelectChange(!props.isSelected);
  };

  return (
    /*
     * The whole card is the hit target when it can be selected, not just the
     * 16px box. Eighteen recommendations across five categories is a lot of
     * small targets, and every one of them has a title and a paragraph that
     * look clickable and previously were not.
     *
     * It is a real <button> in that case rather than a div with a handler, so
     * it is reachable by keyboard and announced with its pressed state; the
     * checkbox inside it is presentational there (aria-hidden, not tabbable)
     * because two controls for one action means two tab stops that report the
     * same thing.
     */
    <div
      className={`group relative flex h-full flex-col overflow-hidden rounded-lg border p-4 pl-5 transition-all ${getContainerClass()}`}
      data-testid={`recommendation-card-${props.viewModel.recommendation.recommendationId}`}
    >
      <div
        className={`absolute inset-y-0 left-0 w-1 ${getSeverityRailClass()}`}
        aria-hidden="true"
      />

      {isSelectable ? (
        <button
          type="button"
          className="absolute inset-0 z-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          aria-pressed={props.isSelected}
          aria-label={`Select ${props.viewModel.recommendation.name}`}
          data-testid={`recommendation-card-select-${props.viewModel.recommendation.recommendationId}`}
          onClick={toggleSelection}
        />
      ) : (
        <></>
      )}

      <div className="pointer-events-none relative z-10 flex items-start">
        <div className="flex-shrink-0 pt-0.5">
          {isCreated ? (
            <Icon
              icon={IconProp.CheckCircle}
              className="h-5 w-5 text-green-500"
            />
          ) : (
            <></>
          )}
          {isDismissed ? (
            <Icon icon={IconProp.EyeSlash} className="h-5 w-5 text-gray-400" />
          ) : (
            <></>
          )}
          {isAvailable ? (
            <div aria-hidden="true">
              <Checkbox
                value={props.isSelected}
                disabled={props.isDisabled}
                tabIndex={-1}
                onChange={(value: boolean) => {
                  props.onSelectChange(value);
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </div>

        <div className="ml-3 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-sm font-semibold ${
                isDismissed ? "text-gray-500" : "text-gray-900"
              }`}
            >
              {props.viewModel.recommendation.name}
            </span>
            <StatusBadge
              text={props.viewModel.recommendation.severity}
              type={
                isCritical ? StatusBadgeType.Danger : StatusBadgeType.Warning
              }
            />
            {isCreated ? (
              <StatusBadge text="Created" type={StatusBadgeType.Success} />
            ) : (
              <></>
            )}
            {isDismissed ? (
              <StatusBadge text="Dismissed" type={StatusBadgeType.Info} />
            ) : (
              <></>
            )}
          </div>

          <p
            className={`mt-1.5 text-xs leading-relaxed ${
              isDismissed ? "text-gray-400" : "text-gray-500"
            } ${
              isDescriptionClampable && !isDescriptionExpanded
                ? "line-clamp-3"
                : ""
            }`}
            data-testid={`recommendation-description-${props.viewModel.recommendation.recommendationId}`}
          >
            {description}
          </p>

          {isDescriptionClampable ? (
            <button
              type="button"
              /*
               * pointer-events-auto because the wrapper turns them off so the
               * card-wide select button underneath keeps receiving clicks;
               * this is one of the few things inside a card that is NOT the
               * select action.
               */
              className="pointer-events-auto relative z-20 mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-expanded={isDescriptionExpanded}
              data-testid={`recommendation-description-toggle-${props.viewModel.recommendation.recommendationId}`}
              onClick={() => {
                setIsDescriptionExpanded(!isDescriptionExpanded);
              }}
            >
              {isDescriptionExpanded ? "Show less" : "Show more"}
            </button>
          ) : (
            <></>
          )}

          {isDismissed && props.viewModel.dismissalReason ? (
            <p className="mt-2 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs italic text-gray-500">
              {props.viewModel.dismissalReason}
            </p>
          ) : (
            <></>
          )}
        </div>

        {/*
         * Dismiss lives in the top-right corner and only materializes on hover
         * or keyboard focus. It is a destructive-ish action on a card whose
         * primary interaction is a checkbox, and a permanently visible X next
         * to every one of eighteen cards turns the list into a wall of
         * close buttons.
         */}
        {isAvailable && !props.isDisabled ? (
          <button
            type="button"
            aria-label={`Dismiss ${props.viewModel.recommendation.name}`}
            title="Dismiss this recommendation"
            className="pointer-events-auto relative z-20 ml-2 flex-shrink-0 rounded p-1 text-gray-300 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 group-hover:opacity-100"
            onClick={() => {
              props.onDismiss();
            }}
          >
            <Icon icon={IconProp.Close} size={SizeProp.Smaller} />
          </button>
        ) : (
          <></>
        )}
      </div>

      {isCreated && props.monitorRoute ? (
        <div className="relative z-10 mt-3 pl-8">
          <UILink
            to={props.monitorRoute}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500"
          >
            <span>View monitor</span>
          </UILink>
        </div>
      ) : (
        <></>
      )}

      {isDismissed && !props.isDisabled ? (
        <div className="relative z-10 mt-3 pl-8">
          <button
            type="button"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onClick={() => {
              props.onRestore();
            }}
          >
            Restore
          </button>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default RecommendationCard;
