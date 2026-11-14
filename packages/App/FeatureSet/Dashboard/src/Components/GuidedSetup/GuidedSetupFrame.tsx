import {
  GuidedSetupStepProgress,
  GuidedSetupStepState,
  canOpenStep,
  countDoneSteps,
  getStepNumber,
  getStepState,
} from "./GuidedSetupProgress";
import SetupFeedback from "../Feedback/SetupFeedback";
import GuidedSetupContext from "../../Utils/DashboardRecording/GuidedSetupContext";
import { PRODUCT_TEXT_CLASS_NAME } from "Common/UI/Utils/ProductText";
import {
  GuidedSetupEvents,
  useGuidedSetupEvents,
} from "Common/UI/Utils/GuidedSetupEvents";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  LEARN_MORE_LINK_CLASS_NAME,
  getLearnMoreUrl,
} from "Common/UI/Components/Link/LearnMoreLink";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * THE FRAME EVERY GUIDED SETUP IS DRAWN IN (issue #6804; #6805 and #6806
 * reuse it).
 *
 * One page, a short list of steps (three to five), top to bottom:
 *
 *   - the open step shows its title and what it asks, and saves real
 *     records through the same services the normal forms use;
 *   - a done step folds to one line that says what it made, with a check;
 *     pressing it opens it again to look;
 *   - a step not reached yet shows its title only, so the person sees the
 *     whole job before they start;
 *   - once every step is done, the summary says, in plain words read from
 *     the records, what now exists and what will happen, with the next
 *     steps.
 *
 * Which step is open is the page's (it knows when a step's records are
 * saved); the frame draws them and sends the setup's events
 * (guided_setup/started, step_reached, finished, left: #6830), so every
 * setup is measured the same way. The steps are a list, not a side rail,
 * so a phone draws the same page.
 *
 * The frame also asks how it went (#6832, Feedback/SetupFeedback): "How
 * easy was that?" under the summary once the setup is finished, and a
 * quiet "Stuck?" under the steps before then - for every setup, so a new
 * one asks without a line of its own.
 */

export interface GuidedSetupFrameStep extends GuidedSetupStepProgress {
  // English, translated here.
  title: string;
  // What the step made, in one line, once it is done. Translated by the step.
  doneLine?: string | undefined;
  // What the step asks, drawn while it is open.
  content: ReactElement;
}

export interface ComponentProps {
  // The setup's key in its events (snake_case): "website_down".
  setup: string;
  steps: Array<GuidedSetupFrameStep>;
  // The step that is open; null once every step is done (the summary).
  openStepKey: string | null;
  onOpenStep: (key: string) => void;
  // Drawn when no step is open.
  summary: ReactElement;
  /*
   * The setup reached its end: the thing works and was tested. Sends
   * guided_setup/finished once; leaving before it sends guided_setup/left.
   */
  isFinished: boolean;
  /*
   * The docs' start-to-finish guide to the same job ("/docs/guides/paging",
   * #6821), linked beside the progress line for what a page cannot say: a
   * self-hosted server's settings, what can go wrong. In a new tab, in the
   * reader's language.
   */
  guideDocsPath?: string | undefined;
}

// The step key the events name while the summary is shown.
export const SUMMARY_STEP_KEY: string = "summary";

export const GUIDED_SETUP_GUIDE_LINK_TEST_ID: string =
  "guided-setup-guide-link";

// The same words as a product's showcase link to its guide.
export const GUIDED_SETUP_GUIDE_TEXT: string =
  translationKey("Step-by-step guide");

const StepMarker: FunctionComponent<{
  state: GuidedSetupStepState;
  number: number;
}> = (props: { state: GuidedSetupStepState; number: number }): ReactElement => {
  if (props.state === GuidedSetupStepState.Done) {
    // The check a completed form step shows (Forms/Steps/Step), larger.
    return (
      <svg
        className="h-7 w-7 flex-shrink-0 text-indigo-600"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
        data-testid="guided-setup-step-done-mark"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  return (
    <span
      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${
        props.state === GuidedSetupStepState.Open
          ? "border-indigo-600 text-indigo-600"
          : "border-gray-300 text-gray-400"
      }`}
      aria-hidden="true"
    >
      {props.number}
    </span>
  );
};

const GuidedSetupFrame: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const events: GuidedSetupEvents = useGuidedSetupEvents(props.setup);

  useEffect(() => {
    events.reachStep(props.openStepKey || SUMMARY_STEP_KEY);

    /*
     * Where the person is, by the same keys, for a recording of OneUptime
     * Cloud's setup pages to tie what it sees to the step (#6834).
     */
    GuidedSetupContext.set({
      setup: props.setup,
      step: props.openStepKey || SUMMARY_STEP_KEY,
    });
  }, [props.openStepKey]);

  useEffect(() => {
    return () => {
      GuidedSetupContext.clear(props.setup);
    };
  }, []);

  useEffect(() => {
    if (props.isFinished) {
      events.finish();
    }
  }, [props.isFinished]);

  const doneCount: number = countDoneSteps(props.steps);

  return (
    <div className="w-full max-w-3xl" data-testid="guided-setup">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p
          className={`text-sm text-gray-500 ${PRODUCT_TEXT_CLASS_NAME}`}
          data-testid="guided-setup-progress"
          aria-live="polite"
        >
          {translator.translateTemplate("{{done}} of {{total}} steps done", {
            done: translator.formatNumber(doneCount),
            total: translator.formatNumber(props.steps.length),
          })}
        </p>
        {props.guideDocsPath ? (
          <a
            href={getLearnMoreUrl(props.guideDocsPath, translator.language)}
            target="_blank"
            rel="noopener noreferrer"
            className={LEARN_MORE_LINK_CLASS_NAME}
            data-testid={GUIDED_SETUP_GUIDE_LINK_TEST_ID}
          >
            {translator.translateText(GUIDED_SETUP_GUIDE_TEXT)}
            <Icon
              icon={IconProp.ExternalLink}
              className="h-3.5 w-3.5 flex-shrink-0"
            />
          </a>
        ) : (
          <></>
        )}
      </div>
      <ol className="mt-3 space-y-3">
        {props.steps.map((step: GuidedSetupFrameStep, index: number) => {
          const state: GuidedSetupStepState = getStepState({
            step: step,
            openKey: props.openStepKey,
          });
          const isOpen: boolean = state === GuidedSetupStepState.Open;
          const canOpen: boolean =
            !isOpen && canOpenStep(props.steps, step.key);
          const title: string = translator.translateText(step.title) || "";

          const heading: ReactElement = (
            <span className="flex min-w-0 items-start gap-3">
              <StepMarker
                state={state}
                number={getStepNumber(props.steps, step.key) || index + 1}
              />
              <span className="min-w-0 pt-0.5">
                {/*
                 * The step's title is the setup's own words; its done line
                 * may name what the person made, and stays masked (#6834).
                 */}
                <span
                  className={`block text-base font-semibold ${
                    state === GuidedSetupStepState.Upcoming
                      ? "text-gray-500"
                      : "text-gray-900"
                  } ${PRODUCT_TEXT_CLASS_NAME}`}
                >
                  {title}
                </span>
                {state === GuidedSetupStepState.Done && step.doneLine ? (
                  <span
                    className="mt-0.5 block break-words text-sm text-gray-500"
                    data-testid={`guided-setup-step-${step.key}-done-line`}
                  >
                    {step.doneLine}
                  </span>
                ) : (
                  <></>
                )}
              </span>
            </span>
          );

          return (
            <li
              key={step.key}
              className={`rounded-lg border bg-white ${
                isOpen ? "border-indigo-300 shadow-sm" : "border-gray-200"
              }`}
              data-testid={`guided-setup-step-${step.key}`}
              data-state={state}
              aria-current={isOpen ? "step" : undefined}
            >
              {canOpen ? (
                <button
                  type="button"
                  className="flex w-full items-start rounded-lg p-4 text-start hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  onClick={() => {
                    props.onOpenStep(step.key);
                  }}
                >
                  {heading}
                </button>
              ) : (
                <div className="p-4">{heading}</div>
              )}
              {isOpen ? (
                <div
                  className="px-4 pb-5 sm:ps-14"
                  data-testid={`guided-setup-step-${step.key}-content`}
                >
                  {step.content}
                </div>
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ol>
      {props.openStepKey === null ? (
        <div className="mt-6" data-testid="guided-setup-summary">
          {props.summary}
        </div>
      ) : (
        <></>
      )}
      <SetupFeedback setup={props.setup} isFinished={props.isFinished} />
    </div>
  );
};

export default GuidedSetupFrame;
