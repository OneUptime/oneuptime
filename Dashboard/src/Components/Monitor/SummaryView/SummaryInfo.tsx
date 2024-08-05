import ServerMonitor from "Common/Types/Monitor/ServerMonitor/ServerMonitor";
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
import ProbeMonitor from "Common/Types/Monitor/Monitor";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorType: MonitorType;
  probeMonitors?: Array<ProbeMonitor> | undefined; // this is an array because of multiple monitor steps.
  incomingMonitorRequest?: IncomingMonitorRequest | undefined;
  serverMonitor?: ServerMonitor | undefined;
}

const SummaryInfo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type GetProbeableMonitorSummarysInfo = (
    probeMonitor: ProbeMonitor,
    key: number,
  ) => ReactElement;

  const getProbableMonitorSummarysInfo: GetProbeableMonitorSummarysInfo = (
    probeMonitor: ProbeMonitor,
    key: number,
  ): ReactElement => {
    if (!probeMonitor) {
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
          probeMonitor={probeMonitor}
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
          probeMonitor={probeMonitor}
        />
      );
    }

    if (props.monitorType === MonitorType.SSLCertificate) {
      return (
        <SSLCertificateMonitorView
          key={key}
          probeMonitor={probeMonitor}
        />
      );
    }

    if (props.monitorType === MonitorType.SyntheticMonitor) {
      return (
        <SyntheticMonitorView
          key={key}
          probeMonitor={probeMonitor}
        />
      );
    }

    return <></>;
  };

  if (
    MonitorTypeHelper.isProbableMonitor(props.monitorType) &&
    (!props.probeMonitors || props.probeMonitors.length === 0)
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
      {props.probeMonitors &&
        props.probeMonitors.map(
          (probeMonitor: ProbeMonitor, index: number) => {
            return getProbableMonitorSummarysInfo(probeMonitor, index);
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
      props.serverMonitor ? (
        <ServerMonitorSummaryView
          serverMonitor={props.serverMonitor}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SummaryInfo;
