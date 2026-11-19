import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useSelectedProjectId } from "./useProject";
import { fetchProjectUsers } from "../api/projectUsers";
import { fetchIncidentStates } from "../api/incidents";
import { fetchAlertStates } from "../api/alerts";
import { fetchMonitorStatuses } from "../api/monitors";
import {
  fetchLabels,
  fetchMonitorOptions,
  fetchSeverities,
  fetchTeams,
  type LabelOptionItem,
  type MonitorOptionItem,
  type SeverityOptionItem,
  type TeamOptionItem,
} from "../api/recordFilters";
import type {
  AlertState,
  IncidentState,
  MonitorStatusItem,
  ProjectUserItem,
} from "../api/types";
import { getFilterFacets, type FilterableList } from "../filters/recordFilters";
import {
  NO_OPTIONS,
  type FilterOption,
  type FilterOptionList,
  type FilterSheetOptions,
} from "../filters/filterOptions";
import { rgbToHex } from "../utils/color";

// Options change rarely: read once a few minutes, not on every opening.
const OPTIONS_STALE_TIME_MS: number = 5 * 60 * 1000;

type StateRow = IncidentState | AlertState | MonitorStatusItem;

function toOptionList<T>(
  query: UseQueryResult<Array<T>, Error> | null,
  toOption: (row: T) => FilterOption,
  emptyMessage?: string,
): FilterOptionList {
  if (!query) {
    return NO_OPTIONS;
  }
  return {
    options: (query.data ?? []).map(toOption),
    isLoading: query.isPending && query.fetchStatus !== "idle",
    isError: query.isError,
    onRetry: (): void => {
      void query.refetch();
    },
    emptyMessage: emptyMessage,
  };
}

/*
 * The values a list's filter sheet offers, read for the selected project
 * only while `enabled` - the sheet is open, or a filter is on and its chip
 * needs names - so a list nobody filters costs no extra requests. States
 * share the list's own cache entry.
 */
export function useFilterOptions(
  list: FilterableList,
  enabled: boolean,
): FilterSheetOptions {
  const projectId: string = useSelectedProjectId() ?? "";
  const facets: Array<string> = getFilterFacets(list);
  const isOn: (facet: string) => boolean = (facet: string): boolean => {
    return enabled && Boolean(projectId) && facets.includes(facet);
  };
  const recordKind: "incident" | "alert" | "monitor" =
    list === "incidents" || list === "incidentEpisodes"
      ? "incident"
      : list === "monitors"
        ? "monitor"
        : "alert";

  const people: UseQueryResult<Array<ProjectUserItem>, Error> = useQuery({
    queryKey: ["project-users", projectId || "none"],
    queryFn: (): Promise<Array<ProjectUserItem>> => {
      return fetchProjectUsers(projectId);
    },
    enabled: isOn("owner"),
    staleTime: OPTIONS_STALE_TIME_MS,
  });
  const teams: UseQueryResult<Array<TeamOptionItem>, Error> = useQuery({
    queryKey: ["teams", projectId],
    queryFn: (): Promise<Array<TeamOptionItem>> => {
      return fetchTeams(projectId);
    },
    enabled: isOn("owner"),
    staleTime: OPTIONS_STALE_TIME_MS,
  });
  const states: UseQueryResult<Array<StateRow>, Error> = useQuery({
    queryKey: [
      recordKind === "incident"
        ? "incident-states"
        : recordKind === "alert"
          ? "alert-states"
          : "monitor-statuses",
      projectId,
    ],
    queryFn: (): Promise<Array<StateRow>> => {
      if (recordKind === "incident") {
        return fetchIncidentStates(projectId);
      }
      if (recordKind === "alert") {
        return fetchAlertStates(projectId);
      }
      return fetchMonitorStatuses(projectId);
    },
    enabled: isOn("state"),
    staleTime: OPTIONS_STALE_TIME_MS,
  });
  const severities: UseQueryResult<Array<SeverityOptionItem>, Error> = useQuery(
    {
      queryKey: [`${recordKind}-severities`, projectId],
      queryFn: (): Promise<Array<SeverityOptionItem>> => {
        return fetchSeverities(
          projectId,
          recordKind === "incident" ? "incident" : "alert",
        );
      },
      enabled: isOn("severity"),
      staleTime: OPTIONS_STALE_TIME_MS,
    },
  );
  const labels: UseQueryResult<Array<LabelOptionItem>, Error> = useQuery({
    queryKey: ["labels", projectId],
    queryFn: (): Promise<Array<LabelOptionItem>> => {
      return fetchLabels(projectId);
    },
    enabled: isOn("label"),
    staleTime: OPTIONS_STALE_TIME_MS,
  });
  const monitors: UseQueryResult<Array<MonitorOptionItem>, Error> = useQuery({
    queryKey: ["monitor-options", projectId],
    queryFn: (): Promise<Array<MonitorOptionItem>> => {
      return fetchMonitorOptions(projectId);
    },
    enabled: isOn("monitor") || isOn("monitorType"),
    staleTime: OPTIONS_STALE_TIME_MS,
  });

  const monitorTypes: Array<string> = Array.from(
    new Set(
      (monitors.data ?? [])
        .map((monitor: MonitorOptionItem): string => {
          return monitor.monitorType ?? "";
        })
        .filter((type: string): boolean => {
          return type.length > 0;
        }),
    ),
  ).sort((a: string, b: string): number => {
    return a.localeCompare(b);
  });

  return {
    people: toOptionList(
      isOn("owner") ? people : null,
      (user: ProjectUserItem): FilterOption => {
        return {
          id: user.userId,
          label: user.name || user.email,
          detail: user.name && user.email ? user.email : undefined,
        };
      },
    ),
    teams: toOptionList(
      isOn("owner") ? teams : null,
      (team: TeamOptionItem): FilterOption => {
        return { id: team._id, label: team.name };
      },
    ),
    states: toOptionList(
      isOn("state") ? states : null,
      (state: StateRow): FilterOption => {
        return {
          id: state._id,
          label: state.name,
          dotColor: rgbToHex(state.color),
        };
      },
    ),
    severities: toOptionList(
      isOn("severity") ? severities : null,
      (severity: SeverityOptionItem): FilterOption => {
        return {
          id: severity._id,
          label: severity.name,
          dotColor: severity.color ? rgbToHex(severity.color) : undefined,
        };
      },
    ),
    labels: toOptionList(
      isOn("label") ? labels : null,
      (label: LabelOptionItem): FilterOption => {
        return {
          id: label._id,
          label: label.name,
          dotColor: label.color ? rgbToHex(label.color) : undefined,
        };
      },
      "No labels in this project yet.",
    ),
    monitors: toOptionList(
      isOn("monitor") ? monitors : null,
      (monitor: MonitorOptionItem): FilterOption => {
        return {
          id: monitor._id,
          label: monitor.name,
          detail: monitor.monitorType,
        };
      },
      "No monitors in this project yet.",
    ),
    // A monitor's type, as the server names it ("Website", "API"): the types the project uses.
    monitorTypes: isOn("monitorType")
      ? {
          options: monitorTypes.map((type: string): FilterOption => {
            return { id: type, label: type };
          }),
          isLoading: monitors.isPending && monitors.fetchStatus !== "idle",
          isError: monitors.isError,
          onRetry: (): void => {
            void monitors.refetch();
          },
          emptyMessage: "No monitors in this project yet.",
        }
      : NO_OPTIONS,
  };
}
