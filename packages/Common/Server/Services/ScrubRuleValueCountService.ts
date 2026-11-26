import { ResponseJSON } from "@clickhouse/client";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, { Results } from "./AnalyticsDatabaseService";
import ScrubRuleValueCount from "../../Models/AnalyticsModels/ScrubRuleValueCount";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../Types/Date";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";

/*
 * THE SCRUB RULE COUNTER'S TABLE (Models/AnalyticsModels/ScrubRuleValueCount,
 * #10366): the rows ingest's counter writes, and the one read the scrub
 * rule lists - and #10368's proof that a leak stopped - make: how many
 * values each rule changed, by service and version, over a time.
 */

// The most rules one read names: a page of a rules list, and some.
export const MAX_RULES_PER_VALUE_COUNT_READ: number = 500;

// How long a read may take: a few rows of each rule, which a page waits for.
export const VALUE_COUNT_READ_TIME_LIMIT_IN_SECONDS: number = 15;

// The most rows one read returns: every service and version of every rule, and some.
export const MAX_VALUE_COUNT_ROWS: number = 10_000;

// One hour's count of one rule, of one service's version, as the counter hands it over.
export interface ScrubRuleValueCountEntry {
  projectId: string;
  scrubRuleId: string;
  signal: string;
  serviceId: string;
  serviceVersion: string;
  hour: Date;
  valueCount: number;
  lastChangedAt: Date;
}

// What a read answers: a rule's values changed, of one service's version (and hour, when asked by hour).
export interface ScrubRuleValueCountRow {
  scrubRuleId: string;
  serviceId: string;
  serviceVersion: string;
  // Set when the read was by hour.
  hour?: Date | undefined;
  valueCount: number;
  lastChangedAt: Date | null;
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function readCount(value: JSONValue | undefined): number {
  const count: number =
    typeof value === "number" ? value : Number(readText(value) || NaN);

  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

function readTime(value: JSONValue | undefined): Date | null {
  const text: string = readText(value);

  if (!text) {
    return null;
  }

  const time: Date = OneUptimeDate.fromString(
    text.includes("T") ? text : text.replace(" ", "T") + "Z",
  );

  return isNaN(time.getTime()) ? null : time;
}

export class ScrubRuleValueCountService extends AnalyticsDatabaseService<ScrubRuleValueCount> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: ScrubRuleValueCount, database: clickhouseDatabase });
  }

  // The rows a write of counts is: an entry that counted nothing is no row.
  public static toRows(
    entries: ReadonlyArray<ScrubRuleValueCountEntry>,
  ): Array<JSONObject> {
    const rows: Array<JSONObject> = [];

    for (const entry of entries) {
      if (
        !ObjectID.isValidUUID(entry.projectId) ||
        !ObjectID.isValidUUID(entry.scrubRuleId) ||
        entry.valueCount <= 0
      ) {
        continue;
      }

      rows.push({
        projectId: entry.projectId,
        scrubRuleId: entry.scrubRuleId,
        signal: entry.signal,
        serviceId: entry.serviceId,
        serviceVersion: entry.serviceVersion,
        hour: OneUptimeDate.toClickhouseDateTime(entry.hour),
        valueCount: Math.trunc(entry.valueCount),
        lastChangedAt: OneUptimeDate.toClickhouseDateTime(entry.lastChangedAt),
      });
    }

    return rows;
  }

  // One read's statement: each rule's values changed, by service and version (and hour).
  public toReadStatement(data: {
    projectId: ObjectID;
    scrubRuleIds: Array<string>;
    since: Date;
    until?: Date | undefined;
    byHour?: boolean | undefined;
  }): Statement {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;
    const groupBy: string = data.byHour
      ? "scrubRuleId, serviceId, serviceVersion, hour"
      : "scrubRuleId, serviceId, serviceVersion";
    const statement: Statement = SQL`SELECT scrubRuleId AS readRuleId, serviceId AS readServiceId, serviceVersion AS readServiceVersion, `;

    if (data.byHour) {
      statement.append("toString(hour) AS readHour, ");
    }

    statement.append(
      "sum(valueCount) AS readValueCount, toString(max(lastChangedAt)) AS readLastChangedAt FROM ",
    );
    statement.append(`${databaseName}.${this.model.tableName}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND scrubRuleId IN (${{
        type: TableColumnType.Text,
        value: new Includes(data.scrubRuleIds),
      }}) AND hour >= ${{
        type: TableColumnType.Date,
        value: data.since,
      }}`,
    );

    if (data.until) {
      statement.append(
        SQL` AND hour < ${{
          type: TableColumnType.Date,
          value: data.until,
        }}`,
      );
    }

    statement.append(` GROUP BY ${groupBy}`);
    statement.append(
      SQL` ORDER BY readValueCount DESC LIMIT ${{
        type: TableColumnType.Number,
        value: MAX_VALUE_COUNT_ROWS,
      }}`,
    );
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: VALUE_COUNT_READ_TIME_LIMIT_IN_SECONDS,
        timeoutOverflowMode: "throw",
      }),
    );

    return statement;
  }

  /*
   * How many values each of a project's rules changed since a time, by
   * service and version - and by hour, when asked - as the server: the
   * caller checks the person may read the rules.
   */
  public async readValueCounts(data: {
    projectId: ObjectID;
    scrubRuleIds: ReadonlyArray<string>;
    since: Date;
    until?: Date | undefined;
    byHour?: boolean | undefined;
  }): Promise<Array<ScrubRuleValueCountRow>> {
    const ids: Array<string> = Array.from(
      new Set<string>(
        data.scrubRuleIds
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          })
          .map((id: string): string => {
            return id.toLowerCase();
          }),
      ),
    ).slice(0, MAX_RULES_PER_VALUE_COUNT_READ);

    if (ids.length === 0) {
      return [];
    }

    const result: Results = await this.executeQuery(
      this.toReadStatement({ ...data, scrubRuleIds: ids }),
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();
    const rows: Array<ScrubRuleValueCountRow> = [];

    for (const row of (response.data || []) as Array<JSONObject>) {
      const scrubRuleId: string = readText(row["readRuleId"]).toLowerCase();

      if (!ids.includes(scrubRuleId)) {
        continue;
      }

      const read: ScrubRuleValueCountRow = {
        scrubRuleId,
        serviceId: readText(row["readServiceId"]),
        serviceVersion: readText(row["readServiceVersion"]),
        valueCount: readCount(row["readValueCount"]),
        lastChangedAt: readTime(row["readLastChangedAt"]),
      };

      if (data.byHour) {
        const hour: Date | null = readTime(row["readHour"]);

        if (!hour) {
          continue;
        }

        read.hour = hour;
      }

      rows.push(read);
    }

    return rows;
  }
}

export default new ScrubRuleValueCountService();
