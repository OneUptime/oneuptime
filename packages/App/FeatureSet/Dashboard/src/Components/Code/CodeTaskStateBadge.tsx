import {
  CODE_TASK_STATE_COPY,
  CodeTaskStateCopy,
  QUEUED_LABEL,
} from "./CodeTaskCopy";
import { CODE_TASK_STAGE_COPY } from "./CodeTaskStatusCopy";
import { CodeTaskState } from "Common/Types/AI/CodeTask";
import { CodeTaskStage } from "Common/Types/AI/CodeTaskStage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  state: CodeTaskState;
  // Working, but no Runner has picked it up: says Queued instead.
  isQueued?: boolean | undefined;
  /*
   * Queued for an attempt AI makes by itself, at a set time: says Retrying,
   * as the insight it fixes and the insights list say.
   */
  isRetrying?: boolean | undefined;
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
  const isWorking: boolean = props.state === CodeTaskState.Working;
  const isRetrying: boolean = isWorking && Boolean(props.isRetrying);
  const copy: Pick<
    CodeTaskStateCopy,
    "label" | "badgeClassName" | "dotClassName"
  > = isRetrying
    ? CODE_TASK_STAGE_COPY[CodeTaskStage.Retrying]
    : CODE_TASK_STATE_COPY[props.state];
  // The dot pulses while AI is at it, or about to try again.
  const isLive: boolean = isRetrying || (isWorking && !props.isQueued);

  return (
    <span
      data-testid="code-task-state"
      data-state={props.state}
      data-retrying={isRetrying ? "true" : undefined}
      className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${copy.badgeClassName} ${props.className || ""}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {isLive ? (
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
        isRetrying
          ? copy.label
          : isWorking && props.isQueued
            ? QUEUED_LABEL
            : copy.label,
      )}
    </span>
  );
};

export default CodeTaskStateBadge;
