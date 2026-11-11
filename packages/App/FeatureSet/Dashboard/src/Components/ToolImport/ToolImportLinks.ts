import ToolImportResourceKind, {
  isToolImportResourceKind,
} from "Common/Types/ToolImport/ToolImportResourceKind";
import ToolImportSource, {
  isToolImportSource,
} from "Common/Types/ToolImport/ToolImportSource";

/*
 * LINKS TO "IMPORT FROM ANOTHER TOOL" FROM WHERE A NEWCOMER STANDS.
 *
 * The importer lives in Project Settings > Advanced, where a person who
 * learned it there finds it. Someone arriving from PagerDuty or UptimeRobot
 * meets it earlier (issue #6809): on Home's Welcome checklist, under an
 * empty Monitors, On-Call or Status Pages list, and in Search by the tool's
 * name. Each link says on the importer's address
 *
 *   ?from=  where it was opened from, sent once with importer/opened
 *           (ProductEvent) - "settings" when it says nothing;
 *   ?kind=  the kind of record the list it came from holds: the picker
 *           opens on the tools that bring it, every tool one click away;
 *   ?tool=  a tool already picked (Search's "Import from PagerDuty"): the
 *           page opens on that tool's connect step.
 *
 * React-free and free of Common/UI, so Search's index (PageSearchIndex)
 * and App's tests can read it.
 */

export const IMPORTER_OPENED_FROM_QUERY_PARAM: string = "from";
export const IMPORTER_OPENED_FROM_SETTINGS: string = "settings";
export const IMPORTER_KIND_QUERY_PARAM: string = "kind";
export const IMPORTER_TOOL_QUERY_PARAM: string = "tool";

/*
 * Where the importer was opened from, as importer/opened's `from` says it.
 * Home's Welcome checklist sends "welcome" (WelcomeChecklistCatalog), and
 * Project Settings' own menu nothing ("settings").
 */
export enum ToolImportEntryPoint {
  MonitorsEmpty = "monitors-empty",
  OnCallPoliciesEmpty = "on-call-policies-empty",
  OnCallSchedulesEmpty = "on-call-schedules-empty",
  StatusPagesEmpty = "status-pages-empty",
  Search = "search",
}

// The importer's query string, with its "?": what to open on, and from where.
export function getToolImportQueryString(data: {
  from: ToolImportEntryPoint;
  kind?: ToolImportResourceKind | undefined;
  tool?: ToolImportSource | undefined;
}): string {
  const params: URLSearchParams = new URLSearchParams();

  params.set(IMPORTER_OPENED_FROM_QUERY_PARAM, data.from);

  if (data.kind) {
    params.set(IMPORTER_KIND_QUERY_PARAM, data.kind);
  }

  if (data.tool) {
    params.set(IMPORTER_TOOL_QUERY_PARAM, data.tool);
  }

  return `?${params.toString()}`;
}

/*
 * The kind ?kind= names, or null: an address someone typed or an old link
 * may name one that does not exist, and the picker then offers every tool.
 */
export function readToolImportKindParam(
  value: string | null | undefined,
): ToolImportResourceKind | null {
  return isToolImportResourceKind(value) ? value : null;
}

// The tool ?tool= names, or null for one OneUptime does not import from.
export function readToolImportToolParam(
  value: string | null | undefined,
): ToolImportSource | null {
  return isToolImportSource(value) ? value : null;
}
