import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../Models/DatabaseModels/TraceScrubRule";
import { SpanKind } from "../../../Models/AnalyticsModels/Span";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../Types/ObjectID";
import { SECURITY_SIGNED_IN_ADDRESS_LOOKBACK_IN_MS } from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { getSecurityAddressSpellings } from "../../../Types/SecurityBlocklist/SecurityAddressSpellings";
import NetworkAddressBlockUtil from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  AddressScrubRule,
  ScrubbedAddressKind,
  ScrubbedAddressSignal,
  findScrubRuleHidingAddresses,
  getScrubbedKindOfAction,
} from "../../../Utils/SecurityEvent/ScrubbedAddress";
import { readClickhouseTime } from "../../../Utils/SecurityCase/SecurityCaseStoryItems";
import LogScrubRuleService from "../../Services/LogScrubRuleService";
import LogService from "../../Services/LogService";
import SecurityEventService from "../../Services/SecurityEventService";
import SpanService from "../../Services/SpanService";
import TraceScrubRuleService from "../../Services/TraceScrubRuleService";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";
import {
  ADDRESS_REQUESTS_READ_LIMIT,
  LOG_CLIENT_ADDRESS_ATTRIBUTES,
  SPAN_CLIENT_ADDRESS_ATTRIBUTES,
  readAnalyticsRows,
} from "../SecurityCase/StepChecks/Evidence/AddressRequests";
import { buildIpInAnyRangeExpression } from "../SecurityEvent/SecurityValueMatch";
import ScrubbedClientAddresses from "../SecurityEvent/ScrubbedClientAddresses";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ScrubHashToken from "../Telemetry/ScrubHashToken";

/*
 * HAS A SIGNED-IN USER USED THIS ADDRESS, OR AN ADDRESS OF THIS RANGE,
 * LATELY - AND WHO? (#10350)
 *
 * An automatic response never blocks an address a signed-in user has used
 * in the last 30 days: an office's NAT, a customer's proxy and a person's
 * home address are all shared with someone signed in. Campaigns (#10354)
 * ask the same of a network before they challenge it, naming who. Two
 * places say a signed-in user was there:
 *
 *   - the user ids the project's app records on its requests: a server
 *     span's, or a log line's, `enduser.id` (or `user.id`), with the client
 *     address it came from (`client.address`, `http.client_ip`, and the log
 *     fields access logs use);
 *   - its identity provider's sign-ins, as Security Events stores them from
 *     Okta, Microsoft Entra ID, Google Workspace and the rest: a successful
 *     authentication (OCSF class 3002) naming a user, from the address.
 *
 * WHEN A SCRUB RULE HIDES ADDRESSES. A Hash rule (#10443) writes an address
 * as its project's keyed token, which this check works out for the address
 * itself (ScrubHashToken, exactly as ingest wrote it) and looks for beside
 * the address - so hashing hides nobody. Nothing else can be matched:
 *
 *   - a Redact or Mask rule leaves no address to match;
 *   - a Hash rule made before tokens were keyed (KEYED_SCRUB_TOKENS_SINCE)
 *     wrote tokens nobody can work out again, while they are within the
 *     30 days;
 *   - an identity provider's sign-in read from logs whose address a rule
 *     hid has no address left at all;
 *   - a range too wide to work out every token of, under a Hash rule.
 *
 * In each case - and whenever a read fails or runs out of time - the
 * answer is CannotTell, with why: the caller leaves the address for a
 * person (fail toward a person). The address vault (#10496) is not read:
 * it answers what address a token stands for, and this asks the token of
 * an address, which the keyed hash answers with no vault and nobody's
 * addresses read.
 *
 * check() asks of one address or range; checkMany() of many addresses at
 * once, each since its own moment, with one read per source - what undo on
 * doubt asks of every address the policies blocked, every minute.
 */

// When scrub tokens became keyed: a Hash rule older than this wrote tokens nothing can match again.
export const KEYED_SCRUB_TOKENS_SINCE: Date = new Date("2026-11-20T00:00:00Z");

// The widest range whose every address (and its token) the check lists: an IPv4 /24.
export const SECURITY_SIGNED_IN_ENUMERATED_IPV4_PREFIX: number = 24;

// The most users a check names, of each source.
export const SECURITY_SIGNED_IN_MAX_USERS: number = 5;

// The most rows one read of many addresses takes.
export const SECURITY_SIGNED_IN_MAX_ROWS: number = 5000;

// The most addresses one checkMany() takes.
export const SECURITY_SIGNED_IN_MAX_ADDRESSES: number = 1000;

// OCSF Authentication, as a successful sign-in is stored.
const AUTHENTICATION_CLASS_UID: number = 3002;
const SUCCESS_STATUS_NAME: string = "Success";

// Where a signed-in user's id is recorded on a request.
export const SIGNED_IN_USER_ATTRIBUTES: ReadonlyArray<string> = [
  "enduser.id",
  "user.id",
];

export enum SecuritySignedInAddressState {
  // Nobody signed in used it in the window.
  None = "None",
  SignedIn = "SignedIn",
  // OneUptime could not tell, and says why: leave the address for a person.
  CannotTell = "CannotTell",
}

export enum SecuritySignedInSource {
  // A user id the app recorded on a request from the address.
  Requests = "Requests",
  // A successful sign-in to the identity provider from the address.
  IdentityProvider = "IdentityProvider",
}

export interface SecuritySignedInUser {
  name: string;
  source: SecuritySignedInSource;
  lastSeenAt: Date | null;
}

interface CheckBase {
  // The address or range asked about, as blocks are written.
  value: string;
  since: Date;
}

export type SecuritySignedInAddressCheck =
  | (CheckBase & { state: SecuritySignedInAddressState.None })
  | (CheckBase & {
      state: SecuritySignedInAddressState.SignedIn;
      // The latest first, at most SECURITY_SIGNED_IN_MAX_USERS of each source.
      users: Array<SecuritySignedInUser>;
    })
  | (CheckBase & {
      state: SecuritySignedInAddressState.CannotTell;
      // Why, in a sentence that says what to do.
      reason: string;
    });

// What checkMany() found: who used each address since its moment, or why it cannot tell for any.
export type SecuritySignedInManyCheck =
  | {
      state: SecuritySignedInAddressState.SignedIn;
      // Only the addresses someone signed in used, the latest first each.
      usersByAddress: Map<string, Array<SecuritySignedInUser>>;
    }
  | { state: SecuritySignedInAddressState.CannotTell; reason: string };

/*
 * How the addresses appear in a record: the spellings sources write, and
 * the tokens a Hash rule writes, each pointing back at its address; or a
 * range too wide to list, matched as a range.
 */
export interface SecuritySignedInMatch {
  values: Array<string>;
  // Each value's address, as blocks are written.
  addressOf: Record<string, string>;
  range: string | null;
}

export const SECURITY_SIGNED_IN_MESSAGES: {
  notAnAddress: (value: string) => string;
  readFailed: (value: string) => string;
  hiddenByRule: (data: {
    value: string;
    ruleName: string;
    signal: ScrubbedAddressSignal;
  }) => string;
  unkeyedTokens: (value: string) => string;
  rangeTooWideToHash: (value: string) => string;
  signInsHidden: (value: string) => string;
} = {
  notAnAddress: (value: string): string => {
    return `${value} is not an IP address or range, so OneUptime cannot tell who used it.`;
  },
  readFailed: (value: string): string => {
    return `OneUptime could not read the requests and sign-ins from ${value} just now, so it cannot tell whether a signed-in user used it. It is left for a person.`;
  },
  hiddenByRule: (data: {
    value: string;
    ruleName: string;
    signal: ScrubbedAddressSignal;
  }): string => {
    return `Your scrub rule ${data.ruleName} hides client addresses in your ${data.signal === "log" ? "logs" : "traces"}, so OneUptime cannot tell whether a signed-in user used ${data.value}. It is left for a person: hash addresses instead to let OneUptime check.`;
  },
  unkeyedTokens: (value: string): string => {
    return `A scrub rule hashed client addresses before November 20, 2026, in a way OneUptime cannot match again, so it cannot tell whether a signed-in user used ${value} in the last 30 days. It is left for a person.`;
  },
  rangeTooWideToHash: (value: string): string => {
    return `${value} is too wide a range for OneUptime to work out the hashed form of every address in it, and a scrub rule hashes client addresses, so it cannot tell whether a signed-in user used it. It is left for a person.`;
  },
  signInsHidden: (value: string): string => {
    return `Some sign-ins in your logs have their address hidden by a scrub rule, so OneUptime cannot tell whether a signed-in user used ${value}. It is left for a person.`;
  },
};

/*
 * The addresses a check lists one by one: the address itself, or every
 * address of an IPv4 range no wider than a /24. Null for a wider range,
 * which is matched as a range.
 */
export function listSecuritySignedInAddresses(
  value: SecurityBlockValue,
): Array<string> | null {
  if (NetworkAddressBlockUtil.isSingleAddress(value.block)) {
    return [value.value];
  }

  if (
    value.block.family !== 4 ||
    value.block.prefixLength < SECURITY_SIGNED_IN_ENUMERATED_IPV4_PREFIX
  ) {
    return null;
  }

  const octets: Array<number> = value.value
    .split("/")[0]!
    .split(".")
    .map(Number);
  const first: number =
    octets[0]! * 16777216 + octets[1]! * 65536 + octets[2]! * 256 + octets[3]!;
  const count: number = Math.pow(2, 32 - value.block.prefixLength);
  const addresses: Array<string> = [];

  for (let offset: number = 0; offset < count; offset++) {
    const address: number = first + offset;

    addresses.push(
      [
        Math.floor(address / 16777216) % 256,
        Math.floor(address / 65536) % 256,
        Math.floor(address / 256) % 256,
        address % 256,
      ].join("."),
    );
  }

  return addresses;
}

/*
 * What a record holding one of the addresses holds: each address's
 * spellings and, when the project hashes addresses, its keyed token, each
 * pointing back at the address.
 */
export function getSecuritySignedInMatchOfAddresses(data: {
  projectId: ObjectID;
  addresses: ReadonlyArray<string>;
  isHashing: boolean;
}): SecuritySignedInMatch {
  const addressOf: Record<string, string> = {};

  for (const given of data.addresses) {
    const read: SecurityBlockValue | null = readSecurityBlockValue(given);

    if (!read || !NetworkAddressBlockUtil.isSingleAddress(read.block)) {
      continue;
    }

    for (const spelling of getSecurityAddressSpellings(read.value)) {
      addressOf[spelling] = read.value;
    }

    if (data.isHashing) {
      addressOf[
        ScrubHashToken.ofIpAddress({
          projectId: data.projectId,
          address: read.value,
        })
      ] = read.value;
    }
  }

  return { values: Object.keys(addressOf), addressOf, range: null };
}

/*
 * What a record holding the address, or an address of the range, holds:
 * its addresses' spellings and tokens; or the range itself when it is too
 * wide to list.
 */
export function getSecuritySignedInMatch(data: {
  projectId: ObjectID;
  value: SecurityBlockValue;
  isHashing: boolean;
}): SecuritySignedInMatch {
  const addresses: Array<string> | null = listSecuritySignedInAddresses(
    data.value,
  );

  if (!addresses) {
    return { values: [], addressOf: {}, range: data.value.value };
  }

  return getSecuritySignedInMatchOfAddresses({
    projectId: data.projectId,
    addresses,
    isHashing: data.isHashing,
  });
}

// A column, or one attribute of the record, holding an address the match names.
function appendAddressCondition(data: {
  statement: Statement;
  expression: Statement;
  match: SecuritySignedInMatch;
}): void {
  if (data.match.range) {
    data.statement.append(
      buildIpInAnyRangeExpression(data.expression, [data.match.range]),
    );
    return;
  }

  data.statement.append(data.expression);
  data.statement.append(
    SQL` IN ${{ type: TableColumnType.ArrayText, value: data.match.values }}`,
  );
}

function attribute(name: string): Statement {
  return SQL`attributes[${{ type: TableColumnType.Text, value: name }}]`;
}

// The user a request names: its enduser.id, else its user.id.
function appendUserExpression(statement: Statement): void {
  statement.append("if(");
  statement.append(attribute(SIGNED_IN_USER_ATTRIBUTES[0]!));
  statement.append(" != '', ");
  statement.append(attribute(SIGNED_IN_USER_ATTRIBUTES[0]!));
  statement.append(", ");
  statement.append(attribute(SIGNED_IN_USER_ATTRIBUTES[1]!));
  statement.append(")");
}

function appendSignedInCondition(statement: Statement): void {
  statement.append(" AND (");
  SIGNED_IN_USER_ATTRIBUTES.forEach((name: string, index: number): void => {
    statement.append(index === 0 ? "" : " OR ");
    statement.append(attribute(name));
    statement.append(" != ''");
  });
  statement.append(")");
}

/*
 * The users an app's requests from the addresses named over the window,
 * the latest first: server spans or log lines, by the attributes each
 * records its client address under. By address, each row also names the
 * address columns it was read from (address0, address1, ...).
 */
export function buildSignedInRequestsStatement(data: {
  projectId: ObjectID;
  match: SecuritySignedInMatch;
  since: Date;
  until: Date;
  signal: ScrubbedAddressSignal;
  byAddress?: boolean | undefined;
}): Statement {
  const isTrace: boolean = data.signal === "trace";
  const timeColumn: string = isTrace ? "startTime" : "time";
  const addressAttributes: ReadonlyArray<string> = isTrace
    ? SPAN_CLIENT_ADDRESS_ATTRIBUTES
    : LOG_CLIENT_ADDRESS_ATTRIBUTES;
  const statement: Statement = SQL`SELECT `;

  appendUserExpression(statement);
  statement.append(` AS user, max(${timeColumn}) AS lastSeen`);

  if (data.byAddress) {
    addressAttributes.forEach((name: string, index: number): void => {
      statement.append(", ");
      statement.append(attribute(name));
      statement.append(` AS address${index}`);
    });
  }

  statement.append(" FROM ");
  statement.append(isTrace ? AnalyticsTableName.Span : AnalyticsTableName.Log);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }}`,
  );
  statement.append(` AND ${timeColumn} >= `);
  statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: data.since }}`,
  );
  statement.append(` AND ${timeColumn} <= `);
  statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: data.until }}`,
  );

  if (isTrace) {
    statement.append(
      SQL` AND kind = ${{ type: TableColumnType.Text, value: SpanKind.Server }}`,
    );
  }

  appendSignedInCondition(statement);
  statement.append(" AND (");

  addressAttributes.forEach((name: string, index: number): void => {
    statement.append(index === 0 ? "" : " OR ");
    appendAddressCondition({
      statement,
      expression: attribute(name),
      match: data.match,
    });
  });

  statement.append(") GROUP BY user");

  if (data.byAddress) {
    addressAttributes.forEach((_name: string, index: number): void => {
      statement.append(`, address${index}`);
    });
  }

  statement.append(
    ` ORDER BY lastSeen DESC LIMIT ${data.byAddress ? SECURITY_SIGNED_IN_MAX_ROWS : SECURITY_SIGNED_IN_MAX_USERS}`,
  );
  statement.append(getQuerySettings(ADDRESS_REQUESTS_READ_LIMIT));

  return statement;
}

// The users who signed in to the identity provider from the addresses over the window, the latest first.
export function buildSignedInSignInsStatement(data: {
  projectId: ObjectID;
  match: SecuritySignedInMatch;
  since: Date;
  until: Date;
  byAddress?: boolean | undefined;
}): Statement {
  const statement: Statement = SQL`SELECT principalUser AS user, max(time) AS lastSeen`;

  if (data.byAddress) {
    statement.append(", principalIp AS address0");
  }

  statement.append(" FROM ");
  statement.append(AnalyticsTableName.SecurityEvent);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: data.since,
    }} AND time <= ${{
      type: TableColumnType.DateTime64,
      value: data.until,
    }} AND classUid = ${{
      type: TableColumnType.Number,
      value: AUTHENTICATION_CLASS_UID,
    }} AND statusName = ${{
      type: TableColumnType.Text,
      value: SUCCESS_STATUS_NAME,
    }} AND principalUser != '' AND `,
  );
  appendAddressCondition({
    statement,
    expression: SQL`principalIp`,
    match: data.match,
  });
  statement.append(
    data.byAddress
      ? ` GROUP BY user, address0 ORDER BY lastSeen DESC LIMIT ${SECURITY_SIGNED_IN_MAX_ROWS}`
      : ` GROUP BY user ORDER BY lastSeen DESC LIMIT ${SECURITY_SIGNED_IN_MAX_USERS}`,
  );
  statement.append(getQuerySettings(ADDRESS_REQUESTS_READ_LIMIT));

  return statement;
}

// How many sign-ins of the window kept no address: what a scrub rule hid in logs.
export function buildHiddenSignInsStatement(data: {
  projectId: ObjectID;
  since: Date;
  until: Date;
}): Statement {
  const statement: Statement = SQL`SELECT count() AS hidden FROM `;

  statement.append(AnalyticsTableName.SecurityEvent);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: data.since,
    }} AND time <= ${{
      type: TableColumnType.DateTime64,
      value: data.until,
    }} AND classUid = ${{
      type: TableColumnType.Number,
      value: AUTHENTICATION_CLASS_UID,
    }} AND statusName = ${{
      type: TableColumnType.Text,
      value: SUCCESS_STATUS_NAME,
    }} AND principalUser != '' AND principalIp = ''`,
  );
  statement.append(getQuerySettings(ADDRESS_REQUESTS_READ_LIMIT));

  return statement;
}

// The users rows name, of a source.
export function readSignedInUsers(
  rows: ReadonlyArray<JSONObject>,
  source: SecuritySignedInSource,
): Array<SecuritySignedInUser> {
  const users: Array<SecuritySignedInUser> = [];

  for (const row of rows) {
    const name: JSONValue | undefined = row["user"];

    if (typeof name !== "string" || !name.trim()) {
      continue;
    }

    users.push({
      name: name.trim(),
      source,
      lastSeenAt: readClickhouseTime(row["lastSeen"]),
    });
  }

  return users;
}

/*
 * The users rows name, by the address each row's address columns point
 * back at (the match's addressOf): a row read from several columns counts
 * for each address it names.
 */
export function readSignedInUsersByAddress(data: {
  rows: ReadonlyArray<JSONObject>;
  source: SecuritySignedInSource;
  match: SecuritySignedInMatch;
}): Map<string, Array<SecuritySignedInUser>> {
  const byAddress: Map<string, Array<SecuritySignedInUser>> = new Map();

  for (const row of data.rows) {
    const [user] = readSignedInUsers([row], data.source);

    if (!user) {
      continue;
    }

    const addresses: Set<string> = new Set();

    for (const [key, value] of Object.entries(row)) {
      if (!key.startsWith("address") || typeof value !== "string") {
        continue;
      }

      const address: string | undefined = data.match.addressOf[value.trim()];

      if (address) {
        addresses.add(address);
      }
    }

    for (const address of addresses) {
      byAddress.set(address, [...(byAddress.get(address) || []), user]);
    }
  }

  return byAddress;
}

// Each user once, of each source, the latest first.
export function dedupeSignedInUsers(
  users: ReadonlyArray<SecuritySignedInUser>,
): Array<SecuritySignedInUser> {
  const kept: Map<string, SecuritySignedInUser> = new Map();

  for (const user of users) {
    const key: string = `${user.source}|${user.name.toLowerCase()}`;
    const known: SecuritySignedInUser | undefined = kept.get(key);

    if (
      !known ||
      (user.lastSeenAt &&
        (!known.lastSeenAt ||
          user.lastSeenAt.getTime() > known.lastSeenAt.getTime()))
    ) {
      kept.set(key, user);
    }
  }

  return Array.from(kept.values()).sort(
    (a: SecuritySignedInUser, b: SecuritySignedInUser): number => {
      return (b.lastSeenAt?.getTime() || 0) - (a.lastSeenAt?.getTime() || 0);
    },
  );
}

// What the project's IP Address scrub rules of a kind do, as the check needs them.
interface ScrubRulesRead {
  // A rule that leaves no address to match, when there is one.
  hiding: AddressScrubRule | null;
  // Whether a rule hashes addresses.
  isHashing: boolean;
  // Whether a rule that hashes addresses is older than keyed tokens.
  hasUnkeyedTokens: boolean;
}

// What the project's scrub rules let a check read, or why it cannot tell.
interface ScrubState {
  isHashing: boolean;
  hidesInLogs: boolean;
  cannotTell: ((value: string) => string) | null;
}

export default class SecuritySignedInAddresses {
  /*
   * Whether a signed-in user used the address, or an address of the range,
   * since `since` (30 days back unless given), and who. Never throws: a
   * read that fails is CannotTell.
   */
  @CaptureSpan()
  public static async check(data: {
    projectId: ObjectID;
    value: string;
    now?: Date | undefined;
    since?: Date | undefined;
  }): Promise<SecuritySignedInAddressCheck> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const since: Date =
      data.since ||
      new Date(now.getTime() - SECURITY_SIGNED_IN_ADDRESS_LOOKBACK_IN_MS);
    const read: SecurityBlockValue | null = readSecurityBlockValue(data.value);

    if (!read) {
      return {
        state: SecuritySignedInAddressState.CannotTell,
        value: data.value,
        since,
        reason: SECURITY_SIGNED_IN_MESSAGES.notAnAddress(data.value),
      };
    }

    const cannotTell: (reason: string) => SecuritySignedInAddressCheck = (
      reason: string,
    ): SecuritySignedInAddressCheck => {
      return {
        state: SecuritySignedInAddressState.CannotTell,
        value: read.value,
        since,
        reason,
      };
    };

    try {
      const scrub: ScrubState = await this.readScrubState({
        projectId: data.projectId,
        since,
      });

      if (scrub.cannotTell) {
        return cannotTell(scrub.cannotTell(read.value));
      }

      const match: SecuritySignedInMatch = getSecuritySignedInMatch({
        projectId: data.projectId,
        value: read,
        isHashing: scrub.isHashing,
      });

      if (match.range && scrub.isHashing) {
        return cannotTell(
          SECURITY_SIGNED_IN_MESSAGES.rangeTooWideToHash(read.value),
        );
      }

      const [spanRows, logRows, signInRows, hidden]: [
        Array<JSONObject>,
        Array<JSONObject>,
        Array<JSONObject>,
        number,
      ] = await Promise.all([
        readAnalyticsRows(
          SpanService,
          buildSignedInRequestsStatement({
            projectId: data.projectId,
            match,
            since,
            until: now,
            signal: "trace",
          }),
        ),
        readAnalyticsRows(
          LogService,
          buildSignedInRequestsStatement({
            projectId: data.projectId,
            match,
            since,
            until: now,
            signal: "log",
          }),
        ),
        readAnalyticsRows(
          SecurityEventService,
          buildSignedInSignInsStatement({
            projectId: data.projectId,
            match,
            since,
            until: now,
          }),
        ),
        this.countHiddenSignIns({
          projectId: data.projectId,
          scrub,
          since,
          now,
        }),
      ]);

      const users: Array<SecuritySignedInUser> = dedupeSignedInUsers([
        ...readSignedInUsers(spanRows, SecuritySignedInSource.Requests),
        ...readSignedInUsers(logRows, SecuritySignedInSource.Requests),
        ...readSignedInUsers(
          signInRows,
          SecuritySignedInSource.IdentityProvider,
        ),
      ]);

      if (users.length > 0) {
        return {
          state: SecuritySignedInAddressState.SignedIn,
          value: read.value,
          since,
          users,
        };
      }

      if (hidden > 0) {
        return cannotTell(
          SECURITY_SIGNED_IN_MESSAGES.signInsHidden(read.value),
        );
      }

      return {
        state: SecuritySignedInAddressState.None,
        value: read.value,
        since,
      };
    } catch (error) {
      logger.warn(
        `SecuritySignedInAddresses: could not tell who used ${read.value} in project ${data.projectId.toString()}: ${String(error)}`,
      );

      return cannotTell(SECURITY_SIGNED_IN_MESSAGES.readFailed(read.value));
    }
  }

  /*
   * Who used each of many addresses since its own moment, with one read
   * per source: the addresses no signed-in user used are left out of the
   * answer. CannotTell for all of them when a rule or a read keeps
   * OneUptime from telling. At most SECURITY_SIGNED_IN_MAX_ADDRESSES
   * addresses; ranges are asked of check(). Never throws.
   */
  @CaptureSpan()
  public static async checkMany(data: {
    projectId: ObjectID;
    addresses: ReadonlyArray<{ value: string; since: Date }>;
    now?: Date | undefined;
  }): Promise<SecuritySignedInManyCheck> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const sinceOf: Map<string, Date> = new Map();

    for (const entry of data.addresses.slice(
      0,
      SECURITY_SIGNED_IN_MAX_ADDRESSES,
    )) {
      const read: SecurityBlockValue | null = readSecurityBlockValue(
        entry.value,
      );

      if (!read || !NetworkAddressBlockUtil.isSingleAddress(read.block)) {
        continue;
      }

      const known: Date | undefined = sinceOf.get(read.value);

      if (!known || entry.since.getTime() < known.getTime()) {
        sinceOf.set(read.value, entry.since);
      }
    }

    if (sinceOf.size === 0) {
      return {
        state: SecuritySignedInAddressState.SignedIn,
        usersByAddress: new Map(),
      };
    }

    const since: Date = new Date(
      Math.min(
        ...Array.from(sinceOf.values()).map((date: Date): number => {
          return date.getTime();
        }),
      ),
    );
    const named: string = Array.from(sinceOf.keys()).join(", ");

    try {
      const scrub: ScrubState = await this.readScrubState({
        projectId: data.projectId,
        since,
      });

      if (scrub.cannotTell) {
        return {
          state: SecuritySignedInAddressState.CannotTell,
          reason: scrub.cannotTell(named),
        };
      }

      const match: SecuritySignedInMatch = getSecuritySignedInMatchOfAddresses({
        projectId: data.projectId,
        addresses: Array.from(sinceOf.keys()),
        isHashing: scrub.isHashing,
      });

      const [spanRows, logRows, signInRows]: [
        Array<JSONObject>,
        Array<JSONObject>,
        Array<JSONObject>,
      ] = await Promise.all([
        readAnalyticsRows(
          SpanService,
          buildSignedInRequestsStatement({
            projectId: data.projectId,
            match,
            since,
            until: now,
            signal: "trace",
            byAddress: true,
          }),
        ),
        readAnalyticsRows(
          LogService,
          buildSignedInRequestsStatement({
            projectId: data.projectId,
            match,
            since,
            until: now,
            signal: "log",
            byAddress: true,
          }),
        ),
        readAnalyticsRows(
          SecurityEventService,
          buildSignedInSignInsStatement({
            projectId: data.projectId,
            match,
            since,
            until: now,
            byAddress: true,
          }),
        ),
      ]);

      const usersByAddress: Map<
        string,
        Array<SecuritySignedInUser>
      > = new Map();

      for (const [rows, source] of [
        [spanRows, SecuritySignedInSource.Requests],
        [logRows, SecuritySignedInSource.Requests],
        [signInRows, SecuritySignedInSource.IdentityProvider],
      ] as Array<[Array<JSONObject>, SecuritySignedInSource]>) {
        for (const [address, users] of readSignedInUsersByAddress({
          rows,
          source,
          match,
        })) {
          const addressSince: Date | undefined = sinceOf.get(address);
          const recent: Array<SecuritySignedInUser> = users.filter(
            (user: SecuritySignedInUser): boolean => {
              return Boolean(
                addressSince &&
                  user.lastSeenAt &&
                  user.lastSeenAt.getTime() >= addressSince.getTime(),
              );
            },
          );

          if (recent.length > 0) {
            usersByAddress.set(
              address,
              dedupeSignedInUsers([
                ...(usersByAddress.get(address) || []),
                ...recent,
              ]),
            );
          }
        }
      }

      return { state: SecuritySignedInAddressState.SignedIn, usersByAddress };
    } catch (error) {
      logger.warn(
        `SecuritySignedInAddresses: could not tell who used ${sinceOf.size} addresses in project ${data.projectId.toString()}: ${String(error)}`,
      );

      return {
        state: SecuritySignedInAddressState.CannotTell,
        reason: SECURITY_SIGNED_IN_MESSAGES.readFailed(named),
      };
    }
  }

  // How many sign-ins of the window lost their address to a log rule: only read when a rule hides or hashes addresses in logs.
  private static async countHiddenSignIns(data: {
    projectId: ObjectID;
    scrub: ScrubState;
    since: Date;
    now: Date;
  }): Promise<number> {
    if (!data.scrub.hidesInLogs) {
      return 0;
    }

    const rows: Array<JSONObject> = await readAnalyticsRows(
      SecurityEventService,
      buildHiddenSignInsStatement({
        projectId: data.projectId,
        since: data.since,
        until: data.now,
      }),
    );

    return Number(rows[0]?.["hidden"] || 0);
  }

  /*
   * What the project's scrub rules let a check read since `since`: whether
   * addresses are hashed, whether a log rule may have hidden sign-ins'
   * addresses, or - a rule that hides them past matching, or hashed them
   * before tokens were keyed within the window - why it cannot tell.
   */
  private static async readScrubState(data: {
    projectId: ObjectID;
    since: Date;
  }): Promise<ScrubState> {
    const [logRules, traceRules]: [ScrubRulesRead, ScrubRulesRead] =
      await Promise.all([
        this.readScrubRules({ projectId: data.projectId, signal: "log" }),
        this.readScrubRules({ projectId: data.projectId, signal: "trace" }),
      ]);

    for (const [signal, rules] of [
      ["log", logRules],
      ["trace", traceRules],
    ] as Array<[ScrubbedAddressSignal, ScrubRulesRead]>) {
      if (rules.hiding) {
        const ruleName: string = rules.hiding.name || "without a name";

        return {
          isHashing: false,
          hidesInLogs: true,
          cannotTell: (value: string): string => {
            return SECURITY_SIGNED_IN_MESSAGES.hiddenByRule({
              value,
              ruleName,
              signal,
            });
          },
        };
      }
    }

    if (
      (logRules.hasUnkeyedTokens || traceRules.hasUnkeyedTokens) &&
      data.since.getTime() < KEYED_SCRUB_TOKENS_SINCE.getTime()
    ) {
      return {
        isHashing: true,
        hidesInLogs: true,
        cannotTell: SECURITY_SIGNED_IN_MESSAGES.unkeyedTokens,
      };
    }

    return {
      isHashing: logRules.isHashing || traceRules.isHashing,
      hidesInLogs: logRules.isHashing,
      cannotTell: null,
    };
  }

  /*
   * What the project's IP Address scrub rules of a kind do: one that hides
   * addresses beyond matching, whether one hashes them, and whether one
   * that hashes them is older than keyed tokens - read as OneUptime.
   */
  private static async readScrubRules(data: {
    projectId: ObjectID;
    signal: ScrubbedAddressSignal;
  }): Promise<ScrubRulesRead> {
    const rules: Array<AddressScrubRule> =
      await ScrubbedClientAddresses.getCachedAddressScrubRules(data);
    const hashing: Array<AddressScrubRule> = rules.filter(
      (rule: AddressScrubRule): boolean => {
        return (
          getScrubbedKindOfAction(rule.scrubAction) ===
          ScrubbedAddressKind.Hashed
        );
      },
    );

    let hasUnkeyedTokens: boolean = false;

    if (hashing.length > 0) {
      const query: {
        projectId: ObjectID;
        patternType: LogScrubPatternType;
      } = {
        projectId: data.projectId,
        patternType: LogScrubPatternType.IPAddress,
      };
      const select: { _id: true; scrubAction: true; createdAt: true } = {
        _id: true,
        scrubAction: true,
        createdAt: true,
      };
      const stored: Array<LogScrubRule | TraceScrubRule> =
        data.signal === "log"
          ? await LogScrubRuleService.findBy({
              query,
              select,
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: { isRoot: true },
            })
          : await TraceScrubRuleService.findBy({
              query,
              select,
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: { isRoot: true },
            });

      hasUnkeyedTokens = stored.some(
        (rule: LogScrubRule | TraceScrubRule): boolean => {
          return (
            getScrubbedKindOfAction(rule.scrubAction || "") ===
              ScrubbedAddressKind.Hashed &&
            Boolean(rule.createdAt) &&
            new Date(rule.createdAt!).getTime() <
              KEYED_SCRUB_TOKENS_SINCE.getTime()
          );
        },
      );
    }

    return {
      hiding: findScrubRuleHidingAddresses(rules, data.signal),
      isHashing: hashing.length > 0,
      hasUnkeyedTokens,
    };
  }
}
