import Dictionary from "Common/Types/Dictionary";
import SnmpSecurityLevel, {
  SnmpSecurityLevelUtil,
} from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How an event reported by an SNMP trap says what arrived (#11005), from the
 * attributes the trap history keeps: a trap or an inform, of which SNMP
 * version, and for SNMPv3 the user it came as and whether it was
 * authenticated and encrypted - as v1 and v2c say their version.
 */

export const SNMP_TRAP_REPORTED_AS: {
  trap: string;
  inform: string;
  v3Trap: string;
  v3Inform: string;
} = {
  trap: translationKey("SNMP trap"),
  inform: translationKey("SNMP inform"),
  v3Trap: translationKey("SNMPv3 trap"),
  v3Inform: translationKey("SNMPv3 inform"),
};

export const SNMP_TRAP_SECURITY_WORDS: Record<SnmpSecurityLevel, string> = {
  [SnmpSecurityLevel.AuthPriv]: translationKey("Authenticated and encrypted"),
  [SnmpSecurityLevel.AuthNoPriv]: translationKey(
    "Authenticated, not encrypted",
  ),
  [SnmpSecurityLevel.NoAuthNoPriv]: translationKey("Not authenticated"),
};

// A switch as ClickHouse hands it back: true, "true" or "1".
function isOn(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

// What the event was reported as, untranslated: the sentence's key.
export function getSnmpTrapReportedAs(attributes: Dictionary<string>): string {
  const isInform: boolean = isOn(attributes["snmpTrap.isInform"]);

  if ((attributes["snmpTrap.version"] || "").trim() === "3") {
    return isInform
      ? SNMP_TRAP_REPORTED_AS.v3Inform
      : SNMP_TRAP_REPORTED_AS.v3Trap;
  }

  return isInform ? SNMP_TRAP_REPORTED_AS.inform : SNMP_TRAP_REPORTED_AS.trap;
}

// The SNMPv3 user it came as, when it says.
export function getSnmpTrapUser(
  attributes: Dictionary<string>,
): string | undefined {
  return (attributes["snmpTrap.securityName"] || "").trim() || undefined;
}

// Whether it was authenticated and encrypted, in words; SNMPv3 only.
export function getSnmpTrapSecurity(
  attributes: Dictionary<string>,
): string | undefined {
  const level: SnmpSecurityLevel | undefined = SnmpSecurityLevelUtil.parse(
    attributes["snmpTrap.securityLevel"],
  );

  return level ? SNMP_TRAP_SECURITY_WORDS[level] : undefined;
}
