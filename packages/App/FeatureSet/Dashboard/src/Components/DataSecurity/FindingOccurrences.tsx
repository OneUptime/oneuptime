import AppLink from "../AppLink/AppLink";
import DataSecurityApi from "./DataSecurityApi";
import {
  OccurrenceLink,
  OccurrenceLinkKind,
  getOccurrenceLinks,
} from "./FindingOccurrenceLinks";
import {
  DataSecurityFindingOccurrence,
  DataSecurityFindingOccurrences,
  DataSecurityOccurrenceExcerpt,
  DataSecurityOccurrenceExcerptPart,
  DataSecurityOccurrenceExcerptPartKind,
  DataSecurityOccurrenceRecordKind,
  DataSecurityOccurrencesSource,
  DataSecurityOccurrencesUnavailableReason,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import API from "Common/UI/Utils/API/API";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHERE A TELEMETRY FINDING'S DATA WAS SEEN, RECORD BY RECORD.
 *
 * The records a finding was found in, read when the list opens
 * (DataSecurityApi.getFindingOccurrences, issues #5594 and #9549): the very
 * ones the last scan found it in, or those written when it was last seen.
 * Each one says what it is - a log line and its severity, a span and its
 * name, an exception and its type, an AI call, a session, a metric's data
 * point and its metric - when it was written and which service sent it,
 * and shows the line itself: the value
 * at the finding's place, cut around the data, which is marked, with every
 * sensitive value in it masked. Each opens where the rest of OneUptime
 * shows it (FindingOccurrenceLinks), whole, to whoever may read that
 * telemetry. The first few show; the rest are a click away.
 */

export const FINDING_OCCURRENCES_TEST_ID: string =
  "data-security-finding-occurrences";

// How many records show before "Show more".
export const RECORDS_SHOWN_FIRST: number = 3;

export const RECORD_KIND_TITLES: Readonly<
  Record<DataSecurityOccurrenceRecordKind, string>
> = {
  [DataSecurityOccurrenceRecordKind.Log]: translationKey("Log line"),
  [DataSecurityOccurrenceRecordKind.Span]: translationKey("Span"),
  [DataSecurityOccurrenceRecordKind.Exception]: translationKey("Exception"),
  [DataSecurityOccurrenceRecordKind.AiCall]: translationKey("AI call"),
  [DataSecurityOccurrenceRecordKind.Session]: translationKey("Session"),
  [DataSecurityOccurrenceRecordKind.Metric]: translationKey("Metric"),
};

const RECORD_KIND_ICONS: Readonly<
  Record<DataSecurityOccurrenceRecordKind, IconProp>
> = {
  [DataSecurityOccurrenceRecordKind.Log]: IconProp.Logs,
  [DataSecurityOccurrenceRecordKind.Span]: IconProp.Waterfall,
  [DataSecurityOccurrenceRecordKind.Exception]: IconProp.Bug,
  [DataSecurityOccurrenceRecordKind.AiCall]: IconProp.Bolt,
  [DataSecurityOccurrenceRecordKind.Session]: IconProp.Play,
  [DataSecurityOccurrenceRecordKind.Metric]: IconProp.ChartBar,
};

export const LINK_TITLES: Readonly<Record<OccurrenceLinkKind, string>> = {
  [OccurrenceLinkKind.Trace]: translationKey("Open trace"),
  [OccurrenceLinkKind.Logs]: translationKey("Open in Logs"),
  [OccurrenceLinkKind.Exception]: translationKey("Open exception"),
  [OccurrenceLinkKind.SessionReplay]: translationKey("Open session replay"),
  [OccurrenceLinkKind.Metrics]: translationKey("Open in Metrics"),
};

const LINK_ICONS: Readonly<Record<OccurrenceLinkKind, IconProp>> = {
  [OccurrenceLinkKind.Trace]: IconProp.Waterfall,
  [OccurrenceLinkKind.Logs]: IconProp.Logs,
  [OccurrenceLinkKind.Exception]: IconProp.Bug,
  [OccurrenceLinkKind.SessionReplay]: IconProp.Play,
  [OccurrenceLinkKind.Metrics]: IconProp.ChartBar,
};

export const UNAVAILABLE_SENTENCES: Readonly<
  Record<DataSecurityOccurrencesUnavailableReason, string>
> = {
  [DataSecurityOccurrencesUnavailableReason.NoTelemetryAccess]: translationKey(
    "You need permission to read this telemetry to see the records it was seen in.",
  ),
  [DataSecurityOccurrencesUnavailableReason.UnreadableLocation]: translationKey(
    "Records cannot be looked up at this location.",
  ),
  [DataSecurityOccurrencesUnavailableReason.NoOwner]: translationKey(
    "The service this telemetry was sent under no longer exists, so its records cannot be looked up.",
  ),
};

// The newest records of the last days: a finding no scan has seen.
export const NONE_IN_WINDOW: string = translationKey(
  "No record written in the last 7 days carries it.",
);

/*
 * Neither sentence is a plural: each reads right for any count in every
 * language, as a "one" form with no count in it could not - Russian reads
 * its "one" form for 21 records too.
 */
export const NONE_IN_NEWEST: string = translationKey(
  "None of the newest records with a value here carries it ({{count}} read).",
);

// MAX_OCCURRENCES (TelemetryFindingOccurrences): at most 10 records.
export const RECORDS_FOOTNOTE: string = translationKey(
  "The newest records from the last 7 days that carry it, up to 10. Values are masked: open a record to see it in full.",
);

// The records the last scan kept: gone once telemetry retention ends.
export const NO_LONGER_KEPT: string = translationKey(
  "The records it was found in {{time}} are no longer kept.",
);

// The hour the last scan read, searched: none of its records carry it.
export const NONE_FROM_LAST_SEEN: string = translationKey(
  "No record kept from when it was last seen, {{time}}, carries it.",
);

// The same, when the read stopped at its limit: never fewer than a few.
export const NONE_OF_READ_FROM_LAST_SEEN: string = translationKey(
  "None of the {{count}} records read from when it was last seen, {{time}}, carries it.",
);

export const SAMPLED_RECORDS_FOOTNOTE: string = translationKey(
  "The records the last scan found it in. Values are masked: open a record to see it in full.",
);

export const SAMPLE_WINDOW_FOOTNOTE: string = translationKey(
  "Records from when it was last seen that carry it. Values are masked: open a record to see it in full.",
);

export const SHOW_MORE_RECORDS: PluralTemplate = {
  one: "Show {{count}} more record",
  other: "Show {{count}} more records",
};

export const SHOW_FEWER_RECORDS: string = translationKey("Show fewer records");

const FOOTNOTES: Readonly<Record<DataSecurityOccurrencesSource, string>> = {
  [DataSecurityOccurrencesSource.SampledRecords]: SAMPLED_RECORDS_FOOTNOTE,
  [DataSecurityOccurrencesSource.SampleWindow]: SAMPLE_WINDOW_FOOTNOTE,
  [DataSecurityOccurrencesSource.Recent]: RECORDS_FOOTNOTE,
};

/*
 * A monospace block's own children keep its font: every frontend gives
 * every element Inter (index.ejs), which a <mark> inside would otherwise
 * take.
 */
const EXCERPT_CLASS_NAME: string =
  "mt-1.5 whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 font-mono text-xs leading-5 text-gray-800 [&_*]:[font-family:inherit] [overflow-wrap:anywhere]";

// The finding's data, marked: what the line is shown for.
export const MATCH_CLASS_NAME: string =
  "rounded-sm bg-yellow-100 px-0.5 font-semibold text-gray-900";

// Other sensitive data beside it: masked, set apart, not marked.
export const MASKED_CLASS_NAME: string =
  "rounded-sm bg-gray-200 px-0.5 text-gray-700";

export interface ComponentProps {
  findingId: ObjectID;
  // The service or RUM application the records were sent under.
  ownerName?: string | undefined;
  /*
   * What shows under the sentence when there is no record to show: the
   * finding's masked samples, so what was found is still in view.
   */
  fallback?: ReactElement | undefined;
}

// A log line's severity, in the tone of what it says.
function getSeverityTone(severity: string): PillTone {
  const word: string = severity.trim().toLowerCase();

  if (word.startsWith("fatal") || word.startsWith("err") || word === "crit") {
    return PillTone.Danger;
  }

  return word.startsWith("warn") ? PillTone.Warning : PillTone.Neutral;
}

export const OccurrenceExcerptBlock: FunctionComponent<{
  excerpt: DataSecurityOccurrenceExcerpt;
}> = (props: { excerpt: DataSecurityOccurrenceExcerpt }): ReactElement => {
  const excerpt: DataSecurityOccurrenceExcerpt = props.excerpt;

  return (
    <pre
      dir="ltr"
      className={EXCERPT_CLASS_NAME}
      data-testid="data-security-finding-occurrence-excerpt"
    >
      {excerpt.field ? (
        <span className="text-gray-500">{`${excerpt.field}: `}</span>
      ) : (
        <></>
      )}
      {excerpt.isCutAtStart ? (
        <span className="text-gray-400" aria-hidden="true">
          …
        </span>
      ) : (
        <></>
      )}
      {excerpt.parts.map(
        (
          part: DataSecurityOccurrenceExcerptPart,
          index: number,
        ): ReactElement => {
          if (part.kind === DataSecurityOccurrenceExcerptPartKind.Match) {
            return (
              <mark
                key={index}
                className={MATCH_CLASS_NAME}
                data-testid="data-security-finding-occurrence-value"
              >
                {part.text}
              </mark>
            );
          }

          if (part.kind === DataSecurityOccurrenceExcerptPartKind.Masked) {
            return (
              <span
                key={index}
                className={MASKED_CLASS_NAME}
                data-testid="data-security-finding-occurrence-masked"
              >
                {part.text}
              </span>
            );
          }

          return <React.Fragment key={index}>{part.text}</React.Fragment>;
        },
      )}
      {excerpt.isCutAtEnd ? (
        <span className="text-gray-400" aria-hidden="true">
          …
        </span>
      ) : (
        <></>
      )}
    </pre>
  );
};

const OccurrenceRow: FunctionComponent<{
  occurrence: DataSecurityFindingOccurrence;
  ownerName?: string | undefined;
}> = (props: {
  occurrence: DataSecurityFindingOccurrence;
  ownerName?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const occurrence: DataSecurityFindingOccurrence = props.occurrence;
  const links: Array<OccurrenceLink> = getOccurrenceLinks(occurrence);
  const time: Date = OneUptimeDate.fromString(occurrence.time);
  const name: string = occurrence.name || "";
  const ownerName: string = (props.ownerName || "").trim();

  return (
    <li className="px-3 py-2.5" data-testid="data-security-finding-occurrence">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-gray-900">
          <Icon
            icon={RECORD_KIND_ICONS[occurrence.recordKind] || IconProp.Logs}
            className="h-4 w-4 shrink-0 text-gray-400"
          />
          <span className="font-medium">
            {translator.translateText(
              RECORD_KIND_TITLES[occurrence.recordKind] ||
                occurrence.recordKind,
            )}
          </span>
          {name ? (
            <span className="min-w-0 text-gray-700 [overflow-wrap:anywhere]">
              <IsolatedText text={name} />
            </span>
          ) : (
            <></>
          )}
          {occurrence.severity ? (
            <Pill
              text={occurrence.severity}
              isUserContent={true}
              tone={getSeverityTone(occurrence.severity)}
              isDotHidden={true}
              dataTestId="data-security-finding-occurrence-severity"
            />
          ) : (
            <></>
          )}
          <span
            className="whitespace-nowrap text-xs text-gray-500"
            title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              time,
            )}
            data-testid="data-security-finding-occurrence-time"
          >
            {OneUptimeDate.fromNow(time)}
          </span>
          {/*
           * The service's own icon sets it apart: a dot before it would start
           * the line it wraps to on a phone.
           */}
          {ownerName ? (
            <span
              className="inline-flex min-w-0 items-center gap-1 text-xs text-gray-500"
              data-testid="data-security-finding-occurrence-service"
            >
              <Icon
                icon={IconProp.SquareStack}
                className="h-3.5 w-3.5 shrink-0 text-gray-400"
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <IsolatedText text={ownerName} />
              </span>
            </span>
          ) : (
            <></>
          )}
        </div>
        {links.length > 0 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
            {links.map((link: OccurrenceLink): ReactElement => {
              return (
                <AppLink
                  key={link.kind}
                  className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline"
                  to={link.route}
                >
                  <Icon icon={LINK_ICONS[link.kind]} className="h-4 w-4" />
                  <span>
                    {translator.translateText(LINK_TITLES[link.kind])}
                  </span>
                </AppLink>
              );
            })}
          </div>
        ) : (
          <></>
        )}
      </div>
      {occurrence.excerpt ? (
        <OccurrenceExcerptBlock excerpt={occurrence.excerpt} />
      ) : (
        <code
          className="mt-1.5 inline-block rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 [overflow-wrap:anywhere]"
          data-testid="data-security-finding-occurrence-value"
        >
          {occurrence.maskedValue}
        </code>
      )}
    </li>
  );
};

/*
 * Why there is no record to show, in a sentence: where the records were
 * read says what "none" means. Exported so a test reads each one.
 */
export function getNoRecordSentence(
  translator: Translator,
  result: DataSecurityFindingOccurrences,
): string {
  if (result.unavailableReason) {
    const sentence: string =
      UNAVAILABLE_SENTENCES[result.unavailableReason] ||
      UNAVAILABLE_SENTENCES[
        DataSecurityOccurrencesUnavailableReason.UnreadableLocation
      ];

    return translator.translateText(sentence) || sentence;
  }

  const lastSeen: string = OneUptimeDate.fromNow(
    OneUptimeDate.fromString(result.lastSeenAt || result.until),
  );

  if (result.source === DataSecurityOccurrencesSource.SampledRecords) {
    return translator.translateTemplate(NO_LONGER_KEPT, { time: lastSeen });
  }

  if (result.source === DataSecurityOccurrencesSource.SampleWindow) {
    return result.isComplete
      ? translator.translateTemplate(NONE_FROM_LAST_SEEN, { time: lastSeen })
      : translator.translateTemplate(NONE_OF_READ_FROM_LAST_SEEN, {
          count: translator.formatNumber(result.recordsRead),
          time: lastSeen,
        });
  }

  return result.isComplete
    ? translator.translateText(NONE_IN_WINDOW) || NONE_IN_WINDOW
    : translator.translateTemplate(NONE_IN_NEWEST, {
        count: translator.formatNumber(result.recordsRead),
      });
}

const FindingOccurrences: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const findingId: string = props.findingId.toString();
  const [result, setResult] = useState<DataSecurityFindingOccurrences | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [isShowingAll, setIsShowingAll] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    setResult(null);
    setError("");
    setIsShowingAll(false);

    DataSecurityApi.getFindingOccurrences(new ObjectID(findingId))
      .then((answer: DataSecurityFindingOccurrences) => {
        if (isCurrent) {
          setResult(answer);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [findingId, readCount]);

  if (error) {
    return (
      <div data-testid={FINDING_OCCURRENCES_TEST_ID}>
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            setReadCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      </div>
    );
  }

  if (!result) {
    return (
      <div data-testid={FINDING_OCCURRENCES_TEST_ID} aria-busy="true">
        <CardListSkeleton count={2} lines={1} />
      </div>
    );
  }

  if (result.unavailableReason || result.occurrences.length === 0) {
    return (
      <div className="space-y-3" data-testid={FINDING_OCCURRENCES_TEST_ID}>
        <p
          className="text-sm text-gray-500"
          data-testid="data-security-finding-occurrences-none"
        >
          {getNoRecordSentence(translator, result)}
        </p>
        {props.fallback || <></>}
      </div>
    );
  }

  const hidden: number = Math.max(
    0,
    result.occurrences.length - RECORDS_SHOWN_FIRST,
  );
  const shown: Array<DataSecurityFindingOccurrence> = isShowingAll
    ? result.occurrences
    : result.occurrences.slice(0, RECORDS_SHOWN_FIRST);

  return (
    <div data-testid={FINDING_OCCURRENCES_TEST_ID}>
      <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
        {shown.map(
          (
            occurrence: DataSecurityFindingOccurrence,
            index: number,
          ): ReactElement => {
            return (
              <OccurrenceRow
                key={`${occurrence.time}-${occurrence.traceId || ""}-${occurrence.spanId || ""}-${index}`}
                occurrence={occurrence}
                ownerName={props.ownerName}
              />
            );
          },
        )}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          className="mt-2 text-sm font-medium text-indigo-600 hover:underline"
          aria-expanded={isShowingAll}
          data-testid="data-security-finding-occurrences-more"
          onClick={() => {
            setIsShowingAll(!isShowingAll);
          }}
        >
          {isShowingAll
            ? translator.translateText(SHOW_FEWER_RECORDS)
            : translator.translatePlural(SHOW_MORE_RECORDS, hidden)}
        </button>
      ) : (
        <></>
      )}
      <p className="mt-2 text-xs text-gray-500">
        {translator.translateText(
          FOOTNOTES[result.source || DataSecurityOccurrencesSource.Recent],
        )}
      </p>
    </div>
  );
};

export default FindingOccurrences;
