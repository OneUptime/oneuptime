import { translationKey } from "Common/Types/Translator";

/*
 * THE ADDRESSES ONEUPTIME KNOWS A CUSTOM PROBE BY, ON ITS PAGE (OneUptime
 * issue #10634), and what each is used for - kept React-free, so tests and
 * the docs' facts read the same words.
 *
 *   - Check-In Address: where OneUptime sees the probe check in from
 *     (Probe.egressIpAddress, #10338), its NAT's address when it has one.
 *     The blocklist never blocks it.
 *   - Interface Addresses: what the probe lists each time it checks in
 *     (Probe.interfaceIpAddresses, #10429): the addresses on its network
 *     interfaces, and its host's when it is given them
 *     (PROBE_HOST_IP_ADDRESSES, #10633). Security Events sets the probe's
 *     own polling, discovery and monitor checks from them aside, and the
 *     blocklist never blocks them.
 *
 * Both are read by the probe's readers only (PROBE_READERS), and neither
 * shows for a probe that has not checked in: there is nothing to say yet.
 */
export const PROBE_ADDRESSES_COPY: {
  checkInTitle: string;
  checkInDescription: string;
  interfacesTitle: string;
  interfacesDescription: string;
} = {
  checkInTitle: translationKey("Check-In Address"),
  checkInDescription: translationKey(
    "Where OneUptime sees this probe check in from. The blocklist never blocks it.",
  ),
  interfacesTitle: translationKey("Interface Addresses"),
  interfacesDescription: translationKey(
    "The addresses on this probe's network interfaces, and its host's when it is given them, as the probe lists them each time it checks in. Security Events sets the probe's own polling, discovery and monitor checks from these aside, and the blocklist never blocks them.",
  ),
};
