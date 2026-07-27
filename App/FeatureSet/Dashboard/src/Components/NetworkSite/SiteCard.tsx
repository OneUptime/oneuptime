import React, { FunctionComponent, ReactElement } from "react";
import { SiteChildView, SiteStatusInfo } from "./SiteHierarchyTypes";
import { formatUptimePercent } from "./SiteMapViewModel";

/*
 * Shared card body for one network site: name, site-type label, health
 * chip, unit rollup, device count and uptime. Rendered in two skins — the
 * plain SiteCard grid at the map page's root level, and the
 * SiteContainerGraph's React Flow node (which wraps the same body so both
 * levels speak one visual language).
 *
 * Free of router imports on purpose: navigation is injected via onClick by
 * the page, so the body stays usable anywhere (including inside React
 * Flow nodes).
 *
 * Hierarchy is deliberate: a franchise-ops user acts on HOW MANY UNITS ARE
 * DOWN first and uptime second, so the down/up count is the one prominent
 * figure, uptime is a right-aligned tabular column (percentages line up
 * across the grid), and the site/device counts stay quiet at the bottom.
 * Health is encoded in FORM as well as color — the lead figure switches
 * from "N units operational" to "N of M units down", and the proportional
 * meter shows the split — so the card never depends on the dot's hue
 * alone.
 */

const NO_STATUS_COLOR: string = "#9ca3af"; // gray-400

/*
 * Derived from the unit rollup, NOT from the status row's color: the
 * status color is arbitrary project-configured hex, while the tone drives
 * Tailwind semantic classes that must stay legible in both themes.
 */
type UnitRollupTone = "ok" | "warn" | "down" | "none";

const rollupTone: (site: SiteChildView) => UnitRollupTone = (
  site: SiteChildView,
): UnitRollupTone => {
  const total: number = site.unitStats.totalUnits;
  if (total <= 0) {
    return "none";
  }
  const operational: number = Math.min(
    Math.max(site.unitStats.operationalUnits, 0),
    total,
  );
  if (operational >= total) {
    return "ok";
  }
  /*
   * Half or more of the units down is an outage, not a wobble — red, so a
   * "1 of 4 up" site never reads calmer than the red status dot beside it.
   * A minority down stays amber (degraded).
   */
  if (operational * 2 <= total) {
    return "down";
  }
  return "warn";
};

const TONE_TEXT_CLASS: Record<UnitRollupTone, string> = {
  ok: "text-emerald-600",
  warn: "text-amber-600",
  down: "text-red-600",
  none: "text-gray-400",
};

const TONE_BAR_CLASS: Record<UnitRollupTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  down: "bg-red-500",
  none: "bg-gray-300",
};

const pluralUnits: (count: number) => string = (count: number): string => {
  return count === 1 ? "unit" : "units";
};

export interface SiteCardBodyProps {
  site: SiteChildView;
}

export const SiteCardBody: FunctionComponent<SiteCardBodyProps> = (
  props: SiteCardBodyProps,
): ReactElement => {
  const site: SiteChildView = props.site;
  const status: SiteStatusInfo | undefined = site.currentMonitorStatus;

  const totalUnits: number = Math.max(site.unitStats.totalUnits, 0);
  const operationalUnits: number = Math.min(
    Math.max(site.unitStats.operationalUnits, 0),
    totalUnits,
  );
  const downUnits: number = totalUnits - operationalUnits;
  const tone: UnitRollupTone = rollupTone(site);
  const hasRollup: boolean = totalUnits > 0;
  const operationalPercent: number = hasRollup
    ? (operationalUnits / totalUnits) * 100
    : 0;

  /*
   * The lead figure. Healthy sites count what is up, unhealthy sites count
   * what is down — the shape of the sentence changes with the state, so a
   * degraded card is distinguishable from a clean one without relying on
   * the color of either the figure or the status dot.
   */
  let leadValue: string = "";
  let leadCaption: string = "";
  if (hasRollup) {
    if (tone === "ok") {
      leadValue = `${operationalUnits}`;
      leadCaption = `${pluralUnits(operationalUnits)} operational`;
    } else {
      leadValue = `${downUnits}`;
      leadCaption = `of ${totalUnits} ${pluralUnits(totalUnits)} down`;
    }
  }

  const hasCounts: boolean = site.childSiteCount > 0 || site.deviceCount > 0;
  const hasUptime: boolean = site.uptimePercent !== null;
  /*
   * A site with no rollup, no uptime and nothing attached has genuinely
   * nothing to report yet. It gets one calm line under the chip instead of
   * an empty stat block, so the card reads as "waiting for data" rather
   * than as a card with a hole punched in it.
   */
  const isAwaitingData: boolean = !hasRollup && !hasUptime && !hasCounts;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-w-0">
        <div
          title={site.name}
          className="truncate text-sm font-semibold leading-5 text-gray-900"
        >
          {site.name}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span
            className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600"
            title={status ? status.name : "Nothing reporting yet"}
          >
            {status ? (
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: status.color || NO_STATUS_COLOR }}
              />
            ) : (
              /*
               * Hollow ring, not a filled dot: "no data" is a different
               * shape, not merely a grayer color.
               */
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full border border-gray-400" />
            )}
            <span className="truncate">
              {status ? status.name : "Not reporting"}
            </span>
          </span>
          <span className="flex-shrink-0 text-[10px] font-semibold uppercase leading-4 tracking-wider text-gray-400">
            {site.siteType}
          </span>
        </div>
      </div>

      {isAwaitingData ? (
        /*
         * Centered in the leftover space so an unreported site reads as a
         * deliberately quiet card, not as one missing its bottom half.
         */
        <div className="flex flex-1 items-center">
          <p className="text-[11px] leading-4 text-gray-400">
            Nothing reporting yet — no units or devices attached.
          </p>
        </div>
      ) : (
        <div className="mt-auto space-y-1.5">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              {hasRollup ? (
                <React.Fragment>
                  <div
                    className={`text-lg font-semibold leading-6 tabular-nums ${TONE_TEXT_CLASS[tone]}`}
                  >
                    {leadValue}
                  </div>
                  <div className="truncate text-[11px] leading-4 text-gray-500">
                    {leadCaption}
                  </div>
                </React.Fragment>
              ) : (
                <div className="truncate text-[11px] leading-4 text-gray-400">
                  No unit rollup yet
                </div>
              )}
            </div>
            <div className="flex-shrink-0 text-right">
              <div className="text-sm font-semibold leading-6 tabular-nums text-gray-900">
                {formatUptimePercent(site.uptimePercent)}
              </div>
              <div className="text-[10px] leading-4 text-gray-400">uptime</div>
            </div>
          </div>

          {/*
           * The meter appears only when units are actually down: a healthy
           * grid stays calm, and the bar itself becomes a state signal
           * rather than decoration on every card.
           */}
          {hasRollup && downUnits > 0 ? (
            <div
              className="flex h-1 w-full overflow-hidden rounded-full bg-gray-100"
              role="img"
              aria-label={`${operationalUnits} of ${totalUnits} ${pluralUnits(
                totalUnits,
              )} operational`}
            >
              <div
                className="bg-emerald-500"
                style={{ width: `${operationalPercent}%` }}
              />
              <div
                className={TONE_BAR_CLASS[tone]}
                style={{ width: `${100 - operationalPercent}%` }}
              />
            </div>
          ) : (
            <></>
          )}

          {hasCounts ? (
            <div className="truncate text-[11px] leading-4 text-gray-400">
              {site.childSiteCount > 0 ? (
                <span>
                  {site.childSiteCount} site
                  {site.childSiteCount === 1 ? "" : "s"} &middot;{" "}
                </span>
              ) : (
                <></>
              )}
              {site.deviceCount} device{site.deviceCount === 1 ? "" : "s"}
            </div>
          ) : (
            <></>
          )}
        </div>
      )}
    </div>
  );
};

export interface ComponentProps {
  site: SiteChildView;
  /** Navigate deeper — injected by the page, keeps this component router-free. */
  onClick?: ((siteId: string) => void) | undefined;
}

// The plain-div skin, used for the root-level site grid on the map page.
const SiteCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isClickable: boolean = Boolean(props.onClick);
  return (
    <div
      data-testid={`site-card-${props.site.id}`}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={
        isClickable
          ? `${props.site.name} — ${props.site.siteType}, open this site`
          : undefined
      }
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${
        isClickable
          ? "cursor-pointer transition hover:border-indigo-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          : ""
      }`}
      onClick={
        isClickable
          ? () => {
              props.onClick!(props.site.id);
            }
          : undefined
      }
      onKeyDown={
        isClickable
          ? (event: React.KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                props.onClick!(props.site.id);
              }
            }
          : undefined
      }
    >
      <SiteCardBody site={props.site} />
    </div>
  );
};

export default SiteCard;
