import {
  TurnOnRecommendedProblem,
  TurnOnRecommendedProblemWords,
  getTurnOnRecommendedProblemWords,
} from "./SecuritySetupModel";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export const SECURITY_TURN_ON_PROBLEMS_ID: string = "security-turn-on-problems";

// The rows a reader takes in at once; the rest are counted.
export const MAX_PROBLEMS_SHOWN: number = 5;

export interface ComponentProps {
  // What could not be done; or, with `error`, why nothing could be.
  problems: Array<TurnOnRecommendedProblem>;
  // The whole call failed: the API's own sentence.
  error?: string | undefined;
  // A translation key: what did not happen ("Not everything could be turned on").
  title: string;
  // A translation key under the list: what is done, and what trying again does.
  note?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * What Turn on recommended - or the Rule Library's Add - could not do, and
 * why, in the product's words: one row per thing, its name as the project's
 * lists show it and a sentence about the role, the plan, a record OneUptime
 * would not save, or a failure on OneUptime's side. Under it, what trying
 * again does: only what is still missing. A call that failed whole says
 * its own sentence instead of rows.
 *
 * Amber, not red: the rest was done, and the steps below show it.
 */
const SecurityTurnOnProblems: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const shown: Array<TurnOnRecommendedProblem> = props.problems.slice(
    0,
    MAX_PROBLEMS_SHOWN,
  );
  const hiddenCount: number = props.problems.length - shown.length;

  return (
    <div
      id={SECURITY_TURN_ON_PROBLEMS_ID}
      data-testid={props.dataTestId || SECURITY_TURN_ON_PROBLEMS_ID}
      role="alert"
      className="flex items-start gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <Icon
        icon={IconProp.Alert}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
      />
      <div className="min-w-0 flex-1 space-y-1.5 [overflow-wrap:anywhere]">
        <p className="font-medium">{translator.translateText(props.title)}</p>
        {props.error ? (
          <p data-testid="security-turn-on-problems-error">
            {translator.translateText(props.error) || props.error}
          </p>
        ) : (
          <ul className="space-y-1" data-testid="security-turn-on-problems-list">
            {shown.map(
              (
                problem: TurnOnRecommendedProblem,
                index: number,
              ): ReactElement => {
                const words: TurnOnRecommendedProblemWords =
                  getTurnOnRecommendedProblemWords(problem);

                return (
                  <li
                    key={`${problem.part}-${problem.name}-${index}`}
                    data-testid="security-turn-on-problem"
                    data-part={problem.part}
                    data-reason={problem.reason}
                  >
                    <span className="font-medium">
                      {words.isSubjectTranslated
                        ? translator.translateText(words.subject)
                        : words.subject}
                    </span>
                    <span aria-hidden="true"> - </span>
                    <span>
                      {Object.keys(words.values).length > 0
                        ? translator.translateTemplate(
                            words.reason,
                            words.values,
                          )
                        : translator.translateText(words.reason) ||
                          words.reason}
                    </span>
                  </li>
                );
              },
            )}
            {hiddenCount > 0 ? (
              <li data-testid="security-turn-on-problems-more">
                {translator.translatePlural(
                  { one: "and {{count}} more", other: "and {{count}} more" },
                  hiddenCount,
                )}
              </li>
            ) : (
              <></>
            )}
          </ul>
        )}
        {props.note ? (
          <p className="text-amber-800">{translator.translateText(props.note)}</p>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default SecurityTurnOnProblems;
