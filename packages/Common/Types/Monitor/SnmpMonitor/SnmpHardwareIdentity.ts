import SnmpEntityInfo from "./SnmpEntityInfo";
import { SnmpVendorIdentityField } from "./SnmpVendorIdentity";

/*
 * What a host told a discovery scan about its hardware, after it answered the
 * scan's read of its system group (SnmpMonitor.probeHardwareIdentity). A device
 * with no SNMP credentials of its own is not walked, so this is the only way
 * OneUptime learns these details about it.
 *
 * Best-effort, field by field. A key is ABSENT, not undefined, for whatever the
 * read did not get, and that says nothing about the device: it may have no such
 * thing, it may not have said, or the read may have run out of time.
 *
 * The keys are the keys of a scan's stored result and of a device's discovered
 * details (NETWORK_DEVICE_DISCOVERED_HARDWARE_FIELDS).
 */
export default interface SnmpHardwareIdentity
  extends Pick<SnmpEntityInfo, SnmpVendorIdentityField> {
  // The MAC of one of its own ports, out of its interface table (DeviceOwnMacUtil).
  scannedMacAddress?: string | undefined;
}
