import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
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
import { keyForVMwareVCenter } from "Common/Utils/Telemetry/EntityKey";

const VMwareVCenterMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [vcenter, setVCenter] = useState<VMwareVCenter | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: VMwareVCenter | null = await ModelAPI.getItem({
        modelType: VMwareVCenter,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!item?.name) {
        setError("vCenter not found.");
        setIsLoading(false);
        return;
      }

      setVCenter(item);
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

  if (!vcenter?.name) {
    return <ErrorMessage message="vCenter not found." />;
  }

  return (
    <Fragment>
      {/*
       * entityScope is the query scope (contract C4): new rows match via the
       * bloom-indexed `entityKeys` membership column, pre-column rows (no
       * backfill, empty array) via the attribute equality inside the same OR.
       * `attributeFilters` stays for the read-only scope chip and the
       * metric-name / sparkline scoping — display behavior is unchanged.
       * Do NOT also AND a separate attributes-equality filter into the query
       * itself — that defeats the OR. Drop the attribute fallback (here and
       * in the attributeFilters query merge) once deploy-date + max retention
       * has passed.
       */}
      <MetricsViewer
        attributeFilters={{
          "resource.vmware.vcenter.name": vcenter.name,
        }}
        attributeFilterDisplayKeys={{
          "resource.vmware.vcenter.name": "vCenter",
        }}
        entityScope={{
          entityKeys: [
            keyForVMwareVCenter(
              ProjectUtil.getCurrentProjectId()!.toString(),
              vcenter.name,
            ),
          ],
          attributeKey: "resource.vmware.vcenter.name",
          attributeValue: vcenter.name,
        }}
      />
    </Fragment>
  );
};

export default VMwareVCenterMetrics;
