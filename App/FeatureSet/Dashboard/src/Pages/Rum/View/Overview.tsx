import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import Navigation from "Common/UI/Utils/Navigation";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumApplicationClient from "Common/Models/DatabaseModels/RumApplicationClient";
import React, {
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
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
  ResourceOverviewQuickLink,
  ResourceOverviewTile,
} from "../../../Components/TelemetryResource/ResourceOverview";
import {
  fetchSpanRedMetrics,
  formatCompact,
  formatDurationMs,
  formatPercent,
  SpanRedMetrics,
} from "../../../Components/TelemetryResource/telemetryMetrics";

const RumApplicationOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [rumApplication, setRumApplication] = useState<RumApplication | null>(
    null,
  );
  const [clientCount, setClientCount] = useState<number | null>(null);
  const [red, setRed] = useState<SpanRedMetrics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: RumApplication | null = await ModelAPI.getItem({
        modelType: RumApplication,
        id: modelId,
        select: {
          name: true,
          description: true,
          appIdentifier: true,
          clientType: true,
          sdkLanguage: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          agentVersion: true,
          labels: { name: true, color: true },
        },
      });

      if (!item?.appIdentifier) {
        setError("RUM application not found.");
        setIsLoading(false);
        return;
      }

      setRumApplication(item);
      setIsLoading(false);

      const end: Date = OneUptimeDate.getCurrentDate();
      const start: Date = OneUptimeDate.addRemoveMinutes(end, -60);

      // RUM telemetry is tagged with serviceId = this application's id.
      fetchSpanRedMetrics({ serviceId: modelId, start, end })
        .then(setRed)
        .catch(() => {
          return setRed({
            total: 0,
            errors: 0,
            errorRatePercent: null,
            p95DurationMs: null,
          });
        });

      ModelAPI.count({
        modelType: RumApplicationClient,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query: { rumApplicationId: modelId } as any,
      })
        .then(setClientCount)
        .catch(() => {
          return setClientCount(0);
        });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
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

  if (!rumApplication) {
    return <ErrorMessage message="RUM application not found." />;
  }

  const a: RumApplication = rumApplication;

  const chips: Array<ResourceOverviewChip> = [];
  if (a.clientType) {
    chips.push({ icon: IconProp.Window, label: String(a.clientType) });
  }
  if (a.sdkLanguage) {
    chips.push({ icon: IconProp.Code, label: String(a.sdkLanguage) });
  }

  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, { modelId });
  };

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Page views",
      value: red ? formatCompact(red.total) : "…",
      icon: IconProp.Activity,
      iconColor: "blue",
      sublabel: "events, last 1 hour",
    },
    {
      title: "Error rate",
      value: red ? formatPercent(red.errorRatePercent) : "…",
      icon: IconProp.Alert,
      iconColor: "rose",
      sublabel: red ? `${formatCompact(red.errors)} errored` : undefined,
      percent: red ? red.errorRatePercent : null,
      thresholds: { warn: 1, danger: 5 },
    },
    {
      title: "p95 duration",
      value: red ? formatDurationMs(red.p95DurationMs) : "…",
      icon: IconProp.Clock,
      iconColor: "violet",
      sublabel: "page / interaction",
    },
    {
      title: "Clients",
      value: clientCount === null ? "…" : formatCompact(clientCount),
      icon: IconProp.Window,
      iconColor: "amber",
      sublabel: "platforms seen",
      to: populate(PageMap.RUM_APPLICATION_VIEW_CLIENTS),
    },
  ];

  const quickLinks: Array<ResourceOverviewQuickLink> = [
    {
      title: "Traces",
      description: "Page loads, interactions and fetches",
      to: populate(PageMap.RUM_APPLICATION_VIEW_TRACES),
      icon: IconProp.Workflow,
    },
    {
      title: "Logs",
      description: "Browser / mobile events and errors",
      to: populate(PageMap.RUM_APPLICATION_VIEW_LOGS),
      icon: IconProp.Terminal,
    },
    {
      title: "Metrics",
      description: "Client-side metrics",
      to: populate(PageMap.RUM_APPLICATION_VIEW_METRICS),
      icon: IconProp.ChartBar,
    },
  ];

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "App Identifier (service.name)", value: a.appIdentifier },
    { label: "Client Type", value: a.clientType },
    { label: "SDK Language (telemetry.sdk.language)", value: a.sdkLanguage },
    { label: "SDK Version", value: a.agentVersion },
  ];

  return (
    <ResourceOverview
      icon={IconProp.Globe}
      title={(a.name as string) || "RUM Application"}
      identifier={(a.appIdentifier as string) || ""}
      identifierLabel="service.name"
      status={a.otelCollectorStatus}
      lastSeenAt={a.lastSeenAt}
      description={a.description as string}
      chips={chips}
      tiles={tiles}
      quickLinks={quickLinks}
      detailRows={detailRows}
      labels={a.labels}
    />
  );
};

export default RumApplicationOverview;
