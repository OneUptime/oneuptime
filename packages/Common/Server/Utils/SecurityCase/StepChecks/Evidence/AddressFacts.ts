import AnalyticsTableName from "../../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityConnectedResourceJson,
  SecurityConnectionsJson,
} from "../../../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import SecurityEventService from "../../../../Services/SecurityEventService";
import ThreatIntelIndicatorService from "../../../../Services/ThreatIntelIndicatorService";
import { getQuerySettings } from "../../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../../AnalyticsDatabase/Statement";
/*
 * The connections, taken from ConnectionsLoader when the facts are first read,
 * never imported at load: the step checks load with SecurityCaseTaskService,
 * which the services the connections read reach (ConnectionsLoadOrder).
 */
import { loadSecurityConnections } from "../../../SecurityEvent/Connections/ConnectionsLoader";
import {
  ADDRESS_REQUESTS_READ_LIMIT,
  getAddressRequestSpellings,
  readAnalyticsRows,
} from "./AddressRequests";

/*
 * WHAT THE PROJECT KNOWS OF AN ADDRESS (#10340): the facts a Response Plan's
 * "Rule out a false positive" step is prefilled with, for a person - or
 * OneUptime AI (#10352) - to decide on. It is a judgement, so its check is
 * never Verified on its own: these are what to judge with.
 *
 *   records       the project's records in OneUptime that hold the address:
 *                 a host, a device, a cloud resource;
 *   threat intel  the project's threat intel feeds that list it, right now;
 *   sign-ins      the people who signed in from it in the last 30 days, as
 *                 the identity provider's events say: a user's own address
 *                 is rarely an attacker's.
 */

// The OCSF class of a sign-in, and the status of one that worked.
export const AUTHENTICATION_CLASS_UID: number = 3002;
export const SUCCESS_STATUS_NAME: string = "Success";

// How far back the sign-ins from an address are read.
export const SIGN_IN_WINDOW_IN_DAYS: number = 30;

export interface AddressFactsReading {
  // The name of one of the project's records that holds the address; empty for none.
  recordName: string;
  // How many of the project's threat intel feeds list it right now.
  threatIntelFeeds: number;
  // How many people signed in from it, and one of them.
  signedInUsers: number;
  signedInUser: string;
}

/*
 * The successful sign-ins from an address over the window: how many people,
 * and one of them. The address in any spelling the identity provider wrote
 * it in (#10744).
 */
export function buildSignedInUsersStatement(data: {
  projectId: ObjectID;
  address: string;
  start: Date;
  end: Date;
}): Statement {
  const statement: Statement = SQL`SELECT uniq(principalUser) AS users, any(principalUser) AS user FROM `;

  statement.append(AnalyticsTableName.SecurityEvent);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: data.start,
    }} AND time <= ${{
      type: TableColumnType.DateTime64,
      value: data.end,
    }} AND classUid = ${{
      type: TableColumnType.Number,
      value: AUTHENTICATION_CLASS_UID,
    }} AND statusName = ${{
      type: TableColumnType.Text,
      value: SUCCESS_STATUS_NAME,
    }} AND principalIp IN ${{
      type: TableColumnType.ArrayText,
      value: getAddressRequestSpellings(data.address),
    }} AND principalUser != ''`,
  );
  statement.append(getQuerySettings(ADDRESS_REQUESTS_READ_LIMIT));

  return statement;
}

// The first of the project's records that holds exactly this address.
export function getRecordHoldingAddress(
  connections: SecurityConnectionsJson,
  address: string,
): SecurityConnectedResourceJson | null {
  const wanted: string = address.trim().toLowerCase();

  return (
    connections.resources.find(
      (resource: SecurityConnectedResourceJson): boolean => {
        return resource.matches.some(
          (match: { entityValue: string; matchedValue: string }): boolean => {
            return (
              match.entityValue.trim().toLowerCase() === wanted &&
              match.matchedValue.trim().toLowerCase() === wanted
            );
          },
        );
      },
    ) || null
  );
}

/*
 * The values a threat intel feed may list the address under. A feed's
 * indicators are kept trimmed and in lower case as the feed wrote them, an
 * IPv6 one most often compressed, while a case keeps it written out, so it
 * is looked for in each of its spellings, in lower case (#10744).
 */
export function getThreatIntelAddressValues(address: string): Array<string> {
  return Array.from(
    new Set(
      getAddressRequestSpellings(address).map((spelling: string): string => {
        return spelling.trim().toLowerCase();
      }),
    ),
  );
}

export default class AddressFacts {
  // Throws when any of them cannot be read: what is not known is not a fact.
  public static async read(data: {
    projectId: ObjectID;
    address: string;
    now: Date;
  }): Promise<AddressFactsReading> {
    const start: Date = new Date(
      data.now.getTime() - SIGN_IN_WINDOW_IN_DAYS * 24 * 60 * 60 * 1000,
    );

    const [connections, indicators, signIns] = await Promise.all([
      loadSecurityConnections().default.forEntities({
        projectId: data.projectId,
        entities: [{ type: SecurityEntityType.IpAddress, value: data.address }],
        props: { isRoot: true },
        now: data.now,
      }),
      ThreatIntelIndicatorService.findActiveIndicatorsByValues({
        projectId: data.projectId,
        values: getThreatIntelAddressValues(data.address),
        now: data.now,
      }),
      readAnalyticsRows(
        SecurityEventService,
        buildSignedInUsersStatement({
          projectId: data.projectId,
          address: data.address,
          start,
          end: data.now,
        }),
      ),
    ]);

    const row: JSONObject = signIns[0] || {};

    return {
      recordName:
        getRecordHoldingAddress(connections, data.address)?.name || "",
      threatIntelFeeds: new Set(
        indicators.map((indicator: { feedId: string }): string => {
          return indicator.feedId;
        }),
      ).size,
      signedInUsers: Math.max(0, Math.trunc(Number(row["users"]) || 0)),
      signedInUser: typeof row["user"] === "string" ? row["user"] : "",
    };
  }
}
