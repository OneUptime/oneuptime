import Field from "Common/UI/Components/Forms/Types/Field";
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

  /*
   * Form step these fields belong to. Every SNMP field lands on the same step
   * — credentials are one decision, and splitting the v3 reveal chain across
   * steps would strand the auth/priv fields on a step the user has already
   * walked past. Callers that render the form without steps omit this.
   */
  stepId?: string | undefined;
}

export const MINIMUM_SNMP_PORT: number = 1;
export const MAXIMUM_SNMP_PORT: number = 65535;

export type SnmpPortValidatorFunction = (
  values: FormValues<SnmpConfigModelFields>,
) => string | null;

/*
 * A port outside 1-65535 cannot be dialled, and nothing downstream ever
 * noticed: the column is a plain nullable integer defaulting to 161, and
 * neither NetworkDeviceService nor NetworkDeviceDiscoveryScanService checks
 * it. A typo'd port was accepted by the form, stored, and then only ever
 * showed up as a device — or a whole subnet sweep — that quietly found
 * nothing. Part of giving every field in these forms a rule it is judged by on
 * its own step (issue #3377).
 *
 * Written as a customValidation rather than a `validation: { minValue,
 * maxValue }` block because the built-in bounds check runs the value through
 * parseInt: "161.5" reads as 161, clears both bounds, and then fails the
 * INSERT against an integer column. Same reason the discovery scan's rescan
 * interval owns its own rule.
 *
 * The field stays optional, so an empty box is left to the column default and
 * says nothing here. The check is against the RAW value: a blank box is not an
 * empty one, and `required` is not speaking for this field at all.
 */
export const validateSnmpPort: SnmpPortValidatorFunction = (
  values: FormValues<SnmpConfigModelFields>,
): string | null => {
  const raw: unknown = values["snmpPort"];

  if (raw === undefined || raw === null || String(raw) === "") {
    return null;
  }

  const port: number = Number(String(raw).trim());

  if (!isFinite(port) || !Number.isInteger(port)) {
    return "SNMP Port must be a whole number.";
  }

  if (port < MINIMUM_SNMP_PORT || port > MAXIMUM_SNMP_PORT) {
    return `SNMP Port must be between ${MINIMUM_SNMP_PORT} and ${MAXIMUM_SNMP_PORT}.`;
  }

  return null;
};

/*
 * The reveal chain, and the dropdown option lists, expressed against a PLAIN
 * object rather than against form values.
 *
 * They are exported because a second SNMP editor now exists: the discovery
 * scan collects an ordered LIST of credential sets
 * (Components/NetworkDevice/SnmpConfigListEditor), which cannot be built out
 * of flat Fields — a repeated block is not something Fields can express — but
 * which must ask for exactly the same things, under the same labels, revealed
 * by exactly the same rules. Sharing the predicates and the option lists is
 * what keeps "when do we ask for a privacy key?" one answer instead of two.
 *
 * The showIf callbacks below are thin wrappers over these, and stay
 * module-level constants: several tests compare two separately-built field
 * arrays and would see a per-call closure as a difference.
 */
export interface SnmpV3RevealSource {
  snmpVersion?: string | undefined;
  snmpV3SecurityLevel?: string | undefined;
}

export function isSnmpV3(config: SnmpV3RevealSource): boolean {
  return SnmpVersionUtil.isV3(config.snmpVersion);
}

export function isSnmpV3WithAuth(config: SnmpV3RevealSource): boolean {
  return (
    isSnmpV3(config) &&
    (config.snmpV3SecurityLevel === SnmpSecurityLevel.AuthNoPriv ||
      config.snmpV3SecurityLevel === SnmpSecurityLevel.AuthPriv)
  );
}

export function isSnmpV3WithPriv(config: SnmpV3RevealSource): boolean {
  return (
    isSnmpV3(config) &&
    config.snmpV3SecurityLevel === SnmpSecurityLevel.AuthPriv
  );
}

export interface SnmpDropdownOption {
  label: string;
  value: string;
}

export const SNMP_VERSION_DROPDOWN_OPTIONS: Array<SnmpDropdownOption> = [
  { label: "V1", value: "V1" },
  { label: "V2c", value: "V2c" },
  { label: "V3", value: "V3" },
];

export const SNMP_V3_SECURITY_LEVEL_DROPDOWN_OPTIONS: Array<SnmpDropdownOption> =
  [
    { label: "No Auth, No Priv", value: SnmpSecurityLevel.NoAuthNoPriv },
    { label: "Auth, No Priv", value: SnmpSecurityLevel.AuthNoPriv },
    { label: "Auth, Priv", value: SnmpSecurityLevel.AuthPriv },
  ];

export const SNMP_V3_AUTH_PROTOCOL_DROPDOWN_OPTIONS: Array<SnmpDropdownOption> =
  [
    { label: "MD5", value: SnmpAuthProtocol.MD5 },
    { label: "SHA", value: SnmpAuthProtocol.SHA },
    { label: "SHA-256", value: SnmpAuthProtocol.SHA256 },
    { label: "SHA-512", value: SnmpAuthProtocol.SHA512 },
  ];

export const SNMP_V3_PRIV_PROTOCOL_DROPDOWN_OPTIONS: Array<SnmpDropdownOption> =
  [
    { label: "DES", value: SnmpPrivProtocol.DES },
    { label: "AES", value: SnmpPrivProtocol.AES },
    { label: "AES-256", value: SnmpPrivProtocol.AES256 },
  ];

// The reveal source a set of form values describes.
function toRevealSource(
  item: FormValues<SnmpConfigModelFields>,
): SnmpV3RevealSource {
  return {
    snmpVersion: item["snmpVersion"] as string | undefined,
    snmpV3SecurityLevel: item["snmpV3SecurityLevel"] as string | undefined,
  };
}

const isV3: (item: FormValues<SnmpConfigModelFields>) => boolean = (
  item: FormValues<SnmpConfigModelFields>,
): boolean => {
  return isSnmpV3(toRevealSource(item));
};

const isV3WithAuth: (item: FormValues<SnmpConfigModelFields>) => boolean = (
  item: FormValues<SnmpConfigModelFields>,
): boolean => {
  return isSnmpV3WithAuth(toRevealSource(item));
};

const isV3WithPriv: (item: FormValues<SnmpConfigModelFields>) => boolean = (
  item: FormValues<SnmpConfigModelFields>,
): boolean => {
  return isSnmpV3WithPriv(toRevealSource(item));
};

export function getSnmpConfigFormFields(
  options?: SnmpConfigFormFieldOptions,
): Fields<SnmpConfigModelFields> {
  const fields: Fields<SnmpConfigModelFields> = [
    {
      field: {
        snmpVersion: true,
      },
      title: "SNMP Version",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: SNMP_VERSION_DROPDOWN_OPTIONS,
      required: true,
      /*
       * Default it, do not just hint it. A required Dropdown whose
       * placeholder reads "V2c" is indistinguishable from one already set
       * to V2c, so submitting the form straight through failed with
       * "SNMP Version is required" on a field the user could see filled in.
       * V2c matches the column default on both models.
       */
      defaultValue: "V2c",
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
      dropdownOptions: SNMP_V3_SECURITY_LEVEL_DROPDOWN_OPTIONS,
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
      dropdownOptions: SNMP_V3_AUTH_PROTOCOL_DROPDOWN_OPTIONS,
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
      dropdownOptions: SNMP_V3_PRIV_PROTOCOL_DROPDOWN_OPTIONS,
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
      description: "UDP port the agent listens on. Defaults to 161.",
      customValidation: validateSnmpPort,
    },
  ];

  if (!options?.stepId) {
    return fields;
  }

  const stepId: string = options.stepId;

  return fields.map((field: Field<SnmpConfigModelFields>) => {
    return {
      ...field,
      stepId: stepId,
    };
  });
}
