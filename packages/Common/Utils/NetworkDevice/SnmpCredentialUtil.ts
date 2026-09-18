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
 * three fields it reads rather than a NetworkDevice or a
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
 *     report, not this function's to predict.
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
}

export type HasUsableCredentialsFunction = (
  carrier: SnmpCredentialCarrier,
) => boolean;

function isNonEmpty(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export const hasUsableCredentials: HasUsableCredentialsFunction = (
  carrier: SnmpCredentialCarrier,
): boolean => {
  if (SnmpVersionUtil.isV3(carrier.snmpVersion)) {
    return isNonEmpty(carrier.snmpV3Username);
  }

  return isNonEmpty(carrier.snmpCommunityString);
};

export default hasUsableCredentials;
