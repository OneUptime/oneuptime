import LayerConfigForm from "./LayerConfigForm";
import LayerUser from "./LayerUser";
import { getColorForUserId } from "./LayerUserColors";
import { summarizeRestriction, summarizeRotation } from "./LayerSummary";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  layer: OnCallDutyPolicyScheduleLayer;
  users: Array<OnCallDutyPolicyScheduleLayerUser>;
  index: number;
  total: number;
  isExpanded: boolean;
  /*
   * Disables delete + reorder while any layer mutation is in flight, so
   * concurrent add / delete / reorder cannot interleave and corrupt ordering.
   */
  actionsDisabled: boolean;
  isDeleteButtonLoading: boolean;
  onToggleExpand: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleteLayer: () => void;
  onLayerChange: (layer: OnCallDutyPolicyScheduleLayer) => void;
  onUsersChange: (users: Array<OnCallDutyPolicyScheduleLayerUser>) => void;
}

type GetInitialsFunction = (name: string, email: string) => string;

const getInitials: GetInitialsFunction = (
  name: string,
  email: string,
): string => {
  const source: string = (name || email || "?").trim();
  const parts: Array<string> = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  return source.substring(0, 2).toUpperCase();
};

interface SummaryChipProps {
  icon: IconProp;
  text: string;
}

const SummaryChip: FunctionComponent<SummaryChipProps> = (
  props: SummaryChipProps,
): ReactElement => {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
      <Icon icon={props.icon} className="h-3.5 w-3.5 text-gray-400" />
      <span>{props.text}</span>
    </span>
  );
};

const LayerCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const layer: OnCallDutyPolicyScheduleLayer = props.layer;
  const isTopPriority: boolean = props.index === 0;

  const rotationSummary: string = summarizeRotation(layer.rotation);

  const restrictionSummary: string = summarizeRestriction(
    layer.restrictionTimes,
  );

  const userCount: number = props.users.length;
  const shownUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
    props.users.slice(0, 4);
  const remainingUsers: number = userCount - shownUsers.length;

  const getAvatarStack: () => ReactElement = (): ReactElement => {
    if (userCount === 0) {
      return <SummaryChip icon={IconProp.User} text="No users assigned" />;
    }

    return (
      <span className="inline-flex items-center gap-2 rounded-md bg-gray-50 py-1 pl-1.5 pr-2 ring-1 ring-inset ring-gray-200">
        <span className="flex -space-x-1.5">
          {shownUsers.map(
            (layerUser: OnCallDutyPolicyScheduleLayerUser, i: number) => {
              const user: User | undefined = layerUser.user;
              const userId: string = user?.id?.toString() || `unknown-${i}`;
              const name: string = user?.name?.toString() || "";
              const email: string = user?.email?.toString() || "";
              /*
               * Key by the per-assignment row id, not the user id: the same user
               * can appear twice in a layer, which would collide on user id.
               */
              const rowKey: string =
                layerUser.id?.toString() || `${userId}-${i}`;
              return (
                <Tooltip key={rowKey} text={name || email || "Unknown user"}>
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-white"
                    style={{ backgroundColor: getColorForUserId(userId) }}
                  >
                    {getInitials(name, email)}
                  </span>
                </Tooltip>
              );
            },
          )}
          {remainingUsers > 0 && (
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-600 ring-2 ring-white">
              +{remainingUsers}
            </span>
          )}
        </span>
        <span className="text-xs font-medium text-gray-600">
          {userCount === 1 ? "1 user" : `${userCount} users`}
        </span>
      </span>
    );
  };

  const getReorderButton: (params: {
    icon: IconProp;
    label: string;
    disabled: boolean;
    onClick: () => void;
  }) => ReactElement = (params: {
    icon: IconProp;
    label: string;
    disabled: boolean;
    onClick: () => void;
  }): ReactElement => {
    return (
      <button
        type="button"
        aria-label={params.label}
        disabled={params.disabled || props.actionsDisabled}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          params.onClick();
        }}
        className={`flex h-4 w-6 items-center justify-center rounded transition-colors ${
          params.disabled || props.actionsDisabled
            ? "cursor-not-allowed text-gray-300"
            : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        }`}
      >
        <Icon icon={params.icon} className="h-3.5 w-3.5" />
      </button>
    );
  };

  return (
    <div
      className={`rounded-xl border bg-white shadow-sm transition-shadow ${
        props.isExpanded
          ? "border-indigo-200 shadow-md"
          : "border-gray-200 hover:shadow-md"
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 p-4 md:p-5">
        {/* Priority badge, aligned inline with the layer name */}
        <Tooltip
          text={
            isTopPriority
              ? "Highest priority layer"
              : `Priority ${props.index + 1}`
          }
        >
          <span
            className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white ${
              isTopPriority ? "bg-indigo-600" : "bg-gray-400"
            }`}
          >
            {props.index + 1}
          </span>
        </Tooltip>

        {/* Main clickable info */}
        <div
          role="button"
          tabIndex={0}
          onClick={props.onToggleExpand}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onToggleExpand();
            }
          }}
          aria-expanded={props.isExpanded}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-base font-semibold text-gray-900">
              {layer.name?.toString() || `Layer ${props.index + 1}`}
            </span>
            {isTopPriority && props.total > 1 && (
              <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200/70">
                Highest priority
              </span>
            )}
          </div>
          {layer.description ? (
            <p className="mt-0.5 truncate text-sm text-gray-500">
              {layer.description.toString()}
            </p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {getAvatarStack()}
            <SummaryChip icon={IconProp.Refresh} text={rotationSummary} />
            <SummaryChip icon={IconProp.Clock} text={restrictionSummary} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-shrink-0 items-center gap-0.5">
          {props.total > 1 && (
            <div className="mr-0.5 flex flex-col">
              {getReorderButton({
                icon: IconProp.ChevronUp,
                label: "Move layer up (higher priority)",
                disabled: props.index === 0,
                onClick: props.onMoveUp,
              })}
              {getReorderButton({
                icon: IconProp.ChevronDown,
                label: "Move layer down (lower priority)",
                disabled: props.index === props.total - 1,
                onClick: props.onMoveDown,
              })}
            </div>
          )}
          <Tooltip text="Delete layer">
            <button
              type="button"
              aria-label="Delete layer"
              disabled={props.isDeleteButtonLoading || props.actionsDisabled}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                props.onDeleteLayer();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon
                icon={
                  props.isDeleteButtonLoading
                    ? IconProp.Spinner
                    : IconProp.Trash
                }
                className="h-4 w-4"
              />
            </button>
          </Tooltip>
          <button
            type="button"
            aria-label={props.isExpanded ? "Collapse layer" : "Expand layer"}
            onClick={props.onToggleExpand}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <Icon
              icon={
                props.isExpanded ? IconProp.ChevronUp : IconProp.ChevronDown
              }
              className="h-5 w-5"
            />
          </button>
        </div>
      </div>

      {/* Body */}
      {props.isExpanded && (
        <div className="border-t border-gray-200 px-4 py-5 md:px-5">
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-900">
              On-call users
            </h4>
            <p className="mb-3 mt-0.5 text-sm text-gray-500">
              Users rotate in this order. Drag to reorder the rotation.
            </p>
            <LayerUser layer={layer} onUpdateUsers={props.onUsersChange} />
          </div>

          <div className="border-t border-gray-200 pt-5">
            <LayerConfigForm
              layer={layer}
              onLayerChange={props.onLayerChange}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default LayerCard;
