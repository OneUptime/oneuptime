import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "Common/Models/DatabaseModels/DatabaseServerEndpoint";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { DatabaseDocumentationTarget } from "./DocumentationMarkdown";
import {
  DatabaseRuntimePlatform,
  getDatabaseRuntimePlatform,
  isDatabaseServerFound,
} from "./DatabaseServerPresentation";

/*
 * The Database Agent guide's target for one database: its engine, the
 * address applications use and every other endpoint stored for it, its id
 * (DATABASE_SERVER_ID, so the agent's data joins this row whatever address
 * it reports), and where it runs. Read by the database's Documentation tab
 * and by the guide that opens once Add Database has saved one.
 *
 * Null for a database that is not there: a deleted or unknown id comes back
 * as an empty model, not null.
 */
export async function fetchDatabaseDocumentationTarget(
  id: ObjectID,
): Promise<DatabaseDocumentationTarget | null> {
  const [item, endpointResult]: [
    DatabaseServer | null,
    ListResult<DatabaseServerEndpoint>,
  ] = await Promise.all([
    ModelAPI.getItem<DatabaseServer>({
      modelType: DatabaseServer,
      id: id,
      select: {
        name: true,
        dbSystem: true,
        serverAddress: true,
        serverPort: true,
        discoverySource: true,
        kubernetesClusterId: true,
        kubernetesNamespace: true,
        dockerHostId: true,
        podmanHostId: true,
      },
    }),
    ModelAPI.getList<DatabaseServerEndpoint>({
      modelType: DatabaseServerEndpoint,
      query: { databaseServerId: id },
      select: { endpoint: true, isPrimary: true },
      sort: { isPrimary: SortOrder.Descending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
  ]);

  if (!item || !isDatabaseServerFound(item)) {
    return null;
  }

  return {
    id: id.toString(),
    name: item.name,
    dbSystem: item.dbSystem,
    serverAddress: item.serverAddress,
    serverPort: item.serverPort,
    endpoints: (endpointResult.data || [])
      .map((row: DatabaseServerEndpoint): string => {
        return (row.endpoint || "").toString();
      })
      .filter((value: string): boolean => {
        return value.trim().length > 0;
      }),
    kubernetesNamespace: item.kubernetesNamespace,
    isKubernetes:
      getDatabaseRuntimePlatform(item) === DatabaseRuntimePlatform.Kubernetes,
  };
}
