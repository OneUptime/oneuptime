import { AuditLogExportSettings } from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import { EgressGuardOptions } from "Common/Server/Utils/DataSource/EgressGuard";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "Common/Server/Utils/DataSource/HttpFetch";
import { AuditLogExportRecord } from "Common/Types/AuditLog/Export/AuditLogExportRecord";

/*
 * The contract every audit log destination implements. A destination is
 * stateless: every call gets the decrypted settings, so one instance serves
 * every export. The exporter and the test route only ever talk to this
 * interface; a new destination is a catalog entry and one class implementing
 * it (DestinationRegistry).
 */

/*
 * One batch of entries, in the order they were recorded. Its id is the
 * first entry's: the same entries read again after a restart make the same
 * batch, so a file destination writes the same object again (no duplicate
 * file) and a stream receives the same X-OneUptime-Batch-Id.
 */
export interface AuditLogExportBatch {
  id: string;
  records: Array<AuditLogExportRecord>;
  // When the first entry was recorded: where a file of the batch is filed.
  firstCreatedAt: Date;
  // A test from the form: written where it is easy to find and overwrite.
  isTest: boolean;
}

export interface AuditLogExportDelivery {
  // Decrypted, server-only. Never serialize it into a response or a log line.
  settings: AuditLogExportSettings;
  batch: AuditLogExportBatch;
  // The egress policy of the export's scope (an instance export may reach private addresses).
  egress: EgressGuardOptions;
}

// Where a delivery went, in words a person reads: "s3://bucket/key".
export interface AuditLogExportDeliveryReceipt {
  location: string;
}

/*
 * A delivery that did not happen. `retryable` says whether trying again
 * soon can help - a timeout, a 5xx, a rate limit - rather than a setting
 * someone has to change (a refused credential, a bucket that does not
 * exist). The message says what is wrong and what to change, and never
 * holds a secret.
 */
export class AuditLogExportDeliveryError extends Error {
  public readonly retryable: boolean;
  public readonly status: number | null;

  public constructor(
    message: string,
    options: { retryable: boolean; status?: number | null | undefined },
  ) {
    super(message);
    this.name = "AuditLogExportDeliveryError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}

export interface AuditLogExportDestination {
  deliver(
    delivery: AuditLogExportDelivery,
  ): Promise<AuditLogExportDeliveryReceipt>;
}

/*
 * How the HTTP destinations reach the outside: DataSourceHttpFetch in
 * production - the egress guard checks and pins the address, no redirect is
 * followed and the answer is capped - injectable so tests drive a faithful
 * fake of each service.
 */
export type AuditLogExportHttpTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;
