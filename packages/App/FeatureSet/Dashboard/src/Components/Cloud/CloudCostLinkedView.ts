import { fromCloudCostDay } from "Common/Types/Cloud/CloudCost";
import {
  CloudCostBasis,
  isCloudCostBasis,
} from "Common/Types/Cloud/CloudCostBasis";
import {
  CloudCostDimension,
  isCloudCostDimension,
} from "Common/Types/Cloud/CloudCostBreakdowns";
import ObjectID from "Common/Types/ObjectID";

/*
 * COSTS ON THE DAYS A LINK NAMES (#11009).
 *
 * A scheduled report's "Open Costs" opens Costs on exactly its days, its
 * cost basis and, for a cost view's report, by the view's groups:
 *
 *   /cloud/costs?start=2026-11-16&end=2026-11-22&basis=amortized
 *               &by=group&view=<the view's id>
 *
 * so the figures on the page are the report's. What the link names is
 * read once, as the page opens; a link that names nothing usable opens the
 * page as it always opens.
 */

export interface CloudCostLinkedView {
  // The days, both included: "2026-11-16".
  start?: string | undefined;
  lastDay?: string | undefined;
  basis?: CloudCostBasis | undefined;
  by?: CloudCostDimension | undefined;
  viewId?: string | undefined;
}

const DAY: RegExp = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value: string | null): value is string {
  return Boolean(
    value &&
      DAY.test(value) &&
      Number.isFinite(fromCloudCostDay(value).getTime()),
  );
}

// What a query string names, read: anything it names wrongly is left out.
export function readCloudCostLinkedView(search: string): CloudCostLinkedView {
  const params: URLSearchParams = new URLSearchParams(search || "");
  const start: string | null = params.get("start");
  const end: string | null = params.get("end");
  const basis: string | null = params.get("basis");
  const by: string | null = params.get("by");
  const view: string | null = params.get("view");
  const linked: CloudCostLinkedView = {};

  if (isDay(start) && isDay(end) && start <= end) {
    linked.start = start;
    linked.lastDay = end;
  }

  if (isCloudCostBasis(basis)) {
    linked.basis = basis;
  }

  if (isCloudCostDimension(by)) {
    linked.by = by;
  }

  if (view && ObjectID.isValidUUID(view)) {
    linked.viewId = view;
  }

  return linked;
}

// What the page's address names, as it opens.
export function getCloudCostLinkedView(): CloudCostLinkedView {
  try {
    return readCloudCostLinkedView(
      typeof window === "undefined" ? "" : window.location.search,
    );
  } catch {
    return {};
  }
}
