import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostNetbiosStatus,
  DiscoveredHostReverseDnsStatus,
} from "../../../Types/NetworkDevice/DiscoveredHostNamingStatus";
import { getDiscoveredHostFullName } from "../../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import DefaultExplainUnnamedDiscoveredHost, {
  ASK_THE_DEVICE_NETBIOS_TIP,
  ASK_THE_DEVICE_SNMP_TIP,
  ASK_THE_DEVICE_TIP,
  DiscoveredHostNamingExplanation,
  DiscoveredHostNamingScan,
  FAILED_SCAN_EXPLANATION,
  IN_PROGRESS_EXPLANATION,
  NETBIOS_NOT_RECORDED_SENTENCE,
  NETBIOS_OFF_SENTENCE,
  NOT_YET_NAMED_HOST_LABEL,
  NO_RECORD_TIP,
  REVERSE_DNS_NOT_RECORDED_SENTENCE,
  SNMP_NOT_CHECKED_SENTENCE,
  SNMP_NO_ANSWER_SENTENCE,
  SNMP_NO_SYSNAME_SENTENCE,
  TRANSIENT_FAILURE_TIP,
  UNNAMED_HOST_LABEL,
  explainUnnamedDiscoveredHost,
  isDiscoveredHostNamed,
} from "../../../Utils/NetworkDiscovery/DiscoveredHostNamingDiagnosis";
import { DiscoveryScanStatus } from "../../../Utils/NetworkDiscovery/DiscoveryScanStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * The sentence beside a discovered host that is listed by its address
 * (OneUptime issue #3916).
 *
 * The report: an ICMP-only scan of twelve kitchen displays named four of them
 * by reverse DNS and listed the other eight by address. Nothing said why. The
 * status message was silent, the probe logged at debug level, and the Review
 * dialog showed a bare IP. So "the device has no PTR record", "the probe's
 * DNS server timed out" and "NetBIOS was never asked" all looked the same,
 * and an operator who KNEW the devices had names could only conclude the
 * product was broken.
 *
 * These tests are about the WORDS: that each code the probe can stamp turns
 * into the one sentence written for it, that a row with no code says no more
 * than it can support, and that the text can never carry anything the
 * scanned network chose. The sentences a code picks are private to the
 * module, so they are written out here as literals. A copy change then shows
 * up as a test diff, which is where it should be reviewed.
 *
 * Every case is a plain literal, the way the dialog hands a row over after
 * normalizeDiscoveredHosts. Casts through `unknown` mark the rows the type
 * forbids on purpose: the column is jsonb written verbatim from the probe's
 * payload, so the runtime value does not honour the type.
 */

/*
 * One of the reporter's addresses. The only digits anywhere in the copy are
 * the "137" of UDP 137, which is what lets the leak tests below say "no
 * digits".
 */
const ADDRESS: string = "10.16.42.51";

// A row with nothing on it but its address: no SNMP answer, no names, no codes.
function bareHost(
  overrides: Partial<DiscoveredNetworkDevice> = {},
): DiscoveredNetworkDevice {
  return { ipAddress: ADDRESS, ...overrides };
}

// A ping-only host, as the probe reports one on any scan.
function pingOnlyHost(
  overrides: Partial<DiscoveredNetworkDevice> = {},
): DiscoveredNetworkDevice {
  return { ipAddress: ADDRESS, snmpReachable: false, ...overrides };
}

/*
 * The reporter's scan: ping only. The issue does not say whether NetBIOS
 * names were on; they are here, as the wizard's default.
 */
const REPORTERS_SCAN: DiscoveredHostNamingScan = {
  status: DiscoveryScanStatus.Completed,
  isSnmpEnabled: false,
  isNetbiosLookupEnabled: true,
};

const ICMP_ONLY_SCAN: DiscoveredHostNamingScan = {
  status: DiscoveryScanStatus.Completed,
  isSnmpEnabled: false,
  isNetbiosLookupEnabled: false,
};

const SNMP_SCAN: DiscoveredHostNamingScan = {
  status: DiscoveryScanStatus.Completed,
  isSnmpEnabled: true,
  isNetbiosLookupEnabled: false,
};

const SNMP_AND_NETBIOS_SCAN: DiscoveredHostNamingScan = {
  status: DiscoveryScanStatus.Completed,
  isSnmpEnabled: true,
  isNetbiosLookupEnabled: true,
};

/*
 * What each reverse-DNS code says, and which tip follows it. Written out,
 * not imported: the table in the module is private, and these strings are
 * the product.
 */
const REVERSE_DNS_COPY: Array<
  [DiscoveredHostReverseDnsStatus, string, string | undefined]
> = [
  [
    DiscoveredHostReverseDnsStatus.NoRecord,
    "Reverse DNS: the probe's DNS server has no PTR record for this address.",
    NO_RECORD_TIP,
  ],
  [
    DiscoveredHostReverseDnsStatus.UnusableName,
    "Reverse DNS: a PTR record came back, but it is not a valid hostname, so it was not used.",
    undefined,
  ],
  [
    DiscoveredHostReverseDnsStatus.Timeout,
    "Reverse DNS: the probe's DNS server did not answer in time.",
    TRANSIENT_FAILURE_TIP,
  ],
  [
    DiscoveredHostReverseDnsStatus.ServerFailure,
    "Reverse DNS: the probe's DNS server answered with a server failure (SERVFAIL).",
    TRANSIENT_FAILURE_TIP,
  ],
  [
    DiscoveredHostReverseDnsStatus.Refused,
    "Reverse DNS: the probe's DNS server refused the query.",
    TRANSIENT_FAILURE_TIP,
  ],
  [
    DiscoveredHostReverseDnsStatus.Unreachable,
    "Reverse DNS: the probe could not reach its DNS server.",
    TRANSIENT_FAILURE_TIP,
  ],
  [
    DiscoveredHostReverseDnsStatus.Failed,
    "Reverse DNS: the lookup failed on the probe.",
    TRANSIENT_FAILURE_TIP,
  ],
  [
    DiscoveredHostReverseDnsStatus.SkippedTimeBudget,
    "Reverse DNS: not looked up. The scan ran out of time for name lookups before reaching this address.",
    undefined,
  ],
  [
    DiscoveredHostReverseDnsStatus.SkippedNoResolver,
    "Reverse DNS: not looked up. No lookup from this probe was getting an answer, so it stopped asking.",
    TRANSIENT_FAILURE_TIP,
  ],
];

const NETBIOS_COPY: Array<[DiscoveredHostNetbiosStatus, string]> = [
  [
    DiscoveredHostNetbiosStatus.NoReply,
    "NetBIOS: no reply on UDP 137, which is usual for devices that are not Windows, or when a firewall blocks it.",
  ],
  [
    DiscoveredHostNetbiosStatus.NoUsableName,
    "NetBIOS: the device replied, but reported no usable name.",
  ],
  [
    DiscoveredHostNetbiosStatus.SendFailed,
    "NetBIOS: the query could not be sent from the probe.",
  ],
  [
    DiscoveredHostNetbiosStatus.Skipped,
    "NetBIOS: not asked. The lookup stopped before reaching this address.",
  ],
  [
    DiscoveredHostNetbiosStatus.SkippedHostCap,
    "NetBIOS: not asked. The scan reached the probe's NetBIOS host limit.",
  ],
  [
    DiscoveredHostNetbiosStatus.SkippedIneligibleAddress,
    "NetBIOS: not asked. Only private addresses are asked.",
  ],
  [
    DiscoveredHostNetbiosStatus.SkippedGlobalProbe,
    "NetBIOS: not asked. This scan ran on a global probe, and global probes never send NetBIOS queries.",
  ],
];

const GLOBAL_PROBE_NETBIOS_SENTENCE: string =
  "NetBIOS: not asked. This scan ran on a global probe, and global probes never send NetBIOS queries.";

function reverseDnsSentence(code: DiscoveredHostReverseDnsStatus): string {
  return REVERSE_DNS_COPY.find(
    (entry: [DiscoveredHostReverseDnsStatus, string, string | undefined]) => {
      return entry[0] === code;
    },
  )![1];
}

function netbiosSentence(code: DiscoveredHostNetbiosStatus): string {
  return NETBIOS_COPY.find((entry: [DiscoveredHostNetbiosStatus, string]) => {
    return entry[0] === code;
  })![1];
}

/*
 * The explanation's text, failing the test if there is none. Most tests ask
 * about the words, and a bare `!` would turn "no explanation" into a
 * TypeError that names nothing.
 */
function textOf(data: {
  host: DiscoveredNetworkDevice;
  scan?: DiscoveredHostNamingScan | undefined;
  isGlobalProbe?: boolean | undefined;
}): string {
  const explanation: DiscoveredHostNamingExplanation | undefined =
    explainUnnamedDiscoveredHost(data);

  expect(explanation).toBeDefined();

  return explanation!.text;
}

/*
 * The sentences a text may be built from, in the order they must appear:
 * SNMP, reverse DNS, NetBIOS (the order the sources win in), then the
 * reverse-DNS tip, then the ask-the-device tip. At most one from each group.
 */
const SENTENCE_GROUPS: Array<Array<string>> = [
  [
    SNMP_NOT_CHECKED_SENTENCE,
    SNMP_NO_ANSWER_SENTENCE,
    SNMP_NO_SYSNAME_SENTENCE,
  ],
  [
    ...REVERSE_DNS_COPY.map(
      (
        entry: [DiscoveredHostReverseDnsStatus, string, string | undefined],
      ): string => {
        return entry[1];
      },
    ),
    REVERSE_DNS_NOT_RECORDED_SENTENCE,
  ],
  [
    ...NETBIOS_COPY.map(
      (entry: [DiscoveredHostNetbiosStatus, string]): string => {
        return entry[1];
      },
    ),
    NETBIOS_OFF_SENTENCE,
    NETBIOS_NOT_RECORDED_SENTENCE,
  ],
  [NO_RECORD_TIP, TRANSIENT_FAILURE_TIP],
  [ASK_THE_DEVICE_TIP, ASK_THE_DEVICE_SNMP_TIP, ASK_THE_DEVICE_NETBIOS_TIP],
];

const SNMP_GROUP: number = 0;
const REVERSE_DNS_GROUP: number = 1;
const NETBIOS_GROUP: number = 2;
const REVERSE_DNS_TIP_GROUP: number = 3;
const ASK_THE_DEVICE_GROUP: number = 4;

interface KnownSentence {
  group: number;
  sentence: string;
}

/*
 * Reads a text back as a list of known sentences, or undefined when any part
 * of it is not one of them. The longest match wins at each position, so a
 * sentence that happened to be a prefix of another could not hide it.
 */
function splitIntoKnownSentences(
  text: string,
): Array<KnownSentence> | undefined {
  const found: Array<KnownSentence> = [];
  let position: number = 0;

  while (position < text.length) {
    let bestGroup: number = -1;
    let bestSentence: string = "";

    for (let group: number = 0; group < SENTENCE_GROUPS.length; group++) {
      for (const sentence of SENTENCE_GROUPS[group]!) {
        const end: number = position + sentence.length;
        const isWholeSentence: boolean =
          text.startsWith(sentence, position) &&
          (end === text.length || text.charAt(end) === " ");

        if (isWholeSentence && sentence.length > bestSentence.length) {
          bestGroup = group;
          bestSentence = sentence;
        }
      }
    }

    if (bestGroup < 0) {
      return undefined;
    }

    found.push({ group: bestGroup, sentence: bestSentence });
    position += bestSentence.length + 1;
  }

  return found;
}

/*
 * Every input the function can be handed that changes its answer, crossed
 * with every other. Nulls are included where jsonb or a partial select can
 * produce them, and each boolean-ish input also gets one value of the wrong
 * type, because the scan row is read from a column the type does not bind.
 */
interface NamingCase {
  host: DiscoveredNetworkDevice;
  scan: DiscoveredHostNamingScan | undefined;
  isGlobalProbe: boolean | undefined;
}

const REVERSE_DNS_CODE_OPTIONS: Array<
  DiscoveredHostReverseDnsStatus | undefined
> = [undefined, ...Object.values(DiscoveredHostReverseDnsStatus)];
const NETBIOS_CODE_OPTIONS: Array<DiscoveredHostNetbiosStatus | undefined> = [
  undefined,
  ...Object.values(DiscoveredHostNetbiosStatus),
];
const STATUS_OPTIONS: Array<string | null | undefined> = [
  undefined,
  null,
  DiscoveryScanStatus.Pending,
  DiscoveryScanStatus.InProgress,
  DiscoveryScanStatus.Completed,
  DiscoveryScanStatus.Failed,
];
const FLAG_OPTIONS: Array<boolean | null | undefined> = [
  undefined,
  null,
  true,
  false,
  "true" as unknown as boolean,
];
const SNMP_REACHABLE_OPTIONS: Array<boolean | undefined> = [
  undefined,
  true,
  false,
];
const GLOBAL_PROBE_OPTIONS: Array<boolean | undefined> = [
  undefined,
  true,
  false,
];

function allNamingCases(): Array<NamingCase> {
  const cases: Array<NamingCase> = [];

  for (const dnsHostnameStatus of REVERSE_DNS_CODE_OPTIONS) {
    for (const netbiosNameStatus of NETBIOS_CODE_OPTIONS) {
      for (const snmpReachable of SNMP_REACHABLE_OPTIONS) {
        for (const isGlobalProbe of GLOBAL_PROBE_OPTIONS) {
          const host: DiscoveredNetworkDevice = {
            ipAddress: ADDRESS,
            snmpReachable: snmpReachable,
            dnsHostnameStatus: dnsHostnameStatus,
            netbiosNameStatus: netbiosNameStatus,
          };

          // No scan at all: a caller that has only the row.
          cases.push({
            host: host,
            scan: undefined,
            isGlobalProbe: isGlobalProbe,
          });

          for (const status of STATUS_OPTIONS) {
            for (const isSnmpEnabled of FLAG_OPTIONS) {
              for (const isNetbiosLookupEnabled of FLAG_OPTIONS) {
                cases.push({
                  host: host,
                  scan: {
                    status: status,
                    isSnmpEnabled: isSnmpEnabled,
                    isNetbiosLookupEnabled: isNetbiosLookupEnabled,
                  },
                  isGlobalProbe: isGlobalProbe,
                });
              }
            }
          }
        }
      }
    }
  }

  return cases;
}

const ALL_NAMING_CASES: Array<NamingCase> = allNamingCases();

/*
 * A tooltip is a few lines, not a page. The dialog's (i) is Tippy with a
 * 350px maximum width, where 420 characters is already eight or nine lines.
 * The longest text today is about 400 characters, so a new sentence that
 * pushes past this is a sign the copy needs trimming, not the limit raising.
 */
const MAX_EXPLANATION_LENGTH: number = 420;

describe("the fixed copy", () => {
  /*
   * Pinned once, here, as literals. Every other test composes its expected
   * text from the exported constants, so a copy change is one edit in this
   * block and nowhere else.
   */
  test.each([
    ["UNNAMED_HOST_LABEL", UNNAMED_HOST_LABEL, "No name found"],
    ["NOT_YET_NAMED_HOST_LABEL", NOT_YET_NAMED_HOST_LABEL, "Not named yet"],
    [
      "IN_PROGRESS_EXPLANATION",
      IN_PROGRESS_EXPLANATION,
      "Names are looked up after the sweep finishes, so hosts found so far are listed by address. Open Review Results again when the scan completes.",
    ],
    [
      "FAILED_SCAN_EXPLANATION",
      FAILED_SCAN_EXPLANATION,
      "This scan stopped before it looked up names, so its hosts are listed by address. Run it again to name them.",
    ],
    [
      "REVERSE_DNS_NOT_RECORDED_SENTENCE",
      REVERSE_DNS_NOT_RECORDED_SENTENCE,
      "Reverse DNS: no name was recorded for this address.",
    ],
    [
      "NETBIOS_OFF_SENTENCE",
      NETBIOS_OFF_SENTENCE,
      "NetBIOS: off for this scan.",
    ],
    [
      "NETBIOS_NOT_RECORDED_SENTENCE",
      NETBIOS_NOT_RECORDED_SENTENCE,
      "NetBIOS: no name was recorded.",
    ],
    [
      "SNMP_NOT_CHECKED_SENTENCE",
      SNMP_NOT_CHECKED_SENTENCE,
      "SNMP: not checked by this scan.",
    ],
    [
      "SNMP_NO_ANSWER_SENTENCE",
      SNMP_NO_ANSWER_SENTENCE,
      "SNMP: no answer with this scan's credentials.",
    ],
    [
      "SNMP_NO_SYSNAME_SENTENCE",
      SNMP_NO_SYSNAME_SENTENCE,
      "SNMP: the device answered, but reported no name (sysName).",
    ],
    [
      "NO_RECORD_TIP",
      NO_RECORD_TIP,
      "The probe uses its own DNS server, which may not be the one you checked with. Run nslookup on this address from the probe's host to compare.",
    ],
    [
      "TRANSIENT_FAILURE_TIP",
      TRANSIENT_FAILURE_TIP,
      "Rescan to try again. If it keeps happening, check the DNS servers the probe's host uses.",
    ],
    [
      "ASK_THE_DEVICE_TIP",
      ASK_THE_DEVICE_TIP,
      "Checking SNMP, or NetBIOS lookup for Windows hosts, asks the device for its own name.",
    ],
    [
      "ASK_THE_DEVICE_SNMP_TIP",
      ASK_THE_DEVICE_SNMP_TIP,
      "Checking SNMP asks the device for its own name.",
    ],
    [
      "ASK_THE_DEVICE_NETBIOS_TIP",
      ASK_THE_DEVICE_NETBIOS_TIP,
      "NetBIOS lookup asks Windows hosts for their own name.",
    ],
  ])(
    "%s reads exactly as written",
    (_name: string, actual: string, expected: string) => {
      expect(actual).toBe(expected);
    },
  );

  test("the reverse-DNS table below covers every code, once", () => {
    /*
     * A code added to the enum without a row here would be tested by
     * nothing, and the module's Record type is what makes sure it has copy.
     */
    expect(
      REVERSE_DNS_COPY.map(
        (
          entry: [DiscoveredHostReverseDnsStatus, string, string | undefined],
        ): string => {
          return entry[0];
        },
      ).sort(),
    ).toEqual(Object.values(DiscoveredHostReverseDnsStatus).sort());
  });

  test("the NetBIOS table below covers every code, once", () => {
    expect(
      NETBIOS_COPY.map(
        (entry: [DiscoveredHostNetbiosStatus, string]): string => {
          return entry[0];
        },
      ).sort(),
    ).toEqual(Object.values(DiscoveredHostNetbiosStatus).sort());
  });

  test("no two codes share a sentence", () => {
    /*
     * The whole point of the codes: "no PTR record" and "timed out" used to
     * look the same. Two codes with one sentence would bring that back.
     */
    const all: Array<string> = [
      ...SENTENCE_GROUPS[REVERSE_DNS_GROUP]!,
      ...SENTENCE_GROUPS[NETBIOS_GROUP]!,
    ];

    expect(new Set<string>(all).size).toBe(all.length);
  });

  test("every sentence names the source it is about first", () => {
    for (const sentence of SENTENCE_GROUPS[SNMP_GROUP]!) {
      expect(sentence.startsWith("SNMP: ")).toBe(true);
    }

    for (const sentence of SENTENCE_GROUPS[REVERSE_DNS_GROUP]!) {
      expect(sentence.startsWith("Reverse DNS: ")).toBe(true);
    }

    for (const sentence of SENTENCE_GROUPS[NETBIOS_GROUP]!) {
      expect(sentence.startsWith("NetBIOS: ")).toBe(true);
    }
  });

  test("the default export is the named function", () => {
    expect(DefaultExplainUnnamedDiscoveredHost).toBe(
      explainUnnamedDiscoveredHost,
    );
  });
});

describe("isDiscoveredHostNamed", () => {
  test.each([
    ["a sysName", { sysName: "kds-01" }],
    ["a sysName with padding", { sysName: "  kds-01  " }],
    ["a PTR name", { dnsHostname: "wb0024kds02.corp.example.com" }],
    ["a PTR name with its root dot", { dnsHostname: "kds-01.example.com." }],
    ["a single-label PTR name", { dnsHostname: "WB0024KDS02" }],
    ["a NetBIOS name", { netbiosName: "WB0024KDS02" }],
    ["a space-padded NetBIOS name", { netbiosName: "WB0024KDS02    " }],
  ])(
    "a host with %s is named",
    (_label: string, fields: Partial<DiscoveredNetworkDevice>) => {
      expect(isDiscoveredHostNamed(bareHost(fields))).toBe(true);
    },
  );

  test.each([
    ["nothing at all", {}],
    ["a whitespace-only sysName", { sysName: "   " }],
    ["a tab-and-newline sysName", { sysName: "\t\n" }],
    ["an empty sysName", { sysName: "" }],
    ["a numeric sysName", { sysName: 42 as unknown as string }],
    ["an object sysName", { sysName: {} as unknown as string }],
    ["an in-addr.arpa echo", { dnsHostname: "51.42.16.10.in-addr.arpa" }],
    ["a PTR name with a space", { dnsHostname: "kds 01.example.com" }],
    ["a PTR name that restates the address", { dnsHostname: ADDRESS }],
    [
      "a PTR name that is markup",
      { dnsHostname: "<img src=x onerror=1>.example" },
    ],
    ["a numeric PTR name", { dnsHostname: 51 as unknown as string }],
    ["a NetBIOS name with a space", { netbiosName: "WB0024 KDS02" }],
    ["the browser-election pseudo-name", { netbiosName: "__MSBROWSE__" }],
    ["an all-digit NetBIOS name", { netbiosName: "123456" }],
    ["a dotted NetBIOS name", { netbiosName: "kds.corp" }],
  ])(
    "a host with %s is not named",
    (_label: string, fields: Partial<DiscoveredNetworkDevice>) => {
      expect(isDiscoveredHostNamed(bareHost(fields))).toBe(false);
    },
  );

  test("agrees with the name line on every combination of name fields", () => {
    /*
     * The hint must sit on exactly the rows whose name line IS the address.
     * If the two disagreed, a named row would get "No name found" beside its
     * name, or a bare address would get no explanation, which is the bug
     * this whole feature is for.
     *
     * The one row they are allowed to disagree on is a sysName that is the
     * address itself. The name line cannot tell that from the address, but
     * the device DID answer with a name, so "no name found" would be false.
     * No sysName below is the address. A PTR name that is the address IS
     * below, and both sides drop it.
     */
    const sysNames: Array<unknown> = [undefined, "", "   ", "kds-01", 42];
    const dnsHostnames: Array<unknown> = [
      undefined,
      "wb0024kds02.corp.example.com",
      "51.42.16.10.in-addr.arpa",
      "kds 01",
      ADDRESS,
      {},
    ];
    const netbiosNames: Array<unknown> = [
      undefined,
      "WB0024KDS02",
      "WB0024 KDS02",
      "__MSBROWSE__",
      7,
    ];

    let checked: number = 0;

    for (const sysName of sysNames) {
      for (const dnsHostname of dnsHostnames) {
        for (const netbiosName of netbiosNames) {
          const host: DiscoveredNetworkDevice = {
            ipAddress: ADDRESS,
            sysName: sysName as string,
            dnsHostname: dnsHostname as string,
            netbiosName: netbiosName as string,
          };

          expect(isDiscoveredHostNamed(host)).toBe(
            getDiscoveredHostFullName(host) !== ADDRESS,
          );
          checked++;
        }
      }
    }

    expect(checked).toBe(150);
  });
});

describe("explainUnnamedDiscoveredHost — rows it has nothing to say about", () => {
  test.each([
    ["a sysName", { sysName: "kds-01" }],
    ["a PTR name", { dnsHostname: "wb0024kds02.corp.example.com" }],
    ["a NetBIOS name", { netbiosName: "WB0024KDS02" }],
  ])(
    "a host named by %s gets no explanation",
    (_label: string, fields: Partial<DiscoveredNetworkDevice>) => {
      expect(
        explainUnnamedDiscoveredHost({
          host: pingOnlyHost(fields),
          scan: REPORTERS_SCAN,
        }),
      ).toBeUndefined();
    },
  );

  test("a named host gets no explanation whatever codes it carries", () => {
    /*
     * A code is only stamped on a host that source left unnamed, but a host
     * one source failed on can still be named by the next. The row's name
     * line is then a real name, and "No name found" beside it would be a lie.
     */
    for (const [dnsHostnameStatus] of REVERSE_DNS_COPY) {
      for (const [netbiosNameStatus] of NETBIOS_COPY) {
        expect(
          explainUnnamedDiscoveredHost({
            host: pingOnlyHost({
              netbiosName: "WB0024KDS02",
              dnsHostnameStatus: dnsHostnameStatus,
              netbiosNameStatus: netbiosNameStatus,
            }),
            scan: REPORTERS_SCAN,
          }),
        ).toBeUndefined();
      }
    }
  });

  test.each([
    DiscoveryScanStatus.Pending,
    DiscoveryScanStatus.InProgress,
    DiscoveryScanStatus.Completed,
    DiscoveryScanStatus.Failed,
  ])(
    "a named host gets no explanation on a %s scan either",
    (status: string) => {
      expect(
        explainUnnamedDiscoveredHost({
          host: pingOnlyHost({ dnsHostname: "kds-01.example.com" }),
          scan: { ...REPORTERS_SCAN, status: status },
        }),
      ).toBeUndefined();
    },
  );

  test.each([
    ["the empty string", ""],
    ["spaces", "   "],
    ["a tab and a newline", "\t\n"],
    ["null", null],
    ["undefined", undefined],
  ])(
    "a row whose address is %s gets no explanation",
    (_label: string, ipAddress: unknown) => {
      /*
       * A row with no address cannot be imported, and its checkbox already
       * says so. null is the case that matters: String(null) is "null", which
       * would read as an address.
       */
      expect(
        explainUnnamedDiscoveredHost({
          host: { ipAddress: ipAddress } as unknown as DiscoveredNetworkDevice,
          scan: REPORTERS_SCAN,
        }),
      ).toBeUndefined();
    },
  );

  test("a row with no address key at all gets no explanation", () => {
    expect(
      explainUnnamedDiscoveredHost({
        host: {} as unknown as DiscoveredNetworkDevice,
        scan: REPORTERS_SCAN,
      }),
    ).toBeUndefined();
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", ADDRESS],
    ["a number", 10],
    ["a boolean", true],
    ["an empty array", []],
    ["an array holding a host", [{ ipAddress: ADDRESS }]],
  ])(
    "%s instead of a host gets no explanation, and does not throw",
    (_label: string, host: unknown) => {
      expect(
        explainUnnamedDiscoveredHost({
          host: host as DiscoveredNetworkDevice,
          scan: REPORTERS_SCAN,
        }),
      ).toBeUndefined();
    },
  );

  test("a numeric address, as an un-normalised row holds it, is still explained", () => {
    /*
     * normalizeDiscoveredHosts stringifies it, and the row is importable, so
     * it is a real row with a bare address for a name.
     */
    expect(
      explainUnnamedDiscoveredHost({
        host: { ipAddress: 10 } as unknown as DiscoveredNetworkDevice,
      }),
    ).toStrictEqual({
      label: UNNAMED_HOST_LABEL,
      text: REVERSE_DNS_NOT_RECORDED_SENTENCE,
    });
  });

  test("junk in the name fields of an un-normalised row does not throw", () => {
    const junk: Array<unknown> = [42, {}, [], true, null, ["kds-01"]];

    for (const value of junk) {
      expect(() => {
        return explainUnnamedDiscoveredHost({
          host: {
            ipAddress: ADDRESS,
            sysName: value,
            dnsHostname: value,
            netbiosName: value,
            snmpReachable: value,
          } as unknown as DiscoveredNetworkDevice,
          scan: REPORTERS_SCAN,
        });
      }).not.toThrow();
    }
  });
});

describe("explainUnnamedDiscoveredHost — each reverse-DNS code", () => {
  /*
   * With no scan and no SNMP flag on the row, the text is the reverse-DNS
   * sentence and its tip and nothing else, so each case can be pinned whole.
   */
  test.each(REVERSE_DNS_COPY)(
    "%s reads as its own sentence, followed by its tip",
    (
      code: DiscoveredHostReverseDnsStatus,
      sentence: string,
      tip: string | undefined,
    ) => {
      expect(
        explainUnnamedDiscoveredHost({
          host: bareHost({ dnsHostnameStatus: code }),
        }),
      ).toStrictEqual({
        label: UNNAMED_HOST_LABEL,
        text: tip ? `${sentence} ${tip}` : sentence,
      });
    },
  );

  test.each(REVERSE_DNS_COPY)(
    "%s on the reporter's scan sits between the SNMP and NetBIOS lines",
    (
      code: DiscoveredHostReverseDnsStatus,
      sentence: string,
      tip: string | undefined,
    ) => {
      expect(
        textOf({
          host: pingOnlyHost({
            dnsHostnameStatus: code,
            netbiosNameStatus: DiscoveredHostNetbiosStatus.NoReply,
          }),
          scan: REPORTERS_SCAN,
        }),
      ).toBe(
        [
          SNMP_NOT_CHECKED_SENTENCE,
          sentence,
          netbiosSentence(DiscoveredHostNetbiosStatus.NoReply),
          ...(tip ? [tip] : []),
          ASK_THE_DEVICE_SNMP_TIP,
        ].join(" "),
      );
    },
  );

  test("only a code the DNS server answered with claims there is no PTR record", () => {
    /*
     * The heart of the issue. "No PTR record" is a fact about the address,
     * and it is only true when the server ANSWERED that way. Every failure
     * of the lookup itself used to be filed as exactly that. So no other
     * code, and no row without a code, may say it.
     */
    for (const [code] of REVERSE_DNS_COPY) {
      const text: string = textOf({
        host: bareHost({ dnsHostnameStatus: code }),
      });

      expect(text.includes("no PTR record")).toBe(
        code === DiscoveredHostReverseDnsStatus.NoRecord,
      );
    }

    expect(textOf({ host: bareHost() })).not.toContain("PTR");
  });

  test("a timeout and a missing record never read the same", () => {
    expect(
      textOf({
        host: bareHost({
          dnsHostnameStatus: DiscoveredHostReverseDnsStatus.Timeout,
        }),
      }),
    ).not.toBe(
      textOf({
        host: bareHost({
          dnsHostnameStatus: DiscoveredHostReverseDnsStatus.NoRecord,
        }),
      }),
    );
  });

  test("no code claims the probe retried", () => {
    /*
     * A retry has to fit in the naming pass's time budget, so a host that
     * timed out near the deadline may have been asked only once. The copy
     * must be true for that host too.
     */
    for (const [code] of REVERSE_DNS_COPY) {
      expect(
        textOf({ host: bareHost({ dnsHostnameStatus: code }) }).toLowerCase(),
      ).not.toContain("retry");
    }
  });
});

describe("explainUnnamedDiscoveredHost — each NetBIOS code", () => {
  test.each(NETBIOS_COPY)(
    "%s reads as its own sentence, after the reverse-DNS line",
    (code: DiscoveredHostNetbiosStatus, sentence: string) => {
      expect(
        explainUnnamedDiscoveredHost({
          host: bareHost({ netbiosNameStatus: code }),
        }),
      ).toStrictEqual({
        label: UNNAMED_HOST_LABEL,
        text: `${REVERSE_DNS_NOT_RECORDED_SENTENCE} ${sentence}`,
      });
    },
  );

  test.each(NETBIOS_COPY)(
    "%s on an SNMP scan with NetBIOS on reads in full",
    (code: DiscoveredHostNetbiosStatus, sentence: string) => {
      expect(
        textOf({
          host: pingOnlyHost({
            dnsHostnameStatus: DiscoveredHostReverseDnsStatus.NoRecord,
            netbiosNameStatus: code,
          }),
          scan: SNMP_AND_NETBIOS_SCAN,
        }),
      ).toBe(
        [
          SNMP_NO_ANSWER_SENTENCE,
          reverseDnsSentence(DiscoveredHostReverseDnsStatus.NoRecord),
          sentence,
          NO_RECORD_TIP,
        ].join(" "),
      );
    },
  );

  test.each(NETBIOS_COPY)(
    "%s is what the row says even on a global probe",
    (code: DiscoveredHostNetbiosStatus, sentence: string) => {
      /*
       * The probe's code is a fact about what it did; the global-probe
       * inference is only a fallback for rows that carry none.
       */
      expect(
        textOf({
          host: pingOnlyHost({ netbiosNameStatus: code }),
          scan: SNMP_AND_NETBIOS_SCAN,
          isGlobalProbe: true,
        }),
      ).toBe(
        [
          SNMP_NO_ANSWER_SENTENCE,
          REVERSE_DNS_NOT_RECORDED_SENTENCE,
          sentence,
        ].join(" "),
      );
    },
  );

  test.each(NETBIOS_COPY)(
    "%s is what the row says after the scan's NetBIOS setting was turned off",
    (code: DiscoveredHostNetbiosStatus, sentence: string) => {
      /*
       * The results stay on the scan when the setting changes. The row says
       * what the probe did when it ran, and suggesting the setting that did
       * run would be nonsense, so there is no tip.
       */
      expect(
        textOf({
          host: pingOnlyHost({ netbiosNameStatus: code }),
          scan: SNMP_SCAN,
        }),
      ).toBe(
        [
          SNMP_NO_ANSWER_SENTENCE,
          REVERSE_DNS_NOT_RECORDED_SENTENCE,
          sentence,
        ].join(" "),
      );
    },
  );
});

describe("explainUnnamedDiscoveredHost — rows with no codes (older probes)", () => {
  /*
   * Every row stored before the codes, and every row from a probe that has
   * not been upgraded. The only facts are the scan's settings and the row's
   * SNMP flag, so the reverse-DNS line says no name was recorded and claims
   * no reason. In particular it must not say "no PTR record", which is the
   * misdiagnosis the issue was about.
   */
  test("the reporter's scan on a private probe", () => {
    expect(
      explainUnnamedDiscoveredHost({
        host: pingOnlyHost(),
        scan: REPORTERS_SCAN,
        isGlobalProbe: false,
      }),
    ).toStrictEqual({
      label: UNNAMED_HOST_LABEL,
      text: [
        SNMP_NOT_CHECKED_SENTENCE,
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
        NETBIOS_NOT_RECORDED_SENTENCE,
        ASK_THE_DEVICE_SNMP_TIP,
      ].join(" "),
    });
  });

  test("the reporter's scan on a global probe says NetBIOS was never asked", () => {
    /*
     * The global-probe refusal predates the codes, so for a row from any
     * probe version on a global probe, "not asked" is the truth. The bundled
     * self-hosted probes register as global.
     */
    expect(
      textOf({
        host: pingOnlyHost(),
        scan: REPORTERS_SCAN,
        isGlobalProbe: true,
      }),
    ).toBe(
      [
        SNMP_NOT_CHECKED_SENTENCE,
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
        GLOBAL_PROBE_NETBIOS_SENTENCE,
        ASK_THE_DEVICE_SNMP_TIP,
      ].join(" "),
    );
  });

  test("an unknown probe reads as not global", () => {
    expect(textOf({ host: pingOnlyHost(), scan: REPORTERS_SCAN })).toBe(
      textOf({
        host: pingOnlyHost(),
        scan: REPORTERS_SCAN,
        isGlobalProbe: false,
      }),
    );
  });

  test.each([
    ["the string true", "true"],
    ["one", 1],
    ["null", null],
  ])(
    "isGlobalProbe of %s reads as not global",
    (_label: string, value: unknown) => {
      expect(
        textOf({
          host: pingOnlyHost(),
          scan: REPORTERS_SCAN,
          isGlobalProbe: value as boolean,
        }),
      ).toContain(NETBIOS_NOT_RECORDED_SENTENCE);
    },
  );

  test("a ping-only scan with NetBIOS off suggests both ways of asking the device", () => {
    expect(textOf({ host: pingOnlyHost(), scan: ICMP_ONLY_SCAN })).toBe(
      [
        SNMP_NOT_CHECKED_SENTENCE,
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
        NETBIOS_OFF_SENTENCE,
        ASK_THE_DEVICE_TIP,
      ].join(" "),
    );
  });

  test("an SNMP scan the host did not answer, with NetBIOS off", () => {
    expect(textOf({ host: pingOnlyHost(), scan: SNMP_SCAN })).toBe(
      [
        SNMP_NO_ANSWER_SENTENCE,
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
        NETBIOS_OFF_SENTENCE,
        ASK_THE_DEVICE_NETBIOS_TIP,
      ].join(" "),
    );
  });

  test("an SNMP scan the host answered without a sysName, with NetBIOS on", () => {
    expect(
      textOf({
        host: bareHost({ snmpReachable: true, sysName: "   " }),
        scan: SNMP_AND_NETBIOS_SCAN,
      }),
    ).toBe(
      [
        SNMP_NO_SYSNAME_SENTENCE,
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
        NETBIOS_NOT_RECORDED_SENTENCE,
      ].join(" "),
    );
  });

  test("a row from before snmpReachable existed reads as an SNMP answer with no name", () => {
    /*
     * Back then every host listed had answered SNMP, since ping-only hosts
     * were not reported at all.
     */
    expect(textOf({ host: bareHost(), scan: SNMP_SCAN })).toBe(
      [
        SNMP_NO_SYSNAME_SENTENCE,
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
        NETBIOS_OFF_SENTENCE,
        ASK_THE_DEVICE_NETBIOS_TIP,
      ].join(" "),
    );
  });

  test("with no scan and no SNMP flag, the row says only what it can", () => {
    expect(explainUnnamedDiscoveredHost({ host: bareHost() })).toStrictEqual({
      label: UNNAMED_HOST_LABEL,
      text: REVERSE_DNS_NOT_RECORDED_SENTENCE,
    });
  });

  test("a legacy row gets no reverse-DNS tip", () => {
    /*
     * Both tips are advice about a specific failure, and a row with no code
     * has no failure to advise on.
     */
    for (const scan of [
      REPORTERS_SCAN,
      ICMP_ONLY_SCAN,
      SNMP_SCAN,
      SNMP_AND_NETBIOS_SCAN,
      undefined,
    ]) {
      const text: string = textOf({ host: pingOnlyHost(), scan: scan });

      expect(text).not.toContain(NO_RECORD_TIP);
      expect(text).not.toContain(TRANSIENT_FAILURE_TIP);
    }
  });
});

describe("explainUnnamedDiscoveredHost — the scan's state", () => {
  test.each([
    ["the reporter's scan", REPORTERS_SCAN],
    ["a ping-only scan", ICMP_ONLY_SCAN],
    ["an SNMP scan", SNMP_SCAN],
    ["an SNMP scan with NetBIOS", SNMP_AND_NETBIOS_SCAN],
  ])(
    "%s still sweeping says names come later",
    (_label: string, scan: DiscoveredHostNamingScan) => {
      /*
       * Names are looked up only after the sweep finishes, so every host a
       * running scan has reported is unnamed by construction. Anything about
       * the individual sources would be explaining a question not yet asked.
       */
      for (const isGlobalProbe of [undefined, true, false]) {
        expect(
          explainUnnamedDiscoveredHost({
            host: pingOnlyHost(),
            scan: { ...scan, status: DiscoveryScanStatus.InProgress },
            isGlobalProbe: isGlobalProbe,
          }),
        ).toStrictEqual({
          label: NOT_YET_NAMED_HOST_LABEL,
          text: IN_PROGRESS_EXPLANATION,
        });
      }
    },
  );

  test("a scan still sweeping explains a row that carries a reverse-DNS code by its code", () => {
    /*
     * A recurring scan keeps its previous run's results until the new run
     * reports. Those rows went through the naming passes, and their codes
     * say what happened.
     */
    expect(
      explainUnnamedDiscoveredHost({
        host: pingOnlyHost({
          dnsHostnameStatus: DiscoveredHostReverseDnsStatus.Timeout,
        }),
        scan: { ...REPORTERS_SCAN, status: DiscoveryScanStatus.InProgress },
      }),
    ).toStrictEqual({
      label: UNNAMED_HOST_LABEL,
      text: [
        SNMP_NOT_CHECKED_SENTENCE,
        reverseDnsSentence(DiscoveredHostReverseDnsStatus.Timeout),
        NETBIOS_NOT_RECORDED_SENTENCE,
        TRANSIENT_FAILURE_TIP,
        ASK_THE_DEVICE_SNMP_TIP,
      ].join(" "),
    });
  });

  test("a scan still sweeping explains a row that carries only a NetBIOS code by its code", () => {
    expect(
      explainUnnamedDiscoveredHost({
        host: pingOnlyHost({
          netbiosNameStatus: DiscoveredHostNetbiosStatus.NoReply,
        }),
        scan: { ...REPORTERS_SCAN, status: DiscoveryScanStatus.InProgress },
      }),
    ).toStrictEqual({
      label: UNNAMED_HOST_LABEL,
      text: [
        SNMP_NOT_CHECKED_SENTENCE,
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
        netbiosSentence(DiscoveredHostNetbiosStatus.NoReply),
        ASK_THE_DEVICE_SNMP_TIP,
      ].join(" "),
    });
  });

  test("a failed scan with no codes says it stopped before naming", () => {
    for (const scan of [
      REPORTERS_SCAN,
      ICMP_ONLY_SCAN,
      SNMP_SCAN,
      SNMP_AND_NETBIOS_SCAN,
    ]) {
      expect(
        explainUnnamedDiscoveredHost({
          host: pingOnlyHost(),
          scan: { ...scan, status: DiscoveryScanStatus.Failed },
          isGlobalProbe: true,
        }),
      ).toStrictEqual({
        label: UNNAMED_HOST_LABEL,
        text: FAILED_SCAN_EXPLANATION,
      });
    }
  });

  test("a failed scan whose rows carry codes is explained by the codes", () => {
    expect(
      textOf({
        host: pingOnlyHost({
          dnsHostnameStatus: DiscoveredHostReverseDnsStatus.NoRecord,
          netbiosNameStatus: DiscoveredHostNetbiosStatus.NoReply,
        }),
        scan: { ...REPORTERS_SCAN, status: DiscoveryScanStatus.Failed },
      }),
    ).toBe(
      [
        SNMP_NOT_CHECKED_SENTENCE,
        reverseDnsSentence(DiscoveredHostReverseDnsStatus.NoRecord),
        netbiosSentence(DiscoveredHostNetbiosStatus.NoReply),
        NO_RECORD_TIP,
        ASK_THE_DEVICE_SNMP_TIP,
      ].join(" "),
    );
  });

  test("a pending recurring scan's previous results read like a completed scan's", () => {
    /*
     * A recurring scan goes back to Pending between runs and keeps the last
     * run's hosts. Those are finished results, not a sweep in progress.
     */
    for (const host of [
      pingOnlyHost(),
      pingOnlyHost({
        dnsHostnameStatus: DiscoveredHostReverseDnsStatus.Refused,
      }),
    ]) {
      expect(
        explainUnnamedDiscoveredHost({
          host: host,
          scan: { ...REPORTERS_SCAN, status: DiscoveryScanStatus.Pending },
        }),
      ).toStrictEqual(
        explainUnnamedDiscoveredHost({ host: host, scan: REPORTERS_SCAN }),
      );
    }
  });

  test.each([
    ["no status", undefined],
    ["a null status", null],
    ["a lower-case in progress", "in progress"],
    ["an upper-case IN PROGRESS", "IN PROGRESS"],
    ["a padded In Progress", " In Progress "],
    ["a lower-case failed", "failed"],
    ["a status this build does not know", "Cancelled"],
  ])(
    "%s reads like a completed scan",
    (_label: string, status: string | null | undefined) => {
      /*
       * The column holds exact strings. Anything else is not a state this
       * build can speak for, and the per-source lines are true whatever the
       * state is.
       */
      expect(
        explainUnnamedDiscoveredHost({
          host: pingOnlyHost(),
          scan: { ...REPORTERS_SCAN, status: status },
        }),
      ).toStrictEqual(
        explainUnnamedDiscoveredHost({
          host: pingOnlyHost(),
          scan: REPORTERS_SCAN,
        }),
      );
    },
  );
});

describe("explainUnnamedDiscoveredHost — the SNMP line", () => {
  test.each([
    ["no SNMP flag", undefined],
    ["an SNMP answer", true],
    ["no SNMP answer", false],
  ])(
    "a ping-only scan says SNMP was not checked, for a row with %s",
    (_label: string, snmpReachable: boolean | undefined) => {
      expect(
        textOf({
          host: bareHost({ snmpReachable: snmpReachable }),
          scan: ICMP_ONLY_SCAN,
        }).startsWith(`${SNMP_NOT_CHECKED_SENTENCE} `),
      ).toBe(true);
    },
  );

  test.each([
    ["true", true],
    ["absent", undefined],
    ["null", null],
  ])(
    "an SNMP scan (isSnmpEnabled %s) says which way SNMP went",
    (_label: string, isSnmpEnabled: boolean | null | undefined) => {
      /*
       * Absent reads as SNMP on, as ScanModeUtil says: only an explicit false
       * turns it off.
       */
      const scan: DiscoveredHostNamingScan = {
        ...SNMP_SCAN,
        isSnmpEnabled: isSnmpEnabled,
      };

      expect(
        textOf({ host: bareHost({ snmpReachable: false }), scan: scan }),
      ).toContain(SNMP_NO_ANSWER_SENTENCE);
      expect(
        textOf({ host: bareHost({ snmpReachable: true }), scan: scan }),
      ).toContain(SNMP_NO_SYSNAME_SENTENCE);
      expect(textOf({ host: bareHost(), scan: scan })).toContain(
        SNMP_NO_SYSNAME_SENTENCE,
      );
    },
  );

  test("with no scan, only the row's own SNMP flag speaks", () => {
    expect(
      textOf({ host: bareHost({ snmpReachable: false }) }).startsWith(
        `${SNMP_NO_ANSWER_SENTENCE} `,
      ),
    ).toBe(true);
    expect(
      textOf({ host: bareHost({ snmpReachable: true }) }).startsWith(
        `${SNMP_NO_SYSNAME_SENTENCE} `,
      ),
    ).toBe(true);
    expect(
      textOf({ host: bareHost() }).startsWith(
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
      ),
    ).toBe(true);
  });

  test("a whitespace-only sysName is explained as no name", () => {
    /*
     * The name line trims it away and shows the address, so the row needs
     * the hint, and the SNMP line is right that no usable name came back.
     */
    expect(
      textOf({
        host: bareHost({ snmpReachable: true, sysName: " \t " }),
        scan: SNMP_SCAN,
      }).startsWith(`${SNMP_NO_SYSNAME_SENTENCE} `),
    ).toBe(true);
  });
});

describe("explainUnnamedDiscoveredHost — the NetBIOS line", () => {
  test.each([
    ["false", false],
    ["absent", undefined],
    ["null", null],
    ["the string true", "true"],
    ["one", 1],
  ])(
    "a scan whose NetBIOS setting is %s says NetBIOS was off",
    (_label: string, value: unknown) => {
      /*
       * On only when exactly true, which is how the probe reads the column.
       * Saying anything else would describe a lookup the probe never ran.
       */
      expect(
        textOf({
          host: pingOnlyHost(),
          scan: { ...SNMP_SCAN, isNetbiosLookupEnabled: value as boolean },
        }),
      ).toContain(` ${NETBIOS_OFF_SENTENCE}`);
    },
  );

  test("NetBIOS on with no code says no name was recorded", () => {
    expect(textOf({ host: pingOnlyHost(), scan: SNMP_AND_NETBIOS_SCAN })).toBe(
      [
        SNMP_NO_ANSWER_SENTENCE,
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
        NETBIOS_NOT_RECORDED_SENTENCE,
      ].join(" "),
    );
  });

  test("NetBIOS on with no code, on a global probe, says it was never asked", () => {
    expect(
      textOf({
        host: pingOnlyHost(),
        scan: SNMP_AND_NETBIOS_SCAN,
        isGlobalProbe: true,
      }),
    ).toBe(
      [
        SNMP_NO_ANSWER_SENTENCE,
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
        GLOBAL_PROBE_NETBIOS_SENTENCE,
      ].join(" "),
    );
  });

  test("with no scan and no code, there is no NetBIOS line at all", () => {
    /*
     * Without the scan there is no telling whether NetBIOS was ever on, so
     * any sentence would be a guess, and "global probe" is not a reason to
     * say it was asked for.
     */
    for (const isGlobalProbe of [undefined, true, false]) {
      expect(
        textOf({ host: pingOnlyHost(), isGlobalProbe: isGlobalProbe }),
      ).not.toContain("NetBIOS");
    }
  });

  test("with no scan, a NetBIOS code still speaks", () => {
    expect(
      textOf({
        host: bareHost({
          netbiosNameStatus: DiscoveredHostNetbiosStatus.SkippedHostCap,
        }),
      }),
    ).toBe(
      [
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
        netbiosSentence(DiscoveredHostNetbiosStatus.SkippedHostCap),
      ].join(" "),
    );
  });
});

describe("explainUnnamedDiscoveredHost — the tips", () => {
  test("a missing PTR record points at the probe's own DNS server", () => {
    /*
     * The advice that matters most for the report behind this: the probe
     * resolves through its own DNS server, which need not be the one the
     * operator checked with.
     */
    expect(
      textOf({
        host: bareHost({
          dnsHostnameStatus: DiscoveredHostReverseDnsStatus.NoRecord,
        }),
      }),
    ).toBe(
      `${reverseDnsSentence(DiscoveredHostReverseDnsStatus.NoRecord)} ${NO_RECORD_TIP}`,
    );
  });

  test.each([
    DiscoveredHostReverseDnsStatus.Timeout,
    DiscoveredHostReverseDnsStatus.ServerFailure,
    DiscoveredHostReverseDnsStatus.Refused,
    DiscoveredHostReverseDnsStatus.Unreachable,
    DiscoveredHostReverseDnsStatus.Failed,
    DiscoveredHostReverseDnsStatus.SkippedNoResolver,
  ])(
    "%s is told to rescan and check the probe's DNS servers",
    (code: DiscoveredHostReverseDnsStatus) => {
      const text: string = textOf({
        host: bareHost({ dnsHostnameStatus: code }),
      });

      expect(text.endsWith(` ${TRANSIENT_FAILURE_TIP}`)).toBe(true);
      expect(text).not.toContain(NO_RECORD_TIP);
    },
  );

  test("a probe that stopped asking after every lookup failed points at its DNS servers", () => {
    /*
     * Its address was never looked up, but only because every lookup before
     * it failed. The DNS servers the probe uses are the thing to check, and
     * this row is where the operator is looking.
     */
    expect(
      textOf({
        host: bareHost({
          dnsHostnameStatus: DiscoveredHostReverseDnsStatus.SkippedNoResolver,
        }),
      }),
    ).toBe(
      `${reverseDnsSentence(DiscoveredHostReverseDnsStatus.SkippedNoResolver)} ${TRANSIENT_FAILURE_TIP}`,
    );
  });

  test.each([
    DiscoveredHostReverseDnsStatus.UnusableName,
    DiscoveredHostReverseDnsStatus.SkippedTimeBudget,
  ])("%s gets no reverse-DNS tip", (code: DiscoveredHostReverseDnsStatus) => {
    const text: string = textOf({
      host: bareHost({ dnsHostnameStatus: code }),
    });

    expect(text).toBe(reverseDnsSentence(code));
  });

  /*
   * [isSnmpEnabled, isNetbiosLookupEnabled, isGlobalProbe, the tip]. Only a
   * source that was off, and that would run if turned on, is suggested.
   */
  test.each([
    [false, false, false, ASK_THE_DEVICE_TIP],
    [false, false, undefined, ASK_THE_DEVICE_TIP],
    [false, false, true, ASK_THE_DEVICE_SNMP_TIP],
    [false, true, false, ASK_THE_DEVICE_SNMP_TIP],
    [false, true, true, ASK_THE_DEVICE_SNMP_TIP],
    [true, false, false, ASK_THE_DEVICE_NETBIOS_TIP],
    [true, false, undefined, ASK_THE_DEVICE_NETBIOS_TIP],
    [true, false, true, undefined],
    [true, true, false, undefined],
    [true, true, true, undefined],
  ])(
    "SNMP %p, NetBIOS %p, global probe %p: the ask-the-device tip is %p",
    (
      isSnmpEnabled: boolean,
      isNetbiosLookupEnabled: boolean,
      isGlobalProbe: boolean | undefined,
      tip: string | undefined,
    ) => {
      const text: string = textOf({
        host: pingOnlyHost(),
        scan: {
          status: DiscoveryScanStatus.Completed,
          isSnmpEnabled: isSnmpEnabled,
          isNetbiosLookupEnabled: isNetbiosLookupEnabled,
        },
        isGlobalProbe: isGlobalProbe,
      });
      const sentences: Array<KnownSentence> = splitIntoKnownSentences(text)!;
      const askTheDevice: Array<string> = sentences
        .filter((entry: KnownSentence) => {
          return entry.group === ASK_THE_DEVICE_GROUP;
        })
        .map((entry: KnownSentence): string => {
          return entry.sentence;
        });

      expect(askTheDevice).toEqual(tip ? [tip] : []);
    },
  );

  test("a global probe with NetBIOS off is never told to turn NetBIOS on", () => {
    /*
     * It would not help: a global probe never sends NetBIOS queries. The
     * only effect would be a "not asked" line on the next scan.
     */
    for (const [code] of REVERSE_DNS_COPY) {
      for (const scan of [ICMP_ONLY_SCAN, SNMP_SCAN]) {
        const text: string = textOf({
          host: pingOnlyHost({ dnsHostnameStatus: code }),
          scan: scan,
          isGlobalProbe: true,
        });

        expect(text).not.toContain("NetBIOS lookup");
        expect(text).toContain(NETBIOS_OFF_SENTENCE);
      }
    }
  });

  test("with no scan, no source is suggested", () => {
    for (const snmpReachable of [undefined, true, false]) {
      const text: string = textOf({
        host: bareHost({ snmpReachable: snmpReachable }),
      });

      expect(text).not.toContain(ASK_THE_DEVICE_SNMP_TIP);
      expect(text).not.toContain("NetBIOS lookup");
      expect(text).not.toContain(ASK_THE_DEVICE_TIP);
    }
  });

  test("the reverse-DNS tip comes before the ask-the-device tip, and both can appear", () => {
    expect(
      textOf({
        host: pingOnlyHost({
          dnsHostnameStatus: DiscoveredHostReverseDnsStatus.NoRecord,
        }),
        scan: ICMP_ONLY_SCAN,
      }),
    ).toBe(
      [
        SNMP_NOT_CHECKED_SENTENCE,
        reverseDnsSentence(DiscoveredHostReverseDnsStatus.NoRecord),
        NETBIOS_OFF_SENTENCE,
        NO_RECORD_TIP,
        ASK_THE_DEVICE_TIP,
      ].join(" "),
    );
  });
});

describe("explainUnnamedDiscoveredHost — codes it does not recognise", () => {
  /*
   * A newer probe's code, a code in the wrong field, or junk. Each reads as
   * "no code", so the row gets the copy an older probe's row gets, rather
   * than a guess at what an unknown code meant.
   */
  const JUNK_CODES: Array<[string, unknown]> = [
    ["an upper-case code", "NO-RECORD"],
    ["a padded code", " timeout "],
    ["an underscored code", "no_record"],
    ["a code from a newer probe", "dnssec-bogus"],
    ["a prototype key", "constructor"],
    ["another prototype key", "__proto__"],
    ["toString", "toString"],
    ["markup", "<img src=x onerror=1>"],
    ["a number", 7],
    ["an object", { code: "timeout" }],
    ["an array", ["timeout"]],
    ["true", true],
    ["null", null],
  ];

  test.each(JUNK_CODES)(
    "%s in the reverse-DNS field reads as no code",
    (_label: string, value: unknown) => {
      for (const scan of [REPORTERS_SCAN, SNMP_SCAN, undefined]) {
        expect(
          explainUnnamedDiscoveredHost({
            host: pingOnlyHost({
              dnsHostnameStatus: value as DiscoveredHostReverseDnsStatus,
            }),
            scan: scan,
          }),
        ).toStrictEqual(
          explainUnnamedDiscoveredHost({ host: pingOnlyHost(), scan: scan }),
        );
      }
    },
  );

  test.each(JUNK_CODES)(
    "%s in the NetBIOS field reads as no code",
    (_label: string, value: unknown) => {
      for (const scan of [REPORTERS_SCAN, SNMP_SCAN, undefined]) {
        expect(
          explainUnnamedDiscoveredHost({
            host: pingOnlyHost({
              netbiosNameStatus: value as DiscoveredHostNetbiosStatus,
            }),
            scan: scan,
          }),
        ).toStrictEqual(
          explainUnnamedDiscoveredHost({ host: pingOnlyHost(), scan: scan }),
        );
      }
    },
  );

  test.each(Object.values(DiscoveredHostNetbiosStatus))(
    "the NetBIOS code %p in the reverse-DNS field reads as no code",
    (code: string) => {
      expect(
        explainUnnamedDiscoveredHost({
          host: pingOnlyHost({
            dnsHostnameStatus: code as DiscoveredHostReverseDnsStatus,
          }),
          scan: REPORTERS_SCAN,
        }),
      ).toStrictEqual(
        explainUnnamedDiscoveredHost({
          host: pingOnlyHost(),
          scan: REPORTERS_SCAN,
        }),
      );
    },
  );

  test.each(Object.values(DiscoveredHostReverseDnsStatus))(
    "the reverse-DNS code %p in the NetBIOS field reads as no code",
    (code: string) => {
      expect(
        explainUnnamedDiscoveredHost({
          host: pingOnlyHost({
            netbiosNameStatus: code as DiscoveredHostNetbiosStatus,
          }),
          scan: REPORTERS_SCAN,
        }),
      ).toStrictEqual(
        explainUnnamedDiscoveredHost({
          host: pingOnlyHost(),
          scan: REPORTERS_SCAN,
        }),
      );
    },
  );

  test("junk codes do not stop a sweeping scan from saying names come later", () => {
    /*
     * Only a real code means the naming passes ran for the row. Junk is not
     * evidence of that.
     */
    expect(
      explainUnnamedDiscoveredHost({
        host: pingOnlyHost({
          dnsHostnameStatus: "NO-RECORD" as DiscoveredHostReverseDnsStatus,
          netbiosNameStatus: 7 as unknown as DiscoveredHostNetbiosStatus,
        }),
        scan: { ...REPORTERS_SCAN, status: DiscoveryScanStatus.InProgress },
      }),
    ).toStrictEqual({
      label: NOT_YET_NAMED_HOST_LABEL,
      text: IN_PROGRESS_EXPLANATION,
    });
  });
});

describe("explainUnnamedDiscoveredHost — nothing the scanned network chose reaches the text", () => {
  /*
   * The text goes into a tooltip. Every field below was chosen by the
   * scanned host or by whoever runs DNS for its subnet, and a discovery scan
   * is routinely pointed at a subnet nobody in the project runs. None of
   * them, not even the address, may appear in it.
   */
  const HOSTILE_ADDRESS: string = "10.99.88.77";

  function hostileHost(
    overrides: Partial<DiscoveredNetworkDevice> = {},
  ): DiscoveredNetworkDevice {
    return {
      ipAddress: HOSTILE_ADDRESS,
      sysName: "   ",
      sysDescr: "PWNED-DESCR <script>alert(1)</script>",
      sysObjectId: "1.3.6.1.4.1.666",
      sysLocation: "PWNED-LOCATION",
      sysContact: "PWNED-CONTACT",
      // Normalises away, so the host is unnamed and the hint is shown.
      dnsHostname: "<img src=x onerror=1>.example",
      netbiosName: "EVIL NAME<b>",
      snmpConfigId: "PWNED-CONFIG",
      ...overrides,
      // A key the type does not know, as a modified probe could send.
      ...({
        note: "PWNED-EXTRA",
      } as unknown as Partial<DiscoveredNetworkDevice>),
    };
  }

  const FORBIDDEN: Array<string> = [
    HOSTILE_ADDRESS,
    "99.88",
    "PWNED",
    "<",
    ">",
    "&",
    "img",
    "onerror",
    "script",
    "EVIL",
    "evil",
    "example",
    "666",
    // Interpolation gone wrong.
    "undefined",
    "null",
    "[object",
    "NaN",
    "function",
  ];

  // What in the text should not be there, or an empty list.
  function hostChosenTextIn(text: string): Array<string> {
    const leaks: Array<string> = FORBIDDEN.filter((forbidden: string) => {
      return text.includes(forbidden);
    });

    /*
     * No digits at all, other than the port number in "UDP 137". So no
     * address, whole or in part, can have been interpolated.
     */
    const anyDigit: RegExp = /[0-9]/;

    if (anyDigit.test(text.replace("UDP 137", ""))) {
      leaks.push("a digit");
    }

    return leaks;
  }

  test("the hostile host is unnamed, so the hint is shown for it", () => {
    expect(isDiscoveredHostNamed(hostileHost())).toBe(false);
    expect(
      explainUnnamedDiscoveredHost({
        host: hostileHost(),
        scan: REPORTERS_SCAN,
      }),
    ).toBeDefined();
  });

  test("for every code, scan and probe, the text holds no host-chosen value", () => {
    /*
     * Violations are collected rather than asserted one by one: there are
     * over a hundred thousand cases, and a failure should print the texts
     * that leaked, not stop at the first.
     */
    const leaked: Array<{ text: string; leaks: Array<string> }> = [];
    let explained: number = 0;

    for (const namingCase of ALL_NAMING_CASES) {
      const explanation: DiscoveredHostNamingExplanation | undefined =
        explainUnnamedDiscoveredHost({
          host: hostileHost({
            snmpReachable: namingCase.host.snmpReachable,
            dnsHostnameStatus: namingCase.host.dnsHostnameStatus,
            netbiosNameStatus: namingCase.host.netbiosNameStatus,
          }),
          scan: namingCase.scan,
          isGlobalProbe: namingCase.isGlobalProbe,
        });

      if (!explanation) {
        continue;
      }

      explained++;

      const text: string = `${explanation.label} ${explanation.text}`;
      const leaks: Array<string> = hostChosenTextIn(text);

      if (leaks.length > 0) {
        leaked.push({ text: text, leaks: leaks });
      }
    }

    expect(explained).toBe(ALL_NAMING_CASES.length);
    expect(leaked.slice(0, 5)).toEqual([]);
  });

  test("an address that is itself markup is not echoed", () => {
    const explanation: DiscoveredHostNamingExplanation | undefined =
      explainUnnamedDiscoveredHost({
        host: hostileHost({ ipAddress: "<b>10.99.88.77</b>" }),
        scan: REPORTERS_SCAN,
      });

    expect(explanation).toBeDefined();
    expect(hostChosenTextIn(explanation!.text)).toEqual([]);
  });
});

describe("explainUnnamedDiscoveredHost — every combination", () => {
  /*
   * Each test below walks every case and COLLECTS what is wrong, then
   * asserts the list is empty. With over a hundred thousand cases that is
   * both faster than an expect per case and a better failure: it prints the
   * offending texts rather than stopping at the first.
   */
  test("the enumeration covers a meaningful space", () => {
    // 10 x 8 x 3 x 3 x (1 + 6 x 5 x 5) inputs.
    expect(ALL_NAMING_CASES.length).toBe(10 * 8 * 3 * 3 * (1 + 6 * 5 * 5));
  });

  test("every unnamed row gets an explanation, and only one of the two labels", () => {
    const wrong: Array<NamingCase> = ALL_NAMING_CASES.filter(
      (namingCase: NamingCase): boolean => {
        const explanation: DiscoveredHostNamingExplanation | undefined =
          explainUnnamedDiscoveredHost(namingCase);

        if (!explanation) {
          return true;
        }

        const isNotYetNamed: boolean =
          explanation.label === NOT_YET_NAMED_HOST_LABEL;

        return (
          (!isNotYetNamed && explanation.label !== UNNAMED_HOST_LABEL) ||
          isNotYetNamed !== (explanation.text === IN_PROGRESS_EXPLANATION)
        );
      },
    );

    expect(wrong.slice(0, 5)).toEqual([]);
  });

  test(`no text is longer than ${MAX_EXPLANATION_LENGTH} characters`, () => {
    const tooLong: Set<string> = new Set<string>();
    let longest: number = 0;

    for (const namingCase of ALL_NAMING_CASES) {
      const text: string = explainUnnamedDiscoveredHost(namingCase)!.text;

      longest = Math.max(longest, text.length);

      if (text.length > MAX_EXPLANATION_LENGTH) {
        tooLong.add(text);
      }
    }

    expect(Array.from(tooLong).slice(0, 5)).toEqual([]);
    /*
     * And the enumeration really reached the long combinations: the longest
     * text today is the reporter's scan with a missing PTR record and no
     * NetBIOS reply, at about 400 characters.
     */
    expect(longest).toBeGreaterThan(350);
  });

  test("every text is fixed copy, one sentence per source, in the order the sources win", () => {
    /*
     * Each text is read back as a sequence of known sentences. That proves
     * three things at once: nothing but fixed copy is in it, no source is
     * described twice, and the order is SNMP, reverse DNS, NetBIOS, then the
     * reverse-DNS tip, then the ask-the-device tip. The reverse-DNS line is
     * always there, because reverse DNS is asked on every scan.
     */
    const wrong: Set<string> = new Set<string>();

    for (const namingCase of ALL_NAMING_CASES) {
      const text: string = explainUnnamedDiscoveredHost(namingCase)!.text;

      if (
        text === IN_PROGRESS_EXPLANATION ||
        text === FAILED_SCAN_EXPLANATION
      ) {
        continue;
      }

      const sentences: Array<KnownSentence> | undefined =
        splitIntoKnownSentences(text);

      if (!sentences) {
        wrong.add(`not all fixed copy: ${text}`);
        continue;
      }

      const groups: Array<number> = sentences.map(
        (entry: KnownSentence): number => {
          return entry.group;
        },
      );
      const isInOrder: boolean = groups.every(
        (group: number, index: number): boolean => {
          return index === 0 || group > groups[index - 1]!;
        },
      );

      if (!isInOrder) {
        wrong.add(`out of order: ${text}`);
      }

      if (!groups.includes(REVERSE_DNS_GROUP)) {
        wrong.add(`no reverse-DNS line: ${text}`);
      }

      if (
        sentences
          .map((entry: KnownSentence): string => {
            return entry.sentence;
          })
          .join(" ") !== text
      ) {
        wrong.add(`not single-space joined: ${text}`);
      }
    }

    expect(Array.from(wrong).slice(0, 5)).toEqual([]);
  });

  test("the reverse-DNS tip matches the reverse-DNS code, and nothing else decides it", () => {
    const wrong: Set<string> = new Set<string>();

    for (const namingCase of ALL_NAMING_CASES) {
      const text: string = explainUnnamedDiscoveredHost(namingCase)!.text;
      const sentences: Array<KnownSentence> | undefined =
        splitIntoKnownSentences(text);

      if (!sentences) {
        // The two scan-level texts, pinned elsewhere.
        continue;
      }

      const tip: string | undefined = sentences.find(
        (entry: KnownSentence): boolean => {
          return entry.group === REVERSE_DNS_TIP_GROUP;
        },
      )?.sentence;
      const code: DiscoveredHostReverseDnsStatus | undefined =
        namingCase.host.dnsHostnameStatus;
      const expectedTip: string | undefined = code
        ? REVERSE_DNS_COPY.find(
            (
              entry: [
                DiscoveredHostReverseDnsStatus,
                string,
                string | undefined,
              ],
            ): boolean => {
              return entry[0] === code;
            },
          )![2]
        : undefined;

      if (tip !== expectedTip) {
        wrong.add(`${String(code)}: ${text}`);
      }
    }

    expect(Array.from(wrong).slice(0, 5)).toEqual([]);
  });

  test("the ask-the-device tip follows the scan's settings and the probe, and nothing else", () => {
    const wrong: Set<string> = new Set<string>();

    for (const namingCase of ALL_NAMING_CASES) {
      const text: string = explainUnnamedDiscoveredHost(namingCase)!.text;
      const sentences: Array<KnownSentence> | undefined =
        splitIntoKnownSentences(text);

      if (!sentences) {
        continue;
      }

      const tip: string | undefined = sentences.find(
        (entry: KnownSentence): boolean => {
          return entry.group === ASK_THE_DEVICE_GROUP;
        },
      )?.sentence;

      /*
       * Worked out from first principles rather than from the text: SNMP is
       * suggested when the scan turned it off; NetBIOS when the scan turned
       * it off, the row does not say it ran, and the probe is not a global
       * one that would refuse it anyway.
       */
      const scan: DiscoveredHostNamingScan | undefined = namingCase.scan;
      const isSnmpOff: boolean = Boolean(scan) && scan!.isSnmpEnabled === false;
      const isNetbiosSuggested: boolean =
        Boolean(scan) &&
        scan!.isNetbiosLookupEnabled !== true &&
        !namingCase.host.netbiosNameStatus &&
        namingCase.isGlobalProbe !== true;

      let expectedTip: string | undefined = undefined;

      if (isSnmpOff && isNetbiosSuggested) {
        expectedTip = ASK_THE_DEVICE_TIP;
      } else if (isSnmpOff) {
        expectedTip = ASK_THE_DEVICE_SNMP_TIP;
      } else if (isNetbiosSuggested) {
        expectedTip = ASK_THE_DEVICE_NETBIOS_TIP;
      }

      if (tip !== expectedTip) {
        wrong.add(text);
      }
    }

    expect(Array.from(wrong).slice(0, 5)).toEqual([]);
  });

  test("every text is plain sentences: capitalised, full-stopped, single-spaced", () => {
    const wrong: Set<string> = new Set<string>();
    const startsWithCapital: RegExp = /^[A-Z]/;
    const doubleSpace: RegExp = /\s{2,}/;
    const lineBreakOrTab: RegExp = /[\n\t]/;

    for (const namingCase of ALL_NAMING_CASES) {
      const text: string = explainUnnamedDiscoveredHost(namingCase)!.text;

      if (
        !startsWithCapital.test(text) ||
        !text.endsWith(".") ||
        doubleSpace.test(text) ||
        lineBreakOrTab.test(text) ||
        text !== text.trim()
      ) {
        wrong.add(text);
      }
    }

    expect(Array.from(wrong).slice(0, 5)).toEqual([]);
  });
});

describe("explainUnnamedDiscoveredHost — purity", () => {
  test("never changes the host or the scan it is handed", () => {
    const host: DiscoveredNetworkDevice = Object.freeze(
      pingOnlyHost({
        dnsHostnameStatus: DiscoveredHostReverseDnsStatus.Timeout,
        netbiosNameStatus: DiscoveredHostNetbiosStatus.NoReply,
      }),
    );
    const scan: DiscoveredHostNamingScan = Object.freeze({ ...REPORTERS_SCAN });
    const hostBefore: string = JSON.stringify(host);
    const scanBefore: string = JSON.stringify(scan);

    // Frozen, so a write would throw in strict mode rather than pass quietly.
    const first: DiscoveredHostNamingExplanation | undefined =
      explainUnnamedDiscoveredHost({ host: host, scan: scan });
    const second: DiscoveredHostNamingExplanation | undefined =
      explainUnnamedDiscoveredHost({ host: host, scan: scan });

    expect(JSON.stringify(host)).toBe(hostBefore);
    expect(JSON.stringify(scan)).toBe(scanBefore);
    expect(second).toStrictEqual(first);
  });

  test("does not read the row's registration or import state", () => {
    /*
     * Whether a host is already in the inventory has nothing to do with why
     * it has no name.
     */
    expect(
      explainUnnamedDiscoveredHost({
        host: pingOnlyHost({ isAlreadyRegistered: true }),
        scan: REPORTERS_SCAN,
      }),
    ).toStrictEqual(
      explainUnnamedDiscoveredHost({
        host: pingOnlyHost(),
        scan: REPORTERS_SCAN,
      }),
    );
  });
});

describe("explainUnnamedDiscoveredHost — the reporter's twelve kitchen displays", () => {
  /*
   * Issue #3916 as filed, with the codes a current probe would stamp. The
   * scan is ping only. The issue says neither whether NetBIOS was on nor
   * which probe ran it, so this takes the likeliest case: NetBIOS on (the
   * wizard's default) and one of the bundled self-hosted probes, which
   * register as global. Four displays have PTR names. The other eight used
   * to be eight identical bare addresses.
   */
  const NAMED: Array<DiscoveredNetworkDevice> = [
    pingOnlyHost({
      ipAddress: "10.16.42.51",
      dnsHostname: "WB0024KDS02.corp.example.com",
    }),
    pingOnlyHost({
      ipAddress: "10.16.42.52",
      dnsHostname: "wb-0024-kds09.corp.example.com",
    }),
    pingOnlyHost({
      ipAddress: "10.16.42.53",
      dnsHostname: "WB0024KDS04.corp.example.com",
    }),
    pingOnlyHost({
      ipAddress: "10.16.42.54",
      dnsHostname: "WB0024KDS05.corp.example.com",
    }),
  ];

  const UNNAMED_CODES: Array<DiscoveredHostReverseDnsStatus> = [
    DiscoveredHostReverseDnsStatus.NoRecord,
    DiscoveredHostReverseDnsStatus.NoRecord,
    DiscoveredHostReverseDnsStatus.Timeout,
    DiscoveredHostReverseDnsStatus.Timeout,
    DiscoveredHostReverseDnsStatus.ServerFailure,
    DiscoveredHostReverseDnsStatus.Refused,
    DiscoveredHostReverseDnsStatus.Unreachable,
    DiscoveredHostReverseDnsStatus.SkippedTimeBudget,
  ];

  const UNNAMED: Array<DiscoveredNetworkDevice> = UNNAMED_CODES.map(
    (code: DiscoveredHostReverseDnsStatus, index: number) => {
      return pingOnlyHost({
        ipAddress: `10.16.42.${55 + index}`,
        dnsHostnameStatus: code,
        netbiosNameStatus: DiscoveredHostNetbiosStatus.SkippedGlobalProbe,
      });
    },
  );

  test("the four named displays get no hint", () => {
    for (const host of NAMED) {
      expect(
        explainUnnamedDiscoveredHost({
          host: host,
          scan: REPORTERS_SCAN,
          isGlobalProbe: true,
        }),
      ).toBeUndefined();
    }
  });

  test("each of the other eight says what its own lookup came back with", () => {
    UNNAMED.forEach((host: DiscoveredNetworkDevice, index: number) => {
      const code: DiscoveredHostReverseDnsStatus = UNNAMED_CODES[index]!;
      const tip: string | undefined = REVERSE_DNS_COPY.find(
        (
          entry: [DiscoveredHostReverseDnsStatus, string, string | undefined],
        ) => {
          return entry[0] === code;
        },
      )![2];

      expect(
        explainUnnamedDiscoveredHost({
          host: host,
          scan: REPORTERS_SCAN,
          isGlobalProbe: true,
        }),
      ).toStrictEqual({
        label: UNNAMED_HOST_LABEL,
        text: [
          SNMP_NOT_CHECKED_SENTENCE,
          reverseDnsSentence(code),
          GLOBAL_PROBE_NETBIOS_SENTENCE,
          ...(tip ? [tip] : []),
          ASK_THE_DEVICE_SNMP_TIP,
        ].join(" "),
      });
    });
  });

  test("a missing record, a timeout and a server failure no longer look alike", () => {
    const texts: Set<string> = new Set<string>(
      UNNAMED.map((host: DiscoveredNetworkDevice): string => {
        return textOf({
          host: host,
          scan: REPORTERS_SCAN,
          isGlobalProbe: true,
        });
      }),
    );

    // Eight hosts, six distinct codes, so six distinct explanations.
    expect(texts.size).toBe(new Set(UNNAMED_CODES).size);
  });

  test("the same eight from an older probe claim no reason at all", () => {
    /*
     * The row an unupgraded probe stores has no codes. It must not guess
     * "no PTR record", which is the misdiagnosis that made the report.
     */
    for (const host of UNNAMED) {
      const legacy: DiscoveredNetworkDevice = { ...host };
      delete legacy.dnsHostnameStatus;
      delete legacy.netbiosNameStatus;

      const text: string = textOf({
        host: legacy,
        scan: REPORTERS_SCAN,
        isGlobalProbe: true,
      });

      expect(text).toBe(
        [
          SNMP_NOT_CHECKED_SENTENCE,
          REVERSE_DNS_NOT_RECORDED_SENTENCE,
          GLOBAL_PROBE_NETBIOS_SENTENCE,
          ASK_THE_DEVICE_SNMP_TIP,
        ].join(" "),
      );
      expect(text).not.toContain("PTR");
      expect(text).not.toContain("in time");
    }
  });
});
