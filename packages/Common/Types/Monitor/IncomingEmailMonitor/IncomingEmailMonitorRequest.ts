import Dictionary from "../../Dictionary";
import ObjectID from "../../ObjectID";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";

export interface EmailAttachment {
  filename: string;
  contentType: string;
  size: number;
}

export default interface IncomingEmailMonitorRequest {
  projectId: ObjectID;
  monitorId: ObjectID;
  emailFrom: string;
  emailTo: string;
  emailSubject: string;
  emailBody: string;
  emailBodyHtml?: string | undefined;
  emailHeaders?: Dictionary<string> | undefined;
  // When the email was evaluated: what the heartbeat check counts from.
  emailReceivedAt: Date;
  checkedAt: Date;
  /*
   * When OneUptime's inbound email webhook received the email, before the
   * queue it waited in: a page its evaluation starts is timed from then
   * (OnCallPageTiming).
   */
  dataReceivedAt?: Date | undefined;
  attachments?: Array<EmailAttachment> | undefined;
  onlyCheckForIncomingEmailReceivedAt?: boolean | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
