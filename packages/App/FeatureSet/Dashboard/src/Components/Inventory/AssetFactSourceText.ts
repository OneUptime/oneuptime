import OneUptimeDate from "Common/Types/Date";
import { isRightToLeftLanguage } from "Common/Types/ReadingDirection";
import NetworkControllerProvider, {
  isNetworkControllerProvider,
} from "Common/Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceDiscoveryMethod,
  NetworkDeviceDiscoveryReader,
  NetworkDeviceDiscoverySighting,
  NetworkDeviceOtherMachineSighting,
} from "Common/Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  AssetFactDifference,
  AssetFactSource,
  AssetFactSourceKind,
} from "Common/Utils/Inventory/AssetFactSource";
import {
  Translator,
  composedValue,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { formatRelativeTime, isJustNow } from "../Home/HomeRelativeTime";

/*
 * Where an asset detail came from, and when, in words (OneUptime issue
 * #5185): "Discovery scan Office LAN (SNMP) · 2 hours ago" under a hostname,
 * "ARP table of core-rtr-01 · 3 hours ago" under a MAC address, "Saved on
 * this device" under a value someone typed.
 *
 * React-free, so the card, the device's own page and their tests all say it
 * the same way. Every sentence is a whole template (the extractor files each
 * as one key, translated whole); a scan's, device's or probe's name goes in
 * as it is, never translated, and the time in the reader's own words
 * ("vor 2 Stunden", "2 時間前") through Intl.RelativeTimeFormat, the way the
 * rest of the network pages write it. A reader with no name - a scan deleted
 * before its name was recorded - gets a sentence without one.
 *
 * Every function takes `now`, so the wording can be tested at a fixed time;
 * the screens leave it to the clock.
 */

// What read a discovered value, with the reader named.
const NAMED_DISCOVERED_SOURCE: Readonly<
  Record<NetworkDeviceDiscoveryMethod, string>
> = {
  [NetworkDeviceDiscoveryMethod.Snmp]: translationKey(
    "Discovery scan {{name}} (SNMP)",
  ),
  [NetworkDeviceDiscoveryMethod.ReverseDns]: translationKey(
    "Discovery scan {{name}} (reverse DNS)",
  ),
  [NetworkDeviceDiscoveryMethod.Netbios]: translationKey(
    "Discovery scan {{name}} (NetBIOS)",
  ),
  [NetworkDeviceDiscoveryMethod.ArpTable]: translationKey(
    "ARP table of {{name}}",
  ),
  /*
   * The probe's name in brackets: probes are usually named "... probe", and
   * "DNS lookup by probe Frankfurt probe" says it twice.
   */
  [NetworkDeviceDiscoveryMethod.Dns]: translationKey(
    "DNS lookup by its probe ({{name}})",
  ),
};

// The same, for a reader whose name was never recorded.
const UNNAMED_DISCOVERED_SOURCE: Readonly<
  Record<NetworkDeviceDiscoveryMethod, string>
> = {
  [NetworkDeviceDiscoveryMethod.Snmp]: translationKey(
    "A discovery scan (SNMP)",
  ),
  [NetworkDeviceDiscoveryMethod.ReverseDns]: translationKey(
    "A discovery scan (reverse DNS)",
  ),
  [NetworkDeviceDiscoveryMethod.Netbios]: translationKey(
    "A discovery scan (NetBIOS)",
  ),
  [NetworkDeviceDiscoveryMethod.ArpTable]: translationKey(
    "A router's ARP table",
  ),
  [NetworkDeviceDiscoveryMethod.Dns]: translationKey("DNS lookup by its probe"),
};

/*
 * What a device's network controller says, by controller: the connection
 * that read it named in brackets, as a probe is. Meraki is the only
 * controller OneUptime reads; its product name is the same in every
 * language.
 */
export const NAMED_CONTROLLER_SOURCE: Readonly<
  Record<NetworkControllerProvider, string>
> = {
  [NetworkControllerProvider.Meraki]: translationKey(
    "Meraki dashboard ({{name}})",
  ),
};

export const UNNAMED_CONTROLLER_SOURCE: Readonly<
  Record<NetworkControllerProvider, string>
> = {
  [NetworkControllerProvider.Meraki]: translationKey("The Meraki dashboard"),
};

// A device's details from its controller's device list, said once.
export const CONTROLLER_READ_TEMPLATE: Readonly<
  Record<NetworkControllerProvider, string>
> = {
  [NetworkControllerProvider.Meraki]: translationKey(
    "Read from the Meraki dashboard ({{name}}), {{time}}.",
  ),
};

export const CONTROLLER_READ_UNNAMED_TEMPLATE: Readonly<
  Record<NetworkControllerProvider, string>
> = {
  [NetworkControllerProvider.Meraki]: translationKey(
    "Read from the Meraki dashboard, {{time}}.",
  ),
};

// Every other kind of source, which names nothing.
const SOURCE_TEXT: Readonly<
  Record<
    Exclude<
      AssetFactSourceKind,
      AssetFactSourceKind.Discovered | AssetFactSourceKind.Controller
    >,
    string
  >
> = {
  [AssetFactSourceKind.SnmpPoll]: translationKey("Its SNMP poll"),
  [AssetFactSourceKind.LearnedFromArp]: translationKey("A router's ARP table"),
  [AssetFactSourceKind.Saved]: translationKey("Saved on this device"),
  [AssetFactSourceKind.PolledAddress]: translationKey(
    "The address its probe polls",
  ),
  [AssetFactSourceKind.AssignedRole]: translationKey("Its assigned role"),
  [AssetFactSourceKind.Site]: translationKey("Its site"),
  /*
   * Its name counts: a device nothing has read anything about is still a
   * Switch when it is called "lab-switch" (classifyDeviceRole reads both).
   */
  [AssetFactSourceKind.Classified]: translationKey(
    "Worked out from its name and what it reports",
  ),
  [AssetFactSourceKind.Collector]: translationKey("Its collector"),
  [AssetFactSourceKind.CloudPlacement]: translationKey("Its cloud zone"),
};

// A source and the time it was read.
export const SOURCE_WITH_TIME: string = translationKey("{{source}} · {{time}}");

// A value discovery read that differs from the one saved on the device.
export const DIFFERENT_VALUE_TEMPLATE: string = translationKey(
  "{{source}} says {{value}}",
);

// The discovery scan that last found the device at its address.
export const FOUND_BY_TEMPLATE: string = translationKey(
  "Last found at its address by discovery scan {{name}}, {{time}}.",
);
export const FOUND_BY_UNNAMED_TEMPLATE: string = translationKey(
  "Last found at its address by a discovery scan, {{time}}.",
);

// A scan that found a different machine answering at the device's address.
export const OTHER_MACHINE_TEMPLATE: string = translationKey(
  "Discovery scan {{name}} found another machine at this address {{time}} ({{machine}}), so nothing it read there is used.",
);
export const OTHER_MACHINE_UNNAMED_TEMPLATE: string = translationKey(
  "A discovery scan found another machine at this address {{time}} ({{machine}}), so nothing it read there is used.",
);

// A host's details all come from its collector, said once.
export const COLLECTOR_TEMPLATE: string = translationKey(
  "Reported by its collector, {{time}}.",
);

// A network device's details from its own SNMP poll, said once.
export const SNMP_POLL_TEMPLATE: string = translationKey(
  "Read over SNMP by its probe, {{time}}.",
);

/*
 * The details of a device its own poll has not read, from the SNMP system
 * group a discovery scan read at its address, said once.
 */
export const SCAN_READ_TEMPLATE: string = translationKey(
  "Read over SNMP by discovery scan {{name}}, {{time}}.",
);
export const SCAN_READ_UNNAMED_TEMPLATE: string = translationKey(
  "Read over SNMP by a discovery scan, {{time}}.",
);

/**
 * A machine's OWN source: a host's collector, a network device's own SNMP
 * poll - what its details come from unless they say otherwise.
 */
export function isNativeAssetFactSource(
  source: AssetFactSource | undefined,
): boolean {
  return (
    source?.kind === AssetFactSourceKind.Collector ||
    source?.kind === AssetFactSourceKind.SnmpPoll
  );
}

/*
 * A source a card may say once, below its details: a machine's own, the
 * SNMP system group a discovery scan read - which gives a ping-only switch
 * its name, maker, operating system, version, location and description in
 * one reading - or the device list of its network controller, which gives a
 * Meraki access point its model, serial number, firmware, MAC and more. A
 * reverse-DNS name, a NetBIOS name, an ARP table's MAC and a probe's DNS
 * lookup each give one detail, and say so under it.
 */
function isSharableAssetFactSource(source: AssetFactSource): boolean {
  return (
    isNativeAssetFactSource(source) ||
    (source.kind === AssetFactSourceKind.Discovered &&
      source.method === NetworkDeviceDiscoveryMethod.Snmp) ||
    source.kind === AssetFactSourceKind.Controller
  );
}

// The controller a source names: Meraki for every source written so far.
function providerOf(source: AssetFactSource): NetworkControllerProvider {
  return isNetworkControllerProvider(source.provider)
    ? source.provider
    : NetworkControllerProvider.Meraki;
}

// A time as epoch milliseconds, or undefined when there is none.
function timeOf(readAt: string | undefined): number | undefined {
  if (!readAt) {
    return undefined;
  }

  const time: number = new Date(readAt).getTime();

  return Number.isNaN(time) ? undefined : time;
}

/**
 * True when two sources are the same reading: the same kind of source, read
 * the same way, by the same scan, device or probe, at the same time.
 */
export function isSameAssetFactSource(
  left: AssetFactSource | undefined,
  right: AssetFactSource | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  const leftTime: number | undefined = timeOf(left.readAt);
  const rightTime: number | undefined = timeOf(right.readAt);

  return (
    left.kind === right.kind &&
    (left.method || "") === (right.method || "") &&
    (left.readBy?.type || "") === (right.readBy?.type || "") &&
    (left.readBy?.id || "") === (right.readBy?.id || "") &&
    leftTime === rightTime &&
    (leftTime !== undefined || (left.readAt || "") === (right.readAt || ""))
  );
}

/**
 * The source a card says ONCE, below its details, rather than under every
 * value: the reading most of them came from. A host's collector; a network
 * device's own SNMP poll; and, for a device its poll has not read (or not
 * since), the discovery scan that read its SNMP system group. Under each of
 * a ping-only switch's seven details, "Discovery scan Store subnets (SNMP) ·
 * 2 hours ago" said the same thing seven times and buried the one detail
 * that came from somewhere else - which is the only one that still says so.
 *
 * A machine's own source wins a tie, and is said once even for one detail;
 * a scan - or a network controller's device list, the Meraki dashboard - is
 * said once only when it gave two details or more. Undefined when nothing
 * qualifies: then every detail says where it came from.
 */
export function getSharedAssetFactSource(
  sources: ReadonlyArray<AssetFactSource | undefined>,
): AssetFactSource | undefined {
  const groups: Array<{ source: AssetFactSource; count: number }> = [];

  for (const source of sources) {
    if (!source || !isSharableAssetFactSource(source)) {
      continue;
    }

    const group: { source: AssetFactSource; count: number } | undefined =
      groups.find((candidate: { source: AssetFactSource }): boolean => {
        return isSameAssetFactSource(candidate.source, source);
      });

    if (group) {
      group.count++;
    } else {
      groups.push({ source: source, count: 1 });
    }
  }

  let shared: { source: AssetFactSource; count: number } | undefined =
    undefined;

  for (const group of groups) {
    const isNative: boolean = isNativeAssetFactSource(group.source);

    if (!isNative && group.count < 2) {
      continue;
    }

    if (
      !shared ||
      group.count > shared.count ||
      (group.count === shared.count &&
        isNative &&
        !isNativeAssetFactSource(shared.source))
    ) {
      shared = group;
    }
  }

  return shared?.source;
}

/**
 * True for a value saved on the device that discovery reads no differently.
 * On the device's OWN page it needs no line: its Name, Hostname and
 * Description do not say where they came from either. One that discovery
 * reads differently keeps "Saved on this device", so the amber line under it
 * has something to differ from. (Inventory's card still says it: there, it
 * tells a value someone saved from one discovery read.)
 */
export function isUndisputedSavedValue(
  source: AssetFactSource | undefined,
  hasDifference: boolean,
): boolean {
  return source?.kind === AssetFactSourceKind.Saved && !hasDifference;
}

/**
 * The exact local time of a reading, for a hover over its relative one - or
 * undefined when it is not known or does not parse.
 */
export function getAssetFactExactTime(
  readAt: string | undefined,
): string | undefined {
  const time: number | undefined = timeOf(readAt);

  return time === undefined
    ? undefined
    : OneUptimeDate.getDateAsLocalFormattedString(new Date(time));
}

function readerName(
  reader: NetworkDeviceDiscoveryReader | undefined,
): string | undefined {
  const name: string = (reader?.name || "").trim();
  return name ? name : undefined;
}

/*
 * A reading of the last few seconds - a device Refresh has just read again:
 * "just now", where the relative time alone would say a bare "now".
 */
export const JUST_NOW: string = translationKey("just now");

/*
 * A time in a right-to-left sentence, set apart in a Unicode isolate (FSI
 * ... PDI). A time that follows a name written in Latin letters - "خوانده‌شده
 * از داشبورد Meraki (Acme Retail)، ۴ دقیقه پیش." - otherwise joins the name's
 * left-to-right run: the browser draws its digit and the comma beside the
 * name, before the words they belong with. In an isolate the time reads as
 * one piece where the sentence puts it. A left-to-right language gets the
 * time as it is.
 */
export const FIRST_STRONG_ISOLATE: string = String.fromCharCode(0x2068);
export const POP_DIRECTIONAL_ISOLATE: string = String.fromCharCode(0x2069);

function isolatedForSentence(time: string, translator: Translator): string {
  return isRightToLeftLanguage(translator.language)
    ? `${FIRST_STRONG_ISOLATE}${time}${POP_DIRECTIONAL_ISOLATE}`
    : time;
}

/**
 * When a source was read, in the reader's language ("2 hours ago", "vor 2
 * Stunden", "just now") - or undefined when it is not known or does not
 * parse. Set apart for a right-to-left sentence (isolatedForSentence).
 */
export function getAssetFactSourceTime(
  readAt: string | undefined,
  translator: Translator,
  now?: Date | undefined,
): string | undefined {
  if (!readAt) {
    return undefined;
  }

  const date: Date = new Date(readAt);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  const current: Date = now || OneUptimeDate.getCurrentDate();

  if (isJustNow({ date: date, now: current })) {
    return isolatedForSentence(
      translator.translateText(JUST_NOW) || JUST_NOW,
      translator,
    );
  }

  return isolatedForSentence(
    formatRelativeTime({
      date: date,
      now: current,
      language: translator.language,
    }),
    translator,
  );
}

/**
 * Where a detail came from, without when: "Discovery scan Office LAN
 * (SNMP)", "Saved on this device".
 */
export function getAssetFactSourceText(
  source: AssetFactSource,
  translator: Translator,
): string {
  if (source.kind === AssetFactSourceKind.Discovered) {
    const method: NetworkDeviceDiscoveryMethod =
      source.method || NetworkDeviceDiscoveryMethod.Snmp;
    const name: string | undefined = readerName(source.readBy);

    return name
      ? translator.translateTemplate(NAMED_DISCOVERED_SOURCE[method], {
          name: name,
        })
      : translator.translateText(UNNAMED_DISCOVERED_SOURCE[method]) ||
          UNNAMED_DISCOVERED_SOURCE[method];
  }

  if (source.kind === AssetFactSourceKind.Controller) {
    const provider: NetworkControllerProvider = providerOf(source);
    const name: string | undefined = readerName(source.readBy);

    return name
      ? translator.translateTemplate(NAMED_CONTROLLER_SOURCE[provider], {
          name: name,
        })
      : translator.translateText(UNNAMED_CONTROLLER_SOURCE[provider]) ||
          UNNAMED_CONTROLLER_SOURCE[provider];
  }

  const text: string = SOURCE_TEXT[source.kind];

  return translator.translateText(text) || text;
}

/**
 * Where a detail came from and when, as the line under its value:
 * "Discovery scan Office LAN (SNMP) · 2 hours ago", or the source alone when
 * there is no time to give.
 */
export function getAssetFactSourceLine(
  source: AssetFactSource,
  translator: Translator,
  now?: Date | undefined,
): string {
  const time: string | undefined = getAssetFactSourceTime(
    source.readAt,
    translator,
    now,
  );

  if (!time) {
    return getAssetFactSourceText(source, translator);
  }

  return translator.translateTemplate(SOURCE_WITH_TIME, {
    source: composedValue((sentence: Translator): string => {
      return getAssetFactSourceText(source, sentence);
    }),
    time: time,
  });
}

/**
 * What discovery read for a detail whose saved value differs: "ARP table of
 * core-rtr-01 says AA-BB-CC-DD-EE-02 · 3 hours ago".
 */
export function getAssetFactDifferenceLine(
  difference: AssetFactDifference,
  translator: Translator,
  now?: Date | undefined,
): string {
  const says: (sentence: Translator) => string = (
    sentence: Translator,
  ): string => {
    return sentence.translateTemplate(DIFFERENT_VALUE_TEMPLATE, {
      source: composedValue((inner: Translator): string => {
        return getAssetFactSourceText(difference.source, inner);
      }),
      value: difference.value,
    });
  };

  const time: string | undefined = getAssetFactSourceTime(
    difference.source.readAt,
    translator,
    now,
  );

  if (!time) {
    return says(translator);
  }

  return translator.translateTemplate(SOURCE_WITH_TIME, {
    source: composedValue(says),
    time: time,
  });
}

/**
 * "Last found at its address by discovery scan Office LAN, 2 hours ago." -
 * the device's discovery source, and when it last confirmed the device is
 * there.
 */
export function getFoundByLine(
  sighting: NetworkDeviceDiscoverySighting,
  translator: Translator,
  now?: Date | undefined,
): string {
  const time: string =
    getAssetFactSourceTime(sighting.readAt, translator, now) || "";
  const name: string | undefined = readerName(sighting.readBy);

  return name
    ? translator.translateTemplate(FOUND_BY_TEMPLATE, {
        name: name,
        time: time,
      })
    : translator.translateTemplate(FOUND_BY_UNNAMED_TEMPLATE, { time: time });
}

/*
 * What the other machine said it was, the most telling first: its own name
 * (SNMP, then NetBIOS), its DNS name, its model's object ID.
 */
export function getOtherMachineIdentity(
  note: NetworkDeviceOtherMachineSighting,
): string {
  return (
    note.sysName ||
    note.netbiosName ||
    note.dnsName ||
    note.sysObjectId ||
    ""
  ).trim();
}

/**
 * "Discovery scan Office LAN found another machine at this address 2 hours
 * ago (LAPTOP-12), so nothing it read there is used."
 */
export function getOtherMachineLine(
  note: NetworkDeviceOtherMachineSighting,
  translator: Translator,
  now?: Date | undefined,
): string {
  const time: string =
    getAssetFactSourceTime(note.readAt, translator, now) || "";
  const name: string | undefined = readerName(note.readBy);
  const machine: string = getOtherMachineIdentity(note);

  return name
    ? translator.translateTemplate(OTHER_MACHINE_TEMPLATE, {
        name: name,
        time: time,
        machine: machine,
      })
    : translator.translateTemplate(OTHER_MACHINE_UNNAMED_TEMPLATE, {
        time: time,
        machine: machine,
      });
}

/**
 * "Read over SNMP by its probe, 3 minutes ago." - said once for a network
 * device, for the details its own SNMP poll read.
 */
export function getSnmpPollLine(
  readAt: string | undefined,
  translator: Translator,
  now?: Date | undefined,
): string | undefined {
  const time: string | undefined = getAssetFactSourceTime(
    readAt,
    translator,
    now,
  );

  if (!time) {
    return undefined;
  }

  return translator.translateTemplate(SNMP_POLL_TEMPLATE, { time: time });
}

/**
 * "Read over SNMP by discovery scan Store subnets, 2 hours ago." - said once
 * for a device whose details came from what a scan read at its address.
 */
export function getScanReadLine(
  readBy: NetworkDeviceDiscoveryReader | undefined,
  readAt: string | undefined,
  translator: Translator,
  now?: Date | undefined,
): string | undefined {
  const time: string | undefined = getAssetFactSourceTime(
    readAt,
    translator,
    now,
  );

  if (!time) {
    return undefined;
  }

  const name: string | undefined = readerName(readBy);

  return name
    ? translator.translateTemplate(SCAN_READ_TEMPLATE, {
        name: name,
        time: time,
      })
    : translator.translateTemplate(SCAN_READ_UNNAMED_TEMPLATE, { time: time });
}

/**
 * The line a card says once, below the details, for the source they share
 * (getSharedAssetFactSource) - or undefined when there is none, or no time
 * to give.
 */
export function getSharedSourceLine(
  source: AssetFactSource | undefined,
  translator: Translator,
  now?: Date | undefined,
): string | undefined {
  if (source?.kind === AssetFactSourceKind.Collector) {
    return getCollectorLine(source.readAt, translator, now);
  }

  if (source?.kind === AssetFactSourceKind.SnmpPoll) {
    return getSnmpPollLine(source.readAt, translator, now);
  }

  if (
    source?.kind === AssetFactSourceKind.Discovered &&
    source.method === NetworkDeviceDiscoveryMethod.Snmp
  ) {
    return getScanReadLine(source.readBy, source.readAt, translator, now);
  }

  if (source?.kind === AssetFactSourceKind.Controller) {
    return getControllerReadLine(source, translator, now);
  }

  return undefined;
}

/**
 * "Read from the Meraki dashboard (Acme Retail), 20 minutes ago." - said
 * once for a device whose details came from its controller's device list.
 */
export function getControllerReadLine(
  source: AssetFactSource,
  translator: Translator,
  now?: Date | undefined,
): string | undefined {
  const time: string | undefined = getAssetFactSourceTime(
    source.readAt,
    translator,
    now,
  );

  if (!time) {
    return undefined;
  }

  const provider: NetworkControllerProvider = providerOf(source);
  const name: string | undefined = readerName(source.readBy);

  return name
    ? translator.translateTemplate(CONTROLLER_READ_TEMPLATE[provider], {
        name: name,
        time: time,
      })
    : translator.translateTemplate(CONTROLLER_READ_UNNAMED_TEMPLATE[provider], {
        time: time,
      });
}

/**
 * True when the line said once already says what "Last found at its address
 * by discovery scan ..." would: the details came from that same scan's
 * reading of the address, and the scan has not found the device there since.
 * A scan that read the device found it.
 */
export function isSightingSaidBySharedSource(
  sighting: NetworkDeviceDiscoverySighting | undefined,
  shared: AssetFactSource | undefined,
): boolean {
  if (
    !sighting ||
    shared?.kind !== AssetFactSourceKind.Discovered ||
    !shared.readBy ||
    shared.readBy.type !== sighting.readBy.type ||
    shared.readBy.id !== sighting.readBy.id
  ) {
    return false;
  }

  const sharedAt: number | undefined = timeOf(shared.readAt);
  const sightedAt: number | undefined = timeOf(sighting.readAt);

  return (
    sharedAt !== undefined && sightedAt !== undefined && sightedAt <= sharedAt
  );
}

/**
 * "Reported by its collector, 2 minutes ago." - said once for a host, whose
 * details all come from its collector.
 */
export function getCollectorLine(
  readAt: string | undefined,
  translator: Translator,
  now?: Date | undefined,
): string | undefined {
  const time: string | undefined = getAssetFactSourceTime(
    readAt,
    translator,
    now,
  );

  if (!time) {
    return undefined;
  }

  return translator.translateTemplate(COLLECTOR_TEMPLATE, { time: time });
}
