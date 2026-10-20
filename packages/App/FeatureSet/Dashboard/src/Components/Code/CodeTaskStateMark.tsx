import {
  CODE_TASK_STATE_COPY,
  CodeTaskStateCopy,
  QUEUED_LABEL,
} from "./CodeTaskCopy";
import { CodeTaskState } from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  state: CodeTaskState;
  // Working, but no Runner has picked it up yet: a clock, not a spinner.
  isQueued?: boolean | undefined;
  className?: string | undefined;
}

/*
 * A task's state as one mark at the start of its row, the way coding
 * agents list their tasks: a turning ring while AI works (a clock while it
 * waits for a Runner), a speech bubble when it waits for you, a check once
 * done, an exclamation mark when it failed and a stop sign when someone
 * stopped it. Its name is read out, and shown on hover.
 */
const CodeTaskStateMark: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: CodeTaskStateCopy = CODE_TASK_STATE_COPY[props.state];
  const isWorking: boolean = props.state === CodeTaskState.Working;
  const label: string = translator.translateTemplate(
    isWorking && props.isQueued ? QUEUED_LABEL : copy.label,
  );

  // A div: Icon draws one around its svg, which no span may hold.
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      data-testid="code-task-state"
      data-state={props.state}
      data-queued={isWorking && props.isQueued ? "true" : undefined}
      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center ${copy.markClassName} ${props.className || ""}`}
    >
      {isWorking && !props.isQueued ? (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 rounded-full border-2 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin"
        />
      ) : (
        <Icon
          icon={isWorking ? IconProp.Clock : copy.icon}
          className="h-[18px] w-[18px]"
        />
      )}
    </div>
  );
};

export default CodeTaskStateMark;
