import { JSONObject } from "../../Types/JSON";
import { SnmpVersionUtil } from "../../Types/Monitor/SnmpMonitor/SnmpVersion";

/*
 * "Does this row carry enough to open an SNMP session with?"
 *
 * The question is asked of three different rows in turn at poll time - the
 * device's own snmp* columns, the profile the device points at, and the
 * profile the device's site points at - and the first row that answers yes is
 * the one the device is walked with. A device with no usable set anywhere is
 * pinged and never walked. So this function is the resolution order's
 * predicate, and it is deliberately shaped to accept ANY object carrying the
 * fields it reads rather than a NetworkDevice or a
 * NetworkSnmpCredentialProfile specifically: the caller hands it whichever
 * row it is looking at and gets the same answer for each.
 *
 * "Usable" is the minimum an SNMP session needs to be attempted, not a
 * guarantee it will succeed:
 *
 *   - v1 / v2c: a non-empty community string. There is nothing else to send.
 *   - v3: a non-empty security name (username). Auth and privacy keys are
 *     legitimately absent at noAuthNoPriv, so their absence must not make a
 *     v3 row unusable; a wrong key at a higher level is the device's error to
 *     report, not this function's to predict. A device's username is its
 *     snmpV3Username column, or - where that is empty - the username of the
 *     deprecated snmpV3Auth object a device kept its v3 credentials in
 *     before the columns existed (#9268): the walk reads that object then
 *     (NetworkDeviceHydrationUtil.buildSnmpV3Auth), so a device whose
 *     credentials are only there is walked, not pinged.
 *
 * Whitespace-only values count as empty. A community string of "   " is what
 * a form submits when an operator clears the field without the browser
 * sending null, and it is not a credential anything will accept.
 *
 * The version is read through SnmpVersionUtil.parse, never compared as raw
 * text, for the reason that module documents: the stored spelling is "V3"
 * and the enum's is "3", and a raw comparison sends a v3 row down the v2c
 * branch. parse() treats a missing or unrecognised version as v2c, which is
 * also the column default on both the device and the profile - so a row with
 * a community string and no version at all is usable, exactly as it would be
 * polled.
 */

/*
 * `| undefined` is spelled out on each field because the repo compiles with
 * exactOptionalPropertyTypes: a caller building the carrier from a row it
 * only partially selected (`{ snmpVersion: row.snmpVersion }`) hands over an
 * explicit undefined, and that must type-check as readily as an omitted key.
 */
export interface SnmpCredentialCarrier {
  snmpVersion?: string | null | undefined;
  snmpCommunityString?: string | null | undefined;
  snmpV3Username?: string | null | undefined;
  /*
   * Only devices have this: the deprecated v3 object from before the
   * snmpV3* columns, read where the columns hold no username.
   */
  snmpV3Auth?: JSONObject | null | undefined;
}

export type HasUsableCredentialsFunction = (
  carrier: SnmpCredentialCarrier,
) => boolean;

// Whether a value is text with something in it besides whitespace.
export function isNonEmptyCredential(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/*
 * The username of a device's deprecated snmpV3Auth object, or undefined when
 * it holds none: no object, not an object, or no username in it.
 */
export function getLegacySnmpV3Username(
  snmpV3Auth: JSONObject | null | undefined,
): string | undefined {
  if (!snmpV3Auth || typeof snmpV3Auth !== "object") {
    return undefined;
  }

  const username: unknown = (snmpV3Auth as JSONObject)["username"];

  return isNonEmptyCredential(username) ? username : undefined;
}

/*
 * Whether a row's own v3 credentials are in its deprecated snmpV3Auth object
 * rather than its snmpV3* columns: its columns hold no username, and the
 * object does. Then the walk reads the object (buildSnmpV3Auth).
 */
export function readsLegacySnmpV3Auth(carrier: SnmpCredentialCarrier): boolean {
  return (
    !isNonEmptyCredential(carrier.snmpV3Username) &&
    getLegacySnmpV3Username(carrier.snmpV3Auth) !== undefined
  );
}

export const hasUsableCredentials: HasUsableCredentialsFunction = (
  carrier: SnmpCredentialCarrier,
): boolean => {
  if (SnmpVersionUtil.isV3(carrier.snmpVersion)) {
    return (
      isNonEmptyCredential(carrier.snmpV3Username) ||
      readsLegacySnmpV3Auth(carrier)
    );
  }

  return isNonEmptyCredential(carrier.snmpCommunityString);
};

export default hasUsableCredentials;
