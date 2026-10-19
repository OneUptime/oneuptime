import {
  CODE_TASK_STATE_COPY,
  CodeTaskStateCopy,
  QUEUED_LABEL,
} from "./CodeTaskCopy";
import { CodeTaskState } from "Common/Types/AI/CodeTask";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  state: CodeTaskState;
  // Working, but no Runner has picked it up: says Queued instead.
  isQueued?: boolean | undefined;
  className?: string | undefined;
}

/*
 * A task's state, at a glance: Working (a live dot), Waiting for you, Done,
 * Failed or Stopped - the one thing a person needs to know about a task
 * before they open it.
 */
const CodeTaskStateBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: CodeTaskStateCopy = CODE_TASK_STATE_COPY[props.state];
  const isWorking: boolean = props.state === CodeTaskState.Working;

  return (
    <span
      data-testid="code-task-state"
      data-state={props.state}
      className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${copy.badgeClassName} ${props.className || ""}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {isWorking && !props.isQueued ? (
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping ${copy.dotClassName}`}
          />
        ) : (
          <></>
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${copy.dotClassName}`}
        />
      </span>
      {translator.translateText(
        isWorking && props.isQueued ? QUEUED_LABEL : copy.label,
      )}
    </span>
  );
};

export default CodeTaskStateBadge;
