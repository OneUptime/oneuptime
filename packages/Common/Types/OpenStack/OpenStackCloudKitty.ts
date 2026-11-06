import { JSONObject, JSONValue } from "../JSON";

/*
 * WHAT CLOUDKITTY RATED, IF THIS CLOUD RUNS IT.
 *
 * CloudKitty is OpenStack's rating service, and where it runs, what it rated each project replaces
 * what OneUptime would work out from its inventory and prices. Only a probe can ask: the agent's
 * exporter has no series for it. So a cloud connected through an agent calculates, and its page says
 * so.
 *
 * A real CloudKitty answered these two on stable/2026.1 (Fixtures/OpenStack/services-cloudkitty), and
 * the probe's tests replay it. The other shapes read here are because the API reference shows them, and
 * tests made to that reference are labelled as such.
 *
 *   GET /v2/summary?begin=&end=&groupby=project_id&limit=&offset=
 *     {"total": 2, "columns": ["begin", "end", "qty", "rate", "project_id"], "format": "table",
 *      "results": [["2026-11-01T00:00:00+00:00", "2026-12-01T00:00:00+00:00", 3.0, 0.5, "abc"], ...]}
 *     With nothing rated: {"total": 0, "columns": [], "results": [], "format": "table"}.
 *
 *   GET /v1/report/summary?begin=&end=&groupby=tenant_id&all_tenants=true
 *     {"summary": [{"tenant_id": "abc", "res_type": "ALL", "rate": "0.5", "begin": "...", "end": "..."}]}
 *     With nothing rated: {"summary": []}.
 *
 * It has a policy of its own. An admin's credential reads every project, and anything less reads only
 * its own and is refused the v1 report of all of them. So what comes back can be part of a cloud, and
 * each project takes CloudKitty's figure only where it has one. It has no idea of a currency either. A
 * rate is a number. The operator's price list says which currency a page shows it in, and without one
 * it's shown as a number alone.
 *
 * Pure and bounded, because what it reads comes from outside and a project can have any number of rows.
 */

// Rating moves slowly and a read goes over a period's whole rated data, so not every collection.
export const OPENSTACK_CLOUDKITTY_READ_EVERY_MINUTES: number = 60;

export const OPENSTACK_CLOUDKITTY_PAGE_SIZE: number = 1000;

// A read's most pages: enough for 20,000 projects, and what's beyond it reads as worked out instead.
export const OPENSTACK_CLOUDKITTY_MOST_PAGES: number = 20;

const LONGEST_PROJECT_ID: number = 100;

export interface OpenStackCloudKittyRow {
  projectId: string;
  rate: number;
}

export interface OpenStackCloudKittyPage {
  rows: Array<OpenStackCloudKittyRow>;
  // How many rows there are in all, where the answer says. Null for v1, which answers all at once.
  total: number | null;
}

function toRate(value: JSONValue | undefined): number | null {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }
  const rate: number = Number(value);
  return Number.isFinite(rate) ? rate : null;
}

function toProjectId(value: JSONValue | undefined): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= LONGEST_PROJECT_ID &&
    value !== "ALL"
    ? value
    : null;
}

function pushRow(
  rows: Array<OpenStackCloudKittyRow>,
  projectId: JSONValue | undefined,
  rate: JSONValue | undefined,
): void {
  const id: string | null = toProjectId(projectId);
  const amount: number | null = toRate(rate);

  // A rate of nothing is a project no rule applied to, which says nothing about what it costs.
  if (id && amount !== null && amount > 0) {
    rows.push({ projectId: id, rate: amount });
  }
}

/*
 * One page of /v2/summary. The default is a table, with `columns` naming each result's columns in an
 * order that isn't promised. response_format=object makes each result an object. Both are read.
 */
export function readOpenStackCloudKittySummary(
  answer: unknown,
): OpenStackCloudKittyPage {
  const rows: Array<OpenStackCloudKittyRow> = [];

  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    return { rows, total: 0 };
  }

  const record: JSONObject = answer as JSONObject;
  const total: number | null = toRate(record["total"]);
  const results: unknown = record["results"];

  if (!Array.isArray(results)) {
    return { rows, total: total ?? 0 };
  }

  const columns: Array<unknown> = Array.isArray(record["columns"])
    ? record["columns"]
    : [];
  const rateAt: number = columns.indexOf("rate");
  const projectAt: number = columns.indexOf("project_id");

  for (const result of results as Array<JSONValue>) {
    if (Array.isArray(result)) {
      if (rateAt >= 0 && projectAt >= 0) {
        pushRow(
          rows,
          result[projectAt] as JSONValue,
          result[rateAt] as JSONValue,
        );
      }
    } else if (result && typeof result === "object") {
      const row: JSONObject = result as JSONObject;
      pushRow(rows, row["project_id"], row["rate"]);
    }
  }

  return { rows, total: total ?? rows.length };
}

// /v1/report/summary, for a CloudKitty too old for v2. "ALL" is a total of everything, not a project.
export function readOpenStackCloudKittyReport(
  answer: unknown,
): OpenStackCloudKittyPage {
  const rows: Array<OpenStackCloudKittyRow> = [];
  const summary: unknown =
    answer && typeof answer === "object"
      ? (answer as JSONObject)["summary"]
      : null;

  if (!Array.isArray(summary)) {
    return { rows, total: null };
  }

  for (const entry of summary as Array<JSONValue>) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const row: JSONObject = entry as JSONObject;
      pushRow(rows, row["tenant_id"], row["rate"]);
    }
  }

  return { rows, total: null };
}

// A project's rows of a period, as one figure: what comes back grouped by project can still be split.
export function addOpenStackCloudKittyRows(
  rows: ReadonlyArray<OpenStackCloudKittyRow>,
): Map<string, number> {
  const totals: Map<string, number> = new Map();

  for (const row of rows) {
    totals.set(row.projectId, (totals.get(row.projectId) || 0) + row.rate);
  }

  return totals;
}

// The periods a read asks about, by the month each is, in the shape each API takes a time.
export interface OpenStackCloudKittyPeriod {
  // "2026-11".
  month: string;
  begin: string;
  end: string;
}

export function getOpenStackCloudKittyPeriods(
  now: Date,
): Array<OpenStackCloudKittyPeriod> {
  const period: (monthsBack: number) => OpenStackCloudKittyPeriod = (
    monthsBack: number,
  ): OpenStackCloudKittyPeriod => {
    const start: Date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1),
    );
    const end: Date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack + 1, 1),
    );

    return {
      month: start.toISOString().slice(0, 7),
      begin: start.toISOString().slice(0, 19),
      end: end.toISOString().slice(0, 19),
    };
  };

  return [period(0), period(1)];
}
