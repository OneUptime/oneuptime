import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import {
  WELCOME_GOAL_CARDS,
  WELCOME_JUST_LOOKING_GOAL,
  WELCOME_MINUTES_COPY,
  WELCOME_QUESTION_COPY,
  WelcomeGoalEntry,
  getWelcomeGoalEntry,
} from "./WelcomeChecklistCatalog";
import WelcomeGreeting from "./WelcomeGreeting";
import GoalPlanPanel from "./GoalPlanPanel";
import ProjectGoal from "Common/Types/WelcomeChecklist/ProjectGoal";
import {
  WelcomeStep,
  getPlanStepsForGoals,
  getWelcomeStepsMinutes,
  isGoalOffOnServer,
} from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import IconProp from "Common/Types/Icon/IconProp";
import ProductKey from "Common/Types/Product/ProductKey";
import { getOffProducts } from "Common/Types/Product/ServerProducts";
import { ProjectProductsState } from "../../../Utils/ProjectProducts/ProjectProductsStore";
import useProjectProducts from "../../../Utils/ProjectProducts/UseProjectProducts";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";

/*
 * "What do you want to do first?" (issue #6803, redrawn for #8897): asked
 * once, on Home, of a new project's owner, and again whenever they press
 * Change on the checklist. It is the whole of Home while it is asked
 * (Pages/Home/Home.tsx), so it is drawn as a page's first screen, not as a
 * card among others:
 *
 *   - the person greeted by their first name, and the question;
 *   - one large card per goal, its icon, what it is and what the person
 *     will have once it is done, picked with one click and plainly marked
 *     when picked (a checkbox underneath, so Tab, Space and a screen reader
 *     work as on any list of choices);
 *   - while picking, how many steps the picked goals bring and about how
 *     long they take, beside the one primary button, and from lg up the
 *     steps themselves beside the goals (GoalPlanPanel, #10276);
 *   - "Just looking around" under the cards, as the way out: it keeps the
 *     project's goal as Explore and takes the person straight to the rest
 *     of Home, with the line that brings the checklist back.
 *
 * A goal of a product switched off on the server (#6815) is not offered.
 */

export interface ComponentProps {
  // The goals ticked to start with: the project's, when changing them.
  initialGoals: ReadonlyArray<ProjectGoal>;
  // Changing an answer already given: Save and Cancel instead of Continue.
  isChange: boolean;
  isSaving: boolean;
  error?: string | undefined;
  onSubmit: (goals: Array<ProjectGoal>) => void;
  // Cancel, when changing the goals.
  onCancel: () => void;
  // Just looking around, on the first visit: the question's way out.
  onJustLooking: () => void;
  // The person's first name, for the greeting; empty when unknown.
  firstName?: string | undefined;
  className?: string | undefined;
}

// The goals a card can be picked for: never the way out, which is a link.
export const getPickableGoals: (
  goals: ReadonlyArray<ProjectGoal>,
  cards: ReadonlyArray<WelcomeGoalEntry>,
) => Array<ProjectGoal> = (
  goals: ReadonlyArray<ProjectGoal>,
  cards: ReadonlyArray<WelcomeGoalEntry>,
): Array<ProjectGoal> => {
  return goals.filter((goal: ProjectGoal): boolean => {
    return cards.some((entry: WelcomeGoalEntry): boolean => {
      return entry.goal === goal;
    });
  });
};

/*
 * A card is one row on a phone - its icon, its words, its mark - so the six
 * fit on a screen or two, and from sm up a tile: the icon over the words,
 * the mark in the top corner.
 */
export const GOAL_CARD_CLASS_NAME: string =
  "relative flex h-full cursor-pointer items-start gap-4 rounded-xl border p-4 text-start transition focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 sm:flex-col sm:gap-0 sm:p-5";

const CHOSEN_CARD_CLASS_NAME: string =
  "border-indigo-500 bg-indigo-50 shadow-md ring-1 ring-indigo-500";

const CARD_AT_REST_CLASS_NAME: string =
  "border-gray-200 bg-white hover:border-indigo-300 hover:shadow-md";

/*
 * The goal's checkbox lies over its round mark, see-through: the click is
 * the checkbox's own, and the dark theme's way of drawing a checkbox (square,
 * with a tick of its own) never shows over the mark.
 */
export const GOAL_CHECKBOX_CLASS_NAME: string =
  "absolute inset-0 z-10 m-0 h-6 w-6 cursor-pointer opacity-0";

// The round mark: an empty ring, and an indigo disc with a tick once picked.
export const GOAL_MARK_CLASS_NAME: string =
  "flex h-6 w-6 items-center justify-center rounded-full border-2 transition";

export const GOAL_MARK_CHOSEN_CLASS_NAME: string =
  "border-indigo-600 bg-indigo-600";

export const GOAL_MARK_AT_REST_CLASS_NAME: string = "border-gray-300 bg-white";

/*
 * Under the question, the goals and, from lg up, the steps they bring
 * beside them (GoalPlanPanel, #10276): the cards take the room there is,
 * the panel a column of its own.
 */
export const GOAL_QUESTION_BODY_CLASS_NAME: string =
  "grid grid-cols-1 gap-6 px-5 pb-6 pt-4 sm:px-8 lg:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_19rem]";

/*
 * The goals: one a row on a phone, two from sm, and three once the column
 * beside the panel has room for them (xl).
 */
export const GOAL_CARDS_CLASS_NAME: string =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-3";

const GoalQuestion: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const products: ProjectProductsState = useProjectProducts();
  const offProducts: Array<ProductKey> = getOffProducts(
    products.answer.offOnServer || {},
  );
  const cards: Array<WelcomeGoalEntry> = WELCOME_GOAL_CARDS.filter(
    (entry: WelcomeGoalEntry): boolean => {
      return !isGoalOffOnServer(entry.goal, offProducts);
    },
  );
  const [chosen, setChosen] = useState<Array<ProjectGoal>>(
    getPickableGoals(props.initialGoals, cards),
  );
  const questionId: string = `welcome-question-title-${useId()}`;

  const toggle: (goal: ProjectGoal) => void = (goal: ProjectGoal): void => {
    setChosen((current: Array<ProjectGoal>): Array<ProjectGoal> => {
      return current.includes(goal)
        ? current.filter((item: ProjectGoal): boolean => {
            return item !== goal;
          })
        : [...current, goal];
    });
  };

  const submit: () => void = (): void => {
    if (chosen.length > 0 && !props.isSaving) {
      props.onSubmit(chosen);
    }
  };

  const planSteps: Array<WelcomeStep> = getPlanStepsForGoals(
    chosen,
    offProducts,
  );

  const justLooking: WelcomeGoalEntry = getWelcomeGoalEntry(
    WELCOME_JUST_LOOKING_GOAL,
  );

  return (
    <section
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ${
        props.className || ""
      }`}
      aria-labelledby={questionId}
    >
      <form
        data-testid="welcome-question"
        onSubmit={(event: React.FormEvent<HTMLFormElement>): void => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="bg-gradient-to-br from-indigo-50 via-white to-white px-5 pb-2 pt-6 sm:px-8 sm:pt-8">
          {props.isChange ? (
            <></>
          ) : (
            <WelcomeGreeting
              firstName={props.firstName}
              dataTestId="welcome-question-greeting"
            />
          )}
          <h3
            id={questionId}
            className={
              props.isChange
                ? "text-2xl font-semibold tracking-tight text-gray-900"
                : "mt-6 text-lg font-semibold text-gray-900"
            }
          >
            {translator.translateText(WELCOME_QUESTION_COPY.title)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            {translator.translateText(WELCOME_QUESTION_COPY.description)}
          </p>
        </div>
        <div className={GOAL_QUESTION_BODY_CLASS_NAME}>
          <fieldset aria-labelledby={questionId} className="min-w-0">
            <div
              data-testid="welcome-goal-cards"
              className={GOAL_CARDS_CLASS_NAME}
            >
              {cards.map((entry: WelcomeGoalEntry): ReactElement => {
                const isChosen: boolean = chosen.includes(entry.goal);
                const titleId: string = `${questionId}-${entry.goal}-title`;
                const outcomeId: string = `${questionId}-${entry.goal}`;

                return (
                  <label
                    key={entry.goal}
                    data-testid={`welcome-goal-${entry.goal}`}
                    data-chosen={isChosen ? "true" : "false"}
                    className={`${GOAL_CARD_CLASS_NAME} ${
                      isChosen
                        ? CHOSEN_CARD_CLASS_NAME
                        : CARD_AT_REST_CLASS_NAME
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl ${entry.iconBackgroundClassName}`}
                    >
                      <Icon icon={entry.icon} className="h-5 w-5 text-white" />
                    </span>
                    <span className="block min-w-0 flex-1 sm:mt-4">
                      <span
                        id={titleId}
                        className="block text-base font-semibold text-gray-900"
                      >
                        {translator.translateText(entry.title)}
                      </span>
                      <span
                        id={outcomeId}
                        className="mt-1 block text-sm text-gray-600"
                      >
                        {translator.translateText(entry.outcome)}
                      </span>
                    </span>
                    {/*
                     * The choice itself: a real checkbox, over the round mark
                     * in the card's corner - an empty ring, and an indigo
                     * disc with a tick once picked. The card is its label, so
                     * a click anywhere on it picks it; it is named by the
                     * goal and described by what the goal brings.
                     */}
                    <span className="relative mt-0.5 flex h-6 w-6 flex-none sm:absolute sm:end-5 sm:top-5 sm:mt-0">
                      <input
                        type="checkbox"
                        checked={isChosen}
                        onChange={() => {
                          toggle(entry.goal);
                        }}
                        aria-labelledby={titleId}
                        aria-describedby={outcomeId}
                        data-testid={`welcome-goal-${entry.goal}-checkbox`}
                        className={GOAL_CHECKBOX_CLASS_NAME}
                      />
                      <span
                        aria-hidden="true"
                        data-testid={`welcome-goal-${entry.goal}-mark`}
                        className={`${GOAL_MARK_CLASS_NAME} ${
                          isChosen
                            ? GOAL_MARK_CHOSEN_CLASS_NAME
                            : GOAL_MARK_AT_REST_CLASS_NAME
                        }`}
                      >
                        {isChosen ? (
                          <Icon
                            icon={IconProp.Check}
                            className="h-3.5 w-3.5 text-white"
                          />
                        ) : (
                          <></>
                        )}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <GoalPlanPanel steps={planSteps} />
        </div>
        {props.error ? (
          <p
            role="alert"
            data-testid="welcome-question-error"
            className="px-5 pb-4 text-sm text-red-600 sm:px-8"
          >
            {translator.translateText(props.error)}
          </p>
        ) : (
          <></>
        )}
        <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          {/* A div, not a p: an Icon draws a div around its svg. */}
          <div
            data-testid="welcome-question-plan"
            aria-live="polite"
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600"
          >
            {chosen.length > 0 ? (
              <>
                <Icon
                  icon={IconProp.Clock}
                  className="h-4 w-4 flex-none text-gray-400"
                />
                <span data-testid="welcome-question-plan-steps">
                  {translator.translatePlural(
                    WELCOME_QUESTION_COPY.stepsToSetUp,
                    planSteps.length,
                  )}
                </span>
                <span aria-hidden="true" className="text-gray-400">
                  <InlineSeparator markOnly />
                </span>
                <span data-testid="welcome-question-plan-minutes">
                  {translator.translatePlural(
                    WELCOME_MINUTES_COPY.about,
                    getWelcomeStepsMinutes(planSteps),
                  )}
                </span>
              </>
            ) : (
              <span data-testid="welcome-question-pick-hint">
                {translator.translateText(WELCOME_QUESTION_COPY.pickHint)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {props.isChange ? (
              <Button
                title={WELCOME_QUESTION_COPY.cancelButton}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Normal}
                disabled={props.isSaving}
                onClick={props.onCancel}
                dataTestId="welcome-question-cancel"
              />
            ) : (
              <Button
                title={justLooking.title}
                tooltip={justLooking.outcome}
                buttonStyle={ButtonStyleType.SECONDARY_LINK}
                buttonSize={ButtonSize.Normal}
                disabled={props.isSaving}
                onClick={props.onJustLooking}
                dataTestId="welcome-question-just-looking"
              />
            )}
            <Button
              title={
                props.isChange
                  ? WELCOME_QUESTION_COPY.saveButton
                  : WELCOME_QUESTION_COPY.continueButton
              }
              buttonStyle={ButtonStyleType.PRIMARY}
              buttonSize={ButtonSize.Large}
              disabled={chosen.length === 0 || props.isSaving}
              isLoading={props.isSaving}
              onClick={submit}
              dataTestId="welcome-question-continue"
            />
          </div>
        </div>
      </form>
    </section>
  );
};

export default GoalQuestion;
