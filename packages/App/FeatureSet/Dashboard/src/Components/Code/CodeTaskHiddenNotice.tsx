import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { CODE_TASK_HIDDEN_SENTENCE } from "./CodeTaskHiddenCopy";

/*
 * A FIX STRIP'S LINE FOR A CODE TASK HIDDEN FROM ITS READER.
 *
 * A finding's Fix with AI and a profile function's draw the Code task
 * already working on the fix, with a link to it. When a reply carried a
 * private incident or alert into that task which the reader may not open,
 * the server says only that a fix is there (CodeTaskThread
 * .findTasksHiddenFrom), and the strip draws this in place of the link:
 * a lock, as a trace's performance fix marks one, and why nothing of the
 * task shows (CodeTaskHiddenCopy). A status, so a screen reader says it.
 */

export interface ComponentProps {
  dataTestId: string;
}

const CodeTaskHiddenNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="flex items-start gap-2 text-sm text-gray-700"
      role="status"
      data-testid={props.dataTestId}
    >
      <Icon
        icon={IconProp.Lock}
        className="mt-0.5 h-4 w-4 flex-none text-gray-400"
      />
      <p>{translator.translateText(CODE_TASK_HIDDEN_SENTENCE)}</p>
    </div>
  );
};

export default CodeTaskHiddenNotice;
