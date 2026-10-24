import {
  AI_OFF_ASK_AI,
  AI_OFF_WHAT_YOU_CAN_DO,
  AiOffStep,
  AiOffStepLink,
  AiOffSummary as AiOffSummaryCopy,
} from "./AiOffSummaryData";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId } from "react";

export interface ComponentProps {
  summary: AiOffSummaryCopy;
  isOpen: boolean;
  onToggle: () => void;
  /*
   * Asks for the conversation with OneUptime AI. Given only while AI is on
   * and the conversation is not on screen yet: the line then offers it.
   */
  onAskAi?: (() => void) | undefined;
}

export const AI_OFF_SUMMARY_TEST_ID: string = "ai-off-summary";

/*
 * Where the line's parts go, by the width of the line itself, not the
 * window's (the AI card is two thirds of a page from xl up, and all of it
 * below). What is off takes the first row, and the fold's chevron its right
 * end, always - where a card that opens has it. Why runs under them. Ask
 * OneUptime AI joins the first row, before the chevron, from 28rem - room
 * for it beside the title in every language the Dashboard speaks - and in
 * a narrower card it follows the reason, at its start, so the two sentences
 * are read together.
 */
export const AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES: {
  title: string;
  ask: string;
  toggle: string;
  reason: string;
} = {
  title: "order-1 min-w-0 grow basis-0",
  ask: "order-4 -ml-2 [@container(min-width:28rem)]:order-2 [@container(min-width:28rem)]:ml-0",
  toggle: "order-2 -mr-1.5 [@container(min-width:28rem)]:order-3",
  reason: "order-3 basis-full [@container(min-width:28rem)]:order-4",
};

/*
 * The places the steps send someone who may make them: each once, in the
 * order the steps first name them, so two switches on one page get one
 * link.
 */
export function getAiOffSummaryLinks(
  steps: Array<AiOffStep>,
  canChange: (step: AiOffStep) => boolean,
): Array<AiOffStepLink> {
  const links: Array<AiOffStepLink> = [];

  for (const step of steps) {
    if (step.isDone || !step.link || !canChange(step)) {
      continue;
    }

    const route: string = step.link.route.toString();
    const isListed: boolean = links.some((link: AiOffStepLink): boolean => {
      return link.route.toString() === route;
    });

    if (!isListed) {
      links.push(step.link);
    }
  }

  return links;
}

/*
 * Who can make the steps the reader may not, said once per sentence: "a
 * project owner or admin can change this" covers both switches.
 */
export function getAiOffSummaryWhoCanChange(
  steps: Array<AiOffStep>,
  canChange: (step: AiOffStep) => boolean,
): Array<string> {
  const sentences: Array<string> = [];

  for (const step of steps) {
    if (
      step.isDone ||
      canChange(step) ||
      !step.whoCanChange ||
      sentences.includes(step.whoCanChange)
    ) {
      continue;
    }

    sentences.push(step.whoCanChange);
  }

  return sentences;
}

/*
 * The AI card when OneUptime AI neither investigated nor fixed a record
 * because something was off for it (AiOffSummaryData): one quiet line - what
 * is off, and why - with the conversation one click away while AI is on, and
 * a fold that says what to turn on, where, and who can.
 *
 * It is the AI card's body, drawn inside InvestigationPanel's one Card with
 * no header of its own: the line is the header. Like the rest of the card,
 * nothing in it is a box: a mark, the words, a hairline above what opens.
 */
const AiOffSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const id: string = useId();
  const stepsId: string = `ai-off-summary-steps-${id}`;
  const summary: AiOffSummaryCopy = props.summary;

  /*
   * Who may make each change is read when the fold is drawn: the permission
   * snapshot can arrive after the card first loads. A step someone may not
   * make says who can instead of offering a link that would be refused.
   */
  const canChange: (step: AiOffStep) => boolean = (
    step: AiOffStep,
  ): boolean => {
    return PermissionGate.holdsAnyOf(step.permissions);
  };
  const whatYouCanDo: string =
    translator.translateText(AI_OFF_WHAT_YOU_CAN_DO) || AI_OFF_WHAT_YOU_CAN_DO;
  const links: Array<AiOffStepLink> = props.isOpen
    ? getAiOffSummaryLinks(summary.steps, canChange)
    : [];
  const whoCanChange: Array<string> = props.isOpen
    ? getAiOffSummaryWhoCanChange(summary.steps, canChange)
    : [];

  return (
    <div
      data-testid={AI_OFF_SUMMARY_TEST_ID}
      data-open={props.isOpen ? "true" : "false"}
    >
      <div className="flex items-start gap-3">
        {/*
          OneUptime AI's sparkle, in the quiet grey of something that is not
          running: the record's AI card, at rest.
        */}
        <div
          aria-hidden="true"
          data-testid="ai-off-summary-mark"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-500"
        >
          <Icon icon={IconProp.Sparkles} className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1 [container-type:inline-size]">
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
            <h2
              data-testid="ai-off-summary-title"
              className={`${AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.title} me-2 break-words text-sm font-semibold leading-7 text-gray-900`}
            >
              {summary.title}
            </h2>

            {props.onAskAi ? (
              <button
                type="button"
                data-testid="ai-off-summary-ask"
                onClick={props.onAskAi}
                className={`${AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.ask} inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
              >
                <Icon icon={IconProp.Sparkles} className="h-4 w-4" />
                <span>{translator.translateText(AI_OFF_ASK_AI)}</span>
              </button>
            ) : (
              <></>
            )}

            {/*
              The fold opens on its chevron, as a card that opens does. Its
              name says what opens: what you can do to turn AI on.
            */}
            <button
              type="button"
              data-testid="ai-off-summary-toggle"
              aria-expanded={props.isOpen}
              aria-controls={stepsId}
              aria-label={whatYouCanDo}
              title={whatYouCanDo}
              onClick={props.onToggle}
              className={`${AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.toggle} flex h-7 w-7 flex-none items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
            >
              <Icon
                icon={IconProp.ChevronDown}
                className={`h-5 w-5 transition-transform duration-200 motion-reduce:transition-none ${
                  props.isOpen ? "-rotate-180" : ""
                }`}
              />
            </button>

            <p
              data-testid="ai-off-summary-reason"
              className={`${AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.reason} break-words text-sm leading-6 text-gray-500`}
            >
              {summary.reason}
            </p>
          </div>

          {/*
            What would have OneUptime AI investigate - and fix - the next
            one: each change in a sentence, then where it is made for those
            who may make it, and who can for everyone else; then that none
            of it reaches back to this record.
          */}
          <div
            id={stepsId}
            data-testid="ai-off-summary-steps"
            hidden={!props.isOpen}
            className="mt-4 border-t border-gray-200 pt-4"
          >
            <ul role="list" className="space-y-1.5">
              {summary.steps.map((step: AiOffStep): ReactElement => {
                return (
                  <li
                    key={step.key}
                    data-testid="ai-off-summary-step"
                    data-step={step.key}
                    data-done={step.isDone ? "true" : "false"}
                    className="flex items-start gap-2.5"
                  >
                    {/* A div, not a span: Icon renders its own div around the svg. */}
                    <div
                      aria-hidden="true"
                      className="flex h-6 w-4 flex-none items-center justify-center"
                    >
                      {step.isDone ? (
                        <Icon
                          icon={IconProp.CheckCircle}
                          className="h-4 w-4 text-emerald-600"
                        />
                      ) : (
                        <span className="h-3 w-3 rounded-full border-2 border-gray-300" />
                      )}
                    </div>
                    <p
                      className={`min-w-0 flex-1 break-words text-sm leading-6 ${
                        step.isDone ? "text-gray-500" : "text-gray-900"
                      }`}
                    >
                      {step.text}
                    </p>
                  </li>
                );
              })}
            </ul>

            {links.length > 0 ? (
              <div
                data-testid="ai-off-summary-links"
                className="mt-3 flex flex-wrap gap-x-5 gap-y-1"
              >
                {links.map((stepLink: AiOffStepLink): ReactElement => {
                  /*
                   * The arrow is part of the words' line, glued to the last
                   * one by a no-break space that cannot wrap away from it: a
                   * name that wraps on a phone ends with its arrow, which
                   * never sits alone at the card's far edge or on a line of
                   * its own.
                   */
                  return (
                    <Link
                      key={stepLink.route.toString()}
                      to={stepLink.route}
                      className="min-w-0 break-words rounded text-sm font-medium leading-6 text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                    >
                      {stepLink.text}
                      <span className="whitespace-nowrap">
                        {" "}
                        <span
                          aria-hidden="true"
                          data-testid="ai-off-summary-link-arrow"
                          className="inline-block align-middle"
                        >
                          <Icon
                            icon={IconProp.ArrowRight}
                            className="h-4 w-4"
                          />
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <></>
            )}

            {whoCanChange.length > 0 ? (
              <div data-testid="ai-off-summary-who" className="mt-3 space-y-1">
                {whoCanChange.map((sentence: string): ReactElement => {
                  return (
                    <p
                      key={sentence}
                      className="break-words text-sm leading-6 text-gray-600"
                    >
                      {sentence}
                    </p>
                  );
                })}
              </div>
            ) : (
              <></>
            )}

            <p
              data-testid="ai-off-summary-note"
              className="mt-3 break-words text-xs leading-5 text-gray-500"
            >
              {summary.note}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiOffSummary;
