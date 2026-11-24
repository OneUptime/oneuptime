import ProbeInterfaceAddressesUtil from "Common/Types/Probe/ProbeInterfaceAddresses";
import NetworkAddressBlockUtil from "Common/Utils/NetworkTraffic/NetworkAddressBlock";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The addresses OneUptime knows a custom probe by (OneUptime issue #10634),
 * as its page shows them under Probe Status: the address it checks in from
 * (Probe.egressIpAddress), or the addresses it lists when it checks in
 * (Probe.interfaceIpAddresses, comma-separated). Each read the way the
 * server reads it, so a value written another way shows only real
 * addresses; each written left to right, as an address reads in every
 * language. Nothing at all when there is none: the page shows the field
 * only once the probe has checked in (Components/Probe/ProbeAddressesCopy).
 */

export const PROBE_ADDRESSES_TEST_ID: string = "probe-addresses";
export const PROBE_ADDRESS_TEST_ID: string = "probe-address";

export interface ComponentProps {
  // Probe.egressIpAddress, or Probe.interfaceIpAddresses as the column holds them.
  value: string | null | undefined;
  // Whether the value is the column's list, or one address.
  isList?: boolean | undefined;
}

// The addresses a value holds, as the server reads them.
export function readProbeAddresses(
  value: string | null | undefined,
  isList: boolean,
): Array<string> {
  if (!value) {
    return [];
  }

  if (isList) {
    return ProbeInterfaceAddressesUtil.fromText(value);
  }

  const address: string | null = NetworkAddressBlockUtil.canonicalAddress(
    value.trim(),
  );

  return address ? [address] : [];
}

const ProbeAddresses: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const addresses: Array<string> = readProbeAddresses(
    props.value,
    Boolean(props.isList),
  );

  if (addresses.length === 0) {
    return <></>;
  }

  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1"
      data-testid={PROBE_ADDRESSES_TEST_ID}
    >
      {addresses.map((address: string): ReactElement => {
        return (
          <li
            key={address}
            dir="ltr"
            className="font-mono text-sm text-gray-900"
            data-testid={PROBE_ADDRESS_TEST_ID}
          >
            {address}
          </li>
        );
      })}
    </ul>
  );
};

export default ProbeAddresses;
