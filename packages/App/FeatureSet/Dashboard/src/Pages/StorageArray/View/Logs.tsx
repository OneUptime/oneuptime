import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForStorageArray } from "Common/Utils/Telemetry/EntityKey";

/*
 * The array's own log: arrays forward syslog to the Storage Array Agent's
 * optional syslog receiver, whose resource processor stamps
 * `storage.array.name` on every line — the same scope as the Ceph Logs
 * page's `ceph.cluster.name`.
 */
const StorageArrayLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [storageArray, setStorageArray] = useState<StorageArray | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: StorageArray | null = await ModelAPI.getItem({
        modelType: StorageArray,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!item?.name) {
        setError("Storage array not found.");
        setIsLoading(false);
        return;
      }

      setStorageArray(item);
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

  const logQuery: Query<Log> = useMemo(() => {
    /*
     * `any` sidesteps a TS2589 deep-instantiation on Query<Log> with
     * inline attribute maps — same workaround the Host/Docker logs pages use.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      attributes: {
        "resource.storage.array.name": storageArray?.name || "",
      },
    };
    return q as Query<Log>;
  }, [storageArray?.name]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!storageArray?.name) {
    return <ErrorMessage message="Storage array not found." />;
  }

  return (
    <Fragment>
      {/*
       * entityScope matches new rows via the bloom-indexed `entityKeys`
       * membership column, with the resource-attribute equality as the
       * fallback inside the same OR — the pattern Kubernetes/View pages use.
       *
       * The chip value is already the array's name, so only the key needs a
       * label: "Storage Array" (as on the Metrics tab) instead of the raw
       * OTel key.
       */}
      <DashboardLogsViewer
        id={`storage-array-logs-${modelId.toString()}`}
        logQuery={logQuery}
        attributeFilterDisplayKeys={{
          "resource.storage.array.name": "Storage Array",
        }}
        entityScope={{
          entityKeys: [
            keyForStorageArray(
              ProjectUtil.getCurrentProjectId()!.toString(),
              storageArray.name!,
            ),
          ],
          attributeKey: "resource.storage.array.name",
          attributeValue: storageArray.name!,
        }}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No logs found for this storage array. The Storage Array Agent ships metrics by default — forward the array's syslog to the agent's optional syslog receiver and its lines appear here, tagged with the storage.array.name resource attribute."
      />
    </Fragment>
  );
};

export default StorageArrayLogs;
