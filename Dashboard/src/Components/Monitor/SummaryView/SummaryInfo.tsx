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
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";
import TelemetryMonitorSummaryView from "./TelemetryMonitorView";
import TelemetryMonitorSummary from "./Types/TelemetryMonitorSummary";
import CustomCodeMonitorSummaryView from "./CustomCodeMonitorSummaryView";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import EvaluationLogList from "./EvaluationLogList";

export interface ComponentProps {
  monitorType: MonitorType;
  incomingRequestMonitorHeartbeatCheckedAt?: Date | undefined;
  probeMonitorResponses?: Array<ProbeMonitorResponse> | undefined; // this is an array because of multiple monitor steps.
  incomingMonitorRequest?: IncomingMonitorRequest | undefined;
  serverMonitorResponse?: ServerMonitorResponse | undefined;
  telemetryMonitorSummary?: TelemetryMonitorSummary | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
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
        <div key={key} className="space-y-6">
          <ErrorMessage
            message={
              "No summary available for the selected probe. Should be few minutes for summary to show up. "
            }
          />
        </div>
      );
    }

    let summaryComponent: ReactElement = <></>;

    if (
      props.monitorType === MonitorType.Website ||
      props.monitorType === MonitorType.API
    ) {
      summaryComponent = (
        <WebsiteMonitorSummaryView
          probeMonitorResponse={probeMonitorResponse}
        />
      );
    }

    if (
      props.monitorType === MonitorType.Ping ||
      props.monitorType === MonitorType.IP ||
      props.monitorType === MonitorType.Port
    ) {
      summaryComponent = (
        <PingMonitorView probeMonitorResponse={probeMonitorResponse} />
      );
    }

    if (props.monitorType === MonitorType.SSLCertificate) {
      summaryComponent = (
        <SSLCertificateMonitorView
          probeMonitorResponse={probeMonitorResponse}
        />
      );
    }

    if (props.monitorType === MonitorType.SyntheticMonitor) {
      summaryComponent = (
        <SyntheticMonitorView probeMonitorResponse={probeMonitorResponse} />
      );
    }

    if (props.monitorType === MonitorType.CustomJavaScriptCode) {
      summaryComponent = (
        <CustomCodeMonitorSummaryView
          probeMonitorResponse={probeMonitorResponse}
        />
      );
    }

    return (
      <div key={key} className="space-y-6">
        {summaryComponent}
        <EvaluationLogList
          evaluationSummary={probeMonitorResponse.evaluationSummary}
        />
      </div>
    );
  };

  const renderEvaluationLogs = (
    summary?: MonitorEvaluationSummary | undefined,
  ): ReactElement => {
    if (!summary) {
      return <></>;
    }

    return <EvaluationLogList evaluationSummary={summary} />;
  };

  if (
    MonitorTypeHelper.isProbableMonitor(props.monitorType) &&
    (!props.probeMonitorResponses || props.probeMonitorResponses.length === 0)
  ) {
    return (
      <ErrorMessage
        message={
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
        message={
          "No summary available. Looks like no incoming / inbound request was made."
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
        <div className="space-y-6">
          <IncomingRequestMonitorView
            incomingRequestMonitorHeartbeatCheckedAt={
              props.incomingRequestMonitorHeartbeatCheckedAt
            }
            incomingMonitorRequest={props.incomingMonitorRequest}
          />
          {renderEvaluationLogs(
            props.incomingMonitorRequest.evaluationSummary ||
              props.evaluationSummary,
          )}
        </div>
      ) : (
        <></>
      )}

      {props.monitorType === MonitorType.Server &&
      props.serverMonitorResponse ? (
        <div className="space-y-6">
          <ServerMonitorSummaryView
            serverMonitorResponse={props.serverMonitorResponse}
          />
          {renderEvaluationLogs(
            props.serverMonitorResponse.evaluationSummary ||
              props.evaluationSummary,
          )}
        </div>
      ) : (
        <></>
      )}

      {(props.monitorType === MonitorType.Logs ||
        props.monitorType === MonitorType.Traces ||
        props.monitorType === MonitorType.Metrics) && (
        <div className="space-y-6">
          <TelemetryMonitorSummaryView
            telemetryMonitorSummary={props.telemetryMonitorSummary}
          />
          {renderEvaluationLogs(props.evaluationSummary)}
        </div>
      )}
    </div>
  );
};

export default SummaryInfo;
