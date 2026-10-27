import { ExternalStatusPageComponentStatus } from "../../Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ExternalStatusPageComponentNames from "./ExternalStatusPageComponentNames";
import {
  ExternalStatusPageComponent,
  ExternalStatusPageIncident,
} from "./ExternalStatusPageReading";

/*
 * WHAT ON A STATUS PAGE AN EXTERNAL STATUS PAGE MONITOR WATCHES.
 *
 * A monitor watches the whole page, one group of it (componentGroupName,
 * matched as the group's name contains it), the components it chose by
 * name (componentNames, ExternalStatusPageComponentNames), or the chosen
 * components of one group. Its criteria then see only those:
 *
 *   - Component Status compares each component in scope;
 *   - Active Incidents counts the incidents that affect at least one of
 *     them. An incident that names no component is not counted while the
 *     monitor watches part of the page: nothing says it affects that part.
 *     Watching the whole page, every incident counts;
 *   - the overall status is the page's own while it watches the whole page,
 *     and otherwise the worst status of the components in scope (degraded
 *     when one of their incidents is open while they all say operational).
 *
 * What it leaves out is said too, so the person can tell a quiet monitor
 * from one that watches nothing: the chosen names no component on the
 * page has (unmatchedComponentNames), and the active incidents elsewhere
 * on the page (incidentsOutsideScopeCount).
 */

// The most incident names a check reports, for the criteria's message.
export const EXTERNAL_STATUS_PAGE_MAX_REPORTED_INCIDENT_NAMES: number = 20;

// The longest incident name a check reports.
export const EXTERNAL_STATUS_PAGE_MAX_REPORTED_INCIDENT_NAME_LENGTH: number = 200;

export interface ExternalStatusPageScopeInput {
  components: Array<ExternalStatusPageComponent>;
  incidents: Array<ExternalStatusPageIncident>;
  componentGroupName?: string | undefined;
  componentNames: Array<string>;
  // The page's own status, when its provider reports one.
  pageOverallStatus?: string | undefined;
}

export interface ExternalStatusPageScopeResult {
  componentStatuses: Array<ExternalStatusPageComponentStatus>;
  overallStatus: string;
  activeIncidentCount: number;
  activeIncidentNames: Array<string>;
  incidentsOutsideScopeCount: number;
  unmatchedComponentNames: Array<string>;
}

export default class ExternalStatusPageScope {
  /*
   * Ranking of status vocabulary (higher = worse). Covers both Atlassian Statuspage
   * and incident.io component status strings.
   */
  public static getStatusRank(status: string): number {
    switch ((status || "").toLowerCase()) {
      case "operational":
        return 0;
      case "under_maintenance":
      case "maintenance":
        return 1;
      case "degraded_performance":
      case "degraded":
        return 2;
      case "partial_outage":
        return 3;
      case "major_outage":
      case "full_outage":
      case "critical":
        return 4;
      default:
        // Any unknown, non-operational status is treated as a degradation.
        return 2;
    }
  }

  /*
   * Whether a component's group is the monitor's group: its name contains
   * the group the monitor names, ignoring case. No group named: every
   * component's group is.
   */
  public static isInGroup(
    groupName: string | undefined,
    componentGroupName: string | undefined,
  ): boolean {
    if (!componentGroupName) {
      return true; // no filter -> everything matches
    }

    if (!groupName) {
      return false;
    }

    return groupName.toLowerCase().includes(componentGroupName.toLowerCase());
  }

  /*
   * The components of a page in a monitor's scope: those of its group,
   * and of them the ones its names pick (all of them, with no names).
   */
  public static getComponentsInScope(data: {
    components: Array<ExternalStatusPageComponent>;
    componentGroupName?: string | undefined;
    componentNames: Array<string>;
  }): Array<ExternalStatusPageComponent> {
    const isPicked: (componentName: string) => boolean =
      ExternalStatusPageComponentNames.picker(data.componentNames);

    return data.components.filter(
      (component: ExternalStatusPageComponent): boolean => {
        return (
          ExternalStatusPageScope.isInGroup(
            component.groupName,
            data.componentGroupName,
          ) &&
          (data.componentNames.length === 0 || isPicked(component.name))
        );
      },
    );
  }

  /*
   * The chosen names that pick no component of the monitor's group: a
   * typo, a component the page renamed or removed, or one of another group.
   */
  public static getUnmatchedNames(data: {
    components: Array<ExternalStatusPageComponent>;
    componentGroupName?: string | undefined;
    componentNames: Array<string>;
  }): Array<string> {
    return ExternalStatusPageComponentNames.unmatched(
      data.componentNames,
      data.components
        .filter((component: ExternalStatusPageComponent): boolean => {
          return ExternalStatusPageScope.isInGroup(
            component.groupName,
            data.componentGroupName,
          );
        })
        .map((component: ExternalStatusPageComponent): string => {
          return component.name;
        }),
    );
  }

  /*
   * Derives an overall status from the (already scoped) component list. Returns a
   * standard status string (e.g. "operational", "degraded_performance",
   * "major_outage") so it is comparable in monitor criteria.
   */
  public static deriveOverallStatus(
    components: Array<ExternalStatusPageComponent>,
    scopedIncidentCount: number,
  ): string {
    let worstStatus: string = "operational";
    let worstRank: number = 0;

    for (const component of components) {
      const rank: number = ExternalStatusPageScope.getStatusRank(
        component.status,
      );
      if (rank > worstRank) {
        worstRank = rank;
        worstStatus = component.status;
      }
    }

    if (worstRank === 0 && scopedIncidentCount > 0) {
      // No component is explicitly degraded, but there is an active incident in scope.
      return "degraded_performance";
    }

    return worstStatus;
  }

  /*
   * What a check of a structured page (Atlassian Statuspage, incident.io, a
   * OneUptime status page) reports for a monitor's scope.
   */
  public static apply(
    input: ExternalStatusPageScopeInput,
  ): ExternalStatusPageScopeResult {
    const componentNames: Array<string> = ExternalStatusPageComponentNames.normalize(
      input.componentNames,
    );
    const isScoped: boolean =
      Boolean(input.componentGroupName) || componentNames.length > 0;

    const targeted: Array<ExternalStatusPageComponent> =
      ExternalStatusPageScope.getComponentsInScope({
        components: input.components,
        componentGroupName: input.componentGroupName,
        componentNames: componentNames,
      });

    const counted: Array<ExternalStatusPageIncident> = isScoped
      ? ExternalStatusPageScope.getIncidentsInScope({
          components: input.components,
          targeted: targeted,
          incidents: input.incidents,
        })
      : input.incidents;

    const componentStatuses: Array<ExternalStatusPageComponentStatus> =
      targeted.map(
        (
          component: ExternalStatusPageComponent,
        ): ExternalStatusPageComponentStatus => {
          return {
            name: component.name,
            status: component.status,
            description: component.description,
            groupName: component.groupName,
          };
        },
      );

    let overallStatus: string;
    if (!isScoped && input.pageOverallStatus) {
      // Unscoped: prefer the provider's own page-level status when available.
      overallStatus = input.pageOverallStatus;
    } else {
      overallStatus = ExternalStatusPageScope.deriveOverallStatus(
        targeted,
        counted.length,
      );
    }

    return {
      componentStatuses: componentStatuses,
      overallStatus: overallStatus,
      activeIncidentCount: counted.length,
      activeIncidentNames: ExternalStatusPageScope.getReportedNames(counted),
      incidentsOutsideScopeCount: isScoped
        ? input.incidents.length - counted.length
        : 0,
      unmatchedComponentNames: ExternalStatusPageScope.getUnmatchedNames({
        components: input.components,
        componentGroupName: input.componentGroupName,
        componentNames: componentNames,
      }),
    };
  }

  /*
   * The incidents that affect a component in scope. By the components'
   * keys when the incident and the page both have them - two components of
   * one name in two groups are then told apart - and by name otherwise.
   */
  public static getIncidentsInScope(data: {
    components: Array<ExternalStatusPageComponent>;
    targeted: Array<ExternalStatusPageComponent>;
    incidents: Array<ExternalStatusPageIncident>;
  }): Array<ExternalStatusPageIncident> {
    const pageHasKeys: boolean = data.components.some(
      (component: ExternalStatusPageComponent): boolean => {
        return Boolean(component.key);
      },
    );

    const targetedKeys: Set<string> = new Set();
    const targetedNames: Set<string> = new Set();

    for (const component of data.targeted) {
      if (component.key) {
        targetedKeys.add(component.key);
      }

      targetedNames.add(
        ExternalStatusPageComponentNames.comparable(component.name),
      );
    }

    return data.incidents.filter(
      (incident: ExternalStatusPageIncident): boolean => {
        if (incident.affectedComponentKeys && pageHasKeys) {
          return incident.affectedComponentKeys.some((key: string): boolean => {
            return targetedKeys.has(key);
          });
        }

        return incident.affectedComponentNames.some((name: string): boolean => {
          return targetedNames.has(
            ExternalStatusPageComponentNames.comparable(name),
          );
        });
      },
    );
  }

  // The names of incidents a check reports: the first few, each cut short.
  public static getReportedNames(
    incidents: Array<{ name: string }>,
  ): Array<string> {
    return incidents
      .slice(0, EXTERNAL_STATUS_PAGE_MAX_REPORTED_INCIDENT_NAMES)
      .map((incident: { name: string }): string => {
        const name: string = incident.name.trim();

        return name.length > EXTERNAL_STATUS_PAGE_MAX_REPORTED_INCIDENT_NAME_LENGTH
          ? `${name.slice(0, EXTERNAL_STATUS_PAGE_MAX_REPORTED_INCIDENT_NAME_LENGTH - 1)}…`
          : name;
      })
      .filter((name: string): boolean => {
        return Boolean(name);
      });
  }
}
