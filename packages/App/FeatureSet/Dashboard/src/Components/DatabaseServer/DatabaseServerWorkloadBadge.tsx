import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import { getDatabaseEngineLabel } from "../../Pages/Database/Utils/DatabaseServerPresentation";
import {
  DATABASE_WORKLOAD_LOOKUP_LIMIT,
  DatabaseWorkloadTarget,
  buildDatabaseWorkloadQuery,
  getDatabaseWorkloadTargetKey,
  isDatabaseWorkloadClusterMatch,
} from "./DatabaseWorkloadLookup";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * "Open database" on a Kubernetes StatefulSet / Deployment / pod page and a
 * Docker / Podman container page: the Database discovered on it, found with
 * ONE query on the row's workload columns (DatabaseWorkloadLookup) that
 * reads only id, name, engine and workload name. Renders nothing while that
 * runs, when nothing matches, and when the lookup fails (no read permission
 * on Databases, say) — a missing link must never be an error on a page about
 * something else. `target` is null until the page knows enough to ask (a
 * StatefulSet's namespace comes with its object, a container's labels with
 * its inventory row).
 *
 * The sentence says what the object is to the database: it "runs" it, or —
 * matched only through the cluster its operator labels it part of (a
 * pooler, a backup repo host) — it "is part of" the database's cluster.
 */

export interface ComponentProps {
  target: DatabaseWorkloadTarget | null;
  // What the page shows, for the sentence: "StatefulSet", "pod", "container".
  resourceLabel: string;
}

const DatabaseServerWorkloadBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [databases, setDatabases] = useState<Array<DatabaseServer>>([]);
  const targetKey: string = getDatabaseWorkloadTargetKey(props.target);

  useEffect(() => {
    const query: Query<DatabaseServer> | null = buildDatabaseWorkloadQuery(
      props.target,
    );
    setDatabases([]);
    if (!query) {
      return;
    }

    let ignore: boolean = false;

    /*
     * Everything inside the try, the call itself included: whatever goes
     * wrong, the page this sits on renders as if there were no database.
     */
    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<DatabaseServer> =
          await ModelAPI.getList<DatabaseServer>({
            modelType: DatabaseServer,
            query: query,
            select: {
              _id: true,
              name: true,
              dbSystem: true,
              workloadName: true,
            },
            sort: { name: SortOrder.Ascending },
            skip: 0,
            limit: DATABASE_WORKLOAD_LOOKUP_LIMIT,
          });
        if (!ignore) {
          setDatabases(result.data || []);
        }
      } catch {
        // Best-effort: no link rather than an error.
      }
    };

    load().catch((): void => {});

    return (): void => {
      ignore = true;
    };
  }, [targetKey]);

  const rows: Array<DatabaseServer> = databases.filter(
    (database: DatabaseServer): boolean => {
      return Boolean(database._id);
    },
  );

  if (rows.length === 0) {
    return <></>;
  }

  return (
    <div
      data-testid="database-server-workload-badge"
      className="mb-4 space-y-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-2.5"
    >
      {rows.map((database: DatabaseServer): ReactElement => {
        const route: Route = RouteUtil.populateRouteParams(
          RouteMap[PageMap.DATABASE_SERVER_VIEW] as Route,
          { modelId: new ObjectID(database._id as string) },
        );
        const engine: string = getDatabaseEngineLabel(database.dbSystem);
        const isClusterMatch: boolean = isDatabaseWorkloadClusterMatch(
          props.target,
          database.workloadName,
        );
        return (
          <div
            key={database._id as string}
            data-testid="database-server-workload-badge-item"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
          >
            <Icon
              icon={IconProp.Database}
              className="h-4 w-4 flex-shrink-0 text-indigo-600"
            />
            <span className="text-gray-700">
              This {props.resourceLabel}{" "}
              {isClusterMatch
                ? `is part of the ${engine} database cluster`
                : `runs the ${engine} database`}{" "}
              <span className="font-medium text-gray-900">
                {(database.name as string) || engine}
              </span>
              .
            </span>
            <AppLink
              to={route}
              className="font-medium text-indigo-700 hover:underline"
            >
              Open database →
            </AppLink>
          </div>
        );
      })}
    </div>
  );
};

export default DatabaseServerWorkloadBadge;
