import { getTurnDurationText } from "./CodeTaskTurn";
import { CodeTaskTurnJSON } from "Common/Types/AI/CodeTask";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useClockTick from "Common/UI/Utils/UseClockTick";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  turns: Array<CodeTaskTurnJSON>;
  className?: string | undefined;
}

/*
 * How long AI has worked on a task, over all its turns: what each took,
 * and the one at work so far, counted on its own clock. Nothing is said
 * before AI started.
 */
export const getTaskWorkMilliseconds: (
  turns: Array<CodeTaskTurnJSON>,
  now: Date,
) => number = (turns: Array<CodeTaskTurnJSON>, now: Date): number => {
  let total: number = 0;

  for (const turn of turns) {
    if (!turn.startedAt) {
      continue;
    }

    const start: number = new Date(turn.startedAt).getTime();
    const end: number = turn.completedAt
      ? new Date(turn.completedAt).getTime()
      : now.getTime();

    if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
      total += end - start;
    }
  }

  return total;
};

const CodeTaskWorkTime: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isWorking: boolean = props.turns.some(
    (turn: CodeTaskTurnJSON): boolean => {
      return Boolean(turn.startedAt) && !turn.completedAt;
    },
  );
  const now: Date = useClockTick(false, { isEnabled: isWorking });
  const total: number = getTaskWorkMilliseconds(props.turns, now);

  if (
    !props.turns.some((turn: CodeTaskTurnJSON): boolean => {
      return Boolean(turn.startedAt);
    })
  ) {
    return <></>;
  }

  const duration: string = getTurnDurationText({
    start: new Date(0),
    end: new Date(total),
    translator,
  });

  return (
    <span
      data-testid="code-task-work-time"
      className={`whitespace-nowrap ${props.className || ""}`}
    >
      {isWorking
        ? translator.translateTemplate("{{duration}} so far", { duration })
        : translator.translateTemplate("worked {{duration}}", { duration })}
    </span>
  );
};

export default CodeTaskWorkTime;
