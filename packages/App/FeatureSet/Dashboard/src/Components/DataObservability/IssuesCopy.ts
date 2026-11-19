import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import {
  DATA_ATTENTION_KIND_ORDER,
  DataAttentionItem,
  DataAttentionKind,
} from "Common/Types/DataObservability/DataObservabilityAttention";
import {
  DATA_OBSERVABILITY_NO_OWNER_FILTER,
  DataObservabilityIssueAlertFilter,
  DataObservabilityIssueOwner,
  DataObservabilityIssuesRequest,
  DataObservabilityIssuesResponse,
  DataObservabilityStoreSummary,
  DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE ISSUES PAGE'S WORDS, FILTERS AND WAY IN (#6549).
 *
 * Kept free of React, so the filters, the address that carries them and
 * what the page sends the server can be pinned in plain tests. The filters
 * travel in the page's own URL namespace (TableFilterUrlState), as a list's
 * do, so Back returns to them and a link can open the page already
 * filtered.
 */

// The page's URL namespace for its filters.
export const DATA_OBSERVABILITY_ISSUES_LIST_ID: string =
  "data-observability-issues";

export const ISSUE_SINGULAR_LABEL: string = translationKey("Issue");
export const ISSUE_PLURAL_LABEL: string = translationKey("Issues");

// The Alert filter's choice for both: what the page opens on.
export const ANY_ALERT_FILTER: string = "any";

export interface IssuesFilter {
  kind?: DataAttentionKind | undefined;
  dataStoreId?: string | undefined;
  // An owner's key ("user:<id>", "team:<id>"), or DATA_OBSERVABILITY_NO_OWNER_FILTER.
  owner?: string | undefined;
  alert?: DataObservabilityIssueAlertFilter | undefined;
}

/*
 * Each kind by a name that says what is wrong with what: the Kind filter's
 * choices, which the picker draws in the reader's language.
 */
export const ISSUE_KIND_LABELS: Readonly<Record<DataAttentionKind, string>> = {
  [DataAttentionKind.CollectionFailed]: translationKey("Collection Failed"),
  [DataAttentionKind.PipelineFailed]: translationKey("Pipeline Run Failed"),
  [DataAttentionKind.CheckFailing]: translationKey("Check Failing"),
  [DataAttentionKind.ReconciliationDrifted]: translationKey(
    "Reconciliation Drifted",
  ),
  [DataAttentionKind.DataProductLate]: translationKey("Data Product Late"),
  [DataAttentionKind.TableLate]: translationKey("Table Late"),
  [DataAttentionKind.PipelineLate]: translationKey("Pipeline Late"),
  [DataAttentionKind.CheckCouldNotRun]: translationKey("Check Could Not Run"),
  [DataAttentionKind.ReconciliationCouldNotRun]: translationKey(
    "Reconciliation Could Not Compare",
  ),
};

export interface IssueChoice {
  value: string;
  label: string;
}

// The kinds, worst first, as the list is ordered.
export const ISSUE_KIND_CHOICES: ReadonlyArray<IssueChoice> =
  DATA_ATTENTION_KIND_ORDER.map((kind: DataAttentionKind): IssueChoice => {
    return { value: kind, label: ISSUE_KIND_LABELS[kind] };
  });

/*
 * Whether anyone was told: every issue, an alert is open, or none is. The
 * first says All, as a filter left open does: the bare "Any" is a Match
 * Condition's word, "at least one" in several languages
 * (MatchConditionAnyWordGuard).
 */
export const ISSUE_ALERT_CHOICES: ReadonlyArray<IssueChoice> = [
  { value: ANY_ALERT_FILTER, label: "All" },
  { value: DataObservabilityIssueAlertFilter.Open, label: "Alert open" },
  { value: DataObservabilityIssueAlertFilter.None, label: "No alert open" },
];

function isKind(value: unknown): value is DataAttentionKind {
  return (
    typeof value === "string" &&
    (DATA_ATTENTION_KIND_ORDER as ReadonlyArray<string>).includes(value)
  );
}

function isOwnerFilter(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  if (value === DATA_OBSERVABILITY_NO_OWNER_FILTER) {
    return true;
  }

  const parts: Array<string> = value.split(":");

  return (
    parts.length === 2 &&
    (parts[0] === "user" || parts[0] === "team") &&
    ObjectID.isValidUUID(parts[1] || "")
  );
}

/*
 * A filter read from anywhere a person can edit - the address - keeps only
 * what the page could have set itself.
 */
export function readIssuesFilter(value: unknown): IssuesFilter {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const filter: IssuesFilter = {};

  if (isKind(raw["kind"])) {
    filter.kind = raw["kind"];
  }

  if (
    typeof raw["dataStoreId"] === "string" &&
    ObjectID.isValidUUID(raw["dataStoreId"])
  ) {
    filter.dataStoreId = raw["dataStoreId"];
  }

  if (isOwnerFilter(raw["owner"])) {
    filter.owner = raw["owner"];
  }

  if (
    (
      Object.values(DataObservabilityIssueAlertFilter) as Array<unknown>
    ).includes(raw["alert"])
  ) {
    filter.alert = raw["alert"] as DataObservabilityIssueAlertFilter;
  }

  return filter;
}

export function hasIssuesFilter(filter: IssuesFilter): boolean {
  return Boolean(
    filter.kind || filter.dataStoreId || filter.owner || filter.alert,
  );
}

// The filter as the address carries it: only what is set.
export function toIssuesFilterState(filter: IssuesFilter): JSONObject | null {
  const state: JSONObject = {};

  if (filter.kind) {
    state["kind"] = filter.kind;
  }

  if (filter.dataStoreId) {
    state["dataStoreId"] = filter.dataStoreId;
  }

  if (filter.owner) {
    state["owner"] = filter.owner;
  }

  if (filter.alert) {
    state["alert"] = filter.alert;
  }

  return Object.keys(state).length > 0 ? state : null;
}

// What the page asks the server for: a page of the items the filter keeps.
export function toIssuesRequest(data: {
  filter: IssuesFilter;
  page: number;
  itemsOnPage: number;
}): DataObservabilityIssuesRequest {
  const itemsOnPage: number =
    data.itemsOnPage > 0
      ? data.itemsOnPage
      : DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE;
  const page: number = data.page > 0 ? data.page : 1;

  return {
    ...(data.filter.kind ? { kinds: [data.filter.kind] } : {}),
    ...(data.filter.dataStoreId
      ? { dataStoreId: data.filter.dataStoreId }
      : {}),
    ...(data.filter.owner ? { owner: data.filter.owner } : {}),
    ...(data.filter.alert ? { alert: data.filter.alert } : {}),
    skip: (page - 1) * itemsOnPage,
    limit: itemsOnPage,
  };
}

// The Issues page, already filtered when a filter is given.
export function getIssuesRoute(filter: IssuesFilter = {}): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_OBSERVABILITY_ISSUES] as Route,
  );
  const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
    DATA_OBSERVABILITY_ISSUES_LIST_ID,
    { filter: toIssuesFilterState(filter) },
  );

  return Object.keys(params).length > 0 ? route.addQueryParams(params) : route;
}

function arrayOr<T>(value: unknown): Array<T> {
  return Array.isArray(value) ? (value as Array<T>) : [];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// The answer as the page reads it, whatever came back: never a reason to fail.
export function normalizeDataObservabilityIssues(
  raw: Partial<DataObservabilityIssuesResponse> | JSONObject | null | undefined,
): DataObservabilityIssuesResponse {
  const value: Partial<DataObservabilityIssuesResponse> =
    (raw as Partial<DataObservabilityIssuesResponse>) || {};
  const items: Array<DataAttentionItem> = arrayOr<DataAttentionItem>(
    value.items,
  );

  return {
    items,
    count: numberOr(value.count, items.length),
    totalCount: numberOr(value.totalCount, items.length),
    skip: numberOr(value.skip, 0),
    limit: numberOr(value.limit, DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE),
    stores: arrayOr<DataObservabilityStoreSummary>(value.stores),
    owners: arrayOr<DataObservabilityIssueOwner>(value.owners),
  };
}
