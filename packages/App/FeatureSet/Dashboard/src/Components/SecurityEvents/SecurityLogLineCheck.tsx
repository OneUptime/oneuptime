import { SECURITY_LOG_FORMAT_TEXTS } from "./SecurityConnectionsCopy";
import {
  SecurityEventDetailField,
  buildSecurityEventOverviewFields,
} from "./SecurityEventDetailFields";
import SecurityEventSeverityPill from "./SecurityEventSeverityPill";
import IconProp from "Common/Types/Icon/IconProp";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMATS,
  SECURITY_LOG_FORMAT_ATTRIBUTE,
  SecurityLogFormatDefinition,
} from "Common/Types/SecurityEvent/SecurityLogFormat";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import { PillSize } from "Common/UI/Components/Pill/Pill";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import { isPageRightToLeft } from "Common/UI/Utils/PageLanguage";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SecurityLogParser from "Common/Utils/SecurityEvent/LogParsers/SecurityLogParser";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";

/*
 * "Check a log line" on the Your logs card: paste a line from your logs and
 * see the security event OneUptime makes of it - which kind of record it
 * read it as, how severe, who and what - or that it makes none. It runs the
 * very parsers the every-minute scan runs (Common/Utils/SecurityEvent/
 * LogParsers), in the browser, so nothing is saved or sent: the way to see
 * whether a firewall's CEF, a Windows event or an Azure export is read
 * before waiting for a scan to find one.
 */

export const SECURITY_LOG_LINE_CHECK_ID: string = "security-log-line-check";

// A paste holds a line or a few; past these, the rest is not read.
export const MAX_CHECKED_LINES: number = 20;
export const MAX_SHOWN_EVENTS: number = 5;
// The longest paste read: the longest JSON line the scan reads, and a little.
export const MAX_CHECKED_TEXT_LENGTH: number = 300 * 1024;

// Under the folded section's title: what it is for.
export const LOG_LINE_CHECK_SUMMARY: string = translationKey(
  "Paste a line from your logs to see the security event OneUptime makes of it.",
);

// Under the box's label once it is open: where the line goes, which is nowhere.
export const LOG_LINE_CHECK_PRIVACY: string = translationKey(
  "The line is read here, in your browser: nothing is saved or sent.",
);

// The menu at the end of the box's label row: a line of each kind, checked at once.
export const LOG_LINE_CHECK_EXAMPLES: string = translationKey("Try an example");

/*
 * What a reader checks a line for, from the fields an event's drawer shows
 * (SecurityEventDetailFields): what kind of event it is, what sent it, and
 * the users, hosts, addresses and processes it names - the values cases are
 * grouped by and rules read. The message leads the card already; ids,
 * paths and the request it happened in are left to the drawer.
 */
export const CHECKED_EVENT_FIELD_LABELS: ReadonlyArray<string> = [
  "Event Class",
  "Activity",
  "Status",
  "Vendor",
  "Product",
  "Detection Rule",
  "MITRE Techniques",
  "Principal User",
  "Principal Host",
  "Principal IP",
  "Process",
  "Command Line",
  "Parent Process",
  "Target User",
  "Target Host",
  "Target IP",
  "Target Port",
  "Target Resource",
];

export interface SecurityLogLineCheckResult {
  // Lines read - a pretty-printed JSON record is one.
  linesRead: number;
  events: Array<NormalizedSecurityEvent>;
}

/*
 * The lines of a paste, as the scan would have stored them: a JSON record
 * pasted across lines is one record, minified as a log body holds it; any
 * other paste is one log line a line.
 */
export function splitPastedLogLines(text: string): Array<string> {
  const trimmed: string = text.slice(0, MAX_CHECKED_TEXT_LENGTH).trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return [JSON.stringify(JSON.parse(trimmed))];
    } catch {
      // Not one JSON record: a JSON line each, or text.
    }
  }

  return trimmed
    .split("\n")
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return line.length > 0;
    })
    .slice(0, MAX_CHECKED_LINES);
}

export function checkSecurityLogLines(
  text: string,
): SecurityLogLineCheckResult {
  const lines: Array<string> = splitPastedLogLines(text);
  const events: Array<NormalizedSecurityEvent> = [];

  for (const body of lines) {
    try {
      events.push(
        ...SecurityLogParser.parse({
          body,
          attributes: {},
          time: new Date(),
        }),
      );
    } catch {
      // A line no parser can read makes no event, as in the scan.
    }
  }

  return { linesRead: lines.length, events };
}

// The kind of record an event was read as.
export function getEventLogFormat(
  event: NormalizedSecurityEvent,
): SecurityLogFormatDefinition | undefined {
  const format: unknown = event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE];

  return SECURITY_LOG_FORMATS.find(
    (definition: SecurityLogFormatDefinition): boolean => {
      return definition.format === format;
    },
  );
}

// The fields a checked event shows, in the drawer's order, the empty ones left out.
export function getCheckedEventFields(
  event: NormalizedSecurityEvent,
): Array<SecurityEventDetailField> {
  return buildSecurityEventOverviewFields(event).filter(
    (field: SecurityEventDetailField): boolean => {
      return CHECKED_EVENT_FIELD_LABELS.includes(field.label);
    },
  );
}

export interface ComponentProps {
  icons: Record<SecurityLogFormat, IconProp>;
}

const SecurityLogLineCheck: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const uniqueId: string = useId();
  const labelId: string = `security-log-line-label-${uniqueId}`;
  const privacyId: string = `security-log-line-privacy-${uniqueId}`;
  const [text, setText] = useState<string>("");
  const [result, setResult] = useState<SecurityLogLineCheckResult | null>(null);

  const check: () => void = (): void => {
    setResult(checkSecurityLogLines(text));
  };

  const tryExample: (format: SecurityLogFormatDefinition) => void = (
    format: SecurityLogFormatDefinition,
  ): void => {
    setText(format.example);
    setResult(checkSecurityLogLines(format.example));
  };

  const renderEvent: (
    event: NormalizedSecurityEvent,
    index: number,
  ) => ReactElement = (
    event: NormalizedSecurityEvent,
    index: number,
  ): ReactElement => {
    const format: SecurityLogFormatDefinition | undefined =
      getEventLogFormat(event);
    const fields: Array<SecurityEventDetailField> =
      getCheckedEventFields(event);

    return (
      <li
        key={`${event.eventUid}-${index}`}
        data-testid={`${SECURITY_LOG_LINE_CHECK_ID}-event`}
        className="min-w-0 rounded-lg border border-gray-200 px-3 py-2.5 sm:px-4 sm:py-3"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {format ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-gray-900">
              <Icon
                icon={props.icons[format.format]}
                className="h-4 w-4 flex-shrink-0 text-gray-400"
              />
              <span data-testid={`${SECURITY_LOG_LINE_CHECK_ID}-format`}>
                {translator.translateText(
                  SECURITY_LOG_FORMAT_TEXTS[format.format].title,
                )}
              </span>
            </span>
          ) : (
            <></>
          )}
          <SecurityEventSeverityPill
            severityName={event.severityName}
            size={PillSize.Small}
          />
        </div>
        <p
          className="mt-1.5 break-words text-sm text-gray-900"
          data-testid={`${SECURITY_LOG_LINE_CHECK_ID}-message`}
        >
          {event.message}
        </p>
        {/*
         * What it was read as, and who and what it names, as its drawer
         * on the Events page will say them. In a narrow box (a phone) each
         * field is one line, its label beside its value; once the event's
         * own box has the room, two or three columns, label over value.
         */}
        {fields.length > 0 ? (
          <div className="mt-2.5 border-t border-gray-100 pt-2.5 [container-type:inline-size]">
            <dl
              data-testid={`${SECURITY_LOG_LINE_CHECK_ID}-fields`}
              className="grid grid-cols-1 gap-x-6 gap-y-2 [@container(min-width:30rem)]:grid-cols-2 [@container(min-width:44rem)]:grid-cols-3"
            >
              {fields.map((field: SecurityEventDetailField): ReactElement => {
                return (
                  <div
                    key={field.label}
                    className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-baseline gap-x-3 [@container(min-width:30rem)]:block"
                    data-testid={`${SECURITY_LOG_LINE_CHECK_ID}-field`}
                  >
                    <dt className="text-xs text-gray-500">
                      {translator.translateText(field.label)}
                    </dt>
                    <dd className="break-words text-sm text-gray-900">
                      {/* A value is as the line wrote it: an address, a name, a command. */}
                      <bdi>{field.value}</bdi>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ) : (
          <></>
        )}
      </li>
    );
  };

  return (
    <CollapsibleSection
      title="Check a log line"
      collapsedDescription={LOG_LINE_CHECK_SUMMARY}
      variant="bordered"
      defaultCollapsed={true}
    >
      <div className="space-y-3" data-testid={SECURITY_LOG_LINE_CHECK_ID}>
        <div>
          {/*
           * The box's label, with the examples at the end of its row, as a
           * form field keeps its setup guide link there; its help under it.
           */}
          <div className="flex min-h-[2rem] flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <label
              id={labelId}
              className="block text-sm font-medium text-gray-900"
            >
              {translator.translateText("Log line")}
            </label>
            {/*
             * The menu hangs from the trigger into the card: leftwards from
             * the end of a left-to-right row, rightwards in a right-to-left
             * one, where the trigger sits at the left. The trigger is named
             * by the words it shows: a custom trigger is otherwise called
             * "More options", which a screen reader would read and a voice
             * command could not find.
             */}
            <MoreMenu
              ariaLabel={LOG_LINE_CHECK_EXAMPLES}
              isMenuPortaled={true}
              isMenuLeftAligned={isPageRightToLeft()}
              elementToBeShownInsteadOfButton={
                <button
                  type="button"
                  data-testid={`${SECURITY_LOG_LINE_CHECK_ID}-examples`}
                  className="-me-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {translator.translateText(LOG_LINE_CHECK_EXAMPLES)}
                  <Icon
                    icon={IconProp.ChevronDown}
                    className="h-4 w-4 flex-shrink-0"
                  />
                </button>
              }
            >
              {SECURITY_LOG_FORMATS.map(
                (format: SecurityLogFormatDefinition): ReactElement => {
                  return (
                    <MoreMenuItem
                      key={format.format}
                      icon={props.icons[format.format]}
                      text={SECURITY_LOG_FORMAT_TEXTS[format.format].title}
                      dataTestId={`${SECURITY_LOG_LINE_CHECK_ID}-example-${format.format}`}
                      onClick={() => {
                        tryExample(format);
                      }}
                    />
                  );
                },
              )}
            </MoreMenu>
          </div>
          <p id={privacyId} className="text-sm text-gray-500">
            {translator.translateText(LOG_LINE_CHECK_PRIVACY)}
          </p>
          <TextArea
            ariaLabelledby={labelId}
            ariaDescribedby={privacyId}
            className="mt-2 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            rows={3}
            autoGrow={true}
            maxRows={12}
            value={text}
            disableSpellCheck={true}
            dataTestId={`${SECURITY_LOG_LINE_CHECK_ID}-input`}
            onChange={(value: string) => {
              setText(value);
              setResult(null);
            }}
          />
        </div>

        {/*
         * Button carries md:ml-3, a dialog footer's spacing: cleared here so
         * Check line lines up with the box above it. "Check line", not
         * "Check": the Dashboard's "Check" is a noun (Data Security's issue
         * filter), and German, French and the rest read it as one
         * ("Prüfung") on a button that does something.
         */}
        <div className="[&>*>button]:ml-0 [&>*>button]:md:ml-0 [&>button]:ml-0 [&>button]:md:ml-0">
          <Button
            title="Check line"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            disabled={!text.trim()}
            dataTestId={`${SECURITY_LOG_LINE_CHECK_ID}-run`}
            onClick={check}
          />
        </div>

        <div aria-live="polite">
          {result && result.events.length > 0 ? (
            <div data-testid={`${SECURITY_LOG_LINE_CHECK_ID}-result`}>
              <p className="text-sm font-medium text-gray-900">
                {translator.translatePlural(
                  {
                    one: "OneUptime makes {{count}} security event of this:",
                    other: "OneUptime makes {{count}} security events of this:",
                  },
                  result.events.length,
                )}
              </p>
              <ul className="mt-2 grid grid-cols-1 gap-2">
                {result.events.slice(0, MAX_SHOWN_EVENTS).map(renderEvent)}
              </ul>
              {result.events.length > MAX_SHOWN_EVENTS ? (
                <p
                  className="mt-2 text-xs text-gray-500"
                  data-testid={`${SECURITY_LOG_LINE_CHECK_ID}-more`}
                >
                  {translator.translateTemplate(
                    "Showing the first {{count}}.",
                    {
                      count: translator.formatNumber(MAX_SHOWN_EVENTS),
                    },
                  )}
                </p>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
          {result && result.events.length === 0 ? (
            <div
              className="rounded-lg bg-gray-50 px-4 py-3"
              data-testid={`${SECURITY_LOG_LINE_CHECK_ID}-none`}
            >
              <p className="text-sm font-medium text-gray-900">
                {translator.translateText(
                  "OneUptime makes no security event of this.",
                )}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {translator.translateText(
                  "Only the lines that matter for security become events: sign-ins, changes, refusals and threats. An everyday line, such as a page served or a connection allowed, stays a log.",
                )}
              </p>
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
};

export default SecurityLogLineCheck;
