import { describe, expect, test } from "@jest/globals";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
  SnmpVendorTemplates,
} from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import SnmpOid from "../../../Types/Monitor/SnmpMonitor/SnmpOid";

/*
 * SnmpVendorTemplateUtil is the device-fingerprinting brain for Network
 * Device monitors: it parses sysObjectID into an IANA enterprise number,
 * derives a vendor display name from it, routes to a vendor OID template,
 * and merges template OIDs into a monitor without duplicating rows. These
 * tests pin each of those behaviors against real-world sysObjectID values.
 */

// Real sysObjectID values as devices actually report them.
const CISCO_SYS_OBJECT_ID: string = "1.3.6.1.4.1.9.1.1208"; // Catalyst 2960X
const MIKROTIK_SYS_OBJECT_ID: string = "1.3.6.1.4.1.14988.1";
const UBIQUITI_SYS_OBJECT_ID: string = "1.3.6.1.4.1.41112.1.4";
const JUNIPER_SYS_OBJECT_ID: string = "1.3.6.1.4.1.2636.1.1.1.2.29"; // EX2200
const ARISTA_SYS_OBJECT_ID: string = "1.3.6.1.4.1.30065.1.3011.7048";
const HPE_SYS_OBJECT_ID: string = "1.3.6.1.4.1.11.2.3.7.11.87"; // ProCurve
const FORTINET_SYS_OBJECT_ID: string = "1.3.6.1.4.1.12356.101.1.60";
const PALO_ALTO_SYS_OBJECT_ID: string = "1.3.6.1.4.1.25461.2.3.36";
const HUAWEI_SYS_OBJECT_ID: string = "1.3.6.1.4.1.2011.2.23.92";
const FORCE10_SYS_OBJECT_ID: string = "1.3.6.1.4.1.6027.1.3.4"; // S-series
// Ubiquiti EdgeSwitch firmware reports Broadcom's FASTPATH arc, not 41112.
const EDGESWITCH_SYS_OBJECT_ID: string = "1.3.6.1.4.1.4413";
const DELL_SYS_OBJECT_ID: string = "1.3.6.1.4.1.674.10895.3031"; // PowerConnect

describe("SnmpVendorTemplateUtil.getEnterpriseNumber", () => {
  test("extracts the enterprise number from a Cisco sysObjectID", () => {
    expect(
      SnmpVendorTemplateUtil.getEnterpriseNumber(CISCO_SYS_OBJECT_ID),
    ).toBe(9);
  });

  test("accepts the leading-dot form some agents report", () => {
    expect(
      SnmpVendorTemplateUtil.getEnterpriseNumber(`.${CISCO_SYS_OBJECT_ID}`),
    ).toBe(9);
  });

  test("tolerates surrounding whitespace", () => {
    expect(
      SnmpVendorTemplateUtil.getEnterpriseNumber(
        `  ${MIKROTIK_SYS_OBJECT_ID}  `,
      ),
    ).toBe(14988);
  });

  test("parses a bare enterprise arc with no product suffix", () => {
    expect(
      SnmpVendorTemplateUtil.getEnterpriseNumber("1.3.6.1.4.1.41112"),
    ).toBe(41112);
  });

  test("returns undefined for a mib-2 OID outside the enterprises arc", () => {
    // Some appliances report sysObjectID values under 1.3.6.1.2.1 (mib-2).
    expect(
      SnmpVendorTemplateUtil.getEnterpriseNumber("1.3.6.1.2.1.1"),
    ).toBeUndefined();
  });

  test("returns undefined for garbage that is not an OID", () => {
    expect(
      SnmpVendorTemplateUtil.getEnterpriseNumber("not-an-oid"),
    ).toBeUndefined();
  });

  test("returns undefined for the enterprises prefix with nothing after it", () => {
    expect(
      SnmpVendorTemplateUtil.getEnterpriseNumber("1.3.6.1.4.1."),
    ).toBeUndefined();
  });

  test("returns undefined for an empty string", () => {
    expect(SnmpVendorTemplateUtil.getEnterpriseNumber("")).toBeUndefined();
  });

  test("returns undefined for undefined", () => {
    expect(
      SnmpVendorTemplateUtil.getEnterpriseNumber(undefined),
    ).toBeUndefined();
  });
});

describe("SnmpVendorTemplateUtil.getVendorNameBySysObjectId", () => {
  test.each([
    [CISCO_SYS_OBJECT_ID, "Cisco"],
    [MIKROTIK_SYS_OBJECT_ID, "MikroTik"],
    [UBIQUITI_SYS_OBJECT_ID, "Ubiquiti"],
    [JUNIPER_SYS_OBJECT_ID, "Juniper"],
    [ARISTA_SYS_OBJECT_ID, "Arista"],
    [HPE_SYS_OBJECT_ID, "HPE"],
    [FORTINET_SYS_OBJECT_ID, "Fortinet"],
    [PALO_ALTO_SYS_OBJECT_ID, "Palo Alto Networks"],
    [HUAWEI_SYS_OBJECT_ID, "Huawei"],
    [FORCE10_SYS_OBJECT_ID, "Force10"],
    [EDGESWITCH_SYS_OBJECT_ID, "Broadcom"],
    [DELL_SYS_OBJECT_ID, "Dell"],
  ])("%s resolves to vendor %s", (sysObjectId: string, vendor: string) => {
    expect(SnmpVendorTemplateUtil.getVendorNameBySysObjectId(sysObjectId)).toBe(
      vendor,
    );
  });

  test("an enterprise number outside the map leaves the vendor blank", () => {
    expect(
      SnmpVendorTemplateUtil.getVendorNameBySysObjectId(
        "1.3.6.1.4.1.424242.1.1",
      ),
    ).toBeUndefined();
  });

  test("a non-enterprise OID leaves the vendor blank", () => {
    expect(
      SnmpVendorTemplateUtil.getVendorNameBySysObjectId("1.3.6.1.2.1.1"),
    ).toBeUndefined();
  });

  test("undefined input leaves the vendor blank", () => {
    expect(
      SnmpVendorTemplateUtil.getVendorNameBySysObjectId(undefined),
    ).toBeUndefined();
  });
});

describe("SnmpVendorTemplateUtil.matchBySysObjectId", () => {
  test("a Cisco device is routed to the cisco-ios template", () => {
    const template: SnmpVendorTemplate | undefined =
      SnmpVendorTemplateUtil.matchBySysObjectId(CISCO_SYS_OBJECT_ID);

    expect(template?.id).toBe("cisco-ios");
    expect(template).toBe(SnmpVendorTemplateUtil.getById("cisco-ios"));
  });

  test("a MikroTik device is routed to the mikrotik-routeros template", () => {
    expect(
      SnmpVendorTemplateUtil.matchBySysObjectId(MIKROTIK_SYS_OBJECT_ID)?.id,
    ).toBe("mikrotik-routeros");
  });

  test("a Ubiquiti device is routed to the ubiquiti-edgeos template", () => {
    expect(
      SnmpVendorTemplateUtil.matchBySysObjectId(UBIQUITI_SYS_OBJECT_ID)?.id,
    ).toBe("ubiquiti-edgeos");
  });

  test.each([
    [JUNIPER_SYS_OBJECT_ID, "juniper-junos"],
    [ARISTA_SYS_OBJECT_ID, "arista-eos"],
    [HPE_SYS_OBJECT_ID, "hpe-procurve"],
    [FORTINET_SYS_OBJECT_ID, "fortinet-fortigate"],
    [PALO_ALTO_SYS_OBJECT_ID, "paloalto-panos"],
    [HUAWEI_SYS_OBJECT_ID, "huawei-vrp"],
    [FORCE10_SYS_OBJECT_ID, "dell-force10"],
    /*
     * EdgeSwitch reports Broadcom's FASTPATH arc but still gets the
     * standard-MIB Ubiquiti template.
     */
    [EDGESWITCH_SYS_OBJECT_ID, "ubiquiti-edgeos"],
  ])(
    "%s is routed to the %s template",
    (sysObjectId: string, templateId: string) => {
      const template: SnmpVendorTemplate | undefined =
        SnmpVendorTemplateUtil.matchBySysObjectId(sysObjectId);

      expect(template?.id).toBe(templateId);
      expect(template).toBe(SnmpVendorTemplateUtil.getById(templateId));
    },
  );

  /*
   * Dell enterprise 674 (PowerConnect and friends) has a vendor name in the
   * enterprise map but no vendor-specific template — only Force10 (6027) is
   * routed. The match must come back empty so callers fall back to the
   * generic Host Resources template rather than mislabeling the device.
   */
  test("a Dell PowerConnect device has a vendor name but no template", () => {
    expect(
      SnmpVendorTemplateUtil.getVendorNameBySysObjectId(DELL_SYS_OBJECT_ID),
    ).toBe("Dell");
    expect(
      SnmpVendorTemplateUtil.matchBySysObjectId(DELL_SYS_OBJECT_ID),
    ).toBeUndefined();
  });

  test("an unknown enterprise matches no template", () => {
    expect(
      SnmpVendorTemplateUtil.matchBySysObjectId("1.3.6.1.4.1.424242.1"),
    ).toBeUndefined();
  });

  test("undefined input matches no template", () => {
    expect(
      SnmpVendorTemplateUtil.matchBySysObjectId(undefined),
    ).toBeUndefined();
  });
});

describe("SnmpVendorTemplateUtil.getAll / getById", () => {
  test("every shipped template is retrievable by its id", () => {
    for (const template of SnmpVendorTemplates) {
      expect(SnmpVendorTemplateUtil.getById(template.id)).toBe(template);
    }
  });

  test("an unknown template id returns undefined", () => {
    expect(SnmpVendorTemplateUtil.getById("no-such-template")).toBeUndefined();
  });
});

/*
 * Catalog hygiene: every shipped template must contain OIDs a poller can
 * actually GET (dotted-numeric instance OIDs, no symbolic names or trailing
 * dots) and enough metadata for the dashboard to render a useful row.
 */
describe("SnmpVendorTemplates catalog", () => {
  // Absolute numeric OID: digits separated by single dots, at least two arcs.
  const OID_REGEX: RegExp = /^[0-9]+(\.[0-9]+)+$/;

  test("template ids are unique", () => {
    const ids: Array<string> = SnmpVendorTemplates.map(
      (template: SnmpVendorTemplate) => {
        return template.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  test.each(
    SnmpVendorTemplates.map((template: SnmpVendorTemplate) => {
      return [template.id, template] as [string, SnmpVendorTemplate];
    }),
  )(
    "%s has valid OIDs and non-empty metadata",
    (_id: string, template: SnmpVendorTemplate) => {
      expect(template.label.trim()).not.toHaveLength(0);
      expect(template.description.trim()).not.toHaveLength(0);
      expect(template.oids.length).toBeGreaterThan(0);

      for (const oid of template.oids) {
        expect(oid.oid).toMatch(OID_REGEX);
        expect(oid.name?.trim()).toBeTruthy();
        expect(oid.description?.trim()).toBeTruthy();
      }

      // No template should list the same OID twice.
      const values: Array<string> = template.oids.map((oid: SnmpOid) => {
        return oid.oid;
      });
      expect(new Set(values).size).toBe(values.length);
    },
  );

  /*
   * The Cisco env-mon states are enums where 1 = normal — users build
   * "not equal to 1" alert criteria on them, so the template must keep
   * shipping these exact instance OIDs.
   */
  test("the Cisco template includes fan and PSU state OIDs", () => {
    const cisco: SnmpVendorTemplate | undefined =
      SnmpVendorTemplateUtil.getById("cisco-ios");

    const oidValues: Array<string> = (cisco?.oids || []).map((oid: SnmpOid) => {
      return oid.oid;
    });

    expect(oidValues).toContain("1.3.6.1.4.1.9.9.13.1.4.1.3.1"); // fan state
    expect(oidValues).toContain("1.3.6.1.4.1.9.9.13.1.5.1.3.1"); // PSU state
  });
});

describe("SnmpVendorTemplateUtil.mergeOids", () => {
  function oidValues(oids: Array<SnmpOid>): Array<string> {
    return oids.map((oid: SnmpOid) => {
      return oid.oid;
    });
  }

  test("merging into an empty list yields the template's OIDs", () => {
    const merged: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
      [],
      "cisco-ios",
    );

    expect(merged).toEqual(SnmpVendorTemplateUtil.getById("cisco-ios")!.oids);
  });

  test("applying the same template twice never duplicates rows", () => {
    const once: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
      [],
      "cisco-ios",
    );
    const twice: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
      once,
      "cisco-ios",
    );

    expect(twice).toEqual(once);
    expect(new Set(oidValues(twice)).size).toBe(twice.length);
  });

  /*
   * MikroTik and Ubiquiti both start with hrProcessorLoad
   * (1.3.6.1.2.1.25.3.3.1.2.1) — applying both templates must produce that
   * OID exactly once.
   */
  test("overlapping templates share OIDs without duplicating them", () => {
    const mikrotik: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
      [],
      "mikrotik-routeros",
    );
    const both: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
      mikrotik,
      "ubiquiti-edgeos",
    );

    const cpuLoadRows: Array<SnmpOid> = both.filter((oid: SnmpOid) => {
      return oid.oid === "1.3.6.1.2.1.25.3.3.1.2.1";
    });

    expect(cpuLoadRows).toHaveLength(1);
    expect(new Set(oidValues(both)).size).toBe(both.length);
  });

  test("a user's existing row wins over the template's copy of the same OID", () => {
    const custom: SnmpOid = {
      oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
      name: "My Custom CPU Name",
    };

    const merged: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
      [custom],
      "cisco-ios",
    );

    const cpuRows: Array<SnmpOid> = merged.filter((oid: SnmpOid) => {
      return oid.oid === custom.oid;
    });

    expect(cpuRows).toHaveLength(1);
    expect(cpuRows[0]?.name).toBe("My Custom CPU Name");
  });

  test("an unknown template id returns the existing list unchanged", () => {
    const existing: Array<SnmpOid> = [
      { oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr" },
    ];

    expect(
      SnmpVendorTemplateUtil.mergeOids(existing, "no-such-template"),
    ).toEqual(existing);
  });

  test("merging does not mutate the caller's array", () => {
    const existing: Array<SnmpOid> = [
      { oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr" },
    ];

    SnmpVendorTemplateUtil.mergeOids(existing, "cisco-ios");

    expect(existing).toHaveLength(1);
  });
});
