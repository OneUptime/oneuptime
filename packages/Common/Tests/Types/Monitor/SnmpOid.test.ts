import SnmpOid, {
  SnmpOidTemplates,
} from "../../../Types/Monitor/SnmpMonitor/SnmpOid";

/*
 * The common-OID list is shipped as the starting point an operator picks from
 * when building an SNMP monitor, so a typo'd OID or a duplicated entry is a
 * silently wrong default. These invariants keep the list honest.
 */
describe("SnmpOidTemplates.getCommonOids", () => {
  const oids: Array<SnmpOid> = SnmpOidTemplates.getCommonOids();

  test("returns a non-empty list", () => {
    expect(oids.length).toBeGreaterThan(0);
  });

  test("every entry is a dotted numeric OID", () => {
    for (const entry of oids) {
      expect(entry.oid).toMatch(/^\d+(\.\d+)+$/);
    }
  });

  test("every entry carries a human name and description", () => {
    for (const entry of oids) {
      expect(entry.name && entry.name.trim().length).toBeTruthy();
      expect(entry.description && entry.description.trim().length).toBeTruthy();
    }
  });

  test("OIDs are unique", () => {
    const seen: Set<string> = new Set<string>(
      oids.map((entry: SnmpOid) => {
        return entry.oid;
      }),
    );

    expect(seen.size).toBe(oids.length);
  });

  test("names are unique", () => {
    const names: Array<string> = oids.map((entry: SnmpOid) => {
      return entry.name as string;
    });

    expect(new Set<string>(names).size).toBe(names.length);
  });

  test("includes the system-description OID every SNMP agent exposes", () => {
    const sysDescr: SnmpOid | undefined = oids.find((entry: SnmpOid) => {
      return entry.name === "sysDescr";
    });

    expect(sysDescr?.oid).toBe("1.3.6.1.2.1.1.1.0");
  });

  test("returns a fresh array each call (callers may mutate their copy)", () => {
    expect(SnmpOidTemplates.getCommonOids()).not.toBe(
      SnmpOidTemplates.getCommonOids(),
    );
    expect(SnmpOidTemplates.getCommonOids()).toEqual(
      SnmpOidTemplates.getCommonOids(),
    );
  });
});
