import { CodeTaskTurnsNotShownJSON } from "Common/Types/AI/CodeTask";
import LabelledDivider from "Common/UI/Components/Divider/LabelledDivider";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

// "5 earlier turns are not shown".
export const CODE_TASK_TURNS_NOT_SHOWN_COPY: PluralTemplate = {
  one: "{{count}} earlier turn is not shown",
  other: "{{count}} earlier turns are not shown",
};

export interface ComponentProps {
  turnsNotShown: CodeTaskTurnsNotShownJSON;
}

/*
 * Where a long task's conversation leaves turns out (issue #6529): a task
 * kept open as a working thread for weeks shows its first turn - what the
 * task is about - and its newest, and between them a hairline that says
 * how many turns it does not show. A conversation reads at most 200 turns
 * (MAX_TURNS_PER_TASK); the task at the top still counts every one: its
 * files changed, how long AI worked, its pull request.
 *
 * One item of the conversation's list, so the list reads in order: the
 * first turn, the turns not shown, then the newest.
 */
const CodeTaskTurnsNotShown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <li data-testid="code-task-turns-not-shown">
      <LabelledDivider
        label={translator.translatePlural(
          CODE_TASK_TURNS_NOT_SHOWN_COPY,
          props.turnsNotShown.count,
        )}
        className="my-0"
        dataTestId="code-task-turns-not-shown-divider"
      />
    </li>
  );
};

export default CodeTaskTurnsNotShown;
