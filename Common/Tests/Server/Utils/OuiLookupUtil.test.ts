import OuiLookupUtil from "../../../Server/Utils/Monitor/OuiLookupUtil";

/*
 * The known-prefix assertions pin real rows from the bundled
 * Data/OuiVendors.json (generated from the IEEE MA-L registry — see the
 * header comment in OuiLookupUtil). If a registry refresh renames an
 * organization, update the expected strings to the new registry value.
 */
describe("OuiLookupUtil.lookupVendor", () => {
  it("resolves the classic Cisco OUI 00:00:0c", () => {
    expect(OuiLookupUtil.lookupVendor("00:00:0c:12:34:56")).toBe(
      "Cisco Systems, Inc",
    );
  });

  it("resolves the Raspberry Pi OUI b8:27:eb", () => {
    expect(OuiLookupUtil.lookupVendor("b8:27:eb:aa:bb:cc")).toBe(
      "Raspberry Pi Foundation",
    );
  });

  it("resolves the Ubiquiti OUI f0:9f:c2", () => {
    expect(OuiLookupUtil.lookupVendor("f0:9f:c2:00:11:22")).toBe(
      "Ubiquiti Inc",
    );
  });

  it("accepts every MAC spelling normalizeMac understands", () => {
    expect(OuiLookupUtil.lookupVendor("00-00-0C-12-34-56")).toBe(
      "Cisco Systems, Inc",
    );
    expect(OuiLookupUtil.lookupVendor("0000.0c12.3456")).toBe(
      "Cisco Systems, Inc",
    );
    expect(OuiLookupUtil.lookupVendor("00000c123456")).toBe(
      "Cisco Systems, Inc",
    );
    expect(OuiLookupUtil.lookupVendor("0x00000C123456")).toBe(
      "Cisco Systems, Inc",
    );
  });

  it("returns undefined for OUIs outside the filtered registry", () => {
    // Locally administered — never in the IEEE registry.
    expect(OuiLookupUtil.lookupVendor("02:00:00:00:00:01")).toBeUndefined();
  });

  it("returns undefined for malformed MACs", () => {
    expect(OuiLookupUtil.lookupVendor(undefined)).toBeUndefined();
    expect(OuiLookupUtil.lookupVendor("")).toBeUndefined();
    expect(OuiLookupUtil.lookupVendor("00:00:0c")).toBeUndefined();
    expect(OuiLookupUtil.lookupVendor("not-a-mac")).toBeUndefined();
    expect(OuiLookupUtil.lookupVendor("gg:hh:ii:jj:kk:ll")).toBeUndefined();
  });

  it("never returns a value for a bare OUI prefix (needs a full MAC)", () => {
    expect(OuiLookupUtil.lookupVendor("00000c")).toBeUndefined();
  });
});
