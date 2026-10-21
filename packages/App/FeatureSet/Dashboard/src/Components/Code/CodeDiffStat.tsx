import { CODE_TASK_DIFF_STAT_LABEL } from "./CodeTaskCopy";
import { CodeTaskChangeStatsJSON } from "Common/Types/AI/CodeTask";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  changes: Pick<CodeTaskChangeStatsJSON, "additions" | "deletions">;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * How much a task changed, the way coding agents and GitHub say it: the
 * lines added in green and the lines taken out in red - "+23 −1". A screen
 * reader hears the same in words.
 */
const CodeDiffStat: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const additions: string = translator.formatNumber(props.changes.additions);
  const deletions: string = translator.formatNumber(props.changes.deletions);

  return (
    <span
      data-testid={props.dataTestId || "code-diff-stat"}
      role="img"
      aria-label={translator.translateTemplate(CODE_TASK_DIFF_STAT_LABEL, {
        additions,
        deletions,
      })}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-xs tabular-nums ${props.className || ""}`}
    >
      <span aria-hidden="true" className="text-emerald-600">
        +{additions}
      </span>
      <span aria-hidden="true" className="text-red-600">
        −{deletions}
      </span>
    </span>
  );
};

export default CodeDiffStat;
