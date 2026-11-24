import { ResponseJSON } from "@clickhouse/client";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, {
  MigrationExecuteOptions,
  Results,
} from "./AnalyticsDatabaseService";
import SecurityUserVault, {
  SECURITY_USER_VAULT_RETENTION_IN_DAYS,
} from "../../Models/AnalyticsModels/SecurityUserVault";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { SCRUB_HASH_TOKEN_PATTERN } from "../../Types/Telemetry/ScrubHashTokenFormat";
import { getScrubPlaceholderKind } from "../../Types/Telemetry/ScrubRule";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import {
  getStorageTableName,
  onClusterClause,
} from "../Utils/AnalyticsDatabase/ClusterConfig";

/*
 * THE USER VAULT'S TABLE (Models/AnalyticsModels/SecurityUserVault,
 * #10632): what ingest writes, and the one read Security Events' scans
 * make. The address vault's twin (SecurityAddressVaultService), for users.
 *
 * Two ways in, and only two, and one way out:
 *
 *   - toRows: the rows ingest's writer hands the telemetry fan-in writer
 *     (Utils/SecurityEvent/UserVault/SecurityUserVaultWriter.ts);
 *   - findUsersOfTokens: the users behind a page's tokens, in one query a
 *     page, for the scans' lookup
 *     (Utils/SecurityEvent/UserVault/SecurityUserVaultLookup.ts);
 *   - and an erasure (#10908): the rows of a person's tokens, counted,
 *     read for who they name, and deleted
 *     (Utils/SecurityEvent/UserVault/SecurityUserErasure.ts). Every one of
 *     its statements names the project and the tokens, never the person:
 *     ClickHouse keeps a mutation's command (system.mutations, Keeper) and
 *     a query's text (system.query_log) long after they ran, and an erasure
 *     must not leave the person it erases there.
 *
 * Every generic read an AnalyticsDatabaseService has - find, count,
 * aggregate, exists - is refused, as the server too: the service sits in
 * AnalyticsServices so boot creates its table, and nothing that walks that
 * list may read the vault through it.
 */

/*
 * The most tokens one query names: both users - who acted and who was
 * acted on - of every line of a page of the log scan (LOG_SCAN_PAGE_SIZE,
 * a thousand lines), so a page is one query.
 */
export const MAX_TOKENS_PER_USER_VAULT_LOOKUP: number = 2000;

/*
 * The longest user the vault keeps: a user id, an email address or a cloud
 * principal is far shorter. A longer value is no account to act on, and is
 * never written - its event says a scrub rule hid it.
 */
export const MAX_USER_VAULT_USER_LENGTH: number = 512;

// How long the lookup may take: a point read by key, which a scan waits for.
export const USER_VAULT_LOOKUP_TIME_LIMIT_IN_SECONDS: number = 10;

// What every refused read says.
export const SECURITY_USER_VAULT_REFUSAL: string =
  "The user vault is read by Security Events' scans only.";

// A token and the user behind it, as a Hash rule of the project made them.
export interface SecurityUserVaultEntry {
  token: string;
  // Exactly as the rule hashed it.
  user: string;
}

type VaultService = AnalyticsDatabaseService<SecurityUserVault>;

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/*
 * Whether a value can be the user behind a token: some text, not too long,
 * holding nothing a scrub rule leaves - a token never stands for
 * "[REDACTED]", a mask or another token.
 */
export function isUserVaultUser(user: string): boolean {
  return (
    typeof user === "string" &&
    user.trim().length > 0 &&
    user.length <= MAX_USER_VAULT_USER_LENGTH &&
    getScrubPlaceholderKind(user) === null
  );
}

export class SecurityUserVaultService extends AnalyticsDatabaseService<SecurityUserVault> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: SecurityUserVault, database: clickhouseDatabase });
  }

  /*
   * The rows one write of a project's entries is, all seen at `seenAt`: an
   * entry that is no token a Hash rule makes, or no user (isUserVaultUser),
   * is no row. Each row is first and last seen when it is written; merges
   * keep the earliest and the latest of a token's rows.
   */
  public static toRows(data: {
    projectId: ObjectID;
    entries: ReadonlyArray<SecurityUserVaultEntry>;
    seenAt: Date;
  }): Array<JSONObject> {
    const projectId: string = data.projectId.toString();
    const seenAt: string = OneUptimeDate.toClickhouseDateTime(data.seenAt);
    const rows: Array<JSONObject> = [];

    for (const entry of data.entries) {
      if (
        !SCRUB_HASH_TOKEN_PATTERN.test(entry.token) ||
        !isUserVaultUser(entry.user)
      ) {
        continue;
      }

      rows.push({
        projectId: projectId,
        token: entry.token,
        userValue: entry.user,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      });
    }

    return rows;
  }

  /*
   * The oldest a row may have been last seen and still name its user:
   * exactly the vault's 30 days, whether or not the day it was written in
   * has been dropped yet. A length of time, as the table's TTL counts it,
   * never the server's own calendar: 30 x 24 hours in every zone, across a
   * clock change too (#8236).
   */
  public static getOldestNameableTime(now: Date): Date {
    return OneUptimeDate.addRemoveDurationInDays(
      now,
      -SECURITY_USER_VAULT_RETENTION_IN_DAYS,
    );
  }

  // One lookup's statement: each token's users, two at most.
  public toFindUsersStatement(data: {
    projectId: ObjectID;
    tokens: Array<string>;
    seenAfter: Date;
  }): Statement {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    /*
     * groupUniqArray(2): a token with one user names them; one with two (a
     * 64-bit collision, by chance) names neither. The alias spells no
     * column the statement reads (ClickhouseAliasShadowGuard).
     */
    const statement: Statement = SQL`SELECT token, groupUniqArray(2)(userValue) AS vaultUsers FROM `;
    statement.append(`${databaseName}.${this.model.tableName}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND token IN (${{
        type: TableColumnType.Text,
        value: new Includes(data.tokens),
      }}) AND lastSeenAt >= ${{
        type: TableColumnType.Date,
        value: data.seenAfter,
      }} GROUP BY token`,
    );
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: USER_VAULT_LOOKUP_TIME_LIMIT_IN_SECONDS,
        timeoutOverflowMode: "throw",
      }),
    );

    return statement;
  }

  /*
   * The user behind each of a project's tokens that the vault holds, seen
   * in the last 30 days: one query for up to
   * MAX_TOKENS_PER_USER_VAULT_LOOKUP tokens. A token that is no token a
   * Hash rule makes today is never asked about; a token with two users, or
   * a value that is no user (isUserVaultUser), is left out.
   */
  public async findUsersOfTokens(data: {
    projectId: ObjectID;
    tokens: ReadonlyArray<string>;
    now?: Date | undefined;
  }): Promise<Map<string, string>> {
    const users: Map<string, string> = new Map<string, string>();
    const tokens: Array<string> = Array.from(
      new Set<string>(
        data.tokens.filter((token: string): boolean => {
          return SCRUB_HASH_TOKEN_PATTERN.test(token);
        }),
      ),
    );

    if (tokens.length === 0) {
      return users;
    }

    const seenAfter: Date = SecurityUserVaultService.getOldestNameableTime(
      data.now || OneUptimeDate.getCurrentDate(),
    );

    for (
      let start: number = 0;
      start < tokens.length;
      start += MAX_TOKENS_PER_USER_VAULT_LOOKUP
    ) {
      const result: Results = await this.executeQuery(
        this.toFindUsersStatement({
          projectId: data.projectId,
          tokens: tokens.slice(start, start + MAX_TOKENS_PER_USER_VAULT_LOOKUP),
          seenAfter,
        }),
      );
      const response: ResponseJSON<JSONObject> =
        await result.json<JSONObject>();

      for (const row of (response.data || []) as Array<JSONObject>) {
        const token: string = readText(row["token"]);
        const found: JSONValue | undefined = row["vaultUsers"];
        const candidates: Array<string> = Array.isArray(found)
          ? found.map((value: JSONValue): string => {
              return readText(value);
            })
          : [];

        if (
          tokens.includes(token) &&
          candidates.length === 1 &&
          isUserVaultUser(candidates[0]!)
        ) {
          users.set(token, candidates[0]!);
        }
      }
    }

    return users;
  }

  /*
   * ---------------------------------------------------------------------
   * An erasure (#10908): a person's rows, by their tokens, whatever their
   * age. Each statement names the project and the tokens only.
   * ---------------------------------------------------------------------
   */

  // The tokens a statement names: today's form only, each once.
  private static erasableTokens(tokens: ReadonlyArray<string>): Array<string> {
    return Array.from(
      new Set<string>(
        tokens.filter((token: string): boolean => {
          return SCRUB_HASH_TOKEN_PATTERN.test(token);
        }),
      ),
    );
  }

  private qualifiedTableName(tableName: string): string {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    return `${this.database.getDatasourceOptions().database!}.${tableName}`;
  }

  // The rows of a project's tokens, at any age, through the Distributed table.
  public toFindEntriesOfTokensStatement(data: {
    projectId: ObjectID;
    tokens: Array<string>;
  }): Statement {
    const statement: Statement = SQL`SELECT token, userValue FROM `;
    statement.append(this.qualifiedTableName(this.model.tableName));
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND token IN (${{
        type: TableColumnType.Text,
        value: new Includes(data.tokens),
      }}) GROUP BY token, userValue ORDER BY token, userValue`,
    );

    return statement;
  }

  /*
   * Who a project's tokens name, at any age: what an erasure takes the
   * person out of Postgres by. A token with two users (a collision) gives
   * both. Read through the migration pool, as the erasure's every
   * statement is: none of it sits on a request's path.
   */
  public async findEntriesOfTokens(data: {
    projectId: ObjectID;
    tokens: ReadonlyArray<string>;
  }): Promise<Array<SecurityUserVaultEntry>> {
    const tokens: Array<string> = SecurityUserVaultService.erasableTokens(
      data.tokens,
    );

    if (tokens.length === 0) {
      return [];
    }

    const result: Results = await this.executeQuery(
      this.toFindEntriesOfTokensStatement({
        projectId: data.projectId,
        tokens,
      }),
      MigrationExecuteOptions,
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

    return ((response.data || []) as Array<JSONObject>)
      .map((row: JSONObject): SecurityUserVaultEntry => {
        return {
          token: readText(row["token"]),
          user: readText(row["userValue"]),
        };
      })
      .filter((entry: SecurityUserVaultEntry): boolean => {
        return tokens.includes(entry.token) && entry.user.length > 0;
      });
  }

  // How many rows a project's tokens have, at any age.
  public toCountRowsOfTokensStatement(data: {
    projectId: ObjectID;
    tokens: Array<string>;
  }): Statement {
    const statement: Statement = SQL`SELECT count() AS vaultRows FROM `;
    statement.append(this.qualifiedTableName(this.model.tableName));
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND token IN (${{
        type: TableColumnType.Text,
        value: new Includes(data.tokens),
      }})`,
    );

    return statement;
  }

  public async countRowsOfTokens(data: {
    projectId: ObjectID;
    tokens: ReadonlyArray<string>;
  }): Promise<number> {
    const tokens: Array<string> = SecurityUserVaultService.erasableTokens(
      data.tokens,
    );

    if (tokens.length === 0) {
      return 0;
    }

    const result: Results = await this.executeQuery(
      this.toCountRowsOfTokensStatement({ projectId: data.projectId, tokens }),
      MigrationExecuteOptions,
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();
    const row: JSONObject | undefined = (response.data || [])[0] as
      | JSONObject
      | undefined;

    return Number(row?.["vaultRows"] || 0) || 0;
  }

  /*
   * The delete of a project's tokens' rows: a mutation on the local table,
   * ON CLUSTER, as every delete of an analytics table is
   * (AnalyticsDatabaseService.toDeleteStatement) - a lightweight DELETE
   * cannot target a Distributed table or run ON CLUSTER. Deleting rows that
   * are gone already deletes nothing, so it is safe to run again.
   */
  public toEraseTokensStatement(data: {
    projectId: ObjectID;
    tokens: Array<string>;
  }): Statement {
    const statement: Statement = SQL`ALTER TABLE `;
    statement.append(
      this.qualifiedTableName(getStorageTableName(this.model.tableName)),
    );
    statement.append(onClusterClause());
    statement.append(
      SQL` DELETE WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND token IN (${{
        type: TableColumnType.Text,
        value: new Includes(data.tokens),
      }})`,
    );

    return statement;
  }

  /*
   * Queues the delete of a project's tokens' rows and returns once ClickHouse
   * holds it (mutations_sync stays at its default): the mutation is durable
   * in Keeper from then on, and the erasure checks on a later run that it
   * was applied. Through the migration pool, whose socket outlasts a
   * mutation's queueing on a busy cluster.
   */
  public async eraseTokens(data: {
    projectId: ObjectID;
    tokens: ReadonlyArray<string>;
  }): Promise<void> {
    const tokens: Array<string> = SecurityUserVaultService.erasableTokens(
      data.tokens,
    );

    if (tokens.length === 0) {
      return;
    }

    await this.execute(
      this.toEraseTokensStatement({ projectId: data.projectId, tokens }),
      MigrationExecuteOptions,
    );
  }

  private refuse(): never {
    throw new BadDataException(SECURITY_USER_VAULT_REFUSAL);
  }

  /*
   * ---------------------------------------------------------------------
   * Every generic read, refused: only findUsersOfTokens reads the vault.
   * ---------------------------------------------------------------------
   */

  public override async findBy(
    _findBy: Parameters<VaultService["findBy"]>[0],
  ): ReturnType<VaultService["findBy"]> {
    return this.refuse();
  }

  public override async findOneBy(
    _findOneBy: Parameters<VaultService["findOneBy"]>[0],
  ): ReturnType<VaultService["findOneBy"]> {
    return this.refuse();
  }

  public override async findOneById(
    _findOneById: Parameters<VaultService["findOneById"]>[0],
  ): ReturnType<VaultService["findOneById"]> {
    return this.refuse();
  }

  public override async countBy(
    _countBy: Parameters<VaultService["countBy"]>[0],
  ): ReturnType<VaultService["countBy"]> {
    return this.refuse();
  }

  public override async existsBy(
    _existsBy: Parameters<VaultService["existsBy"]>[0],
  ): ReturnType<VaultService["existsBy"]> {
    return this.refuse();
  }

  public override async aggregateBy(
    _aggregateBy: Parameters<VaultService["aggregateBy"]>[0],
  ): ReturnType<VaultService["aggregateBy"]> {
    return this.refuse();
  }

  public override async countDistinctNonEmpty(
    _input: Parameters<VaultService["countDistinctNonEmpty"]>[0],
  ): ReturnType<VaultService["countDistinctNonEmpty"]> {
    return this.refuse();
  }

  public override async countPerWindow(
    _data: Parameters<VaultService["countPerWindow"]>[0],
  ): ReturnType<VaultService["countPerWindow"]> {
    return this.refuse();
  }

  public override async countPerValueInWindows(
    _data: Parameters<VaultService["countPerValueInWindows"]>[0],
  ): ReturnType<VaultService["countPerValueInWindows"]> {
    return this.refuse();
  }

  public override async groupTelemetryUsageByService(
    _data: Parameters<VaultService["groupTelemetryUsageByService"]>[0],
  ): ReturnType<VaultService["groupTelemetryUsageByService"]> {
    return this.refuse();
  }

  public override async getDaysWithRows(
    _data: Parameters<VaultService["getDaysWithRows"]>[0],
  ): ReturnType<VaultService["getDaysWithRows"]> {
    return this.refuse();
  }
}

export default new SecurityUserVaultService();
