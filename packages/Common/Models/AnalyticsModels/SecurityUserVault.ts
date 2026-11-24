import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import ObjectID from "../../Types/ObjectID";
import { SECURITY_USER_VAULT_RETENTION_IN_DAYS } from "../../Types/SecurityEvent/SecurityUserVaultRetention";

/*
 * SECURITY EVENTS' USER VAULT (#10632).
 *
 * A project can hash user ids out of its logs and traces (a Hash scrub
 * rule: an Email rule, a Named Attributes rule on enduser.id, a custom
 * pattern) and still have Security Events act on the account a case is
 * about. Since #10435 a Hash token stays the event's user - per-account
 * rules still count per account - but no response can act on a token: no
 * identity provider knows "[HASHED:3f9a...]". The address vault (#10395)
 * solved the same problem for IP addresses; this is its twin for users.
 *
 * When a Hash rule hides a user where Security Events reads one - a span's
 * enduser.id or user.id, an AI call's user, a log line's user as Security
 * Events' log parsers read it, a cloud audit log's principal among them -
 * ingest writes the token the rule left (Server/Utils/Telemetry/
 * ScrubHashToken.ts, keyed per project) and the value behind it here, once
 * it has worked the token out of the value again, so nothing but what the
 * rule really hashed is ever kept. Security Events' scans look the tokens
 * of a page of events up, so the event names the user - and nobody reading
 * the logs or traces sees it.
 *
 * Only Security Events' scans read it, server side: no API, no route, no
 * explorer, no export, no Data Security scan, no AI tool. So the model has
 * no crudApiPath (BaseAnalyticsAPI refuses it), no MCP tools, no API
 * reference, no read permission for anyone, and is deliberately left out
 * of the AnalyticsModels registry (Models/AnalyticsModels/Index.ts) that
 * the API, MCP, CLI, OpenAPI and live-update generators read. Its service
 * is registered with AnalyticsServices only so boot creates the table, and
 * refuses every generic read (Server/Services/SecurityUserVaultService).
 * SecurityUserVaultGuard.test.ts fails if anything else names it.
 *
 * One row per project, token and user (a user only ever has one token in a
 * project, and two users share a 64-bit token only by chance - then both
 * are kept, and Security Events names neither). The rows of a token are
 * folded as they merge: the earliest firstSeenAt, the latest lastSeenAt.
 * Each day's rows are a partition of their own, dropped whole once every
 * row in it is 30 days past its lastSeenAt; a read never takes a row older
 * than that (SECURITY_USER_VAULT_RETENTION_IN_DAYS), so how far back a
 * later finding can still name a user is exactly 30 days, whatever the
 * merges have done.
 *
 * ERASURE: deleting a user's rows makes every one of their tokens
 * anonymous for good - the token is a keyed hash, and only this table can
 * name the user behind it. An erasure flow that reaches a person's user
 * ids or email addresses must delete their rows here too (ALTER TABLE ...
 * DELETE WHERE projectId = ... AND userValue = ...).
 */

/*
 * How long a user stays after they were last seen, and so how far back
 * they can be named: a number of its own file, which the record of
 * processing reads too (#10398).
 */
export { SECURITY_USER_VAULT_RETENTION_IN_DAYS };

// Nobody reads, writes or changes a row through the API: only ingest and the scans, as the server.
const NO_ONE: ColumnAccessControl = {
  read: [],
  create: [],
  update: [],
};

export default class SecurityUserVault extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description:
        "The project whose Hash rule made the token: tokens are keyed per project.",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: NO_ONE,
    });

    const tokenColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "token",
      title: "Token",
      description:
        'What the Hash rule left in place of the user: "[HASHED:" and 16 hex characters.',
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      accessControl: NO_ONE,
    });

    const userValueColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "userValue",
      title: "User",
      description:
        "The user the token stands for, exactly as the Hash rule hashed it: a user id, an email address, a cloud principal.",
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      accessControl: NO_ONE,
    });

    const firstSeenAtColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "firstSeenAt",
      title: "First Seen At",
      description:
        "When ingest first wrote the user, of the rows kept. SimpleAggregateFunction(min, DateTime), so merged rows keep the earliest.",
      required: true,
      type: TableColumnType.Date,
      simpleAggregateFunction: "min",
      accessControl: NO_ONE,
    });

    const lastSeenAtColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "lastSeenAt",
      title: "Last Seen At",
      description:
        "When ingest last wrote the user. SimpleAggregateFunction(max, DateTime), so merged rows keep the latest; the row is dropped 30 days after it.",
      required: true,
      type: TableColumnType.Date,
      simpleAggregateFunction: "max",
      accessControl: NO_ONE,
    });

    super({
      tableName: AnalyticsTableName.SecurityUserVault,
      /*
       * Rows of one (projectId, token, userValue) fold as they merge, the
       * way a ReplacingMergeTree collapses them, but keeping the earliest
       * firstSeenAt and the latest lastSeenAt rather than one write's pair.
       */
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Security User Vault Entry",
      pluralName: "Security User Vault Entries",
      // No crudApiPath, no MCP, no documentation: no way in but the server's.
      enableMCP: false,
      enableDocumentation: false,
      accessControl: {
        read: [],
        create: [],
        update: [],
        delete: [],
      },
      tableDescription:
        "The user behind each token a Hash scrub rule left where Security Events reads a user in logs and traces, kept 30 days after it was last seen. Read only by Security Events' scans.",
      tableColumns: [
        projectIdColumn,
        tokenColumn,
        userValueColumn,
        firstSeenAtColumn,
        lastSeenAtColumn,
      ],
      projections: [],
      /*
       * A lookup names the project and the page's tokens: both lead the key.
       * The user follows them only to keep two users that share a token
       * apart; the primary index needs no more than the token.
       */
      sortKeys: ["projectId", "token", "userValue"],
      primaryKeys: ["projectId", "token"],
      // A day's rows expire together, so a whole partition is dropped, never rewritten.
      partitionKey: "toYYYYMMDD(lastSeenAt)",
      tableSettings: "ttl_only_drop_parts = 1",
      ttlExpression: `lastSeenAt + INTERVAL ${SECURITY_USER_VAULT_RETENTION_IN_DAYS} DAY DELETE`,
      includeBaseColumns: false,
      defaultSortColumn: "lastSeenAt",
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get token(): string | undefined {
    return this.getColumnValue("token") as string | undefined;
  }

  public set token(v: string | undefined) {
    this.setColumnValue("token", v);
  }

  public get userValue(): string | undefined {
    return this.getColumnValue("userValue") as string | undefined;
  }

  public set userValue(v: string | undefined) {
    this.setColumnValue("userValue", v);
  }

  public get firstSeenAt(): Date | undefined {
    return this.getColumnValue("firstSeenAt") as Date | undefined;
  }

  public set firstSeenAt(v: Date | undefined) {
    this.setColumnValue("firstSeenAt", v);
  }

  public get lastSeenAt(): Date | undefined {
    return this.getColumnValue("lastSeenAt") as Date | undefined;
  }

  public set lastSeenAt(v: Date | undefined) {
    this.setColumnValue("lastSeenAt", v);
  }
}
