import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
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
import {
  buildSavedViewScope,
  SavedViewScopeKind,
} from "Common/Utils/Telemetry/SavedViewScope";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForOpenStackCloud } from "Common/Utils/Telemetry/EntityKey";
import {
  OPENSTACK_REQUEST_QUERY_PARAM,
  OPENSTACK_REQUEST_TIME_QUERY_PARAM,
} from "Common/Utils/OpenStack/OpenStackRequestTrail";
import OpenStackRequestTrail from "../../../Components/OpenStack/OpenStackRequestTrail";

const OpenStackCloudLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cloud, setCloud] = useState<OpenStackCloud | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: OpenStackCloud | null = await ModelAPI.getItem({
        modelType: OpenStackCloud,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!item?.name) {
        setError("Cloud not found.");
        setIsLoading(false);
        return;
      }

      setCloud(item);
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
        "resource.openstack.cloud.name": cloud?.name || "",
      },
    };
    return q as Query<Log>;
  }, [cloud?.name]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cloud?.name) {
    return <ErrorMessage message="Cloud not found." />;
  }

  // One request across every service, when a log line or an instance's page opened one.
  const followedRequest: string | null = Navigation.getQueryStringByName(
    OPENSTACK_REQUEST_QUERY_PARAM,
  );

  if (followedRequest) {
    const at: string | null = Navigation.getQueryStringByName(
      OPENSTACK_REQUEST_TIME_QUERY_PARAM,
    );
    const atDate: Date | null = at ? new Date(at) : null;

    return (
      <OpenStackRequestTrail
        key={followedRequest}
        openStackCloudId={modelId}
        cloudName={cloud.name}
        rootId={followedRequest}
        at={atDate && !isNaN(atDate.getTime()) ? atDate : null}
      />
    );
  }

  return (
    <Fragment>
      {/*
       * entityScope is the query scope (contract C4): new rows match via the
       * bloom-indexed `entityKeys` membership column, pre-column rows (no
       * backfill, empty array) via the attribute equality inside the same OR.
       * `logQuery.attributes` stays for the histogram / facet scoping —
       * display behavior is unchanged. Do NOT also AND a separate
       * attributes-equality filter into the query itself — that defeats the
       * OR. Drop the attribute fallback (here and in the logQuery merge)
       * once deploy-date + max retention has passed.
       *
       * The chip value is already the cloud's name, so only the key needs a
       * label: "Cloud" (as on the Metrics tab) instead of the raw OTel key.
       */}
      <DashboardLogsViewer
        id={`openstack-cloud-logs-${modelId.toString()}`}
        savedViewScope={buildSavedViewScope(
          SavedViewScopeKind.OpenStackCloud,
          modelId,
        )}
        logQuery={logQuery}
        attributeFilterDisplayKeys={{
          "resource.openstack.cloud.name": "Cloud",
        }}
        entityScope={{
          entityKeys: [
            keyForOpenStackCloud(
              ProjectUtil.getCurrentProjectId()!.toString(),
              cloud.name!,
            ),
          ],
          attributeKey: "resource.openstack.cloud.name",
          attributeValue: cloud.name!,
        }}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No logs from this cloud yet. They appear once the agent's logs profile runs on its controllers and compute nodes: the OpenStack guide says how."
      />
    </Fragment>
  );
};

export default OpenStackCloudLogs;
