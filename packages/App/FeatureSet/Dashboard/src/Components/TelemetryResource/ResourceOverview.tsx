import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Label from "Common/Models/DatabaseModels/Label";
import OneUptimeDate from "Common/Types/Date";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AppLink from "../AppLink/AppLink";
import EditInSettingsLink from "./EditInSettingsLink";
import { getReportedResourceOverviewDetailRows } from "./ResourceOverviewDetails";

export interface ResourceOverviewChip {
  icon: IconProp;
  label: string;
}

/*
 * One fact in the Details card. A row whose value is empty is not drawn
 * (ResourceOverviewDetails), so a page lists every fact it can show and
 * the card says only the ones the resource reported.
 */
export interface ResourceOverviewDetailRow {
  label: string;
  value: string | undefined;
  /*
   * How the value is drawn when it is more than text - an agent version with
   * its upgrade sign (AgentVersion). Drawn only while `value` is set, so an
   * empty row still reads "—".
   */
  element?: ReactElement | undefined;
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
  loading?: boolean | undefined;
  sublabel?: string | undefined;
  // 0-100 — renders a saturation bar under the value when provided.
  percent?: number | null | undefined;
  thresholds?: { warn: number; danger: number } | undefined;
  higherIsBetter?: boolean | undefined;
  to?: Route | undefined;
  /*
   * What the number means, in plain words - shown in an (i) tooltip beside
   * the title. "p95" or "error rate" is jargon to most of the people who
   * land on an overview.
   */
  description?: string | undefined;
}

// The status pill's colour: green, amber or gray.
export type ResourceOverviewStatusTone = "positive" | "warning" | "neutral";

export interface ResourceOverviewProps {
  icon: IconProp;
  title: string;
  identifier: string;
  identifierLabel: string;
  status: string | undefined;
  /*
   * The pill's words and colour when "Connected" / "Disconnected" (read off
   * `status`) would say the wrong thing — a Database's pill is about when
   * ANY source last saw it, and must not echo its engine-metrics status.
   * Unset, the pill is exactly what `status` has always produced.
   */
  statusLabel?: string | undefined;
  statusTone?: ResourceOverviewStatusTone | undefined;
  // What the pill means, as its hover text.
  statusDescription?: string | undefined;
  lastSeenAt: Date | undefined;
  /*
   * Drawn straight under the hero, beside the status pill it explains: the
   * "how do I connect this?" card (ResourceConnectionGuideCard), which draws
   * nothing once the resource is connected.
   */
  connectionGuide?: ReactElement | undefined;
  description?: string | undefined;
  chips: Array<ResourceOverviewChip>;
  // Domain-relevant golden metric tiles, computed by the page.
  tiles: Array<ResourceOverviewTile>;
  tilesLoading?: boolean | undefined;
  // Hero top-right controls (e.g. a time-range picker).
  controls?: ReactElement | undefined;
  // Trend charts rendered between the tiles and the details card.
  charts?: ReactElement | undefined;
  /*
   * There are no links to the resource's telemetry pages here: the side
   * menu beside the Overview already lists every one of them (#4979 and
   * its follow-up of #4980 took the "Explore telemetry" card off every
   * Overview).
   */
  detailRows: Array<ResourceOverviewDetailRow>;
  labels?: Array<Label> | undefined;
  /*
   * The resource's Settings page, where its name, description and labels
   * are edited (ResourceDetailsCard): the Details card links there.
   */
  settingsRoute?: Route | undefined;
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

/*
 * The hero's title block (icon, name, identifier, "Last seen") asks for
 * this much of the row before the controls may sit beside it: 24rem, the
 * icon plus 20rem of text. Any narrower and the controls wrap under it.
 */
export const RESOURCE_OVERVIEW_TITLE_BASIS_CLASS: string = "basis-96";

const STATUS_TONE_CLASSES: Record<
  ResourceOverviewStatusTone,
  { badge: string; dot: string }
> = {
  positive: {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  warning: {
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  neutral: {
    badge: "bg-gray-50 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
};

const GoldenMetricTile: FunctionComponent<ResourceOverviewTile> = (
  props: ResourceOverviewTile,
): ReactElement => {
  const translator: Translator = useTranslator();
  const colors: { bg: string; ring: string; text: string } =
    tileColorClasses[props.iconColor];
  /*
   * A page names its tiles in English: each is drawn, and explained, in the
   * reader's language - "Ressourcen", not "RESOURCES", on a German page.
   */
  const title: string = translator.translateText(props.title) || props.title;
  const description: string | undefined = props.description
    ? translator.translateText(props.description) || props.description
    : undefined;

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

  return (
    <div
      className="relative h-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-indigo-300 hover:shadow"
      aria-busy={props.loading ? "true" : "false"}
    >
      {/*
       * A linked tile is one big click target, but the (i) inside it must not
       * navigate - and a button may not sit inside an anchor. So the link is
       * laid over the card rather than wrapped around it, and the (i) is
       * lifted above the overlay.
       */}
      {props.to ? (
        <AppLink
          to={props.to}
          className="absolute inset-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span className="sr-only">{`View ${props.title}`}</span>
        </AppLink>
      ) : (
        <></>
      )}
      <div className="flex items-center justify-between mb-3">
        <div className="flex min-w-0 items-center gap-1">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            {title}
          </span>
          <InfoTooltip
            label={title}
            text={description}
            className="relative z-10"
          />
        </div>
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
        >
          <Icon icon={props.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
        </div>
      </div>
      {props.loading ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading {props.title}</span>
          <div
            className="h-6 w-24 rounded bg-gray-100 motion-safe:animate-pulse"
            aria-hidden="true"
          />
          <div
            className="mt-2 h-3 w-32 max-w-full rounded bg-gray-100 motion-safe:animate-pulse"
            aria-hidden="true"
          />
          {props.percent !== undefined || props.thresholds ? (
            <div
              className="mt-3 h-1.5 w-full rounded-full bg-gray-100 motion-safe:animate-pulse"
              aria-hidden="true"
            />
          ) : (
            <></>
          )}
        </div>
      ) : (
        <Fragment>
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
        </Fragment>
      )}
    </div>
  );
};

const ResourceOverview: FunctionComponent<ResourceOverviewProps> = (
  props: ResourceOverviewProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * The Details rows: ruled from edge to edge of their card, their words
   * where the card's title starts, at every width.
   */
  const ruledListClassName: string = useCardRuledListClassName();
  // Only the facts the resource reported; an empty one is not a row.
  const reportedDetailRows: Array<ResourceOverviewDetailRow> =
    getReportedResourceOverviewDetailRows(props.detailRows);
  const status: string = (props.status || "").toLowerCase();
  const isConnected: boolean = status === "connected" || status === "active";
  /*
   * One whole sentence either way, in the reader's language: "Last seen" and
   * a German time read "Zuletzt gesehen vor 5 Minuten", never "Last seen vor
   * 5 Minuten", and a resource that never reported reads "Never seen".
   */
  const lastSeenText: string = props.lastSeenAt
    ? translator.translateTemplate("Last seen {{time}}", {
        time: OneUptimeDate.fromNow(props.lastSeenAt),
      })
    : translator.translateText("Never seen") || "Never seen";

  const statusTone: ResourceOverviewStatusTone =
    props.statusTone || (isConnected ? "positive" : "warning");
  const statusBadgeClass: string = STATUS_TONE_CLASSES[statusTone].badge;
  const statusDotClass: string = STATUS_TONE_CLASSES[statusTone].dot;
  /*
   * The pill's word: one the product words ("Connected", "Seen recently",
   * "Reporting") in the reader's language, one a page worded itself as
   * given.
   */
  const givenStatusLabel: string =
    props.statusLabel ||
    (isConnected
      ? translationKey("Connected")
      : translationKey("Disconnected"));
  const statusLabel: string =
    translator.translateText(givenStatusLabel) || givenStatusLabel;

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
          {/*
           * The controls (time range, refresh) sit beside the title only
           * while the title keeps its RESOURCE_OVERVIEW_TITLE_BASIS_CLASS
           * width; otherwise they wrap under it. A fixed breakpoint cannot
           * say when that is — the side menu and the controls vary — and
           * with md (768 px, side menu shown) the title was 0 px wide, 109
           * px at 900 and 181 px at 1024: the name hidden and "Last seen"
           * one word per line.
           */}
          <div
            data-testid="resource-overview-header-row"
            className="flex flex-wrap items-start justify-between gap-4"
          >
            <div
              data-testid="resource-overview-title-block"
              className={`flex min-w-0 grow items-start gap-4 ${RESOURCE_OVERVIEW_TITLE_BASIS_CLASS}`}
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-indigo-200 shadow-sm">
                <Icon icon={props.icon} className="h-6 w-6 text-indigo-600" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold text-gray-900 truncate">
                    {props.title}
                  </h1>
                  <span
                    data-testid="resource-overview-status"
                    title={props.statusDescription}
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
                <div className="mt-1 text-xs text-gray-400">{lastSeenText}</div>
              </div>
            </div>
            {props.controls ? (
              <div
                data-testid="resource-overview-controls"
                className="max-w-full"
              >
                {props.controls}
              </div>
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

      {props.connectionGuide ? props.connectionGuide : <></>}

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
                return (
                  <GoldenMetricTile
                    key={`tile-${idx}`}
                    {...tile}
                    loading={props.tilesLoading || tile.loading}
                  />
                );
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
        buttons={
          props.settingsRoute
            ? [
                <EditInSettingsLink
                  key="edit-in-settings"
                  to={props.settingsRoute}
                />,
              ]
            : undefined
        }
      >
        {reportedDetailRows.length > 0 ? (
          <dl
            data-testid="resource-overview-details"
            className={ruledListClassName}
          >
            {reportedDetailRows.map(
              (row: ResourceOverviewDetailRow, idx: number): ReactElement => {
                return (
                  <div
                    key={`row-${idx}`}
                    data-testid="resource-overview-detail-row"
                    className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4 md:px-6"
                  >
                    <dt className="text-sm font-medium text-gray-500">
                      {translator.translateText(row.label) || row.label}
                    </dt>
                    <dd
                      className={`mt-1 text-sm text-gray-900 sm:col-span-2 sm:mt-0 break-all ${
                        row.mono === false ? "" : "font-mono"
                      }`}
                    >
                      {row.element || row.value}
                    </dd>
                  </div>
                );
              },
            )}
          </dl>
        ) : (
          <p
            data-testid="resource-overview-no-details"
            className="text-sm text-gray-500"
          >
            {translator.translateText("No details reported yet.")}
          </p>
        )}
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
