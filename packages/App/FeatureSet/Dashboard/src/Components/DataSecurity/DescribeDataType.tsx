import DataSecurityApi from "./DataSecurityApi";
import { DescribeDataTypeCopy } from "./DataTypesToReviewCopy";
import useAiOffered from "../../Utils/UseAiOffered";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { MAX_DESCRIBE_SENTENCE_LENGTH } from "Common/Types/DataSecurity/DataTypeDescribe";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { valueShape } from "Common/Utils/DataSecurity/UnplacedFields";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import {
  CustomDataTypeTestOutcome,
  CustomDataTypeTestResult,
  testCustomDataType,
} from "./CustomDataTypeTest";

/*
 * DESCRIBE IT, ON THE DATA TYPE FORM (#10371).
 *
 * A person says what their data looks like - "our employee IDs look like
 * EMP-123456, sometimes without the dash" - and gives a few examples if
 * they like. Fill In the Form sends OneUptime AI the sentence and the
 * examples' shapes, never the examples (EMP-123456 goes as AAA-999999),
 * and the draft it writes fills the form: its name, category, sensitivity,
 * pattern, keywords and field names - and Test It, with the examples, so
 * the person sees what the pattern finds in them before saving. Nothing is
 * saved until the person saves.
 *
 * Not drawn with the project's AI off; the form is the same without it.
 */

export const DESCRIBE_DATA_TYPE_TEST_ID: string = "describe-data-type";

// The most examples read, and the longest one: what Test It is pasted with.
export const MAX_DESCRIBE_EXAMPLES: number = 20;
const MAX_EXAMPLE_LENGTH: number = 200;

// The examples a person wrote, one to a line, each once.
export function readExamples(text: string): Array<string> {
  const examples: Array<string> = [];

  for (const line of text.split(/\r?\n/)) {
    const example: string = line.trim().slice(0, MAX_EXAMPLE_LENGTH);

    if (example && !examples.includes(example)) {
      examples.push(example);
    }

    if (examples.length >= MAX_DESCRIBE_EXAMPLES) {
      break;
    }
  }

  return examples;
}

/*
 * What is sent of the examples: their shapes, each once - EMP-123456 is
 * AAA-999999. Never an example.
 */
export function toExampleShapes(examples: ReadonlyArray<string>): Array<string> {
  const shapes: Array<string> = [];

  for (const example of examples) {
    const shape: string = valueShape(example);

    if (shape && !shapes.includes(shape)) {
      shapes.push(shape);
    }
  }

  return shapes;
}

/*
 * How many of the examples a drafted type finds, in the browser - as Test
 * It will show them.
 */
export function countExamplesFound(
  values: Record<string, unknown>,
  examples: ReadonlyArray<string>,
): number {
  let found: number = 0;

  for (const example of examples) {
    const result: CustomDataTypeTestResult = testCustomDataType(
      values,
      example,
    );

    if (result.outcome === CustomDataTypeTestOutcome.Found) {
      found++;
    }
  }

  return found;
}

export interface ComponentProps {
  /*
   * Fills the form with the drafted type's values, and Test It with the
   * examples, the way typing them would.
   */
  onDraft: (values: JSONObject, examples: Array<string>) => void;
  ariaDescribedby?: string | undefined;
}

const DescribeDataType: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const sentenceId: string = useId();
  const examplesId: string = useId();
  const examplesHelpId: string = useId();
  const [sentence, setSentence] = useState<string>("");
  const [examplesText, setExamplesText] = useState<string>("");
  const [isDrafting, setIsDrafting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [filled, setFilled] = useState<string>("");

  if (!isAiOffered) {
    return <></>;
  }

  const canDraft: boolean = sentence.trim().length >= 3 && !isDrafting;

  const draft: () => Promise<void> = async (): Promise<void> => {
    if (!canDraft) {
      return;
    }

    const examples: Array<string> = readExamples(examplesText);

    setIsDrafting(true);
    setError("");
    setFilled("");

    try {
      const values: JSONObject = await DataSecurityApi.describeDataType({
        sentence: sentence.trim(),
        // Their shapes only: the examples stay in this browser.
        exampleShapes: toExampleShapes(examples),
      });

      props.onDraft(values, examples);

      if (examples.length === 0) {
        setFilled(
          translator.translateText(DescribeDataTypeCopy.filledNoExamples) ||
            DescribeDataTypeCopy.filledNoExamples,
        );
      } else {
        setFilled(
          translator.translatePlural(
            DescribeDataTypeCopy.filledFinds,
            examples.length,
            {
              found: translator.formatNumber(
                countExamplesFound(values, examples),
              ),
            },
          ),
        );
      }
    } catch (caught) {
      setError(API.getFriendlyMessage(caught));
    }

    setIsDrafting(false);
  };

  return (
    <div
      className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
      data-testid={DESCRIBE_DATA_TYPE_TEST_ID}
    >
      <div className="flex items-start gap-2">
        <Icon
          icon={IconProp.Sparkles}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-500"
        />
        <p className="text-sm text-gray-600" id={props.ariaDescribedby}>
          {translator.translateText(DescribeDataTypeCopy.description)}
        </p>
      </div>
      <div className="space-y-1">
        <label
          id={sentenceId}
          className="block text-sm font-medium text-gray-900"
        >
          {translator.translateText(DescribeDataTypeCopy.sentenceLabel)}
        </label>
        <TextArea
          ariaLabelledby={sentenceId}
          value={sentence}
          rows={2}
          autoGrow={true}
          placeholder={DescribeDataTypeCopy.sentencePlaceholder}
          dataTestId="describe-data-type-sentence"
          onChange={(value: string) => {
            setSentence(value.slice(0, MAX_DESCRIBE_SENTENCE_LENGTH));
          }}
        />
      </div>
      <div className="space-y-1">
        <label
          id={examplesId}
          className="block text-sm font-medium text-gray-900"
        >
          {translator.translateText(DescribeDataTypeCopy.examplesLabel)}
        </label>
        <TextArea
          ariaLabelledby={examplesId}
          ariaDescribedby={examplesHelpId}
          value={examplesText}
          rows={3}
          autoGrow={true}
          disableSpellCheck={true}
          placeholder={DescribeDataTypeCopy.examplesPlaceholder}
          dataTestId="describe-data-type-examples"
          onChange={setExamplesText}
        />
        <p id={examplesHelpId} className="text-xs text-gray-500">
          {translator.translateText(DescribeDataTypeCopy.examplesHelp)}
        </p>
      </div>
      {error ? (
        <p
          role="alert"
          className="break-words text-sm text-red-600"
          data-testid="describe-data-type-error"
        >
          <ErrorInSentence message={error} showWhereToLook={true} />
        </p>
      ) : (
        <></>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          title={DescribeDataTypeCopy.fill}
          icon={IconProp.Sparkles}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          isLoading={isDrafting}
          disabled={!canDraft}
          onClick={() => {
            void draft();
          }}
          dataTestId="describe-data-type-fill"
        />
        {filled ? (
          <span
            role="status"
            className="text-sm text-gray-700"
            data-testid="describe-data-type-filled"
          >
            {filled}
          </span>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default DescribeDataType;
