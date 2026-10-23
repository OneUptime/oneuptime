import OneUptimeDate from "Common/Types/Date";
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
import { formatRelativeTime } from "../Home/HomeRelativeTime";

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

// Every other kind of source, which names nothing.
const SOURCE_TEXT: Readonly<
  Record<Exclude<AssetFactSourceKind, AssetFactSourceKind.Discovered>, string>
> = {
  [AssetFactSourceKind.SnmpPoll]: translationKey("Its SNMP poll"),
  [AssetFactSourceKind.LearnedFromArp]: translationKey("A router's ARP table"),
  [AssetFactSourceKind.Saved]: translationKey("Saved on this device"),
  [AssetFactSourceKind.PolledAddress]: translationKey(
    "The address its probe polls",
  ),
  [AssetFactSourceKind.AssignedRole]: translationKey("Its assigned role"),
  [AssetFactSourceKind.Site]: translationKey("Its site"),
  [AssetFactSourceKind.Classified]: translationKey(
    "Worked out from what it reports",
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

/**
 * The source a card says ONCE, below the details, rather than under every
 * value: the one every detail of the machine comes from unless it says
 * otherwise - a host's collector, a network device's own SNMP poll. Under
 * each of a walked switch's eleven details, "Its SNMP poll · 3 minutes ago"
 * would say the same thing eleven times and bury the one detail that came
 * from somewhere else.
 */
export function isNativeAssetFactSource(
  source: AssetFactSource | undefined,
): boolean {
  return (
    source?.kind === AssetFactSourceKind.Collector ||
    source?.kind === AssetFactSourceKind.SnmpPoll
  );
}

function readerName(
  reader: NetworkDeviceDiscoveryReader | undefined,
): string | undefined {
  const name: string = (reader?.name || "").trim();
  return name ? name : undefined;
}

/**
 * When a source was read, in the reader's language ("2 hours ago", "vor 2
 * Stunden") - or undefined when it is not known or does not parse.
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

  return formatRelativeTime({
    date: date,
    now: now || OneUptimeDate.getCurrentDate(),
    language: translator.language,
  });
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
 * The line a card says once, below the details, for the source of `source`
 * when it is a native one (see isNativeAssetFactSource).
 */
export function getNativeSourceLine(
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

  return undefined;
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
