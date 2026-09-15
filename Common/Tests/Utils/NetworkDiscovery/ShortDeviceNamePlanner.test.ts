import {
  SKIPPED_NO_NAME_MESSAGE,
  SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE,
  ShortDeviceNamePlan,
  ShortDeviceNameRename,
  ShortDeviceNameSkip,
  ShortenableDevice,
  buildInBatchCollisionMessage,
  planShortDeviceName,
  planShortDeviceNames,
  splitAddressSuffix,
} from "../../../Utils/NetworkDiscovery/ShortDeviceNamePlanner";
import {
  MAX_DEVICE_NAME_LENGTH,
  buildDeviceName,
  buildFallbackDeviceName,
} from "../../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { getShortHostname } from "../../../Utils/NetworkDiscovery/ShortHostnameUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * The decision logic behind the Devices list's bulk "shorten names" action
 * (OneUptime issue #3678).
 *
 * The scan setting only names devices imported from now on. The reporter's
 * project already holds hundreds of devices named by their full reverse-DNS
 * name, and re-importing does not rename them — a registered address is
 * skipped by design — so this is the only fix for them short of editing each
 * one by hand. It renames real devices, in bulk, from a single confirm
 * dialog, so every rule here is one where getting it wrong renames something
 * the operator did not ask to have renamed or destroys the only copy of a
 * name they wanted kept:
 *
 *   - WHAT is renamed, and to what: a fully qualified name becomes its first
 *     label; a collision-fallback "fqdn (ip)" name becomes "short (ip)";
 *     anything else is skipped with a reason the operator can read.
 *   - WHETHER the full name is kept, as the device's DNS name — only when it
 *     is genuinely a whole DNS name that is not already stored elsewhere.
 *   - WHO in the selection is left alone: every member of a group that would
 *     end up sharing one name, so the outcome never depends on table order.
 *
 * The planner is pure, so these tests exercise the rules directly; the hook
 * that calls it (a fresh read, a server-side collision check, the write) is
 * tested with the dashboard.
 */

function device(overrides: Partial<ShortenableDevice>): ShortenableDevice {
  return {
    id: "device-1",
    hostname: "10.18.167.31",
    ...overrides,
  };
}

function asRename(
  plan: ShortDeviceNamePlan | undefined,
): ShortDeviceNameRename {
  expect(plan?.kind).toBe("rename");
  return plan as ShortDeviceNameRename;
}

function asSkip(plan: ShortDeviceNamePlan | undefined): ShortDeviceNameSkip {
  expect(plan?.kind).toBe("skip");
  return plan as ShortDeviceNameSkip;
}

describe("splitAddressSuffix", () => {
  /*
   * The exact shape DiscoveredDeviceBuilder.buildFallbackDeviceName produces
   * when a device's first-choice name was already taken at import. On an
   * estate with a wildcard reverse zone that is most of a DHCP range, so
   * without this split those devices could never be shortened at all.
   */
  test("splits an IPv4 address suffix that is the device's own hostname", () => {
    expect(
      splitAddressSuffix({
        name: "kds01.wbhq.com (10.0.0.5)",
        hostname: "10.0.0.5",
      }),
    ).toEqual({ baseName: "kds01.wbhq.com", addressSuffix: " (10.0.0.5)" });
  });

  test("splits an IPv6 address suffix that is the device's own hostname", () => {
    expect(
      splitAddressSuffix({
        name: "kds01.wbhq.com (2001:db8::5)",
        hostname: "2001:db8::5",
      }),
    ).toEqual({ baseName: "kds01.wbhq.com", addressSuffix: " (2001:db8::5)" });
  });

  test("agrees with the suffix the import fallback actually appends", () => {
    const fallback: string = buildFallbackDeviceName(
      { ipAddress: "10.18.166.52", dnsHostname: "dhcp-pool.corp.example.com" },
      { useShortDeviceNames: false },
    );

    expect(
      splitAddressSuffix({ name: fallback, hostname: "10.18.166.52" }),
    ).toEqual({
      baseName: "dhcp-pool.corp.example.com",
      addressSuffix: " (10.18.166.52)",
    });
  });

  test("trims the hostname before composing the suffix it looks for", () => {
    expect(
      splitAddressSuffix({
        name: "kds01.wbhq.com (10.0.0.5)",
        hostname: "  10.0.0.5 ",
      }),
    ).toEqual({ baseName: "kds01.wbhq.com", addressSuffix: " (10.0.0.5)" });
  });

  /*
   * Bracketed text that is NOT the device's address is the operator's own
   * wording — a rack position, an old address from before the device was
   * re-addressed — and is never reinterpreted.
   */
  test("does not split bracketed text that is not the device's hostname", () => {
    expect(
      splitAddressSuffix({ name: "core-sw (rack 4)", hostname: "10.0.0.5" }),
    ).toEqual({ baseName: "core-sw (rack 4)" });

    expect(
      splitAddressSuffix({
        name: "kds01.wbhq.com (10.0.0.9)",
        hostname: "10.0.0.5",
      }),
    ).toEqual({ baseName: "kds01.wbhq.com (10.0.0.9)" });
  });

  test("does not split an address that only starts or contains the hostname", () => {
    expect(
      splitAddressSuffix({
        name: "kds01.wbhq.com (10.0.0.50)",
        hostname: "10.0.0.5",
      }),
    ).toEqual({ baseName: "kds01.wbhq.com (10.0.0.50)" });

    expect(
      splitAddressSuffix({
        name: "kds01.wbhq.com (10.0.0.5) old",
        hostname: "10.0.0.5",
      }),
    ).toEqual({ baseName: "kds01.wbhq.com (10.0.0.5) old" });
  });

  test("requires the separating space the fallback writes", () => {
    expect(
      splitAddressSuffix({
        name: "kds01.wbhq.com(10.0.0.5)",
        hostname: "10.0.0.5",
      }),
    ).toEqual({ baseName: "kds01.wbhq.com(10.0.0.5)" });
  });

  test("removes only one suffix", () => {
    expect(
      splitAddressSuffix({
        name: "kds01.wbhq.com (10.0.0.5) (10.0.0.5)",
        hostname: "10.0.0.5",
      }),
    ).toEqual({
      baseName: "kds01.wbhq.com (10.0.0.5)",
      addressSuffix: " (10.0.0.5)",
    });
  });

  // A name that is nothing BUT the suffix has no base name to shorten.
  test("does not split a name that is only the suffix", () => {
    expect(
      splitAddressSuffix({ name: " (10.0.0.5)", hostname: "10.0.0.5" }),
    ).toEqual({ baseName: " (10.0.0.5)" });
  });

  test("does not split when the device has no usable hostname", () => {
    for (const hostname of [undefined, null, "", "   "]) {
      expect(
        splitAddressSuffix({ name: "kds01.wbhq.com ()", hostname: hostname }),
      ).toEqual({ baseName: "kds01.wbhq.com ()" });
    }

    expect(
      splitAddressSuffix({
        name: "kds01.wbhq.com (10.0.0.5)",
        hostname: 42 as unknown as string,
      }),
    ).toEqual({ baseName: "kds01.wbhq.com (10.0.0.5)" });
  });

  test("leaves a name without brackets untouched", () => {
    expect(
      splitAddressSuffix({ name: "kds01.wbhq.com", hostname: "10.0.0.5" }),
    ).toEqual({ baseName: "kds01.wbhq.com" });
  });
});

describe("planShortDeviceName, one device on its own", () => {
  describe("renaming", () => {
    /*
     * The customer's device, end to end: the short name, and the full name
     * kept as its DNS name because it had none and the name is not its
     * sysName.
     */
    test("renames a fully qualified name and keeps the full name as the DNS name", () => {
      expect(
        planShortDeviceName(
          device({ id: "kds01", name: "wb-0660-kds01.wbhq.com" }),
        ),
      ).toEqual({
        kind: "rename",
        id: "kds01",
        currentName: "wb-0660-kds01.wbhq.com",
        newName: "wb-0660-kds01",
        dnsName: "wb-0660-kds01.wbhq.com",
      });
    });

    test("preserves the case of the current name in both the new name and the DNS name", () => {
      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(device({ name: "WB-0660-KDS01.WbHq.com" })),
      );

      expect(plan.newName).toBe("WB-0660-KDS01");
      expect(plan.dnsName).toBe("WB-0660-KDS01.WbHq.com");
    });

    /*
     * The DNS name is stored NORMALISED: a trailing root dot typed (or
     * imported) into a name is not part of the DNS name a site rule or a
     * search should have to match.
     */
    test("stores the DNS name without a trailing root dot", () => {
      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(device({ name: "kds01.wbhq.com." })),
      );

      expect(plan.newName).toBe("kds01");
      expect(plan.dnsName).toBe("kds01.wbhq.com");
      expect(plan.currentName).toBe("kds01.wbhq.com.");
    });

    test("reports the current name trimmed, and decides on the trimmed name", () => {
      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(device({ name: "  kds01.wbhq.com  " })),
      );

      expect(plan.currentName).toBe("kds01.wbhq.com");
      expect(plan.newName).toBe("kds01");
      expect(plan.dnsName).toBe("kds01.wbhq.com");
    });

    test("produces exactly the name the scan setting would have imported the host under", () => {
      /*
       * The bulk action and the scan setting are two routes to one outcome.
       * A device fixed by the action must end up named exactly as a device
       * imported fresh with short names on — otherwise an estate fixed in
       * bulk and then extended by a new scan would read as two conventions.
       */
      const ptrName: string = "wb-0660-kds01.wbhq.com";

      const imported: string = buildDeviceName(
        { ipAddress: "10.18.167.31", dnsHostname: ptrName },
        { useShortDeviceNames: true },
      );

      expect(
        asRename(planShortDeviceName(device({ name: ptrName }))).newName,
      ).toBe(imported);
    });
  });

  describe("when the full name is NOT kept as the DNS name", () => {
    /*
     * The name IS the sysName: it is the name the device reports about
     * itself, the poller keeps writing it to `sysName`, and nothing is lost
     * by the rename. Calling it a DNS name would be a claim nothing checked.
     */
    test("the name equals the sysName, ignoring case and padding", () => {
      for (const sysName of [
        "core-sw-01.corp.example.com",
        "CORE-SW-01.CORP.EXAMPLE.COM",
        "  Core-Sw-01.corp.example.com ",
      ]) {
        const plan: ShortDeviceNameRename = asRename(
          planShortDeviceName(
            device({ name: "core-sw-01.corp.example.com", sysName: sysName }),
          ),
        );

        expect(plan.newName).toBe("core-sw-01");
        expect(plan).not.toHaveProperty("dnsName");
      }
    });

    test("a different sysName does not stop the full name being kept", () => {
      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(
          device({ name: "kds01.wbhq.com", sysName: "KDS-Controller" }),
        ),
      );

      expect(plan.dnsName).toBe("kds01.wbhq.com");
    });

    test("a blank or missing sysName does not stop the full name being kept", () => {
      for (const sysName of [undefined, null, "", "   "]) {
        expect(
          asRename(
            planShortDeviceName(
              device({ name: "kds01.wbhq.com", sysName: sysName }),
            ),
          ).dnsName,
        ).toBe("kds01.wbhq.com");
      }
    });

    /*
     * A DNS name that is already there came from a PTR record at import and
     * is never overwritten with an inference from the name — even one that
     * looks more complete.
     */
    test("the device already has a DNS name", () => {
      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(
          device({
            name: "kds01.wbhq.com",
            dnsName: "kds01.store-0660.wbhq.com",
          }),
        ),
      );

      expect(plan.newName).toBe("kds01");
      expect(plan).not.toHaveProperty("dnsName");
    });

    test("a blank stored DNS name counts as none", () => {
      for (const dnsName of ["", "   ", null, undefined]) {
        expect(
          asRename(
            planShortDeviceName(
              device({ name: "kds01.wbhq.com", dnsName: dnsName }),
            ),
          ).dnsName,
        ).toBe("kds01.wbhq.com");
      }
    });

    /*
     * AT THE IMPORT CEILING. DiscoveredDeviceBuilder clamps names to 80
     * characters, so an 80-character name may be a cut-off FQDN, and storing
     * half a name as a DNS name would be inventing one. The rename still
     * happens: a first label is at most 63 characters, so it survives any
     * clamp whole.
     */
    test("the name is at the import ceiling, though the rename still happens", () => {
      // Exactly what import produces for an 85-character PTR name.
      const longLabel: string = `hq-fileserver-${"a".repeat(49)}`;
      const clampedImportName: string = `${longLabel}.dc14.corp.exampl`;

      expect(clampedImportName).toHaveLength(MAX_DEVICE_NAME_LENGTH);

      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(device({ name: clampedImportName })),
      );

      expect(plan.newName).toBe(longLabel);
      expect(plan).not.toHaveProperty("dnsName");
    });

    test("one character under the ceiling the full name is kept", () => {
      const name: string = `${"a".repeat(63)}.${"b".repeat(11)}.com`;

      expect(name).toHaveLength(MAX_DEVICE_NAME_LENGTH - 1);

      expect(
        asRename(planShortDeviceName(device({ name: name }))).dnsName,
      ).toBe(name);
    });

    test("over the ceiling, a hand-typed name is renamed without being kept", () => {
      const name: string = `${"a".repeat(63)}.${"b".repeat(30)}.com`;

      expect(name.length).toBeGreaterThan(MAX_DEVICE_NAME_LENGTH);

      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(device({ name: name })),
      );

      expect(plan.newName).toBe("a".repeat(63));
      expect(plan).not.toHaveProperty("dnsName");
    });
  });

  describe("an address-suffixed fallback name", () => {
    /*
     * The one exception to "the name must itself be a DNS name". Without it,
     * every device that hit a name collision at import — every host of a
     * wildcard reverse zone past the first — would be un-shortenable, because
     * the space and brackets are not legal in a DNS label.
     */
    test("becomes the short name with the same address suffix", () => {
      expect(
        planShortDeviceName(
          device({
            id: "pool-2",
            name: "dhcp-pool.corp.example.com (10.18.166.52)",
            hostname: "10.18.166.52",
          }),
        ),
      ).toEqual({
        kind: "rename",
        id: "pool-2",
        currentName: "dhcp-pool.corp.example.com (10.18.166.52)",
        newName: "dhcp-pool (10.18.166.52)",
        dnsName: "dhcp-pool.corp.example.com",
      });
    });

    test("works for an IPv6 hostname too", () => {
      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(
          device({
            name: "kds01.wbhq.com (2001:db8::5)",
            hostname: "2001:db8::5",
          }),
        ),
      );

      expect(plan.newName).toBe("kds01 (2001:db8::5)");
      expect(plan.dnsName).toBe("kds01.wbhq.com");
    });

    /*
     * The DNS name kept is the name WITHOUT the suffix — " (10.0.0.5)" is
     * not part of any DNS name, and a site rule or search would never match
     * the composite.
     */
    test("keeps the DNS name without the suffix", () => {
      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(
          device({ name: "kds01.wbhq.com (10.0.0.5)", hostname: "10.0.0.5" }),
        ),
      );

      expect(plan.dnsName).toBe("kds01.wbhq.com");
      expect(plan.dnsName).not.toContain("(");
    });

    test("compares the suffixed name's base with the sysName", () => {
      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(
          device({
            name: "core-sw-01.corp.example.com (10.0.0.5)",
            hostname: "10.0.0.5",
            sysName: "core-sw-01.corp.example.com",
          }),
        ),
      );

      expect(plan.newName).toBe("core-sw-01 (10.0.0.5)");
      expect(plan).not.toHaveProperty("dnsName");
    });

    /*
     * The address in brackets is not this device's address: it is an old
     * one, or someone's note. Not split, so the whole string — with its space
     * and brackets — is not a fully qualified name, and the device is left
     * alone.
     */
    test("is skipped when the bracketed address is not the device's hostname", () => {
      const plan: ShortDeviceNameSkip = asSkip(
        planShortDeviceName(
          device({ name: "kds01.wbhq.com (10.0.0.9)", hostname: "10.0.0.5" }),
        ),
      );

      expect(plan.reason).toBe(SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE);
      expect(plan.currentName).toBe("kds01.wbhq.com (10.0.0.9)");
    });

    test("is skipped when the bracketed text is not an address at all", () => {
      expect(
        asSkip(
          planShortDeviceName(
            device({ name: "core-sw.corp.example.com (rack 4)" }),
          ),
        ).reason,
      ).toBe(SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE);
    });

    test("is skipped when the base in front of the suffix is not shortenable", () => {
      for (const name of [
        "core-switch (10.18.167.31)",
        "ubuntu-22.04 (10.18.167.31)",
        "10-18-167-31.dhcp.corp.com (10.18.167.31)",
        "Core Switch (10.18.167.31)",
      ]) {
        expect(asSkip(planShortDeviceName(device({ name: name }))).reason).toBe(
          SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE,
        );
      }
    });

    /*
     * The suffix is kept, so the short part is clamped to leave room for it:
     * the whole name must still fit the same ceiling import uses, or the
     * update fails on the slug. The address survives whole — it is what
     * keeps name-twins apart, and cutting it would collide them again.
     */
    test("clamps the short part so the whole name fits the import ceiling", () => {
      const address: string = "2001:0db8:85a3:0000:0000:8a2e:0370:7334";
      const suffix: string = ` (${address})`;
      const longLabel: string = "a".repeat(63);

      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(
          device({
            name: `${longLabel}.example.com${suffix}`,
            hostname: address,
          }),
        ),
      );

      expect(plan.newName).toHaveLength(MAX_DEVICE_NAME_LENGTH);
      expect(plan.newName.endsWith(suffix)).toBe(true);
      expect(plan.newName).toBe(
        `${longLabel.substring(0, MAX_DEVICE_NAME_LENGTH - suffix.length)}${suffix}`,
      );
    });

    test("does not clamp a suffixed short name that already fits", () => {
      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(
          device({
            name: `${"a".repeat(63)}.example.com (10.0.0.5)`,
            hostname: "10.0.0.5",
          }),
        ),
      );

      expect(plan.newName).toBe(`${"a".repeat(63)} (10.0.0.5)`);
      expect(plan.newName.length).toBeLessThan(MAX_DEVICE_NAME_LENGTH);
    });

    test("a plain short name is never clamped, since a label is at most 63 characters", () => {
      const plan: ShortDeviceNameRename = asRename(
        planShortDeviceName(
          device({ name: `${"a".repeat(63)}.${"b".repeat(63)}.example.com` }),
        ),
      );

      expect(plan.newName).toBe("a".repeat(63));
    });
  });

  describe("skipping", () => {
    test("a device with no name", () => {
      for (const name of [undefined, null, "", "   ", "\n\t"]) {
        expect(
          planShortDeviceName(device({ id: "unnamed", name: name })),
        ).toEqual({
          kind: "skip",
          id: "unnamed",
          currentName: "",
          reason: SKIPPED_NO_NAME_MESSAGE,
        });
      }
    });

    /*
     * A row out of an API response is not guaranteed to hold what the model
     * type says. A non-string name is treated as no name rather than being
     * stringified into something that might look shortenable.
     */
    test("a device whose name is not a string", () => {
      for (const name of [
        42,
        true,
        {},
        ["kds01.wbhq.com"],
        {
          toString: (): string => {
            return "kds01.wbhq.com";
          },
        },
      ]) {
        expect(
          asSkip(
            planShortDeviceName(device({ name: name as unknown as string })),
          ).reason,
        ).toBe(SKIPPED_NO_NAME_MESSAGE);
      }
    });

    test("a single-label name, which is already short", () => {
      const plan: ShortDeviceNameSkip = asSkip(
        planShortDeviceName(device({ id: "sw", name: "core-switch-01" })),
      );

      expect(plan).toEqual({
        kind: "skip",
        id: "sw",
        currentName: "core-switch-01",
        reason: SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE,
      });
    });

    test("an address used as a name", () => {
      for (const name of ["10.18.167.31", "2001:db8::5", "10.18.167.31."]) {
        expect(asSkip(planShortDeviceName(device({ name: name }))).reason).toBe(
          SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE,
        );
      }
    });

    test("names the short-name rule refuses", () => {
      for (const name of [
        "Core Switch 1.5",
        "ubuntu-22.04",
        "10-18-167-31.dhcp.corp.com",
        "31.167.18.10.in-addr.arpa",
        "<b>kds01</b>.wbhq.com",
        "café.example.com",
      ]) {
        expect(asSkip(planShortDeviceName(device({ name: name }))).reason).toBe(
          SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE,
        );
      }
    });

    // The messages are shown to the operator verbatim, so they must say why.
    test("the skip messages explain themselves", () => {
      expect(SKIPPED_NO_NAME_MESSAGE).toMatch(/^Skipped: /);
      expect(SKIPPED_NO_NAME_MESSAGE).toContain("no name");
      expect(SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE).toMatch(/^Skipped: /);
      expect(SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE).toContain(
        "fully qualified hostname",
      );
    });
  });

  describe("running twice", () => {
    /*
     * The action is safe to run again over the same selection: whatever the
     * first run wrote is skipped by the second, rather than cut further or
     * "renamed" to itself.
     */
    test("a device renamed by a first run is skipped by the second", () => {
      const before: Array<ShortenableDevice> = [
        device({ id: "a", name: "kds01.wbhq.com" }),
        device({
          id: "b",
          name: "dhcp-pool.corp.example.com (10.18.166.52)",
          hostname: "10.18.166.52",
        }),
      ];

      const after: Array<ShortenableDevice> = before.map(
        (original: ShortenableDevice): ShortenableDevice => {
          const plan: ShortDeviceNameRename = asRename(
            planShortDeviceName(original),
          );

          return {
            ...original,
            name: plan.newName,
            dnsName: plan.dnsName,
          };
        },
      );

      for (const renamed of after) {
        expect(asSkip(planShortDeviceName(renamed)).reason).toBe(
          SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE,
        );
      }
    });
  });

  test("never mutates the device it is given", () => {
    const original: ShortenableDevice = device({
      name: "kds01.wbhq.com (10.18.167.31)",
      sysName: "kds",
    });
    const snapshot: string = JSON.stringify(original);

    planShortDeviceName(original);

    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("buildInBatchCollisionMessage", () => {
  test("names the one other device", () => {
    expect(
      buildInBatchCollisionMessage({
        newName: "kds01",
        otherNames: ["kds01.store-2.example.com"],
      }),
    ).toBe(
      'Skipped: "kds01.store-2.example.com" would also be renamed "kds01", and two devices cannot share a name. Rename them individually.',
    );
  });

  test("names up to three others with no count", () => {
    expect(
      buildInBatchCollisionMessage({
        newName: "kds01",
        otherNames: ["a.x.com", "b.x.com", "c.x.com"],
      }),
    ).toBe(
      'Skipped: "a.x.com", "b.x.com", "c.x.com" would also be renamed "kds01", and two devices cannot share a name. Rename them individually.',
    );
  });

  /*
   * A wildcard zone can put dozens of devices in one group, and a message
   * listing all of them is unreadable in a result table. Three names, then a
   * count.
   */
  test("names three others and counts the rest", () => {
    expect(
      buildInBatchCollisionMessage({
        newName: "kds01",
        otherNames: ["a.x.com", "b.x.com", "c.x.com", "d.x.com"],
      }),
    ).toBe(
      'Skipped: "a.x.com", "b.x.com", "c.x.com" and 1 more would also be renamed "kds01", and two devices cannot share a name. Rename them individually.',
    );

    expect(
      buildInBatchCollisionMessage({
        newName: "kds01",
        otherNames: ["a.x.com", "b.x.com", "c.x.com", "d.x.com", "e.x.com"],
      }),
    ).toContain('"c.x.com" and 2 more would also be renamed "kds01"');
  });
});

describe("planShortDeviceNames, a whole selection", () => {
  test("an empty selection plans nothing", () => {
    expect(planShortDeviceNames([])).toEqual([]);
  });

  test("plans every device of a clean selection exactly as it would alone", () => {
    const devices: Array<ShortenableDevice> = [
      device({ id: "a", name: "kds01.wbhq.com" }),
      device({ id: "b", name: "kds02.wbhq.com", sysName: "kds02.wbhq.com" }),
      device({ id: "c", name: "core-switch" }),
    ];

    expect(planShortDeviceNames(devices)).toEqual(
      devices.map((each: ShortenableDevice): ShortDeviceNamePlan => {
        return planShortDeviceName(each);
      }),
    );
  });

  /*
   * The result table lists devices in the order they were selected, and the
   * hook pairs each plan with its device by position as well as by id.
   */
  test("returns one plan per device, in the order given", () => {
    const devices: Array<ShortenableDevice> = [
      device({ id: "1", name: "kds01.store-1.example.com" }),
      device({ id: "2", name: "core-switch" }),
      device({ id: "3", name: "pos01.wbhq.com" }),
      device({ id: "4", name: "" }),
      device({ id: "5", name: "KDS01.store-2.example.com" }),
      device({ id: "6", name: "10.0.0.6" }),
    ];

    const plans: Array<ShortDeviceNamePlan> = planShortDeviceNames(devices);

    expect(
      plans.map((plan: ShortDeviceNamePlan): string => {
        return plan.id;
      }),
    ).toEqual(["1", "2", "3", "4", "5", "6"]);

    expect(
      plans.map((plan: ShortDeviceNamePlan): string => {
        return plan.kind;
      }),
    ).toEqual(["skip", "skip", "rename", "skip", "skip", "skip"]);
  });

  describe("devices that would share a name", () => {
    /*
     * Two stores, one hostname convention. Renaming the first and refusing
     * the second would make the outcome depend on how the table happened to
     * be sorted, and the device that kept its long name would be an accident.
     * Both are skipped, each naming the other, so the operator knows exactly
     * which pair to rename by hand.
     */
    test("skips both members of a pair, each naming the other", () => {
      const plans: Array<ShortDeviceNamePlan> = planShortDeviceNames([
        device({ id: "store-1", name: "kds01.store-1.example.com" }),
        device({ id: "store-2", name: "kds01.store-2.example.com" }),
      ]);

      expect(plans).toEqual([
        {
          kind: "skip",
          id: "store-1",
          currentName: "kds01.store-1.example.com",
          reason: buildInBatchCollisionMessage({
            newName: "kds01",
            otherNames: ["kds01.store-2.example.com"],
          }),
        },
        {
          kind: "skip",
          id: "store-2",
          currentName: "kds01.store-2.example.com",
          reason: buildInBatchCollisionMessage({
            newName: "kds01",
            otherNames: ["kds01.store-1.example.com"],
          }),
        },
      ]);
    });

    /*
     * Device name uniqueness ignores case, so "kds01" and "KDS01" ARE the
     * same name to the database, and a group that compared case-sensitively
     * would let both through only for the second update to fail.
     */
    test("groups names that differ only in case", () => {
      const plans: Array<ShortDeviceNamePlan> = planShortDeviceNames([
        device({ id: "lower", name: "kds01.store-1.example.com" }),
        device({ id: "upper", name: "KDS01.STORE-2.EXAMPLE.COM" }),
      ]);

      const lower: ShortDeviceNameSkip = asSkip(plans[0]);
      const upper: ShortDeviceNameSkip = asSkip(plans[1]);

      // Each message quotes the device's OWN would-be name.
      expect(lower.reason).toContain('renamed "kds01"');
      expect(lower.reason).toContain('"KDS01.STORE-2.EXAMPLE.COM"');
      expect(upper.reason).toContain('renamed "KDS01"');
      expect(upper.reason).toContain('"kds01.store-1.example.com"');
    });

    test("never names a device in its own message", () => {
      const plans: Array<ShortDeviceNamePlan> = planShortDeviceNames([
        device({ id: "1", name: "kds01.store-1.example.com" }),
        device({ id: "2", name: "kds01.store-2.example.com" }),
        device({ id: "3", name: "kds01.store-3.example.com" }),
      ]);

      for (const plan of plans) {
        const skip: ShortDeviceNameSkip = asSkip(plan);
        expect(skip.reason).not.toContain(`"${skip.currentName}"`);
      }

      expect(asSkip(plans[0]).reason).toContain(
        '"kds01.store-2.example.com", "kds01.store-3.example.com"',
      );
    });

    test("names three others and counts the rest in a large group", () => {
      const devices: Array<ShortenableDevice> = [1, 2, 3, 4, 5, 6].map(
        (store: number): ShortenableDevice => {
          return device({
            id: `store-${store}`,
            name: `kds01.store-${store}.example.com`,
          });
        },
      );

      const plans: Array<ShortDeviceNamePlan> = planShortDeviceNames(devices);

      expect(plans).toHaveLength(6);

      for (const plan of plans) {
        expect(asSkip(plan).reason).toContain(
          " and 2 more would also be renamed",
        );
      }

      expect(asSkip(plans[0]).reason).toBe(
        buildInBatchCollisionMessage({
          newName: "kds01",
          otherNames: [
            "kds01.store-2.example.com",
            "kds01.store-3.example.com",
            "kds01.store-4.example.com",
            "kds01.store-5.example.com",
            "kds01.store-6.example.com",
          ],
        }),
      );
    });

    /*
     * One group's collision is that group's problem. The rest of the
     * selection is renamed as normal, or the operator would have to find and
     * deselect a single pair to fix a thousand devices.
     */
    test("renames the rest of the selection around a collision group", () => {
      const plans: Array<ShortDeviceNamePlan> = planShortDeviceNames([
        device({ id: "a", name: "kds01.store-1.example.com" }),
        device({ id: "b", name: "pos01.store-1.example.com" }),
        device({ id: "c", name: "kds01.store-2.example.com" }),
        device({ id: "d", name: "printer.store-2.example.com" }),
      ]);

      expect(asSkip(plans[0]).id).toBe("a");
      expect(asRename(plans[1]).newName).toBe("pos01");
      expect(asSkip(plans[2]).id).toBe("c");
      expect(asRename(plans[3]).newName).toBe("printer");
    });

    test("keeps two groups apart", () => {
      const plans: Array<ShortDeviceNamePlan> = planShortDeviceNames([
        device({ id: "k1", name: "kds01.store-1.example.com" }),
        device({ id: "p1", name: "pos01.store-1.example.com" }),
        device({ id: "k2", name: "kds01.store-2.example.com" }),
        device({ id: "p2", name: "pos01.store-2.example.com" }),
      ]);

      expect(asSkip(plans[0]).reason).toContain('"kds01.store-2.example.com"');
      expect(asSkip(plans[0]).reason).not.toContain("pos01");
      expect(asSkip(plans[1]).reason).toContain('"pos01.store-2.example.com"');
      expect(asSkip(plans[1]).reason).not.toContain("kds01");
    });

    /*
     * Groups are formed on the FINAL name. An address-suffixed fallback keeps
     * its suffix, so "kds01 (10.0.0.5)" and "kds01" are different names and
     * both are renamed.
     */
    test("does not group a suffixed name with the plain name it contains", () => {
      const plans: Array<ShortDeviceNamePlan> = planShortDeviceNames([
        device({
          id: "fallback",
          name: "kds01.store-1.example.com (10.0.0.5)",
          hostname: "10.0.0.5",
        }),
        device({ id: "plain", name: "kds01.store-2.example.com" }),
      ]);

      expect(asRename(plans[0]).newName).toBe("kds01 (10.0.0.5)");
      expect(asRename(plans[1]).newName).toBe("kds01");
    });

    /*
     * Only would-be RENAMES form groups. A device that is skipped for its
     * own reason keeps that reason rather than being reported as a
     * collision, and a device whose current name already equals someone
     * else's short name is not visible here at all — that clash is with a
     * name that already exists, which the action checks against the server.
     */
    test("a skipped device is neither grouped nor a reason to skip others", () => {
      const plans: Array<ShortDeviceNamePlan> = planShortDeviceNames([
        device({ id: "short", name: "kds01" }),
        device({ id: "long", name: "kds01.wbhq.com" }),
        device({ id: "twin-a", name: "core-switch" }),
        device({ id: "twin-b", name: "core-switch" }),
      ]);

      expect(asSkip(plans[0]).reason).toBe(SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE);
      expect(asRename(plans[1]).newName).toBe("kds01");
      expect(asSkip(plans[2]).reason).toBe(SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE);
      expect(asSkip(plans[3]).reason).toBe(SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE);
    });

    // The single-device planner cannot see the batch, by design.
    test("each member of a group would be renamed if planned alone", () => {
      const pair: Array<ShortenableDevice> = [
        device({ id: "1", name: "kds01.store-1.example.com" }),
        device({ id: "2", name: "kds01.store-2.example.com" }),
      ];

      for (const member of pair) {
        expect(asRename(planShortDeviceName(member)).newName).toBe("kds01");
      }
    });
  });

  test("never mutates the selection it is given", () => {
    const devices: Array<ShortenableDevice> = [
      device({ id: "1", name: "kds01.store-1.example.com" }),
      device({ id: "2", name: "kds01.store-2.example.com" }),
      device({ id: "3", name: "pos01.wbhq.com", dnsName: null }),
    ];
    const snapshot: string = JSON.stringify(devices);

    planShortDeviceNames(devices);

    expect(JSON.stringify(devices)).toBe(snapshot);
  });

  /*
   * The planner and getShortHostname must agree on every device, so the
   * confirm dialog's examples, the scan setting and the action cannot
   * disagree about what "short" means.
   */
  test("every rename's short part is exactly getShortHostname of the base name", () => {
    const names: Array<string> = [
      "wb-0660-kds01.wbhq.com",
      "Core-SW-01.Corp.Example.com.",
      "pos_register_01.store.example.com",
      "kds01.example.xn--p1ai",
    ];

    const plans: Array<ShortDeviceNamePlan> = planShortDeviceNames(
      names.map((name: string, index: number): ShortenableDevice => {
        return device({ id: String(index), name: name });
      }),
    );

    names.forEach((name: string, index: number): void => {
      expect(asRename(plans[index]).newName).toBe(getShortHostname(name));
    });
  });
});
