import { describe, expect, test } from "@jest/globals";
import { getSnmpConfigFormFields } from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/SnmpConfigFormFields";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { JSONObject } from "Common/Types/JSON";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import fs from "fs";
import path from "path";

/*
 * These tests pin the SNMP section of the Create/Edit Network Device forms.
 *
 * Customer report: a device created with SNMP v3 re-opens on "Edit Network
 * Device" showing the v2 view — the community string field is visible and the
 * v3 auth/privacy fields are gone, so the credentials can be neither read nor
 * re-entered. The reveal logic is the `showIf` predicate on each field, which
 * is evaluated against the values the edit form hydrates from the stored
 * device, so these tests drive `showIf` with the shapes the database can
 * actually hold.
 *
 * The SNMP version is persisted as a free-text column with no enum coercion,
 * and two spellings exist in the codebase: the dropdown writes the enum KEYS
 * ("V1"/"V2c"/"V3") while SnmpVersion's enum VALUES are "1"/"2c"/"3". The
 * server tolerates both (NetworkDeviceHydrationUtil.parseSnmpVersion), so the
 * form must tolerate both too — anything else strands a device in the wrong
 * view.
 */

const FIELD_KEY_SNMP_VERSION: string = "snmpVersion";
const FIELD_KEY_COMMUNITY: string = "snmpCommunityString";
const FIELD_KEY_SECURITY_LEVEL: string = "snmpV3SecurityLevel";
const FIELD_KEY_USERNAME: string = "snmpV3Username";
const FIELD_KEY_AUTH_PROTOCOL: string = "snmpV3AuthProtocol";
const FIELD_KEY_AUTH_KEY: string = "snmpV3AuthKey";
const FIELD_KEY_PRIV_PROTOCOL: string = "snmpV3PrivProtocol";
const FIELD_KEY_PRIV_KEY: string = "snmpV3PrivKey";
const FIELD_KEY_PORT: string = "snmpPort";

const V3_ONLY_FIELDS: Array<string> = [
  FIELD_KEY_SECURITY_LEVEL,
  FIELD_KEY_USERNAME,
];
const AUTH_FIELDS: Array<string> = [
  FIELD_KEY_AUTH_PROTOCOL,
  FIELD_KEY_AUTH_KEY,
];
const PRIV_FIELDS: Array<string> = [
  FIELD_KEY_PRIV_PROTOCOL,
  FIELD_KEY_PRIV_KEY,
];

function getFieldKey(field: Field<NetworkDevice>): string {
  return Object.keys(field.field || {})[0] as string;
}

function getField(key: string): Field<NetworkDevice> {
  const field: Field<NetworkDevice> | undefined =
    getSnmpConfigFormFields().find((item: Field<NetworkDevice>) => {
      return getFieldKey(item) === key;
    });

  if (!field) {
    throw new Error(`SNMP form field "${key}" not found`);
  }

  return field;
}

/*
 * A field with no showIf is unconditionally visible; that is the same
 * "is this rendered?" question BasicForm asks when it filters formFields.
 */
function isFieldVisible(
  key: string,
  values: FormValues<NetworkDevice>,
): boolean {
  const field: Field<NetworkDevice> = getField(key);

  if (!field.showIf) {
    return true;
  }

  return field.showIf(values);
}

function visibleFieldKeys(values: FormValues<NetworkDevice>): Array<string> {
  return getSnmpConfigFormFields()
    .filter((field: Field<NetworkDevice>) => {
      return !field.showIf || field.showIf(values);
    })
    .map((field: Field<NetworkDevice>) => {
      return getFieldKey(field);
    });
}

/*
 * Mirrors what the edit form actually holds: ModelForm fetches the device,
 * rebuilds it with BaseModel.fromJSON, and BasicModelForm spreads that model
 * instance into the form values that showIf receives.
 */
function buildEditFormValues(device: JSONObject): FormValues<NetworkDevice> {
  const model: NetworkDevice = BaseModel.fromJSON(
    {
      _id: "3f1b6b0e-0000-4000-8000-000000000001",
      name: "Router 01",
      hostname: "10.0.0.1",
      ...device,
    },
    NetworkDevice,
  ) as NetworkDevice;

  return { ...model } as FormValues<NetworkDevice>;
}

function dropdownValuesOf(key: string): Array<string> {
  const options: Array<DropdownOption> = (getField(key).dropdownOptions ||
    []) as Array<DropdownOption>;

  return options.map((option: DropdownOption) => {
    return option.value as string;
  });
}

describe("getSnmpConfigFormFields — field inventory", () => {
  test("exposes every SNMP connection and v3 credential field", () => {
    const keys: Array<string> = getSnmpConfigFormFields().map(
      (field: Field<NetworkDevice>) => {
        return getFieldKey(field);
      },
    );

    expect(keys).toEqual([
      FIELD_KEY_SNMP_VERSION,
      FIELD_KEY_COMMUNITY,
      FIELD_KEY_SECURITY_LEVEL,
      FIELD_KEY_USERNAME,
      FIELD_KEY_AUTH_PROTOCOL,
      FIELD_KEY_AUTH_KEY,
      FIELD_KEY_PRIV_PROTOCOL,
      FIELD_KEY_PRIV_KEY,
      FIELD_KEY_PORT,
    ]);
  });

  test("returns a fresh array each call so the two forms cannot mutate each other", () => {
    const first: Array<Field<NetworkDevice>> = getSnmpConfigFormFields();
    const second: Array<Field<NetworkDevice>> = getSnmpConfigFormFields();

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });

  /*
   * Regression: Password wraps the value in a one-way HashedString, so the
   * probe could never read the real secret back. Secrets here must round-trip,
   * which is what EncryptedText does.
   */
  test.each([
    [FIELD_KEY_COMMUNITY],
    [FIELD_KEY_AUTH_KEY],
    [FIELD_KEY_PRIV_KEY],
  ])(
    "%s is EncryptedText so the secret round-trips to the probe",
    (key: string) => {
      expect(getField(key).fieldType).toBe(FormFieldSchemaType.EncryptedText);
      expect(getField(key).fieldType).not.toBe(FormFieldSchemaType.Password);
    },
  );

  test("the version dropdown offers exactly V1, V2c and V3", () => {
    expect(getField(FIELD_KEY_SNMP_VERSION).dropdownOptions).toEqual([
      { label: "V1", value: "V1" },
      { label: "V2c", value: "V2c" },
      { label: "V3", value: "V3" },
    ]);
  });

  test("the v3 protocol dropdowns offer the values the probe knows how to map", () => {
    expect(dropdownValuesOf(FIELD_KEY_AUTH_PROTOCOL)).toEqual([
      SnmpAuthProtocol.MD5,
      SnmpAuthProtocol.SHA,
      SnmpAuthProtocol.SHA256,
      SnmpAuthProtocol.SHA512,
    ]);

    expect(dropdownValuesOf(FIELD_KEY_PRIV_PROTOCOL)).toEqual([
      SnmpPrivProtocol.DES,
      SnmpPrivProtocol.AES,
      SnmpPrivProtocol.AES256,
    ]);

    expect(dropdownValuesOf(FIELD_KEY_SECURITY_LEVEL)).toEqual([
      SnmpSecurityLevel.NoAuthNoPriv,
      SnmpSecurityLevel.AuthNoPriv,
      SnmpSecurityLevel.AuthPriv,
    ]);
  });

  test("version and port are always visible regardless of version", () => {
    for (const version of ["V1", "V2c", "V3", undefined]) {
      const values: FormValues<NetworkDevice> = buildEditFormValues({
        snmpVersion: version,
      });

      expect(isFieldVisible(FIELD_KEY_SNMP_VERSION, values)).toBe(true);
      expect(isFieldVisible(FIELD_KEY_PORT, values)).toBe(true);
    }
  });
});

describe("getSnmpConfigFormFields — v1/v2c reveal", () => {
  test.each([["V1"], ["V2c"]])(
    "%s shows the community string and hides every v3 field",
    (version: string) => {
      const values: FormValues<NetworkDevice> = buildEditFormValues({
        snmpVersion: version,
      });

      expect(isFieldVisible(FIELD_KEY_COMMUNITY, values)).toBe(true);

      for (const key of [...V3_ONLY_FIELDS, ...AUTH_FIELDS, ...PRIV_FIELDS]) {
        expect(isFieldVisible(key, values)).toBe(false);
      }
    },
  );

  test("a device with no stored version falls back to the v2c view", () => {
    const values: FormValues<NetworkDevice> = buildEditFormValues({
      snmpVersion: undefined,
    });

    expect(isFieldVisible(FIELD_KEY_COMMUNITY, values)).toBe(true);
    expect(isFieldVisible(FIELD_KEY_SECURITY_LEVEL, values)).toBe(false);
  });
});

describe("getSnmpConfigFormFields — v3 reveal on the edit screen", () => {
  /*
   * The customer's report, stated as a contract: whatever spelling of "v3" the
   * device carries, re-opening the edit screen must offer the v3 credentials
   * and must not offer the community string.
   *
   * "V3" is what the dropdown writes. "3" is SnmpVersion.V3 — the enum value
   * the server-side types use and which parseSnmpVersion already accepts. "v3"
   * covers case drift. All three must reveal the v3 section.
   */
  test.each([["V3"], [SnmpVersion.V3], ["v3"]])(
    "a device stored with snmpVersion=%s reveals the v3 credential fields",
    (version: string) => {
      const values: FormValues<NetworkDevice> = buildEditFormValues({
        snmpVersion: version,
        snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
        snmpV3Username: "monitoring",
        snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
        snmpV3AuthKey: "auth-passphrase",
        snmpV3PrivProtocol: SnmpPrivProtocol.AES,
        snmpV3PrivKey: "priv-passphrase",
      });

      expect(isFieldVisible(FIELD_KEY_SECURITY_LEVEL, values)).toBe(true);
      expect(isFieldVisible(FIELD_KEY_USERNAME, values)).toBe(true);
    },
  );

  test.each([["V3"], [SnmpVersion.V3], ["v3"]])(
    "a device stored with snmpVersion=%s hides the community string",
    (version: string) => {
      const values: FormValues<NetworkDevice> = buildEditFormValues({
        snmpVersion: version,
        snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
        snmpV3Username: "monitoring",
      });

      expect(isFieldVisible(FIELD_KEY_COMMUNITY, values)).toBe(false);
    },
  );

  test.each([["V3"], [SnmpVersion.V3], ["v3"]])(
    "a device stored with snmpVersion=%s at authPriv reveals the auth AND privacy fields",
    (version: string) => {
      const values: FormValues<NetworkDevice> = buildEditFormValues({
        snmpVersion: version,
        snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
        snmpV3Username: "monitoring",
        snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
        snmpV3AuthKey: "auth-passphrase",
        snmpV3PrivProtocol: SnmpPrivProtocol.AES,
        snmpV3PrivKey: "priv-passphrase",
      });

      for (const key of [...AUTH_FIELDS, ...PRIV_FIELDS]) {
        expect(isFieldVisible(key, values)).toBe(true);
      }
    },
  );

  /*
   * The exact screen in the customer's screenshot: an authPriv v3 device whose
   * edit form must offer every credential input and no community string.
   */
  test.each([["V3"], [SnmpVersion.V3]])(
    "the full authPriv v3 edit screen (snmpVersion=%s) renders the v3 section, not the v2 one",
    (version: string) => {
      const values: FormValues<NetworkDevice> = buildEditFormValues({
        snmpVersion: version,
        snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
        snmpV3Username: "monitoring",
        snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
        snmpV3AuthKey: "auth-passphrase",
        snmpV3PrivProtocol: SnmpPrivProtocol.AES,
        snmpV3PrivKey: "priv-passphrase",
        snmpPort: 161,
      });

      expect(visibleFieldKeys(values)).toEqual([
        FIELD_KEY_SNMP_VERSION,
        FIELD_KEY_SECURITY_LEVEL,
        FIELD_KEY_USERNAME,
        FIELD_KEY_AUTH_PROTOCOL,
        FIELD_KEY_AUTH_KEY,
        FIELD_KEY_PRIV_PROTOCOL,
        FIELD_KEY_PRIV_KEY,
        FIELD_KEY_PORT,
      ]);
    },
  );
});

describe("getSnmpConfigFormFields — v3 security level gating", () => {
  test("noAuthNoPriv asks for no keys the operator does not have", () => {
    const values: FormValues<NetworkDevice> = buildEditFormValues({
      snmpVersion: "V3",
      snmpV3SecurityLevel: SnmpSecurityLevel.NoAuthNoPriv,
      snmpV3Username: "monitoring",
    });

    expect(isFieldVisible(FIELD_KEY_USERNAME, values)).toBe(true);

    for (const key of [...AUTH_FIELDS, ...PRIV_FIELDS]) {
      expect(isFieldVisible(key, values)).toBe(false);
    }
  });

  test("authNoPriv reveals the auth fields but not the privacy fields", () => {
    const values: FormValues<NetworkDevice> = buildEditFormValues({
      snmpVersion: "V3",
      snmpV3SecurityLevel: SnmpSecurityLevel.AuthNoPriv,
      snmpV3Username: "monitoring",
      snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
      snmpV3AuthKey: "auth-passphrase",
    });

    for (const key of AUTH_FIELDS) {
      expect(isFieldVisible(key, values)).toBe(true);
    }

    for (const key of PRIV_FIELDS) {
      expect(isFieldVisible(key, values)).toBe(false);
    }
  });

  test("a v3 device with no security level yet still asks for level and username", () => {
    const values: FormValues<NetworkDevice> = buildEditFormValues({
      snmpVersion: "V3",
    });

    expect(isFieldVisible(FIELD_KEY_SECURITY_LEVEL, values)).toBe(true);
    expect(isFieldVisible(FIELD_KEY_USERNAME, values)).toBe(true);
    expect(isFieldVisible(FIELD_KEY_AUTH_KEY, values)).toBe(false);
  });

  /*
   * The security level only gates the auth/priv fields when the version is
   * v3 — a v2c device carrying a stale authPriv level must never show them.
   */
  test("a stale authPriv level on a v2c device reveals nothing v3", () => {
    const values: FormValues<NetworkDevice> = buildEditFormValues({
      snmpVersion: "V2c",
      snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
      snmpV3Username: "monitoring",
    });

    expect(isFieldVisible(FIELD_KEY_COMMUNITY, values)).toBe(true);

    for (const key of [...V3_ONLY_FIELDS, ...AUTH_FIELDS, ...PRIV_FIELDS]) {
      expect(isFieldVisible(key, values)).toBe(false);
    }
  });
});

describe("getSnmpConfigFormFields — switching version inside an open form", () => {
  /*
   * showIf is re-evaluated against the live form values on every render, so
   * picking a version in the dropdown must swap the section immediately —
   * this is the "we're not able to re-add the v3 settings" half of the report.
   */
  test("picking V3 in an open v2c form swaps the community string for the v3 fields", () => {
    const beforeSelection: FormValues<NetworkDevice> = buildEditFormValues({
      snmpVersion: "V2c",
      snmpCommunityString: "public",
    });

    expect(isFieldVisible(FIELD_KEY_COMMUNITY, beforeSelection)).toBe(true);
    expect(isFieldVisible(FIELD_KEY_SECURITY_LEVEL, beforeSelection)).toBe(
      false,
    );

    const afterSelection: FormValues<NetworkDevice> = {
      ...beforeSelection,
      snmpVersion: "V3",
    } as FormValues<NetworkDevice>;

    expect(isFieldVisible(FIELD_KEY_COMMUNITY, afterSelection)).toBe(false);
    expect(isFieldVisible(FIELD_KEY_SECURITY_LEVEL, afterSelection)).toBe(true);
    expect(isFieldVisible(FIELD_KEY_USERNAME, afterSelection)).toBe(true);
  });

  test("raising the security level to authPriv reveals the privacy fields", () => {
    const values: FormValues<NetworkDevice> = {
      ...buildEditFormValues({
        snmpVersion: "V3",
        snmpV3SecurityLevel: SnmpSecurityLevel.AuthNoPriv,
      }),
      snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
    } as FormValues<NetworkDevice>;

    for (const key of PRIV_FIELDS) {
      expect(isFieldVisible(key, values)).toBe(true);
    }
  });
});

/*
 * The tests above pin the helper, and they were green the whole time the
 * customer report was live: "Edit Network Device" on the device overview page
 * never called the helper. It hand-rolled its own three-field SNMP block, so
 * picking V3 revealed nothing and the community string it wrote went through
 * FormFieldSchemaType.Password (a one-way hash the probe can never read back).
 *
 * Testing the helper therefore proves nothing on its own — the invariant that
 * actually broke is that every SNMP form ROUTES THROUGH it. These tests read
 * the page sources to pin that, which is the only way to catch a page that
 * quietly stops calling the helper.
 *
 * Discovery.tsx is included even though it builds a form over
 * NetworkDeviceDiscoveryScan rather than NetworkDevice: the helper is authored
 * against the SnmpConfigModelFields shape both models satisfy, so it serves
 * both. It had the same drift — a hand-rolled block offering V3 with no v3
 * fields behind it.
 */
const SNMP_FORM_PAGES: Array<string> = [
  "Devices.tsx",
  "Discovery.tsx",
  "View/Index.tsx",
  "View/Settings.tsx",
];

function readNetworkDevicePage(relativePath: string): string {
  return fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Dashboard",
      "src",
      "Pages",
      "NetworkDevice",
      relativePath,
    ),
    "utf8",
  );
}

describe("NetworkDevice SNMP forms route through getSnmpConfigFormFields", () => {
  test.each(SNMP_FORM_PAGES)("%s spreads the shared fields", (page: string) => {
    // Matches both the bare call and the options form the scan page uses.
    expect(readNetworkDevicePage(page)).toContain(
      "...getSnmpConfigFormFields(",
    );
  });

  /*
   * The signature of a hand-rolled SNMP block: its own version dropdown.
   * Only the helper is allowed to declare those options.
   */
  test.each(SNMP_FORM_PAGES)(
    "%s does not hand-roll its own SNMP version dropdown",
    (page: string) => {
      expect(readNetworkDevicePage(page)).not.toContain('value: "V2c"');
    },
  );

  /*
   * Password hashes one-way, so a community string or v3 key saved through it
   * is unusable by the probe. The helper uses EncryptedText, which round-trips.
   */
  test.each(SNMP_FORM_PAGES)(
    "%s does not put SNMP credentials behind a one-way hash",
    (page: string) => {
      expect(readNetworkDevicePage(page)).not.toContain(
        "FormFieldSchemaType.Password",
      );
    },
  );
});
