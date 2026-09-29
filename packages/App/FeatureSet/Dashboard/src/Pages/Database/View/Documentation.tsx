import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "Common/Models/DatabaseModels/DatabaseServerEndpoint";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import DatabaseDocumentationCard from "../../../Components/DatabaseServer/DocumentationCard";
import { DatabaseDocumentationTarget } from "../Utils/DocumentationMarkdown";
import {
  DATABASE_NOT_FOUND_MESSAGE,
  DatabaseRuntimePlatform,
  getDatabaseEngineLabel,
  getDatabaseRuntimePlatform,
  isDatabaseServerFound,
} from "../Utils/DatabaseServerPresentation";

/*
 * The Database Agent guide prefilled for THIS database: its engine, the
 * address applications use, and its id as DATABASE_SERVER_ID (so the
 * agent's data joins this row whatever address it reports). A Kubernetes
 * database also gets the Deployment manifest for its namespace.
 */
const DatabaseServerDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [target, setTarget] = useState<DatabaseDocumentationTarget | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
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
          query: { databaseServerId: modelId },
          select: { endpoint: true, isPrimary: true },
          sort: { isPrimary: SortOrder.Descending },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        }),
      ]);

      // A deleted or unknown id comes back as an empty model, not null.
      if (!item || !isDatabaseServerFound(item)) {
        setError(DATABASE_NOT_FOUND_MESSAGE);
        setIsLoading(false);
        return;
      }

      setTarget({
        id: modelId.toString(),
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
          getDatabaseRuntimePlatform(item) ===
          DatabaseRuntimePlatform.Kubernetes,
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!target) {
    return <ErrorMessage message="Database not found." />;
  }

  return (
    <Fragment>
      <DatabaseDocumentationCard
        title={`Connect ${getDatabaseEngineLabel(target.dbSystem)} engine metrics`}
        description="Install the OneUptime Database Agent next to this database to add its engine metrics. Every value below is prefilled for this database, including its id."
        database={target}
      />
    </Fragment>
  );
};

export default DatabaseServerDocumentation;
