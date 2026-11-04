import { JSONObject } from "../JSON";

/*
 * WHAT A WAREHOUSE SPENT ON EACH JOB, OVER THE LAST DAY.
 *
 * Read once an hour with a warehouse's collection: Snowflake's credits
 * (QUERY_ATTRIBUTION_HISTORY) and BigQuery's bytes billed (its jobs view),
 * for each job - the runs of one query, however its values change - with
 * its runs and failures, who runs it, the team its query tag or label
 * names, and the tables it writes. Never a query's text: a job is named by
 * its tag, or by what it does and the table it writes, so no value in a
 * query leaves the warehouse.
 */

export interface CollectedJobSpend {
  // The warehouse's own key for the query, its values left out.
  jobKey: string;
  name: string;
  user: string | null;
  warehouse: string | null;
  team: string | null;
  runs: number;
  failedRuns: number;
  // Snowflake's compute credits; null where the warehouse bills otherwise.
  credits: number | null;
  // BigQuery's bytes billed; null where the warehouse bills otherwise.
  bytesBilled: number | null;
  // The tables of the store it writes.
  writtenTables: Array<{ schema: string; table: string }>;
  secondsSinceLastRun: number | null;
}

// The most jobs one collection keeps, the costliest first.
export const MAX_SPEND_JOBS: number = 500;
// The most tables one job is said to write.
export const MAX_WRITTEN_TABLES_PER_JOB: number = 20;
// The window spend is read over, in hours.
export const SPEND_WINDOW_IN_HOURS: number = 24;

const MAX_NAME_LENGTH: number = 240;

function readText(value: unknown, maxLength: number = MAX_NAME_LENGTH): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readNumber(value: unknown): number | null {
  const number: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  return Number.isFinite(number) && number >= 0 ? number : null;
}

/*
 * The team a query tag names: a tag of JSON with a team (dbt and many
 * schedulers set one), or team:finance in a plain tag.
 */
export function readTeamOfTag(tag: unknown): string | null {
  const text: string = readText(tag, 2_000);

  if (!text) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const team: string = readText((parsed as JSONObject)["team"]);

      return team || null;
    }
  } catch {
    // Not JSON: a plain tag.
  }

  const match: RegExpMatchArray | null = text.match(/\bteam[:=]\s*([\w.-]+)/i);

  return match ? match[1]!.slice(0, MAX_NAME_LENGTH) : null;
}

/*
 * A job's name, never its query's text: its tag when it is plain words,
 * else what it does and the table it writes, else what it does and who
 * runs it.
 */
export function nameJob(data: {
  tag: string | null;
  queryType: string | null;
  writtenTable: string | null;
  user: string | null;
}): string {
  const tag: string = readText(data.tag);
  const isPlainTag: boolean = Boolean(tag) && !tag.startsWith("{");
  const queryType: string = readText(data.queryType).toUpperCase() || "QUERY";

  if (isPlainTag) {
    return tag;
  }

  if (data.writtenTable) {
    return `${queryType} ${data.writtenTable}`.slice(0, MAX_NAME_LENGTH);
  }

  return (data.user ? `${queryType} by ${data.user}` : queryType).slice(
    0,
    MAX_NAME_LENGTH,
  );
}

// A job a probe sent: names bounded, numbers whole and not negative, or it is dropped.
export function readCollectedJobSpend(
  value: unknown,
): CollectedJobSpend | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item: JSONObject = value as JSONObject;
  const jobKey: string = readText(item["jobKey"], 200);
  const name: string = readText(item["name"]);

  if (!jobKey || !name) {
    return null;
  }

  return {
    jobKey,
    name,
    user: readText(item["user"]) || null,
    warehouse: readText(item["warehouse"]) || null,
    team: readText(item["team"]) || null,
    runs: Math.floor(readNumber(item["runs"]) || 0),
    failedRuns: Math.floor(readNumber(item["failedRuns"]) || 0),
    credits: readNumber(item["credits"]),
    bytesBilled:
      readNumber(item["bytesBilled"]) === null
        ? null
        : Math.floor(readNumber(item["bytesBilled"])!),
    writtenTables: (Array.isArray(item["writtenTables"])
      ? (item["writtenTables"] as Array<unknown>)
      : []
    )
      .map((table: unknown): { schema: string; table: string } | null => {
        const entry: JSONObject =
          table && typeof table === "object" ? (table as JSONObject) : {};
        const name: string = readText(entry["table"]);

        return name ? { schema: readText(entry["schema"]), table: name } : null;
      })
      .filter(
        (
          table: { schema: string; table: string } | null,
        ): table is { schema: string; table: string } => {
          return table !== null;
        },
      )
      .slice(0, MAX_WRITTEN_TABLES_PER_JOB),
    secondsSinceLastRun:
      readNumber(item["secondsSinceLastRun"]) === null
        ? null
        : Math.floor(readNumber(item["secondsSinceLastRun"])!),
  };
}
