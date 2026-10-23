import SnmpDataType from "../Monitor/SnmpMonitor/SnmpDataType";

/*
 * An SNMP walk of a Network Device (OneUptime issue #5184): every OID the
 * device's agent answers under a starting OID, with its type and value,
 * read by the device's own probe with the device's own credentials - the
 * way `snmpwalk` (or Zabbix's walk) explores a device, without a shell on
 * the probe's network.
 *
 * It runs as a NetworkDeviceDiagnostic of type "SNMP Walk", like Ping and
 * Traceroute: the dashboard creates the row with a starting OID, the probe
 * claims it, walks, and writes what it read back to the row. These are the
 * shapes the three parties share, and the bounds every walk keeps to.
 *
 * The bounds are the point of most of this file. A walk is a burst of
 * requests against a device somebody is usually running in production, so
 * one walk reads at most SNMP_WALK_MAX_OIDS OIDs, within
 * SNMP_WALK_TIME_BUDGET_IN_MS, one request at a time with a pause between
 * requests, and a device is walked by one walk at a time. A subtree bigger
 * than one walk is read in pages: the result says where it stopped, and the
 * next walk continues from there.
 */

/*
 * Where a walk starts when the person names no OID: 1.3.6.1 (internet),
 * which holds everything an SNMP agent exposes - the standard MIBs under
 * mib-2 and the vendor's own under enterprises.
 */
export const SNMP_WALK_DEFAULT_ROOT_OID: string = "1.3.6.1";

/*
 * OIDs one walk reads before it stops and offers to continue. A switch
 * exposes tens of thousands; a thousand is a page a person can read and
 * search, and a few seconds of work for a device on the same network.
 */
export const SNMP_WALK_MAX_OIDS: number = 1000;

/*
 * The time one walk may take on the probe, start to finish. A slow agent
 * that answers each request just inside its timeout is stopped here and
 * continued later, rather than held open past the two minutes the
 * dashboard waits for a diagnostic.
 */
export const SNMP_WALK_TIME_BUDGET_IN_MS: number = 45000;

// How long the probe waits for the answer to one request of a walk.
export const SNMP_WALK_REQUEST_TIMEOUT_IN_MS: number = 5000;

/*
 * GETBULK max-repetitions: how many OIDs one request asks for. Twenty-five
 * keeps a response of ordinary values well inside one UDP datagram; an
 * agent that still answers tooBig gets asked for fewer.
 */
export const SNMP_WALK_MAX_REPETITIONS: number = 25;

/*
 * The pause between two requests of a walk, so a walk never asks a
 * device's agent for more than about fifty requests a second however fast
 * it answers.
 */
export const SNMP_WALK_PAUSE_BETWEEN_REQUESTS_IN_MS: number = 20;

/*
 * The longest value text kept for one OID. Agents expose the odd blob (a
 * configuration, a certificate); the walk keeps its start and says it was
 * cut.
 */
export const SNMP_WALK_MAX_VALUE_LENGTH: number = 1024;

// The longest OID kept: an OID has at most 128 arcs of at most ten digits.
export const SNMP_WALK_MAX_OID_LENGTH: number = 1500;

// The longest failure message kept from the agent or the probe.
export const SNMP_WALK_MAX_FAILURE_MESSAGE_LENGTH: number = 1000;

/*
 * A walk counts as running for this long after it was asked for, so a
 * second walk of the same device is refused until the first one finishes.
 * Longer than the two minutes the dashboard waits, so a walk a probe is
 * slow to pick up still counts; short enough that a walk whose probe died
 * mid-run stops blocking the device on its own.
 */
export const SNMP_WALK_RUNNING_WINDOW_IN_MINUTES: number = 3;

/*
 * What the person reads when a walk cannot run, as the server words it -
 * on the page when they ask for the walk, or on the walk's row when the
 * probe claims it. One wording for both.
 */
export const SNMP_WALK_NO_CREDENTIALS_MESSAGE: string =
  "This device has no SNMP credentials to walk it with. Add a community string or an SNMPv3 user in its Settings, or give it (or its site) an SNMP credential profile.";

export const SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE: string =
  "This device's SNMP credential profile could not be read just now. Try the walk again in a moment.";

export const SNMP_WALK_ALREADY_RUNNING_MESSAGE: string =
  "This device is already being walked. Wait for that walk to finish, then walk it again.";

export const SNMP_WALK_PROBE_UPGRADE_MESSAGE: string =
  "This device's probe runs a version that cannot walk SNMP. Update the probe to the latest version, then walk again.";

// Why a walk stopped.
export enum SnmpWalkStopReason {
  // Every OID under the starting OID was read.
  Complete = "complete",
  // It read SNMP_WALK_MAX_OIDS OIDs. The next walk continues from nextOid.
  OidLimit = "oidLimit",
  // Its time budget ran out. The next walk continues from nextOid.
  TimeLimit = "timeLimit",
  /*
   * The device refused, stopped answering, or could not be reached;
   * `failure` says which. Whatever was read before that is kept, and
   * nextOid says where to continue when anything was.
   */
  Failed = "failed",
}

// What kind of failure stopped a walk, for the sentence the dashboard shows.
export enum SnmpWalkFailureKind {
  /*
   * The agent refused the credentials: an SNMPv3 user, password, security
   * level or privacy setting it does not accept, or a view it denies.
   */
  Authentication = "authentication",
  /*
   * No answer in time. Also what a wrong v1 / v2c community string looks
   * like: agents drop a request with a community they do not know, without
   * a word.
   */
  Timeout = "timeout",
  /*
   * The probe could not send to the device at all: its name does not
   * resolve, or the probe has no route to it.
   */
  Unreachable = "unreachable",
  /*
   * The agent answered with an error, or with OIDs that go backwards
   * (a known bug in some agents, which would otherwise loop forever).
   */
  AgentError = "agentError",
  /*
   * The device's saved credentials cannot open a session: SNMPv3 with no
   * user name, or a protocol the probe does not recognise.
   */
  Configuration = "configuration",
  Unknown = "unknown",
}

/*
 * The SNMPv3 (USM) reason an agent gave for refusing a request, when it
 * gave one (RFC 3414, usmStats). Lets the dashboard name what to fix.
 */
export enum SnmpWalkAuthenticationReason {
  UnknownUser = "unknownUser",
  // The authentication password or protocol is not the device's.
  WrongDigest = "wrongDigest",
  UnsupportedSecurityLevel = "unsupportedSecurityLevel",
  // The privacy password or protocol is not the device's.
  Decryption = "decryption",
  NotInTimeWindow = "notInTimeWindow",
  UnknownEngineId = "unknownEngineId",
  // The agent's access control refused the request (authorizationError).
  AccessDenied = "accessDenied",
}

// One OID the walk read.
export interface SnmpWalkRow {
  oid: string;
  type: SnmpDataType;
  /*
   * Integers, gauges, 32-bit counters and timeticks as numbers. A Counter64
   * as its decimal text, because a JavaScript number loses its last digits
   * past 2^53. Text as text, binary octets as hex (isHex), an OID value as
   * its dotted OID, null for an SNMP NULL.
   */
  value: string | number | null;
  // The value is the octets in hex ("00 1A 2B 3C"): they are not text.
  isHex?: boolean | undefined;
  // The value was longer than SNMP_WALK_MAX_VALUE_LENGTH and was cut.
  isCut?: boolean | undefined;
}

export interface SnmpWalkFailure {
  kind: SnmpWalkFailureKind;
  authenticationReason?: SnmpWalkAuthenticationReason | undefined;
  // What the agent or the probe said, as it said it.
  message: string;
}

/*
 * What one walk read: the `snmpWalkResult` column of its
 * NetworkDeviceDiagnostic row. A walk the device refused or did not answer
 * is still a Completed diagnostic with this result - stopReason Failed and
 * a failure - because the refusal IS the answer; a Failed diagnostic means
 * the probe could not run the walk at all.
 */
export interface NetworkDeviceDiagnosticSnmpWalkResult {
  // The subtree walked.
  rootOid: string;
  // Set when this walk continued another: it read what follows this OID.
  afterOid?: string | undefined;
  rows: Array<SnmpWalkRow>;
  stopReason: SnmpWalkStopReason;
  // The last OID read, to continue from. Absent when the walk was complete.
  nextOid?: string | undefined;
  failure?: SnmpWalkFailure | undefined;
  /*
   * The SNMP version the probe walked with, in the probe's spelling
   * (SnmpVersion: "1", "2c", "3").
   */
  snmpVersion?: string | undefined;
  // How many requests the walk sent, and how long it took.
  requestCount: number;
  durationInMs: number;
}

/*
 * What the server hands the probe with a walk it claims, besides the
 * device's credentials: where to walk and the bounds to keep. The bounds
 * travel with the job so a server can change them without a probe release.
 */
export interface NetworkDeviceSnmpWalkRequest {
  rootOid: string;
  afterOid?: string | undefined;
  maxOids: number;
  timeBudgetInMs: number;
  requestTimeoutInMs: number;
  maxRepetitions: number;
  pauseBetweenRequestsInMs: number;
}
