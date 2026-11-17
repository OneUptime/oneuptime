import DataMigrationBase from "./DataMigrationBase";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import WebhookLogService from "Common/Server/Services/WebhookLogService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import { getSendingWebhookMessage } from "Common/Server/Utils/OnCall/OnCallNotificationStatus";
import WebhookAddressMask from "Common/Utils/WebhookAddressMask";
import EncryptColumnInPlace, {
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

type StoredRow = Record<string, unknown>;

/*
 * Masks the webhook addresses the notification logs kept before a log kept
 * a webhook by its scheme and host alone (#9013). A webhook's address is its
 * credential - a Slack, Microsoft Teams or Discord incoming webhook carries
 * its secret in its path - and the logs are read by everyone who reads the
 * project's notification logs, while the webhook itself keeps its address
 * encrypted and read by its owner alone:
 *
 *   - WebhookLog.webhookUrl: each address becomes its scheme, host and port,
 *     "https://hooks.slack.com/•••" (WebhookAddressMask), and an error its
 *     status message quotes the address in masks it the same way. A page of
 *     rows at a time, in one statement, each row held to the values read.
 *   - UserOnCallLogTimeline.statusMessage: "Sending webhook to <address>.",
 *     which a page's webhook notification said while it was sent - and kept,
 *     where the send never answered - reads "Sending webhook.", as a page
 *     sends it now with the webhook's name.
 *
 * Idempotent, and safe to run twice at once: a masked address masks to
 * itself, and a row changed meanwhile is left as its write left it. A
 * failure costs the rest nothing, and no log line carries an address.
 *
 * Harmless to a server of the release before while the upgrade rolls out:
 * it only shows these logs (the webhook log's View Request, View Response
 * and View Status Message), and sends nothing from them. What it logs
 * meanwhile is masked a day later (maskLogs, CredentialsAtRest).
 */
export default class MaskWebhookAddressesInLogs extends DataMigrationBase {
  // Rows read, and written in one statement, per page.
  public static readonly PAGE_SIZE: number = 500;

  /*
   * A page's webhook line that names an address - a webhook's name now
   * stands where it stood (getSendingWebhookMessage) - as a Postgres regular
   * expression.
   */
  public static readonly SENDING_LINE_WITH_ADDRESS: string =
    "^Sending webhook to https?://";

  public constructor() {
    super("MaskWebhookAddressesInLogs");
  }

  public override async migrate(): Promise<void> {
    await this.maskLogs({});
  }

  /*
   * Masks the logs, all of them or (`since`) the rows written or changed
   * since then, and resolves whether every page was read and written.
   *
   * The upgrade masks them all. A server of the release before, still
   * running while the upgrade rolls out, goes on logging addresses whole
   * (#9266), so a day later - once none can still be running - the
   * CredentialsAtRest:EncryptInPlace job masks the rows logged since again
   * (CredentialsAtRest). Handed a deadline, it stops between pages once the
   * deadline has passed, and resolves false: the next run goes on.
   */
  public async maskLogs(options: {
    since?: Date | undefined;
    deadline?: JobDeadline | undefined;
  }): Promise<boolean> {
    const isEveryLogMasked: boolean = await this.maskWebhookLogs(options);
    const isEveryLineMasked: boolean = await this.maskSendingLines(options);

    return isEveryLogMasked && isEveryLineMasked;
  }

  // The WHERE of a statement over the rows written or changed since `since`.
  private static sinceCondition(parameterIndex: number): string {
    return `("createdAt" >= $${parameterIndex} OR "updatedAt" >= $${parameterIndex})`;
  }

  private async maskWebhookLogs(options: {
    since?: Date | undefined;
    deadline?: JobDeadline | undefined;
  }): Promise<boolean> {
    const repository: ModelRepository =
      WebhookLogService.getRepository() as unknown as ModelRepository;

    let afterId: string | null = null;
    let isEveryRowMasked: boolean = true;

    for (;;) {
      if (options.deadline?.hasPassed()) {
        return false;
      }

      const conditions: Array<string> = [`"webhookUrl" IS NOT NULL`];
      const parameters: Array<unknown> = [];

      if (options.since) {
        parameters.push(options.since);
        conditions.push(
          MaskWebhookAddressesInLogs.sinceCondition(parameters.length),
        );
      }

      if (afterId !== null) {
        parameters.push(afterId);
        conditions.push(`"_id" > $${parameters.length}`);
      }

      let rows: Array<StoredRow> = [];

      try {
        rows = (await repository.manager.query(
          `SELECT "_id", "webhookUrl", "statusMessage" FROM "WebhookLog" WHERE ${conditions.join(
            " AND ",
          )} ORDER BY "_id" ASC LIMIT ${MaskWebhookAddressesInLogs.PAGE_SIZE}`,
          parameters,
        )) as Array<StoredRow>;
      } catch (err) {
        logger.error(
          `${this.name}: failed to read the webhook logs to mask: ${EncryptColumnInPlace.describeError(err)}`,
        );
        return false;
      }

      const masked: Array<MaskedLogRow> = rows
        .map((row: StoredRow): MaskedLogRow | null => {
          return MaskWebhookAddressesInLogs.maskRow(row);
        })
        .filter((row: MaskedLogRow | null): row is MaskedLogRow => {
          return row !== null;
        });

      if (masked.length > 0) {
        try {
          await repository.manager.query(
            `UPDATE "WebhookLog" AS "log" SET "webhookUrl" = "masked"."webhookUrl", "statusMessage" = "masked"."statusMessage" FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[]) AS "masked"("id", "webhookUrl", "statusMessage", "wasWebhookUrl", "wasStatusMessage") WHERE "log"."_id" = "masked"."id" AND "log"."webhookUrl" = "masked"."wasWebhookUrl" AND "log"."statusMessage" IS NOT DISTINCT FROM "masked"."wasStatusMessage"`,
            [
              masked.map((row: MaskedLogRow): string => {
                return row.id;
              }),
              masked.map((row: MaskedLogRow): string => {
                return row.webhookUrl;
              }),
              masked.map((row: MaskedLogRow): string | null => {
                return row.statusMessage;
              }),
              masked.map((row: MaskedLogRow): string => {
                return row.wasWebhookUrl;
              }),
              masked.map((row: MaskedLogRow): string | null => {
                return row.wasStatusMessage;
              }),
            ],
          );
        } catch (err) {
          // This page stays as it was; the next ones are masked still.
          isEveryRowMasked = false;
          logger.error(
            `${this.name}: failed to mask ${masked.length} webhook log(s) after ${afterId || "the first"}: ${EncryptColumnInPlace.describeError(
              err,
              masked.map((row: MaskedLogRow): string => {
                return row.wasWebhookUrl;
              }),
            )}`,
          );
        }
      }

      if (rows.length < MaskWebhookAddressesInLogs.PAGE_SIZE) {
        return isEveryRowMasked;
      }

      const lastId: string = String(rows[rows.length - 1]!["_id"]);

      // A page that does not move on would be read again for ever.
      if (lastId === afterId) {
        return isEveryRowMasked;
      }

      afterId = lastId;
    }
  }

  /*
   * A log row as it is to be written, masked, or null when it is masked
   * already.
   */
  public static maskRow(row: StoredRow): MaskedLogRow | null {
    const webhookUrl: unknown = row["webhookUrl"];

    if (typeof webhookUrl !== "string" || !webhookUrl) {
      return null;
    }

    const statusMessage: string | null =
      typeof row["statusMessage"] === "string" ? row["statusMessage"] : null;

    const maskedUrl: string = WebhookAddressMask.mask(webhookUrl);
    const maskedMessage: string | null =
      statusMessage === null
        ? null
        : WebhookAddressMask.maskIn(statusMessage, webhookUrl);

    if (maskedUrl === webhookUrl && maskedMessage === statusMessage) {
      return null;
    }

    return {
      id: String(row["_id"]),
      webhookUrl: maskedUrl,
      statusMessage: maskedMessage,
      wasWebhookUrl: webhookUrl,
      wasStatusMessage: statusMessage,
    };
  }

  private async maskSendingLines(options: {
    since?: Date | undefined;
    deadline?: JobDeadline | undefined;
  }): Promise<boolean> {
    if (options.deadline?.hasPassed()) {
      return false;
    }

    const repository: ModelRepository =
      UserOnCallLogTimelineService.getRepository() as unknown as ModelRepository;

    const parameters: Array<unknown> = [
      getSendingWebhookMessage(null),
      MaskWebhookAddressesInLogs.SENDING_LINE_WITH_ADDRESS,
    ];

    let since: string = "";

    if (options.since) {
      parameters.push(options.since);
      since = ` AND ${MaskWebhookAddressesInLogs.sinceCondition(parameters.length)}`;
    }

    try {
      await repository.manager.query(
        `UPDATE "UserOnCallLogTimeline" SET "statusMessage" = $1 WHERE "statusMessage" ~ $2${since}`,
        parameters,
      );

      return true;
    } catch (err) {
      logger.error(
        `${this.name}: failed to mask the on-call logs' webhook addresses: ${EncryptColumnInPlace.describeError(err)}`,
      );

      return false;
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}

export interface MaskedLogRow {
  id: string;
  webhookUrl: string;
  statusMessage: string | null;
  wasWebhookUrl: string;
  wasStatusMessage: string | null;
}
