import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TableEmptyState, {
  TableEmptyStateAction,
  TableEmptyStateActionStyle,
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  offersPastWeek,
  PAST_WEEK_RANGE,
  SHOW_PAST_WEEK_ACTION,
  TELEMETRY_FIRST_STEPS_COPY,
  TelemetryFirstStepsCopy,
  TelemetryFirstStepsSignal,
} from "./TelemetryFirstSteps";

/*
 * The empty Logs, Traces or Metrics explorer of a project that may not be
 * sending that signal yet: what appears here and when, the product's setup
 * guide as the way in, and - while the explorer shows less than a week - a
 * longer range for a project whose data is simply older than the window.
 * Drawn like every other empty list (TableEmptyState), as AI / LLM
 * Conversations draws its own. See TelemetryFirstSteps.ts for when.
 */

// Side room below sm, where TableEmptyState has none of its own (sm:px-6).
export const TELEMETRY_FIRST_STEPS_GUTTER_CLASS_NAME: string = "px-4 sm:px-0";

const SETUP_PAGES: Record<TelemetryFirstStepsSignal, PageMap> = {
  [TelemetryFirstStepsSignal.Logs]: PageMap.LOGS_DOCUMENTATION,
  [TelemetryFirstStepsSignal.Traces]: PageMap.TRACES_DOCUMENTATION,
  [TelemetryFirstStepsSignal.Metrics]: PageMap.METRICS_DOCUMENTATION,
  [TelemetryFirstStepsSignal.Exceptions]: PageMap.EXCEPTIONS_DOCUMENTATION,
  [TelemetryFirstStepsSignal.Profiles]: PageMap.PROFILES_DOCUMENTATION,
};

/**
 * The first steps' one way in: the product's Setup Guide tab. A list drawn
 * by ModelTable (the Profiler's All profiles) offers it in its own empty
 * state with this.
 */
export function getTelemetryFirstStepsSetupAction(
  signal: TelemetryFirstStepsSignal,
): TableEmptyStateAction {
  const copy: TelemetryFirstStepsCopy = TELEMETRY_FIRST_STEPS_COPY[signal];

  return {
    title: copy.setupAction,
    icon: IconProp.Book,
    dataTestId: `${copy.dataTestId}-setup`,
    onClick: (): void => {
      Navigation.navigate(
        RouteUtil.populateRouteParams(RouteMap[SETUP_PAGES[signal]] as Route),
      );
    },
  };
}

export interface ComponentProps {
  signal: TelemetryFirstStepsSignal;
  // The window the list shows; with no window there is no longer one.
  timeRange?: RangeStartAndEndDateTime | undefined;
  /*
   * Unset when a longer range cannot help: Exceptions and Profiles show
   * these steps only for a project with none at any time.
   */
  onTimeRangeChange?:
    | ((timeRange: RangeStartAndEndDateTime) => void)
    | undefined;
}

const TelemetryFirstStepsEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const copy: TelemetryFirstStepsCopy =
    TELEMETRY_FIRST_STEPS_COPY[props.signal];

  const actions: Array<TableEmptyStateAction> = [
    getTelemetryFirstStepsSetupAction(props.signal),
  ];

  const onTimeRangeChange:
    | ((timeRange: RangeStartAndEndDateTime) => void)
    | undefined = props.onTimeRangeChange;

  if (onTimeRangeChange && props.timeRange && offersPastWeek(props.timeRange)) {
    actions.push({
      title: SHOW_PAST_WEEK_ACTION,
      icon: IconProp.Calendar,
      style: TableEmptyStateActionStyle.Link,
      dataTestId: `${copy.dataTestId}-past-week`,
      onClick: (): void => {
        onTimeRangeChange(PAST_WEEK_RANGE);
      },
    });
  }

  /*
   * The explorers draw their list in a bordered box with no padding of its
   * own, and the empty state pads itself only from sm up: on a phone its
   * sentence and its full-width button ran from border to border. The
   * wrapper gives it the side room a card body has.
   */
  return (
    <div
      className={TELEMETRY_FIRST_STEPS_GUTTER_CLASS_NAME}
      data-testid={`${copy.dataTestId}-gutter`}
    >
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        icon={copy.icon}
        title={copy.title}
        description={copy.description}
        actions={actions}
        dataTestId={copy.dataTestId}
      />
    </div>
  );
};

export default TelemetryFirstStepsEmptyState;
