import {
  formatTrafficBytes,
  formatTrafficProtocolPort,
} from "../NetworkTrafficFormat";
import { TrafficTopRow } from "../TrafficTopList";
import { getClientDetails, getClientLabel } from "./MerakiTrafficRows";
import {
  NetworkTrafficUsageApplicationRow,
  NetworkTrafficUsageClientRow,
  NetworkTrafficUsageListSort,
  NetworkTrafficUsageNetworkRow,
  getUsageOctets,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactNode } from "react";

/*
 * A network's, an application's and a client's row, as Top networks, Top
 * applications and Top clients draw them - and as the dialog that lists
 * every one of them does (MerakiTrafficListModal), so a row reads the same
 * in both: its name, what it is, its bytes in and out, and its share.
 *
 * In the dialog, sorted by what came in or what went out, a row's own
 * figure for that way stands out of its "In 8 GB · out 96 GB" line: the
 * bytes on the right are always both ways, so without it a list sorted by
 * In would look out of order.
 */

export const IN_AND_OUT: string = translationKey("In {{in}} · out {{out}}");

// The figure a list is sorted by, in a row's "In … · out …" line.
export const SORTED_FIGURE_CLASS_NAME: string = "font-medium text-gray-900";

export const SORTED_FIGURE_TEST_ID: string = "traffic-row-sorted-figure";

function inAndOut(
  row: { sentOctets: number; receivedOctets: number },
  translator: Translator,
  sortBy?: NetworkTrafficUsageListSort | undefined,
): ReactNode {
  const figures: { in: string; out: string } = {
    in: formatTrafficBytes(row.receivedOctets),
    out: formatTrafficBytes(row.sentOctets),
  };

  if (
    sortBy !== NetworkTrafficUsageListSort.In &&
    sortBy !== NetworkTrafficUsageListSort.Out
  ) {
    return translator.translateTemplate(IN_AND_OUT, figures);
  }

  const sorted: "in" | "out" =
    sortBy === NetworkTrafficUsageListSort.In ? "in" : "out";

  const figure: (way: "in" | "out") => ReactNode = (
    way: "in" | "out",
  ): ReactNode => {
    return way === sorted ? (
      <span
        className={SORTED_FIGURE_CLASS_NAME}
        data-testid={SORTED_FIGURE_TEST_ID}
      >
        {figures[way]}
      </span>
    ) : (
      figures[way]
    );
  };

  return (
    <TranslatedSentence
      template={IN_AND_OUT}
      slots={{ in: figure("in"), out: figure("out") }}
    />
  );
}

/*
 * A network: a click narrows the page to it (or widens it again, when it
 * is the one the page is narrowed to), where the page can narrow.
 */
export function toNetworkTopRow(data: {
  row: NetworkTrafficUsageNetworkRow;
  translator: Translator;
  isActive: boolean;
  onClick?: (() => void) | undefined;
  // The dialog's order: its figure stands out of each row.
  sortBy?: NetworkTrafficUsageListSort | undefined;
}): TrafficTopRow {
  const name: string = data.row.name || data.row.controllerNetworkId;

  return {
    key: data.row.controllerNetworkId,
    label: name,
    octets: getUsageOctets(data.row),
    detail: inAndOut(data.row, data.translator, data.sortBy),
    isActive: data.isActive,
    ariaLabel: data.translator.translateTemplate(
      "Show only the traffic of {{network}}",
      { network: name },
    ),
    onClick: data.onClick,
  };
}

// An application, as Meraki names it, with the protocol and port most of it was.
export function toApplicationTopRow(
  row: NetworkTrafficUsageApplicationRow,
  translator: Translator,
  sortBy?: NetworkTrafficUsageListSort | undefined,
): TrafficTopRow {
  return {
    key: row.application,
    label: row.application,
    sublabel: formatTrafficProtocolPort(row, translator) || undefined,
    octets: getUsageOctets(row),
    detail: inAndOut(row, translator, sortBy),
    isActive: false,
  };
}

// A client: its name, else its address, else its MAC - and what else is known of it.
export function toClientTopRow(
  row: NetworkTrafficUsageClientRow,
  translator: Translator,
  options: {
    withNetwork: boolean;
    sortBy?: NetworkTrafficUsageListSort | undefined;
  },
): TrafficTopRow {
  const details: Array<string> = getClientDetails(row, {
    withNetwork: options.withNetwork,
  });

  return {
    key: row.clientKey,
    label: getClientLabel(row),
    isMono: !row.name,
    sublabel: details.length > 0 ? details.join(" · ") : undefined,
    octets: getUsageOctets(row),
    detail: inAndOut(row, translator, options.sortBy),
    isActive: false,
  };
}
