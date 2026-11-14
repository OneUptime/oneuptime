import { getTurnDurationText } from "./CodeTaskTurn";
import { CodeTaskTurnJSON } from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useClockTick from "Common/UI/Utils/UseClockTick";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  turns: Array<CodeTaskTurnJSON>;
  /*
   * How long AI worked on the turns a long task's page does not show
   * (CodeTaskResponse.turnsNotShown): counted with the turns shown.
   */
  notShownMilliseconds?: number | undefined;
  className?: string | undefined;
  /*
   * A clock before the words, beside facts that each have their mark (a
   * task page's repository and branch).
   */
  hasClock?: boolean | undefined;
}

/*
 * How long AI has worked on a task, over all its turns: what each took,
 * and the one at work so far, counted on its own clock - the turns a long
 * task's page does not show included. Nothing is said before AI started.
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
  const notShownMilliseconds: number =
    props.notShownMilliseconds && props.notShownMilliseconds > 0
      ? props.notShownMilliseconds
      : 0;
  const total: number =
    getTaskWorkMilliseconds(props.turns, now) + notShownMilliseconds;

  if (
    notShownMilliseconds === 0 &&
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
      className={`whitespace-nowrap ${
        props.hasClock ? "inline-flex items-center gap-1" : ""
      } ${props.className || ""}`}
    >
      {props.hasClock ? (
        <Icon
          icon={IconProp.Clock}
          className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
        />
      ) : (
        <></>
      )}
      {isWorking
        ? translator.translateTemplate("{{duration}} so far", { duration })
        : translator.translateTemplate("worked {{duration}}", { duration })}
    </span>
  );
};

export interface CodeTaskTurnDurationProps {
  startedAt: string;
  completedAt?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * How long a task's latest turn took - "worked 4 minutes" - or, while AI
 * is at it, has so far, on its own clock: a list row's, and an insight's
 * Fix task card's.
 */
export const CodeTaskTurnDuration: FunctionComponent<
  CodeTaskTurnDurationProps
> = (props: CodeTaskTurnDurationProps): ReactElement => {
  const translator: Translator = useTranslator();
  const now: Date = useClockTick(false, { isEnabled: !props.completedAt });
  const start: Date = new Date(props.startedAt);
  const end: Date = props.completedAt ? new Date(props.completedAt) : now;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return <></>;
  }

  const duration: string = getTurnDurationText({ start, end, translator });

  return (
    <span data-testid={props.dataTestId || "code-task-row-duration"}>
      {props.completedAt
        ? translator.translateTemplate("worked {{duration}}", { duration })
        : translator.translateTemplate("{{duration}} so far", { duration })}
    </span>
  );
};

export default CodeTaskWorkTime;
