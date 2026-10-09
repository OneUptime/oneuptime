import DefaultChooseDeviceName, {
  DeviceNameChoice,
  DeviceNameFacts,
  chooseDeviceName,
  isDeviceStillNamedByDiscovery,
  isNetbiosNameCutFromDnsName,
  normalizeSystemName,
} from "../../../Utils/NetworkDevice/DeviceNameRule";
import {
  DEVICE_NAME_SOURCES_BEST_FIRST,
  DeviceNameSource,
} from "../../../Types/NetworkDevice/DeviceNameSource";
import { describe, expect, test } from "@jest/globals";

/*
 * The one rule that names a network device nobody typed a name for
 * (OneUptime issue #4518): its own name first — the SNMP system name, then
 * the NetBIOS (Windows) name — then its reverse-DNS name, then its address.
 *
 * The report: Windows kitchen displays everyone calls WB0024KDS03, whose
 * reverse zone calls them wb-0024-kds03.wbhq.com, imported under the DNS name
 * or their address. These tests pin the order with every source present or
 * missing, the one exception (a NetBIOS name cut short), every odd value the
 * sources can carry, case, IDN names, and the short-name option.
 *
 * Non-ASCII and control characters are written as \uXXXX escapes: the point
 * of several cases is that the character is invisible.
 */

const ADDRESS: string = "10.16.42.53";
const SYS_NAME: string = "WB0024KDS03";
const NETBIOS_NAME: string = "WB0024KDS04";
const DNS_NAME: string = "wb-0024-kds03.wbhq.com";

function choose(
  facts: DeviceNameFacts,
  useShortNames?: boolean | null | undefined,
): DeviceNameChoice | undefined {
  return chooseDeviceName(facts, { useShortNames: useShortNames });
}

describe("the order: own names, then DNS, then the address", () => {
  /*
   * All sixteen combinations of four sources present or missing. The winner
   * is always the best source present, read off the order constant — so the
   * test cannot agree with a rule that has drifted from it.
   */
  const VALUES: Record<DeviceNameSource, string> = {
    [DeviceNameSource.SystemName]: SYS_NAME,
    [DeviceNameSource.NetbiosName]: NETBIOS_NAME,
    [DeviceNameSource.DnsName]: DNS_NAME,
    [DeviceNameSource.Address]: ADDRESS,
  };

  const FACT_KEYS: Record<DeviceNameSource, keyof DeviceNameFacts> = {
    [DeviceNameSource.SystemName]: "systemName",
    [DeviceNameSource.NetbiosName]: "netbiosName",
    [DeviceNameSource.DnsName]: "dnsName",
    [DeviceNameSource.Address]: "address",
  };

  const combinations: Array<Array<DeviceNameSource>> = [];

  for (let mask: number = 0; mask < 16; mask++) {
    combinations.push(
      DEVICE_NAME_SOURCES_BEST_FIRST.filter(
        (_source: DeviceNameSource, index: number): boolean => {
          return (mask & (1 << index)) !== 0;
        },
      ),
    );
  }

  const cases: Array<[string, Array<DeviceNameSource>]> = combinations.map(
    (present: Array<DeviceNameSource>): [string, Array<DeviceNameSource>] => {
      return [present.join(" + ") || "nothing", present];
    },
  );

  test.each(cases)("%s", (_label: string, present: Array<DeviceNameSource>) => {
    const facts: DeviceNameFacts = {};

    for (const source of present) {
      facts[FACT_KEYS[source]] = VALUES[source];
    }

    const choice: DeviceNameChoice | undefined = choose(facts);

    if (present.length === 0) {
      expect(choice).toBeUndefined();
      return;
    }

    const winner: DeviceNameSource = present[0]!;

    expect(choice).toEqual({
      name: VALUES[winner],
      fullName: VALUES[winner],
      source: winner,
    });
  });

  test("the reported display: its Windows name, not its DNS name", () => {
    expect(
      choose({
        netbiosName: "WB0024KDS04",
        dnsName: "wb-0024-kds04.wbhq.com",
        address: "10.16.42.54",
      }),
    ).toEqual({
      name: "WB0024KDS04",
      fullName: "WB0024KDS04",
      source: DeviceNameSource.NetbiosName,
    });
  });

  test("the reported unnamed host: its address, and nothing pretends otherwise", () => {
    expect(choose({ address: "10.16.42.52" })).toEqual({
      name: "10.16.42.52",
      fullName: "10.16.42.52",
      source: DeviceNameSource.Address,
    });
  });

  test("the default export is the rule", () => {
    expect(DefaultChooseDeviceName).toBe(chooseDeviceName);
  });

  test("with no options at all it names by the full name", () => {
    expect(chooseDeviceName({ dnsName: DNS_NAME })?.name).toBe(DNS_NAME);
  });
});

describe("a source that has nothing usable falls through to the next one", () => {
  test("an unusable sysName lets the NetBIOS name name the device", () => {
    expect(
      choose({ systemName: "localhost", netbiosName: NETBIOS_NAME })?.source,
    ).toBe(DeviceNameSource.NetbiosName);
  });

  test("an unusable NetBIOS answer lets the DNS name name the device", () => {
    expect(
      choose({ netbiosName: "__MSBROWSE__", dnsName: DNS_NAME })?.source,
    ).toBe(DeviceNameSource.DnsName);
    expect(choose({ netbiosName: "a.b", dnsName: DNS_NAME })?.source).toBe(
      DeviceNameSource.DnsName,
    );
  });

  test("an unusable PTR answer lets the address name the device", () => {
    for (const dnsName of [
      "53.42.16.10.in-addr.arpa",
      "<script>.example.com",
      "10.16.42.53",
      "",
      "   ",
    ]) {
      expect(choose({ dnsName: dnsName, address: ADDRESS })).toEqual({
        name: ADDRESS,
        fullName: ADDRESS,
        source: DeviceNameSource.Address,
      });
    }
  });

  test("nothing usable at all, and no address, is no name rather than an empty one", () => {
    expect(
      choose({
        systemName: "   ",
        netbiosName: "!!",
        dnsName: "in-addr.arpa",
        address: "  ",
      }),
    ).toBeUndefined();
  });
});

describe("a NetBIOS name cut to fifteen characters gives way to the DNS name it came from", () => {
  test("a fifteen-character stump of the PTR name's first label loses, with short names on or off", () => {
    const facts: DeviceNameFacts = {
      netbiosName: "WB-0024-KITCHEN",
      dnsName: "wb-0024-kitchen-display-03.wbhq.com",
    };

    expect(choose(facts)).toEqual({
      name: "wb-0024-kitchen-display-03.wbhq.com",
      fullName: "wb-0024-kitchen-display-03.wbhq.com",
      source: DeviceNameSource.DnsName,
    });
    expect(choose(facts, true)).toEqual({
      name: "wb-0024-kitchen-display-03",
      fullName: "wb-0024-kitchen-display-03.wbhq.com",
      source: DeviceNameSource.DnsName,
    });
  });

  test("a shorter NetBIOS name is a whole name, even when the DNS name starts with it", () => {
    expect(
      choose({
        netbiosName: "WB-KITCHEN",
        dnsName: "wb-kitchen-display.wbhq.com",
      })?.source,
    ).toBe(DeviceNameSource.NetbiosName);
  });

  test("a fifteen-character NetBIOS name the DNS name does not start with still wins", () => {
    expect(
      choose({
        netbiosName: "ACCOUNTSPAYABLE",
        dnsName: "finance-desk-0142.corp.example.com",
      })?.source,
    ).toBe(DeviceNameSource.NetbiosName);
  });

  test("a fifteen-character NetBIOS name equal to the whole first label is not a stump", () => {
    expect(
      choose({
        netbiosName: "ACCOUNTSPAYABLE",
        dnsName: "accountspayable.corp.example.com",
      }),
    ).toEqual({
      name: "ACCOUNTSPAYABLE",
      fullName: "ACCOUNTSPAYABLE",
      source: DeviceNameSource.NetbiosName,
    });
  });

  test("isNetbiosNameCutFromDnsName", () => {
    expect(
      isNetbiosNameCutFromDnsName("WB-0024-KITCHEN", "wb-0024-kitchen-x.a.b"),
    ).toBe(true);
    // Compared without case.
    expect(
      isNetbiosNameCutFromDnsName("wb-0024-kitchen", "WB-0024-KITCHEN-X.a.b"),
    ).toBe(true);
    // Fourteen characters is a whole name.
    expect(
      isNetbiosNameCutFromDnsName("WB-0024-KITCHE", "wb-0024-kitchen-x.a.b"),
    ).toBe(false);
    // Only the FIRST label counts: a later label is not the host's name.
    expect(
      isNetbiosNameCutFromDnsName("WB-0024-KITCHEN", "x.wb-0024-kitchen-x.b"),
    ).toBe(false);
    expect(isNetbiosNameCutFromDnsName("WB-0024-KITCHEN", "")).toBe(false);
  });

  test("a stump with no DNS name to give way to still names the device", () => {
    expect(choose({ netbiosName: "WB-0024-KITCHEN" })?.name).toBe(
      "WB-0024-KITCHEN",
    );
  });
});

describe("case is kept, whatever the source", () => {
  test("a sysName as configured", () => {
    expect(choose({ systemName: "Core-SW-01" })?.name).toBe("Core-SW-01");
  });

  test("a NetBIOS name as the host reported it: upper case from Windows", () => {
    expect(choose({ netbiosName: "WB0024KDS03" })?.name).toBe("WB0024KDS03");
  });

  test("a NetBIOS name in the case a Samba host or an older probe stored it", () => {
    expect(choose({ netbiosName: "fileserver" })?.name).toBe("fileserver");
    expect(choose({ netbiosName: "FileServer" })?.name).toBe("FileServer");
  });

  test("a PTR name as its zone was written", () => {
    expect(choose({ dnsName: "KDS01.WbHq.com" })?.name).toBe("KDS01.WbHq.com");
  });
});

describe("normalizeSystemName: odd sysNames", () => {
  test("keeps an ordinary name, trimmed", () => {
    expect(normalizeSystemName("  core-sw-01  ")).toBe("core-sw-01");
  });

  test("keeps a display name with spaces and punctuation: a sysName is not a hostname", () => {
    expect(normalizeSystemName("Core Switch #2 (Rack B)")).toBe(
      "Core Switch #2 (Rack B)",
    );
  });

  test("keeps non-ASCII letters a person typed into the device", () => {
    expect(normalizeSystemName("Büro-Switch")).toBe("Büro-Switch");
    expect(normalizeSystemName("東京-core")).toBe("東京-core");
  });

  test("keeps an IDN host name in its ASCII (xn--) form", () => {
    expect(normalizeSystemName("xn--bro-switch-hcb.example.de")).toBe(
      "xn--bro-switch-hcb.example.de",
    );
  });

  test("strips the NUL and space padding an agent may leave on a DisplayString", () => {
    expect(normalizeSystemName("CORE-SW\u0000\u0000\u0000")).toBe("CORE-SW");
    expect(normalizeSystemName("CORE-SW \u0000 \u0000")).toBe("CORE-SW");
  });

  test.each([
    ["blank", "   "],
    ["empty", ""],
    ["padding only", "\u0000\u0000  \t"],
    ["an inner NUL", "CORE\u0000SW"],
    ["a line break", "core\nsw"],
    ["an escape character", "core\u001bsw"],
    ["a DEL", "core\u007f"],
    ["a C1 control character", "core\u0085sw"],
  ])("refuses %s", (_label: string, value: string) => {
    expect(normalizeSystemName(value)).toBeUndefined();
  });

  test.each([
    "localhost",
    "LOCALHOST",
    "localhost.localdomain",
    "localhost4",
    "localhost4.localdomain4",
    "localhost6",
    "localhost6.localdomain6",
    "ip6-localhost",
    "ip6-loopback",
    "(none)",
    "none",
    "None",
    "unknown",
    "(unknown)",
    "Unknown",
    "null",
    "(null)",
    "n/a",
    "-",
  ])("refuses the placeholder %p", (value: string) => {
    expect(normalizeSystemName(value)).toBeUndefined();
    expect(normalizeSystemName(`  ${value}  `)).toBeUndefined();
  });

  test("keeps names that merely contain a placeholder word", () => {
    expect(normalizeSystemName("localhost-printer")).toBe("localhost-printer");
    expect(normalizeSystemName("unknown-room-ap")).toBe("unknown-room-ap");
  });

  /*
   * A factory-default name is still a name of sorts, and easier to find a
   * device under than an address. Only names that name nothing are refused.
   */
  test("keeps factory-default names that are names", () => {
    for (const value of ["Switch", "Router", "MikroTik", "UBNT"]) {
      expect(normalizeSystemName(value)).toBe(value);
    }
  });

  test.each([
    "10.16.42.53",
    "192.168.0.1",
    "0.0.0.0",
    "999.1.1.1",
    "::1",
    "fe80::1",
    "2001:db8::42",
    "::ffff:10.16.42.53",
    "FE80:0:0:0:0:0:0:1",
  ])("refuses an address spelled as a name: %p", (value: string) => {
    expect(normalizeSystemName(value)).toBeUndefined();
  });

  test("keeps things that only look a little like addresses", () => {
    for (const value of [
      "10.16.42",
      "2001",
      "core:1",
      "rack-10.16.42.53",
      "10.16.42.53-mgmt",
      "SW:Core:01",
    ]) {
      expect(normalizeSystemName(value)).toBe(value);
    }
  });

  test.each([
    ["a number", 42],
    ["a boolean", true],
    ["null", null],
    ["undefined", undefined],
    ["an object", { name: "core" }],
    ["an array", ["core"]],
  ])(
    "reads %s as no name, never throwing",
    (_label: string, value: unknown) => {
      expect(normalizeSystemName(value)).toBeUndefined();
    },
  );

  test("stays fast on a very long hostile value", () => {
    const startedAt: number = Date.now();

    expect(normalizeSystemName(":".repeat(200000) + "x")).toBe(
      ":".repeat(200000) + "x",
    );
    expect(normalizeSystemName("a" + " ".repeat(200000) + "b")).toBe(
      "a" + " ".repeat(200000) + "b",
    );
    expect(normalizeSystemName("a" + "\u0000 ".repeat(100000))).toBe("a");
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

describe("the address", () => {
  test("is trimmed, and is exactly the hostname a device is given", () => {
    expect(choose({ address: " 10.16.42.53 " })?.name).toBe("10.16.42.53");
  });

  test("an address that came out of jsonb as a number is still an address", () => {
    expect(choose({ address: 1234 as unknown as string })?.name).toBe("1234");
  });

  test("is never shortened, whatever the option says", () => {
    expect(choose({ address: ADDRESS }, true)?.name).toBe(ADDRESS);
  });

  test("an empty or missing address is no name at all", () => {
    for (const address of [undefined, null, "", "   "]) {
      expect(choose({ address: address })).toBeUndefined();
    }
  });
});

describe("short names (issue #3678) change how a name reads, never which source wins", () => {
  test("a PTR name is cut to its first label, and the full name is kept", () => {
    expect(choose({ dnsName: DNS_NAME }, true)).toEqual({
      name: "wb-0024-kds03",
      fullName: DNS_NAME,
      source: DeviceNameSource.DnsName,
    });
  });

  test("an FQDN sysName is cut too, and stays an SNMP name", () => {
    expect(choose({ systemName: "core-sw-01.corp.example.com" }, true)).toEqual(
      {
        name: "core-sw-01",
        fullName: "core-sw-01.corp.example.com",
        source: DeviceNameSource.SystemName,
      },
    );
  });

  test("a NetBIOS name has nothing to cut", () => {
    expect(choose({ netbiosName: NETBIOS_NAME }, true)).toEqual({
      name: NETBIOS_NAME,
      fullName: NETBIOS_NAME,
      source: DeviceNameSource.NetbiosName,
    });
  });

  test("an IDN name with an xn-- top-level label is cut like any other", () => {
    expect(choose({ dnsName: "kds03.xn--wbhq-qoa.xn--p1ai" }, true)).toEqual({
      name: "kds03",
      fullName: "kds03.xn--wbhq-qoa.xn--p1ai",
      source: DeviceNameSource.DnsName,
    });
  });

  test("an IDN first label stays in its ASCII form", () => {
    expect(choose({ dnsName: "xn--kche-0ra.wbhq.com" }, true)?.name).toBe(
      "xn--kche-0ra",
    );
  });

  test("a name that is not a fully qualified hostname is left as it is", () => {
    for (const systemName of ["Core Switch", "ubuntu-22.04", "core-sw"]) {
      expect(choose({ systemName: systemName }, true)?.name).toBe(systemName);
    }
  });

  test.each([
    ["false", false],
    ["null", null],
    ["undefined", undefined],
    ["the string true", "true"],
    ["the number 1", 1],
  ])(
    "only an exact true shortens, not %s",
    (_label: string, value: unknown) => {
      expect(
        chooseDeviceName(
          { dnsName: DNS_NAME },
          { useShortNames: value as boolean },
        )?.name,
      ).toBe(DNS_NAME);
    },
  );
});

describe("hostile and odd values from jsonb never throw and never name a device", () => {
  test.each([
    ["numbers", { systemName: 42, netbiosName: 7, dnsName: 9 }],
    ["objects", { systemName: {}, netbiosName: {}, dnsName: {} }],
    ["arrays", { systemName: ["a"], netbiosName: ["B"], dnsName: ["c.d"] }],
    ["booleans", { systemName: true, netbiosName: false, dnsName: true }],
  ])(
    "%s fall through to the address",
    (_label: string, facts: Record<string, unknown>) => {
      expect(
        choose({ ...(facts as DeviceNameFacts), address: ADDRESS }),
      ).toEqual({
        name: ADDRESS,
        fullName: ADDRESS,
        source: DeviceNameSource.Address,
      });
    },
  );

  test("markup is never a name", () => {
    expect(
      choose({
        netbiosName: "<b>x</b>",
        dnsName: "<script>alert(1)</script>.example.com",
        address: ADDRESS,
      })?.source,
    ).toBe(DeviceNameSource.Address);
  });

  test("property: the choice is always one of the inputs, normalised, from the best usable source", () => {
    /*
     * A deterministic LCG, so a failure reproduces. Each source is drawn from
     * good values, odd values and nothing, and the rule's answer is checked
     * against the order: no better usable source may have been skipped, bar
     * the one documented exception (a NetBIOS stump of the DNS name).
     */
    let seed: number = 0x4518;

    const next: () => number = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    const pick: <T>(values: Array<T>) => T = <T>(values: Array<T>): T => {
      return values[Math.floor(next() * values.length)]!;
    };

    const SYS: Array<unknown> = [
      undefined,
      "",
      "localhost",
      "10.0.0.1",
      "Core-SW-01",
      "core.corp.example.com",
      42,
    ];
    const NETBIOS: Array<unknown> = [
      undefined,
      "",
      "WB0024KDS03",
      "WB-0024-KITCHEN",
      "__MSBROWSE__",
      "bad name",
    ];
    const DNS: Array<unknown> = [
      undefined,
      "",
      "wb-0024-kds03.wbhq.com",
      "wb-0024-kitchen-display.wbhq.com",
      "1.0.0.10.in-addr.arpa",
    ];
    const ADDRESSES: Array<unknown> = [undefined, "", "10.0.0.1", " 10.0.0.2 "];

    for (let iteration: number = 0; iteration < 3000; iteration++) {
      const facts: DeviceNameFacts = {
        systemName: pick(SYS),
        netbiosName: pick(NETBIOS),
        dnsName: pick(DNS),
        address: pick(ADDRESSES),
      };

      const choice: DeviceNameChoice | undefined = choose(facts);

      if (!choice) {
        expect(String(facts.address ?? "").trim()).toBe("");
        continue;
      }

      expect(choice.name).toBe(choice.fullName);

      switch (choice.source) {
        case DeviceNameSource.SystemName:
          expect(choice.name).toBe(normalizeSystemName(facts.systemName));
          break;
        case DeviceNameSource.NetbiosName:
          expect(normalizeSystemName(facts.systemName)).toBeUndefined();
          break;
        case DeviceNameSource.DnsName:
          expect(normalizeSystemName(facts.systemName)).toBeUndefined();
          if (facts.netbiosName === "WB0024KDS03") {
            throw new Error(
              `A whole NetBIOS name lost to DNS: ${JSON.stringify(facts)}`,
            );
          }
          break;
        case DeviceNameSource.Address:
          expect(choice.name).toBe(String(facts.address).trim());
          expect(normalizeSystemName(facts.systemName)).toBeUndefined();
          expect(["WB0024KDS03", "WB-0024-KITCHEN"]).not.toContain(
            facts.netbiosName,
          );
          break;
        default:
          throw new Error(`Unknown source ${String(choice.source)}`);
      }
    }
  });
});

describe("isDeviceStillNamedByDiscovery: never rename a name a person typed", () => {
  const DISCOVERED: {
    name: string;
    discoveredName: string;
    discoveredNameSource: string;
  } = {
    name: "wb-0024-kds04",
    discoveredName: "wb-0024-kds04",
    discoveredNameSource: DeviceNameSource.DnsName,
  };

  test("a device still called what discovery named it", () => {
    expect(isDeviceStillNamedByDiscovery(DISCOVERED)).toBe(true);
  });

  test("ignores whitespace around either name, as a form re-save might add", () => {
    expect(
      isDeviceStillNamedByDiscovery({ ...DISCOVERED, name: " wb-0024-kds04 " }),
    ).toBe(true);
    expect(
      isDeviceStillNamedByDiscovery({
        ...DISCOVERED,
        discoveredName: "wb-0024-kds04  ",
      }),
    ).toBe(true);
  });

  test("a device a person renamed — even only its case — is theirs", () => {
    expect(
      isDeviceStillNamedByDiscovery({ ...DISCOVERED, name: "Kitchen 4" }),
    ).toBe(false);
    expect(
      isDeviceStillNamedByDiscovery({ ...DISCOVERED, name: "WB-0024-KDS04" }),
    ).toBe(false);
  });

  test.each([
    ["no source", undefined],
    ["a null source", null],
    ["an unknown source", "typed"],
    ["a mis-cased source", "Dns-Name"],
  ])(
    "a device with %s was not named by discovery",
    (_label: string, source: unknown) => {
      expect(
        isDeviceStillNamedByDiscovery({
          ...DISCOVERED,
          discoveredNameSource: source,
        }),
      ).toBe(false);
    },
  );

  test("a device with no discovered name, or no name, is not discovery-named", () => {
    expect(
      isDeviceStillNamedByDiscovery({
        ...DISCOVERED,
        discoveredName: undefined,
      }),
    ).toBe(false);
    expect(
      isDeviceStillNamedByDiscovery({ ...DISCOVERED, discoveredName: null }),
    ).toBe(false);
    expect(isDeviceStillNamedByDiscovery({ ...DISCOVERED, name: "" })).toBe(
      false,
    );
    expect(
      isDeviceStillNamedByDiscovery({
        ...DISCOVERED,
        name: "  ",
        discoveredName: "  ",
      }),
    ).toBe(false);
  });

  test("values that are not text never match", () => {
    expect(
      isDeviceStillNamedByDiscovery({
        ...DISCOVERED,
        name: 42,
        discoveredName: 42,
      }),
    ).toBe(false);
  });
});
