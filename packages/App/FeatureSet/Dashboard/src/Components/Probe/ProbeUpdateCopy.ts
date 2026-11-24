import { ProbeFeature } from "Common/Types/Probe/ProbeReportedVersion";
import { translationKey } from "Common/Types/Translator";

/*
 * THE WORDS THAT SAY A CUSTOM PROBE IS OLDER THAN THE ONEUPTIME IT REPORTS
 * TO (OneUptime issue #9815), and what it misses until it is updated - kept
 * React-free, so tests read them without the Dashboard's React.
 *
 * "Behind" is not one of them: a probe's Status says Behind when its checks
 * run late (Types/Probe/ProbeBehind), which an update does not change.
 */
export const PROBE_UPDATE_COPY: {
  olderThanServer: string;
  updateAvailable: string;
} = {
  // On the probe's page, under its version.
  olderThanServer: translationKey(
    "Older than OneUptime {{version}}, which it reports to. Update the probe to get the latest checks and fixes.",
  ),
  // In Custom Probes, under a probe's version: a link to how to update it.
  updateAvailable: translationKey("Update available: {{version}}"),
};

/*
 * What a probe cannot do until it is updated, a sentence for each feature
 * it is too old for (ProbeReportedVersionUtil.getMissedFeatures), under its
 * version on its page. None names a release: the probe's page says to
 * update it, and links how. A new ProbeFeature needs its sentence here, and
 * its list's in the monitor forms (Monitor/ProbesTooOld).
 */
export const PROBE_MISSED_FEATURE_COPY: Readonly<Record<ProbeFeature, string>> =
  {
    // The one-time codes of one-time code secrets (#9759).
    [ProbeFeature.OneTimeCodes]: translationKey(
      "Too old to make one-time codes. Monitors that use a one-time code secret fail their check on this probe until it is updated.",
    ),
    // An array, a single value or text as an API monitor's body (#10737).
    [ProbeFeature.AnyRequestBody]: translationKey(
      "Too old to send a request body that is a JSON array, a single value or text. API monitors with such a body fail their check on this probe until it is updated.",
    ),
  };
