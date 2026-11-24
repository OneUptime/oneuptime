import {
  HELP_AND_SUPPORT_ENVIRONMENT_KEY,
  HelpAndSupportSettings,
  HelpItem,
  HelpItemSetting,
  getDefaultHelpAndSupportSettings,
  toHelpAndSupportEnvironmentValue,
} from "../../Types/HelpAndSupport/HelpAndSupport";
import HelpAndSupport from "../../UI/Utils/HelpAndSupport";

/*
 * Where a server sends its people for help (Admin Dashboard > Settings >
 * Help and Support, #10864-#10866), as a frontend test sets it up.
 */

// Every item on its default, with these items changed.
export const helpAndSupportWith: (
  changes: Partial<Record<HelpItem, HelpItemSetting>>,
) => HelpAndSupportSettings = (
  changes: Partial<Record<HelpItem, HelpItemSetting>>,
): HelpAndSupportSettings => {
  return { ...getDefaultHelpAndSupportSettings(), ...changes };
};

/*
 * What env.js carries (HELP_AND_SUPPORT): the settings as the server writes
 * them - which leaves the key out while every item is on its default, and
 * holds back the chat and mobile app links - a raw string, or null for no
 * key at all.
 */
export const setHelpAndSupportEnvironment: (
  value: HelpAndSupportSettings | string | null,
) => void = (value: HelpAndSupportSettings | string | null): void => {
  const browserWindow: { process?: { env?: Record<string, unknown> } } =
    window as unknown as { process?: { env?: Record<string, unknown> } };

  browserWindow.process = browserWindow.process || {};
  browserWindow.process.env = browserWindow.process.env || {};

  const raw: string | null =
    value === null || typeof value === "string"
      ? value
      : toHelpAndSupportEnvironmentValue(value);

  if (raw === null) {
    delete browserWindow.process.env[HELP_AND_SUPPORT_ENVIRONMENT_KEY];
  } else {
    browserWindow.process.env[HELP_AND_SUPPORT_ENVIRONMENT_KEY] = raw;
  }
};

/*
 * A signed-in Dashboard's page, as the server sets it up: env.js, then the
 * links it holds back, read from the server (HelpAndSupport.load).
 */
export const setSignedInHelpAndSupport: (
  settings: HelpAndSupportSettings,
) => void = (settings: HelpAndSupportSettings): void => {
  setHelpAndSupportEnvironment(settings);
  HelpAndSupport.setLoaded(settings);
};

// Back to a server that never changed the page, and nothing read.
export const forgetHelpAndSupport: () => void = (): void => {
  setHelpAndSupportEnvironment(null);
  HelpAndSupport.setLoaded(null);
};
