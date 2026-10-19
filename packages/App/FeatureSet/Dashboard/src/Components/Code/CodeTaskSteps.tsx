import { CODE_TASK_STEP_ICONS, CODE_TASK_STEP_SENTENCES } from "./CodeTaskCopy";
import { CodeTaskStepJSON, CodeTaskStepKind } from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

// While the AI works, the latest steps show; the rest fold.
export const LIVE_STEPS_SHOWN: number = 6;

export interface ComponentProps {
  steps: Array<CodeTaskStepJSON>;
  // The turn is still running: show the latest steps, open.
  isLive: boolean;
}

// A step in plain words: "Read src/api/users.ts", "Ran npm test".
export const describeStep: (
  step: CodeTaskStepJSON,
  translator: Translator,
) => string = (step: CodeTaskStepJSON, translator: Translator): string => {
  if (
    step.kind === CodeTaskStepKind.Note ||
    step.kind === CodeTaskStepKind.PullRequest
  ) {
    return step.subject;
  }

  return translator.translateTemplate(CODE_TASK_STEP_SENTENCES[step.kind], {
    subject: step.subject,
  });
};

/*
 * What the AI did in a turn, step by step, in plain words: the files it
 * read and edited, what it searched for, the commands it ran, the pull
 * request it opened. While it works, the latest steps show as they happen;
 * once it is done they fold into one line, opened on demand - the reply is
 * what a person reads first.
 */
const CodeTaskSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);

  if (props.steps.length === 0) {
    return <></>;
  }

  const counts: { read: number; edited: number; ran: number } = {
    read: 0,
    edited: 0,
    ran: 0,
  };

  for (const step of props.steps) {
    if (step.kind === CodeTaskStepKind.Read) {
      counts.read++;
    } else if (step.kind === CodeTaskStepKind.Edited) {
      counts.edited++;
    } else if (step.kind === CodeTaskStepKind.Ran) {
      counts.ran++;
    }
  }

  const summaryParts: Array<string> = [
    translator.translatePlural(
      { one: "{{count}} step", other: "{{count}} steps" },
      props.steps.length,
    ),
  ];

  if (counts.read > 0) {
    summaryParts.push(
      translator.translatePlural(
        { one: "read {{count}} file", other: "read {{count}} files" },
        counts.read,
      ),
    );
  }

  if (counts.edited > 0) {
    summaryParts.push(
      translator.translatePlural(
        { one: "edited {{count}} file", other: "edited {{count}} files" },
        counts.edited,
      ),
    );
  }

  if (counts.ran > 0) {
    summaryParts.push(
      translator.translatePlural(
        { one: "ran {{count}} command", other: "ran {{count}} commands" },
        counts.ran,
      ),
    );
  }

  const isExpanded: boolean = props.isLive || isOpen;

  const shownSteps: Array<CodeTaskStepJSON> =
    props.isLive && !isOpen
      ? props.steps.slice(-LIVE_STEPS_SHOWN)
      : props.steps;

  const hiddenCount: number = props.steps.length - shownSteps.length;

  return (
    <div data-testid="code-task-steps" className="text-sm">
      {props.isLive ? (
        <></>
      ) : (
        <button
          type="button"
          aria-expanded={isOpen}
          data-testid="code-task-steps-toggle"
          onClick={() => {
            setIsOpen(!isOpen);
          }}
          className="-ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon
            icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
            className="h-3.5 w-3.5"
          />
          {summaryParts.join(" · ")}
        </button>
      )}

      {isExpanded ? (
        <div
          className={`${props.isLive ? "" : "mt-2"} border-l-2 border-gray-200 pl-3`}
        >
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                setIsOpen(true);
              }}
              className="mb-1 text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              {translator.translatePlural(
                {
                  one: "Show {{count}} earlier step",
                  other: "Show {{count}} earlier steps",
                },
                hiddenCount,
              )}
            </button>
          ) : (
            <></>
          )}
          <ol className="space-y-1">
            {shownSteps.map((step: CodeTaskStepJSON) => {
              return (
                <li
                  key={step.sequence}
                  data-testid="code-task-step"
                  data-step-kind={step.kind}
                  className="flex items-start gap-2 leading-5"
                >
                  <Icon
                    icon={
                      step.isError
                        ? IconProp.ExclaimationCircle
                        : CODE_TASK_STEP_ICONS[step.kind]
                    }
                    className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${
                      step.isError ? "text-red-500" : "text-gray-400"
                    }`}
                  />
                  <span
                    className={`min-w-0 break-words ${
                      step.isError ? "text-red-700" : "text-gray-600"
                    }`}
                  >
                    {step.kind === CodeTaskStepKind.Note ||
                    step.kind === CodeTaskStepKind.PullRequest ? (
                      step.subject
                    ) : (
                      <TranslatedSentence
                        template={CODE_TASK_STEP_SENTENCES[step.kind]}
                        slots={{
                          subject: (
                            <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-700">
                              {step.subject}
                            </code>
                          ),
                        }}
                      />
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CodeTaskSteps;
