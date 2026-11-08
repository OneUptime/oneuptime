import {
  formatTrafficBytes,
  formatTrafficProtocolPort,
} from "../NetworkTrafficFormat";
import { TrafficTopRow } from "../TrafficTopList";
import { getClientDetails, getClientLabel } from "./MerakiTrafficRows";
import {
  NetworkTrafficUsageApplicationRow,
  NetworkTrafficUsageClientRow,
  NetworkTrafficUsageNetworkRow,
  getUsageOctets,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A network's, an application's and a client's row, as Top networks, Top
 * applications and Top clients draw them - and as the dialog that lists
 * every one of them does (MerakiTrafficListModal), so a row reads the same
 * in both: its name, what it is, its bytes in and out, and its share.
 */

function inAndOut(
  row: { sentOctets: number; receivedOctets: number },
  translator: Translator,
): string {
  return translator.translateTemplate("In {{in}} · out {{out}}", {
    in: formatTrafficBytes(row.receivedOctets),
    out: formatTrafficBytes(row.sentOctets),
  });
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
}): TrafficTopRow {
  const name: string = data.row.name || data.row.controllerNetworkId;

  return {
    key: data.row.controllerNetworkId,
    label: name,
    octets: getUsageOctets(data.row),
    detail: inAndOut(data.row, data.translator),
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
): TrafficTopRow {
  return {
    key: row.application,
    label: row.application,
    sublabel: formatTrafficProtocolPort(row, translator) || undefined,
    octets: getUsageOctets(row),
    detail: inAndOut(row, translator),
    isActive: false,
  };
}

// A client: its name, else its address, else its MAC - and what else is known of it.
export function toClientTopRow(
  row: NetworkTrafficUsageClientRow,
  translator: Translator,
  options: { withNetwork: boolean },
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
    detail: inAndOut(row, translator),
    isActive: false,
  };
}
