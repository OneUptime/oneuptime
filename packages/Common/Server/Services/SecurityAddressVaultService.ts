import { ResponseJSON } from "@clickhouse/client";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, { Results } from "./AnalyticsDatabaseService";
import SecurityAddressVault, {
  SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS,
} from "../../Models/AnalyticsModels/SecurityAddressVault";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import IP from "../../Types/IP/IP";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { SCRUB_HASH_TOKEN_PATTERN } from "../../Types/Telemetry/ScrubHashTokenFormat";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";

/*
 * THE ADDRESS VAULT'S TABLE (Models/AnalyticsModels/SecurityAddressVault,
 * #10395): what ingest writes, and the one read Security Events' scans make.
 *
 * Two ways in, and only two:
 *
 *   - toRows: the rows ingest's writer hands the telemetry fan-in writer
 *     (Utils/SecurityEvent/AddressVault/SecurityAddressVaultWriter.ts);
 *   - findAddressesOfTokens: the addresses behind a page's tokens, in one
 *     query a page, for the scans' lookup
 *     (Utils/SecurityEvent/AddressVault/SecurityAddressVaultLookup.ts).
 *
 * Every generic read an AnalyticsDatabaseService has - find, count,
 * aggregate, exists - is refused, as the server too: the service sits in
 * AnalyticsServices so boot creates its table, and nothing that walks that
 * list may read the vault through it.
 */

/*
 * The most tokens one query names: both addresses - the source's and the
 * destination's (#10419) - of every line of a page of the log scan
 * (LOG_SCAN_PAGE_SIZE, a thousand lines), so a page is one query.
 */
export const MAX_TOKENS_PER_VAULT_LOOKUP: number = 2000;

// How long the lookup may take: a point read by key, which a scan waits for.
export const VAULT_LOOKUP_TIME_LIMIT_IN_SECONDS: number = 10;

// What every refused read says.
export const SECURITY_ADDRESS_VAULT_REFUSAL: string =
  "The address vault is read by Security Events' scans only.";

// A token and the address behind it, as a Hash rule of the project made them.
export interface SecurityAddressVaultEntry {
  token: string;
  // In the spelling its token is made of (ScrubIpAddress.canonicalize).
  address: string;
}

type VaultService = AnalyticsDatabaseService<SecurityAddressVault>;

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

export class SecurityAddressVaultService extends AnalyticsDatabaseService<SecurityAddressVault> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: SecurityAddressVault, database: clickhouseDatabase });
  }

  /*
   * The rows one write of a project's entries is, all seen at `seenAt`: an
   * entry that is no token a Hash rule makes, or no IP address, is no row.
   * Each row is first and last seen when it is written; merges keep the
   * earliest and the latest of a token's rows.
   */
  public static toRows(data: {
    projectId: ObjectID;
    entries: ReadonlyArray<SecurityAddressVaultEntry>;
    seenAt: Date;
  }): Array<JSONObject> {
    const projectId: string = data.projectId.toString();
    const seenAt: string = OneUptimeDate.toClickhouseDateTime(data.seenAt);
    const rows: Array<JSONObject> = [];

    for (const entry of data.entries) {
      if (
        !SCRUB_HASH_TOKEN_PATTERN.test(entry.token) ||
        !IP.isIP(entry.address)
      ) {
        continue;
      }

      rows.push({
        projectId: projectId,
        token: entry.token,
        address: entry.address,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      });
    }

    return rows;
  }

  /*
   * The oldest a row may have been last seen and still name its address:
   * exactly the vault's 30 days, whether or not the day it was written in
   * has been dropped yet. A length of time, as the table's TTL counts it,
   * never the server's own calendar: 30 x 24 hours in every zone, across a
   * clock change too (#8236).
   */
  public static getOldestNameableTime(now: Date): Date {
    return OneUptimeDate.addRemoveDurationInDays(
      now,
      -SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS,
    );
  }

  // One lookup's statement: each token's addresses, two at most.
  public toFindAddressesStatement(data: {
    projectId: ObjectID;
    tokens: Array<string>;
    seenAfter: Date;
  }): Statement {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    /*
     * groupUniqArray(2): a token with one address names it; one with two
     * (a 64-bit collision, by chance) names neither. The alias spells no
     * column the statement reads (ClickhouseAliasShadowGuard).
     */
    const statement: Statement = SQL`SELECT token, groupUniqArray(2)(address) AS vaultAddresses FROM `;
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
        maxExecutionTimeInSeconds: VAULT_LOOKUP_TIME_LIMIT_IN_SECONDS,
        timeoutOverflowMode: "throw",
      }),
    );

    return statement;
  }

  /*
   * The address behind each of a project's tokens that the vault holds,
   * seen in the last 30 days: one query for up to
   * MAX_TOKENS_PER_VAULT_LOOKUP tokens. A token that is no token a Hash rule
   * makes today is never asked about; a token with two addresses, or an
   * address that is no IP address, is left out.
   */
  public async findAddressesOfTokens(data: {
    projectId: ObjectID;
    tokens: ReadonlyArray<string>;
    now?: Date | undefined;
  }): Promise<Map<string, string>> {
    const addresses: Map<string, string> = new Map<string, string>();
    const tokens: Array<string> = Array.from(
      new Set<string>(
        data.tokens.filter((token: string): boolean => {
          return SCRUB_HASH_TOKEN_PATTERN.test(token);
        }),
      ),
    );

    if (tokens.length === 0) {
      return addresses;
    }

    const seenAfter: Date = SecurityAddressVaultService.getOldestNameableTime(
      data.now || OneUptimeDate.getCurrentDate(),
    );

    for (
      let start: number = 0;
      start < tokens.length;
      start += MAX_TOKENS_PER_VAULT_LOOKUP
    ) {
      const result: Results = await this.executeQuery(
        this.toFindAddressesStatement({
          projectId: data.projectId,
          tokens: tokens.slice(start, start + MAX_TOKENS_PER_VAULT_LOOKUP),
          seenAfter,
        }),
      );
      const response: ResponseJSON<JSONObject> =
        await result.json<JSONObject>();

      for (const row of (response.data || []) as Array<JSONObject>) {
        const token: string = readText(row["token"]);
        const found: JSONValue | undefined = row["vaultAddresses"];
        const candidates: Array<string> = Array.isArray(found)
          ? found.map((value: JSONValue): string => {
              return readText(value);
            })
          : [];

        if (
          tokens.includes(token) &&
          candidates.length === 1 &&
          IP.isIP(candidates[0]!)
        ) {
          addresses.set(token, candidates[0]!);
        }
      }
    }

    return addresses;
  }

  private refuse(): never {
    throw new BadDataException(SECURITY_ADDRESS_VAULT_REFUSAL);
  }

  /*
   * ---------------------------------------------------------------------
   * Every generic read, refused: only findAddressesOfTokens reads the vault.
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

export default new SecurityAddressVaultService();
