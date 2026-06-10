import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
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
import TracesViewer from "../../../Components/Traces/TracesViewer";
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForHost } from "Common/Utils/Telemetry/EntityKey";

const HostTraces: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<Host | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: Host | null = await ModelAPI.getItem({
        modelType: Host,
        id: modelId,
        select: {
          hostIdentifier: true,
          name: true,
        },
      });

      if (!item?.hostIdentifier) {
        setError("Host not found.");
        setIsLoading(false);
        return;
      }

      setHost(item);
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

  if (!host?.hostIdentifier) {
    return <ErrorMessage message="Host not found." />;
  }

  return (
    <Fragment>
      {/*
       * entityScope is the query scope (contract C4): new rows match via the
       * bloom-indexed `entityKeys` membership column, pre-column rows (no
       * backfill, empty array) via the attribute equality inside the same OR.
       * `attributeFilters` stays for the read-only scope chip and the
       * histogram / facet scoping — display behavior is unchanged. Drop the
       * attribute fallback (here and in the attributeFilters query merge)
       * once deploy-date + max retention has passed.
       */}
      <TracesViewer
        attributeFilters={{
          "resource.host.name": host.hostIdentifier,
        }}
        attributeFilterDisplayKeys={{
          "resource.host.name": "Host",
        }}
        entityScope={{
          entityKeys: [
            keyForHost(
              ProjectUtil.getCurrentProjectId()!.toString(),
              host.hostIdentifier,
            ),
          ],
          attributeKey: "resource.host.name",
          attributeValue: host.hostIdentifier,
        }}
      />
    </Fragment>
  );
};

export default HostTraces;
