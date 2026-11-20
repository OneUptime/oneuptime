import {
  WELCOME_CHECKLIST_COPY,
  WELCOME_MINUTES_COPY,
  WelcomeStepEntry,
  getWelcomeStepEntry,
} from "./WelcomeChecklistCatalog";
import {
  WELCOME_STEP_MINUTES,
  WelcomeStep,
} from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * YOUR FIRST STEPS, BESIDE THE QUESTION (#10276). "What do you want to do
 * first?" said only how many steps the goals picked bring and about how
 * long they take, and a wide screen left the rest of the page empty. Beside
 * the goals, from lg up, the steps themselves are listed as they are
 * picked: each one's icon, name and minutes, in the order the checklist
 * will list them - so the person sees what a pick brings before Continue,
 * as a guided setup lists what it sets up beside its steps. Below lg the
 * line beside Continue says how many and how long, as before.
 */

export const GOAL_PLAN_PANEL_COPY: {
  title: string;
  nothingPicked: string;
} = {
  title: translationKey("Your first steps"),
  nothingPicked: translationKey(
    "Pick what you want to do first, and its steps show here.",
  ),
};

export const GOAL_PLAN_PANEL_TEST_IDS: {
  panel: string;
  nothingPicked: string;
  step: (step: WelcomeStep) => string;
} = {
  panel: "welcome-question-steps",
  nothingPicked: "welcome-question-steps-nothing-picked",
  step: (step: WelcomeStep): string => {
    return `welcome-question-step-${step}`;
  },
};

// The panel's column beside the goals: shown from lg up, as tall as they are.
export const GOAL_PLAN_PANEL_CLASS_NAME: string = "hidden lg:block";

export interface ComponentProps {
  // The steps the goals picked so far bring, in the checklist's order.
  steps: ReadonlyArray<WelcomeStep>;
}

const GoalPlanPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const titleId: string = `welcome-question-steps-title-${useId()}`;

  return (
    <aside
      data-testid={GOAL_PLAN_PANEL_TEST_IDS.panel}
      aria-labelledby={titleId}
      className={GOAL_PLAN_PANEL_CLASS_NAME}
    >
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
        <h4 id={titleId} className="text-sm font-semibold text-gray-900">
          {translator.translateText(GOAL_PLAN_PANEL_COPY.title)}
        </h4>
        {props.steps.length === 0 ? (
          <div
            data-testid={GOAL_PLAN_PANEL_TEST_IDS.nothingPicked}
            className="mt-4 flex items-start gap-3 rounded-lg border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500"
          >
            <Icon
              icon={IconProp.CursorArrowRays}
              className="mt-0.5 h-4 w-4 flex-none text-gray-400"
            />
            <span>
              {translator.translateText(GOAL_PLAN_PANEL_COPY.nothingPicked)}
            </span>
          </div>
        ) : (
          <>
            <p className="mt-1 text-xs text-gray-500">
              {translator.translateText(WELCOME_CHECKLIST_COPY.description)}
            </p>
            <ol className="mt-4 space-y-3">
              {props.steps.map((step: WelcomeStep): ReactElement => {
                const entry: WelcomeStepEntry = getWelcomeStepEntry(step);

                return (
                  <li
                    key={step}
                    data-testid={GOAL_PLAN_PANEL_TEST_IDS.step(step)}
                    className="flex items-start gap-3"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg ${entry.iconBackgroundClassName}`}
                    >
                      <Icon icon={entry.icon} className="h-4 w-4 text-white" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900">
                        {translator.translateText(entry.title)}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {translator.translatePlural(
                          WELCOME_MINUTES_COPY.about,
                          WELCOME_STEP_MINUTES[step],
                        )}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </aside>
  );
};

export default GoalPlanPanel;
