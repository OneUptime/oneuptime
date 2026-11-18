import {
  WELCOME_CHECKLIST_COPY,
  WELCOME_MINUTES_COPY,
  WelcomeStepEntry,
} from "./WelcomeChecklistCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import {
  WELCOME_STEP_MINUTES,
  WelcomeChecklistStepState,
} from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * ONE STEP OF THE QUICKSTART'S PATH (issue #8897), in the checklist on
 * Home (GettingStarted). The steps are drawn as a path, top to bottom: each
 * step's icon, joined to the next by a line - green once the step is done -
 * so the person sees where they are and what is left at a glance.
 *
 *   - A step to do is a button: Tab reaches it and Enter or Space opens it.
 *     Its name starts with its title, then says it is next, what it does
 *     and about how long it takes.
 *   - The next step stands out, and carries its own Start.
 *   - A step whose record exists but does not work yet says why, in one
 *     line where its time would be (#6938): the step opens the page that
 *     fixes it.
 *   - A step the plan holds back says which plan it needs.
 *   - A done step is a record, not a way anywhere. It may carry one link of
 *     its own under its words (#9442), never inside a control.
 *
 * The same row draws what else to set up once the steps are done (#7986),
 * as offers side by side rather than a path: no line joins them.
 */

export interface ComponentProps {
  state: WelcomeChecklistStepState;
  entry: WelcomeStepEntry;
  // What the step says, in the reader's words (GettingStarted's describe).
  description: string;
  // The last step draws no line to a next one.
  isLast: boolean;
  onOpen: () => void;
  /*
   * Why the step is not done although its record exists, as a sentence in
   * the reader's words (#6938); nothing for a step with no break.
   */
  gap?: ReactNode | undefined;
  /*
   * Under a done step's words: one link of its own (#9442). Drawn only on a
   * done step, which is a record and never a control.
   */
  doneFooter?: ReactNode | undefined;
  // Whether a line joins the step to the next (the path). Offers have none.
  isOnPath?: boolean | undefined;
  /*
   * What the next step's own button says, in the reader's words, when it
   * does something more exact than Start: the fix of what it is missing
   * ("Add Monitors", #6938).
   */
  startTitle?: string | undefined;
  /*
   * What its test ids are named after: the step's key, unless the row
   * stands for something else drawn in a step's shape (an offer, #9442).
   */
  testIdKey?: string | undefined;
}

export const STEP_GAP_CLASS_NAME: string =
  "mt-2 flex items-start gap-1.5 text-sm text-amber-800";

// A step's words and what it ends on: under them on a phone, beside from sm.
export const STEP_WORDS_OVER_ACTION_CLASS_NAME: string =
  "flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between";

// A step's words and its chevron, side by side at every width.
export const STEP_WORDS_BESIDE_CHEVRON_CLASS_NAME: string =
  "flex min-w-0 flex-1 flex-row items-center justify-between gap-3";

/*
 * The line from a step's icon down to the next one's. The row has a 1px
 * border and 12px/16px padding, so the 44px icon's middle is 35px from the
 * row's start; the line starts 4px under the icon and ends 4px above the
 * next one's, over that row's padding. Logical sides: on a page read from
 * the right, the path runs down its right.
 */
export const PATH_LINE_CLASS_NAME: string =
  "pointer-events-none absolute start-[34px] top-[65px] -bottom-[13px] z-10 w-0.5 rounded-full";

const ROW_CLASS_NAME: string =
  "group relative flex w-full items-start gap-4 rounded-xl border px-3 py-4 text-start transition";

const WelcomePlanStep: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { state, entry } = props;
  const isDone: boolean = state.isDone;
  const isHeldBack: boolean = !isDone && state.needsPlan !== null;
  const key: string = props.testIdKey || state.step;
  const gap: ReactNode = !isDone && !isHeldBack ? props.gap : null;
  const isOnPath: boolean = props.isOnPath !== false;
  /*
   * A step to do that is not next ends on a chevron, which sits beside its
   * words at every width, as How OneUptime works' line has it: alone on a
   * line of its own under them, a phone drew an arrow pointing at nothing.
   * Start, Done and the plan's pill go under the words on a phone.
   */
  const endsOnChevron: boolean = !isDone && !isHeldBack && !state.isNext;

  // Spans, not divs: a button may only hold phrasing content.
  const content: ReactElement = (
    <>
      <span
        aria-hidden="true"
        className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl ${
          isDone ? "bg-emerald-500" : entry.iconBackgroundClassName
        }`}
      >
        <Icon
          icon={isDone ? IconProp.Check : entry.icon}
          className="h-5 w-5 text-white"
        />
      </span>
      <span
        className={
          endsOnChevron
            ? STEP_WORDS_BESIDE_CHEVRON_CLASS_NAME
            : STEP_WORDS_OVER_ACTION_CLASS_NAME
        }
      >
        <span className="block min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={`text-base font-semibold ${
                isDone ? "text-gray-500" : "text-gray-900"
              }`}
            >
              {translator.translateText(entry.title)}
            </span>
            {state.isNext ? (
              <span
                data-testid="getting-started-next"
                className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white"
              >
                {translator.translateText(WELCOME_CHECKLIST_COPY.nextBadge)}
              </span>
            ) : (
              <></>
            )}
          </span>
          <span
            data-testid={`getting-started-task-${key}-description`}
            className={`mt-1 block text-sm ${
              isDone ? "text-gray-500" : "text-gray-600"
            }`}
          >
            {props.description}
          </span>
          {gap ? (
            /*
             * What is missing, where the time would be: the record is
             * there, so what is left is the one fix this names.
             */
            <span
              data-testid={`getting-started-task-${key}-gap`}
              className={STEP_GAP_CLASS_NAME}
            >
              <Icon
                icon={IconProp.ExclaimationCircle}
                className="mt-0.5 h-4 w-4 flex-none text-amber-600"
              />
              <span className="min-w-0">{gap}</span>
            </span>
          ) : !isDone && !isHeldBack ? (
            <span
              data-testid={`getting-started-task-${key}-minutes`}
              className="mt-2 flex items-center gap-1 text-xs text-gray-500"
            >
              <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 flex-none" />
              <span>
                {translator.translatePlural(
                  WELCOME_MINUTES_COPY.about,
                  WELCOME_STEP_MINUTES[state.step],
                )}
              </span>
            </span>
          ) : (
            <></>
          )}
          {isDone && props.doneFooter ? (
            <span
              data-testid={`getting-started-task-${key}-footer`}
              className="mt-2 block"
            >
              {props.doneFooter}
            </span>
          ) : (
            <></>
          )}
        </span>
        <span className="flex flex-none items-center">
          {isDone ? (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
              <Icon icon={IconProp.CheckCircle} className="h-4 w-4 flex-none" />
              {translator.translateText(WELCOME_CHECKLIST_COPY.done)}
            </span>
          ) : isHeldBack ? (
            <span
              data-testid={`getting-started-task-${state.step}-needs-plan`}
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
            >
              {translator.translateTemplate(WELCOME_CHECKLIST_COPY.needsPlan, {
                plan: state.needsPlan || "",
              })}
            </span>
          ) : state.isNext ? (
            /*
             * Drawn as a button, inside the row that is one: the whole row
             * opens the step, and this says so where the eye lands.
             */
            <span
              data-testid="getting-started-start"
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition group-hover:bg-indigo-500"
            >
              {props.startTitle ||
                translator.translateText(WELCOME_CHECKLIST_COPY.startButton)}
              <Icon icon={IconProp.ArrowRight} className="h-4 w-4 flex-none" />
            </span>
          ) : (
            /*
             * Grey at rest, indigo on hover - on two elements: the dark
             * theme paints any hovered group child that carries a
             * text-gray-* class near-white, which would outrank the
             * indigo on one element.
             */
            <span className="text-gray-400">
              <Icon
                icon={IconProp.ChevronRight}
                className="h-5 w-5 transition group-hover:text-indigo-500"
              />
            </span>
          )}
        </span>
      </span>
    </>
  );

  return (
    <li className="relative" data-testid={`getting-started-step-${key}`}>
      {props.isLast || !isOnPath ? (
        <></>
      ) : (
        <span
          aria-hidden="true"
          data-testid={`getting-started-path-${key}`}
          data-done={isDone ? "true" : "false"}
          className={`${PATH_LINE_CLASS_NAME} ${
            isDone ? "bg-emerald-500" : "bg-gray-200"
          }`}
        ></span>
      )}
      {isDone ? (
        // A done step is a record, not a way anywhere.
        <div
          data-testid={`getting-started-task-${key}`}
          data-done="true"
          className={`${ROW_CLASS_NAME} border-transparent`}
        >
          {content}
        </div>
      ) : (
        /*
         * A step to do is a button: Tab reaches it, and Enter or Space
         * opens it.
         */
        <button
          type="button"
          onClick={props.onOpen}
          data-testid={`getting-started-task-${key}`}
          data-done="false"
          data-next={state.isNext ? "true" : "false"}
          data-gap={gap ? "true" : "false"}
          className={`${ROW_CLASS_NAME} focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            state.isNext
              ? "border-indigo-200 bg-indigo-50 shadow-sm hover:border-indigo-300"
              : "border-transparent hover:border-gray-200 hover:bg-gray-50"
          }`}
        >
          {content}
        </button>
      )}
    </li>
  );
};

export default WelcomePlanStep;
