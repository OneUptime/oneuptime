import { ReactElement } from "react";
import { useTranslation } from "react-i18next";

export type TranslatableValue = string | ReactElement | undefined;

export interface UseTranslateValueResult {
  translateValue: (value: TranslatableValue) => TranslatableValue;
  translateString: (value: string | undefined) => string | undefined;
}

/**
 * Hook that returns helpers to translate arbitrary user-facing strings using
 * the active i18next instance.
 *
 * The translation lookup uses the entire string as a flat key (keySeparator and
 * nsSeparator are disabled per call) so titles like "v1.0" or "Active Incidents"
 * work without nested-key confusion. If no translation entry exists, the original
 * string is returned.
 */
const useTranslateValue: () => UseTranslateValueResult =
  (): UseTranslateValueResult => {
    const { t } = useTranslation();

    const translateString: (value: string | undefined) => string | undefined = (
      value: string | undefined,
    ): string | undefined => {
      if (typeof value !== "string" || value.length === 0) {
        return value;
      }
      const translated: string = t(value, {
        defaultValue: value,
        keySeparator: false,
        nsSeparator: false,
      });
      return translated;
    };

    const translateValue: (value: TranslatableValue) => TranslatableValue = (
      value: TranslatableValue,
    ): TranslatableValue => {
      if (typeof value === "string") {
        return translateString(value);
      }
      return value;
    };

    return { translateValue, translateString };
  };

export default useTranslateValue;
