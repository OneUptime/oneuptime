import SyntheticMonitorItemView from "./SyntheticMonitorItemView";
import SyntheticMonitor from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitor";
import ProbeMonitor from "Common/Types/Monitor/Monitor";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import HorizontalRule from "CommonUI/src/Components/HorizontalRule/HorizontalRule";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeMonitor: ProbeMonitor;
}

const SyntheticMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (
    !props.probeMonitor ||
    !props.probeMonitor.syntheticMonitor
  ) {
    return (
      <ErrorMessage error="No summary available for the selected probe. Should be few minutes for summary to show up. " />
    );
  }

  const syntheticMonitors: Array<SyntheticMonitor> =
    props.probeMonitor.syntheticMonitor;

  return (
    <div>
      {syntheticMonitors &&
        syntheticMonitors.map(
          (
            syntheticMonitor: SyntheticMonitor,
            index: number,
          ) => {
            return (
              <div key={index}>
                <SyntheticMonitorItemView
                  key={index}
                  syntheticMonitor={syntheticMonitor}
                  monitoredAt={props.probeMonitor.monitoredAt}
                />
                {index !== syntheticMonitors.length - 1 && (
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
