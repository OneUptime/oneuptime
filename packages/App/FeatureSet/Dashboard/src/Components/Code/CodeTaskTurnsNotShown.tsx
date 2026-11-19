import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import LabelledDivider from "Common/UI/Components/Divider/LabelledDivider";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

// "5 earlier turns are not shown".
export const CODE_TASK_TURNS_NOT_SHOWN_COPY: PluralTemplate = {
  one: "{{count}} earlier turn is not shown",
  other: "{{count}} earlier turns are not shown",
};

// What reads the turns the line stands for, a page at a time.
export const CODE_TASK_SHOW_EARLIER_TURNS: string =
  translationKey("Show earlier turns");

export interface ComponentProps {
  // How many turns are not shown here.
  count: number;
  /*
   * Read the turns just before the turn after the line (Show earlier
   * turns). Without it the line only says how many are not shown.
   */
  onShow?: (() => void) | undefined;
  // They are being read now.
  isShowing?: boolean | undefined;
  // Why the last read of them failed, said under the line.
  error?: string | null | undefined;
  // Which line this is, while the page holds it (`data-line`).
  line?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * Where a long task's conversation leaves turns out (issue #6529): a task
 * kept open as a working thread for weeks shows its first turn - what the
 * task is about - and its newest, and between them a hairline that says
 * how many turns it does not show. A conversation reads at most 200 turns
 * (MAX_TURNS_PER_TASK); the task at the top still counts every one: its
 * files changed, how long AI worked, its pull request.
 *
 * Under the hairline, Show earlier turns reads the turns just before the
 * ones under it, 50 at a time, and the page draws them there, keeping the
 * reader's place (#7128): the line stays, with fewer to say, until none is
 * left. Its count is a status, so a screen reader hears the new one; the
 * turns themselves are drawn where a screen reader is not told each of
 * them as it arrives.
 *
 * One item of the conversation's list, so the list reads in order: the
 * first turn, the turns not shown, then the newest.
 */
const CodeTaskTurnsNotShown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <li
      data-testid={props.dataTestId || "code-task-turns-not-shown"}
      data-line={props.line}
    >
      <div role="status">
        <LabelledDivider
          label={translator.translatePlural(
            CODE_TASK_TURNS_NOT_SHOWN_COPY,
            props.count,
          )}
          className="my-0"
          dataTestId="code-task-turns-not-shown-divider"
        />
      </div>
      {props.onShow ? (
        <div className="mt-2 flex justify-center">
          <Button
            title={CODE_TASK_SHOW_EARLIER_TURNS}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            isLoading={props.isShowing}
            onClick={props.onShow}
            dataTestId="code-task-show-earlier-turns"
          />
        </div>
      ) : (
        <></>
      )}
      {props.error ? (
        <p
          role="alert"
          data-testid="code-task-show-earlier-turns-error"
          className="mt-2 text-center text-sm text-red-700"
        >
          <ErrorInSentence message={props.error} showWhereToLook={true} />
        </p>
      ) : (
        <></>
      )}
    </li>
  );
};

export default CodeTaskTurnsNotShown;
