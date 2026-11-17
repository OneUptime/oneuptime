import HTTPMethod from "../../API/HTTPMethod";
import Dictionary from "../../Dictionary";
import { JSONObject } from "../../JSON";
import ObjectID from "../../ObjectID";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";
import WebhookVerificationProvider from "./WebhookVerificationProvider";

export default interface IncomingMonitorRequest {
  projectId: ObjectID;
  monitorId: ObjectID;
  requestHeaders?: Dictionary<string> | undefined;
  requestBody?: string | JSONObject | undefined;
  requestMethod?: HTTPMethod | undefined;
  incomingRequestReceivedAt: Date;
  onlyCheckForIncomingRequestReceivedAt?: boolean | undefined;
  checkedAt: Date;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
  receivedViaProbeId?: ObjectID | undefined;
  /*
   * Set on the copy people read (Monitor.incomingMonitorRequest) when the
   * monitor keeps no request content: its headers and body were left out,
   * not empty (MonitorRecordEvidence.toStoredLatestRequest).
   */
  isResponseContentOmitted?: boolean | undefined;
  /*
   * The service this request was the verification handshake of, when
   * OneUptime answered it as one on the monitor's own URL
   * (Server/Utils/WebhookVerification, issue #8429): the service was told
   * the URL takes its deliveries, so nothing is left to confirm by hand.
   * Unset for any other request, and for one a probe relayed: the probe
   * answers its sender itself.
   */
  answeredVerification?: WebhookVerificationProvider | undefined;
}
