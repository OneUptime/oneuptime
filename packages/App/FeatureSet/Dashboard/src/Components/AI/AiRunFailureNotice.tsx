import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import AiRunTryAgainButton from "./AiRunTryAgainButton";
import {
  AiRunFailureWords,
  describeAiRunFailure,
  readAiRunFailure,
} from "./AiRunFailureWords";
import InvestigationNotice, { noticeFailedIcon } from "./InvestigationNotice";

/*
 * An AI run that did not finish, said so a person can act on it (issues
 * #6437, #6438): what happened and how many times OneUptime tried, what to
 * do about it, Try again for whoever may start the run again, and - under
 * Details - the error itself, for whoever wants it. Every AI card that
 * shows a run that did not finish shows it with this.
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
  const [isDetailsOpen, setIsDetailsOpen] = useState<boolean>(false);
  const detailsId: string = `ai-run-failure-details-${useId()}`;
  const testId: string = props.testId || "ai-run-failure";

  const words: AiRunFailureWords = describeAiRunFailure(
    readAiRunFailure({
      events: props.events,
      errorMessage: props.errorMessage || undefined,
    }),
    translator,
  );

  const errorMessage: string = (props.errorMessage || "").trim();

  return (
    <div data-testid={testId} className="space-y-2">
      <InvestigationNotice
        role="alert"
        indicator={noticeFailedIcon}
        title={props.title}
        testId={`${testId}-notice`}
      >
        <span data-testid={`${testId}-cause`}>{words.whatHappened}</span>
        {words.triedTimes ? (
          <>
            {" "}
            <span data-testid={`${testId}-tries`}>{words.triedTimes}</span>
          </>
        ) : (
          <></>
        )}
      </InvestigationNotice>
      {/*
        What to do, Try again and the error itself sit under the notice's
        sentence, lined up with it (the mark's width and the gap after it).
      */}
      <div className="space-y-2 pl-7">
        <p
          data-testid={`${testId}-fix`}
          className="break-words text-sm leading-6 text-gray-600"
        >
          {words.whatToDo}
        </p>
        <div className="flex flex-wrap items-start gap-x-5 gap-y-1">
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
        </div>
        {errorMessage ? (
          <p
            id={detailsId}
            hidden={!isDetailsOpen}
            data-testid={`${testId}-details`}
            className="break-words rounded-md bg-gray-50 px-3 py-2 font-mono text-xs leading-5 text-gray-600"
          >
            {errorMessage}
          </p>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default AiRunFailureNotice;
