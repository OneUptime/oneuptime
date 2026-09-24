import {
  DatabaseServerScopeSource,
  buildDatabaseServerEntityKeyDisplays,
  getDatabaseServerScopeKeys,
} from "../../Pages/Database/Utils/DatabaseTelemetryScope";
import { LockedEntityKeyDisplayMap } from "../../Utils/LockedEntityKeyChips";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "Common/Models/DatabaseModels/DatabaseServerEndpoint";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useMemo, useState } from "react";

/*
 * Loads what a Database's telemetry tabs scope by — the row (its id, engine,
 * member keys) and its stored endpoints — and derives the entity-key set and
 * the locked-chip names from them through DatabaseTelemetryScope. The Logs,
 * Traces and Metrics tabs all read this one hook so none of them can build
 * the scope differently, and each checks `keys.length` before it mounts a
 * viewer (an empty set is "unscoped", never "the whole project").
 */

export interface UseDatabaseServerTelemetryScopeResult {
  databaseServer: DatabaseServer | null;
  endpoints: Array<string>;
  keys: Array<string>;
  entityKeyDisplays: LockedEntityKeyDisplayMap;
  isLoading: boolean;
  error: string;
}

const useDatabaseServerTelemetryScope: (
  modelId: ObjectID,
) => UseDatabaseServerTelemetryScopeResult = (
  modelId: ObjectID,
): UseDatabaseServerTelemetryScopeResult => {
  const [databaseServer, setDatabaseServer] = useState<DatabaseServer | null>(
    null,
  );
  const [endpoints, setEndpoints] = useState<Array<string>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let ignore: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        const [item, endpointResult]: [
          DatabaseServer | null,
          ListResult<DatabaseServerEndpoint>,
        ] = await Promise.all([
          ModelAPI.getItem<DatabaseServer>({
            modelType: DatabaseServer,
            id: modelId,
            select: {
              name: true,
              projectId: true,
              dbSystem: true,
              memberEntityKeys: true,
            },
          }),
          ModelAPI.getList<DatabaseServerEndpoint>({
            modelType: DatabaseServerEndpoint,
            query: { databaseServerId: modelId },
            select: { endpoint: true, isPrimary: true },
            sort: { isPrimary: SortOrder.Descending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          }),
        ]);

        if (ignore) {
          return;
        }

        if (!item) {
          setError("Database not found.");
          setIsLoading(false);
          return;
        }

        setDatabaseServer(item);
        setEndpoints(
          (endpointResult.data || [])
            .map((row: DatabaseServerEndpoint): string => {
              return (row.endpoint || "").toString();
            })
            .filter((value: string): boolean => {
              return value.trim().length > 0;
            }),
        );
      } catch (err) {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      }
      if (!ignore) {
        setIsLoading(false);
      }
    };

    load().catch((err: Error) => {
      if (!ignore) {
        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      }
    });

    return () => {
      ignore = true;
    };
  }, [modelId.toString()]);

  const source: DatabaseServerScopeSource & { name?: string | undefined } =
    useMemo(() => {
      return {
        projectId:
          databaseServer?.projectId || ProjectUtil.getCurrentProjectId(),
        /*
         * The row key: telemetry linked by oneuptime.database.server.id is
         * this database's whatever address the agent reported.
         */
        id: modelId,
        endpoints: endpoints,
        dbSystem: databaseServer?.dbSystem,
        memberEntityKeys: databaseServer?.memberEntityKeys,
        name: databaseServer?.name,
      };
    }, [databaseServer, endpoints, modelId.toString()]);

  /*
   * Memoised on the loaded row: the viewers key their query and chip memos
   * on the identity of these values.
   */
  const keys: Array<string> = useMemo(() => {
    return databaseServer ? getDatabaseServerScopeKeys(source) : [];
  }, [source]);

  const entityKeyDisplays: LockedEntityKeyDisplayMap = useMemo(() => {
    return databaseServer ? buildDatabaseServerEntityKeyDisplays(source) : {};
  }, [source]);

  return {
    databaseServer,
    endpoints,
    keys,
    entityKeyDisplays,
    isLoading,
    error,
  };
};

export default useDatabaseServerTelemetryScope;
