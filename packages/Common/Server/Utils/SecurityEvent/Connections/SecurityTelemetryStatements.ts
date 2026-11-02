import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  RESOURCE_ATTRIBUTE_PREFIX,
  SecurityTelemetrySearchValue,
} from "../../../../Utils/SecurityCase/SecurityTelemetrySearch";
import {
  TimeoutOverflowMode,
  getQuerySettings,
} from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../../Telemetry/TelemetryReadScope";

/*
 * THE READS BEHIND "IN YOUR LOGS AND TRACES", as statements: for each value a
 * case names (Utils/SecurityCase/SecurityTelemetrySearch), how many of the
 * project's log lines, or spans, in the window name it, the records that
 * sent them, where in them it was, and when it was last seen - one row per
 * value, every value of a read in one pass over the table.
 *
 *   SELECT valueIndex, sum(...) AS totalCount, ... FROM (
 *     SELECT tupleElement(hit, 1) AS valueIndex, <record>, count() ...
 *     FROM <table>
 *     ARRAY JOIN arrayFilter(<named>, [
 *       (1, <the message names value 1>, <the attributes holding value 1>),
 *       (2, ...),
 *     ]) AS hit
 *     WHERE projectId = ... AND <time> in the window
 *       AND (<the message contains a value> OR <an attribute is one>)
 *       AND <the records the reader may read>
 *     GROUP BY valueIndex, <record>
 *   ) GROUP BY valueIndex
 *
 * The WHERE is what makes it cheap: the project and the window are the
 * table's sort key, an attribute's value is found through the bloom filter
 * over the attributes' values (idx_attribute_values), and a message is only
 * matched against a value's pattern once a plain case-insensitive search
 * found the value's text in it. A line or span naming two values counts for
 * each. Every value is a bound parameter; only fixed names are SQL text.
 *
 * Built here, apart from where they run, so a test reads each statement
 * without a database (SecurityTelemetryStatements.test.ts); a real
 * ClickHouse runs them in App's SecurityTelemetryMentionsClickhouse.
 */

/*
 * How long one of these reads may run, and how it stops: a person is
 * waiting, as for the other reads behind the connections, and 'throw', so a
 * read that runs out of time says exactly that rather than "not found".
 */
export const SECURITY_TELEMETRY_READ_TIME_LIMIT: Readonly<{
  maxExecutionTimeInSeconds: number;
  timeoutOverflowMode: TimeoutOverflowMode;
}> = {
  maxExecutionTimeInSeconds: 15,
  timeoutOverflowMode: "throw",
};

// The most records read for one value: the most named, as listed first.
export const SECURITY_TELEMETRY_MAX_SOURCES_READ: number = 10;

export enum SecurityTelemetryTable {
  // LogItemV3: a message (body), attributes, the time it was written.
  Logs = "Logs",
  // SpanItemV3: attributes, the time it started.
  Spans = "Spans",
}

export interface SecurityTelemetryMentionsStatementData {
  table: SecurityTelemetryTable;
  // The database and the table, as the service reading them names them.
  databaseName: string;
  tableName: string;
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  values: ReadonlyArray<SecurityTelemetrySearchValue>;
  // The records whose telemetry the reader may read (TelemetryReadAccess).
  serviceFilter: TelemetryServiceFilter;
}

// The name a database or a table is written with: letters, digits and "_".
const PLAIN_NAME_PATTERN: RegExp = /^[A-Za-z0-9_]+$/;

function assertPlainName(name: string, what: string): void {
  if (!PLAIN_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid ${what} name: ${name}`);
  }
}

// Every spelling of every value, once: what the bloom filter over the attributes' values is asked for.
function allSpellings(
  values: ReadonlyArray<SecurityTelemetrySearchValue>,
): Array<string> {
  return Array.from(
    new Set(
      values.flatMap((value: SecurityTelemetrySearchValue): Array<string> => {
        return value.spellings;
      }),
    ),
  );
}

function allNeedles(
  values: ReadonlyArray<SecurityTelemetrySearchValue>,
): Array<string> {
  return Array.from(
    new Set(
      values.flatMap((value: SecurityTelemetrySearchValue): Array<string> => {
        return value.needles;
      }),
    ),
  );
}

/*
 * Between an attribute's key and the value it holds, in what the read
 * answers with: a character no spelling of a value holds
 * (isTelemetrySearchText), so the last one splits the two.
 */
export const PLACE_SEPARATOR: string = "\u0000";

/*
 * The attributes holding a value, exactly, other than the resource
 * attributes, each as its key, PLACE_SEPARATOR and the value as it holds it:
 * mapFilter(...) of the attributes, its keys and values zipped. The
 * lambda's names are this file's own, so no column can shadow them.
 */
function attributesHolding(value: SecurityTelemetrySearchValue): Statement {
  const holding: () => Statement = (): Statement => {
    return SQL`mapFilter((mentionKey, mentionValue) -> NOT startsWith(mentionKey, ${{
      type: TableColumnType.Text,
      value: RESOURCE_ATTRIBUTE_PREFIX,
    }}) AND has(${{
      type: TableColumnType.ArrayText,
      value: value.spellings,
    }}, mentionValue), attributes)`;
  };

  const statement: Statement = SQL`arrayMap((mentionKey, mentionValue) -> concat(mentionKey, char(0), mentionValue), mapKeys(`;
  statement.append(holding());
  statement.append("), mapValues(");
  statement.append(holding());
  statement.append("))");

  return statement;
}

/*
 * One value's entry of the ARRAY JOIN: its index (from 1), whether the
 * message names it (logs), and the keys of the attributes holding it.
 */
function hitTuple(
  value: SecurityTelemetrySearchValue,
  index: number,
  table: SecurityTelemetryTable,
): Statement {
  const statement: Statement = SQL`tuple(toUInt8(${{
    type: TableColumnType.Number,
    value: index,
  }}), `;

  if (table === SecurityTelemetryTable.Logs) {
    statement.append(
      SQL`toUInt8(match(ifNull(body, ''), ${{
        type: TableColumnType.Text,
        value: value.messagePattern,
      }})), `,
    );
  } else {
    statement.append("toUInt8(0), ");
  }

  statement.append(attributesHolding(value));
  statement.append(")");

  return statement;
}

/*
 * The statement for one table and the values of one search, or null when
 * there is nothing to search for.
 */
export function buildSecurityTelemetryMentionsStatement(
  data: SecurityTelemetryMentionsStatementData,
): Statement | null {
  if (data.values.length === 0) {
    return null;
  }

  assertPlainName(data.databaseName, "database");
  assertPlainName(data.tableName, "table");

  const isLogs: boolean = data.table === SecurityTelemetryTable.Logs;
  const timeColumn: string = isLogs ? "time" : "startTime";

  const statement: Statement = new Statement();

  statement.append(
    `SELECT valueIndex, sum(hitCount) AS totalCount, sum(messageCount) AS messageTotal, max(lastSeen) AS lastSeenAt, count() AS sourceCount, arraySlice(arrayReverseSort(groupArray(tuple(hitCount, resourceType, resourceId))), 1, ${SECURITY_TELEMETRY_MAX_SOURCES_READ}) AS sources, sumMap(tupleElement(keyCounts, 1), tupleElement(keyCounts, 2)) AS places FROM (SELECT tupleElement(hit, 1) AS valueIndex, toString(primaryEntityType) AS resourceType, toString(primaryEntityId) AS resourceId, count() AS hitCount, countIf(tupleElement(hit, 2) = 1) AS messageCount, max(${timeColumn}) AS lastSeen, sumMap(tupleElement(hit, 3), arrayWithConstant(length(tupleElement(hit, 3)), toUInt64(1))) AS keyCounts FROM ${data.databaseName}.${data.tableName} ARRAY JOIN arrayFilter(namedValue -> tupleElement(namedValue, 2) = 1 OR length(tupleElement(namedValue, 3)) > 0, [`,
  );

  data.values.forEach(
    (value: SecurityTelemetrySearchValue, position: number): void => {
      if (position > 0) {
        statement.append(", ");
      }

      statement.append(hitTuple(value, position + 1, data.table));
    },
  );

  statement.append(
    SQL`]) AS hit WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }}`,
  );
  statement.append(` AND ${timeColumn} >= `);
  statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: data.startTime }}`,
  );
  statement.append(` AND ${timeColumn} <= `);
  statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: data.endTime }}`,
  );
  statement.append(" AND (");

  if (isLogs) {
    statement.append(
      SQL`multiSearchAnyCaseInsensitive(ifNull(body, ''), ${{
        type: TableColumnType.ArrayText,
        value: allNeedles(data.values),
      }}) OR `,
    );
  }

  statement.append(
    SQL`hasAny(mapValues(attributes), ${{
      type: TableColumnType.ArrayText,
      value: allSpellings(data.values),
    }}))`,
  );

  TelemetryReadScopeUtil.appendServiceFilter(statement, data.serviceFilter);

  statement.append(
    " GROUP BY valueIndex, resourceType, resourceId) GROUP BY valueIndex ORDER BY valueIndex ASC",
  );
  statement.append(
    getQuerySettings({
      ...SECURITY_TELEMETRY_READ_TIME_LIMIT,
      boundScanMemory: true,
    }),
  );

  return statement;
}

// ---------- Reading what it answers ----------

// One value's row, as read: before the records are named.
export interface SecurityTelemetryMentionRow {
  // Which value, from 1, in the order they were searched.
  valueIndex: number;
  count: number;
  // Log lines whose message names it (0 for spans).
  messageCount: number;
  lastSeen: Date | null;
  sourceCount: number;
  // The records that sent them, the most first: the row's type and id.
  sources: Array<{ type: string; id: string; count: number }>;
  /*
   * The attributes holding it, by key, how many lines or spans did, and
   * the value as most of them hold it.
   */
  attributeKeys: Array<{ key: string; count: number; value: string }>;
}

/*
 * count() is a UInt64, which ClickHouse sends as a JSON string or a JSON
 * number depending on output_format_json_quote_64bit_integers. Both read.
 */
function readCount(value: JSONValue | undefined): number {
  const parsed: number =
    typeof value === "number" || typeof value === "string" ? Number(value) : 0;

  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function readDate(value: JSONValue | undefined): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const text: string = String(value);
  // ClickHouse renders DateTime64 as "2026-10-14 09:00:00.000000000", in UTC.
  const date: Date = new Date(
    text.includes("T") ? text : `${text.replace(" ", "T")}Z`,
  );

  return Number.isNaN(date.getTime()) || date.getTime() <= 0 ? null : date;
}

// A tuple ClickHouse sends as an array, or as an object keyed "1", "2"...
function readTuple(value: JSONValue | undefined): Array<JSONValue> {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const object: JSONObject = value as JSONObject;

    return Object.keys(object)
      .sort((a: string, b: string): number => {
        return Number(a) - Number(b);
      })
      .map((key: string): JSONValue => {
        return object[key] as JSONValue;
      });
  }

  return [];
}

/*
 * One row of the statement's answer, read defensively: a value index out of
 * range, or a row with no hit, is no row.
 */
export function readSecurityTelemetryMentionRow(
  row: JSONObject,
  valueCount: number,
): SecurityTelemetryMentionRow | null {
  const valueIndex: number = readCount(row["valueIndex"]);
  const count: number = readCount(row["totalCount"]);

  if (valueIndex < 1 || valueIndex > valueCount || count === 0) {
    return null;
  }

  const sources: Array<{ type: string; id: string; count: number }> = [];

  for (const source of Array.isArray(row["sources"]) ? row["sources"] : []) {
    const [sourceCount, type, id] = readTuple(source);
    const resourceId: string = typeof id === "string" ? id.trim() : "";

    if (ObjectID.isValidUUID(resourceId)) {
      sources.push({
        type: typeof type === "string" ? type.trim() : "",
        id: resourceId,
        count: readCount(sourceCount),
      });
    }
  }

  const [places, placeCounts] = readTuple(row["places"]);
  // By key: every spelling it was held in, and how many held each.
  const byKey: Map<string, Map<string, number>> = new Map();

  if (Array.isArray(places) && Array.isArray(placeCounts)) {
    places.forEach((place: JSONValue, index: number): void => {
      const placeCount: number = readCount(placeCounts[index]);
      const separator: number =
        typeof place === "string" ? place.lastIndexOf(PLACE_SEPARATOR) : -1;

      if (typeof place !== "string" || separator <= 0 || placeCount === 0) {
        return;
      }

      const key: string = place.slice(0, separator);
      const held: string = place.slice(separator + PLACE_SEPARATOR.length);
      const spellings: Map<string, number> = byKey.get(key) || new Map();

      spellings.set(held, (spellings.get(held) || 0) + placeCount);
      byKey.set(key, spellings);
    });
  }

  const attributeKeys: Array<{ key: string; count: number; value: string }> =
    Array.from(byKey.entries()).map(
      ([key, spellings]: [string, Map<string, number>]): {
        key: string;
        count: number;
        value: string;
      } => {
        let count: number = 0;
        let value: string = "";
        let valueCount: number = -1;

        for (const [spelling, spellingCount] of Array.from(
          spellings.entries(),
        )) {
          count += spellingCount;

          if (spellingCount > valueCount) {
            value = spelling;
            valueCount = spellingCount;
          }
        }

        return { key, count, value };
      },
    );

  return {
    valueIndex,
    count,
    messageCount: Math.min(count, readCount(row["messageTotal"])),
    lastSeen: readDate(row["lastSeenAt"]),
    sourceCount: Math.max(readCount(row["sourceCount"]), sources.length),
    sources,
    attributeKeys,
  };
}
