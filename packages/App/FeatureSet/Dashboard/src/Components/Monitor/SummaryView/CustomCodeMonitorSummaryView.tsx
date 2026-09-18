import CustomCodeMonitorResponse from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";
import CustomMonitorSummaryView from "./CustomMonitorSummaryView";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  moreDetailElement?: ReactElement | undefined;
  probeName?: string | undefined;
}

const CustomCodeMonitorSummaryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.probeMonitorResponse.customCodeMonitorResponse) {
    return (
      <ErrorMessage message="No summary available for the selected probe. Should be few minutes for summary to show up. " />
    );
  }

  const customCodeMonitorResponse: CustomCodeMonitorResponse =
    props.probeMonitorResponse.customCodeMonitorResponse;

  return (
    <CustomMonitorSummaryView
      customCodeMonitorResponse={customCodeMonitorResponse}
      moreDetailElement={props.moreDetailElement}
      monitoredAt={props.probeMonitorResponse.monitoredAt}
      probeName={props.probeName}
    />
  );
};

export default CustomCodeMonitorSummaryView;
