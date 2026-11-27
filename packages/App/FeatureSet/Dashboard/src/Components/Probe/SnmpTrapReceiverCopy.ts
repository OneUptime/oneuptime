import { SnmpTrapRefusalReason } from "Common/Types/Probe/SnmpTrapReceiver";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words a probe's SNMP trap receiver is shown in (OneUptime issue
 * #11005): on the probe's page (ProbeSnmpTraps) and on a device's pages when
 * its own SNMPv3 traps are refused (DeviceSnmpTrapRefusals). One sentence
 * per refused source, the way the issue put it - "12 SNMPv3 traps from
 * 10.20.0.5 failed: unknown user san-monitor" - and under it, what to change
 * to make it stop.
 */

export const SNMP_TRAPS_CARD_TITLE: string = translationKey("SNMP Traps");

export const SNMP_TRAPS_CARD_DESCRIPTION: string = translationKey(
  "Devices send SNMP traps and informs to this probe. An SNMPv3 trap is taken when it is signed with the SNMPv3 credentials of a device on this probe, or of a site whose Default Probe it is.",
);

export const SNMP_TRAPS_NOT_REPORTED: string = translationKey(
  "This probe has not reported its trap receiver yet. A probe on the latest release reports it within a minute of starting.",
);

export const SNMP_TRAPS_TURNED_OFF: string = translationKey(
  "The trap receiver is turned off on this probe: whoever runs it set PROBE_SNMP_TRAP_RECEIVER_ENABLED to false.",
);

export const SNMP_TRAPS_FACT_LABELS: {
  listensOn: string;
  engineId: string;
  users: string;
  lastReceived: string;
} = {
  listensOn: translationKey("Listens On"),
  engineId: translationKey("SNMPv3 Engine ID"),
  users: translationKey("SNMPv3 Users"),
  lastReceived: translationKey("Last Trap"),
};

export const SNMP_TRAPS_LISTENS_ON: string =
  translationKey("UDP port {{port}}");

export const SNMP_TRAPS_ENGINE_ID_HINT: string = translationKey(
  "A device that sends SNMPv3 informs authenticates them with this engine ID. Most find it by themselves; on Cisco IOS, enter it with snmp-server engineID remote, followed by the probe's address and this ID.",
);

export const SNMP_TRAPS_USER_COUNT: PluralTemplate = {
  one: "{{count}} user, from the devices and sites that use this probe",
  other: "{{count}} users, from the devices and sites that use this probe",
};

export const SNMP_TRAPS_NO_USERS: string = translationKey(
  "None yet: SNMPv3 traps are taken once a device on this probe, or a site whose Default Probe it is, has SNMPv3 credentials.",
);

export const SNMP_TRAPS_NONE_RECEIVED: string = translationKey("None yet");

export const SNMP_TRAPS_REFUSED_TITLE: string = translationKey(
  "Refused SNMPv3 Traps",
);

export const SNMP_TRAPS_REFUSED_DESCRIPTION: string = translationKey(
  "In the last day. A refused trap is never forwarded, and nothing it carried is kept.",
);

export const SNMP_TRAPS_NONE_REFUSED: string = translationKey(
  "No SNMPv3 trap was refused in the last day.",
);

// Why the receiver cannot listen, by what the system said.
export const SNMP_TRAPS_LISTEN_ERRORS: Record<string, string> = {
  EACCES: translationKey(
    "The probe cannot listen on UDP port {{port}}: a port below 1024 needs privileges it does not have. Traps sent to it are lost until it runs with them, or listens on a port above 1024.",
  ),
  EADDRINUSE: translationKey(
    "The probe cannot listen on UDP port {{port}}: another program on its host already does. Traps sent to it are lost until that program stops, or the probe listens on another port.",
  ),
};

export const SNMP_TRAPS_LISTEN_ERROR_OTHER: string = translationKey(
  "The probe cannot listen on UDP port {{port}} ({{code}}). Traps sent to it are lost until this is fixed.",
);

// One refused source, reason and user: a headline that ends in the reason.
export const SNMP_TRAP_REFUSAL_HEADLINE: PluralTemplate = {
  one: "{{count}} SNMPv3 trap from {{address}} failed: {{reason}}",
  other: "{{count}} SNMPv3 traps from {{address}} failed: {{reason}}",
};

/*
 * The reason, as the end of that headline. Each names the user it was sent
 * as, in quotes - which also say it when a trap came with an empty name.
 */
export const SNMP_TRAP_REFUSAL_REASONS: Record<SnmpTrapRefusalReason, string> =
  {
    [SnmpTrapRefusalReason.UnknownUser]: translationKey(
      "unknown user “{{user}}”",
    ),
    [SnmpTrapRefusalReason.WrongDigest]: translationKey(
      "wrong authentication passphrase or protocol for “{{user}}”",
    ),
    [SnmpTrapRefusalReason.DecryptionError]: translationKey(
      "wrong privacy passphrase or protocol for “{{user}}”",
    ),
    [SnmpTrapRefusalReason.NotInTimeWindow]: translationKey(
      "outside the time window, as “{{user}}”",
    ),
    [SnmpTrapRefusalReason.UnknownEngineId]: translationKey(
      "informs from “{{user}}” sent to another engine ID than this probe's",
    ),
    [SnmpTrapRefusalReason.UnsupportedSecurityLevel]: translationKey(
      "sent with less security than “{{user}}” is set up for",
    ),
  };

// What to change so it stops.
export const SNMP_TRAP_REFUSAL_FIXES: Record<SnmpTrapRefusalReason, string> = {
  [SnmpTrapRefusalReason.UnknownUser]: translationKey(
    "No device on this probe has an SNMPv3 user of that name. Add it to the device's SNMP credentials, its credential profile or its site's default, or correct the name on the device.",
  ),
  [SnmpTrapRefusalReason.WrongDigest]: translationKey(
    "The device signs its traps with another authentication passphrase or protocol than OneUptime has for this user. Make the two the same.",
  ),
  [SnmpTrapRefusalReason.DecryptionError]: translationKey(
    "The device encrypts its traps with another privacy passphrase or protocol than OneUptime has for this user. Make the two the same.",
  ),
  [SnmpTrapRefusalReason.NotInTimeWindow]: translationKey(
    "The device's SNMP engine clock went back: a replayed or delayed copy, or a device that restarted without counting the restart. Its traps are taken again once it counts one.",
  ),
  [SnmpTrapRefusalReason.UnknownEngineId]: translationKey(
    "The device was given another engine ID for this probe. Give it this probe's SNMPv3 engine ID, shown on the probe's page.",
  ),
  [SnmpTrapRefusalReason.UnsupportedSecurityLevel]: translationKey(
    "OneUptime has this user set up to authenticate, or to authenticate and encrypt, and the device sent its traps without. Set the device's trap security level to match.",
  ),
};

export const SNMP_TRAP_REFUSAL_WHEN: string = translationKey(
  "Last refused {{time}}, first {{first}}",
);

/*
 * An inform sent to another engine ID, where the probe's own engine ID is
 * shown with the refusal: on a device's pages, where a global probe has no
 * page to point to (#11173).
 */
export const SNMP_TRAP_REFUSAL_ENGINE_ID_FIX: string = translationKey(
  "The device was given another engine ID for this probe. Give it this probe's SNMPv3 engine ID:",
);

// A device's own refused traps, on its pages.
export const DEVICE_SNMP_TRAP_REFUSALS_TITLE: PluralTemplate = {
  one: "{{count}} SNMPv3 trap from this device was refused",
  other: "{{count}} SNMPv3 traps from this device were refused",
};

export const DEVICE_SNMP_TRAP_REFUSALS_DESCRIPTION: string = translationKey(
  "Its probe could not authenticate them, so they never reached this device's trap history or its monitors.",
);

export const DEVICE_SNMP_TRAP_EDIT_CREDENTIALS: string = translationKey(
  "Edit SNMP Credentials",
);

export const DEVICE_SNMP_TRAP_VIEW_PROBE: string = translationKey("View Probe");

/*
 * A device's Logs page: how its SNMPv3 traps are taken, and its probe's
 * engine ID for informs - the one place a device on a global probe can read
 * it (#11173).
 */
export const DEVICE_SNMPV3_TRAPS_HELP: string = translationKey(
  "SNMPv3 traps and informs are taken when they are signed with the SNMPv3 credentials this device has in OneUptime: its own, its credential profile's or its site's default. When devices send from one address, their traps are told apart by these credentials and by the engine ID each device's SNMPv3 polls read.",
);

export const DEVICE_PROBE_ENGINE_ID_NOT_REPORTED: string = translationKey(
  "A device that sends SNMPv3 informs may also need its probe's SNMPv3 engine ID, shown here once the probe reports it.",
);
