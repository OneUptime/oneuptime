import IconProp from "Common/Types/Icon/IconProp";
import { RunbookVariableScope } from "Common/Types/Runbook/RunbookVariableReference";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import Clipboard from "Common/UI/Utils/Clipboard";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  RunbookVariableChoice,
  RunbookVariableChoices,
} from "./RunbookVariableChoices";
import { COPY_REFERENCE_TITLE } from "../RunbookVariableCopy";

/*
 * Under a step's script, in the panel beside its examples: the variables it
 * can use, as chips that copy what to write ({{global.variables.NAME}}) - so
 * nobody has to remember the spelling, and the value never appears in the
 * step. Laid out as the examples are (a label, then the chips), so the
 * panel reads as one. With none yet, one line says how a script names one.
 */

export interface ComponentProps {
  choices: RunbookVariableChoices;
  dataTestId: string;
}

// The most chips shown; the rest are on the variables pages.
export const MAX_VARIABLE_CHIPS: number = 12;

const RunbookVariableChips: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [copied, setCopied] = useState<string>("");

  const variables: Array<RunbookVariableChoice> = props.choices.variables;

  if (variables.length === 0) {
    return (
      <p
        className="text-xs text-gray-500"
        data-testid={`${props.dataTestId}-none`}
      >
        <TranslatedSentence
          template="Use a variable in the script as {{reference}}."
          slots={{
            reference: <code>{"{{global.variables.NAME}}"}</code>,
          }}
        />
      </p>
    );
  }

  const shown: Array<RunbookVariableChoice> = variables.slice(
    0,
    MAX_VARIABLE_CHIPS,
  );
  const more: number = variables.length - shown.length;

  return (
    <div data-testid={props.dataTestId}>
      <div className="mb-2 flex items-center gap-1.5">
        <Icon
          icon={IconProp.Variable}
          size={SizeProp.Smaller}
          className="text-gray-500"
        />
        <span className="text-xs font-medium text-gray-700">
          {translator.translateText("Variables — click to copy")}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((choice: RunbookVariableChoice) => {
          const isCopied: boolean = copied === choice.reference;

          return (
            <button
              key={choice.reference}
              type="button"
              title={choice.reference}
              /*
               * Named for what pressing it does, as the variables list's
               * copy buttons are: the chip's own words are in the name.
               */
              aria-label={translator.translateTemplate(COPY_REFERENCE_TITLE, {
                reference: choice.reference,
              })}
              onClick={async () => {
                const succeeded: boolean = await Clipboard.copyToClipboard(
                  choice.reference,
                );

                if (succeeded) {
                  setCopied(choice.reference);
                  setTimeout(() => {
                    setCopied("");
                  }, 1500);
                }
              }}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            >
              <Icon
                icon={choice.isSecret ? IconProp.Lock : IconProp.Variable}
                size={SizeProp.Smaller}
                className="h-3 w-3 flex-shrink-0"
              />
              <span className="truncate">
                {choice.scope === RunbookVariableScope.Local
                  ? `local.${choice.name}`
                  : choice.name}
              </span>
              {isCopied ? (
                <span className="font-sans text-[10px] text-indigo-700">
                  {translator.translateText("Copied!")}
                </span>
              ) : null}
            </button>
          );
        })}
        {more > 0 ? (
          <span className="self-center text-xs text-gray-500">
            {translator.translatePlural(
              { one: "{{count}} more", other: "{{count}} more" },
              more,
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default RunbookVariableChips;
