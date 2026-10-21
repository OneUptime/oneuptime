import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of the Synthetic and Custom Code monitor forms, kept free of
 * React so the form and App/Tests read them.
 *
 * A new Synthetic monitor starts in Chromium at a desktop size
 * (Common/Types/Monitor/MonitorStep: SYNTHETIC_MONITOR_DEFAULT_BROWSER_TYPES):
 * its form used to open with every browser and every screen size unticked,
 * which saved a monitor that ran nothing. Saving one with either list empty
 * is refused now, with the two messages below - the same words
 * MonitorStep.getValidationError returns, here so the extractor finds them
 * and every language reads them.
 */
export const SyntheticMonitorCopy: {
  playwrightCodeDescription: string;
  javaScriptCodeDescription: string;
  browserTypeDescription: string;
  screenTypeDescription: string;
  retryCountOnErrorDescription: string;
  browserRequired: string;
  screenSizeRequired: string;
} = {
  playwrightCodeDescription: translationKey(
    "A Playwright script, run in each browser and at each screen size you pick below.",
  ),
  javaScriptCodeDescription: translationKey(
    "JavaScript the probe runs on every check.",
  ),
  browserTypeDescription: translationKey("The browsers to run the script in."),
  screenTypeDescription: translationKey(
    "The screen sizes to run it at, in each browser.",
  ),
  retryCountOnErrorDescription: translationKey(
    "How many times to run the script again when it fails. Up to 5.",
  ),
  browserRequired: translationKey(
    "Pick at least one browser to run the script in.",
  ),
  screenSizeRequired: translationKey(
    "Pick at least one screen size to run the script at.",
  ),
};

export default SyntheticMonitorCopy;
