import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import IncomingRequestMonitorView from "./IncomingRequestMonitorSummaryView";
import PingMonitorView from "./PingMonitorView";
import SSLCertificateMonitorView from "./SSLCertificateMonitorView";
import ServerMonitorSummaryView from "./ServerMonitorView";
import SyntheticMonitorView from "./SyntheticMonitorView";
import WebsiteMonitorSummaryView from "./WebsiteMonitorView";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorType: MonitorType;
  probeMonitorResponses?: Array<ProbeMonitorResponse> | undefined; // this is an array because of multiple monitor steps.
  incomingMonitorRequest?: IncomingMonitorRequest | undefined;
  serverMonitorResponse?: ServerMonitorResponse | undefined;
}

const SummaryInfo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type GetProbeableMonitorSummarysInfo = (
    probeMonitorResponse: ProbeMonitorResponse,
    key: number,
  ) => ReactElement;

  const getProbableMonitorSummarysInfo: GetProbeableMonitorSummarysInfo = (
    probeMonitorResponse: ProbeMonitorResponse,
    key: number,
  ): ReactElement => {
    if (!probeMonitorResponse) {
      return (
        <ErrorMessage
          error={
            "No summary available for the selected probe. Should be few minutes for summary to show up. "
          }
        />
      );
    }

    if (
      props.monitorType === MonitorType.Website ||
      props.monitorType === MonitorType.API
    ) {
      return (
        <WebsiteMonitorSummaryView
          key={key}
          probeMonitorResponse={probeMonitorResponse}
        />
      );
    }

    if (
      props.monitorType === MonitorType.Ping ||
      props.monitorType === MonitorType.IP ||
      props.monitorType === MonitorType.Port
    ) {
      return (
        <PingMonitorView
          key={key}
          probeMonitorResponse={probeMonitorResponse}
        />
      );
    }

    if (props.monitorType === MonitorType.SSLCertificate) {
      return (
        <SSLCertificateMonitorView
          key={key}
          probeMonitorResponse={probeMonitorResponse}
        />
      );
    }

    if (props.monitorType === MonitorType.SyntheticMonitor) {
      return (
        <SyntheticMonitorView
          key={key}
          probeMonitorResponse={probeMonitorResponse}
        />
      );
    }

    return <></>;
  };

  if (
    MonitorTypeHelper.isProbableMonitor(props.monitorType) &&
    (!props.probeMonitorResponses || props.probeMonitorResponses.length === 0)
  ) {
    return (
      <ErrorMessage
        error={
          "No summary available for the selected probe. Should be few minutes for summary to show up. "
        }
      />
    );
  }

  if (
    !props.incomingMonitorRequest &&
    props.monitorType === MonitorType.IncomingRequest
  ) {
    return (
      <ErrorMessage
        error={
          "No summary available for the selected probe. Should be few minutes for summary to show up. "
        }
      />
    );
  }

  return (
    <div>
      {props.probeMonitorResponses &&
        props.probeMonitorResponses.map(
          (probeMonitorResponse: ProbeMonitorResponse, index: number) => {
            return getProbableMonitorSummarysInfo(probeMonitorResponse, index);
          },
        )}

      {props.incomingMonitorRequest &&
      props.monitorType === MonitorType.IncomingRequest ? (
        <IncomingRequestMonitorView
          incomingMonitorRequest={props.incomingMonitorRequest}
        />
      ) : (
        <></>
      )}

      {props.monitorType === MonitorType.Server &&
      props.serverMonitorResponse ? (
        <ServerMonitorSummaryView
          serverMonitorResponse={props.serverMonitorResponse}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SummaryInfo;
