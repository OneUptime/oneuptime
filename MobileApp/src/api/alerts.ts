import { getList, create } from "@/api/modelApi";
import { Alert, AlertState, PaginationResult } from "@/types/models";
import { ensureListIds } from "@/utils/normalizers";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";

const ALERT_PATH = "/alert";
const ALERT_STATE_PATH = "/alert-state";
const ALERT_STATE_TIMELINE_PATH = "/alert-state-timeline";

export const fetchAlertStates = async (projectId: string): Promise<AlertState[]> => {
  const response = await getList<AlertState>({
    path: ALERT_STATE_PATH,
    query: {
      projectId: new ObjectID(projectId),
    },
    select: {
      name: true,
      color: true,
      isAcknowledgedState: true,
      isResolvedState: true,
      order: true,
    },
    sort: {
      order: {
        _type: "Ascending",
      },
    },
    limit: 100,
    skip: 0,
  });

  return ensureListIds(response.data) as AlertState[];
};

export const fetchActiveAlerts = async (
  projectId: string,
  unresolvedStateIds: string[],
): Promise<PaginationResult<Alert>> => {
  const response = await getList<Alert>({
    path: ALERT_PATH,
    query: {
      projectId: new ObjectID(projectId),
      currentAlertStateId: new Includes(unresolvedStateIds),
    },
    select: {
      title: true,
      description: true,
      monitors: {
        name: true,
        _id: true,
      },
      currentAlertState: {
        name: true,
        color: true,
      },
      createdAt: true,
    },
    sort: {
      createdAt: {
        _type: "Descending",
      },
    },
    limit: 25,
    skip: 0,
  });

  return {
    ...response,
    data: ensureListIds(response.data) as Alert[],
  };
};

export const acknowledgeAlert = async (params: {
  projectId: string;
  alertId: string;
  acknowledgedStateId: string;
}): Promise<void> => {
  const { projectId, alertId, acknowledgedStateId } = params;

  await create({
    path: ALERT_STATE_TIMELINE_PATH,
    data: {
      projectId: new ObjectID(projectId),
      alertId: new ObjectID(alertId),
      alertStateId: new ObjectID(acknowledgedStateId),
    },
  });
};

export const resolveAlert = async (params: {
  projectId: string;
  alertId: string;
  resolvedStateId: string;
}): Promise<void> => {
  const { projectId, alertId, resolvedStateId } = params;

  await create({
    path: ALERT_STATE_TIMELINE_PATH,
    data: {
      projectId: new ObjectID(projectId),
      alertId: new ObjectID(alertId),
      alertStateId: new ObjectID(resolvedStateId),
    },
  });
};
