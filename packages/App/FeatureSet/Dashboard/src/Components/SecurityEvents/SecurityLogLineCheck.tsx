import { SECURITY_LOG_FORMAT_TEXTS } from "./SecurityConnectionsCopy";
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
import { PillSize } from "Common/UI/Components/Pill/Pill";
import TextArea from "Common/UI/Components/TextArea/TextArea";
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

// Over the box once it is open: where the line goes, which is nowhere.
export const LOG_LINE_CHECK_PRIVACY: string = translationKey(
  "The line is read here, in your browser: nothing is saved or sent.",
);

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

export interface ComponentProps {
  icons: Record<SecurityLogFormat, IconProp>;
}

const SecurityLogLineCheck: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `security-log-line-label-${useId()}`;
  const [text, setText] = useState<string>("");
  const [result, setResult] = useState<SecurityLogLineCheckResult | null>(null);

  const check: () => void = (): void => {
    setResult(checkSecurityLogLines(text));
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

    return (
      <li
        key={`${event.eventUid}-${index}`}
        data-testid={`${SECURITY_LOG_LINE_CHECK_ID}-event`}
        className="min-w-0 rounded-lg border border-gray-200 px-3 py-2.5"
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
        <p className="mt-1 break-words text-sm text-gray-700">
          {event.message}
        </p>
        <p
          className="mt-0.5 break-words text-xs text-gray-500"
          data-testid={`${SECURITY_LOG_LINE_CHECK_ID}-class`}
        >
          {[event.className, event.activityName, event.statusName]
            .filter((part: string): boolean => {
              return Boolean(part);
            })
            .join(" · ")}
        </p>
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
        <p className="text-sm text-gray-600">
          {translator.translateText(LOG_LINE_CHECK_PRIVACY)}
        </p>
        <div>
          <label
            id={labelId}
            className="block text-sm font-medium text-gray-900"
          >
            {translator.translateText("Log line")}
          </label>
          <TextArea
            ariaLabelledby={labelId}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            rows={3}
            value={text}
            disableSpellCheck={true}
            dataTestId={`${SECURITY_LOG_LINE_CHECK_ID}-input`}
            onChange={(value: string) => {
              setText(value);
              setResult(null);
            }}
          />
        </div>

        <div className="text-xs text-gray-500">
          <span>{translator.translateText("Or try an example:")}</span>{" "}
          {SECURITY_LOG_FORMATS.map(
            (format: SecurityLogFormatDefinition, index: number) => {
              return (
                <React.Fragment key={format.format}>
                  {index > 0 ? (
                    <span aria-hidden="true" className="text-gray-300">
                      {" · "}
                    </span>
                  ) : (
                    <></>
                  )}
                  <button
                    type="button"
                    className="rounded font-medium text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    data-testid={`${SECURITY_LOG_LINE_CHECK_ID}-example-${format.format}`}
                    onClick={() => {
                      setText(format.example);
                      setResult(checkSecurityLogLines(format.example));
                    }}
                  >
                    {translator.translateText(
                      SECURITY_LOG_FORMAT_TEXTS[format.format].title,
                    )}
                  </button>
                </React.Fragment>
              );
            },
          )}
        </div>

        <div>
          <Button
            title="Check"
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
