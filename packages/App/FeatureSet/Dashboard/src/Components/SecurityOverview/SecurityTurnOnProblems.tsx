import {
  TurnOnRecommendedProblem,
  TurnOnRecommendedProblemWords,
  getTurnOnRecommendedProblemWords,
} from "./SecuritySetupModel";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";

export const SECURITY_TURN_ON_PROBLEMS_ID: string = "security-turn-on-problems";

// The rows a reader takes in at once; Show N more opens the rest.
export const MAX_PROBLEMS_SHOWN: number = 5;

// What a problem is about, in the reader's language: a name as the lists show it, or the switch's.
export function getProblemSubjectText(
  translator: Translator,
  problem: TurnOnRecommendedProblem,
): string {
  const words: TurnOnRecommendedProblemWords =
    getTurnOnRecommendedProblemWords(problem);

  return words.isSubjectTranslated
    ? translator.translateText(words.subject) || words.subject
    : words.subject;
}

// Why it could not be done, in the reader's language (a server's own sentence as it is).
export function getProblemReasonText(
  translator: Translator,
  problem: TurnOnRecommendedProblem,
): string {
  const words: TurnOnRecommendedProblemWords =
    getTurnOnRecommendedProblemWords(problem);

  return Object.keys(words.values).length > 0
    ? translator.translateTemplate(words.reason, words.values)
    : translator.translateText(words.reason) || words.reason;
}

export interface ComponentProps {
  // What could not be done; or, with `error`, why nothing could be.
  problems: Array<TurnOnRecommendedProblem>;
  // The call failed as a whole: why (describeSetupCallFailure), translated here when it is a key.
  error?: string | undefined;
  // What did not happen, in the reader's language ("Not everything could be turned on").
  title: string;
  // Under the list, in the reader's language: what is done, and what trying again does.
  note?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * What Turn on recommended - or the Rule Library's Add All and Add
 * Recommended Rules - could not do, and why, in the product's words: a
 * title, then one bullet per thing - its name as the project's lists show
 * it, and a sentence about the role, the plan, a record OneUptime would not
 * save, or a failure on OneUptime's side - then what is done and what
 * trying again does. A call that failed whole says why instead of a list.
 *
 * The first five show; Show N more opens the rest, so a long list never
 * pushes the steps off the screen and nothing is out of reach either.
 *
 * Amber, not red: the rest was done, and the steps below show it.
 */
const SecurityTurnOnProblems: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listId: string = useId();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const hiddenCount: number = Math.max(
    0,
    props.problems.length - MAX_PROBLEMS_SHOWN,
  );
  const shown: Array<TurnOnRecommendedProblem> = isExpanded
    ? props.problems
    : props.problems.slice(0, MAX_PROBLEMS_SHOWN);

  return (
    /*
     * No id: the card can draw two of these at once (what the click left
     * undone, and a test attack that failed), and the Rule Library its own.
     */
    <div
      data-testid={props.dataTestId || SECURITY_TURN_ON_PROBLEMS_ID}
      role="alert"
      className="flex items-start gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <Icon
        icon={IconProp.Alert}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
      />
      <div className="min-w-0 flex-1 space-y-1.5 [overflow-wrap:anywhere]">
        <p
          className="font-semibold"
          data-testid="security-turn-on-problems-title"
        >
          {props.title}
        </p>
        {props.error ? (
          <p data-testid="security-turn-on-problems-error">
            {translator.translateText(props.error) || props.error}
          </p>
        ) : (
          <>
            <ul
              id={listId}
              className="list-disc space-y-1 ps-5 marker:text-amber-500"
              data-testid="security-turn-on-problems-list"
            >
              {shown.map(
                (
                  problem: TurnOnRecommendedProblem,
                  index: number,
                ): ReactElement => {
                  return (
                    <li
                      key={`${problem.part}-${problem.name}-${index}`}
                      data-testid="security-turn-on-problem"
                      data-part={problem.part}
                      data-reason={problem.reason}
                    >
                      <span className="font-medium">
                        {getProblemSubjectText(translator, problem)}
                      </span>
                      <span aria-hidden="true"> - </span>
                      <span>{getProblemReasonText(translator, problem)}</span>
                    </li>
                  );
                },
              )}
            </ul>
            {hiddenCount > 0 ? (
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={listId}
                data-testid="security-turn-on-problems-more"
                className="ms-5 rounded-sm font-medium underline underline-offset-2 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                onClick={() => {
                  setIsExpanded(!isExpanded);
                }}
              >
                {isExpanded
                  ? translator.translateText("Show less")
                  : translator.translatePlural(
                      {
                        one: "Show {{count}} more",
                        other: "Show {{count}} more",
                      },
                      hiddenCount,
                    )}
              </button>
            ) : (
              <></>
            )}
          </>
        )}
        {props.note ? (
          <p
            className="text-amber-800"
            data-testid="security-turn-on-problems-note"
          >
            {props.note}
          </p>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default SecurityTurnOnProblems;
