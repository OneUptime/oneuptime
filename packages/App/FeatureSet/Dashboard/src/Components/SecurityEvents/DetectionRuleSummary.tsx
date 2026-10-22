import {
  DETECTION_RULE_TYPE_DESCRIPTIONS,
  DetectionRuleShape,
} from "./DetectionRuleShape";
import { formatNameList } from "../AiAccess/AiAccessModes";
import IconProp from "Common/Types/Icon/IconProp";
import { DetectionRuleType } from "Common/Types/SecurityEvent/SigmaCorrelation";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a correlation rule looks for, in one sentence: the Detection Rules
 * form shows it under the YAML as it is typed, and the Rule Library in a
 * rule's details. "Fires when Failed sign-in → Successful sign-in happen in
 * this order for the same principalIp within 10 minutes."
 */

const TIMESPAN_UNITS: Array<{
  seconds: number;
  plural: { one: string; other: string };
}> = [
  {
    seconds: 7 * 24 * 60 * 60,
    plural: { one: "{{count}} week", other: "{{count}} weeks" },
  },
  {
    seconds: 24 * 60 * 60,
    plural: { one: "{{count}} day", other: "{{count}} days" },
  },
  {
    seconds: 60 * 60,
    plural: { one: "{{count}} hour", other: "{{count}} hours" },
  },
  {
    seconds: 60,
    plural: { one: "{{count}} minute", other: "{{count}} minutes" },
  },
  {
    seconds: 1,
    plural: { one: "{{count}} second", other: "{{count}} seconds" },
  },
];

// A timespan in its largest whole unit: "10 minutes", "2 weeks".
export function formatTimespan(
  seconds: number,
  translator: Translator,
): string {
  for (const unit of TIMESPAN_UNITS) {
    if (seconds >= unit.seconds && seconds % unit.seconds === 0) {
      return translator.translatePlural(unit.plural, seconds / unit.seconds);
    }
  }

  return translator.translatePlural(
    { one: "{{count}} second", other: "{{count}} seconds" },
    seconds,
  );
}

/*
 * The sentence names the rules a correlation reads and the fields it groups
 * or counts by. Each is wrapped in a pair of marks - private-use characters
 * no title, field name or translation holds - so the summary can draw a
 * rule's title apart from the words around it, and a field as the column
 * name it is, wherever a language puts them in the sentence.
 */
const RULE_START: string = "";
const RULE_END: string = "";
const FIELD_START: string = "";
const FIELD_END: string = "";
const MARKS: ReadonlyArray<string> = [
  "",
  RULE_START,
  RULE_END,
  FIELD_START,
  FIELD_END,
];

export interface DetectionRuleSentencePart {
  kind: "text" | "rule" | "field";
  text: string;
}

// The text without any mark: a title or field that holds one cannot cut the sentence.
function withoutMarks(text: string): string {
  let result: string = "";

  for (const character of text) {
    if (!MARKS.includes(character)) {
      result += character;
    }
  }

  return result;
}

function markRule(title: string): string {
  return `${RULE_START}${withoutMarks(title)}${RULE_END}`;
}

function markField(field: string): string {
  return `${FIELD_START}${withoutMarks(field)}${FIELD_END}`;
}

// A marked sentence in its parts, read once from start to end.
export function splitMarkedSentence(
  sentence: string,
): Array<DetectionRuleSentencePart> {
  const parts: Array<DetectionRuleSentencePart> = [];
  let kind: DetectionRuleSentencePart["kind"] = "text";
  let current: string = "";

  const flush: () => void = (): void => {
    if (current) {
      parts.push({ kind, text: current });
    }

    current = "";
  };

  for (const character of sentence) {
    if (character === RULE_START || character === FIELD_START) {
      flush();
      kind = character === RULE_START ? "rule" : "field";
    } else if (character === RULE_END || character === FIELD_END) {
      flush();
      kind = "text";
    } else {
      current += character;
    }
  }

  flush();

  return parts;
}

function fieldList(fields: Array<string>): string {
  return fields.map(markField).join(" / ");
}

// The sentence for a correlation's shape; "" for a single rule.
export function describeDetectionRuleShape(
  shape: DetectionRuleShape,
  translator: Translator,
): string {
  return withoutMarks(describeMarkedShape(shape, translator));
}

/*
 * The same sentence in parts: plain words, the titles of the rules it reads,
 * and the fields it names. [] for a single rule.
 */
export function describeDetectionRuleShapeParts(
  shape: DetectionRuleShape,
  translator: Translator,
): Array<DetectionRuleSentencePart> {
  return splitMarkedSentence(describeMarkedShape(shape, translator));
}

function describeMarkedShape(
  shape: DetectionRuleShape,
  translator: Translator,
): string {
  if (!shape.isCorrelation || shape.timespanInSeconds === null) {
    return "";
  }

  const timespan: string = formatTimespan(shape.timespanInSeconds, translator);
  const groupBy: string = fieldList(shape.groupBy);
  const grouped: boolean = shape.groupBy.length > 0;

  switch (shape.type) {
    case DetectionRuleType.EventCount:
      return grouped
        ? translator.translateTemplate(
            "Fires when {{count}} events happen for the same {{groupBy}} within {{timespan}}.",
            { count: String(shape.minimumCount || 1), groupBy, timespan },
          )
        : translator.translateTemplate(
            "Fires when {{count}} events happen within {{timespan}}.",
            { count: String(shape.minimumCount || 1), timespan },
          );

    case DetectionRuleType.ValueCount:
      return grouped
        ? translator.translateTemplate(
            "Fires when the same {{groupBy}} shows {{count}} different {{fields}} values within {{timespan}}.",
            {
              count: String(shape.minimumCount || 1),
              groupBy,
              fields: fieldList(shape.valueFields),
              timespan,
            },
          )
        : translator.translateTemplate(
            "Fires when {{count}} different {{fields}} values show within {{timespan}}.",
            {
              count: String(shape.minimumCount || 1),
              fields: fieldList(shape.valueFields),
              timespan,
            },
          );

    case DetectionRuleType.TemporalOrdered: {
      const steps: string = shape.stepTitles.map(markRule).join(" → ");

      return grouped
        ? translator.translateTemplate(
            "Fires when {{steps}} happen in this order for the same {{groupBy}} within {{timespan}}.",
            { steps, groupBy, timespan },
          )
        : translator.translateTemplate(
            "Fires when {{steps}} happen in this order within {{timespan}}.",
            { steps, timespan },
          );
    }

    case DetectionRuleType.Temporal: {
      const steps: ReturnType<typeof composedValue> = composedValue(
        (sentence: Translator): string => {
          return formatNameList(
            shape.stepTitles.map(markRule),
            "and",
            sentence,
          );
        },
      );
      const everyStep: boolean =
        shape.stepsNeeded === null ||
        shape.stepsNeeded >= shape.stepTitles.length;

      if (everyStep) {
        return grouped
          ? translator.translateTemplate(
              "Fires when {{steps}} all happen for the same {{groupBy}} within {{timespan}}, in any order.",
              { steps, groupBy, timespan },
            )
          : translator.translateTemplate(
              "Fires when {{steps}} all happen within {{timespan}}, in any order.",
              { steps, timespan },
            );
      }

      return grouped
        ? translator.translateTemplate(
            "Fires when {{count}} of {{steps}} happen for the same {{groupBy}} within {{timespan}}, in any order.",
            {
              count: String(shape.stepsNeeded),
              steps,
              groupBy,
              timespan,
            },
          )
        : translator.translateTemplate(
            "Fires when {{count}} of {{steps}} happen within {{timespan}}, in any order.",
            { count: String(shape.stepsNeeded), steps, timespan },
          );
    }

    case DetectionRuleType.NewValue:
      return translator.translateTemplate(
        "Fires the first time a {{groupBy}} shows a {{fields}} it has not shown in {{timespan}}.",
        { groupBy, fields: fieldList(shape.valueFields), timespan },
      );

    default:
      return "";
  }
}

const ICONS: Record<DetectionRuleType, IconProp> = {
  [DetectionRuleType.SingleEvent]: IconProp.ShieldCheck,
  [DetectionRuleType.EventCount]: IconProp.ChartBar,
  [DetectionRuleType.ValueCount]: IconProp.Fingerprint,
  [DetectionRuleType.Temporal]: IconProp.Squares,
  [DetectionRuleType.TemporalOrdered]: IconProp.ArrowRight,
  [DetectionRuleType.NewValue]: IconProp.Sparkles,
};

export function getDetectionRuleTypeIcon(type: DetectionRuleType): IconProp {
  return ICONS[type];
}

/*
 * The kind as a small label: an icon and its name, the way the Detection
 * Rules list and the Rule Library mark a rule's kind.
 */
export const DetectionRuleTypeLabel: FunctionComponent<{
  shape: DetectionRuleShape;
  dataTestId?: string | undefined;
}> = (props: {
  shape: DetectionRuleShape;
  dataTestId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700"
      title={translator.translateText(
        DETECTION_RULE_TYPE_DESCRIPTIONS[props.shape.type],
      )}
      data-testid={props.dataTestId}
    >
      <Icon
        icon={getDetectionRuleTypeIcon(props.shape.type)}
        className="h-3 w-3 flex-shrink-0 text-gray-500"
      />
      {translator.translateText(props.shape.typeTitle)}
    </span>
  );
};

/*
 * A correlation's kind and sentence, as one quiet block: under the YAML in
 * the form, and in the Rule Library's details. Nothing for a single rule.
 */
const DetectionRuleSummary: FunctionComponent<{
  shape: DetectionRuleShape | null;
  dataTestId?: string | undefined;
}> = (props: {
  shape: DetectionRuleShape | null;
  dataTestId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.shape || !props.shape.isCorrelation) {
    return <></>;
  }

  return (
    <div
      className="flex items-start gap-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-900"
      data-testid={props.dataTestId || "detection-rule-summary"}
    >
      <Icon
        icon={getDetectionRuleTypeIcon(props.shape.type)}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600"
      />
      <p className="min-w-0 break-words leading-6">
        <span className="font-semibold">
          {translator.translateText(props.shape.typeTitle)}
        </span>
        {" · "}
        {/*
         * The rules it reads by their titles, set apart from the sentence's
         * own words, and each field as the column name it is.
         */}
        {describeDetectionRuleShapeParts(props.shape, translator).map(
          (part: DetectionRuleSentencePart, index: number): ReactElement => {
            if (part.kind === "rule") {
              return (
                <span
                  key={index}
                  className="font-medium"
                  data-testid="detection-rule-summary-rule"
                >
                  {part.text}
                </span>
              );
            }

            if (part.kind === "field") {
              return (
                <code
                  key={index}
                  className="rounded bg-indigo-100 px-1 py-0.5 font-mono text-xs text-indigo-800"
                  data-testid="detection-rule-summary-field"
                >
                  {part.text}
                </code>
              );
            }

            return <React.Fragment key={index}>{part.text}</React.Fragment>;
          },
        )}
      </p>
    </div>
  );
};

export default DetectionRuleSummary;
