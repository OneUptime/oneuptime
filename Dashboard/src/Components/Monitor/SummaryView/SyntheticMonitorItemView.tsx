import CustomCodeMonitorSummaryView from "./CustomMonitorSummaryView";
import SummaryScreenshotGroup from "./ScreenshotGroup";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  syntheticMonitorResponse: SyntheticMonitorResponse;
  monitoredAt: Date;
}

const SyntheticMonitorItemView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.syntheticMonitorResponse) {
    return (
      <ErrorMessage error="No summary available for the selected probe. Should be few minutes for summary to show up. " />
    );
  }

  const syntheticMonitorResponse: SyntheticMonitorResponse =
    props.syntheticMonitorResponse;

  const getMoreDetails: GetReactElementFunction = (): ReactElement => {
    return (
      <div>
        <SummaryScreenshotGroup
          screenshots={props.syntheticMonitorResponse.screenshots || {}}
        />
      </div>
    );
  };

  return (
    <div>
      <div className="mb-3">
        {props.syntheticMonitorResponse.browserType} -{" "}
        {props.syntheticMonitorResponse.screenSizeType}
      </div>
      <CustomCodeMonitorSummaryView
        customCodeMonitorResponse={syntheticMonitorResponse}
        monitoredAt={props.monitoredAt}
        moreDetailElement={getMoreDetails()}
      />
    </div>
  );
};

export default SyntheticMonitorItemView;
