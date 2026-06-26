import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Card from "Common/UI/Components/Card/Card";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Label from "Common/Models/DatabaseModels/Label";
import OneUptimeDate from "Common/Types/Date";
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

export type ResourceOverviewTileColor =
  | "blue"
  | "violet"
  | "amber"
  | "emerald"
  | "slate"
  | "sky"
  | "rose";

export interface ResourceOverviewTile {
  title: string;
  value: string;
  icon: IconProp;
  iconColor: ResourceOverviewTileColor;
  sublabel?: string | undefined;
  // 0-100 — renders a saturation bar under the value when provided.
  percent?: number | null | undefined;
  thresholds?: { warn: number; danger: number } | undefined;
  higherIsBetter?: boolean | undefined;
  to?: Route | undefined;
}

export interface ResourceOverviewQuickLink {
  title: string;
  description: string;
  to: Route;
  icon: IconProp;
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
  // Domain-relevant golden metric tiles, computed by the page.
  tiles: Array<ResourceOverviewTile>;
  tilesLoading?: boolean | undefined;
  // Hero top-right controls (e.g. a time-range picker).
  controls?: ReactElement | undefined;
  // Trend charts rendered between the tiles and the details card.
  charts?: ReactElement | undefined;
  // Secondary navigation to the raw telemetry tabs.
  quickLinks?: Array<ResourceOverviewQuickLink> | undefined;
  detailRows: Array<ResourceOverviewDetailRow>;
  labels?: Array<Label> | undefined;
}

const tileColorClasses: Record<
  ResourceOverviewTileColor,
  { bg: string; ring: string; text: string }
> = {
  blue: { bg: "bg-blue-50", ring: "ring-blue-200", text: "text-blue-600" },
  violet: {
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    text: "text-violet-600",
  },
  amber: { bg: "bg-amber-50", ring: "ring-amber-200", text: "text-amber-600" },
  emerald: {
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
  },
  slate: { bg: "bg-slate-50", ring: "ring-slate-200", text: "text-slate-600" },
  sky: { bg: "bg-sky-50", ring: "ring-sky-200", text: "text-sky-600" },
  rose: { bg: "bg-rose-50", ring: "ring-rose-200", text: "text-rose-600" },
};

const GoldenMetricTile: FunctionComponent<ResourceOverviewTile> = (
  props: ResourceOverviewTile,
): ReactElement => {
  const colors: { bg: string; ring: string; text: string } =
    tileColorClasses[props.iconColor];

  const barColor: string = (() => {
    if (props.percent === null || props.percent === undefined) {
      return "bg-gray-300";
    }
    const t: { warn: number; danger: number } = props.thresholds || {
      warn: 70,
      danger: 90,
    };
    if (props.higherIsBetter) {
      if (props.percent < t.danger) {
        return "bg-red-500";
      }
      if (props.percent < t.warn) {
        return "bg-amber-500";
      }
      return "bg-emerald-500";
    }
    if (props.percent >= t.danger) {
      return "bg-red-500";
    }
    if (props.percent >= t.warn) {
      return "bg-amber-500";
    }
    return "bg-emerald-500";
  })();

  const safePercent: number =
    props.percent === null || props.percent === undefined
      ? 0
      : Math.min(100, Math.max(0, props.percent));

  const inner: ReactElement = (
    <div className="h-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-indigo-300 hover:shadow">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          {props.title}
        </span>
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
        >
          <Icon icon={props.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
        </div>
      </div>
      <div className="text-2xl font-semibold text-gray-900 leading-none">
        {props.value}
      </div>
      {props.sublabel ? (
        <div className="mt-1 text-xs text-gray-500 truncate">
          {props.sublabel}
        </div>
      ) : (
        <div className="mt-1 text-xs text-gray-400">&nbsp;</div>
      )}
      {props.percent !== undefined && props.percent !== null && (
        <div className="mt-3 w-full bg-gray-100 rounded-full h-1.5">
          <div
            className={`${barColor} h-1.5 rounded-full transition-all`}
            style={{ width: `${safePercent}%` }}
          />
        </div>
      )}
    </div>
  );

  if (props.to) {
    return (
      <AppLink to={props.to} className="block h-full">
        {inner}
      </AppLink>
    );
  }
  return inner;
};

const ResourceOverview: FunctionComponent<ResourceOverviewProps> = (
  props: ResourceOverviewProps,
): ReactElement => {
  const status: string = (props.status || "").toLowerCase();
  const isConnected: boolean = status === "connected" || status === "active";
  const lastSeenText: string = props.lastSeenAt
    ? OneUptimeDate.fromNow(props.lastSeenAt)
    : "never";

  const statusBadgeClass: string = isConnected
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : "bg-amber-50 text-amber-700 ring-amber-200";
  const statusDotClass: string = isConnected
    ? "bg-emerald-500"
    : "bg-amber-500";
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
          <div className="flex items-start justify-between gap-4">
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
            {props.controls ? (
              <div className="ml-auto flex-shrink-0">{props.controls}</div>
            ) : (
              <></>
            )}
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

      {/* Golden metric tiles */}
      {props.tilesLoading && props.tiles.length === 0 ? (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_: unknown, idx: number) => {
            return (
              <div
                key={`tile-skeleton-${idx}`}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
                <div className="mt-3 h-8 w-20 rounded bg-gray-100 animate-pulse" />
                <div className="mt-2 h-3 w-24 rounded bg-gray-100 animate-pulse" />
              </div>
            );
          })}
        </div>
      ) : (
        props.tiles.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {props.tiles.map(
              (tile: ResourceOverviewTile, idx: number): ReactElement => {
                return <GoldenMetricTile key={`tile-${idx}`} {...tile} />;
              },
            )}
          </div>
        )
      )}

      {/* Trend charts */}
      {props.charts ? <div className="mb-6">{props.charts}</div> : <></>}

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

      {/* Explore telemetry (secondary navigation) */}
      {props.quickLinks && props.quickLinks.length > 0 ? (
        <div className="mt-6">
          <Card
            title="Explore telemetry"
            description="Drill into the raw signals for this resource."
          >
            <div className="-m-6 -mt-2 border-t border-gray-200 divide-y divide-gray-100">
              {props.quickLinks.map(
                (
                  link: ResourceOverviewQuickLink,
                  idx: number,
                ): ReactElement => {
                  return (
                    <AppLink
                      key={`ql-${idx}`}
                      to={link.to}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
                    >
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gray-50 ring-1 ring-inset ring-gray-200">
                        <Icon
                          icon={link.icon}
                          className="h-4 w-4 text-gray-500"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900">
                          {link.title}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {link.description}
                        </div>
                      </div>
                      <Icon
                        icon={IconProp.ChevronRight}
                        className="h-4 w-4 flex-shrink-0 text-gray-400"
                      />
                    </AppLink>
                  );
                },
              )}
            </div>
          </Card>
        </div>
      ) : (
        <></>
      )}

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
