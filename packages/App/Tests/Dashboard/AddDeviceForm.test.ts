import { describe, expect, test } from "@jest/globals";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import IconProp from "Common/Types/Icon/IconProp";
import {
  ADD_DEVICE_CREATE_VERB,
  ADD_DEVICE_HOSTNAME_DESCRIPTION,
  ADD_DEVICE_MORE_FIELDS,
  ADD_DEVICE_NAME_DESCRIPTION,
  ADD_DEVICE_NAME_PLACEHOLDER,
  ADD_DEVICE_PING_MONITOR_DESCRIPTION,
  ADD_DEVICE_PING_MONITOR_TITLE,
  ADD_DEVICE_PLURAL_NAME,
  ADD_DEVICE_PROBE_DESCRIPTION,
  ADD_DEVICE_SINGULAR_NAME,
  ADD_DEVICE_SITE_DESCRIPTION,
  ADD_DEVICE_SNMP_NOT_SET_SUMMARY,
  ADD_DEVICE_SNMP_SECTION,
  ADD_DEVICE_SNMP_SECTION_ID,
  getAddDeviceSnmpSummary,
  getDeviceNameForCreate,
  hasSnmpCredentials,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/AddDeviceForm";

/*
 * The Add Device form's own logic and words (AddDeviceForm.ts): the SNMP
 * fold, what it says while nothing is set, when a device counts as having
 * credentials, and the name a device gets when none is typed. The form
 * itself is rendered in Common/Tests/App/Dashboard/NetworkAddDeviceDialog.test.tsx.
 */

function values(record: Record<string, unknown>): FormValues<NetworkDevice> {
  return record as FormValues<NetworkDevice>;
}

describe("hasSnmpCredentials", () => {
  test("nothing typed is no credentials", () => {
    expect(hasSnmpCredentials(values({}))).toBe(false);
    expect(hasSnmpCredentials(undefined)).toBe(false);
    expect(hasSnmpCredentials(null)).toBe(false);
  });

  /*
   * The version is not a credential: it starts on V2c for every device, so
   * counting it would claim every new device is walked over SNMP.
   */
  test("the version alone is not credentials", () => {
    expect(hasSnmpCredentials(values({ snmpVersion: "V2c" }))).toBe(false);
    expect(hasSnmpCredentials(values({ snmpVersion: "V1" }))).toBe(false);
    expect(hasSnmpCredentials(values({ snmpVersion: "V3" }))).toBe(false);
  });

  test("a port alone is not credentials", () => {
    expect(hasSnmpCredentials(values({ snmpPort: 1161 }))).toBe(false);
  });

  test("a v1/v2c community string is", () => {
    expect(
      hasSnmpCredentials(
        values({ snmpVersion: "V2c", snmpCommunityString: "public" }),
      ),
    ).toBe(true);
    expect(
      hasSnmpCredentials(
        values({ snmpVersion: "V1", snmpCommunityString: "private" }),
      ),
    ).toBe(true);
  });

  test("a community string with no version picked counts (the version defaults to V2c)", () => {
    expect(hasSnmpCredentials(values({ snmpCommunityString: "public" }))).toBe(
      true,
    );
  });

  test("a blank community string is not", () => {
    expect(
      hasSnmpCredentials(
        values({ snmpVersion: "V2c", snmpCommunityString: "   " }),
      ),
    ).toBe(false);
  });

  /*
   * The probe keys v3 on the username, and ignores a community string on a
   * v3 device - so does this.
   */
  test("on V3, the username is what counts", () => {
    expect(
      hasSnmpCredentials(values({ snmpVersion: "V3", snmpV3Username: "mon" })),
    ).toBe(true);
    expect(
      hasSnmpCredentials(
        values({ snmpVersion: "V3", snmpCommunityString: "public" }),
      ),
    ).toBe(false);
    expect(
      hasSnmpCredentials(values({ snmpVersion: "V3", snmpV3Username: " " })),
    ).toBe(false);
  });

  test("the version is read in either spelling", () => {
    expect(
      hasSnmpCredentials(values({ snmpVersion: "3", snmpV3Username: "mon" })),
    ).toBe(true);
    expect(
      hasSnmpCredentials(values({ snmpVersion: "v3", snmpV3Username: "mon" })),
    ).toBe(true);
  });

  test("a saved credential profile is credentials, whatever else is set", () => {
    const profileId: string = "aaaaaaaa-0000-4000-8000-000000000001";

    expect(
      hasSnmpCredentials(values({ snmpCredentialProfile: profileId })),
    ).toBe(true);
    // Picked as a dropdown option, or as the related record.
    expect(
      hasSnmpCredentials(
        values({ snmpCredentialProfile: { label: "Core", value: profileId } }),
      ),
    ).toBe(true);
    expect(
      hasSnmpCredentials(values({ snmpCredentialProfile: { _id: profileId } })),
    ).toBe(true);
  });

  test("a cleared profile is not", () => {
    expect(hasSnmpCredentials(values({ snmpCredentialProfile: "" }))).toBe(
      false,
    );
    expect(hasSnmpCredentials(values({ snmpCredentialProfile: null }))).toBe(
      false,
    );
  });
});

describe("the SNMP fold's summary", () => {
  test("says what leaving it alone means, while nothing is set", () => {
    expect(getAddDeviceSnmpSummary(values({}))).toEqual([
      ADD_DEVICE_SNMP_NOT_SET_SUMMARY,
    ]);
  });

  test("says nothing once credentials are set, so the set fields show instead", () => {
    expect(
      getAddDeviceSnmpSummary(values({ snmpCommunityString: "public" })),
    ).toBeUndefined();
  });

  test("still speaks when V3 is picked but no user is typed yet", () => {
    expect(getAddDeviceSnmpSummary(values({ snmpVersion: "V3" }))).toEqual([
      ADD_DEVICE_SNMP_NOT_SET_SUMMARY,
    ]);
  });

  test("the sentence says the device is pinged without it, and what SNMP adds", () => {
    expect(ADD_DEVICE_SNMP_NOT_SET_SUMMARY).toContain("Optional");
    expect(ADD_DEVICE_SNMP_NOT_SET_SUMMARY).toContain("pinged");
    expect(ADD_DEVICE_SNMP_NOT_SET_SUMMARY).toContain("community string");
    expect(ADD_DEVICE_SNMP_NOT_SET_SUMMARY).toContain("interfaces");
  });
});

describe("the SNMP section", () => {
  test("is a fold of its own, titled SNMP, with the key icon", () => {
    expect(ADD_DEVICE_SNMP_SECTION.id).toBe(ADD_DEVICE_SNMP_SECTION_ID);
    expect(ADD_DEVICE_SNMP_SECTION.title).toBe("SNMP");
    expect(ADD_DEVICE_SNMP_SECTION.icon).toBe(IconProp.Key);
  });

  /*
   * Never opens by itself on the create form: SNMP is the optional upgrade,
   * and a fold that opened would put nine questions back on the page.
   */
  test("starts folded, and stays folded when something in it is set", () => {
    expect(ADD_DEVICE_SNMP_SECTION.openWhenConfigured).toBe(false);
  });

  test("counts as configured exactly when the device has credentials", () => {
    expect(ADD_DEVICE_SNMP_SECTION.isConfigured?.(values({}))).toBe(false);
    expect(
      ADD_DEVICE_SNMP_SECTION.isConfigured?.(values({ snmpVersion: "V3" })),
    ).toBe(false);
    expect(
      ADD_DEVICE_SNMP_SECTION.isConfigured?.(
        values({ snmpCommunityString: "public" }),
      ),
    ).toBe(true);
  });

  test("summarises itself with the shared summary", () => {
    expect(ADD_DEVICE_SNMP_SECTION.getSummary?.(values({}))).toEqual([
      ADD_DEVICE_SNMP_NOT_SET_SUMMARY,
    ]);
    expect(
      ADD_DEVICE_SNMP_SECTION.getSummary?.(
        values({ snmpCommunityString: "public" }),
      ),
    ).toBeUndefined();
  });

  /*
   * Its title says what is inside, so the folded header shows the summary
   * sentence rather than a list of nine field names.
   */
  test("does not list its fields while folded", () => {
    expect(ADD_DEVICE_SNMP_SECTION.listFieldsWhileFolded).toBeFalsy();
  });

  test("is a different fold from More fields, so the two never merge", () => {
    expect(ADD_DEVICE_SNMP_SECTION.id).not.toBe(ADD_DEVICE_MORE_FIELDS.id);
  });
});

describe("the More fields section", () => {
  test("is the shared More fields fold, listing its fields by name", () => {
    expect(ADD_DEVICE_MORE_FIELDS.title).toBe(MORE_FIELDS_SECTION_TITLE);
    expect(ADD_DEVICE_MORE_FIELDS.listFieldsWhileFolded).toBe(true);
    expect(ADD_DEVICE_MORE_FIELDS.openWhenConfigured).toBe(false);
  });
});

describe("the form's words", () => {
  test("the header button and the form's action read Add Device", () => {
    expect(`${ADD_DEVICE_CREATE_VERB} ${ADD_DEVICE_SINGULAR_NAME}`).toBe(
      "Add Device",
    );
    expect(ADD_DEVICE_PLURAL_NAME).toBe("Devices");
  });

  test("the hostname is explained in one plain, true sentence", () => {
    expect(ADD_DEVICE_HOSTNAME_DESCRIPTION).toBe(
      "The IP address or hostname the probe pings.",
    );
  });

  test("the name says it is optional by saying what happens when it is left empty", () => {
    expect(ADD_DEVICE_NAME_PLACEHOLDER).toBe("Same as the hostname");
    expect(ADD_DEVICE_NAME_DESCRIPTION).toContain("Leave it empty");
    expect(ADD_DEVICE_NAME_DESCRIPTION).toContain("hostname");
  });

  test("the site says it fills in the probe", () => {
    expect(ADD_DEVICE_SITE_DESCRIPTION).toContain("default probe");
  });

  test("the probe says it has to reach the device", () => {
    expect(ADD_DEVICE_PROBE_DESCRIPTION).toContain("reach");
  });

  /*
   * One alert per device is the long way round: the per-device Ping monitor
   * points at Alert Policies for many devices at once.
   */
  test("the Ping monitor option reads as an addition to the probe's status", () => {
    expect(ADD_DEVICE_PING_MONITOR_TITLE).toBe(
      "Also create a Ping monitor for incidents",
    );
    expect(ADD_DEVICE_PING_MONITOR_DESCRIPTION).toContain(
      "already pings this device",
    );
    expect(ADD_DEVICE_PING_MONITOR_DESCRIPTION).toContain("incidents are off");
  });

  test("the Ping monitor option points at Alert Policies for many devices", () => {
    expect(ADD_DEVICE_PING_MONITOR_DESCRIPTION).toContain("Alert Policies");
    expect(ADD_DEVICE_PING_MONITOR_DESCRIPTION).toContain(
      "counts towards your plan",
    );
  });

  test("no on-screen question is phrased in protocol jargon", () => {
    const JARGON: RegExp = /\b(ARP|FDB|LLDP|CDP|OID|IF-MIB|walk)\b/;

    for (const sentence of [
      ADD_DEVICE_HOSTNAME_DESCRIPTION,
      ADD_DEVICE_NAME_DESCRIPTION,
      ADD_DEVICE_SITE_DESCRIPTION,
      ADD_DEVICE_PROBE_DESCRIPTION,
      ADD_DEVICE_SNMP_NOT_SET_SUMMARY,
    ]) {
      expect(sentence).not.toMatch(JARGON);
    }
  });
});

describe("getDeviceNameForCreate (re-exported for the form)", () => {
  test("names a device without a name after its hostname", () => {
    expect(getDeviceNameForCreate("", "10.0.0.1")).toBe("10.0.0.1");
  });

  test("keeps a typed name", () => {
    expect(getDeviceNameForCreate("edge-fw", "10.0.0.1")).toBe("edge-fw");
  });
});
