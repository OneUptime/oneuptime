import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";

/*
 * SNMP connection + credential form fields, shared by the create form
 * (Devices.tsx) and the edit form (View/Settings.tsx) so both stay in sync.
 *
 * The SNMP Version dropdown stores "V1" / "V2c" / "V3" (matching the model
 * default of "V2c"); the hydration util tolerates both these and the raw enum
 * values. The v3 fields reveal themselves via showIf when V3 is selected, and
 * the auth/priv fields reveal further based on the chosen security level, so a
 * noAuthNoPriv user is never asked for keys they don't have.
 */

const isV3: (item: FormValues<NetworkDevice>) => boolean = (
  item: FormValues<NetworkDevice>,
): boolean => {
  return item["snmpVersion"] === "V3";
};

const isV3WithAuth: (item: FormValues<NetworkDevice>) => boolean = (
  item: FormValues<NetworkDevice>,
): boolean => {
  return (
    isV3(item) &&
    (item["snmpV3SecurityLevel"] === SnmpSecurityLevel.AuthNoPriv ||
      item["snmpV3SecurityLevel"] === SnmpSecurityLevel.AuthPriv)
  );
};

const isV3WithPriv: (item: FormValues<NetworkDevice>) => boolean = (
  item: FormValues<NetworkDevice>,
): boolean => {
  return (
    isV3(item) && item["snmpV3SecurityLevel"] === SnmpSecurityLevel.AuthPriv
  );
};

export function getSnmpConfigFormFields(): Fields<NetworkDevice> {
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
      description: "Required for SNMP V1 and V2c. Not used for V3.",
      showIf: (item: FormValues<NetworkDevice>): boolean => {
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
