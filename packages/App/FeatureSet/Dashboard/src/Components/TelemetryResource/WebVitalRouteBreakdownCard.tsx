import React, { FunctionComponent, ReactElement } from "react";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import Card from "Common/UI/Components/Card/Card";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { WebVital, WebVitalByRoute, WebVitalRoute } from "./telemetryMetrics";
import { formatVital, ratingClasses, ratingLabel } from "./WebVitalsCard";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getLineDirection } from "Common/UI/Utils/LineDirection";

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
  const translator: Translator = useTranslator();
  // The vital's short name ("INP") is its own in every language.
  const vitalName: string = props.vital.key.toUpperCase();
  const title: string = translator.translateTemplate("{{vital}} by route", {
    vital: vitalName,
  });
  const routes: Array<WebVitalRoute> = props.breakdown?.routes || [];

  /*
   * The routes' columns as wide as a person makes them (Common's
   * Table/ColumnResize): a route gives way, its average and rating never.
   */
  const routeColumns: ResizableColumns = useResizableColumns({
    tableKey: "web-vital-routes-table",
    columns: [
      { id: "route", cellNumber: 1 },
      { id: "average", cellNumber: 2 },
      { id: "rating", cellNumber: 3 },
    ],
  });

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
          {translator.translateTemplate("Could not load {{vital}} by route.", {
            vital: vitalName,
          })}
        </div>
      );
    }

    if (routes.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
          <div className="text-sm font-medium text-gray-700">
            {translator.translateTemplate(
              "{{vital}} is reported, but not per route",
              { vital: vitalName },
            )}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            <TranslatedSentence
              template="Record {{metric}} with an {{attribute}} attribute holding the route pattern (for example {{example}}) to see which view is slow."
              slots={{
                metric: (
                  <code>{props.vital.metricName || "web_vital.inp"}</code>
                ),
                attribute: <code>app.route</code>,
                example: <code>/products/:id</code>,
              }}
            />{" "}
            <a
              className="font-medium text-indigo-600 hover:underline"
              href={WEB_VITALS_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {translator.translateText("How to measure INP per route")}
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
        {routeColumns.styles}
        <table
          className={`${routeColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200 text-sm`}
          {...routeColumns.tableAttributes}
        >
          <thead>
            <tr>
              <ResizableHeaderCell
                className="py-2 pe-4 text-start text-xs font-medium uppercase tracking-wider text-gray-500"
                resize={routeColumns.getResize(
                  "route",
                  translator.translateText("Route") || "Route",
                  ColumnWidthKind.Name,
                )}
              >
                <span>
                  {translator.translateText("Route")}
                  {props.breakdown?.routeAttribute ? (
                    <span className="ms-1 font-mono normal-case tracking-normal text-gray-400">
                      ({props.breakdown.routeAttribute})
                    </span>
                  ) : null}
                </span>
              </ResizableHeaderCell>
              <ResizableHeaderCell
                className="py-2 pe-4 text-end text-xs font-medium uppercase tracking-wider text-gray-500"
                resize={routeColumns.getResize(
                  "average",
                  translator.translateText("Average") || "Average",
                  ColumnWidthKind.Whole,
                )}
              >
                <span>{translator.translateText("Average")}</span>
              </ResizableHeaderCell>
              <ResizableHeaderCell
                className="py-2 text-end text-xs font-medium uppercase tracking-wider text-gray-500"
                resize={routeColumns.getResize(
                  "rating",
                  translator.translateText("Rating") || "Rating",
                  ColumnWidthKind.Whole,
                )}
              >
                <span>{translator.translateText("Rating")}</span>
              </ResizableHeaderCell>
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
                  {/*
                   * The route and the value read from the left on a page
                   * read from the right too: "/checkout/:orderId/payment"
                   * and "640 ms", not "checkout/:orderId/payment/" and
                   * "ms 640". Each cell keeps the page's sides (pe-4,
                   * text-end), so the columns line up under their names.
                   */}
                  <td className="max-w-md truncate py-2 pe-4 font-mono text-xs text-gray-700">
                    <span
                      dir={getLineDirection(route.route, translator.language)}
                    >
                      {route.route}
                    </span>
                  </td>
                  <td
                    className={`whitespace-nowrap py-2 pe-4 text-end font-semibold ${classes.text}`}
                  >
                    <span
                      dir={getLineDirection(
                        formatVital(rated),
                        translator.language,
                      )}
                    >
                      {formatVital(rated)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 text-end">
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
            {translator.translateTemplate(
              "The {{shown}} slowest of {{total}} routes.",
              {
                shown: translator.formatNumber(routes.length),
                total: translator.formatNumber(
                  props.breakdown?.totalRoutes || 0,
                ),
              },
            )}
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
        description={translator.translateTemplate(
          "{{vital}} averaged over the selected range for each route, slowest first.",
          { vital: props.vital.label },
        )}
      >
        <div className="-mt-2">{body()}</div>
      </Card>
    </div>
  );
};

export default WebVitalRouteBreakdownCard;
