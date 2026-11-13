import ProductKey from "../Product/ProductKey";
import { UsedByGroup, UsedByRowKind, UsedBySummary } from "./UsedBy";

/*
 * "USED BY" AND THE PRODUCTS A SERVER SWITCHED OFF (#6815, #6813).
 *
 * The Used by card lists and links what refers to a record - a monitor's
 * status pages, SLOs, workflows. A product switched off on the server has no
 * pages to link to, so the card leaves its line out (UsedByCard).
 *
 * The Delete and Archive dialogs read the same summary and keep every line
 * (UsedByImpact): deleting a monitor still takes it off a status page while
 * Status Pages is off, and that page is back, without it, once the server
 * switches Status Pages on again - nothing is deleted when a product is off,
 * so what a delete does to it still counts.
 *
 * Pure: the Dashboard and its tests read it.
 */

// The product each kind of row is a record of.
export const USED_BY_ROW_KIND_PRODUCTS: Readonly<
  Record<UsedByRowKind, ProductKey>
> = {
  [UsedByRowKind.Monitor]: ProductKey.Monitors,
  [UsedByRowKind.MonitorGroup]: ProductKey.Monitors,
  [UsedByRowKind.StatusPage]: ProductKey.StatusPages,
  [UsedByRowKind.ServiceLevelObjective]: ProductKey.Slos,
  [UsedByRowKind.ScheduledMaintenance]: ProductKey.ScheduledMaintenance,
  [UsedByRowKind.Workflow]: ProductKey.Workflows,
  [UsedByRowKind.Dashboard]: ProductKey.Dashboards,
  [UsedByRowKind.OnCallDutyPolicy]: ProductKey.OnCall,
  [UsedByRowKind.OnCallSchedule]: ProductKey.OnCall,
  [UsedByRowKind.Service]: ProductKey.Services,
  [UsedByRowKind.Incident]: ProductKey.Incidents,
  [UsedByRowKind.Alert]: ProductKey.Alerts,
};

// The summary without the lines of products switched off on the server.
export const withoutGroupsOfProductsOff: (
  summary: UsedBySummary,
  offProducts: ReadonlyArray<ProductKey>,
) => UsedBySummary = (
  summary: UsedBySummary,
  offProducts: ReadonlyArray<ProductKey>,
): UsedBySummary => {
  if (offProducts.length === 0) {
    return summary;
  }

  return {
    ...summary,
    groups: summary.groups.filter((group: UsedByGroup): boolean => {
      return !offProducts.includes(USED_BY_ROW_KIND_PRODUCTS[group.rowKind]);
    }),
  };
};
