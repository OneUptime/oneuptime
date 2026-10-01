import { IncomingEmailJobData } from "./Queue/TelemetryQueueService";
import { WorkflowHostname } from "Common/Server/EnvironmentConfig";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import logger from "Common/Server/Utils/Logger";
import { WorkflowRoute } from "Common/ServiceRoute";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import APIException from "Common/Types/Exception/ApiException";
import { JSONObject } from "Common/Types/JSON";
import IncomingEmailTrigger, {
  INCOMING_EMAIL_TRIGGER_DELIVERY_PATH,
  IncomingEmailTriggerDeliveryStatus,
  IncomingEmailTriggerEmail,
} from "Common/Types/Workflow/IncomingEmailTrigger";
import API from "Common/Utils/API";
import EmailAddressList from "Common/Utils/Email/EmailAddressList";

/*
 * Hands one queued email to the workflow service, for the workflow whose
 * Incoming Email trigger owns the address it was sent to.
 *
 * The trigger lives with the other workflow triggers
 * (Common/Server/Types/Workflow/Components/IncomingEmail.ts) and starts the
 * run through the workflow service's own queue, the way a database event
 * reaches its On Create trigger (DatabaseService.onTriggerWorkflow): an
 * internal POST, authenticated with the cluster key.
 *
 * A refused delivery throws, so the queue retries the job. Mail the trigger
 * declines - an address nothing has any more, a workflow that is off - is
 * not a failure, and is only logged.
 */
export default class IncomingEmailWorkflowDelivery {
  public static getDeliveryUrl(): URL {
    return new URL(
      Protocol.HTTP,
      WorkflowHostname,
      new Route(
        `${WorkflowRoute.toString()}${INCOMING_EMAIL_TRIGGER_DELIVERY_PATH}`,
      ),
    );
  }

  /*
   * The email as the trigger takes it. Jobs queued before workflows received
   * email carry no address lists, so To falls back to the one address the
   * monitor path has always read. The bodies are cut to what a run is handed
   * here already: an email's parts can be far larger than the workflow
   * service accepts in one request, and the trigger would cut them anyway.
   */
  public static getEmail(data: {
    emailData: IncomingEmailJobData;
    receivedAt: Date | string | null | undefined;
  }): IncomingEmailTriggerEmail {
    const emailData: IncomingEmailJobData = data.emailData;

    const to: Array<string> =
      emailData.emailToAddresses && emailData.emailToAddresses.length > 0
        ? EmailAddressList.merge(emailData.emailToAddresses)
        : EmailAddressList.parse(emailData.emailTo);

    const receivedAt: Date =
      data.receivedAt && !isNaN(new Date(data.receivedAt).getTime())
        ? new Date(data.receivedAt)
        : OneUptimeDate.getCurrentDate();

    return {
      from: emailData.emailFrom || "",
      to: to,
      cc: EmailAddressList.merge(emailData.emailCcAddresses),
      subject: emailData.emailSubject || "",
      body: IncomingEmailTrigger.truncateBody(emailData.emailBody || ""),
      htmlBody:
        emailData.emailBodyHtml === undefined
          ? undefined
          : IncomingEmailTrigger.truncateBody(emailData.emailBodyHtml),
      headers: emailData.emailHeaders,
      attachments: emailData.attachments,
      receivedAt: OneUptimeDate.toString(receivedAt),
    };
  }

  public static async deliver(data: {
    emailData: IncomingEmailJobData;
    receivedAt: Date | string | null | undefined;
  }): Promise<IncomingEmailTriggerDeliveryStatus> {
    const secretKey: string | undefined = data.emailData.workflowSecretKey;

    if (!secretKey) {
      throw new APIException(
        "This incoming email is not addressed to a workflow.",
      );
    }

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: this.getDeliveryUrl(),
        data: {
          secretKey: secretKey,
          email: this.getEmail(data) as unknown as JSONObject,
        },
        headers: {
          ...ClusterKeyAuthorization.getClusterKeyHeaders(),
        },
      });

    if (result instanceof HTTPErrorResponse) {
      throw new APIException(
        `The workflow service did not take an incoming email: ${result.message || "unknown error"}`,
      );
    }

    const status: IncomingEmailTriggerDeliveryStatus =
      ((result.data as JSONObject | undefined)?.[
        "status"
      ] as IncomingEmailTriggerDeliveryStatus) ||
      IncomingEmailTriggerDeliveryStatus.Scheduled;

    // The address is the workflow's credential, so it is never logged.
    logger.debug(`Incoming email for a workflow: ${status}`);

    return status;
  }
}
