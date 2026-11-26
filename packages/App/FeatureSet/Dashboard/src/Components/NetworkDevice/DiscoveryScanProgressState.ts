import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "Common/Types/Translator";
import { formatCompactDuration } from "Common/Utils/Milliseconds";
import { isDiscoveryScanWaitingForFirstReport } from "Common/Utils/NetworkDiscovery/DiscoveryScanStatus";

/*
 * What a discovery scan's progress says, apart from the component that draws
 * it (DiscoveryScanProgress.tsx). This file imports no React, so modules
 * App's tests load - DiscoveryImportReview among them - can use it: App
 * installs no React, so its tsc and jest cannot follow an import into a
 * Dashboard file that imports "react".
 */

/**
 * A scan run again - on its schedule, or with Run Again - retains the
 * preceding result until its first report. The claim marker separates that
 * snapshot from this run's real progress; the server reads it the same way
 * (isDiscoveryScanWaitingForFirstReport).
 */
export function isWaitingForDiscoveryProgress(
  scan: NetworkDeviceDiscoveryScan | null,
): boolean {
  return isDiscoveryScanWaitingForFirstReport(scan);
}

// English, as a test and the server read it without a translator of their own.
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

/*
 * How long a scan ran: "59s", "1m 1s", "25h 1m" in English, and in the
 * reader's units and digits in their language ("1 Min. 1 s", "۱ دقیقه ۱
 * ثانیه"; #8455). The progress card passes its translator.
 */
export function formatDiscoveryDuration(
  milliseconds: number,
  translator: Translator = ENGLISH,
): string {
  const seconds: number = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) {
    return formatCompactDuration(translator, { seconds });
  }
  const minutes: number = Math.floor(seconds / 60);
  if (minutes < 60) {
    return formatCompactDuration(translator, {
      minutes,
      seconds: seconds % 60,
    });
  }
  return formatCompactDuration(translator, {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}
