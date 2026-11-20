import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorSecretType, {
  MonitorSecretTypeUtil,
} from "Common/Types/Monitor/MonitorSecretType";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { TemplateValues, translationKey } from "Common/Types/Translator";
import {
  TotpSecretReading,
  readTotpSecret,
  writeTotpSecretProblem,
} from "Common/Utils/Totp/TotpSecret";

/*
 * What a monitor secret holds, as its form asks it (issue #9703): Text - a
 * password, an API key, a token - or a one-time code secret, a site's
 * two-factor setup key that monitors make sign-in codes from. Kept
 * React-free, like MonitorSecretAccessFormFields.ts, so App tests can
 * import it without the Dashboard's react.
 *
 * The type is asked when a secret is created, and again in Update Secret
 * Value (issue #9760): the same value means something else in the other
 * type, so the type changes only together with a new value, which the
 * server reads for the new type.
 */

// How the form and the table name each type.
export const MONITOR_SECRET_TYPE_TITLES: Record<MonitorSecretType, string> = {
  [MonitorSecretType.Text]: translationKey("Text"),
  [MonitorSecretType.TOTP]: translationKey("One-time code (TOTP)"),
};

// Text first: what most secrets are, and the default.
export const MONITOR_SECRET_TYPE_OPTIONS: Array<CardSelectOption> = [
  {
    value: MonitorSecretType.Text,
    title: MONITOR_SECRET_TYPE_TITLES[MonitorSecretType.Text],
    icon: IconProp.Key,
    description: translationKey(
      "A password, API key or token. Monitors use it as written.",
    ),
  },
  {
    value: MonitorSecretType.TOTP,
    title: MONITOR_SECRET_TYPE_TITLES[MonitorSecretType.TOTP],
    icon: IconProp.DevicePhoneMobile,
    description: translationKey(
      "A site's two-factor setup key. Monitors get the code of the moment, never the key.",
    ),
  },
];

// The type field's help, on create and in Update Secret Value.
export const MONITOR_SECRET_TYPE_CREATE_DESCRIPTION: string = translationKey(
  "What the secret holds. Update Secret Value can change it later, together with a new value.",
);
export const MONITOR_SECRET_TYPE_UPDATE_DESCRIPTION: string = translationKey(
  "Change it together with a new value below; monitors that use the secret take it at their next check.",
);

/*
 * Update Secret Value asks the value of each type in a field of its own,
 * so switching the type never carries what was typed for the other one: a
 * setup key typed and then switched to Text is not sent as text, and a
 * password is never previewed as a code.
 */
export const UPDATE_TEXT_VALUE_FIELD: string = "secretValue";
export const UPDATE_SETUP_KEY_FIELD: string = "setupKey";

/*
 * What Update Secret Value sends: the type picked, and the value typed for
 * it - the server reads the value for that type, and changes both in one
 * write. A value left empty goes as empty, for the server to say what it
 * needs; the dialog asks for it before that.
 */
export const getUpdateSecretValueData: (values: Record<string, unknown>) => {
  secretType: MonitorSecretType;
  secretValue: string;
} = (
  values: Record<string, unknown>,
): { secretType: MonitorSecretType; secretValue: string } => {
  const secretType: MonitorSecretType = MonitorSecretTypeUtil.isTotp(
    values["secretType"],
  )
    ? MonitorSecretType.TOTP
    : MonitorSecretType.Text;
  const value: unknown =
    secretType === MonitorSecretType.TOTP
      ? values[UPDATE_SETUP_KEY_FIELD]
      : values[UPDATE_TEXT_VALUE_FIELD];

  return {
    secretType: secretType,
    secretValue: typeof value === "string" ? value : "",
  };
};

// The setup key field's words, for the create form and Update Secret Value.
export const TOTP_SECRET_VALUE_TITLE: string = translationKey("Setup Key");
export const TOTP_SECRET_VALUE_DESCRIPTION: string = translationKey(
  "The key or otpauth:// link a site shows when you turn on two-factor sign-in. It is encrypted and never shown again.",
);
export const TOTP_SECRET_VALUE_PLACEHOLDER: string = translationKey(
  "otpauth://totp/... or JBSW Y3DP EHPK 3PXP",
);

export type TranslateFunction = (text: string) => string;

const untranslated: TranslateFunction = (text: string): string => {
  return text;
};

export type GetMonitorSecretTypeOptionsFunction = (
  translate?: TranslateFunction,
) => Array<CardSelectOption>;

export const getMonitorSecretTypeOptions: GetMonitorSecretTypeOptionsFunction =
  (translate: TranslateFunction = untranslated): Array<CardSelectOption> => {
    return MONITOR_SECRET_TYPE_OPTIONS.map(
      (option: CardSelectOption): CardSelectOption => {
        return {
          ...option,
          title: translate(option.title),
          description: translate(option.description),
        };
      },
    );
  };

type IsTypeFunction = (values: FormValues<MonitorSecret>) => boolean;

export const isTotpSecretForm: IsTypeFunction = (
  values: FormValues<MonitorSecret>,
): boolean => {
  return MonitorSecretTypeUtil.isTotp(values.secretType);
};

// A secret with no type yet is Text: the type's default.
export const isTextSecretForm: IsTypeFunction = (
  values: FormValues<MonitorSecret>,
): boolean => {
  return !isTotpSecretForm(values);
};

export type TranslateTemplateFunction = (
  template: string,
  values?: TemplateValues,
) => string;

/*
 * What is wrong with a setup key or link as it is typed, in the reader's
 * language - the sentence the server would refuse it with - or null. An
 * empty field is left to the field's own required check.
 */
export const getTotpSecretValueProblem: (
  value: unknown,
  translateTemplate?: TranslateTemplateFunction,
) => string | null = (
  value: unknown,
  translateTemplate?: TranslateTemplateFunction,
): string | null => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const reading: TotpSecretReading = readTotpSecret(value);

  if (!reading.problem) {
    return null;
  }

  return translateTemplate
    ? translateTemplate(reading.problem.template, reading.problem.values)
    : writeTotpSecretProblem(reading.problem);
};
