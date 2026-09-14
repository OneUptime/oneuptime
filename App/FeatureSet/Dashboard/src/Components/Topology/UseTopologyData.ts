import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useCallback, useEffect, useState } from "react";
import { buildTopologyInventoryItemQuery } from "./TopologyInventoryData";

interface TopologyDataSnapshot {
  entities: Array<InventoryItem>;
  relationships: Array<InventoryItemRelationship>;
  isLoading: boolean;
  error: string;
  isTruncated: boolean;
  lastUpdatedAt: Date | null;
}

export interface TopologyData extends TopologyDataSnapshot {
  reload: () => void;
}

const EMPTY_SNAPSHOT: TopologyDataSnapshot = {
  entities: [],
  relationships: [],
  isLoading: true,
  error: "",
  isTruncated: false,
  lastUpdatedAt: null,
};

/**
 * Both telemetry maps use one consistent inventory/relationship snapshot.
 * An obsolete request must not overwrite a newer range, project, or retry.
 * Network discovery has its own data source and does not depend on this hook.
 */
export default function useTopologyData(
  timeRange: RangeStartAndEndDateTime,
): TopologyData {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();
  const [snapshot, setSnapshot] =
    useState<TopologyDataSnapshot>(EMPTY_SNAPSHOT);
  const [reloadVersion, setReloadVersion] = useState<number>(0);
  const reload: () => void = useCallback((): void => {
    setReloadVersion((previous: number): number => {
      return previous + 1;
    });
  }, []);

  useEffect(() => {
    let cancelled: boolean = false;
    setSnapshot(EMPTY_SNAPSHOT);

    const load: () => Promise<void> = async (): Promise<void> => {
      if (!projectId) {
        setSnapshot({
          ...EMPTY_SNAPSHOT,
          isLoading: false,
          error: "Select a project to view topology.",
        });
        return;
      }

      try {
        const window: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
        const currentProjectId: ObjectID = new ObjectID(projectId);
        const [entityResult, relationshipResult]: [
          ListResult<InventoryItem>,
          ListResult<InventoryItemRelationship>,
        ] = await Promise.all([
          ModelAPI.getList<InventoryItem>({
            modelType: InventoryItem,
            query: buildTopologyInventoryItemQuery(currentProjectId),
            select: {
              _id: true,
              entityKey: true,
              displayName: true,
              entityType: true,
              resourceType: true,
              resourceId: true,
              firstSeenAt: true,
              lastSeenAt: true,
            },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          }),
          ModelAPI.getList<InventoryItemRelationship>({
            modelType: InventoryItemRelationship,
            query: {
              projectId: currentProjectId,
              /*
               * The registry stores each connection's latest observation,
               * not historical samples. An upper bound on lastSeenAt would
               * discard ongoing connections from older ranges. This is a
               * recency filter; traffic metrics remain the latest window.
               */
              lastSeenAt: new GreaterThanOrEqual<Date>(window.startValue),
            },
            select: {
              fromEntityKey: true,
              toEntityKey: true,
              relationshipType: true,
              callCount: true,
              errorCount: true,
              avgDurationMs: true,
            },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          }),
        ]);

        if (!cancelled) {
          setSnapshot({
            entities: entityResult.data,
            relationships: relationshipResult.data,
            isLoading: false,
            error: "",
            isTruncated:
              entityResult.count > entityResult.data.length ||
              relationshipResult.count > relationshipResult.data.length,
            lastUpdatedAt: new Date(),
          });
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setSnapshot({
            ...EMPTY_SNAPSHOT,
            isLoading: false,
            error: API.getFriendlyMessage(error),
          });
        }
      }
    };

    void load();
    return (): void => {
      cancelled = true;
    };
  }, [timeRange, projectId, reloadVersion]);

  return { ...snapshot, reload };
}
