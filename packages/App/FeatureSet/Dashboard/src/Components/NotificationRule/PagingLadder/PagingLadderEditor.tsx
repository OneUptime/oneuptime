import NotifyAfterMinutesDropdownOptions from "../NotifyAfterMinutesDropdownOptions";
import PushNotificationLevelControl from "../PushNotificationLevelControl";
import PushRepeatControl from "../PushRepeatControl";
import {
  PagingMethodChoice,
  findMethodChoice,
  getAddableMethodChoices,
  getNewStep,
} from "./PagingLadderMethods";
import { CardName, MethodLabel } from "./PagingLadderParts";
import {
  AFTER_MINUTES,
  PAGING_LADDER_COPY,
  describeWait,
} from "./PagingLadderWords";
import {
  PagingLadderDifference,
  PagingLadderStep,
  getPagingLadderMethodKey,
  getPagingLadderStepKey,
  normalizePagingLadderSteps,
} from "Common/Types/NotificationRule/PagingLadder";
import IconProp from "Common/Types/Icon/IconProp";
import PushNotificationLevel from "Common/Types/NotificationRule/PushNotificationLevel";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import NotificationMethodUtil from "Common/UI/Utils/NotificationMethodUtil";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE LADDER (#6820): how a person is reached when they are paged, as one
 * list that applies to every kind of page and every severity.
 *
 * Steps are grouped by their wait - "At once", "After 5 minutes" - because
 * that is the order they page in: steps with the same wait go out
 * together, and changing a step's wait moves it. A step is a method the
 * person has verified; a push step also says how it sounds and how often
 * it repeats until somebody acknowledges.
 *
 * Nothing is written until Save, and Save writes the ladder into every card
 * of the grid in one request (PagingLadderService). When some cards differ
 * from the ladder, Save first names them: they lose their difference.
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
  headerButtons?: Array<CardButtonSchema | ReactElement> | undefined;
  onSave: (steps: Array<PagingLadderStep>) => Promise<void>;
  // Below the steps: what is not verified yet, and where to add more.
  footer?: ReactElement | undefined;
}

// The waits a step offers: the grid's, and the step's own when it is another.
export const getWaitOptions: (
  translator: Translator,
  currentWait: number,
) => Array<DropdownOption> = (
  translator: Translator,
  currentWait: number,
): Array<DropdownOption> => {
  const options: Array<DropdownOption> = NotifyAfterMinutesDropdownOptions.map(
    (option: DropdownOption): DropdownOption => {
      return { ...option };
    },
  );

  const isOffered: boolean = options.some((option: DropdownOption): boolean => {
    return option.value === currentWait;
  });

  if (!isOffered) {
    options.push({
      value: currentWait,
      label: translator.translatePlural(AFTER_MINUTES, currentWait),
      isInPageDirection: true,
    });

    options.sort((a: DropdownOption, b: DropdownOption): number => {
      return Number(a.value) - Number(b.value);
    });
  }

  return options;
};

const getStepsSignature: (steps: ReadonlyArray<PagingLadderStep>) => string = (
  steps: ReadonlyArray<PagingLadderStep>,
): string => {
  return normalizePagingLadderSteps(steps)
    .map(getPagingLadderStepKey)
    .join(",");
};

interface WaitGroup {
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
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  // Changing the key empties the Add dropdown after each pick.
  const [addKey, setAddKey] = useState<number>(0);

  const savedSignature: string = getStepsSignature(props.savedSteps);

  // A save, or a change on the grid, gives the editor a new ladder to start from.
  useEffect(() => {
    setDraft(normalizePagingLadderSteps(props.savedSteps));
  }, [savedSignature]);

  const isDirty: boolean = getStepsSignature(draft) !== savedSignature;
  // A ladder that already pages every card saves nothing; one that differs does.
  const canSave: boolean =
    draft.length > 0 && (isDirty || props.differences.length > 0) && !isSaving;

  const addableMethods: Array<PagingMethodChoice> = getAddableMethodChoices({
    choices: props.methods,
    isPushTurnedOff: props.isPushTurnedOff,
  });

  const updateStep: (
    index: number,
    change: Partial<PagingLadderStep>,
  ) => void = (index: number, change: Partial<PagingLadderStep>): void => {
    setSavedNote(false);
    setDraft((current: Array<PagingLadderStep>) => {
      return current.map((step: PagingLadderStep, i: number) => {
        return i === index ? { ...step, ...change } : step;
      });
    });
  };

  const removeStep: (index: number) => void = (index: number): void => {
    setSavedNote(false);
    setDraft((current: Array<PagingLadderStep>) => {
      return current.filter((_step: PagingLadderStep, i: number) => {
        return i !== index;
      });
    });
  };

  const addStep: (methodKey: string) => void = (methodKey: string): void => {
    const choice: PagingMethodChoice | undefined = addableMethods.find(
      (candidate: PagingMethodChoice): boolean => {
        return getPagingLadderMethodKey(candidate) === methodKey;
      },
    );

    setAddKey(addKey + 1);

    if (!choice) {
      return;
    }

    setSavedNote(false);
    setDraft((current: Array<PagingLadderStep>) => {
      return normalizePagingLadderSteps([...current, getNewStep(choice)]);
    });
  };

  const save: () => Promise<void> = async (): Promise<void> => {
    setIsConfirming(false);
    setIsSaving(true);
    setError("");

    try {
      await props.onSave(normalizePagingLadderSteps(draft));
      setSavedNote(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const onSaveClick: () => void = (): void => {
    if (props.differences.length > 0) {
      setIsConfirming(true);
      return;
    }

    save().catch(() => {
      // save() reports its own failure.
    });
  };

  const getStepRow: (index: number) => ReactElement = (
    index: number,
  ): ReactElement => {
    const step: PagingLadderStep = draft[index]!;
    const choice: PagingMethodChoice | undefined = findMethodChoice(
      props.methods,
      step,
    );
    const isPush: boolean = step.methodColumn === "userPushId";
    const waitOptions: Array<DropdownOption> = getWaitOptions(
      translator,
      step.notifyAfterMinutes,
    );

    return (
      <li
        key={`${getPagingLadderStepKey(step)}-${index}`}
        className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3"
        data-testid="paging-ladder-step"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <MethodLabel choice={choice} />
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
          <div className="flex items-center gap-2">
            <div className="w-full sm:w-48">
              <Dropdown
                options={waitOptions}
                value={waitOptions.find((option: DropdownOption): boolean => {
                  return option.value === step.notifyAfterMinutes;
                })}
                ariaLabel={PAGING_LADDER_COPY.waitLabel}
                dataTestId="paging-ladder-step-wait"
                /* A step always has a wait: removing it is the step's own ×. */
                isClearable={false}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ): void => {
                  if (value === null || Array.isArray(value)) {
                    return;
                  }

                  updateStep(index, { notifyAfterMinutes: Number(value) });
                }}
              />
            </div>
            <Button
              buttonStyle={ButtonStyleType.ICON}
              icon={IconProp.Close}
              title={PAGING_LADDER_COPY.removeStep}
              ariaLabel={PAGING_LADDER_COPY.removeStep}
              tooltip={PAGING_LADDER_COPY.removeStep}
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

  const addPlaceholder: string = props.memberName
    ? translator.translateTemplate(PAGING_LADDER_COPY.memberAddPlaceholder, {
        name: props.memberName,
      })
    : translator.translateTemplate(PAGING_LADDER_COPY.ownAddPlaceholder);

  const noStepsText: string = props.memberName
    ? translator.translateTemplate(PAGING_LADDER_COPY.memberNoSteps, {
        name: props.memberName,
      })
    : translator.translateTemplate(PAGING_LADDER_COPY.ownNoSteps);

  return (
    <div data-testid="paging-ladder">
      <Card
        title={props.title}
        description={props.description}
        buttons={props.headerButtons}
      >
        <div className="flex flex-col gap-4">
          {draft.length === 0 ? (
            <p
              className="text-sm text-gray-600"
              data-testid="paging-ladder-empty"
            >
              {noStepsText}
            </p>
          ) : (
            <ol
              className="flex flex-col gap-3"
              data-testid="paging-ladder-steps"
            >
              {groupStepsByWait(draft).map((group: WaitGroup) => {
                return (
                  <li
                    key={group.wait}
                    className="rounded-lg border border-gray-200 px-4 py-1"
                    data-testid="paging-ladder-wait-group"
                  >
                    <p className="pt-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {describeWait(translator, group.wait)}
                    </p>
                    <ul className="divide-y divide-gray-100">
                      {group.stepIndexes.map(getStepRow)}
                    </ul>
                  </li>
                );
              })}
            </ol>
          )}

          {props.isEditable && addableMethods.length > 0 ? (
            <div className="w-full sm:max-w-md" data-testid="paging-ladder-add">
              <Dropdown
                key={addKey}
                options={addableMethods.map(
                  (choice: PagingMethodChoice): DropdownOption => {
                    return {
                      value: getPagingLadderMethodKey(choice),
                      /*
                       * The method's line in the reader's words, as the
                       * cards' own dropdowns name it (#7178), drawn as
                       * written and in the page's direction.
                       */
                      label: NotificationMethodUtil.getMethodLabel(
                        translator,
                        choice.channel,
                        choice.identifier,
                      ),
                      ...NotificationMethodUtil.TRANSLATED_LABEL_OPTION,
                    };
                  },
                )}
                placeholder={addPlaceholder}
                // Worded around the member's name: drawn as given.
                isPlaceholderTranslated={true}
                ariaLabel={addPlaceholder}
                isAriaLabelTranslated={true}
                dataTestId="paging-ladder-add-step"
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ): void => {
                  if (value === null || Array.isArray(value)) {
                    return;
                  }

                  addStep(value.toString());
                }}
              />
            </div>
          ) : (
            <></>
          )}

          {props.footer || <></>}

          {props.isEditable && props.differences.length > 0 ? (
            <p
              className="text-sm text-amber-700"
              data-testid="paging-ladder-replaces-note"
            >
              {translator.translateText(PAGING_LADDER_COPY.replacesNote)}
            </p>
          ) : (
            <></>
          )}

          {error ? <ErrorMessage message={error} /> : <></>}

          {props.isEditable ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
              <Button
                title={PAGING_LADDER_COPY.save}
                buttonStyle={ButtonStyleType.PRIMARY}
                icon={IconProp.Check}
                disabled={!canSave}
                isLoading={isSaving}
                dataTestId="paging-ladder-save"
                onClick={onSaveClick}
              />
              {isDirty ? (
                <Button
                  title={PAGING_LADDER_COPY.discard}
                  buttonStyle={ButtonStyleType.NORMAL}
                  disabled={isSaving}
                  dataTestId="paging-ladder-discard"
                  onClick={() => {
                    setError("");
                    setDraft(normalizePagingLadderSteps(props.savedSteps));
                  }}
                />
              ) : (
                <></>
              )}
              {savedNote && !isDirty ? (
                <p
                  className="text-sm text-emerald-700"
                  role="status"
                  data-testid="paging-ladder-saved"
                >
                  {translator.translateText(PAGING_LADDER_COPY.saved)}
                </p>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
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
          submitButtonText={PAGING_LADDER_COPY.save}
          isLoading={isSaving}
          onClose={() => {
            setIsConfirming(false);
          }}
          onSubmit={() => {
            save().catch(() => {
              // save() reports its own failure.
            });
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default PagingLadderEditor;
