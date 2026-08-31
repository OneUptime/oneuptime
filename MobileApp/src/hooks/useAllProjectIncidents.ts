import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchAllIncidents } from "../api/incidents";
import type {
  ListResponse,
  IncidentItem,
  ProjectIncidentItem,
  ProjectItem,
} from "../api/types";

const FETCH_LIMIT: number = 100;

interface UseAllProjectIncidentsResult {
  items: ProjectIncidentItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

export function useAllProjectIncidents(): UseAllProjectIncidentsResult {
  const { projectList, isLoadingProjects } = useProject();

  const query: UseQueryResult<ListResponse<IncidentItem>, Error> = useQuery({
    queryKey: ["incidents", "all-projects"],
    queryFn: () => {
      return fetchAllIncidents({ skip: 0, limit: FETCH_LIMIT });
    },
    enabled: projectList.length > 0,
  });

  const projectMap: Map<string, string> = useMemo(() => {
    const map: Map<string, string> = new Map();
    projectList.forEach((p: ProjectItem) => {
      map.set(p._id, p.name);
    });
    return map;
  }, [projectList]);

  const items: ProjectIncidentItem[] = useMemo(() => {
    const rows: IncidentItem[] | undefined = query.data?.data;
    /*
     * A 200 whose body is not the list envelope - a proxy or an error page
     * answering with {}, or a response whose `data` came back null - reaches
     * here with no rows array. Calling .map on that throws inside a useMemo,
     * which happens during render, so the screen unmounts into a red box
     * instead of showing its empty state. Anything that is not an array is
     * treated as no rows.
     */
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.map((item: IncidentItem): ProjectIncidentItem => {
      const pid: string = item.projectId ?? "";
      return {
        item,
        projectId: pid,
        projectName: projectMap.get(pid) ?? "",
      };
    });
  }, [query.data, projectMap]);

  const refetch: () => Promise<void> = async (): Promise<void> => {
    await query.refetch();
  };

  return {
    items,
    /*
     * Loading means "the answer is still coming", and for this hook the answer
     * depends on two requests. The project list has to arrive first, because
     * the query above stays disabled until there is a project to ask about,
     * so while the list is in flight this hook has nothing yet and says so.
     *
     * `query.isLoading` and not `query.isPending`: in react-query v5 pending
     * only means "no data", so a disabled query is pending FOREVER. Reporting
     * that as loading left a responder with no projects - a brand new account,
     * or one whose project fetch failed - staring at a skeleton that could
     * never resolve, with nothing to retry. isLoading is pending AND fetching,
     * so it is true only while a request is genuinely out.
     */
    isLoading: isLoadingProjects || query.isLoading,
    isError: query.isError,
    refetch,
  };
}
