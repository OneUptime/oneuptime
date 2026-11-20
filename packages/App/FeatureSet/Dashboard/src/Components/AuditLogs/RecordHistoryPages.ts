import { getApiSingularName, ModelNames } from "Common/Utils/ModelApiName";
import PageMap from "../../Utils/PageMap";
import { RESOURCE_META } from "./AuditLogsTableUtils";

/*
 * WHICH PAGE HOLDS A RECORD'S HISTORY (#10290).
 *
 * A record's line ends with "History" where its kind has a page of its
 * changes: the Audit Logs page of its own view - a monitor's at
 * MONITOR_VIEW_AUDIT_LOGS, beside MONITOR_VIEW. Worked out from what the
 * audit log already knows of each kind (RESOURCE_META: the page an entry
 * about it opens), by the name the log stores it under, so a kind that gets
 * an Audit Logs page gets the link with nothing else to change, and one
 * without such a page gets none.
 *
 * Pure (no RouteMap, no window), like AuditLogsTableUtils, so plain-node
 * tests read it; RecordHistoryRoute turns the page into a link.
 */
export const getRecordHistoryPage: (model: ModelNames) => PageMap | null = (
  model: ModelNames,
): PageMap | null => {
  const resourceType: string = getApiSingularName(model);

  if (
    !resourceType ||
    !Object.prototype.hasOwnProperty.call(RESOURCE_META, resourceType)
  ) {
    return null;
  }

  const viewRoute: PageMap | undefined = RESOURCE_META[resourceType]?.viewRoute;

  if (!viewRoute) {
    return null;
  }

  const historyPage: string = `${viewRoute}_AUDIT_LOGS`;

  return (Object.values(PageMap) as Array<string>).includes(historyPage)
    ? (historyPage as PageMap)
    : null;
};
