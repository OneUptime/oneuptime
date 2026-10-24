import { createHmac } from "crypto";
import AuditLogExportSettingsUtil, {
  AuditLogExportSettings,
} from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import { DestinationAnswer } from "Common/Server/Utils/SecurityEvent/Destinations/BatchSender";
import {
  AUDIT_LOG_EXPORT_DEFAULT_WEBHOOK_HEADER,
  AuditLogExportWebhookBodyFormat,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import {
  AuditLogExportRecord,
  serializeAuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import Dictionary from "Common/Types/Dictionary";
import { toNdjson } from "../AuditLogExportFiles";
import {
  defaultAuditLogExportHttpTransport,
  describeAnswer,
  sendDestinationRequest,
  toDeliveryError,
} from "./DestinationHttp";
import {
  AuditLogExportDelivery,
  AuditLogExportDeliveryError,
  AuditLogExportDeliveryReceipt,
  AuditLogExportDestination,
  AuditLogExportHttpTransport,
} from "./Types";

/*
 * A webhook: each batch POSTed to an address of the export's choosing - a
 * log shipper (Vector, Fluent Bit, Logstash), a SIEM's HTTP intake (Splunk's
 * HTTP Event Collector, Datadog, Sumo Logic), or a service of the export's
 * own - as a JSON array of entries or as NDJSON, one entry per line.
 *
 * Every request carries:
 *
 *   X-OneUptime-Event: audit-log-export
 *   X-OneUptime-Batch-Id: <the batch's first entry id>  the same batch read
 *                         again (a restart, a retry) carries the same id, so
 *                         the endpoint can drop a repeat; every entry also
 *                         carries its own id
 *   X-OneUptime-Entry-Count: <entries in the body>
 *   X-OneUptime-Signature: sha256=<HMAC-SHA256 of the body, hex>  with a
 *                         signing secret, as OneUptime's other webhooks sign
 *   <Header name>: <Credential>  when a credential is set
 *
 * Any 2xx answer is a delivery. A 413 (too large) splits the batch in two
 * and sends each half, down to one entry; every other refusal stops the
 * batch, to be sent again from its first entry.
 */

export const AUDIT_LOG_EXPORT_WEBHOOK_EVENT: string = "audit-log-export";

const SERVICE_TITLE: string = "The webhook endpoint";

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

// The body of one request, in the export's format.
export function toWebhookBody(data: {
  records: Array<AuditLogExportRecord>;
  format: string;
}): { body: string; contentType: string } {
  if (data.format === AuditLogExportWebhookBodyFormat.NdJson) {
    return {
      body: toNdjson(data.records),
      contentType: "application/x-ndjson",
    };
  }

  return {
    body: `[${data.records
      .map((record: AuditLogExportRecord): string => {
        return serializeAuditLogExportRecord(record);
      })
      .join(",")}]`,
    contentType: "application/json",
  };
}

export function describeWebhookFailure(answer: DestinationAnswer): string {
  const status: number = answer.status;
  const detail: string = describeAnswer(answer);
  const said: string = detail ? ` It said: ${detail}` : "";

  if (status >= 300 && status < 400) {
    return `${SERVICE_TITLE} redirected to another address (HTTP ${status}), and redirects are not followed. Set the URL to the address it redirects to.`;
  }

  if (status === 401 || status === 403) {
    return `${SERVICE_TITLE} refused the credential (HTTP ${status}). Check the Credential, and the Header name it is sent in.${said}`;
  }

  if (status === 404) {
    return `Nothing answers at this URL (HTTP 404). Check the URL.${said}`;
  }

  if (status === 405) {
    return `${SERVICE_TITLE} does not take POST requests at this URL (HTTP 405). Check the URL.`;
  }

  if (status === 413) {
    return `${SERVICE_TITLE} refused even one entry as too large (HTTP 413). Raise its limit on the size of a request.`;
  }

  if (status === 400 || status === 415 || status === 422) {
    return `${SERVICE_TITLE} refused the body (HTTP ${status}). Check that it takes the Body format this export sends.${said}`;
  }

  if (status === 408 || status === 429 || status >= 500) {
    return `${SERVICE_TITLE} is busy or failing (HTTP ${status}). It is retried automatically.${said}`;
  }

  return `${SERVICE_TITLE} did not accept the audit log entries (HTTP ${status}).${said}`;
}

export default class WebhookDestination implements AuditLogExportDestination {
  private readonly transport: AuditLogExportHttpTransport;

  public constructor(
    options: { transport?: AuditLogExportHttpTransport | undefined } = {},
  ) {
    this.transport = options.transport || defaultAuditLogExportHttpTransport;
  }

  public async deliver(
    delivery: AuditLogExportDelivery,
  ): Promise<AuditLogExportDeliveryReceipt> {
    const settings: AuditLogExportSettings = delivery.settings;
    const url: string = AuditLogExportSettingsUtil.readConfigText(
      settings,
      "url",
    );

    await this.post({
      delivery,
      records: delivery.batch.records,
      batchId: delivery.batch.id,
    });

    return { location: url };
  }

  private async post(data: {
    delivery: AuditLogExportDelivery;
    records: Array<AuditLogExportRecord>;
    batchId: string;
  }): Promise<void> {
    const settings: AuditLogExportSettings = data.delivery.settings;
    const read: (key: string) => string = (key: string): string => {
      return AuditLogExportSettingsUtil.readConfigText(settings, key);
    };

    const credential: string = AuditLogExportSettingsUtil.readSecretText(
      settings,
      "headerValue",
    );
    const signingSecret: string = AuditLogExportSettingsUtil.readSecretText(
      settings,
      "signingSecret",
    );
    const secretValues: Array<string> = [credential, signingSecret].filter(
      (value: string): boolean => {
        return value.length > 0;
      },
    );

    const { body, contentType } = toWebhookBody({
      records: data.records,
      format: read("bodyFormat"),
    });

    const headers: Dictionary<string> = {
      "Content-Type": contentType,
      "X-OneUptime-Event": AUDIT_LOG_EXPORT_WEBHOOK_EVENT,
      "X-OneUptime-Batch-Id": data.batchId,
      "X-OneUptime-Entry-Count": String(data.records.length),
    };

    if (credential) {
      headers[read("headerName") || AUDIT_LOG_EXPORT_DEFAULT_WEBHOOK_HEADER] =
        credential;
    }

    if (signingSecret) {
      headers["X-OneUptime-Signature"] = signWebhookBody(signingSecret, body);
    }

    const answer: DestinationAnswer = await sendDestinationRequest({
      transport: this.transport,
      request: {
        method: "POST",
        url: read("url"),
        headers,
        body,
        egressOptions: data.delivery.egress,
      },
      serviceTitle: "the webhook endpoint",
      secretValues,
      unreachableHint: "Check the URL.",
    });

    if (answer.ok) {
      return;
    }

    if (answer.status === 413 && data.records.length > 1) {
      const middle: number = Math.ceil(data.records.length / 2);

      await this.post({
        delivery: data.delivery,
        records: data.records.slice(0, middle),
        batchId: `${data.batchId}-1`,
      });
      await this.post({
        delivery: data.delivery,
        records: data.records.slice(middle),
        batchId: `${data.batchId}-2`,
      });
      return;
    }

    const error: AuditLogExportDeliveryError = toDeliveryError({
      answer,
      message: describeWebhookFailure(answer),
      secretValues,
    });

    throw error;
  }
}
