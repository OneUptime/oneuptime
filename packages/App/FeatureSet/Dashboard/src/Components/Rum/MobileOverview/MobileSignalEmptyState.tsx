import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import {
  MobileChartSignal,
  MobileSignalEmptyCopy,
  MobileSignalEmptyState as MobileSignalEmptyStateName,
} from "../../../Pages/Rum/View/MobileOverviewHelpers";

/*
 * Why a mobile app's App starts, Startup time or frames chart is empty, in
 * the chart's grey box (#9588): none in this range, or none ever reported,
 * with the Android Setup docs one click away. The words are
 * MobileOverviewHelpers', already in the reader's language; this lays them
 * out as RumSignalEmptyState lays out an empty Exceptions or Logs chart.
 */

export interface ComponentProps {
  signal: MobileChartSignal;
  state: MobileSignalEmptyStateName;
  copy: MobileSignalEmptyCopy;
}

// The docs link, drawn as RumSignalEmptyState draws its own.
const SMALL_BUTTON_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const MobileSignalEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const testId: string = `rum-mobile-${props.signal}-empty`;

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
      {props.copy.action ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <a
            href={props.copy.action.url}
            target="_blank"
            rel="noopener noreferrer"
            className={SMALL_BUTTON_CLASS_NAME}
            data-testid={`${testId}-action`}
          >
            <Icon icon={IconProp.Book} className="h-3.5 w-3.5" />
            <span>{props.copy.action.label}</span>
          </a>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default MobileSignalEmptyState;
