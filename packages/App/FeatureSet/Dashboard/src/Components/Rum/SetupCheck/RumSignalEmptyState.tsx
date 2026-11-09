import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import Icon from "Common/UI/Components/Icon/Icon";
import TableEmptyState, {
  TableEmptyStateAction,
  TableEmptyStateActionStyle,
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../../AppLink/AppLink";
import { TELEMETRY_FIRST_STEPS_GUTTER_CLASS_NAME } from "../../Telemetry/TelemetryFirstStepsEmptyState";
import { RumSignalState } from "./RumSignalDiagnosis";
import {
  RumPanelSignal,
  RumSignalAction,
  RumSignalEmptyCopy,
} from "./RumSignalWords";

/*
 * Why a RUM application's Exceptions or Logs are empty, and the one thing
 * to do about it (issue #5770): in an empty chart on its Overview
 * ("chart"), and on its Logs page ("page", drawn like every empty
 * explorer). The words are RumSignalWords', already in the reader's
 * language; this only lays them out and wires the action.
 */

export interface ComponentProps {
  signal: RumPanelSignal;
  state: RumSignalState;
  copy: RumSignalEmptyCopy;
  variant: "chart" | "page";
  // The application's Documentation tab, where its SDK is set up.
  documentationRoute: Route;
  onSetUp: (signal: RumPanelSignal) => void;
  onRangeChange?: ((timeRange: RangeStartAndEndDateTime) => void) | undefined;
  onRetry?: (() => void) | undefined;
}

const SMALL_BUTTON_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const HELP_LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline";

const ACTION_ICONS: Record<RumSignalAction["kind"], IconProp> = {
  "set-up": IconProp.Code,
  documentation: IconProp.Book,
  docs: IconProp.Book,
  "recording-health": IconProp.Heart,
  "set-range": IconProp.Calendar,
  retry: IconProp.Refresh,
};

const RumSignalEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const testId: string = `rum-${props.signal}-empty`;
  const action: RumSignalAction | undefined = props.copy.action;

  const runAction: (action: RumSignalAction) => void = (
    item: RumSignalAction,
  ): void => {
    switch (item.kind) {
      case "set-up":
        props.onSetUp(item.signal);
        return;
      case "documentation":
        Navigation.navigate(props.documentationRoute);
        return;
      case "docs":
        window.open(item.url, "_blank", "noopener,noreferrer");
        return;
      case "set-range":
        props.onRangeChange?.(item.range);
        return;
      case "retry":
        props.onRetry?.();
        return;
      default:
        return;
    }
  };

  // A longer range or a retry the page cannot take is not offered.
  const isActionAvailable: boolean = Boolean(
    action &&
      (action.kind !== "set-range" || props.onRangeChange) &&
      (action.kind !== "retry" || props.onRetry),
  );

  if (props.variant === "page") {
    const actions: Array<TableEmptyStateAction> = [];

    if (action && isActionAvailable) {
      actions.push({
        title: action.label,
        icon: ACTION_ICONS[action.kind],
        dataTestId: `${testId}-action`,
        onClick: (): void => {
          runAction(action);
        },
      });
    }

    if (props.copy.helpLink) {
      const url: string = props.copy.helpLink.url;
      actions.push({
        title: props.copy.helpLink.text,
        icon: IconProp.ExternalLink,
        style: TableEmptyStateActionStyle.Link,
        dataTestId: `${testId}-help`,
        onClick: (): void => {
          window.open(url, "_blank", "noopener,noreferrer");
        },
      });
    }

    return (
      <div
        className={TELEMETRY_FIRST_STEPS_GUTTER_CLASS_NAME}
        data-testid={`${testId}-gutter`}
        data-state={props.state}
      >
        <TableEmptyState
          kind={
            props.state === "unknown"
              ? TableEmptyStateKind.Error
              : TableEmptyStateKind.Empty
          }
          icon={props.signal === "exceptions" ? IconProp.Bug : IconProp.Logs}
          title={props.copy.title}
          description={props.copy.detail}
          note={props.copy.evidence}
          actions={actions}
          dataTestId={testId}
        />
      </div>
    );
  }

  let actionElement: ReactElement = <></>;

  if (action && isActionAvailable) {
    const content: ReactElement = (
      <>
        <Icon icon={ACTION_ICONS[action.kind]} className="h-3.5 w-3.5" />
        <span>{action.label}</span>
      </>
    );

    actionElement =
      action.kind === "documentation" ? (
        <AppLink
          to={props.documentationRoute}
          className={SMALL_BUTTON_CLASS_NAME}
          dataTestId={`${testId}-action`}
        >
          {content}
        </AppLink>
      ) : action.kind === "docs" ? (
        <a
          href={action.url}
          target="_blank"
          rel="noopener noreferrer"
          className={SMALL_BUTTON_CLASS_NAME}
          data-testid={`${testId}-action`}
        >
          {content}
        </a>
      ) : (
        <button
          type="button"
          className={SMALL_BUTTON_CLASS_NAME}
          data-testid={`${testId}-action`}
          onClick={(): void => {
            runAction(action);
          }}
        >
          {content}
        </button>
      );
  }

  return (
    <div
      className="flex min-h-44 flex-1 flex-col items-center justify-center px-4 py-5 text-center"
      data-testid={testId}
      data-state={props.state}
    >
      <div
        className="max-w-md text-balance text-sm font-medium text-gray-900"
        data-testid={`${testId}-title`}
      >
        {props.copy.title}
      </div>
      {props.copy.detail ? (
        <div
          className="mt-1 max-w-md text-balance text-xs leading-5 text-gray-500"
          data-testid={`${testId}-detail`}
        >
          {props.copy.detail}
        </div>
      ) : (
        <></>
      )}
      {props.copy.evidence ? (
        <div
          className="mt-1.5 max-w-md text-balance text-xs leading-5 text-amber-700"
          data-testid={`${testId}-evidence`}
        >
          {props.copy.evidence}
        </div>
      ) : (
        <></>
      )}
      {(action && isActionAvailable) || props.copy.helpLink ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          {actionElement}
          {props.copy.helpLink ? (
            <a
              href={props.copy.helpLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className={HELP_LINK_CLASS_NAME}
              data-testid={`${testId}-help`}
            >
              {props.copy.helpLink.text}
            </a>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default RumSignalEmptyState;
