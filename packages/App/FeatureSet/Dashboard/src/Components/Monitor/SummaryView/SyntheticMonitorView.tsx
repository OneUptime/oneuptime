import SyntheticMonitorItemView from "./SyntheticMonitorItemView";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

const SyntheticMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (
    !props.probeMonitorResponse ||
    !props.probeMonitorResponse.syntheticMonitorResponse
  ) {
    return (
      <ErrorMessage message="No summary available for the selected probe. Should be few minutes for summary to show up. " />
    );
  }

  const syntheticMonitorResponses: Array<SyntheticMonitorResponse> =
    props.probeMonitorResponse.syntheticMonitorResponse;

  return (
    <div className="space-y-5">
      <div className="flex space-x-3">
        <InfoCard
          className="w-full shadow-none border-2 border-gray-100 "
          title="Probe"
          value={props.probeName || "-"}
        />
      </div>
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
