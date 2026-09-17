import ObjectID from "Common/Types/ObjectID";
import {
  MonitorRecommendation,
  MonitorRecommendationSeverity,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * What a recommendation card is, once the page has cross-referenced the
 * catalog against what already exists and what the team has said no to.
 *
 * The catalog itself is stateless — it returns the same 76 recommendations for
 * every project, every time. All three of the states below come from joining
 * it against project data, and the page is only useful because of that join:
 * a list that shows every recommendation forever, including the ones you
 * already acted on, is a list nobody reads twice.
 */
export enum RecommendationStatus {
  // Nothing exists for this yet and nobody has dismissed it.
  Available = "Available",
  // A monitor already watches exactly what this recommendation would watch.
  Created = "Created",
  // Someone on the team said no thanks.
  Dismissed = "Dismissed",
}

/*
 * Status precedence when a recommendation is both created AND dismissed.
 *
 * This is reachable: dismiss a recommendation, then create the monitor by hand
 * from the monitor form. `Created` wins, because it describes what is actually
 * running — showing "Dismissed" for a recommendation whose monitor exists and
 * is paging people would be actively misleading.
 */
export interface RecommendationViewModel {
  recommendation: MonitorRecommendation;
  status: RecommendationStatus;
  /*
   * Set when status is `Created` — the monitor that covers this
   * recommendation, so the card can link straight to it.
   */
  monitorId?: ObjectID | undefined;
  // Set when status is `Dismissed` — the row to delete in order to restore.
  dismissalId?: ObjectID | undefined;
  dismissalReason?: string | undefined;
}

export enum RecommendationStatusFilter {
  All = "All",
  Available = "Available",
  Created = "Created",
  Dismissed = "Dismissed",
}

export enum RecommendationSeverityFilter {
  All = "All",
  Critical = "Critical",
  Warning = "Warning",
}

export interface RecommendationFilterState {
  searchText: string;
  status: RecommendationStatusFilter;
  severity: RecommendationSeverityFilter;
}

export interface RecommendationCounts {
  total: number;
  available: number;
  created: number;
  dismissed: number;
  // Critical and Warning counts cover AVAILABLE recommendations only.
  availableCritical: number;
  availableWarning: number;
}

export interface RecommendationCategoryGroup {
  category: string;
  recommendations: Array<RecommendationViewModel>;
}

export type RecommendationSeverityCount = {
  [key in MonitorRecommendationSeverity]: number;
};
