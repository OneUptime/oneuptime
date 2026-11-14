import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/NetworkDeviceMetricDescriptions";
import { TraceRouteHop } from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "Common/UI/Utils/LineDirection";
import { splitAtNameBreaks } from "Common/Utils/NameBreaks";
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

// The host that answered a hop and its address, or "* * *" when none did.
export const getHopHostText: (hop: TraceRouteHop) => string = (
  hop: TraceRouteHop,
): string => {
  if (hop.isTimeout) {
    return "* * *";
  }

  return [hop.hostName, hop.address ? `(${hop.address})` : ""]
    .filter((part: string | undefined): part is string => {
      return Boolean(part);
    })
    .join(" ");
};

/*
 * Where a hop's address may break when its column is narrower than it:
 * after each dot ("(198.51.100." / "42)") and after each colon but the
 * first of a "::" ("(2001:db8::" / "1)"). Never inside a number, and never
 * before its closing bracket. Linear.
 */
export const splitHopAddress: (address: string) => Array<string> = (
  address: string,
): Array<string> => {
  const parts: Array<string> = [];
  let current: string = "";

  for (let index: number = 0; index < address.length; index++) {
    const character: string = address.charAt(index);
    const next: string = address.charAt(index + 1);

    current += character;

    if (
      next !== "" &&
      (character === "." || (character === ":" && next !== ":"))
    ) {
      parts.push(current);
      current = "";
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
};

/*
 * The host cell's text in parts, a <wbr> between each: the host's name
 * broken after its own dots before a letter (splitAtNameBreaks, as
 * BreakableName breaks a name alone in a narrow box), then its address in
 * brackets broken after its dots and colons (splitHopAddress). Joined,
 * they are getHopHostText.
 */
export const getHopHostParts: (hop: TraceRouteHop) => Array<string> = (
  hop: TraceRouteHop,
): Array<string> => {
  if (hop.isTimeout) {
    return ["* * *"];
  }

  const nameParts: Array<string> = hop.hostName
    ? splitAtNameBreaks(hop.hostName, 0)
    : [];
  const addressParts: Array<string> = hop.address
    ? splitHopAddress(`(${hop.address})`)
    : [];

  if (nameParts.length > 0 && addressParts.length > 0) {
    // The space between the name and its address is the first place to break.
    nameParts[nameParts.length - 1] += " ";
  }

  return [...nameParts, ...addressParts];
};

/*
 * The host gives way on a phone, between its name and its address first
 * ("gw.example.com" / "(192.168.1.1)"), then after its own dots and
 * dashes, and its address after its dots ("(198.51.100." / "42)") - never
 * at whatever character fills the line ("(198.51.100.42" / ")"). It is a
 * box of its own as wide as its words, read left to right: on an Arabic or
 * Persian page it starts where the page's lines start and each of its
 * lines starts on the left, rather than a wrapped last piece ("9)") hanging
 * on the right. A part still too long for the line breaks anywhere.
 */
export const TRACEROUTE_HOP_HOST_CLASS_NAME: string = `block ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME} [overflow-wrap:anywhere]`;

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
                <td className="pe-4 py-1 font-mono">
                  <bdi
                    dir="ltr"
                    className={TRACEROUTE_HOP_HOST_CLASS_NAME}
                    data-testid="traceroute-hop-host"
                  >
                    {getHopHostParts(hop).map(
                      (
                        part: string,
                        index: number,
                        parts: Array<string>,
                      ): ReactElement => {
                        return (
                          <React.Fragment key={index}>
                            {part}
                            {index < parts.length - 1 ? <wbr /> : <></>}
                          </React.Fragment>
                        );
                      },
                    )}
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
