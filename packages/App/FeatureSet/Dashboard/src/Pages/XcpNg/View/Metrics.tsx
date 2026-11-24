import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForXcpNgPool } from "Common/Utils/Telemetry/EntityKey";

/*
 * Every series of one pool. They are matched on the pool's XAPI UUID
 * (resource.xcp_ng.pool.id, XcpNgPool.poolIdentifier), never on its name,
 * so a pool renamed in Xen Orchestra or here keeps all of its history; the
 * locked chip reads the pool's name all the same.
 */
const XcpNgPoolMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [pool, setPool] = useState<XcpNgPool | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: XcpNgPool | null = await ModelAPI.getItem({
        modelType: XcpNgPool,
        id: modelId,
        select: {
          name: true,
          poolIdentifier: true,
        },
      });

      if (!item?.poolIdentifier) {
        setError("Pool not found.");
        setIsLoading(false);
        return;
      }

      setPool(item);
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
    return <PageSkeleton shape="chart" />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!pool?.poolIdentifier) {
    return <ErrorMessage message="Pool not found." />;
  }

  return (
    <Fragment>
      {/*
       * entityScope is the query scope (contract C4): new rows match via the
       * bloom-indexed `entityKeys` membership column, rows without one via
       * the attribute equality inside the same OR. `attributeFilters` stays
       * for the read-only scope chip and the metric-name / sparkline
       * scoping. Do NOT also AND a separate attributes-equality filter into
       * the query itself — that defeats the OR. The filter keeps the UUID;
       * attributeFilterDisplayValues only swaps what the chip reads for the
       * pool's name.
       */}
      <MetricsViewer
        attributeFilters={{
          "resource.xcp_ng.pool.id": pool.poolIdentifier,
        }}
        attributeFilterDisplayKeys={{
          "resource.xcp_ng.pool.id": "XCP-ng Pool",
        }}
        attributeFilterDisplayValues={{
          "resource.xcp_ng.pool.id": pool.name || pool.poolIdentifier,
        }}
        entityScope={{
          entityKeys: [
            keyForXcpNgPool(
              ProjectUtil.getCurrentProjectId()!.toString(),
              pool.poolIdentifier,
            ),
          ],
          attributeKey: "resource.xcp_ng.pool.id",
          attributeValue: pool.poolIdentifier,
        }}
      />
    </Fragment>
  );
};

export default XcpNgPoolMetrics;
