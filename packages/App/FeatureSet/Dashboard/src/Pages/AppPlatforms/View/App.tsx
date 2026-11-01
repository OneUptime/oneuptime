import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import CloudAppHeader from "../../../Components/AppPlatforms/CloudAppHeader";
import CloudAppOverviewTab from "../../../Components/AppPlatforms/CloudAppOverviewTab";
import CloudAppRevisionsTab from "../../../Components/AppPlatforms/CloudAppRevisionsTab";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import useAutoRefresh from "../../../Components/TelemetryResource/useAutoRefresh";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import TracesViewer from "../../../Components/Traces/TracesViewer";
import { CloudInstancesTable } from "./Instances";
import {
  countLiveInstancesByApp,
  getCloudAppTelemetryDisplayKeys,
  getCloudAppTelemetryDisplayValues,
  getCloudAppTelemetryFilters,
  isCloudAppScoped,
} from "../Utils/CloudApps";
import { getCloudResourceAttributeDisplayKeys } from "../Utils/CloudResourceTelemetryScope";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudAppRevision from "Common/Models/DatabaseModels/CloudAppRevision";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import Service from "Common/Models/DatabaseModels/Service";
import Log from "Common/Models/AnalyticsModels/Log";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * One app of an App Platforms environment - an ECS service, a Cloud Run
 * service, a Container App - as its platform's console shows a service, and
 * as a Kubernetes Deployment's page does:
 *
 *   - the header: whether it runs and on how many instances, where, the
 *     revision it runs and since when, and the service its telemetry is
 *     under;
 *   - Overview: its requests, error rate and p95 with every deploy marked,
 *     its instances' CPU and memory, and which revisions run right now;
 *   - Revisions: its deploy history, each revision's numbers beside the
 *     last's;
 *   - Instances, Logs and Traces: its own, not its environment's.
 *
 * A tab can be opened from its address (?tab=Revisions), which the
 * environment's feed lines and the Overview's deploys link to.
 */

export const APP_NOT_FOUND: string = translationKey("App not found.");
export const APP_NOT_SCOPED: string = translationKey(
  "This app's name is too long to filter its telemetry by, so its logs and traces are in its environment's tabs.",
);

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

export enum CloudAppTabName {
  Overview = "Overview",
  Revisions = "Revisions",
  Instances = "Instances",
  Logs = "Logs",
  Traces = "Traces",
}

interface LoadedApp {
  app: CloudApp;
  environment: CloudResource;
  revisions: Array<CloudAppRevision>;
  instances: Array<CloudResourceInstance>;
  serviceId: ObjectID | null;
}

async function loadApp(data: {
  appId: ObjectID;
  environmentId: ObjectID;
}): Promise<LoadedApp | null> {
  const [app, environment]: [CloudApp | null, CloudResource | null] =
    await Promise.all([
      ModelAPI.getItem<CloudApp>({
        modelType: CloudApp,
        id: data.appId,
        select: {
          name: true,
          cloudResourceId: true,
          cloudPlatform: true,
          groupName: true,
          telemetryAttributes: true,
          serviceName: true,
          image: true,
          revisionAttribute: true,
          currentRevision: true,
          currentRevisionSince: true,
          previousRevision: true,
          lastSeenAt: true,
          createdAt: true,
        },
      }),
      ModelAPI.getItem<CloudResource>({
        modelType: CloudResource,
        id: data.environmentId,
        select: {
          name: true,
          resourceIdentifier: true,
          cloudPlatform: true,
          cloudProvider: true,
          cloudRegion: true,
          cloudAccountId: true,
        },
      }),
    ]);

  // An app of another environment is not this environment's.
  if (
    !app ||
    !environment ||
    app.cloudResourceId?.toString() !== data.environmentId.toString()
  ) {
    return null;
  }

  const [revisions, instances, services]: [
    { data: Array<CloudAppRevision> },
    { data: Array<CloudResourceInstance> },
    { data: Array<Service> },
  ] = await Promise.all([
    ModelAPI.getList<CloudAppRevision>({
      modelType: CloudAppRevision,
      query: { cloudAppId: data.appId },
      select: {
        revision: true,
        previousRevision: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
      sort: { firstSeenAt: SortOrder.Descending },
      skip: 0,
      limit: 100,
    }),
    ModelAPI.getList<CloudResourceInstance>({
      modelType: CloudResourceInstance,
      query: { cloudAppId: data.appId },
      select: {
        instanceName: true,
        revision: true,
        latestCpuPercent: true,
        latestMemoryBytes: true,
        lastSeenAt: true,
        cloudAppId: true,
      },
      sort: { lastSeenAt: SortOrder.Descending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
    app.serviceName
      ? ModelAPI.getList<Service>({
          modelType: Service,
          query: { name: app.serviceName },
          select: { _id: true },
          sort: {},
          skip: 0,
          limit: 1,
        }).catch((): { data: Array<Service> } => {
          // No access to Services: the header leaves the link out.
          return { data: [] };
        })
      : Promise.resolve({ data: [] as Array<Service> }),
  ]);

  const service: Service | undefined = services.data[0];

  return {
    app,
    environment,
    revisions: revisions.data,
    instances: instances.data,
    serviceId: service?._id ? new ObjectID(service._id.toString()) : null,
  };
}

const AppPlatformApp: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const appId: ObjectID = Navigation.getLastParamAsObjectID(0);
  const environmentId: ObjectID = Navigation.getLastParamAsObjectID(2);

  const [loaded, setLoaded] = useState<LoadedApp | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_RANGE);
  const [refreshToken, setRefreshToken] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const load: (showLoader: boolean) => void = (showLoader: boolean): void => {
    if (showLoader) {
      setIsLoading(true);
      setError("");
    } else {
      setIsRefreshing(true);
    }

    loadApp({ appId, environmentId })
      .then((result: LoadedApp | null): void => {
        if (!result) {
          if (showLoader) {
            setError(APP_NOT_FOUND);
          }
        } else {
          setLoaded(result);
          setLastRefreshedAt(OneUptimeDate.getCurrentDate());
        }
        setIsLoading(false);
        setIsRefreshing(false);
      })
      .catch((err: Error): void => {
        // A background refresh keeps what the page shows.
        if (showLoader) {
          setError(API.getFriendlyMessage(err));
        }
        setIsLoading(false);
        setIsRefreshing(false);
      });
  };

  useEffect(() => {
    load(true);
  }, [appId.toString(), environmentId.toString()]);

  const refresh: () => void = (): void => {
    load(false);
    setRefreshToken((count: number): number => {
      return count + 1;
    });
  };

  const { autoRefreshInterval, setAutoRefreshInterval } = useAutoRefresh({
    storageKey: "cloud-app-auto-refresh-interval",
    onRefresh: refresh,
  });

  // The window every tab's numbers are over, fixed until the range changes.
  const window: { start: Date; end: Date } = useMemo((): {
    start: Date;
    end: Date;
  } => {
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    return { start: range.startValue, end: range.endValue };
  }, [timeRange, refreshToken]);

  const filters: Record<string, string> = useMemo((): Record<
    string,
    string
  > => {
    return loaded
      ? getCloudAppTelemetryFilters({
          environment: loaded.environment,
          app: loaded.app,
        })
      : {};
  }, [loaded?.app, loaded?.environment]);

  const filterDisplayKeys: Record<string, string> = useMemo((): Record<
    string,
    string
  > => {
    return getCloudAppTelemetryDisplayKeys({
      filters,
      environmentDisplayKeys: getCloudResourceAttributeDisplayKeys(
        loaded?.environment,
      ),
      cloudPlatform: loaded?.app.cloudPlatform,
    });
  }, [filters]);

  const filterDisplayValues: Record<string, string> = useMemo((): Record<
    string,
    string
  > => {
    return getCloudAppTelemetryDisplayValues(filters);
  }, [filters]);

  const logQuery: Query<Log> = useMemo((): Query<Log> => {
    return { attributes: filters } as unknown as Query<Log>;
  }, [filters]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error || !loaded) {
    return <ErrorMessage message={error || APP_NOT_FOUND} />;
  }

  const { app, environment } = loaded;
  const isScoped: boolean = isCloudAppScoped(app);
  const liveInstances: number =
    countLiveInstancesByApp(loaded.instances).get(app._id!.toString()) || 0;

  const environmentRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW] as Route,
    { modelId: environmentId },
  );
  const serviceRoute: Route | undefined = loaded.serviceId
    ? RouteUtil.populateRouteParams(RouteMap[PageMap.SERVICE_VIEW] as Route, {
        modelId: loaded.serviceId,
      })
    : undefined;
  const alertsRoute: Route | undefined = loaded.serviceId
    ? RouteUtil.populateRouteParams(
        RouteMap[PageMap.SERVICE_VIEW_RECOMMENDATIONS] as Route,
        { modelId: loaded.serviceId },
      )
    : undefined;

  const notScoped: ReactElement = <ErrorMessage message={APP_NOT_SCOPED} />;

  const tabs: Array<Tab> = [
    {
      name: CloudAppTabName.Overview,
      children: (
        <CloudAppOverviewTab
          app={app}
          environment={environment}
          instances={loaded.instances}
          revisions={loaded.revisions}
          start={window.start}
          end={window.end}
          refreshToken={refreshToken}
        />
      ),
    },
    {
      name: CloudAppTabName.Revisions,
      countBadge: loaded.revisions.length || undefined,
      children: (
        <CloudAppRevisionsTab
          app={app}
          environment={environment}
          instances={loaded.instances}
          start={window.start}
          end={window.end}
          refreshToken={refreshToken}
        />
      ),
    },
    {
      name: CloudAppTabName.Instances,
      children: (
        <CloudInstancesTable
          environmentId={environmentId}
          app={{ id: appId, name: app.name }}
        />
      ),
    },
    {
      name: CloudAppTabName.Logs,
      children: isScoped ? (
        <DashboardLogsViewer
          id={`cloud-app-logs-${appId.toString()}`}
          logQuery={logQuery}
          attributeFilterDisplayKeys={filterDisplayKeys}
          attributeFilterDisplayValues={filterDisplayValues}
          showFilters={true}
          enableRealtime={true}
          noLogsMessage="Logs appear here when they carry this app's resource attributes and its environment's."
        />
      ) : (
        notScoped
      ),
    },
    {
      name: CloudAppTabName.Traces,
      children: isScoped ? (
        <TracesViewer
          attributeFilters={filters}
          attributeFilterDisplayKeys={filterDisplayKeys}
          attributeFilterDisplayValues={filterDisplayValues}
        />
      ) : (
        notScoped
      ),
    },
  ];

  const requestedTab: string | null = Navigation.getQueryStringByName("tab");

  return (
    <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>
      <Fragment>
        <CloudAppHeader
          app={app}
          environment={environment}
          liveInstances={liveInstances}
          serviceRoute={serviceRoute}
          alertsRoute={alertsRoute}
          environmentRoute={environmentRoute}
          controls={
            <AutoRefreshControl
              autoRefreshInterval={autoRefreshInterval}
              onAutoRefreshIntervalChange={setAutoRefreshInterval}
              onManualRefresh={refresh}
              isRefreshing={isRefreshing}
              lastRefreshedAt={lastRefreshedAt}
              timeRangePicker={
                <TelemetryTimeRangePicker
                  value={timeRange}
                  onChange={(value: RangeStartAndEndDateTime): void => {
                    setTimeRange(value);
                  }}
                />
              }
            />
          }
        />
        <Tabs
          tabs={tabs}
          initialTabName={requestedTab || undefined}
          onTabChange={() => {}}
        />
      </Fragment>
    </TimeRangeZoomScope>
  );
};

export default AppPlatformApp;
