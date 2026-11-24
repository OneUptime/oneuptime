import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
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
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import {
  buildSavedViewScope,
  SavedViewScopeKind,
} from "Common/Utils/Telemetry/SavedViewScope";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForXcpNgPool } from "Common/Utils/Telemetry/EntityKey";

/*
 * One pool's logs. The XCP-ng Agent reads Xen Orchestra's OpenMetrics
 * plugin, which serves metrics only, so a pool has logs only where someone
 * sends them with the pool's xcp_ng.pool.id resource attribute: the empty
 * list says so, rather than looking like a read that failed.
 */
const XcpNgPoolLogs: FunctionComponent<
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

  const logQuery: Query<Log> = useMemo(() => {
    /*
     * `any` sidesteps a TS2589 deep-instantiation on Query<Log> with
     * inline attribute maps — same workaround the Host/Docker logs pages use.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      attributes: {
        "resource.xcp_ng.pool.id": pool?.poolIdentifier || "",
      },
    };
    return q as Query<Log>;
  }, [pool?.poolIdentifier]);

  if (isLoading) {
    return <PageSkeleton shape="table" />;
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
       * the attribute equality inside the same OR. `logQuery.attributes`
       * stays for the histogram / facet scoping. Do NOT also AND a separate
       * attributes-equality filter into the query itself — that defeats the
       * OR.
       *
       * The attribute value is the pool's UUID, which is what the filter must
       * match, but the locked chip would read "resource.xcp_ng.pool.id:
       * <uuid>". The display overrides label it "Pool: <name>" without
       * touching the filter.
       */}
      <DashboardLogsViewer
        id={`xcp-ng-pool-logs-${modelId.toString()}`}
        savedViewScope={buildSavedViewScope(
          SavedViewScopeKind.XcpNgPool,
          modelId,
        )}
        logQuery={logQuery}
        attributeFilterDisplayKeys={{
          "resource.xcp_ng.pool.id": "Pool",
        }}
        attributeFilterDisplayValues={{
          "resource.xcp_ng.pool.id": pool.name || pool.poolIdentifier!,
        }}
        entityScope={{
          entityKeys: [
            keyForXcpNgPool(
              ProjectUtil.getCurrentProjectId()!.toString(),
              pool.poolIdentifier!,
            ),
          ],
          attributeKey: "resource.xcp_ng.pool.id",
          attributeValue: pool.poolIdentifier!,
        }}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="The XCP-ng Agent sends no logs yet: it reads Xen Orchestra's metrics only. Logs appear here when you send OpenTelemetry logs with this pool's xcp_ng.pool.id resource attribute."
      />
    </Fragment>
  );
};

export default XcpNgPoolLogs;
