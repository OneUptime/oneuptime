import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { Yellow } from "../../../Types/BrandColors";
import { translationKey, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Pill from "../Pill/Pill";
import React, { ReactElement, ReactNode, useId } from "react";

/*
 * One setting that is a choice of a few, drawn as a radio button per choice,
 * one ruled row each: "Who can see this status page: anyone with the link,
 * only people who sign in, or anyone with the password." It is what a card
 * becomes when one question was answered with two switches, a button and a
 * banner somewhere else: one control, one answer.
 *
 * - The checked choice is the one in force. Picking another one does not
 *   change it here: it tells the page (onPick), which saves it - asking
 *   first, as a change of who can see something should - and then hands
 *   the new choice back as `value`. While it asks, the page passes the
 *   choice being asked about as `value` and locks the group, so the radio
 *   shows where it is going, as a switch does while its dialog is open.
 * - A choice the project's plan does not include shows the plan's name
 *   beside it, the same pill a switch shows, and cannot be picked.
 * - A choice can carry lines of its own under its description (details):
 *   what goes with it, such as the sign-in methods set up, or a button to
 *   change its password. They sit outside the radio's label, so pressing a
 *   link in them picks nothing.
 * - Someone who may not change the setting sees every choice locked, with
 *   why under the choices.
 * - "Saved" shows beside the choice once it is saved, in a live region that
 *   is always on the page, so a screen reader hears it.
 *
 * The rows reach the edges of whatever holds them and bring their own
 * padding (px-5 / md:px-6, as a card's body): a card puts them in a
 * full-bleed wrapper, as the status page's display card does with its rows.
 * The radios are the browser's own, so they follow the page's light or dark
 * colour scheme, and arrow keys move between the choices that can be picked.
 */

export interface ChoiceRowOption<TValue extends string> {
  value: TValue;
  // English; translated here.
  title: string;
  // English; translated here.
  description?: string | undefined;
  /*
   * The plan the project would need to pick it, or nothing when it can: a
   * pill with the plan's name, and the choice cannot be picked.
   */
  planNeeded?: PlanType | null | undefined;
  // Lines under the description, already translated.
  details?: ReactNode | undefined;
  // The radio's data-testid. The row is `${dataTestId}-row`.
  dataTestId?: string | undefined;
}

export interface ComponentProps<TValue extends string> {
  // The choice in force (or being asked about), or null when none is.
  value: TValue | null;
  options: Array<ChoiceRowOption<TValue>>;
  // Told when a choice other than `value` is picked.
  onPick: (value: TValue) => void;
  // Every choice locked: while one is being asked about or saved.
  isLocked?: boolean | undefined;
  /*
   * Every choice locked, with why: someone who may not change the setting.
   * Already translated, or English.
   */
  lockedReason?: string | undefined;
  /*
   * Shown beside the checked choice, in a live region ("Saved"). Already
   * translated.
   */
  status?: ReactNode | undefined;
  // The question, in English: the group's accessible name.
  ariaLabel: string;
  dataTestId?: string | undefined;
}

export const getChoiceRowPlanPillText: (
  translator: Translator,
  plan: PlanType,
) => string = (translator: Translator, plan: PlanType): string => {
  return translator.translateTemplate("{{planName}} Plan", {
    planName: plan,
  });
};

/*
 * A paid choice can always be left, on any plan: going back to the free
 * choice takes the plan-gated column back to its default, which the server
 * allows whatever the plan (PlanGatedColumnDefault). The page's dialog for
 * such a move - off a choice a trial left in force, on a project now on a
 * lower plan - adds this sentence, so nobody leaves it without knowing that
 * coming back needs the plan. Already translated, with the choice's title
 * translated inside it.
 */
export const CHOICE_PLAN_LEFTOVER_COPY: string = translationKey(
  "Your plan does not include “{{choiceName}}”, so picking it again later needs the {{planName}} plan.",
);

export const getChoicePlanLeftoverText: (
  translator: Translator,
  data: {
    // The choice being left, in English.
    choiceTitle: string;
    planNeeded: PlanType;
  },
) => string = (
  translator: Translator,
  data: {
    choiceTitle: string;
    planNeeded: PlanType;
  },
): string => {
  return translator.translateTemplate(CHOICE_PLAN_LEFTOVER_COPY, {
    choiceName: translator.translateText(data.choiceTitle) || data.choiceTitle,
    planName: data.planNeeded,
  });
};

const ChoiceRows: <TValue extends string>(
  props: ComponentProps<TValue>,
) => ReactElement = <TValue extends string>(
  props: ComponentProps<TValue>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const groupId: string = `choice-rows-${useId()}`;

  const isEveryChoiceLocked: boolean = Boolean(
    props.isLocked || props.lockedReason,
  );

  const renderOption: (
    option: ChoiceRowOption<TValue>,
    index: number,
  ) => ReactElement = (
    option: ChoiceRowOption<TValue>,
    index: number,
  ): ReactElement => {
    const inputId: string = `${groupId}-${index}`;
    const descriptionId: string = `${inputId}-description`;
    const planId: string = `${inputId}-plan`;
    const isChecked: boolean = props.value === option.value;
    const isDisabled: boolean =
      isEveryChoiceLocked || Boolean(option.planNeeded);

    // The sentence, and the plan a locked choice needs, read with the radio.
    const describedBy: string = [
      option.description ? descriptionId : "",
      option.planNeeded ? planId : "",
    ]
      .filter((id: string): boolean => {
        return id.length > 0;
      })
      .join(" ");

    return (
      <div
        key={option.value}
        className="px-5 py-4 md:px-6"
        data-testid={option.dataTestId ? `${option.dataTestId}-row` : undefined}
        data-checked={isChecked ? "true" : "false"}
      >
        {/*
         * The status and the plan's pill sit to the right of the text from
         * sm up. On a phone they go under it, lined up with the title (the
         * radio is 16px and 12px from its text: pl-7), so the sentence keeps
         * the width.
         */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <input
              id={inputId}
              type="radio"
              name={groupId}
              value={option.value}
              checked={isChecked}
              disabled={isDisabled}
              aria-describedby={describedBy || undefined}
              className={`mt-1 h-4 w-4 flex-shrink-0 accent-indigo-600 ${
                isDisabled ? "cursor-not-allowed" : "cursor-pointer"
              }`}
              data-testid={option.dataTestId}
              onChange={() => {
                if (isDisabled || isChecked) {
                  return;
                }

                props.onPick(option.value);
              }}
            />
            <div className="min-w-0 flex-1">
              <label
                htmlFor={inputId}
                className={`block text-sm font-medium leading-6 text-gray-900 ${
                  isDisabled ? "cursor-not-allowed" : "cursor-pointer"
                }`}
              >
                {translator.translateText(option.title)}
              </label>
              {option.description ? (
                <p id={descriptionId} className="text-sm text-gray-500">
                  {translator.translateText(option.description)}
                </p>
              ) : (
                <></>
              )}
              {option.details ? (
                <div className="mt-2 text-sm text-gray-500">
                  {option.details}
                </div>
              ) : (
                <></>
              )}
            </div>
          </div>
          <div
            className={`flex flex-shrink-0 flex-wrap items-center gap-x-3 pl-7 text-sm sm:pl-0 sm:pt-0.5 ${
              (isChecked && props.status) || option.planNeeded ? "sm:ml-4" : ""
            }`}
          >
            {/*
             * Always on the page, so "Saved" is heard when it appears: a live
             * region added along with its text is often not announced.
             */}
            <span
              role="status"
              className={
                isChecked && props.status ? "mt-2 inline-flex sm:mt-0" : ""
              }
              data-testid={
                option.dataTestId ? `${option.dataTestId}-status` : undefined
              }
            >
              {isChecked ? props.status : null}
            </span>
            {option.planNeeded ? (
              <span id={planId} className="mt-2 inline-flex sm:mt-0">
                <Pill
                  text={getChoiceRowPlanPillText(translator, option.planNeeded)}
                  color={Yellow}
                />
              </span>
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div data-testid={props.dataTestId}>
      <div
        role="radiogroup"
        aria-label={translator.translateText(props.ariaLabel)}
        className="divide-y divide-gray-200"
      >
        {props.options.map(
          (option: ChoiceRowOption<TValue>, index: number): ReactElement => {
            return renderOption(option, index);
          },
        )}
      </div>
      {props.lockedReason ? (
        <p
          className="border-t border-gray-200 px-5 py-3 text-sm text-gray-500 md:px-6"
          data-testid={
            props.dataTestId ? `${props.dataTestId}-locked-reason` : undefined
          }
        >
          {translator.translateText(props.lockedReason)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ChoiceRows;
