import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Card from "Common/UI/Components/Card/Card";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Label from "Common/Models/DatabaseModels/Label";
import OneUptimeDate from "Common/Types/Date";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AppLink from "../AppLink/AppLink";

export interface ResourceOverviewChip {
  icon: IconProp;
  label: string;
}

export interface ResourceOverviewDetailRow {
  label: string;
  value: string | undefined;
  mono?: boolean | undefined;
}

export interface ResourceOverviewInventoryTile {
  title: string;
  icon: IconProp;
  count: number | null;
  to: Route;
}

export interface ResourceOverviewProps {
  icon: IconProp;
  title: string;
  identifier: string;
  identifierLabel: string;
  status: string | undefined;
  lastSeenAt: Date | undefined;
  description?: string | undefined;
  chips: Array<ResourceOverviewChip>;
  telemetryAttributeKey: string;
  telemetryAttributeValue: string;
  metricsRoute: Route;
  logsRoute: Route;
  tracesRoute: Route;
  inventoryTile?: ResourceOverviewInventoryTile | undefined;
  detailRows: Array<ResourceOverviewDetailRow>;
  labels?: Array<Label> | undefined;
}

const formatCount: (n: number | null) => string = (n: number | null): string => {
  if (n === null) {
    return "…";
  }
  if (n < 1000) {
    return n.toString();
  }
  if (n < 1_000_000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
};

const StatTile: FunctionComponent<{
  title: string;
  value: string;
  icon: IconProp;
  iconColor: string;
  to?: Route | undefined;
}> = (props: {
  title: string;
  value: string;
  icon: IconProp;
  iconColor: string;
  to?: Route | undefined;
}): ReactElement => {
  const inner: ReactElement = (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-indigo-300 hover:shadow">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          {props.title}
        </span>
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-md bg-gray-50 ring-1 ring-inset ring-gray-200`}
        >
          <Icon icon={props.icon} className={`h-3.5 w-3.5 ${props.iconColor}`} />
        </div>
      </div>
      <div className="text-2xl font-semibold text-gray-900 leading-none">
        {props.value}
      </div>
    </div>
  );

  if (props.to) {
    return (
      <AppLink to={props.to} className="block">
        {inner}
      </AppLink>
    );
  }
  return inner;
};

const ResourceOverview: FunctionComponent<ResourceOverviewProps> = (
  props: ResourceOverviewProps,
): ReactElement => {
  const [logCount, setLogCount] = useState<number | null>(null);
  const [traceCount, setTraceCount] = useState<number | null>(null);
  const [metricCount, setMetricCount] = useState<number | null>(null);

  const fetchCounts: PromiseVoidFunction = async (): Promise<void> => {
    const projectId: string | undefined =
      ProjectUtil.getCurrentProjectId()?.toString();
    if (!projectId || !props.telemetryAttributeValue) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseQuery: any = {
      projectId: ProjectUtil.getCurrentProjectId()!,
      attributes: {
        [props.telemetryAttributeKey]: props.telemetryAttributeValue,
      },
    };

    const safeCount: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      modelType: any,
      setter: (n: number) => void,
    ) => Promise<void> = async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      modelType: any,
      setter: (n: number) => void,
    ): Promise<void> => {
      try {
        const count: number = await AnalyticsModelAPI.count(
          modelType,
          baseQuery as Query<Log>,
        );
        setter(count);
      } catch {
        // Best-effort — leave the tile blank on error.
        setter(0);
      }
    };

    await Promise.all([
      safeCount(Log, setLogCount),
      safeCount(Span, setTraceCount),
      safeCount(Metric, setMetricCount),
    ]);
  };

  useEffect(() => {
    fetchCounts().catch(() => {
      // ignore — tiles simply stay blank
    });
  }, [props.telemetryAttributeValue]);

  const status: string = (props.status || "").toLowerCase();
  const isConnected: boolean =
    status === "connected" || status === "active";
  const lastSeenText: string = props.lastSeenAt
    ? OneUptimeDate.fromNow(props.lastSeenAt)
    : "never";

  const statusBadgeClass: string = isConnected
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : "bg-amber-50 text-amber-700 ring-amber-200";
  const statusDotClass: string = isConnected ? "bg-emerald-500" : "bg-amber-500";
  const statusLabel: string = isConnected ? "Connected" : "Disconnected";

  return (
    <Fragment>
      {/* Hero */}
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-indigo-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative px-6 py-5">
          <div className="flex items-start gap-4 min-w-0">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-indigo-200 shadow-sm">
              <Icon icon={props.icon} className="h-6 w-6 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-gray-900 truncate">
                  {props.title}
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`}
                  />
                  {statusLabel}
                </span>
              </div>
              {props.identifier ? (
                <div className="mt-1 truncate font-mono text-sm text-gray-500">
                  {props.identifierLabel}: {props.identifier}
                </div>
              ) : (
                <></>
              )}
              <div className="mt-1 text-xs text-gray-400">
                Last seen {lastSeenText}
              </div>
            </div>
          </div>

          {props.chips.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {props.chips.map(
                (chip: ResourceOverviewChip, idx: number): ReactElement => {
                  return (
                    <span
                      key={`chip-${idx}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                    >
                      <Icon
                        icon={chip.icon}
                        className="h-3 w-3 text-gray-500"
                      />
                      <span className="font-medium">{chip.label}</span>
                    </span>
                  );
                },
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stat tiles */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          title="Logs"
          value={formatCount(logCount)}
          icon={IconProp.Terminal}
          iconColor="text-blue-600"
          to={props.logsRoute}
        />
        <StatTile
          title="Traces"
          value={formatCount(traceCount)}
          icon={IconProp.Workflow}
          iconColor="text-violet-600"
          to={props.tracesRoute}
        />
        <StatTile
          title="Metrics"
          value={formatCount(metricCount)}
          icon={IconProp.ChartBar}
          iconColor="text-emerald-600"
          to={props.metricsRoute}
        />
        {props.inventoryTile ? (
          <StatTile
            title={props.inventoryTile.title}
            value={formatCount(props.inventoryTile.count)}
            icon={props.inventoryTile.icon}
            iconColor="text-amber-600"
            to={props.inventoryTile.to}
          />
        ) : (
          <StatTile
            title="Status"
            value={isConnected ? "Live" : "Stale"}
            icon={IconProp.Wifi}
            iconColor="text-slate-600"
          />
        )}
      </div>

      {/* Details */}
      <Card
        title="Details"
        description={
          props.description ||
          "Metadata captured from OpenTelemetry resource attributes."
        }
      >
        <div className="border-t border-gray-200 divide-y divide-gray-100 -m-6 -mt-2">
          {props.detailRows.map(
            (row: ResourceOverviewDetailRow, idx: number): ReactElement => {
              return (
                <div
                  key={`row-${idx}`}
                  className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4"
                >
                  <dt className="text-sm font-medium text-gray-500">
                    {row.label}
                  </dt>
                  <dd
                    className={`mt-1 text-sm text-gray-900 sm:col-span-2 sm:mt-0 break-all ${
                      row.mono === false ? "" : "font-mono"
                    }`}
                  >
                    {row.value && row.value.length > 0 ? row.value : "—"}
                  </dd>
                </div>
              );
            },
          )}
        </div>
      </Card>

      {/* Labels */}
      {props.labels && props.labels.length > 0 ? (
        <div className="mt-6">
          <Card
            title="Labels"
            description="Labels attached to this resource (manual or via label rules)."
          >
            <div className="-mt-2">
              <LabelsElement labels={props.labels} />
            </div>
          </Card>
        </div>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default ResourceOverview;
