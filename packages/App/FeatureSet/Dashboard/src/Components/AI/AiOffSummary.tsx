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
 * The steps as the line draws them: each run of steps made in one place,
 * followed by where that is - a link, for someone who may make them - or
 * by who can make them, for everyone else. So the link sits under the
 * steps it is for: "Turn on Enable AI" over AI Features, the two switches
 * over the record's AI settings. Steps done since go together, with
 * nothing after them. Each place, and each who-can sentence, is said once.
 */
export interface AiOffStepGroup {
  // The first step's key: unique, since a step is in one group only.
  key: string;
  steps: Array<AiOffStep>;
  // Where the steps are made, for someone who may make them.
  link: AiOffStepLink | null;
  // Who can make them, for someone who may not.
  whoCanChange: string | null;
}

/*
 * A menu path in a who-can sentence ("in Incidents → AI → Settings") never
 * starts a line with its arrow: the space before each arrow does not
 * break, so a line ends with the arrow and the next menu starts the next.
 * Right-to-left languages write the path with "←".
 */
export function keepMenuPathArrowsInLine(text: string): string {
  return text
    .split(" \u2192 ")
    .join("\u00a0\u2192 ")
    .split(" \u2190 ")
    .join("\u00a0\u2190 ");
}

export function getAiOffStepGroups(
  steps: Array<AiOffStep>,
  canChange: (step: AiOffStep) => boolean,
): Array<AiOffStepGroup> {
  const groups: Array<AiOffStepGroup> = [];
  // What follows each group: the same for every step in it.
  const followers: Array<string> = [];
  const linked: Set<string> = new Set<string>();
  const told: Set<string> = new Set<string>();

  for (const step of steps) {
    const mayChange: boolean = !step.isDone && canChange(step);
    const route: string =
      mayChange && step.link ? step.link.route.toString() : "";
    const who: string =
      !step.isDone && !mayChange && step.whoCanChange ? step.whoCanChange : "";
    const follower: string = step.isDone
      ? "done"
      : route
        ? `link:${route}`
        : who
          ? `who:${who}`
          : `none:${step.key}`;
    const last: AiOffStepGroup | undefined = groups[groups.length - 1];

    if (last && followers[followers.length - 1] === follower) {
      last.steps.push(step);
      continue;
    }

    groups.push({
      key: step.key,
      steps: [step],
      link: route && !linked.has(route) ? step.link : null,
      whoCanChange: who && !told.has(who) ? who : null,
    });
    followers.push(follower);

    if (route) {
      linked.add(route);
    }

    if (who) {
      told.add(who);
    }
  }

  return groups;
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
  const groups: Array<AiOffStepGroup> = props.isOpen
    ? getAiOffStepGroups(summary.steps, canChange)
    : [];

  /*
   * The line opens where it is clicked, as a folded section's header does:
   * on what is off, on why, on its mark - not only on the chevron, which
   * stays the control a keyboard and a screen reader use. A click on Ask
   * OneUptime AI or the chevron is theirs, and one that ends selecting the
   * words is not taken for a click.
   */
  const onLineClick: (event: React.MouseEvent<HTMLElement>) => void = (
    event: React.MouseEvent<HTMLElement>,
  ): void => {
    const target: EventTarget | null = event.target;

    if (target instanceof Element && target.closest("button, a")) {
      return;
    }

    if (window.getSelection()?.toString()) {
      return;
    }

    props.onToggle();
  };

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
          onClick={onLineClick}
          className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-lg bg-gray-100 text-gray-500"
        >
          <Icon icon={IconProp.Sparkles} className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1 [container-type:inline-size]">
          <div
            data-testid="ai-off-summary-header"
            onClick={onLineClick}
            className="group flex cursor-pointer flex-wrap items-center gap-x-1 gap-y-0.5"
          >
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
              The fold's control, where a card that opens has it: its name
              says what opens - what you can do to turn AI on - and it
              brightens while the pointer is anywhere on the line, which
              opens it too.
            */}
            <button
              type="button"
              data-testid="ai-off-summary-toggle"
              aria-expanded={props.isOpen}
              aria-controls={stepsId}
              aria-label={whatYouCanDo}
              title={whatYouCanDo}
              onClick={props.onToggle}
              className={`${AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.toggle} flex h-7 w-7 flex-none items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 group-hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
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
            one: each change in a sentence, the changes made in one place
            together, and under them where that is for those who may make
            them, or who can for everyone else; then that none of it
            reaches back to this record.
          */}
          <div
            id={stepsId}
            data-testid="ai-off-summary-steps"
            hidden={!props.isOpen}
            className="mt-4 border-t border-gray-200 pt-4"
          >
            <ul role="list" className="space-y-4">
              {groups.map((group: AiOffStepGroup): ReactElement => {
                return (
                  <li
                    key={group.key}
                    data-testid="ai-off-summary-group"
                    className="space-y-1"
                  >
                    {group.steps.map((step: AiOffStep): ReactElement => {
                      return (
                        <div
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
                        </div>
                      );
                    })}

                    {group.link || group.whoCanChange ? (
                      /*
                       * Under the steps' words, past their marks: where
                       * they are made, or who can make them.
                       */
                      <div className="flex items-start gap-2.5">
                        <div aria-hidden="true" className="w-4 flex-none" />
                        {group.link ? (
                          <div
                            data-testid="ai-off-summary-links"
                            className="min-w-0 flex-1"
                          >
                            {/*
                              The arrow is part of the words' line, glued to
                              the last one by a no-break space that cannot
                              wrap away from it: a name that wraps on a
                              phone ends with its arrow, which never sits
                              alone at the card's far edge or on a line of
                              its own.
                            */}
                            <Link
                              to={group.link.route}
                              className="min-w-0 break-words rounded text-sm font-medium leading-6 text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                            >
                              {group.link.text}
                              <span className="whitespace-nowrap">
                                {"\u00a0"}
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
                          </div>
                        ) : (
                          <div
                            data-testid="ai-off-summary-who"
                            className="min-w-0 flex-1"
                          >
                            <p className="break-words text-sm leading-6 text-gray-600">
                              {keepMenuPathArrowsInLine(
                                group.whoCanChange || "",
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <></>
                    )}
                  </li>
                );
              })}
            </ul>

            <p
              data-testid="ai-off-summary-note"
              className="mt-4 break-words text-xs leading-5 text-gray-500"
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
