import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SecurityEventRequestOutcomePill from "./SecurityEventRequestOutcomePill";
import {
  CHECKING_TRACE,
  DATABASE_QUERY_LABEL,
  FROM_ADDRESS,
  SIGNED_IN_AS,
  WHAT_HAPPENED_NEXT_TITLE,
} from "./SecurityEventRequestCopy";
import {
  SecurityEventRequestFacts,
  describeRequest,
  describeWhatHappenedNext,
  getRequestOutcomeColor,
} from "./SecurityEventRequestStory";

export const WHAT_HAPPENED_NEXT_TEST_ID: string =
  "security-event-what-happened-next";

export interface ComponentProps {
  facts: SecurityEventRequestFacts;
  hasTrace: boolean;
  isReadingTrace: boolean;
}

const FactChip: FunctionComponent<{ text: string; title?: string }> = (props: {
  text: string;
  title?: string;
}): ReactElement => {
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-700"
      title={props.title || props.text}
    >
      <span className="truncate">{props.text}</span>
    </span>
  );
};

/*
 * The first thing a responder asks of an attack: did it work? An event
 * made from a log line inside a traced request is followed into that
 * request, and this says what the trace showed - the app turned it away,
 * a handler answered, it broke something, or the injected SQL ran - in one
 * sentence, with who sent it and, when the payload reached the database,
 * the query that holds it.
 *
 * Shown for every event that names a request; nothing for one that does
 * not (the Where it came from section says why it cannot be followed).
 */
const SecurityEventWhatHappenedNext: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const facts: SecurityEventRequestFacts = props.facts;

  if (!props.hasTrace && !facts.outcome) {
    return <></>;
  }

  const sentence: string = describeWhatHappenedNext({
    facts,
    hasTrace: props.hasTrace,
    translator,
  });
  const request: string = describeRequest(facts);
  const chips: Array<{ text: string; title?: string }> = [];

  if (facts.clientAddress) {
    chips.push({
      text: translator.translateTemplate(FROM_ADDRESS, {
        address: facts.clientAddress,
      }),
    });
  }

  if (facts.userId) {
    chips.push({
      text: translator.translateTemplate(SIGNED_IN_AS, { user: facts.userId }),
    });
  }

  if (request) {
    chips.push({ text: request, title: facts.url || request });
  }

  if (facts.userAgent) {
    chips.push({ text: facts.userAgent });
  }

  return (
    <section
      data-testid={WHAT_HAPPENED_NEXT_TEST_ID}
      className="rounded-md border border-gray-200 p-3"
      style={{
        borderLeftWidth: 3,
        borderLeftColor: getRequestOutcomeColor(facts.outcome).toString(),
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          {translator.translateText(WHAT_HAPPENED_NEXT_TITLE)}
        </h3>
        <SecurityEventRequestOutcomePill outcome={facts.outcome} />
      </div>

      {props.isReadingTrace && !facts.outcome ? (
        <p className="mt-1 text-sm text-gray-500">
          {translator.translateText(CHECKING_TRACE)}
        </p>
      ) : (
        sentence && <p className="mt-1 text-sm text-gray-700">{sentence}</p>
      )}

      {facts.databaseStatement && (
        <div className="mt-2">
          <div className="text-xs font-medium text-gray-500">
            {translator.translateText(DATABASE_QUERY_LABEL)}
          </div>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-200 bg-gray-50 p-2 font-mono text-[11px] text-gray-800">
            {facts.databaseStatement}
          </pre>
        </div>
      )}

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map(
            (
              chip: { text: string; title?: string },
              index: number,
            ): ReactElement => {
              return (
                <FactChip
                  key={`${index}-${chip.text}`}
                  text={chip.text}
                  {...(chip.title ? { title: chip.title } : {})}
                />
              );
            },
          )}
        </div>
      )}
    </section>
  );
};

export default SecurityEventWhatHappenedNext;
