import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "Common/Types/AI/AIChatTypes";
import { isAISetupAction } from "Common/Types/AI/AISetupActions";
import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import { createTranslator } from "Common/Types/Translator";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ToolActionSentence, { ToolActionSentences } from "./ToolActionSentence";
import {
  ActionArgumentOptions,
  ActionArgumentPart,
  DrawnActionSentence,
  getActionArgumentParts,
  getToolActionDescribedArguments,
  getToolActionDescription,
  getToolActionLeavesOutLists,
  getToolActionNamedArguments,
  getToolActionShownValues,
  getToolActionTitle,
  getToolActionTitleLabel,
} from "./ToolActionWords";

export interface ToolDecision {
  toolCallId: string;
  approved: boolean;
}

export interface ComponentProps {
  toolActions: Array<AIChatToolAction>;
  // True only while the message is WaitingForApproval (buttons are live).
  interactive: boolean;
  isSubmitting: boolean;
  onRespond: (decisions: Array<ToolDecision>) => void;
}

// What goes between two arguments when they are written on one line.
const ARGUMENT_SEPARATOR: string = "  ·  ";

/*
 * The action's arguments in one line, as text (ToolActionWords
 * getActionArgumentParts): each named in the reader's words - English by
 * default - a list by how many it holds, yes or no in words. The card
 * draws the same arguments a line each.
 */
export function argsPreview(
  args: JSONObject,
  options?: ActionArgumentOptions | undefined,
  translator: Translator = createTranslator(undefined),
): string {
  return getActionArgumentParts(args, options || {}, translator)
    .map((part: ActionArgumentPart): string => {
      return `${part.label}: ${part.value}`;
    })
    .join(ARGUMENT_SEPARATOR);
}

// The line a setup plan's card ends with (#6829).
export const SETUP_PLAN_END: string = translationKey("Nothing else changes.");

/*
 * Whether the actions waiting are a setup plan (#6829): every one of them a
 * setup action - a monitor, who is paged, a status page - so the card can
 * say nothing else changes. A plan mixed with any other action is not.
 */
export function isSetupPlan(pending: ReadonlyArray<AIChatToolAction>): boolean {
  return (
    pending.length > 0 &&
    pending.every((action: AIChatToolAction): boolean => {
      return isAISetupAction(action.toolName);
    })
  );
}

const statusChipTone: { [key in AIChatToolActionStatus]: string } = {
  [AIChatToolActionStatus.Pending]: "bg-amber-100 text-amber-700",
  [AIChatToolActionStatus.Approved]: "bg-sky-100 text-sky-700",
  [AIChatToolActionStatus.Executed]: "bg-emerald-100 text-emerald-700",
  [AIChatToolActionStatus.Denied]: "bg-gray-200 text-gray-600",
  [AIChatToolActionStatus.Failed]: "bg-rose-100 text-rose-700",
  [AIChatToolActionStatus.Skipped]: "bg-gray-100 text-gray-500",
};

// How each status reads on its chip: English keys, translated when drawn.
const statusLabel: { [key in AIChatToolActionStatus]: string } = {
  [AIChatToolActionStatus.Pending]: translationKey("Pending"),
  [AIChatToolActionStatus.Approved]: translationKey("Approved"),
  [AIChatToolActionStatus.Executed]: translationKey("Executed"),
  [AIChatToolActionStatus.Denied]: translationKey("Denied"),
  [AIChatToolActionStatus.Failed]: translationKey("Failed"),
  [AIChatToolActionStatus.Skipped]: translationKey("Skipped"),
};

const statusIcon: { [key in AIChatToolActionStatus]: IconProp } = {
  [AIChatToolActionStatus.Pending]: IconProp.Clock,
  [AIChatToolActionStatus.Approved]: IconProp.Check,
  [AIChatToolActionStatus.Executed]: IconProp.CheckCircle,
  [AIChatToolActionStatus.Denied]: IconProp.Close,
  [AIChatToolActionStatus.Failed]: IconProp.Error,
  [AIChatToolActionStatus.Skipped]: IconProp.Close,
};

const ToolApprovalCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const pending: Array<AIChatToolAction> = props.toolActions.filter(
    (action: AIChatToolAction) => {
      return (
        action.status === AIChatToolActionStatus.Pending &&
        action.requiresApproval
      );
    },
  );

  const resolved: Array<AIChatToolAction> = props.toolActions.filter(
    (action: AIChatToolAction) => {
      return !(
        action.status === AIChatToolActionStatus.Pending &&
        action.requiresApproval
      );
    },
  );

  /*
   * Per-action selection; default to approve so the common single-action case
   * is one click, while the list stays visible for review.
   */
  const [selections, setSelections] = useState<{ [id: string]: boolean }>({});

  useEffect(() => {
    const initial: { [id: string]: boolean } = {};
    for (const action of pending) {
      initial[action.id] = true;
    }
    setSelections(initial);
  }, [
    pending
      .map((a: AIChatToolAction) => {
        return a.id;
      })
      .join(","),
  ]);

  const submit: (decisions: Array<ToolDecision>) => void = (
    decisions: Array<ToolDecision>,
  ): void => {
    if (props.isSubmitting) {
      return;
    }
    props.onRespond(decisions);
  };

  const approvedCount: number = pending.filter((action: AIChatToolAction) => {
    return selections[action.id] !== false;
  }).length;

  return (
    <div className="space-y-2.5">
      {/* Resolved actions (history) */}
      {resolved.length > 0 && (
        <div className="space-y-1.5">
          {resolved.map((action: AIChatToolAction) => {
            const title: DrawnActionSentence = getToolActionTitle(
              action,
              translator,
            );
            return (
              <div
                key={action.id}
                data-testid="tool-approval-history"
                className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5"
              >
                <span
                  className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusChipTone[action.status]}`}
                >
                  <Icon icon={statusIcon[action.status]} className="h-3 w-3" />
                  {translator.translateText(
                    statusLabel[action.status] || action.status,
                  )}
                </span>
                {/*
                 * What ran, whole, wrapped as the card's titles are: cut
                 * at one line, a phone lost what it changed ("Schweregrad
                 * von Vorfall INC-42 auf C..."), and a Persian line the
                 * start of an English title. Its first line sits level
                 * with the chip.
                 */}
                <span
                  data-testid="tool-approval-history-title"
                  className="line-clamp-3 min-w-0 flex-1 break-words text-xs leading-5 text-gray-700"
                >
                  <ToolActionSentence sentence={title} />
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending approvals */}
      {pending.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <div className="mb-2.5 flex items-center gap-2">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500">
              <Icon
                icon={IconProp.ShieldCheck}
                className="h-3.5 w-3.5 text-white"
              />
            </div>
            <div className="text-xs font-semibold text-amber-800">
              {props.interactive
                ? translator.translatePlural(
                    {
                      one: "The AI wants to perform {{count}} action",
                      other: "The AI wants to perform {{count}} actions",
                    },
                    pending.length,
                  )
                : translator.translateText("Waiting for approval")}
            </div>
          </div>

          <div className="space-y-1.5">
            {pending.map((action: AIChatToolAction) => {
              const isApproved: boolean = selections[action.id] !== false;
              const title: DrawnActionSentence = getToolActionTitle(
                action,
                translator,
              );
              const description: Array<DrawnActionSentence> =
                getToolActionDescription(action, translator);
              // What the action names, run together as one paragraph.
              const lineSentences: Array<DrawnActionSentence> =
                description.filter((sentence: DrawnActionSentence) => {
                  return !sentence.isCaution;
                });
              // What a code change would write over unseen: a line each.
              const cautions: Array<DrawnActionSentence> = description.filter(
                (sentence: DrawnActionSentence) => {
                  return sentence.isCaution === true;
                },
              );
              const argumentParts: Array<ActionArgumentPart> =
                getActionArgumentParts(
                  action.arguments,
                  {
                    leaveOutLists: getToolActionLeavesOutLists(action),
                    title: action.title,
                    shownValues: getToolActionShownValues(action),
                    namedArguments: getToolActionNamedArguments(action),
                    describedArguments: getToolActionDescribedArguments(action),
                    toolName: action.toolName,
                  },
                  translator,
                );
              /*
               * Allow and Skip sit beside the action where the card has
               * room for both, and under it where it has not: beside it
               * on a phone, German's wider buttons left the title 85 px
               * and cut it at three lines.
               */
              return (
                <div
                  key={action.id}
                  data-testid="tool-approval-action"
                  className="rounded-lg border border-amber-200/70 bg-white px-3 py-2 [container-type:inline-size]"
                >
                  <div className="flex flex-col gap-2 [@container(min-width:28rem)]:flex-row [@container(min-width:28rem)]:items-start [@container(min-width:28rem)]:justify-between">
                    <div className="min-w-0">
                      {/*
                       * The action being approved, wrapped: cut at one
                       * line, it lost what it acts on ("Link incident
                       * #1…"). Three lines hold a linking action's title
                       * on a phone in full.
                       */}
                      {/*
                       * The title and the description are the server's
                       * sentences, said in the reader's language
                       * (ToolActionWords): each an isolate that reads its
                       * language's way, its values - a title the model
                       * wrote, a host's name - set apart, so on a Persian
                       * page a Persian sentence reads right to left and
                       * the period of a name stays at its end. The
                       * arguments are the model's, an isolate read the
                       * way most of its letters are (IsolatedText).
                       */}
                      <div
                        data-testid="tool-approval-title"
                        className="line-clamp-3 break-words text-xs font-semibold text-gray-900"
                      >
                        <ToolActionSentence sentence={title} />
                      </div>
                      {/*
                       * What the action names, by name (the resources an
                       * incident is linked to): read before approving it.
                       */}
                      {description.length > 0 && (
                        <div
                          data-testid="tool-approval-description"
                          className="mt-1 break-words text-[11px] leading-relaxed text-gray-700"
                        >
                          {lineSentences.length > 0 && (
                            <ToolActionSentences sentences={lineSentences} />
                          )}
                          {/*
                           * A code change's cautions - a file changed since
                           * Ask AI read it, read in an earlier answer, read
                           * earlier in this answer and left out since - a
                           * line each, marked, so each kind and the files
                           * it names read at a glance before anyone
                           * approves: run together, two cautions that begin
                           * alike read as one sentence (issue #6570). Each
                           * keeps the space that went before it, so the
                           * card's text still reads as sentences.
                           */}
                          {cautions.length > 0 && (
                            <ul
                              role="list"
                              data-testid="tool-approval-cautions"
                              className={`space-y-1${lineSentences.length > 0 ? " mt-1" : ""}`}
                            >
                              {cautions.map(
                                (
                                  sentence: DrawnActionSentence,
                                  index: number,
                                ) => {
                                  return (
                                    <li
                                      key={index}
                                      data-testid="tool-approval-caution"
                                      className="flex items-start gap-1.5"
                                    >
                                      <Icon
                                        icon={IconProp.Alert}
                                        className="mt-[3px] h-3 w-3 flex-shrink-0 text-amber-600"
                                      />
                                      <span className="min-w-0 flex-1">
                                        {sentence.separatorBefore}
                                        <ToolActionSentence
                                          sentence={sentence}
                                        />
                                      </span>
                                    </li>
                                  );
                                },
                              )}
                            </ul>
                          )}
                        </div>
                      )}
                      {/*
                       * What else it runs with, an argument a line: its
                       * name in the reader's words ("Note", "Files") and
                       * its value, the model's own text an isolate read the
                       * way most of its letters are, in the card's own
                       * face - a note is prose, not code. Each wraps to
                       * four lines of its own: run together on one line
                       * cut at two, a status update's "Notify subscribers:
                       * Yes" fell off the end on a phone, and its note was
                       * cut mid-sentence, before anyone approved it.
                       */}
                      {argumentParts.length > 0 && (
                        <dl
                          data-testid="tool-approval-arguments"
                          className="mt-1.5 space-y-0.5 text-[11px] leading-[1.125rem]"
                        >
                          {argumentParts.map((part: ActionArgumentPart) => {
                            return (
                              <div
                                key={part.key}
                                data-testid="tool-approval-argument"
                                className="line-clamp-4 break-words"
                              >
                                <dt
                                  data-testid="tool-approval-argument-label"
                                  className="inline font-medium text-gray-500"
                                >
                                  {part.label}:
                                </dt>{" "}
                                <dd
                                  data-testid="tool-approval-argument-value"
                                  className="inline text-gray-700"
                                >
                                  <IsolatedText text={part.value} />
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      )}
                    </div>
                    {props.interactive && (
                      /*
                       * A pair of toggles, named after the action they
                       * decide: with several actions, "Allow" alone did
                       * not say which one a screen reader was on.
                       */
                      <div
                        role="group"
                        aria-label={getToolActionTitleLabel(action, translator)}
                        data-testid="tool-approval-choice"
                        className="flex flex-shrink-0 self-start overflow-hidden rounded-md border border-gray-200"
                      >
                        <button
                          type="button"
                          aria-pressed={isApproved}
                          disabled={props.isSubmitting}
                          onClick={() => {
                            setSelections(
                              (current: { [id: string]: boolean }) => {
                                return { ...current, [action.id]: true };
                              },
                            );
                          }}
                          className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            isApproved
                              ? "bg-gray-900 text-white"
                              : "bg-white text-gray-500 hover:bg-gray-50"
                          }`}
                        >
                          {translator.translateText("Allow")}
                        </button>
                        <button
                          type="button"
                          aria-pressed={!isApproved}
                          disabled={props.isSubmitting}
                          onClick={() => {
                            setSelections(
                              (current: { [id: string]: boolean }) => {
                                return { ...current, [action.id]: false };
                              },
                            );
                          }}
                          className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            !isApproved
                              ? "bg-gray-500 text-white"
                              : "bg-white text-gray-500 hover:bg-gray-50"
                          }`}
                        >
                          {translator.translateText("Skip")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/*
           * A setup plan (#6829): every part is a line above, and nothing
           * else is made - said once, under the last part, so the person
           * approves what is listed and only that.
           */}
          {isSetupPlan(pending) && (
            <p
              data-testid="tool-approval-setup-plan-end"
              className="mt-2 text-[11px] leading-relaxed text-amber-800"
            >
              {translator.translateText(SETUP_PLAN_END)}
            </p>
          )}

          {props.interactive && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={props.isSubmitting}
                onClick={() => {
                  submit(
                    pending.map((action: AIChatToolAction) => {
                      return {
                        toolCallId: action.id,
                        approved: selections[action.id] !== false,
                      };
                    }),
                  );
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors ${getHandDrawnButtonStateClassName(
                  {
                    isBusy: props.isSubmitting,
                    hoverClassName: "hover:bg-gray-800",
                  },
                )}`}
              >
                {props.isSubmitting ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <Icon icon={IconProp.Play} className="h-3.5 w-3.5" />
                )}
                {approvedCount > 0
                  ? translator.translatePlural(
                      {
                        one: "Run {{count}} action",
                        other: "Run {{count}} actions",
                      },
                      approvedCount,
                    )
                  : translator.translateText("Skip all")}
              </button>
              <button
                type="button"
                disabled={props.isSubmitting}
                onClick={() => {
                  submit(
                    pending.map((action: AIChatToolAction) => {
                      return { toolCallId: action.id, approved: false };
                    }),
                  );
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100"
              >
                {translator.translateText("Deny all")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolApprovalCard;
