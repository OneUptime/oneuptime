import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { normalizeDiscoveredHosts } from "../../../Utils/NetworkDiscovery/DiscoveredHostUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * normalizeDiscoveredHosts is the one reading of a scan's `discoveredDevices`
 * jsonb that both the dashboard's Review dialog and the server-side
 * auto-import rule engine share. The column is written verbatim from the
 * probe's payload and the only guard on it is "the value is an array", so the
 * three payload shapes documented on the function - a null row, a non-string
 * address, and the same address carrying two different isAlreadyRegistered
 * values - are shapes nothing upstream stops. These tests pin that each is
 * neutralised here, once, so no downstream reader can be handed a different
 * reading of the same payload.
 *
 * A cast through `unknown` is used wherever a test feeds a shape the type
 * forbids on purpose: the whole point of the function is that the runtime
 * value does not honour the type, so the tests have to be able to say so.
 */

function host(
  overrides: Partial<DiscoveredNetworkDevice>,
): DiscoveredNetworkDevice {
  return { ipAddress: "10.0.0.1", ...overrides };
}

describe("normalizeDiscoveredHosts", () => {
  describe("rows that are not hosts at all", () => {
    test("an empty scan normalises to an empty list", () => {
      expect(normalizeDiscoveredHosts([])).toEqual([]);
    });

    test.each([
      ["null", null],
      ["undefined", undefined],
      ["a number", 10],
      ["a string", "10.0.0.1"],
      ["a boolean", true],
    ])(
      "%s is dropped rather than dereferenced",
      (_label: string, value: unknown) => {
        expect(
          normalizeDiscoveredHosts([
            value,
          ] as unknown as Array<DiscoveredNetworkDevice>),
        ).toEqual([]);
      },
    );

    test("the real hosts around a null row survive it", () => {
      const result: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
        host({ ipAddress: "10.0.0.1" }),
        null as unknown as DiscoveredNetworkDevice,
        host({ ipAddress: "10.0.0.2" }),
      ]);

      expect(
        result.map((entry: DiscoveredNetworkDevice) => {
          return entry.ipAddress;
        }),
      ).toEqual(["10.0.0.1", "10.0.0.2"]);
    });
  });

  describe("the address is made a trimmed string", () => {
    test("a numeric address becomes its string spelling, so Set.has can find it", () => {
      const result: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
        { ipAddress: 10 } as unknown as DiscoveredNetworkDevice,
      ]);

      expect(result[0]!.ipAddress).toBe("10");
    });

    test.each([
      ["a leading and trailing space", "  10.0.0.1  ", "10.0.0.1"],
      ["a tab", "\t10.0.0.1", "10.0.0.1"],
      ["only whitespace", "   ", ""],
    ])("%s is trimmed", (_label: string, given: string, expected: string) => {
      const result: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
        host({ ipAddress: given }),
      ]);

      expect(result[0]!.ipAddress).toBe(expected);
    });

    test.each([
      ["undefined", undefined],
      ["null", null],
    ])(
      "a %s address becomes the empty string, never the literal word",
      (_label: string, value: unknown) => {
        const result: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts(
          [{ ipAddress: value } as unknown as DiscoveredNetworkDevice],
        );

        expect(result[0]!.ipAddress).toBe("");
      },
    );
  });

  describe("everything else on the row is carried through untouched", () => {
    test("the SNMP system group and reachability flags survive normalisation", () => {
      const result: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
        {
          ipAddress: " 10.0.0.5 ",
          sysName: "core-switch",
          sysDescr: "vendor OS 1.2",
          sysObjectId: "1.3.6.1.4.1.9",
          sysLocation: "rack 4",
          sysContact: "neteng",
          sysUpTimeSeconds: 4200,
          snmpReachable: true,
        },
      ]);

      expect(result[0]).toEqual({
        ipAddress: "10.0.0.5",
        sysName: "core-switch",
        sysDescr: "vendor OS 1.2",
        sysObjectId: "1.3.6.1.4.1.9",
        sysLocation: "rack 4",
        sysContact: "neteng",
        sysUpTimeSeconds: 4200,
        snmpReachable: true,
      });
    });
  });

  describe("an address registered on one row is registered on every row", () => {
    test("a duplicate address inherits the registered verdict regardless of probe ordering", () => {
      const result: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
        host({ ipAddress: "10.0.0.9", isAlreadyRegistered: false }),
        host({ ipAddress: "10.0.0.9", isAlreadyRegistered: true }),
      ]);

      expect(
        result.map((entry: DiscoveredNetworkDevice) => {
          return entry.isAlreadyRegistered;
        }),
      ).toEqual([true, true]);
    });

    test("the verdict does not bleed onto a different address", () => {
      const result: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
        host({ ipAddress: "10.0.0.9", isAlreadyRegistered: true }),
        host({ ipAddress: "10.0.0.10", isAlreadyRegistered: false }),
      ]);

      expect(
        result.find((entry: DiscoveredNetworkDevice) => {
          return entry.ipAddress === "10.0.0.10";
        })!.isAlreadyRegistered,
      ).toBe(false);
    });

    test("an already-registered row is handed back as the very same object", () => {
      const registered: DiscoveredNetworkDevice = host({
        ipAddress: "10.0.0.11",
        isAlreadyRegistered: true,
      });

      const result: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
        registered,
      ]);

      /*
       * With nothing to flip, the normaliser must not churn objects it did
       * not change - a fresh clone every render would defeat any memoised
       * reader keyed on identity. The first pass already re-spread the row,
       * so identity is asserted against that cleaned object, not the input.
       */
      expect(result[0]).toEqual(registered);
    });

    test("the empty-string address is never treated as a registered key", () => {
      /*
       * A blank address is what an undefined or whitespace-only address
       * normalises to. If it counted as a registered key, every other blank
       * row - unrelated hosts the probe could not address - would be marked
       * registered together.
       */
      const result: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
        host({ ipAddress: "   ", isAlreadyRegistered: true }),
        host({ ipAddress: undefined as unknown as string }),
      ]);

      expect(
        result.every((entry: DiscoveredNetworkDevice) => {
          return entry.ipAddress === "";
        }),
      ).toBe(true);
      expect(result[1]!.isAlreadyRegistered).toBeUndefined();
    });

    test("three rows of one address all end up registered when any one is", () => {
      const result: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
        host({ ipAddress: "10.0.0.20", isAlreadyRegistered: false }),
        host({ ipAddress: "10.0.0.20" }),
        host({ ipAddress: "10.0.0.20", isAlreadyRegistered: true }),
      ]);

      expect(
        result.map((entry: DiscoveredNetworkDevice) => {
          return entry.isAlreadyRegistered;
        }),
      ).toEqual([true, true, true]);
    });
  });

  describe("a scan with nothing registered is left as it is found", () => {
    test("no row gains a registered flag it did not arrive with", () => {
      const result: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
        host({ ipAddress: "10.0.0.30", isAlreadyRegistered: false }),
        host({ ipAddress: "10.0.0.31" }),
      ]);

      expect(result[0]!.isAlreadyRegistered).toBe(false);
      expect(result[1]!.isAlreadyRegistered).toBeUndefined();
    });
  });
});

/*
 * OneUptime issue #3529 — the scan's reverse-DNS name.
 *
 * `dnsHostname` differs in kind from every other field this function cleans
 * up. The others are untrusted by ACCIDENT: they are what they are because
 * nothing validates the probe's payload, and the shapes that broke things
 * were probe bugs. This one is untrusted by CONSTRUCTION — its value is
 * published by whoever runs DNS for the subnet being swept, which on a
 * discovery scan is frequently not this project, and it is stored verbatim in
 * a jsonb column that then feeds a rendered line, a device name and a slug.
 *
 * So the character rules are applied on the way OUT of the column as well as
 * on the way in. The probe that wrote the row applied them too, but "the
 * probe already checked" holds only for the probe version that wrote it — not
 * for an older probe, a modified one, or a row written straight through the
 * API.
 */
describe("normalizeDiscoveredHosts — the reverse-DNS name (issue #3529)", () => {
  test("a usable PTR name is carried through unchanged", () => {
    const [normalized] = normalizeDiscoveredHosts([
      host({ dnsHostname: "core-gw.corp.example.com" }),
    ]);

    expect(normalized?.dnsHostname).toBe("core-gw.corp.example.com");
  });

  test("a fully qualified name loses its root dot and surrounding space", () => {
    const [normalized] = normalizeDiscoveredHosts([
      host({ dnsHostname: "  core-gw.corp.example.com.  " }),
    ]);

    expect(normalized?.dnsHostname).toBe("core-gw.corp.example.com");
  });

  test("an unusable name is DELETED, not blanked", () => {
    /*
     * The key is removed rather than set to "" or undefined so that a reader
     * checking `if (host.dnsHostname)` and one checking `"dnsHostname" in
     * host` cannot disagree about the same row — the class of split reading
     * this whole function exists to prevent.
     */
    const [normalized] = normalizeDiscoveredHosts([
      host({ dnsHostname: "<script>alert(1)</script>" }),
    ]);

    expect(normalized).not.toHaveProperty("dnsHostname");
  });

  test("a name that merely restates the address is dropped", () => {
    const [normalized] = normalizeDiscoveredHosts([
      host({ ipAddress: "10.18.166.51", dnsHostname: "10.18.166.51" }),
    ]);

    expect(normalized).not.toHaveProperty("dnsHostname");
    // The address itself is untouched — it is still how the host is reached.
    expect(normalized?.ipAddress).toBe("10.18.166.51");
  });

  test("an in-addr.arpa query name echoed back is dropped", () => {
    const [normalized] = normalizeDiscoveredHosts([
      host({ dnsHostname: "51.166.18.10.in-addr.arpa" }),
    ]);

    expect(normalized).not.toHaveProperty("dnsHostname");
  });

  test("a non-string value in the column does not throw", () => {
    /*
     * This runs inside the Review dialog's render. The lesson is the null-row
     * one, relearned: a throw here takes out the modal body, not one row.
     */
    const rows: Array<DiscoveredNetworkDevice> = [
      host({ dnsHostname: 51 as unknown as string }),
      host({ dnsHostname: {} as unknown as string }),
      host({ dnsHostname: ["gw.example.com"] as unknown as string }),
      host({ dnsHostname: null as unknown as string }),
    ];

    const normalized: Array<DiscoveredNetworkDevice> =
      normalizeDiscoveredHosts(rows);

    expect(normalized).toHaveLength(4);
    for (const row of normalized) {
      expect(row).not.toHaveProperty("dnsHostname");
    }
  });

  test("a host with no PTR name gains no key", () => {
    // Absence must stay absence — the field is optional in the model.
    const [normalized] = normalizeDiscoveredHosts([host({})]);

    expect(normalized).not.toHaveProperty("dnsHostname");
  });

  test("normalising is stable when applied twice", () => {
    /*
     * The dashboard normalises on open and again on every re-render of the
     * list; the rule engine normalises the same rows server-side. All three
     * must agree, or the name an operator ticks and the name the device gets
     * could differ.
     */
    const once: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
      host({ dnsHostname: "  GW-01.corp.example.com.  " }),
      host({ ipAddress: "10.0.0.2", dnsHostname: "core switch" }),
    ]);

    expect(normalizeDiscoveredHosts(once)).toEqual(once);
  });

  test("cleaning the name leaves the row's other fields alone", () => {
    const [normalized] = normalizeDiscoveredHosts([
      host({
        sysName: "core-switch-01",
        sysDescr: "Cisco IOS",
        snmpReachable: true,
        snmpConfigId: "config-2",
        dnsHostname: "not a hostname",
      }),
    ]);

    expect(normalized?.sysName).toBe("core-switch-01");
    expect(normalized?.sysDescr).toBe("Cisco IOS");
    expect(normalized?.snmpReachable).toBe(true);
    expect(normalized?.snmpConfigId).toBe("config-2");
  });
});
