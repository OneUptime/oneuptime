import CustomCodeMonitorSummaryView from "./CustomMonitorSummaryView";
import SummaryScreenshotGroup from "./ScreenshotGroup";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import { GetReactElementFunction } from "CommonUI/src/Types/FunctionTypes";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  syntheticMonitor: SyntheticMonitorResponse;
  monitoredAt: Date;
}

const SyntheticMonitorItemView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.syntheticMonitor) {
    return (
      <ErrorMessage error="No summary available for the selected probe. Should be few minutes for summary to show up. " />
    );
  }

  const syntheticMonitor: SyntheticMonitorResponse =
    props.syntheticMonitor;

  const getMoreDetails: GetReactElementFunction = (): ReactElement => {
    return (
      <div>
        <SummaryScreenshotGroup
          screenshots={props.syntheticMonitor.screenshots || {}}
        />
      </div>
    );
  };

  return (
    <div>
      <div className="mb-3">
        {props.syntheticMonitor.browserType} -{" "}
        {props.syntheticMonitor.screenSizeType}
      </div>
      <CustomCodeMonitorSummaryView
        customCodeMonitor={syntheticMonitor}
        monitoredAt={props.monitoredAt}
        moreDetailElement={getMoreDetails()}
      />
    </div>
  );
};

export default SyntheticMonitorItemView;
