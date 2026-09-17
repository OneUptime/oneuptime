import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Link from "Common/UI/Components/Link/Link";
import Icon from "Common/UI/Components/Icon/Icon";
import { SessionReplayAdvancedFilters } from "./SessionReplayListFilters";
import { SessionReplayFilterChip } from "./SessionReplayFilterFields";
import {
  getRecordingHealthActionLink,
  RecordingHealthActionLink,
} from "./RecordingHealthCard";
import useSessionReplayHealth, {
  SessionReplayHealthSnapshot,
} from "./useSessionReplayHealth";
import {
  describeSessionReplayListError,
  describeTimeRange,
  getEmptyReason,
  getTimeRangeWindowMs,
  pickWiderRange,
  SessionReplayEmptyAction,
  SessionReplayEmptyContext,
  SessionReplayEmptyHealthContext,
  SessionReplayEmptyReason,
  SessionReplayEmptyVariant,
  SessionReplayListErrorCopy,
  SessionReplayListErrorKind,
} from "./SessionReplayEmptyReason";

/*
 * The pure half - the empty-reason decision and the list-error copy - lives
 * in SessionReplayEmptyReason.ts, which imports no React. Re-exported here
 * because every caller reads these names off this module.
 */
export {
  describeSessionReplayListError,
  describeTimeRange,
  getEmptyReason,
  getTimeRangeWindowMs,
  pickWiderRange,
};
export type {
  SessionReplayEmptyAction,
  SessionReplayEmptyContext,
  SessionReplayEmptyHealthContext,
  SessionReplayEmptyReason,
  SessionReplayEmptyVariant,
  SessionReplayListErrorCopy,
  SessionReplayListErrorKind,
};

/* ---- Chips ---- */

export interface SessionReplayFilterChipListProps {
  chips: Array<SessionReplayFilterChip>;
  onRemoveChip: (field: keyof SessionReplayAdvancedFilters) => void;
}

/*
 * The applied filters as removable chips. Shared by the table's banner and
 * the filters-match-nothing empty state so the two never disagree about
 * what is applied.
 */
export const SessionReplayFilterChipList: FunctionComponent<
  SessionReplayFilterChipListProps
> = (props: SessionReplayFilterChipListProps): ReactElement => {
  return (
    <ul
      className="flex flex-wrap items-center gap-2"
      aria-label="Applied filters"
      data-testid="session-filter-chips"
    >
      {props.chips.map((chip: SessionReplayFilterChip): ReactElement => {
        return (
          <li
            key={chip.field}
            data-testid="session-filter-chip"
            data-field={chip.field}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-1 pl-3 pr-1 text-xs text-gray-700"
          >
            <span className="font-medium">{chip.label}</span>
            <span className="text-gray-500">{chip.text}</span>
            <button
              type="button"
              className="ml-1 rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
              aria-label={`Remove ${chip.label} filter`}
              onClick={(): void => {
                props.onRemoveChip(chip.field);
              }}
            >
              <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
};

/* ---- View ---- */

export interface SessionReplayEmptyStateViewProps {
  rumApplicationId: ObjectID | string;
  reason: SessionReplayEmptyReason;
  chips: Array<SessionReplayFilterChip>;
  onRemoveChip: (field: keyof SessionReplayAdvancedFilters) => void;
  onClearFilters: () => void;
  onSetTimeRange: (range: RangeStartAndEndDateTime) => void;
  onPreviousPage: () => void;
  onRefresh: () => void;
}

const VARIANT_ICONS: Record<SessionReplayEmptyVariant, IconProp> = {
  disabled: IconProp.VideoCameraSlash,
  budget: IconProp.BoltSlash,
  refusing: IconProp.Error,
  "never-installed": IconProp.VideoCamera,
  "installed-not-uploading": IconProp.Clock,
  "no-sessions-in-range": IconProp.Clock,
  "filters-match-nothing": IconProp.Filter,
  "end-of-list": IconProp.List,
};

export const SessionReplayEmptyStateView: FunctionComponent<
  SessionReplayEmptyStateViewProps
> = (props: SessionReplayEmptyStateViewProps): ReactElement => {
  const { reason } = props;

  type RenderActionFunction = () => ReactElement | null;

  const renderAction: RenderActionFunction = (): ReactElement | null => {
    const action: SessionReplayEmptyAction | null = reason.action;

    if (!action) {
      return null;
    }

    if (action.kind === "health") {
      const link: RecordingHealthActionLink = getRecordingHealthActionLink(
        action.target,
        props.rumApplicationId,
      );

      return (
        <Link
          to={link.to}
          openInNewTab={link.openInNewTab}
          className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
        >
          <span data-testid="list-empty-action">{action.label}</span>
        </Link>
      );
    }

    return (
      <Button
        title={action.label}
        dataTestId="list-empty-action"
        buttonStyle={ButtonStyleType.NORMAL}
        onClick={(): void => {
          switch (action.kind) {
            case "set-range":
              props.onSetTimeRange(action.range);
              break;
            case "clear-filters":
              props.onClearFilters();
              break;
            case "previous-page":
              props.onPreviousPage();
              break;
            case "refresh":
              props.onRefresh();
              break;
            default:
              break;
          }
        }}
      />
    );
  };

  return (
    <div
      data-testid="list-empty"
      data-variant={reason.variant}
      className="py-4"
    >
      <span className="sr-only" data-testid="list-empty-variant">
        {reason.variant}
      </span>
      <div className="flex bg-white px-6 py-12">
        <div className="m-auto max-w-xl text-center">
          <Icon
            icon={VARIANT_ICONS[reason.variant]}
            className="mx-auto h-10 w-10 rounded-lg bg-indigo-50 p-2 text-indigo-500"
          />
          <h3
            className="mt-3 text-sm font-semibold text-gray-900"
            data-testid="list-empty-title"
          >
            {reason.title}
          </h3>
          <p
            className="mt-1 text-sm text-gray-500"
            data-testid="list-empty-detail"
          >
            {reason.detail}
          </p>

          {reason.showChips && props.chips.length > 0 && (
            <div
              className="mt-4 flex justify-center"
              data-testid="list-empty-chips"
            >
              <SessionReplayFilterChipList
                chips={props.chips}
                onRemoveChip={props.onRemoveChip}
              />
            </div>
          )}

          {reason.action && <div className="mt-5">{renderAction()}</div>}
        </div>
      </div>
    </div>
  );
};

/* ---- Connected ---- */

export interface SessionReplayEmptyStateProps {
  rumApplicationId: ObjectID | string;
  /* The list's own state; health and the clock are read here. */
  context: Omit<SessionReplayEmptyContext, "health" | "nowUnixMs">;
  chips: Array<SessionReplayFilterChip>;
  onRemoveChip: (field: keyof SessionReplayAdvancedFilters) => void;
  onClearFilters: () => void;
  onSetTimeRange: (range: RangeStartAndEndDateTime) => void;
  onPreviousPage: () => void;
  onRefresh: () => void;
}

/*
 * Subscribes to the same health poller the strip above the list uses, so
 * the empty answer and the strip never disagree about why.
 */
const SessionReplayEmptyState: FunctionComponent<
  SessionReplayEmptyStateProps
> = (props: SessionReplayEmptyStateProps): ReactElement => {
  const health: SessionReplayHealthSnapshot = useSessionReplayHealth(
    props.rumApplicationId,
  );

  const reason: SessionReplayEmptyReason | null = getEmptyReason({
    ...props.context,
    health: health.isLoading
      ? null
      : { status: health.status, diagnosis: health.diagnosis },
    nowUnixMs: health.nowUnixMs,
  });

  if (!reason) {
    return <></>;
  }

  return (
    <SessionReplayEmptyStateView
      rumApplicationId={props.rumApplicationId}
      reason={reason}
      chips={props.chips}
      onRemoveChip={props.onRemoveChip}
      onClearFilters={props.onClearFilters}
      onSetTimeRange={props.onSetTimeRange}
      onPreviousPage={props.onPreviousPage}
      onRefresh={props.onRefresh}
    />
  );
};

export default SessionReplayEmptyState;
