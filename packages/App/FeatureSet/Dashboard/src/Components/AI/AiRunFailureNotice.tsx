import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import { AIRunFailureKind } from "Common/Types/AI/AIRunAttempt";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import AiRunTryAgainButton from "./AiRunTryAgainButton";
import {
  AiRunFailure,
  AiRunFailureWords,
  describeAiRunFailure,
  readAiRunFailure,
} from "./AiRunFailureWords";
import InvestigationNotice, { noticeFailedIcon } from "./InvestigationNotice";

/*
 * An AI run that did not finish, said so a person can act on it (issues
 * #6437, #6438): what happened and how many times OneUptime tried, what to
 * do about it, Try again for whoever may start the run again, and - under
 * Details - the error itself, for whoever wants it (open from the start
 * when the words cannot say more than "something went wrong"). Every AI
 * card that shows a run that did not finish shows it with this.
 *
 * It is the card's notice - a red mark, a sentence and a quieter line -
 * never a box: the error is a quoted line under it, not a panel.
 */

export interface ComponentProps {
  // English, translated here: "Triage did not finish".
  title: string;
  // The run's events: its RunFailed says why, and how many times it tried.
  events: Array<AIRunEvent>;
  // The run's error message: read when its events do not say, and shown under Details.
  errorMessage?: string | null | undefined;
  // Offered only to who may start the run again; omitted, there is no button.
  onTryAgain?: (() => Promise<void>) | undefined;
  testId?: string | undefined;
}

const AiRunFailureNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const failure: AiRunFailure = readAiRunFailure({
    events: props.events,
    errorMessage: props.errorMessage || undefined,
  });
  /*
   * A failure the words can name (the provider timed out) keeps the error
   * under Details; one they cannot ("Something went wrong") shows it, as
   * it is all there is to go on.
   */
  const [isDetailsOpen, setIsDetailsOpen] = useState<boolean>(
    failure.failureKind === AIRunFailureKind.Other,
  );
  const detailsId: string = `ai-run-failure-details-${useId()}`;
  const testId: string = props.testId || "ai-run-failure";

  const words: AiRunFailureWords = describeAiRunFailure(failure, translator);
  const errorMessage: string = (props.errorMessage || "").trim();
  const hasActions: boolean =
    Boolean(props.onTryAgain) || Boolean(errorMessage);

  return (
    <InvestigationNotice
      testId={testId}
      indicator={noticeFailedIcon}
      title={props.title}
      actionsTestId={`${testId}-actions`}
      actions={
        hasActions ? (
          <>
            {props.onTryAgain ? (
              <AiRunTryAgainButton
                onTryAgain={props.onTryAgain}
                testId={`${testId}-try-again`}
              />
            ) : (
              <></>
            )}
            {errorMessage ? (
              <button
                type="button"
                data-testid={`${testId}-details-toggle`}
                aria-expanded={isDetailsOpen}
                aria-controls={detailsId}
                className="inline-flex items-center gap-1 rounded-md text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                onClick={() => {
                  setIsDetailsOpen((isOpen: boolean): boolean => {
                    return !isOpen;
                  });
                }}
              >
                <Icon
                  icon={
                    isDetailsOpen ? IconProp.ChevronDown : IconProp.ChevronRight
                  }
                  className="h-3.5 w-3.5 flex-shrink-0"
                />
                {translator.translateText("Details")}
              </button>
            ) : (
              <></>
            )}
          </>
        ) : undefined
      }
      details={
        errorMessage ? (
          <p
            id={detailsId}
            hidden={!isDetailsOpen}
            data-testid={`${testId}-details`}
            className="mt-2 whitespace-pre-wrap break-words border-s-2 border-gray-200 ps-3 font-mono text-xs leading-5 text-gray-500"
          >
            {errorMessage}
          </p>
        ) : undefined
      }
    >
      <span data-testid={`${testId}-cause`}>{words.whatHappened}</span>
      {words.triedTimes ? (
        <>
          {" "}
          <span data-testid={`${testId}-tries`}>{words.triedTimes}</span>
        </>
      ) : (
        <></>
      )}{" "}
      <span data-testid={`${testId}-fix`}>{words.whatToDo}</span>
    </InvestigationNotice>
  );
};

export default AiRunFailureNotice;
