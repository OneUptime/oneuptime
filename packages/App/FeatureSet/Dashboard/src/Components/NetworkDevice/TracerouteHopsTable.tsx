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
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <ResizableHeaderCell
              className="pr-4 pb-2 font-medium"
              resize={hopColumns.getResize(
                "hop",
                translator.translateText("Hop") || "Hop",
                ColumnWidthKind.Whole,
              )}
            >
              <span>{translator.translateText("Hop")}</span>
            </ResizableHeaderCell>
            <ResizableHeaderCell
              className="pr-4 pb-2 font-medium"
              resize={hopColumns.getResize(
                "host",
                translator.translateText("Host") || "Host",
                ColumnWidthKind.Name,
              )}
            >
              <span>{translator.translateText("Host")}</span>
            </ResizableHeaderCell>
            <ResizableHeaderCell
              className="pb-2 font-medium"
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
                <td className="pr-4 py-1 font-mono">{hop.hopNumber}</td>
                <td className="pr-4 py-1 font-mono break-all">
                  {hop.isTimeout
                    ? "* * *"
                    : `${hop.hostName ? hop.hostName + " " : ""}${
                        hop.address ? `(${hop.address})` : ""
                      }`}
                </td>
                <td className="py-1">
                  {hop.roundTripTimeInMS !== undefined
                    ? translator.translateTemplate("{{latency}} ms", {
                        latency: hop.roundTripTimeInMS,
                      })
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
