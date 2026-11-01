/*
 * Hardware identity from ENTITY-MIB entPhysicalTable (1.3.6.1.2.1.47.1.1.1).
 * The probe picks the chassis row (entPhysicalClass == 3), falling back to
 * the lowest-indexed row that carries a serial number, since stacked or
 * modular devices expose one row per component. All fields are best-effort —
 * many low-end devices do not implement ENTITY-MIB at all. What it leaves empty
 * the probe fills from the vendor's own MIB, for the platforms that keep it
 * there (SnmpVendorIdentity).
 */
export default interface SnmpEntityInfo {
  manufacturer?: string | undefined;
  model?: string | undefined;
  serialNumber?: string | undefined;
  hardwareRevision?: string | undefined;
  firmwareVersion?: string | undefined;
  softwareVersion?: string | undefined;
}
