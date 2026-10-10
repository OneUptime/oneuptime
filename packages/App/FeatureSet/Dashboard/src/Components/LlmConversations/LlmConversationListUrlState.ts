import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import {
  LlmConversationIssueFilter,
  LlmConversationSort,
  readConversationIssueFilter,
  readConversationSort,
  readFilterText,
} from "Common/Types/Telemetry/LlmConversationApi";

/*
 * The conversation list's view, kept in the URL: the time range, the
 * search, the app, the issue chip, the sort and the page. Opening a
 * conversation and coming back - or sharing the link - lands on the same
 * list.
 *
 * The query string is untrusted input: anything unreadable drops to its
 * default rather than failing the page.
 */

export const LLM_CONVERSATION_LIST_URL_PARAMS: Array<string> = [
  "range",
  "start",
  "end",
  "q",
  "app",
  "issue",
  "sort",
  "page",
];

export const LLM_CONVERSATION_DEFAULT_RANGE: TimeRange =
  TimeRange.PAST_ONE_WEEK;

export interface LlmConversationListView {
  range: RangeStartAndEndDateTime;
  search: string;
  // The app (telemetry service) the list is narrowed to; "" for all.
  serviceId: string;
  issue: LlmConversationIssueFilter | undefined;
  sort: LlmConversationSort;
  // 0-based.
  page: number;
}

export function getDefaultLlmConversationListView(): LlmConversationListView {
  return {
    range: { range: LLM_CONVERSATION_DEFAULT_RANGE },
    search: "",
    serviceId: "",
    issue: undefined,
    sort: LlmConversationSort.Newest,
    page: 0,
  };
}

function readRange(
  read: (name: string) => string | null,
): RangeStartAndEndDateTime {
  const range: string | null = read("range");
  const ranges: Array<string> = Object.values(TimeRange);

  if (range === TimeRange.CUSTOM) {
    const start: Date = new Date(read("start") || "");
    const end: Date = new Date(read("end") || "");

    if (
      !Number.isNaN(start.getTime()) &&
      !Number.isNaN(end.getTime()) &&
      start.getTime() < end.getTime()
    ) {
      return {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(start, end),
      };
    }

    return { range: LLM_CONVERSATION_DEFAULT_RANGE };
  }

  if (range && ranges.includes(range)) {
    return { range: range as TimeRange };
  }

  return { range: LLM_CONVERSATION_DEFAULT_RANGE };
}

export function readLlmConversationListView(
  read: (name: string) => string | null,
): LlmConversationListView {
  const page: number = Number(read("page"));
  const serviceId: string = read("app") || "";

  return {
    range: readRange(read),
    search: readFilterText(read("q")) || "",
    serviceId: ObjectID.isValidUUID(serviceId) ? serviceId : "",
    issue: readConversationIssueFilter(read("issue")),
    sort: readConversationSort(read("sort")),
    page: Number.isInteger(page) && page > 0 && page < 10_000 ? page : 0,
  };
}

/*
 * The params to write for a view: a default is written as null, so it
 * leaves the URL instead of filling it.
 */
export function toLlmConversationListUrlParams(
  view: LlmConversationListView,
): Dictionary<string | null> {
  const isCustom: boolean =
    view.range.range === TimeRange.CUSTOM &&
    Boolean(view.range.startAndEndDate);

  return {
    range:
      view.range.range === LLM_CONVERSATION_DEFAULT_RANGE
        ? null
        : view.range.range,
    start: isCustom
      ? view.range.startAndEndDate!.startValue.toISOString()
      : null,
    end: isCustom ? view.range.startAndEndDate!.endValue.toISOString() : null,
    q: view.search.trim() || null,
    app: view.serviceId || null,
    issue: view.issue || null,
    sort: view.sort === LlmConversationSort.Newest ? null : view.sort,
    page: view.page > 0 ? String(view.page) : null,
  };
}

// Whether anything narrows the list beyond the time range.
export function isLlmConversationListFiltered(
  view: LlmConversationListView,
): boolean {
  return Boolean(view.search.trim() || view.serviceId || view.issue);
}
