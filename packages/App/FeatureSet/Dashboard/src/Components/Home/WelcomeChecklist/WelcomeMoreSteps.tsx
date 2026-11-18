import {
  WELCOME_CHECKLIST_COPY,
  WELCOME_MORE_COPY,
  WelcomeStepEntry,
  getWelcomeStepEntry,
} from "./WelcomeChecklistCatalog";
import WelcomePlanStep from "./WelcomePlanStep";
import PageMap from "../../../Utils/PageMap";
import IconProp from "Common/Types/Icon/IconProp";
import {
  WelcomeChecklistStepState,
  WelcomeStep,
} from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
} from "react";

/*
 * WHAT ELSE TO SET UP, ONCE THE FIRST STEPS ARE DONE (#7986, #9442).
 *
 * The checklist is finished for everyone once the steps of the project's
 * goals are done, and it used to leave Home then for good: a project that
 * came for its website was never offered a status page or its team. This
 * card takes its place, as a card among Home's others (never the whole of
 * Home): the core steps no goal brought that are left, each with its own
 * button - a status page, the team, who is told, a monitor - each gone
 * once it works. While only email can page the person, it offers their
 * phone and the app first: the on-call guided setup, which adds them and
 * ends in a test page.
 *
 * They are offers, not a plan: no step is marked next, no line joins them,
 * and Hide takes the card away for this person, with nothing left behind -
 * Explore OneUptime, under it, holds everything else.
 */

export interface ComponentProps {
  moreSteps: ReadonlyArray<WelcomeChecklistStepState>;
  // Offer the person's phone and the app (#9442).
  offersPhone: boolean;
  className?: string | undefined;
  isSaving: boolean;
  // Why the last change did not save, in English (the card translates it), or "".
  error: string;
  // What a step says, in the reader's words.
  describe: (state: WelcomeChecklistStepState) => string;
  // Why a step is not done although its record exists, as a sentence (#6938).
  gapOf: (state: WelcomeChecklistStepState) => ReactNode;
  onOpenStep: (state: WelcomeChecklistStepState) => void;
  onOpenPhone: () => void;
  onHide: () => void;
}

export const WELCOME_MORE_TEST_ID: string = "welcome-more";

// The key the phone's offer is drawn under, as a step is under its own.
export const WELCOME_MORE_PHONE_KEY: string = "paged_by_phone";

/*
 * The phone's offer, drawn in a step's shape: the on-call guided setup's
 * colour and about as long as its step takes.
 */
export const PHONE_OFFER_ENTRY: WelcomeStepEntry = {
  step: WelcomeStep.OnCall,
  title: WELCOME_MORE_COPY.phoneTitle,
  description: WELCOME_MORE_COPY.phoneDescription,
  icon: IconProp.DevicePhoneMobile,
  iconBackgroundClassName: "bg-rose-500",
  pageMap: PageMap.ON_CALL_DUTY_GUIDED_SETUP,
};

const PHONE_OFFER_STATE: WelcomeChecklistStepState = {
  step: WelcomeStep.OnCall,
  isDone: false,
  needsPlan: null,
  isNext: false,
  gap: null,
};

const WelcomeMoreSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const headingId: string = `welcome-more-title-${useId()}`;

  return (
    <section
      data-testid={WELCOME_MORE_TEST_ID}
      aria-labelledby={headingId}
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ${
        props.className || ""
      }`}
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-emerald-500"
          >
            <Icon icon={IconProp.Check} className="h-5 w-5 text-white" />
          </span>
          <div className="min-w-0">
            <h2
              id={headingId}
              className="text-base font-semibold text-gray-900"
            >
              {translator.translateText(WELCOME_MORE_COPY.title)}
            </h2>
            <p className="mt-0.5 text-sm text-gray-600">
              {translator.translateText(WELCOME_MORE_COPY.description)}
            </p>
          </div>
        </div>
        <Button
          title={WELCOME_CHECKLIST_COPY.hideButton}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          buttonSize={ButtonSize.Small}
          disabled={props.isSaving}
          onClick={props.onHide}
          dataTestId="welcome-more-hide"
        />
      </div>
      {props.error ? (
        <p role="alert" className="px-5 pt-3 text-sm text-red-600 sm:px-6">
          {translator.translateText(props.error)}
        </p>
      ) : (
        <></>
      )}
      <ul
        data-testid="welcome-more-steps"
        className="space-y-1 px-3 pb-3 pt-3 sm:px-4"
      >
        {props.offersPhone ? (
          <WelcomePlanStep
            key={WELCOME_MORE_PHONE_KEY}
            testIdKey={WELCOME_MORE_PHONE_KEY}
            state={PHONE_OFFER_STATE}
            entry={PHONE_OFFER_ENTRY}
            description={
              translator.translateText(PHONE_OFFER_ENTRY.description) || ""
            }
            isLast={true}
            isOnPath={false}
            onOpen={props.onOpenPhone}
          />
        ) : (
          <></>
        )}
        {props.moreSteps.map(
          (state: WelcomeChecklistStepState): ReactElement => {
            return (
              <WelcomePlanStep
                key={state.step}
                state={state}
                entry={getWelcomeStepEntry(state.step)}
                description={props.describe(state)}
                gap={props.gapOf(state)}
                isLast={true}
                isOnPath={false}
                onOpen={() => {
                  props.onOpenStep(state);
                }}
              />
            );
          },
        )}
      </ul>
    </section>
  );
};

export default WelcomeMoreSteps;
