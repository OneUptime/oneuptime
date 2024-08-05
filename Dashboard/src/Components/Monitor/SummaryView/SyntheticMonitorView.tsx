import SyntheticMonitorItemView from "./SyntheticMonitorItemView";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import HorizontalRule from "CommonUI/src/Components/HorizontalRule/HorizontalRule";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
}

const SyntheticMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (
    !props.probeMonitorResponse ||
    !props.probeMonitorResponse.syntheticMonitorResponse
  ) {
    return (
      <ErrorMessage error="No summary available for the selected probe. Should be few minutes for summary to show up. " />
    );
  }

  const syntheticMonitorResponses: Array<SyntheticMonitorResponse> =
    props.probeMonitorResponse.syntheticMonitorResponse;

  return (
    <div>
      {syntheticMonitorResponses &&
        syntheticMonitorResponses.map(
          (
            syntheticMonitorResponse: SyntheticMonitorResponse,
            index: number,
          ) => {
            return (
              <div key={index}>
                <SyntheticMonitorItemView
                  key={index}
                  syntheticMonitorResponse={syntheticMonitorResponse}
                  monitoredAt={props.probeMonitorResponse.monitoredAt}
                />
                {index !== syntheticMonitorResponses.length - 1 && (
                  <HorizontalRule />
                )}
              </div>
            );
          },
        )}
    </div>
  );
};

export default SyntheticMonitorView;
