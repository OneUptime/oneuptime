import {
  NetworkAddressNameSource,
  NetworkTrafficAddressName,
  NetworkTrafficAddressNames,
} from "Common/Types/NetFlow/NetworkAddressName";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW A TRAFFIC PAGE WRITES AN ADDRESS (issue #5340): by its name first -
 * "mumbai-fs01", "Payroll SaaS" - with the address beside it, still there
 * for people who think in addresses; by the address alone when the project
 * knows no name for it. A subnet someone named ("Mumbai office") says where
 * the address is, after the address. The same everywhere an address shows:
 * the top lists, both conversation views, the filter chips, the address
 * card and "find an address".
 *
 * Plain functions, free of React, so App/Tests can read them.
 */

export interface TrafficAddressLabel {
  address: string;
  // The name to write first; null: the address is written first.
  name: string | null;
  source: NetworkAddressNameSource | null;
  // The record the name is: a device's, a host's, a cloud resource's ID.
  resourceId: string | null;
  // A subnet the address is in that someone named, and that subnet.
  subnetName: string | null;
  subnet: string | null;
}

export function getTrafficAddressLabel(
  address: string,
  names: NetworkTrafficAddressNames | undefined | null,
): TrafficAddressLabel {
  const known: NetworkTrafficAddressName | undefined =
    names && Object.prototype.hasOwnProperty.call(names, address)
      ? names[address]
      : undefined;

  return {
    address: address,
    name: known?.name || null,
    source: known?.name ? known.source || null : null,
    resourceId: known?.name ? known.resourceId || null : null,
    subnetName: known?.subnetName || null,
    subnet: known?.subnetName ? known.subnet || null : null,
  };
}

/*
 * One line of text for an address - a sentence's value, a title, what a
 * screen reader hears: "mumbai-fs01 (10.18.167.35)", or the address.
 */
export function getTrafficAddressText(label: TrafficAddressLabel): string {
  return label.name ? `${label.name} (${label.address})` : label.address;
}

// The name, or the address when there is none: what a narrow place writes.
export function getTrafficAddressShortText(label: TrafficAddressLabel): string {
  return label.name || label.address;
}

/*
 * Where an address's name comes from, in words, for the address card
 * ("Host", "DNS name"): keys, looked up where they are drawn.
 */
export const TRAFFIC_ADDRESS_SOURCE_LABELS: Record<
  NetworkAddressNameSource,
  string
> = {
  [NetworkAddressNameSource.AddressName]: translationKey("Address name"),
  [NetworkAddressNameSource.NetworkDevice]: translationKey("Network device"),
  [NetworkAddressNameSource.Host]: translationKey("Host"),
  [NetworkAddressNameSource.CloudResource]: translationKey("Cloud resource"),
  [NetworkAddressNameSource.KubernetesNode]: translationKey("Kubernetes node"),
  [NetworkAddressNameSource.KubernetesPod]: translationKey("Kubernetes pod"),
  [NetworkAddressNameSource.Dns]: translationKey("DNS name"),
};

// Whether a label's name is the project's own record, with a page to open.
export function hasRecordPage(label: TrafficAddressLabel): boolean {
  return Boolean(
    label.resourceId &&
      (label.source === NetworkAddressNameSource.NetworkDevice ||
        label.source === NetworkAddressNameSource.Host ||
        label.source === NetworkAddressNameSource.CloudResource),
  );
}

/*
 * The one address a page's filters narrow it to, when they narrow it to
 * exactly one: "to or from", "from" alone, or "to" alone. A conversation
 * (from one, to another) is two addresses: none here.
 */
export function getFilteredAddress(filters: {
  sourceIp?: string | undefined;
  destinationIp?: string | undefined;
  hostIp?: string | undefined;
}): string | null {
  if (filters.hostIp) {
    return filters.hostIp;
  }

  if (filters.sourceIp && !filters.destinationIp) {
    return filters.sourceIp;
  }

  if (filters.destinationIp && !filters.sourceIp) {
    return filters.destinationIp;
  }

  return null;
}
