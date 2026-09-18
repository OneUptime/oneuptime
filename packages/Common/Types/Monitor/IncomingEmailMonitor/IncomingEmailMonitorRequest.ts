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
  emailReceivedAt: Date;
  checkedAt: Date;
  attachments?: Array<EmailAttachment> | undefined;
  onlyCheckForIncomingEmailReceivedAt?: boolean | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
