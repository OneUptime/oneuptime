import OneUptimeDate from "Common/Types/Date";
import {
  TemplateValue,
  Translator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  DataStoreContentScanFacts,
  DataStoreContentScanStop,
  DataStoreContentScanner,
  DataStoreNextContentScan,
  DataStoreScanNowRefusal,
  getDataStoreContentScanStop,
  getDataStoreNextContentScan,
  getDataStoreScanNowRefusal,
} from "Common/Utils/DataSecurity/DataStoreContentScanSchedule";
import { ClaimDue, ClaimDueState } from "Common/Utils/Probe/ClaimDueTime";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A STORE'S NEXT CONTENT SCAN, ON ITS OVERVIEW: A TIME ONLY WHEN SOMETHING
 * WILL SCAN IT THEN, AND OTHERWISE WHY NOTHING WILL.
 *
 * The page showed nextContentScanAt as a date whatever the store's scan
 * said. For a store whose scan is off, or one archived, the probe's claim
 * moves that date a quarter of an hour on, again and again, so the page
 * read "in 17 minutes" for a scan that never came (OneUptime issue #8042).
 * Whether, and by what, a store is scanned is
 * Common/Utils/DataSecurity/DataStoreContentScanSchedule, by the server's
 * own rules; this is how it reads, and why Scan Now would do nothing.
 */

export interface StoreNextContentScanWords {
  // The time it is due, a word ("Due now", "Off"), or "Every hour".
  headline: string;
  // For a time: the instant, for <time dateTime>.
  dateTime: Date | null;
  // Why, in a sentence: what stops it, or why it is late.
  detail: string | null;
}

// What each reason nothing will scan a store reads as.
const STOP_HEADLINES: Record<DataStoreContentScanStop, string> = {
  [DataStoreContentScanStop.StoreScanOff]: translationKey("Off"),
  [DataStoreContentScanStop.Archived]: translationKey("Off"),
  [DataStoreContentScanStop.ProjectScanOff]: translationKey("Off"),
  [DataStoreContentScanStop.ProjectTelemetryScanOff]: translationKey("Off"),
  [DataStoreContentScanStop.KindNotScannable]: translationKey("Not scanned"),
  [DataStoreContentScanStop.KindNotScannableByProbe]:
    translationKey("Not scanned"),
  [DataStoreContentScanStop.NoProbeConnectionVariable]:
    translationKey("Not scanned"),
  [DataStoreContentScanStop.ProbeNotAllowed]: translationKey("Not scanned"),
  [DataStoreContentScanStop.ProbeDisconnected]: translationKey("Waiting"),
};

// Why, and the one thing that changes it. The disconnected probe is named.
const STOP_DETAILS: Record<
  Exclude<DataStoreContentScanStop, DataStoreContentScanStop.ProbeDisconnected>,
  string
> = {
  [DataStoreContentScanStop.StoreScanOff]: translationKey(
    "Content scanning is off for this store. Turn it on in its Settings.",
  ),
  [DataStoreContentScanStop.Archived]: translationKey(
    "A store that is no longer found is not scanned. It is scanned again once it is found.",
  ),
  [DataStoreContentScanStop.ProjectScanOff]: translationKey(
    "Content scanning is off for this project. Turn it on in Data Security's Settings.",
  ),
  [DataStoreContentScanStop.ProjectTelemetryScanOff]: translationKey(
    "Telemetry scanning is off for this project. Turn it on in Data Security's Settings.",
  ),
  [DataStoreContentScanStop.KindNotScannable]: translationKey(
    "OneUptime cannot sample this kind of store's content yet.",
  ),
  [DataStoreContentScanStop.KindNotScannableByProbe]: translationKey(
    "A probe scans only stores you run: PostgreSQL, MySQL, SQL Server, Elasticsearch and OpenSearch. Scan this store from OneUptime's workers in its Settings.",
  ),
  [DataStoreContentScanStop.NoProbeConnectionVariable]: translationKey(
    "Name the probe's environment variable that holds the connection string, in its Settings.",
  ),
  [DataStoreContentScanStop.ProbeNotAllowed]: translationKey(
    "Only a probe of this project's own scans a store. Pick one in its Settings.",
  ),
};

function getProbeName(probeName: string | null | undefined): TemplateValue {
  // Translated along with the sentence it goes into, never on its own.
  return probeName || translatableTerm("its probe");
}

// Why nothing will scan the store, in a sentence.
export function getStoreScanStopDetail(
  stop: DataStoreContentScanStop,
  translator: Translator,
  probeName?: string | null | undefined,
): string {
  if (stop === DataStoreContentScanStop.ProbeDisconnected) {
    return translator.translateTemplate(
      "Nothing scans this store while {{probe}} is disconnected.",
      { probe: getProbeName(probeName) },
    );
  }

  return translator.translateText(STOP_DETAILS[stop]) as string;
}

export function getStoreNextContentScanWords(
  next: DataStoreNextContentScan,
  translator: Translator,
  probeName?: string | null | undefined,
): StoreNextContentScanWords {
  if (next.scanner === DataStoreContentScanner.TelemetryScan) {
    if (next.stop) {
      return {
        headline: translator.translateText(STOP_HEADLINES[next.stop]) as string,
        dateTime: null,
        detail: getStoreScanStopDetail(next.stop, translator, probeName),
      };
    }

    return {
      headline: translator.translateText("Every hour") as string,
      dateTime: null,
      detail: translator.translateText(
        "With the project's telemetry scan, from what its service sent in the last hour.",
      ) as string,
    };
  }

  const due: ClaimDue<DataStoreContentScanStop> = next.due;

  switch (due.state) {
    case ClaimDueState.Stopped:
      return {
        headline: translator.translateText(
          STOP_HEADLINES[due.stop as DataStoreContentScanStop],
        ) as string,
        dateTime: null,
        detail: getStoreScanStopDetail(
          due.stop as DataStoreContentScanStop,
          translator,
          probeName,
        ),
      };
    case ClaimDueState.Overdue:
      return {
        headline: translator.translateText("Overdue") as string,
        dateTime: null,
        detail:
          next.scanner === DataStoreContentScanner.Probe
            ? translator.translateTemplate(
                "Due {{time}}. Check that {{probe}} is connected and up to date.",
                {
                  time: OneUptimeDate.fromNow(due.dueAt as Date),
                  probe: getProbeName(probeName),
                },
              )
            : translator.translateTemplate(
                "Due {{time}}, and OneUptime's workers have not scanned it yet.",
                { time: OneUptimeDate.fromNow(due.dueAt as Date) },
              ),
      };
    case ClaimDueState.DueNow:
      return {
        headline: translator.translateText("Due now") as string,
        dateTime: null,
        detail: null,
      };
    case ClaimDueState.Scheduled:
    default:
      return {
        headline: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          due.dueAt as Date,
          false,
        ),
        dateTime: due.dueAt,
        detail: null,
      };
  }
}

/*
 * Why Scan Now would scan nothing, or undefined when it scans: the rule
 * the server's route refuses by (getDataStoreScanNowRefusal). Scan Now
 * makes the store due now and asks a worker to scan it: a store is scanned
 * only if its claim would hand it out - an archived one never is, and the
 * workers' scan reads the claim's rule before it reads anything. A
 * service's telemetry is read by the hourly telemetry scan, never by Scan
 * Now, which recorded a skipped scan for it.
 */
export function getStoreScanNowRefusal(
  facts: DataStoreContentScanFacts,
  translator: Translator,
  probeName?: string | null | undefined,
): string | undefined {
  const refusal: DataStoreScanNowRefusal | null =
    getDataStoreScanNowRefusal(facts);

  if (!refusal) {
    return undefined;
  }

  return refusal.stop
    ? getStoreScanStopDetail(refusal.stop, translator, probeName)
    : (translator.translateText(
        "A service's telemetry is scanned every hour, with the project's telemetry scan.",
      ) as string);
}

/*
 * Why the store's Scan Content switch cannot do anything, or undefined
 * when it can: OneUptime samples no store of its kind, or none of its kind
 * from a probe. Read by the server's own rule (getDataStoreContentScanStop)
 * whatever the switches say, so a SQL Server database a probe scans is not
 * said to be one OneUptime cannot sample (OneUptime issue #8322).
 */
export function getStoreContentScanKindRefusal(
  store: DataStoreContentScanFacts["store"],
  translator: Translator,
): string | undefined {
  const stop: DataStoreContentScanStop | null = getDataStoreContentScanStop({
    store: { ...store, isContentScanEnabled: true, isArchived: false },
  });

  return stop === DataStoreContentScanStop.KindNotScannable ||
    stop === DataStoreContentScanStop.KindNotScannableByProbe
    ? getStoreScanStopDetail(stop, translator)
    : undefined;
}

export interface ComponentProps {
  facts: DataStoreContentScanFacts;
  probeName?: string | null | undefined;
}

const StoreNextContentScan: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const words: StoreNextContentScanWords = getStoreNextContentScanWords(
    getDataStoreNextContentScan(props.facts, new Date()),
    translator,
    props.probeName,
  );

  return (
    <div className="text-sm" data-testid="data-store-next-content-scan">
      <div className="text-gray-900">
        {words.dateTime ? (
          <time dateTime={words.dateTime.toISOString()}>{words.headline}</time>
        ) : (
          words.headline
        )}
      </div>
      {words.detail ? (
        <p className="mt-0.5 text-xs text-gray-500">{words.detail}</p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default StoreNextContentScan;
