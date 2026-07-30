import React, { FunctionComponent, ReactElement } from "react";
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

  type GetContainerClassFunction = () => string;

  const getContainerClass: GetContainerClassFunction = (): string => {
    if (isCreated) {
      return "border-gray-200 bg-gray-50";
    }

    if (isDismissed) {
      return "border-dashed border-gray-300 bg-white";
    }

    if (props.isSelected) {
      return "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500";
    }

    return "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm";
  };

  return (
    <div
      className={`group relative flex h-full flex-col rounded-lg border p-4 transition-all ${getContainerClass()}`}
      data-testid={`recommendation-card-${props.viewModel.recommendation.recommendationId}`}
    >
      <div className="flex items-start">
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
            <Checkbox
              value={props.isSelected}
              disabled={props.isDisabled}
              onChange={(value: boolean) => {
                props.onSelectChange(value);
              }}
            />
          ) : (
            <></>
          )}
        </div>

        <div className="ml-3 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-sm font-medium ${
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
            className={`mt-1 text-xs ${
              isDismissed ? "text-gray-400" : "text-gray-500"
            }`}
          >
            {props.viewModel.recommendation.description}
          </p>

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
            className="ml-2 flex-shrink-0 rounded p-1 text-gray-300 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 group-hover:opacity-100"
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
        <div className="mt-3 pl-8">
          <UILink
            to={props.monitorRoute}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
          >
            <span>View monitor</span>
          </UILink>
        </div>
      ) : (
        <></>
      )}

      {isDismissed && !props.isDisabled ? (
        <div className="mt-3 pl-8">
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
