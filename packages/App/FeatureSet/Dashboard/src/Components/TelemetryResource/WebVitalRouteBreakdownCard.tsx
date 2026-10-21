import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { WebVital, WebVitalByRoute, WebVitalRoute } from "./telemetryMetrics";
import { formatVital, ratingClasses, ratingLabel } from "./WebVitalsCard";

/*
 * One web vital, per route, slowest first. On the RUM overview this is
 * INP: in a single-page app the app-wide INP mixes every view together,
 * and this table is where the one slow view stands out on its own.
 */

export const WEB_VITALS_DOCS_URL: string =
  "/docs/rum/web-vitals#single-page-apps";

export interface WebVitalRouteBreakdownCardProps {
  // The vital being broken down (label, unit, thresholds).
  vital: WebVital;
  breakdown: WebVitalByRoute | null;
  loading: boolean;
  // What the card shows, in an (i) beside its title.
  description?: string | undefined;
}

const WebVitalRouteBreakdownCard: FunctionComponent<
  WebVitalRouteBreakdownCardProps
> = (props: WebVitalRouteBreakdownCardProps): ReactElement => {
  const title: string = `${props.vital.key.toUpperCase()} by route`;
  const routes: Array<WebVitalRoute> = props.breakdown?.routes || [];

  const body: () => ReactElement = (): ReactElement => {
    if (props.loading && !props.breakdown) {
      return (
        <div className="space-y-2" data-testid="web-vital-routes-loading">
          {Array.from({ length: 3 }, (_: unknown, idx: number) => {
            return (
              <div
                key={`route-skeleton-${idx}`}
                className="h-8 rounded bg-gray-100 animate-pulse"
              />
            );
          })}
        </div>
      );
    }

    if (props.breakdown?.failed) {
      return (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
          Could not load {props.vital.key.toUpperCase()} by route.
        </div>
      );
    }

    if (routes.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
          <div className="text-sm font-medium text-gray-700">
            {props.vital.key.toUpperCase()} is reported, but not per route
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Record <code>{props.vital.metricName || "web_vital.inp"}</code> with
            an <code>app.route</code> attribute holding the route pattern (for
            example <code>/products/:id</code>) to see which view is slow.{" "}
            <a
              className="font-medium text-indigo-600 hover:underline"
              href={WEB_VITALS_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              How to measure INP per route
            </a>
          </div>
        </div>
      );
    }

    const shownAll: boolean =
      props.breakdown?.totalRoutes === null ||
      props.breakdown?.totalRoutes === undefined ||
      props.breakdown.totalRoutes <= routes.length;

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Route
                {props.breakdown?.routeAttribute ? (
                  <span className="ml-1 font-mono normal-case tracking-normal text-gray-400">
                    ({props.breakdown.routeAttribute})
                  </span>
                ) : null}
              </th>
              <th className="py-2 pr-4 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Average
              </th>
              <th className="py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Rating
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {routes.map((route: WebVitalRoute): ReactElement => {
              const rated: Pick<WebVital, "value" | "unit" | "thresholds"> = {
                value: route.value,
                unit: props.vital.unit,
                thresholds: props.vital.thresholds,
              };
              const classes: { text: string; chip: string } =
                ratingClasses(rated);

              return (
                <tr key={route.route} data-testid="web-vital-route-row">
                  <td className="max-w-md truncate py-2 pr-4 font-mono text-xs text-gray-700">
                    {route.route}
                  </td>
                  <td
                    className={`whitespace-nowrap py-2 pr-4 text-right font-semibold ${classes.text}`}
                  >
                    {formatVital(rated)}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${classes.chip}`}
                    >
                      {ratingLabel(rated)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shownAll && (
          <div className="mt-2 text-xs text-gray-500">
            The {routes.length} slowest of {props.breakdown?.totalRoutes}{" "}
            routes.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mt-6">
      <Card
        title={
          props.description ? (
            <span className="inline-flex items-center gap-1.5">
              {title}
              <InfoTooltip
                label={title}
                text={props.description}
                iconClassName="h-4 w-4"
              />
            </span>
          ) : (
            title
          )
        }
        description={`${props.vital.label} averaged over the selected range for each route, slowest first.`}
      >
        <div className="-mt-2">{body()}</div>
      </Card>
    </div>
  );
};

export default WebVitalRouteBreakdownCard;
