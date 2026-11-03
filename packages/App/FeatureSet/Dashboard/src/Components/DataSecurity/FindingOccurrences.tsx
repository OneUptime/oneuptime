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
  DataSecurityOccurrenceRecordKind,
  DataSecurityOccurrencesUnavailableReason,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
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
 * The newest records that carry the finding's data at its location, read
 * when the list opens (DataSecurityApi.getFindingOccurrences, issue #5594):
 * when each was written, what it is - a span and its name, a log line and
 * its severity, an exception and its type, an AI call, a session - the
 * value as it reads masked, and where it opens in the rest of OneUptime
 * (FindingOccurrenceLinks). Nobody sees a raw value here: the record shows
 * it, to whoever may read that telemetry.
 */

export const FINDING_OCCURRENCES_TEST_ID: string =
  "data-security-finding-occurrences";

const READING: string = translationKey("Reading the newest records…");

export const RECORD_KIND_TITLES: Readonly<
  Record<DataSecurityOccurrenceRecordKind, string>
> = {
  [DataSecurityOccurrenceRecordKind.Log]: translationKey("Log line"),
  [DataSecurityOccurrenceRecordKind.Span]: translationKey("Span"),
  [DataSecurityOccurrenceRecordKind.Exception]: translationKey("Exception"),
  [DataSecurityOccurrenceRecordKind.AiCall]: translationKey("AI call"),
  [DataSecurityOccurrenceRecordKind.Session]: translationKey("Session"),
};

const RECORD_KIND_ICONS: Readonly<
  Record<DataSecurityOccurrenceRecordKind, IconProp>
> = {
  [DataSecurityOccurrenceRecordKind.Log]: IconProp.Logs,
  [DataSecurityOccurrenceRecordKind.Span]: IconProp.Waterfall,
  [DataSecurityOccurrenceRecordKind.Exception]: IconProp.Bug,
  [DataSecurityOccurrenceRecordKind.AiCall]: IconProp.Bolt,
  [DataSecurityOccurrenceRecordKind.Session]: IconProp.Play,
};

export const LINK_TITLES: Readonly<Record<OccurrenceLinkKind, string>> = {
  [OccurrenceLinkKind.Trace]: translationKey("Open trace"),
  [OccurrenceLinkKind.Logs]: translationKey("Open in Logs"),
  [OccurrenceLinkKind.Exception]: translationKey("Open exception"),
  [OccurrenceLinkKind.SessionReplay]: translationKey("Open session replay"),
};

const LINK_ICONS: Readonly<Record<OccurrenceLinkKind, IconProp>> = {
  [OccurrenceLinkKind.Trace]: IconProp.Waterfall,
  [OccurrenceLinkKind.Logs]: IconProp.Logs,
  [OccurrenceLinkKind.Exception]: IconProp.Bug,
  [OccurrenceLinkKind.SessionReplay]: IconProp.Play,
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

export interface ComponentProps {
  findingId: ObjectID;
}

const OccurrenceRow: FunctionComponent<{
  occurrence: DataSecurityFindingOccurrence;
}> = (props: { occurrence: DataSecurityFindingOccurrence }): ReactElement => {
  const translator: Translator = useTranslator();
  const occurrence: DataSecurityFindingOccurrence = props.occurrence;
  const links: Array<OccurrenceLink> = getOccurrenceLinks(occurrence);
  const time: Date = OneUptimeDate.fromString(occurrence.time);
  const name: string = occurrence.name || "";

  return (
    <li
      className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
      data-testid="data-security-finding-occurrence"
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          icon={RECORD_KIND_ICONS[occurrence.recordKind] || IconProp.Logs}
          className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
        />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-gray-900">
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
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                <IsolatedText text={occurrence.severity} />
              </span>
            ) : (
              <></>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
            <span
              className="whitespace-nowrap"
              title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                time,
              )}
            >
              {OneUptimeDate.fromNow(time)}
            </span>
            <code
              className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 [overflow-wrap:anywhere]"
              data-testid="data-security-finding-occurrence-value"
            >
              {occurrence.maskedValue}
            </code>
          </div>
        </div>
      </div>
      {links.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 pl-6 sm:pl-0">
          {links.map((link: OccurrenceLink): ReactElement => {
            return (
              <AppLink
                key={link.kind}
                className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline"
                to={link.route}
              >
                <Icon icon={LINK_ICONS[link.kind]} className="h-4 w-4" />
                <span>{translator.translateText(LINK_TITLES[link.kind])}</span>
              </AppLink>
            );
          })}
        </div>
      ) : (
        <></>
      )}
    </li>
  );
};

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

  useEffect(() => {
    let isCurrent: boolean = true;

    setResult(null);
    setError("");

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
      <p
        className="text-sm text-gray-500"
        data-testid={FINDING_OCCURRENCES_TEST_ID}
        aria-busy="true"
      >
        {translator.translateText(READING)}
      </p>
    );
  }

  if (result.unavailableReason) {
    return (
      <p
        className="text-sm text-gray-500"
        data-testid={FINDING_OCCURRENCES_TEST_ID}
      >
        {translator.translateText(
          UNAVAILABLE_SENTENCES[result.unavailableReason] ||
            UNAVAILABLE_SENTENCES[
              DataSecurityOccurrencesUnavailableReason.UnreadableLocation
            ],
        )}
      </p>
    );
  }

  if (result.occurrences.length === 0) {
    return (
      <p
        className="text-sm text-gray-500"
        data-testid={FINDING_OCCURRENCES_TEST_ID}
      >
        {result.isComplete
          ? translator.translateText(NONE_IN_WINDOW)
          : translator.translateTemplate(NONE_IN_NEWEST, {
              count: translator.formatNumber(result.recordsRead),
            })}
      </p>
    );
  }

  return (
    <div data-testid={FINDING_OCCURRENCES_TEST_ID}>
      <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
        {result.occurrences.map(
          (
            occurrence: DataSecurityFindingOccurrence,
            index: number,
          ): ReactElement => {
            return (
              <OccurrenceRow
                key={`${occurrence.time}-${occurrence.traceId || ""}-${occurrence.spanId || ""}-${index}`}
                occurrence={occurrence}
              />
            );
          },
        )}
      </ul>
      <p className="mt-2 text-xs text-gray-500">
        {translator.translateText(RECORDS_FOOTNOTE)}
      </p>
    </div>
  );
};

export default FindingOccurrences;
