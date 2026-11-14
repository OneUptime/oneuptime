import {
  WELCOME_CHECKLIST_COPY,
  WELCOME_GOALS,
  WELCOME_QUESTION_COPY,
  WelcomeGoalEntry,
} from "./WelcomeChecklistCatalog";
import ProjectGoal from "Common/Types/WelcomeChecklist/ProjectGoal";
import { isGoalOffOnServer } from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import ProductKey from "Common/Types/Product/ProductKey";
import { getOffProducts } from "Common/Types/Product/ServerProducts";
import { ProjectProductsState } from "../../../Utils/ProjectProducts/ProjectProductsStore";
import useProjectProducts from "../../../Utils/ProjectProducts/UseProjectProducts";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "What do you want to do first?" (issue #6803): asked once, on Home, of a
 * new project's owner, and again whenever they press Change on the
 * checklist. Several goals can be ticked; Skip gives the checklist the four
 * steps it always had. Inline in the Welcome card rather than a dialog, so
 * the rest of Home stays in reach. A goal of a product switched off on the
 * server (#6815) is not offered.
 */

export interface ComponentProps {
  // The goals ticked to start with: the project's, when changing them.
  initialGoals: ReadonlyArray<ProjectGoal>;
  // Changing an answer already given: Save and Cancel instead of Continue and Skip.
  isChange: boolean;
  isSaving: boolean;
  error?: string | undefined;
  onSubmit: (goals: Array<ProjectGoal>) => void;
  // Skip on the first visit, Cancel when changing.
  onSkip: () => void;
  className?: string | undefined;
}

const GoalQuestion: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const products: ProjectProductsState = useProjectProducts();
  const offProducts: Array<ProductKey> = getOffProducts(
    products.answer.offOnServer || {},
  );
  const goals: Array<WelcomeGoalEntry> = WELCOME_GOALS.filter(
    (entry: WelcomeGoalEntry): boolean => {
      return !isGoalOffOnServer(entry.goal, offProducts);
    },
  );
  const [chosen, setChosen] = useState<Array<ProjectGoal>>([
    ...props.initialGoals,
  ]);

  const toggle: (goal: ProjectGoal) => void = (goal: ProjectGoal): void => {
    setChosen((current: Array<ProjectGoal>): Array<ProjectGoal> => {
      return current.includes(goal)
        ? current.filter((item: ProjectGoal): boolean => {
            return item !== goal;
          })
        : [...current, goal];
    });
  };

  const questionId: string = "welcome-question-title";

  return (
    <Card
      className={props.className}
      title={WELCOME_CHECKLIST_COPY.title}
      description={WELCOME_QUESTION_COPY.description}
    >
      <form
        data-testid="welcome-question"
        onSubmit={(event: React.FormEvent<HTMLFormElement>): void => {
          event.preventDefault();

          if (chosen.length > 0 && !props.isSaving) {
            props.onSubmit(chosen);
          }
        }}
      >
        <fieldset aria-labelledby={questionId}>
          <legend
            id={questionId}
            className="mb-4 text-base font-semibold text-gray-900"
          >
            {translator.translateText(WELCOME_QUESTION_COPY.title)}
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {goals.map((entry: WelcomeGoalEntry): ReactElement => {
              const isChosen: boolean = chosen.includes(entry.goal);

              return (
                <label
                  key={entry.goal}
                  data-testid={`welcome-goal-${entry.goal}`}
                  data-chosen={isChosen ? "true" : "false"}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition focus-within:ring-2 focus-within:ring-indigo-500 ${
                    isChosen
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 bg-white hover:border-indigo-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChosen}
                    onChange={() => {
                      toggle(entry.goal);
                    }}
                    className="h-4 w-4 flex-none rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span
                    className={`flex h-8 w-8 flex-none items-center justify-center rounded-md ${
                      isChosen
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    <Icon icon={entry.icon} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 font-medium text-gray-900">
                    {translator.translateText(entry.title)}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {props.error ? (
          <p
            role="alert"
            data-testid="welcome-question-error"
            className="mt-4 text-sm text-red-600"
          >
            {translator.translateText(props.error)}
          </p>
        ) : (
          <></>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <Button
            title={
              props.isChange
                ? WELCOME_QUESTION_COPY.cancelButton
                : WELCOME_QUESTION_COPY.skipButton
            }
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Normal}
            disabled={props.isSaving}
            onClick={props.onSkip}
            dataTestId={
              props.isChange
                ? "welcome-question-cancel"
                : "welcome-question-skip"
            }
          />
          <Button
            title={
              props.isChange
                ? WELCOME_QUESTION_COPY.saveButton
                : WELCOME_QUESTION_COPY.continueButton
            }
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Normal}
            disabled={chosen.length === 0 || props.isSaving}
            isLoading={props.isSaving}
            onClick={() => {
              if (chosen.length > 0) {
                props.onSubmit(chosen);
              }
            }}
            dataTestId="welcome-question-continue"
          />
        </div>
      </form>
    </Card>
  );
};

export default GoalQuestion;
