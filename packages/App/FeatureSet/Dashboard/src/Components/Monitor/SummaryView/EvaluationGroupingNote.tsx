import {
  MonitorEvaluationGroupingNote,
  MonitorEvaluationGroupingOutcome,
} from "Common/Types/Monitor/MonitorEvaluationSummary";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What an Incoming Request criteria that groups by a payload field did with
 * a request it matched, among the Monitor Summary's Actions: the server
 * writes the note (MonitorEvaluationGroupingNote) and the same note in
 * English; this words it in the reader's language, with the grouping path
 * drawn as code, so a path such as requestBody.alerts[*].labels.alertname
 * reads as one thing and wraps on a phone instead of running off the row.
 */

// The outcomes whose sentence names no path, and those that name one.
const OUTCOMES_WITHOUT_PATH: Array<MonitorEvaluationGroupingOutcome> = [
  "no-request",
  "re-read",
];
const OUTCOMES_WITH_PATH: Array<MonitorEvaluationGroupingOutcome> = [
  "no-value",
  "values-recovered",
  "no-value-recovered",
  "some-without-value",
];

export const getGroupingNoteTitle: (
  translator: Translator,
  note: MonitorEvaluationGroupingNote,
) => string = (
  translator: Translator,
  note: MonitorEvaluationGroupingNote,
): string => {
  if (note.outcome === "no-value") {
    return translator.translateText("No value to group by") || "";
  }

  if (note.outcome === "no-request") {
    return translator.translateText("No request to group by") || "";
  }

  if (note.outcome === "some-without-value") {
    return (
      translator.translateText("Not every item has a value to group by") || ""
    );
  }

  return translator.translateText("Nothing new to open") || "";
};

/*
 * Whether this Dashboard can word the note: an outcome it knows, with what
 * its sentence names. Anything else - a newer server's outcome, say - is
 * shown as the server wrote it.
 */
export const isWordableGroupingNote: (
  note: MonitorEvaluationGroupingNote | undefined,
) => note is MonitorEvaluationGroupingNote = (
  note: MonitorEvaluationGroupingNote | undefined,
): note is MonitorEvaluationGroupingNote => {
  if (!note) {
    return false;
  }

  if (OUTCOMES_WITHOUT_PATH.includes(note.outcome)) {
    return true;
  }

  if (!OUTCOMES_WITH_PATH.includes(note.outcome) || !note.path) {
    return false;
  }

  // Its sentence says how many items have no value.
  return (
    note.outcome !== "some-without-value" || (note.itemsWithoutValue || 0) > 0
  );
};

export interface ComponentProps {
  note: MonitorEvaluationGroupingNote;
  // The criteria's name, as the criteria list above names it.
  criteriaName: string;
}

const EvaluationGroupingNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { note } = props;

  /*
   * A path reads left to right in every language (dir="ltr" also keeps a
   * right-to-left sentence from reordering it), and breaks anywhere only
   * when it is longer than the line.
   */
  const path: ReactElement = (
    <code
      dir="ltr"
      className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.8125rem] text-gray-800 [overflow-wrap:anywhere]"
      data-testid="evaluation-grouping-path"
    >
      {note.path}
    </code>
  );

  // Named as the list above names it, in the same quotes and weight.
  const criteria: ReactElement = (
    <span dir="auto" className="font-medium text-gray-800">
      “{props.criteriaName}”
    </span>
  );

  const itemsWithoutValue: number = note.itemsWithoutValue || 0;

  // Items of the request with no value, which opened nothing of their own.
  const itemsSentence: ReactElement = (
    <TranslatedSentence
      template={{
        one: "{{count}} item in this request has no value at {{path}}, so it opened nothing of its own.",
        other:
          "{{count}} items in this request have no value at {{path}}, so they opened nothing of their own.",
      }}
      count={itemsWithoutValue}
      slots={{ path: path }}
    />
  );

  switch (note.outcome) {
    case "no-value":
      return (
        <TranslatedSentence
          template="This request has no value at {{path}}, so {{criteria}} handled it without grouping, once for the whole monitor."
          slots={{ path: path, criteria: criteria }}
        />
      );
    case "no-request":
      return (
        <TranslatedSentence
          template="{{criteria}} matched because requests stopped arriving, so it handled this without grouping, once for the whole monitor."
          slots={{ criteria: criteria }}
        />
      );
    case "values-recovered":
      return (
        <>
          <span className="block">
            <TranslatedSentence
              template="Every value at {{path}} in this request reported recovered, so {{criteria}} opened nothing new."
              slots={{ path: path, criteria: criteria }}
            />
          </span>
          {itemsWithoutValue > 0 && (
            <span className="block">{itemsSentence}</span>
          )}
        </>
      );
    case "no-value-recovered":
      return (
        <TranslatedSentence
          template="This request has no value at {{path}} and reported recovered, so {{criteria}} opened nothing new."
          slots={{ path: path, criteria: criteria }}
        />
      );
    case "re-read":
      return (
        <TranslatedSentence
          template="The background check re-read the last request. {{criteria}} opens one per value only when a request arrives."
          slots={{ criteria: criteria }}
        />
      );
    case "some-without-value":
    default:
      return itemsSentence;
  }
};

export default EvaluationGroupingNote;
