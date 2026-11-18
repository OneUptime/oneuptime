import PushNotificationLevelControl from "../PushNotificationLevelControl";
import PushRepeatControl from "../PushRepeatControl";
import LeaveWithoutSavingQuestion from "../../UnsavedChanges/LeaveWithoutSavingQuestion";
import {
  AddMethodMenu,
  StepWaitMenu,
  getNextStepWait,
} from "./PagingLadderControls";
import {
  PagingMethodChoice,
  findMethodChoice,
  getAddableMethodChoices,
  getMethodChoiceLabel,
  getNewStep,
} from "./PagingLadderMethods";
import {
  CardName,
  DifferencesList,
  MethodIcon,
  MethodLabel,
  UNKNOWN_METHOD_LABEL,
} from "./PagingLadderParts";
import {
  PAGING_LADDER_COPY,
  PAGING_LADDER_DEFAULT_START_COPY,
  describeDefaultStartLeftOut,
} from "./PagingLadderWords";
import {
  NotSentNowMark,
  StepsNotSentNowNotice,
  getChannelsNotSentNowInSteps,
  isStepNotSentNow,
} from "./StepsNotSentNow";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PagingLadderDifference,
  PagingLadderStep,
  getPagingLadderMethodKey,
  getPagingLadderStepKey,
  normalizePagingLadderSteps,
} from "Common/Types/NotificationRule/PagingLadder";
import {
  PagingLadderFromDefault,
  getChannelsOfPagingLadderSteps,
  isSamePagingLadder,
} from "Common/Types/NotificationRule/PagingLadderDefault";
import PushNotificationLevel from "Common/Types/NotificationRule/PushNotificationLevel";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { useUnsavedChanges } from "Common/UI/Utils/NewVersion/UnsavedChanges";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useLeaveGuard, {
  LeavePrompt,
  SaveBeforeLeavingFunction,
} from "Common/UI/Utils/UseLeaveGuard";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE LADDER (#6820, drawn as steps in #8139): how a person is reached when
 * they are paged, as one list that applies to every kind of page and every
 * severity.
 *
 * It is drawn as numbered steps down a line, the way a page goes out: step
 * 1 "At once", step 2 "After 5 minutes", each with the ways to reach the
 * person that go out together at that time, and each later one marked as
 * skipped once somebody acknowledges. A step's time is its heading, and is
 * changed there: the whole step moves. Add puts another way into a step;
 * Add Step starts a step after the last. A push also says how it sounds
 * and how often it repeats until somebody acknowledges.
 *
 * Nothing is written until Save Changes, which shows with Discard Changes
 * only once there is something to save; leaving the page before then asks
 * first (useLeaveGuard). Save writes the ladder into every card of the
 * grid in one request (PagingLadderService).
 *
 * The steps stay the page for somebody whose cards differ too (#8890):
 * the cards that differ are listed under the steps, and Save Changes
 * leaves them as they are. Using the ladder for them as well is its own
 * button at the end of that list, and names them before it saves.
 * Different for Some Severities, the way to the grid of cards, is a button
 * beside the title, not a link at the card's foot that people missed.
 *
 * In a project with a default ladder, Start From the Project's Default sits
 * beside it while the steps are not the default's (#9445): it fills the
 * steps with the default, mapped to the person's verified methods, and says
 * what it left out; Save Changes saves them as any change is saved. A step
 * this server can't send right now is marked, and the card says once why
 * and who can fix it (#9446).
 */

export interface ComponentProps {
  // Already in the reader's language.
  title: string;
  description: string;
  // The ladder as saved: what the rules make now.
  savedSteps: ReadonlyArray<PagingLadderStep>;
  methods: ReadonlyArray<PagingMethodChoice>;
  isEditable: boolean;
  isPushTurnedOff: boolean;
  // Cards that differ from the ladder, which a save replaces.
  differences: ReadonlyArray<PagingLadderDifference>;
  severityColors: Record<string, string>;
  // For a member: their first name, for the words that name them.
  memberName?: string | undefined;
  /*
   * Saves the steps. `keepDifferences`: the cards that differ keep their
   * own rules; false, they take the ladder too.
   */
  onSave: (
    steps: Array<PagingLadderStep>,
    keepDifferences: boolean,
  ) => Promise<void>;
  /*
   * Opens the grid of cards, a tab per kind and a card per severity, for
   * somebody who wants some severities to page differently. Left out, the
   * ladder offers no way there.
   */
  onOpenGrid?: (() => void) | undefined;
  // Your own Notification Methods, offered at the end of every Add menu.
  setUpMoreMethodsRoute?: Route | undefined;
  // Below the steps: what is not verified yet, or why nothing can be added.
  footer?: ReactElement | undefined;
  /*
   * Words for a ladder that is nobody's own - the project's default ladder
   * of channels (#7449) - already in the reader's language: the empty
   * ladder's sentence, its button and each step's Add, and what a save
   * says. Left out, the person's own words.
   */
  noStepsText?: string | undefined;
  addLabel?: string | undefined;
  savedText?: string | undefined;
  /*
   * The project's default ladder, as this person's steps (#9445,
   * getPagingLadderDefaultStart): Start From the Project's Default, beside
   * the title, fills the steps with it, and they say what it left out until
   * they are saved. Left out, nothing is offered.
   */
  defaultStart?: PagingLadderFromDefault | null | undefined;
  // Told when the steps are filled from the default.
  onStartFromDefault?: ((start: PagingLadderFromDefault) => void) | undefined;
  /*
   * The channels this server can't send through right now (#9446,
   * getChannelsNotSentNow): each of their steps is marked, and the card
   * says once why and who can fix it.
   */
  channelsNotSentNow?: ReadonlyArray<OnCallPageChannel> | undefined;
}

const getStepsSignature: (steps: ReadonlyArray<PagingLadderStep>) => string = (
  steps: ReadonlyArray<PagingLadderStep>,
): string => {
  return normalizePagingLadderSteps(steps)
    .map(getPagingLadderStepKey)
    .join(",");
};

export interface WaitGroup {
  wait: number;
  // Index into the draft, so a change reaches the right step.
  stepIndexes: Array<number>;
}

// The draft's steps, by wait, in paging order.
export const groupStepsByWait: (
  steps: ReadonlyArray<PagingLadderStep>,
) => Array<WaitGroup> = (
  steps: ReadonlyArray<PagingLadderStep>,
): Array<WaitGroup> => {
  const groups: Map<number, Array<number>> = new Map<number, Array<number>>();

  steps.forEach((step: PagingLadderStep, index: number) => {
    const list: Array<number> = groups.get(step.notifyAfterMinutes) || [];
    list.push(index);
    groups.set(step.notifyAfterMinutes, list);
  });

  return Array.from(groups.entries())
    .sort((a: [number, Array<number>], b: [number, Array<number>]): number => {
      return a[0] - b[0];
    })
    .map((entry: [number, Array<number>]): WaitGroup => {
      return { wait: entry[0], stepIndexes: entry[1] };
    });
};

const PagingLadderEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [draft, setDraft] = useState<Array<PagingLadderStep>>(
    normalizePagingLadderSteps(props.savedSteps),
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [savedNote, setSavedNote] = useState<boolean>(false);
  // Whether the last save left the cards that differ as they were.
  const [savedKeptDifferences, setSavedKeptDifferences] =
    useState<boolean>(false);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  // Different for Some Severities was pressed over changes not saved yet.
  const [isAskingToOpenGrid, setIsAskingToOpenGrid] = useState<boolean>(false);

  const savedSignature: string = getStepsSignature(props.savedSteps);

  // A save, or a change on the grid, gives the editor a new ladder to start from.
  useEffect(() => {
    setDraft(normalizePagingLadderSteps(props.savedSteps));
  }, [savedSignature]);

  const isDirty: boolean = getStepsSignature(draft) !== savedSignature;
  const hasDifferences: boolean = props.differences.length > 0;
  // Save Changes keeps the cards that differ, so it saves only a change.
  const canSave: boolean = draft.length > 0 && isDirty && !isSaving;
  // Using the ladder for every severity replaces the differences, changed or not.
  const canUseForEverySeverity: boolean =
    draft.length > 0 && hasDifferences && !isSaving;

  // Changes not saved yet: a new version of the Dashboard does not reload under them...
  useUnsavedChanges(isDirty);
  // ...and leaving the page asks first.
  const leavePrompt: LeavePrompt = useLeaveGuard(isDirty);

  const channelsNotSentNow: ReadonlyArray<OnCallPageChannel> =
    props.channelsNotSentNow || [];

  /*
   * Start From the Project's Default (#9445), for somebody who may change
   * these steps: offered until the steps are the default's.
   */
  const defaultStart: PagingLadderFromDefault | null =
    props.isEditable && props.defaultStart ? props.defaultStart : null;
  const isDraftTheDefault: boolean = Boolean(
    defaultStart && isSamePagingLadder(draft, defaultStart.steps),
  );
  const isStartOffered: boolean = Boolean(defaultStart) && !isDraftTheDefault;

  const addableMethods: Array<PagingMethodChoice> = getAddableMethodChoices({
    choices: props.methods,
    isPushTurnedOff: props.isPushTurnedOff,
  });

  const setUpMoreMethodsRoute: Route | undefined = props.setUpMoreMethodsRoute;
  const onSetUpMore: (() => void) | undefined = setUpMoreMethodsRoute
    ? (): void => {
        Navigation.navigate(setUpMoreMethodsRoute);
      }
    : undefined;

  /*
   * Every change keeps the draft as a ladder is kept: in paging order, and
   * a way to reach the person said once per time - two steps moved to the
   * same time go out together.
   */
  const changeDraft: (
    change: (current: Array<PagingLadderStep>) => Array<PagingLadderStep>,
  ) => void = (
    change: (current: Array<PagingLadderStep>) => Array<PagingLadderStep>,
  ): void => {
    setSavedNote(false);
    setDraft((current: Array<PagingLadderStep>) => {
      return normalizePagingLadderSteps(change(current));
    });
  };

  const updateStep: (
    index: number,
    change: Partial<PagingLadderStep>,
  ) => void = (index: number, change: Partial<PagingLadderStep>): void => {
    changeDraft((current: Array<PagingLadderStep>) => {
      return current.map((step: PagingLadderStep, i: number) => {
        return i === index ? { ...step, ...change } : step;
      });
    });
  };

  const removeStep: (index: number) => void = (index: number): void => {
    changeDraft((current: Array<PagingLadderStep>) => {
      return current.filter((_step: PagingLadderStep, i: number) => {
        return i !== index;
      });
    });
  };

  // A step's new time: everything in it moves there together.
  const changeWait: (fromWait: number, toWait: number) => void = (
    fromWait: number,
    toWait: number,
  ): void => {
    changeDraft((current: Array<PagingLadderStep>) => {
      return current.map((step: PagingLadderStep) => {
        return step.notifyAfterMinutes === fromWait
          ? { ...step, notifyAfterMinutes: toWait }
          : step;
      });
    });
  };

  const addStep: (choice: PagingMethodChoice, wait: number) => void = (
    choice: PagingMethodChoice,
    wait: number,
  ): void => {
    changeDraft((current: Array<PagingLadderStep>) => {
      return [...current, { ...getNewStep(choice), notifyAfterMinutes: wait }];
    });
  };

  const discard: () => void = (): void => {
    setError("");
    setSavedNote(false);
    setDraft(normalizePagingLadderSteps(props.savedSteps));
  };

  // The steps become the default's; nothing is saved until Save Changes.
  const startFromDefault: () => void = (): void => {
    if (!defaultStart) {
      return;
    }

    setError("");
    changeDraft(() => {
      return [...defaultStart.steps];
    });
    props.onStartFromDefault?.(defaultStart);
  };

  /*
   * The steps saved into the cards: rejects with why they were not, which
   * the editor says under them, or the question leaving it asks says.
   */
  const saveSteps: (keepDifferences: boolean) => Promise<void> = async (
    keepDifferences: boolean,
  ): Promise<void> => {
    setIsConfirming(false);
    setIsSaving(true);
    setError("");

    try {
      await props.onSave(normalizePagingLadderSteps(draft), keepDifferences);
    } finally {
      setIsSaving(false);
    }

    setSavedKeptDifferences(keepDifferences);
    setSavedNote(true);
  };

  const save: (keepDifferences: boolean) => Promise<void> = async (
    keepDifferences: boolean,
  ): Promise<void> => {
    try {
      await saveSteps(keepDifferences);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  // Save Changes: the cards that differ, if any, keep their own rules.
  const onSaveClick: () => void = (): void => {
    save(hasDifferences).catch(() => {
      // save() reports its own failure.
    });
  };

  /*
   * Save Changes in the question leaving the steps asks: the bar's own,
   * offered while the bar offers it - a ladder with no steps saves nothing.
   */
  const saveBeforeLeaving: (() => Promise<void>) | undefined =
    draft.length > 0
      ? (): Promise<void> => {
          return saveSteps(hasDifferences);
        }
      : undefined;

  const openGrid: () => void = (): void => {
    if (!props.onOpenGrid) {
      return;
    }

    // The grid takes the ladder's place: changes not saved yet would go with it.
    if (isDirty) {
      setIsAskingToOpenGrid(true);
      return;
    }

    props.onOpenGrid();
  };

  const groups: Array<WaitGroup> = groupStepsByWait(draft);
  const lastGroup: WaitGroup | undefined = groups[groups.length - 1];
  const nextStepWait: number | null = lastGroup
    ? getNextStepWait(lastGroup.wait)
    : null;

  const addLabel: string =
    props.addLabel ||
    (props.memberName
      ? translator.translateTemplate(PAGING_LADDER_COPY.memberAddPlaceholder, {
          name: props.memberName,
        })
      : translator.translateTemplate(PAGING_LADDER_COPY.ownAddPlaceholder));

  const noStepsText: string =
    props.noStepsText ||
    (props.memberName
      ? translator.translateTemplate(PAGING_LADDER_COPY.memberNoSteps, {
          name: props.memberName,
        })
      : translator.translateTemplate(PAGING_LADDER_COPY.ownNoSteps));

  // One way to reach the person, in its step: what it is, how a push sounds, and its ×.
  const getStepRow: (index: number) => ReactElement = (
    index: number,
  ): ReactElement => {
    const step: PagingLadderStep = draft[index]!;
    const choice: PagingMethodChoice | undefined = findMethodChoice(
      props.methods,
      step,
    );
    const isPush: boolean = step.methodColumn === "userPushId";
    const isNotSentNow: boolean = isStepNotSentNow(step, channelsNotSentNow);

    return (
      <li
        key={`${getPagingLadderStepKey(step)}-${index}`}
        className="flex items-start gap-3 px-3 py-2.5"
        data-testid="paging-ladder-step"
      >
        <MethodIcon step={step} />
        <div className="flex min-h-7 min-w-0 flex-1 flex-col justify-center gap-1.5">
          {isNotSentNow ? (
            // Why it is not sent is said once, above the steps (#9446).
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <MethodLabel choice={choice} />
              <NotSentNowMark />
            </div>
          ) : (
            <MethodLabel choice={choice} />
          )}
          {isPush ? (
            <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
              {choice?.hasPushLevel !== false ? (
                <PushNotificationLevelControl
                  level={step.pushNotificationLevel}
                  isEditable={props.isEditable}
                  onChange={(level: PushNotificationLevel): Promise<void> => {
                    updateStep(index, { pushNotificationLevel: level });
                    return Promise.resolve();
                  }}
                />
              ) : (
                <></>
              )}
              <PushRepeatControl
                repeatEveryMinutes={step.repeatEveryMinutes}
                isEditable={props.isEditable}
                onChange={(repeatEveryMinutes: number): Promise<void> => {
                  updateStep(index, { repeatEveryMinutes: repeatEveryMinutes });
                  return Promise.resolve();
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </div>
        {props.isEditable ? (
          // As tall as the method's first line, so the × sits beside its name.
          <div className="flex h-7 flex-none items-center">
            <Button
              buttonStyle={ButtonStyleType.ICON}
              buttonSize={ButtonSize.Small}
              icon={IconProp.Close}
              tooltip={PAGING_LADDER_COPY.remove}
              ariaLabel={translator.translateTemplate(
                PAGING_LADDER_COPY.removeMethod,
                {
                  name: choice
                    ? getMethodChoiceLabel(translator, choice)
                    : translator.translateText(UNKNOWN_METHOD_LABEL) ||
                      UNKNOWN_METHOD_LABEL,
                },
              )}
              isAriaLabelTranslated={true}
              dataTestId="paging-ladder-step-remove"
              onClick={() => {
                removeStep(index);
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </li>
    );
  };

  // A step's own Add: the ways to reach the person that are not in it yet.
  const getGroupAdd: (group: WaitGroup) => ReactElement = (
    group: WaitGroup,
  ): ReactElement => {
    const inGroup: Set<string> = new Set<string>(
      group.stepIndexes.map((index: number): string => {
        return getPagingLadderMethodKey(draft[index]!);
      }),
    );
    const methods: Array<PagingMethodChoice> = addableMethods.filter(
      (choice: PagingMethodChoice): boolean => {
        return !inGroup.has(getPagingLadderMethodKey(choice));
      },
    );

    if (!props.isEditable || (methods.length === 0 && !onSetUpMore)) {
      return <></>;
    }

    return (
      <AddMethodMenu
        methods={methods}
        onPick={(choice: PagingMethodChoice) => {
          addStep(choice, group.wait);
        }}
        onSetUpMore={onSetUpMore}
        dataTestId="paging-ladder-add-to-step-menu"
        trigger={
          <button
            type="button"
            className="inline-flex flex-none items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label={addLabel}
            data-testid="paging-ladder-add-to-step"
          >
            <Icon icon={IconProp.Add} className="h-4 w-4 flex-shrink-0" />
            <span>{translator.translateText(PAGING_LADDER_COPY.add)}</span>
          </button>
        }
      />
    );
  };

  const isAddStepShown: boolean =
    props.isEditable && nextStepWait !== null && addableMethods.length > 0;

  const steps: ReactElement = (
    <ol className="flex max-w-3xl flex-col" data-testid="paging-ladder-steps">
      {groups.map((group: WaitGroup, groupIndex: number) => {
        const isLastOnTheLine: boolean =
          groupIndex === groups.length - 1 && !isAddStepShown;

        return (
          <li
            key={group.wait}
            className="flex gap-3"
            data-testid="paging-ladder-wait-group"
          >
            {/* The line the page goes down: the step's number, then on to the next. */}
            <div className="flex flex-none flex-col items-center">
              <span
                className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200"
                aria-hidden="true"
                data-testid="paging-ladder-step-number"
              >
                {translator.formatNumber(groupIndex + 1)}
              </span>
              {isLastOnTheLine ? (
                <></>
              ) : (
                <span
                  className="my-1 w-px flex-1 bg-gray-200"
                  aria-hidden="true"
                ></span>
              )}
            </div>
            <div className={`min-w-0 flex-1 ${isLastOnTheLine ? "" : "pb-6"}`}>
              <div className="flex min-h-7 items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <StepWaitMenu
                    wait={group.wait}
                    isEditable={props.isEditable}
                    onChange={(wait: number) => {
                      changeWait(group.wait, wait);
                    }}
                  />
                  {group.wait > 0 ? (
                    <span
                      className="text-xs text-gray-500"
                      data-testid="paging-ladder-if-not-acknowledged"
                    >
                      {translator.translateText(
                        PAGING_LADDER_COPY.ifNobodyAcknowledged,
                      )}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
                {getGroupAdd(group)}
              </div>
              <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {group.stepIndexes.map(getStepRow)}
              </ul>
            </div>
          </li>
        );
      })}

      {isAddStepShown && nextStepWait !== null ? (
        <li className="flex" data-testid="paging-ladder-add-step">
          <AddMethodMenu
            methods={addableMethods}
            onPick={(choice: PagingMethodChoice) => {
              addStep(choice, nextStepWait);
            }}
            onSetUpMore={onSetUpMore}
            dataTestId="paging-ladder-add-step-menu"
            trigger={
              <button
                type="button"
                className="group inline-flex items-center gap-3 rounded-md text-sm font-medium text-gray-600 transition-colors hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                data-testid="paging-ladder-add-step-button"
              >
                <span
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400 transition-colors group-hover:border-indigo-300 group-hover:text-indigo-600"
                  aria-hidden="true"
                >
                  <Icon icon={IconProp.Add} className="h-4 w-4" />
                </span>
                <span>
                  {translator.translateText(PAGING_LADDER_COPY.addStep)}
                </span>
              </button>
            }
          />
        </li>
      ) : (
        <></>
      )}
    </ol>
  );

  const empty: ReactElement = (
    <div
      className="flex max-w-3xl flex-col items-start gap-3 rounded-lg border border-dashed border-gray-300 px-4 py-5"
      data-testid="paging-ladder-empty"
    >
      <p className="text-sm text-gray-600">{noStepsText}</p>
      {props.isEditable && addableMethods.length > 0 ? (
        <AddMethodMenu
          methods={addableMethods}
          onPick={(choice: PagingMethodChoice) => {
            addStep(choice, 0);
          }}
          onSetUpMore={onSetUpMore}
          dataTestId="paging-ladder-add-first-menu"
          trigger={
            /*
             * The shared Button, the empty ladder's one next step: MoreMenu
             * hands it the menu's id, aria and click.
             */
            <Button
              title={addLabel}
              isTitleTranslated={true}
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.PRIMARY}
              dataTestId="paging-ladder-add-first"
            />
          }
        />
      ) : (
        <></>
      )}
    </div>
  );

  /*
   * The cards that differ, under the steps: what each does instead, that
   * Save Changes leaves them so, and the one button that gives them the
   * ladder too. It replaces what makes them different, so it names them
   * first, and it comes last.
   */
  const differencesSection: ReactElement = (
    <div
      className="flex flex-col gap-2 border-t border-gray-100 pt-4"
      data-testid="paging-ladder-differences-section"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {translator.translateText(PAGING_LADDER_COPY.gridIntro)}
      </p>
      {props.isEditable ? (
        <p
          className="text-sm text-gray-500"
          data-testid="paging-ladder-keeps-note"
        >
          {translator.translateText(PAGING_LADDER_COPY.keepsNote)}
        </p>
      ) : (
        <></>
      )}
      <DifferencesList
        differences={props.differences}
        methods={props.methods}
        severityColors={props.severityColors}
        channelsNotSentNow={channelsNotSentNow}
      />
      {props.isEditable ? (
        <div>
          <Button
            title={PAGING_LADDER_COPY.useForEverySeverity}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            icon={IconProp.List}
            disabled={!canUseForEverySeverity}
            dataTestId="paging-ladder-use-for-every-severity"
            onClick={() => {
              setIsConfirming(true);
            }}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );

  /*
   * Under steps filled from the project's default, until they are saved or
   * changed: where they came from, and what the default left out because it
   * is not verified yet (#9445).
   */
  const defaultLeftOut: string = defaultStart
    ? describeDefaultStartLeftOut({
        translator: translator,
        leftOutChannels: defaultStart.leftOutChannels,
        keptChannels: getChannelsOfPagingLadderSteps(defaultStart.keptSteps),
        memberName: props.memberName,
      })
    : "";

  const startedFromDefaultNote: ReactElement =
    defaultStart && isDraftTheDefault && isDirty ? (
      <div
        className="flex max-w-3xl flex-col gap-1 text-sm text-gray-600"
        data-testid="paging-ladder-started-from-default"
      >
        <p>
          {translator.translateText(PAGING_LADDER_DEFAULT_START_COPY.started)}
        </p>
        {defaultLeftOut ? (
          <p data-testid="paging-ladder-default-left-out">{defaultLeftOut}</p>
        ) : (
          <></>
        )}
      </div>
    ) : (
      <></>
    );

  const headerButtons: Array<ReactElement> = [];

  if (isStartOffered) {
    headerButtons.push(
      <Button
        key="start-from-default"
        title={PAGING_LADDER_DEFAULT_START_COPY.start}
        buttonStyle={ButtonStyleType.OUTLINE}
        icon={IconProp.Template}
        dataTestId="paging-ladder-start-from-default"
        onClick={startFromDefault}
      />,
    );
  }

  if (props.onOpenGrid) {
    headerButtons.push(
      <Button
        key="open-grid"
        title={PAGING_LADDER_COPY.differentForSome}
        buttonStyle={ButtonStyleType.NORMAL}
        icon={IconProp.TableCells}
        dataTestId="paging-ladder-open-grid"
        onClick={openGrid}
      />,
    );
  }

  const isSaveOffered: boolean = isDirty;

  // Under the steps, once there is something to save, or it has just been saved.
  const saveBar: ReactElement =
    props.isEditable && (isSaveOffered || savedNote) ? (
      <div
        className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between"
        data-testid="paging-ladder-save-bar"
      >
        <div className="flex min-w-0 flex-col gap-1">
          {savedNote && !isDirty ? (
            <p
              className="flex items-center gap-1.5 text-sm text-emerald-700"
              role="status"
              data-testid="paging-ladder-saved"
            >
              <Icon icon={IconProp.Check} className="h-4 w-4 flex-shrink-0" />
              <span>
                {props.savedText ||
                  translator.translateText(
                    savedKeptDifferences
                      ? PAGING_LADDER_COPY.savedKeepingDifferences
                      : PAGING_LADDER_COPY.saved,
                  )}
              </span>
            </p>
          ) : (
            <></>
          )}
          {isDirty ? (
            <p
              className="flex items-center gap-1.5 text-sm text-amber-700"
              data-testid="paging-ladder-unsaved"
            >
              <span
                className="inline-block h-1.5 w-1.5 flex-none rounded-full bg-amber-500"
                aria-hidden="true"
              ></span>
              <span>
                {translator.translateText(PAGING_LADDER_COPY.unsaved)}
              </span>
            </p>
          ) : (
            <></>
          )}
        </div>
        {isSaveOffered ? (
          <div className="flex flex-none flex-wrap items-center gap-3">
            {isDirty ? (
              <Button
                title={PAGING_LADDER_COPY.discard}
                buttonStyle={ButtonStyleType.NORMAL}
                disabled={isSaving}
                dataTestId="paging-ladder-discard"
                onClick={discard}
              />
            ) : (
              <></>
            )}
            <Button
              title={PAGING_LADDER_COPY.save}
              buttonStyle={ButtonStyleType.PRIMARY}
              icon={IconProp.Check}
              disabled={!canSave}
              isLoading={isSaving}
              dataTestId="paging-ladder-save"
              onClick={onSaveClick}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    ) : (
      <></>
    );

  return (
    <div data-testid="paging-ladder">
      <Card
        title={props.title}
        description={props.description}
        buttons={headerButtons.length > 0 ? headerButtons : undefined}
      >
        <div className="flex flex-col gap-5">
          <StepsNotSentNowNotice
            channels={getChannelsNotSentNowInSteps(
              [
                ...draft,
                // What a card that differs sends besides the steps is marked too.
                ...props.differences.flatMap(
                  (
                    difference: PagingLadderDifference,
                  ): Array<PagingLadderStep> => {
                    return difference.extra;
                  },
                ),
              ],
              channelsNotSentNow,
            )}
          />

          {draft.length === 0 ? empty : steps}

          {startedFromDefaultNote}

          {props.footer || <></>}

          {hasDifferences ? (
            differencesSection
          ) : (
            <p
              className="text-sm text-gray-500"
              data-testid="paging-ladder-scope"
            >
              {translator.translateText(PAGING_LADDER_COPY.scope)}
            </p>
          )}

          {error ? <ErrorMessage message={error} /> : <></>}

          {saveBar}
        </div>
      </Card>

      {isConfirming ? (
        <ConfirmModal
          title={PAGING_LADDER_COPY.confirmTitle}
          description={
            <div className="flex flex-col gap-3">
              <p>
                {props.memberName
                  ? translator.translateTemplate(
                      PAGING_LADDER_COPY.memberConfirmDescription,
                      { name: props.memberName },
                    )
                  : translator.translateText(
                      PAGING_LADDER_COPY.ownConfirmDescription,
                    )}
              </p>
              <ul
                className="flex flex-col gap-1.5"
                data-testid="paging-ladder-confirm-cards"
              >
                {props.differences.map((difference: PagingLadderDifference) => {
                  return (
                    <li
                      key={`${difference.cell.ruleType}|${difference.cell.severityId}`}
                    >
                      <CardName
                        cell={difference.cell}
                        color={props.severityColors[difference.cell.severityId]}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          }
          submitButtonText={PAGING_LADDER_COPY.useForEverySeverity}
          isLoading={isSaving}
          onClose={() => {
            setIsConfirming(false);
          }}
          onSubmit={() => {
            save(false).catch(() => {
              // save() reports its own failure.
            });
          }}
        />
      ) : (
        <></>
      )}

      {/*
       * Different for Some Severities over changes not saved yet: the grid
       * takes the ladder's place, so it asks as leaving the page does.
       */}
      <LeaveWithoutSavingQuestion
        prompt={{
          isAsking: isAskingToOpenGrid,
          stay: () => {
            setIsAskingToOpenGrid(false);
          },
          leave: () => {
            setIsAskingToOpenGrid(false);
            discard();
            props.onOpenGrid?.();
          },
          // Saved first, the grid opens on the ladder as saved.
          saveAndLeave: async (
            saveBeforeOpening: SaveBeforeLeavingFunction,
          ): Promise<void> => {
            await saveBeforeOpening();
            setIsAskingToOpenGrid(false);
            props.onOpenGrid?.();
          },
        }}
        description={PAGING_LADDER_COPY.leaveDescription}
        onSaveChanges={saveBeforeLeaving}
      />

      {/* Last, so it opens above any other dialog. */}
      <LeaveWithoutSavingQuestion
        prompt={leavePrompt}
        description={PAGING_LADDER_COPY.leaveDescription}
        onSaveChanges={saveBeforeLeaving}
      />
    </div>
  );
};

export default PagingLadderEditor;
