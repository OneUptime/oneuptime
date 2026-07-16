import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import { SnmpVersionUtil } from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";

/*
 * SNMP connection + credential form fields, shared by every SNMP form so they
 * cannot drift apart:
 *   - the NetworkDevice create form (Devices.tsx)
 *   - the NetworkDevice edit forms (View/Settings.tsx, View/Index.tsx)
 *   - the NetworkDeviceDiscoveryScan create form (Discovery.tsx)
 *
 * The two models store these as identically-named string/number columns, so
 * the fields are authored once against the SnmpConfigModelFields shape below
 * and reused for both. Field<SnmpConfigModelFields> is assignable to both
 * Fields<NetworkDevice> and Fields<NetworkDeviceDiscoveryScan> because those
 * models are supersets of this shape (the form field selector is a partial
 * mapped type and the showIf callbacks are contravariant), so no cast is
 * needed at the call sites.
 *
 * The SNMP Version dropdown stores "V1" / "V2c" / "V3", but a stored row may
 * instead carry the raw enum values ("1" / "2c" / "3") depending on which
 * writer created it, so the reveal check goes through SnmpVersionUtil rather
 * than comparing against a single spelling. The v3 fields reveal themselves
 * via showIf when V3 is selected, and the auth/priv fields reveal further
 * based on the chosen security level, so a noAuthNoPriv user is never asked
 * for keys they don't have.
 */

/*
 * The subset of columns both NetworkDevice and NetworkDeviceDiscoveryScan
 * share for SNMP config. Types match the model columns (plain string / number,
 * not the enums — the enums are only used as dropdown option values).
 */
export interface SnmpConfigModelFields {
  snmpVersion?: string | undefined;
  snmpCommunityString?: string | undefined;
  snmpV3SecurityLevel?: string | undefined;
  snmpV3Username?: string | undefined;
  snmpV3AuthProtocol?: string | undefined;
  snmpV3AuthKey?: string | undefined;
  snmpV3PrivProtocol?: string | undefined;
  snmpV3PrivKey?: string | undefined;
  snmpPort?: number | undefined;
}

export interface SnmpConfigFormFieldOptions {
  /*
   * The community string caption differs by context: a device polls one host,
   * a discovery scan tries the community against every host in the subnet.
   */
  communityStringDescription?: string | undefined;
}

const isV3: (item: FormValues<SnmpConfigModelFields>) => boolean = (
  item: FormValues<SnmpConfigModelFields>,
): boolean => {
  return SnmpVersionUtil.isV3(item["snmpVersion"] as string | undefined);
};

const isV3WithAuth: (item: FormValues<SnmpConfigModelFields>) => boolean = (
  item: FormValues<SnmpConfigModelFields>,
): boolean => {
  return (
    isV3(item) &&
    (item["snmpV3SecurityLevel"] === SnmpSecurityLevel.AuthNoPriv ||
      item["snmpV3SecurityLevel"] === SnmpSecurityLevel.AuthPriv)
  );
};

const isV3WithPriv: (item: FormValues<SnmpConfigModelFields>) => boolean = (
  item: FormValues<SnmpConfigModelFields>,
): boolean => {
  return (
    isV3(item) && item["snmpV3SecurityLevel"] === SnmpSecurityLevel.AuthPriv
  );
};

export function getSnmpConfigFormFields(
  options?: SnmpConfigFormFieldOptions,
): Fields<SnmpConfigModelFields> {
  return [
    {
      field: {
        snmpVersion: true,
      },
      title: "SNMP Version",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: [
        { label: "V1", value: "V1" },
        { label: "V2c", value: "V2c" },
        { label: "V3", value: "V3" },
      ],
      required: true,
      placeholder: "V2c",
    },
    {
      field: {
        snmpCommunityString: true,
      },
      title: "SNMP Community String",
      /*
       * EncryptedText (not Password): Password coerces the value into a
       * one-way HashedString, so the probe could never read the real
       * community back. EncryptedText renders masked but round-trips.
       */
      fieldType: FormFieldSchemaType.EncryptedText,
      required: false,
      placeholder: "public",
      description:
        options?.communityStringDescription ||
        "Required for SNMP V1 and V2c. Not used for V3.",
      showIf: (item: FormValues<SnmpConfigModelFields>): boolean => {
        return !isV3(item);
      },
    },
    {
      field: {
        snmpV3SecurityLevel: true,
      },
      title: "SNMP v3 Security Level",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: [
        { label: "No Auth, No Priv", value: SnmpSecurityLevel.NoAuthNoPriv },
        { label: "Auth, No Priv", value: SnmpSecurityLevel.AuthNoPriv },
        { label: "Auth, Priv", value: SnmpSecurityLevel.AuthPriv },
      ],
      required: true,
      placeholder: "Auth, Priv",
      description:
        "How much of the SNMP v3 exchange is authenticated/encrypted.",
      showIf: isV3,
    },
    {
      field: {
        snmpV3Username: true,
      },
      title: "SNMP v3 Username",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "monitoring",
      description: "The SNMP v3 security name (user) configured on the device.",
      showIf: isV3,
    },
    {
      field: {
        snmpV3AuthProtocol: true,
      },
      title: "SNMP v3 Authentication Protocol",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: [
        { label: "MD5", value: SnmpAuthProtocol.MD5 },
        { label: "SHA", value: SnmpAuthProtocol.SHA },
        { label: "SHA-256", value: SnmpAuthProtocol.SHA256 },
        { label: "SHA-512", value: SnmpAuthProtocol.SHA512 },
      ],
      required: true,
      placeholder: "SHA",
      showIf: isV3WithAuth,
    },
    {
      field: {
        snmpV3AuthKey: true,
      },
      title: "SNMP v3 Authentication Key",
      /*
       * EncryptedText renders a masked input but round-trips the raw value.
       * Password must NOT be used — it hashes the value one-way, so the probe
       * could never read the real key back.
       */
      fieldType: FormFieldSchemaType.EncryptedText,
      required: true,
      placeholder: "authentication passphrase",
      showIf: isV3WithAuth,
    },
    {
      field: {
        snmpV3PrivProtocol: true,
      },
      title: "SNMP v3 Privacy Protocol",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: [
        { label: "DES", value: SnmpPrivProtocol.DES },
        { label: "AES", value: SnmpPrivProtocol.AES },
        { label: "AES-256", value: SnmpPrivProtocol.AES256 },
      ],
      required: true,
      placeholder: "AES",
      showIf: isV3WithPriv,
    },
    {
      field: {
        snmpV3PrivKey: true,
      },
      title: "SNMP v3 Privacy Key",
      /*
       * EncryptedText renders a masked input but round-trips the raw value.
       * Password must NOT be used — it hashes the value one-way, so the probe
       * could never read the real key back.
       */
      fieldType: FormFieldSchemaType.EncryptedText,
      required: true,
      placeholder: "privacy passphrase",
      showIf: isV3WithPriv,
    },
    {
      field: {
        snmpPort: true,
      },
      title: "SNMP Port",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      placeholder: "161",
    },
  ];
}
