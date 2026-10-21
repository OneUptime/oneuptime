import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForStorageArray } from "Common/Utils/Telemetry/EntityKey";

const StorageArrayMetrics: FunctionComponent<
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
       * entityScope is the query scope (contract C4): new rows match via
       * the bloom-indexed `entityKeys` membership column, pre-column rows
       * (no backfill, empty array) via the attribute equality inside the
       * same OR. Do NOT also AND a separate attributes-equality filter —
       * that would defeat the OR (Kubernetes View/Metrics.tsx documents
       * the same trap). `attributeFilters` stays for the read-only scope
       * chip and the metric-name / sparkline scoping only.
       */}
      <MetricsViewer
        attributeFilters={{
          "resource.storage.array.name": storageArray.name,
        }}
        attributeFilterDisplayKeys={{
          "resource.storage.array.name": "Storage Array",
        }}
        entityScope={{
          entityKeys: [
            keyForStorageArray(
              ProjectUtil.getCurrentProjectId()!.toString(),
              storageArray.name,
            ),
          ],
          attributeKey: "resource.storage.array.name",
          attributeValue: storageArray.name,
        }}
      />
    </Fragment>
  );
};

export default StorageArrayMetrics;
