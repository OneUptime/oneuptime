import {
  CODE_TASK_STAGE_COPY,
  CODE_TASK_STAGE_UNKNOWN_LABEL,
  CodeTaskStageCopy,
} from "./CodeTaskStatusCopy";
import { CodeTaskStage } from "Common/Types/AI/CodeTaskStage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // Null: a task is attached, and its state could not be read.
  stage: CodeTaskStage | null;
  dataTestId?: string | undefined;
}

// What a task whose state is not known looks like: attached, no more.
const UNKNOWN_STAGE_COPY: CodeTaskStageCopy = {
  label: CODE_TASK_STAGE_UNKNOWN_LABEL,
  badgeClassName: "bg-purple-50 text-purple-700 ring-purple-600/20",
  dotClassName: "bg-purple-500",
  isLive: false,
};

/*
 * A task in one word, as a badge - "Task in progress", "Pull request
 * open", "Task failed" - beside what it works for: an insight's status,
 * its Fix Task card.
 */
const CodeTaskStageBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: CodeTaskStageCopy = props.stage
    ? CODE_TASK_STAGE_COPY[props.stage]
    : UNKNOWN_STAGE_COPY;

  return (
    <span
      data-testid={props.dataTestId || "code-task-stage"}
      data-stage={props.stage || "Unknown"}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${copy.badgeClassName}`}
    >
      <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
        {copy.isLive ? (
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
      {translator.translateText(copy.label)}
    </span>
  );
};

export default CodeTaskStageBadge;
