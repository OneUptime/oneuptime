import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getSecurityAddressSpellings } from "../../../Types/SecurityBlocklist/SecurityAddressSpellings";
import {
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { readCampaignAsn } from "../../../Types/SecurityEvent/SecurityAttackCampaign";
import { SECURITY_ATTACK_NETWORK_ASN_ATTRIBUTE } from "../../../Types/SecurityEvent/SecurityAttackNetwork";
import NetworkAddressBlockUtil from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import SecurityEventService, {
  SECURITY_CONNECTION_READ_TIME_LIMIT,
} from "../../Services/SecurityEventService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * THE NETWORKS AN ADDRESS SENT FROM, FOR ITS REPEAT-OFFENDER RECORD (#10895).
 *
 * Challenge This Network on Campaigns holds a whole network by its ASN
 * (#10354), and an address in it was held with it - but OneUptime has no
 * ASN data of its own (RequestLocation.ts): only the ASN Cloudflare's
 * firewall events carry for each request (SECURITY_ATTACK_NETWORK_ASN_
 * ATTRIBUTE). So the record of an address counts its network's blocks and
 * challenges when the address's own Cloudflare events named that network,
 * over the record's window - and says which network held it.
 *
 * One read of the project's own events for every address asked about,
 * each in every spelling an event may hold it in (getSecurityAddressSpellings:
 * Cloudflare writes an IPv6 client compressed, a case keeps it written out),
 * at most MAX_ASNS_PER_ADDRESS networks each. Nothing here calls Cloudflare.
 * A read that fails reads as no network: the record then counts the
 * address's own blocks and its ranges', as it always did.
 */

// The most networks one address is read as having sent from: an address moves network rarely.
export const MAX_ASNS_PER_ADDRESS: number = 5;

// The most addresses one read asks about, each in its spellings.
export const MAX_ADDRESSES_PER_READ: number = 50;

/*
 * The SQL that reads them: each spelling of the addresses asked about, and
 * the ASNs its events named in the window.
 */
export function buildAddressAsnsStatement(data: {
  projectId: ObjectID;
  spellings: Array<string>;
  since: Date;
  until: Date;
}): Statement {
  const statement: Statement = SQL`SELECT principalIp AS address, `;

  // A parametric aggregate takes its parameter as a literal: this file's own constant.
  statement.append(`groupUniqArray(${Math.trunc(MAX_ASNS_PER_ADDRESS)})(`);
  statement.append(
    SQL`attributes[${{
      type: TableColumnType.Text,
      value: SECURITY_ATTACK_NETWORK_ASN_ATTRIBUTE,
    }}]) AS asns FROM ${AnalyticsTableName.SecurityEvent} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: data.since,
    }} AND time <= ${{
      type: TableColumnType.DateTime64,
      value: data.until,
    }} AND principalIp IN ${{
      type: TableColumnType.ArrayText,
      value: data.spellings,
    }} AND attributes[${{
      type: TableColumnType.Text,
      value: SECURITY_ATTACK_NETWORK_ASN_ATTRIBUTE,
    }}] != '' GROUP BY address LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, data.spellings.length),
    }}`,
  );

  statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

  return statement;
}

/*
 * The addresses asked about, as blocks write them, each with every
 * spelling an event may hold it in; a value that is no single address is
 * left out - a range's network is none of an address's.
 */
export function getAddressSpellingsToRead(
  addresses: ReadonlyArray<string>,
): Map<string, Array<string>> {
  const spellingsOf: Map<string, Array<string>> = new Map();

  for (const address of addresses) {
    const read: SecurityBlockValue | null = readSecurityBlockValue(address);

    if (
      !read ||
      !NetworkAddressBlockUtil.isSingleAddress(read.block) ||
      spellingsOf.has(read.value)
    ) {
      continue;
    }

    if (spellingsOf.size >= MAX_ADDRESSES_PER_READ) {
      break;
    }

    const spellings: Array<string> = getSecurityAddressSpellings(read.value);

    spellingsOf.set(
      read.value,
      spellings.length > 0 ? spellings : [read.value],
    );
  }

  return spellingsOf;
}

/*
 * The read's rows, as each address asked about's networks, as blocks
 * write an ASN ("AS14061"): the spellings an event held it in added up,
 * each network once, at most MAX_ASNS_PER_ADDRESS. An address none of whose
 * events named a network is left out.
 */
export function readAddressAsnRows(data: {
  spellingsOf: Map<string, Array<string>>;
  rows: ReadonlyArray<JSONObject>;
}): Map<string, Array<string>> {
  const addressOf: Map<string, string> = new Map();

  for (const [address, spellings] of data.spellingsOf) {
    for (const spelling of spellings) {
      addressOf.set(spelling, address);
    }
  }

  const asnsOf: Map<string, Array<string>> = new Map();

  for (const row of data.rows) {
    const spelling: string =
      typeof row["address"] === "string" ? row["address"] : "";
    const address: string | undefined = addressOf.get(spelling);

    if (!address) {
      continue;
    }

    const asns: Array<string> = asnsOf.get(address) || [];

    for (const value of Array.isArray(row["asns"])
      ? (row["asns"] as Array<JSONValue>)
      : []) {
      const asn: string | null = readCampaignAsn(value);

      if (asn && !asns.includes(asn) && asns.length < MAX_ASNS_PER_ADDRESS) {
        asns.push(asn);
      }
    }

    if (asns.length > 0) {
      asnsOf.set(address, asns);
    }
  }

  return asnsOf;
}

export default class SecurityRepeatOffenderNetworks {
  /*
   * The networks each address's Cloudflare events named between `since`
   * and `until`, by the address as blocks write it. Never throws: a read
   * that fails is logged, and reads as no network.
   */
  @CaptureSpan()
  public static async readAsns(data: {
    projectId: ObjectID;
    addresses: ReadonlyArray<string>;
    since: Date;
    until: Date;
  }): Promise<Map<string, Array<string>>> {
    const spellingsOf: Map<string, Array<string>> = getAddressSpellingsToRead(
      data.addresses,
    );
    const spellings: Array<string> = Array.from(spellingsOf.values()).flat();

    if (spellings.length === 0) {
      return new Map();
    }

    try {
      const result: Awaited<
        ReturnType<typeof SecurityEventService.executeQuery>
      > = await SecurityEventService.executeQuery(
        buildAddressAsnsStatement({
          projectId: data.projectId,
          spellings,
          since: data.since,
          until: data.until,
        }),
      );
      const response: { data?: Array<JSONObject> } = await result.json<{
        data?: Array<JSONObject>;
      }>();

      return readAddressAsnRows({ spellingsOf, rows: response.data || [] });
    } catch (error) {
      logger.warn(
        `SecurityRepeatOffenderNetworks: could not read the networks of ${spellingsOf.size} addresses of project ${data.projectId.toString()}; their records count their own blocks only. ${String(error)}`,
      );

      return new Map();
    }
  }
}
