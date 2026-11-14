import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * THE LINE UNDER A METRIC PICKER: WHAT THE CHOSEN METRIC IS, AND ITS NAME.
 *
 * A metric catalog's description writes what a reader types as code, in
 * backticks: the datapoint attribute a series is fanned out by ("by the
 * `status` datapoint attribute"), a filter (`status = red`), another
 * metric's name. Drawn as text, the VMware, OpenStack and Kubernetes
 * pickers showed the backticks (#7883). Here each backticked part is drawn
 * as code, as the metric's own name is, and the rest as the words around it.
 *
 * Each piece of code reads from the left in an isolate of its own
 * (dir="ltr"). Cut out of its sentence, it is no longer part of what the
 * code-in-sentence rules set apart (Common/UI/Utils/CodeReadsAsWritten), and
 * in an Arabic or Persian line a flag's dashes or a unit's braces would be
 * drawn at its other end.
 */

export interface MetricDescriptionPart {
  text: string;
  isCode: boolean;
}

/*
 * A description in pieces: each part between a pair of backticks is code,
 * the rest is words. Backticks that do not pair leave the whole text as
 * words, as FeedMarkdown.textWithCode does.
 */
export const getMetricDescriptionParts: (
  description: string,
) => Array<MetricDescriptionPart> = (
  description: string,
): Array<MetricDescriptionPart> => {
  const pieces: Array<string> = description.split("`");

  if (pieces.length % 2 === 0) {
    return description ? [{ text: description, isCode: false }] : [];
  }

  return pieces
    .map((text: string, index: number): MetricDescriptionPart => {
      return { text: text, isCode: index % 2 === 1 };
    })
    .filter((part: MetricDescriptionPart): boolean => {
      return part.text.length > 0;
    });
};

const drawCode: (text: string, key?: string | undefined) => ReactElement = (
  text: string,
  key?: string | undefined,
): ReactElement => {
  return (
    <code key={key} dir="ltr" className="bg-gray-100 px-1 rounded text-xs">
      {text}
    </code>
  );
};

export interface ComponentProps {
  // The catalog's description as it is written: in English, its code in backticks.
  description: string;
  metricName: string;
}

const MetricPickerDescription: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const description: string =
    translator.translateText(props.description) || props.description;

  return (
    <p
      className="mt-2 text-xs text-gray-500"
      data-testid="metric-picker-description"
    >
      <TranslatedSentence
        template="{{description}} — Metric: {{metric}}"
        slots={{
          description: (
            <Fragment>
              {getMetricDescriptionParts(description).map(
                (part: MetricDescriptionPart, index: number): ReactElement => {
                  return part.isCode ? (
                    drawCode(part.text, `code-${index}`)
                  ) : (
                    <Fragment key={`words-${index}`}>{part.text}</Fragment>
                  );
                },
              )}
            </Fragment>
          ),
          metric: drawCode(props.metricName),
        }}
      />
    </p>
  );
};

export default MetricPickerDescription;
