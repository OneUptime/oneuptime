/*
 * The log attributes a syslog message is stored with, whichever way it
 * arrived: forwarded by a probe that listens for it, or posted to
 * /syslog/v1/logs.
 *
 * Stored in customers' logs and used in their searches, pipelines and
 * monitors: never rename one.
 */
enum SyslogAttribute {
  // The address the message came from, as the probe saw it.
  SourceIp = "syslog.sourceIp",
  FacilityCode = "syslog.facility.code",
  FacilityName = "syslog.facility.name",
  SeverityCode = "syslog.severity.code",
  SeverityName = "syslog.severity.name",
  Priority = "syslog.priority",
  Version = "syslog.version",
  Hostname = "syslog.hostname",
  AppName = "syslog.appName",
  ProcessId = "syslog.processId",
  MessageId = "syslog.messageId",
  StructuredRaw = "syslog.structured.raw",
  Raw = "syslog.raw",

  // Who made the device, read from the message: "Sophos", "Cisco", ...
  Vendor = "syslog.vendor",
  // The built-in parser that read it: a SyslogParserId.
  Parser = "syslog.parser",

  /*
   * How the message was matched to its network device, when that was not
   * simply the address it came from: a SyslogDeviceMatchKind.
   */
  MatchedBy = "syslog.matchedBy",
  // The device that passed the message on for the one it names.
  RelayId = "syslog.relay.id",
  RelayName = "syslog.relay.name",
  // true on a message from an address that is no device yet.
  Unmatched = "syslog.unmatched",
  /*
   * The time the device wrote, when the log is stored under the time the
   * probe received it instead (the device's clock or time zone is off).
   */
  DeviceTime = "syslog.deviceTime",
}

// The prefix of each RFC 5424 structured-data parameter's attribute.
export const SYSLOG_STRUCTURED_ATTRIBUTE_PREFIX: string = "syslog.structured.";

// How a message found its network device.
export enum SyslogDeviceMatchKind {
  // The address it came from is the device's (hostname, Other Addresses, DNS).
  SourceAddress = "source-address",
  // The message names the device's MAC address.
  MacAddress = "mac-address",
  // The message names the device's serial number.
  SerialNumber = "serial-number",
  // The message names one of the device's addresses.
  Address = "address",
  // The message names the device: its name, system name or DNS name.
  Hostname = "hostname",
}

export default SyslogAttribute;
