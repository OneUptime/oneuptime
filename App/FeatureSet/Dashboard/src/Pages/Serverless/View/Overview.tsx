import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import Navigation from "Common/UI/Utils/Navigation";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import ServerlessFunctionInstance from "Common/Models/DatabaseModels/ServerlessFunctionInstance";
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

const ServerlessFunctionOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [serverlessFunction, setServerlessFunction] =
    useState<ServerlessFunction | null>(null);
  const [instanceCount, setInstanceCount] = useState<number | null>(null);
  const [red, setRed] = useState<SpanRedMetrics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: ServerlessFunction | null = await ModelAPI.getItem({
        modelType: ServerlessFunction,
        id: modelId,
        select: {
          name: true,
          description: true,
          functionIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          cloudPlatform: true,
          cloudProvider: true,
          cloudRegion: true,
          cloudAccountId: true,
          functionVersion: true,
          runtimeName: true,
          runtimeVersion: true,
          agentVersion: true,
          labels: { name: true, color: true },
        },
      });

      if (!item?.functionIdentifier) {
        setError("Serverless function not found.");
        setIsLoading(false);
        return;
      }

      setServerlessFunction(item);
      setIsLoading(false);

      const end: Date = OneUptimeDate.getCurrentDate();
      const start: Date = OneUptimeDate.addRemoveMinutes(end, -60);

      fetchSpanRedMetrics({
        attributes: { "resource.faas.name": item.functionIdentifier as string },
        start,
        end,
      })
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
        modelType: ServerlessFunctionInstance,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query: { serverlessFunctionId: modelId } as any,
      })
        .then(setInstanceCount)
        .catch(() => {
          return setInstanceCount(0);
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

  if (!serverlessFunction) {
    return <ErrorMessage message="Serverless function not found." />;
  }

  const fn: ServerlessFunction = serverlessFunction;
  const runtime: string = [fn.runtimeName, fn.runtimeVersion]
    .filter((s: string | undefined): boolean => {
      return Boolean(s);
    })
    .join(" ");

  const chips: Array<ResourceOverviewChip> = [];
  if (fn.cloudPlatform) {
    chips.push({ icon: IconProp.Cloud, label: String(fn.cloudPlatform) });
  }
  if (fn.cloudRegion) {
    chips.push({ icon: IconProp.Globe, label: String(fn.cloudRegion) });
  }
  if (runtime) {
    chips.push({ icon: IconProp.Code, label: runtime });
  }
  if (fn.functionVersion) {
    chips.push({ icon: IconProp.Info, label: `v${fn.functionVersion}` });
  }

  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, { modelId });
  };

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Invocations",
      value: red ? formatCompact(red.total) : "…",
      icon: IconProp.Bolt,
      iconColor: "blue",
      sublabel: "last 1 hour",
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
      sublabel: "last 1 hour",
    },
    {
      title: "Instances",
      value: instanceCount === null ? "…" : formatCompact(instanceCount),
      icon: IconProp.Cube,
      iconColor: "amber",
      sublabel: "active",
      to: populate(PageMap.SERVERLESS_FUNCTION_VIEW_INSTANCES),
    },
  ];

  const quickLinks: Array<ResourceOverviewQuickLink> = [
    {
      title: "Traces",
      description: "Invocation traces and spans",
      to: populate(PageMap.SERVERLESS_FUNCTION_VIEW_TRACES),
      icon: IconProp.Workflow,
    },
    {
      title: "Logs",
      description: "Function logs",
      to: populate(PageMap.SERVERLESS_FUNCTION_VIEW_LOGS),
      icon: IconProp.Terminal,
    },
    {
      title: "Metrics",
      description: "Function metrics",
      to: populate(PageMap.SERVERLESS_FUNCTION_VIEW_METRICS),
      icon: IconProp.ChartBar,
    },
  ];

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "Function Identifier (faas.name)", value: fn.functionIdentifier },
    { label: "Cloud Platform", value: fn.cloudPlatform },
    { label: "Cloud Provider", value: fn.cloudProvider },
    { label: "Cloud Region", value: fn.cloudRegion },
    { label: "Cloud Account ID", value: fn.cloudAccountId },
    { label: "Function Version (faas.version)", value: fn.functionVersion },
    { label: "Runtime", value: runtime },
    { label: "Agent Version", value: fn.agentVersion },
  ];

  return (
    <ResourceOverview
      icon={IconProp.Bolt}
      title={(fn.name as string) || "Serverless Function"}
      identifier={(fn.functionIdentifier as string) || ""}
      identifierLabel="faas.name"
      status={fn.otelCollectorStatus}
      lastSeenAt={fn.lastSeenAt}
      description={fn.description as string}
      chips={chips}
      tiles={tiles}
      quickLinks={quickLinks}
      detailRows={detailRows}
      labels={fn.labels}
    />
  );
};

export default ServerlessFunctionOverview;
