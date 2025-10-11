import { getList } from "@/api/modelApi";
import { Monitor, PaginationResult } from "@/types/models";
import { ensureListIds } from "@/utils/normalizers";
import ObjectID from "Common/Types/ObjectID";

const MONITOR_PATH = "/monitor";

export const fetchInoperationalMonitors = async (
  projectId: string,
): Promise<PaginationResult<Monitor>> => {
  const response = await getList<Monitor>({
    path: MONITOR_PATH,
    query: {
      projectId: new ObjectID(projectId),
      currentMonitorStatus: {
        isOperationalState: false,
      },
    },
    select: {
      name: true,
      description: true,
      currentMonitorStatus: {
        name: true,
        color: true,
        isOperationalState: true,
      },
      lastPingAt: true,
    },
    sort: {
      updatedAt: {
        _type: "Descending",
      },
    },
    limit: 50,
    skip: 0,
  });

  return {
    ...response,
    data: ensureListIds(response.data) as Monitor[],
  };
};
