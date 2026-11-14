import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/NetworkDeviceMetricDescriptions";
import { TraceRouteHop } from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import React, { FunctionComponent, ReactElement } from "react";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { formatMilliseconds } from "../../Utils/Milliseconds";

export interface ComponentProps {
  hops: Array<TraceRouteHop>;
}

/*
 * The hop-by-hop table of a traceroute: hop number, the host that answered
 * (or "* * *" when nothing did), and its round-trip time. Extracted from the
 * Network monitor's NetworkPathView so the on-demand device traceroute
 * (issue #3745) renders the same table — one place to keep the timeout
 * spelling and the red-row rule.
 */
const TracerouteHopsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The hops' columns as wide as a person makes them (Common's
   * Table/ColumnResize): a host gives way, a hop's number and its RTT never.
   */
  const hopColumns: ResizableColumns = useResizableColumns({
    tableKey: "traceroute-hops-table",
    columns: [
      { id: "hop", cellNumber: 1 },
      { id: "host", cellNumber: 2 },
      { id: "rtt", cellNumber: 3 },
    ],
  });

  if (props.hops.length === 0) {
    return <></>;
  }

  return (
    <div className="overflow-x-auto">
      {hopColumns.styles}
      <table
        className={`${hopColumns.getTableWidthClassName("min-w-full")} text-sm text-gray-700`}
        {...hopColumns.tableAttributes}
      >
        {/*
         * Each header and cell starts where the page's lines start - on the
         * right of an Arabic or Persian page - so a header stays over its
         * values; a plain th whose row is left to the default would be
         * centred, so each one says text-start itself.
         */}
        <thead>
          <tr className="text-xs text-gray-500">
            <ResizableHeaderCell
              className="pe-4 pb-2 text-start font-medium"
              resize={hopColumns.getResize(
                "hop",
                translator.translateText("Hop") || "Hop",
                ColumnWidthKind.Whole,
              )}
            >
              <span>{translator.translateText("Hop")}</span>
            </ResizableHeaderCell>
            <ResizableHeaderCell
              className="pe-4 pb-2 text-start font-medium"
              resize={hopColumns.getResize(
                "host",
                translator.translateText("Host") || "Host",
                ColumnWidthKind.Name,
              )}
            >
              <span>{translator.translateText("Host")}</span>
            </ResizableHeaderCell>
            <ResizableHeaderCell
              className="pb-2 text-start font-medium"
              resize={hopColumns.getResize(
                "rtt",
                translator.translateText("RTT") || "RTT",
                ColumnWidthKind.Whole,
              )}
            >
              {/*
               * Only the first of the probe's replies per hop is kept, and
               * routers often put answering these probes last — the (i)
               * says so before a high hop reads as the fault.
               */}
              <span className="inline-flex items-center gap-1">
                {translator.translateText("RTT")}
                <InfoTooltip
                  label="RTT"
                  text={NETWORK_DEVICE_METRIC_DESCRIPTIONS.tracerouteRtt}
                />
              </span>
            </ResizableHeaderCell>
          </tr>
        </thead>
        <tbody>
          {props.hops.map((hop: TraceRouteHop): ReactElement => {
            return (
              <tr
                key={hop.hopNumber}
                className={hop.isTimeout ? "text-red-700" : ""}
              >
                {/*
                 * The hop's number as the reader's language writes a
                 * number (Persian digits beside the Persian times), the
                 * host as the network named it, read left to right on
                 * every page so its address stays in its brackets.
                 */}
                <td
                  className="pe-4 py-1 tabular-nums"
                  data-testid="traceroute-hop-number"
                >
                  {translator.formatNumber(hop.hopNumber)}
                </td>
                <td className="pe-4 py-1 font-mono break-all">
                  <bdi dir="ltr">
                    {hop.isTimeout
                      ? "* * *"
                      : `${hop.hostName ? hop.hostName + " " : ""}${
                          hop.address ? `(${hop.address})` : ""
                        }`}
                  </bdi>
                </td>
                {/*
                 * A round trip is one figure with its unit: kept on one
                 * line ("48.27 ms", "۴۸٫۲۷ میلی‌ثانیه") while the host
                 * gives way on a phone.
                 */}
                <td
                  className="py-1 whitespace-nowrap"
                  data-testid="traceroute-hop-rtt"
                >
                  {hop.roundTripTimeInMS !== undefined
                    ? formatMilliseconds(translator, hop.roundTripTimeInMS)
                    : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default TracerouteHopsTable;
