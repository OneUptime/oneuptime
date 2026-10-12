/*
 * A Switch / Case step's settings:
 *
 *   Value to check   [Incident › incidentSeverity.name  { }]
 *
 *   Cases            checked from the top; the first that matches is taken
 *     ⠿ 1  [is equal to ▾]  [Critical Incident { }]  🗑   → Send to on-call (slack-1)
 *     ⠿ 2  [is equal to ▾]  [Major Incident    { }]  🗑   Not connected
 *     [+ Add case]
 *   ▸ Compare as   Text
 *   Default          runs when no case matches.            → Log (log-1)
 *
 * Every case is an output of the step on the canvas, named after the case,
 * so each row says where its output leads. The list is reordered by dragging
 * a case by its grip (or Space and the arrow keys on it): the order is the
 * order the cases are checked in. Taking out a case whose output is
 * connected says that saving removes the connection, and offers to put the
 * case back.
 *
 * Each case is an If / Else condition without its value to check, chosen
 * from the same list of comparisons, compared by the same rules and
 * annotated in the same words (SwitchModel, through ConditionModel).
 */

import Button, { ButtonSize, ButtonStyleType } from "../../Button/Button";
import CollapsibleSection from "../../CollapsibleSection/CollapsibleSection";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "../../Dropdown/Dropdown";
import Icon from "../../Icon/Icon";
import DragHandle from "../../Table/DragHandle";
import {
  CONDITION_COMPARISON_OPTIONS,
  getCompareWithPlaceholder,
} from "../Condition/ConditionEditor";
import {
  COMPARE_AS_LABEL,
  ConditionNote,
  ConditionNoteTone,
  ConditionState,
  VALUE_TO_CHECK_LABEL,
} from "../Condition/ConditionModel";
import ValueTextField from "../ValuePicker/ValueTextField";
import {
  ADD_CASE_LABEL,
  CASES_LABEL,
  ConnectedStep,
  OutputConnections,
  RemovedConnectedCase,
  SwitchCaseErrors,
  SwitchErrors,
  SwitchState,
  addCase,
  caseShowsCompareAs,
  changeCaseCompareAs,
  changeCaseComparison,
  changeCaseValue,
  getCaseCompareAs,
  getCaseConditionState,
  getCaseNotes,
  getRemovedConnectedCases,
  hasSwitchErrors,
  moveCase,
  patchForCases,
  putCaseBack,
  readSwitchState,
  removeCase,
  validateSwitch,
} from "./SwitchModel";
import Dictionary from "../../../../Types/Dictionary";
import IconProp from "../../../../Types/Icon/IconProp";
import { JSONObject } from "../../../../Types/JSON";
import { ConditionValueType } from "../../../../Types/Workflow/Components/Condition";
import {
  CONDITION_COMPARE_AS_OPTIONS,
  ConditionCompareAsOption,
  ConditionComparisonId,
} from "../../../../Types/Workflow/Components/ConditionComparison";
import {
  MAX_SWITCH_CASES,
  SWITCH_ARGUMENT_IDS,
  SWITCH_DEFAULT_PORT_ID,
} from "../../../../Types/Workflow/Components/Switch";
import {
  SwitchCase,
  getSwitchCaseLabel,
} from "../../../../Types/Workflow/Components/SwitchCases";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  DraggableStateSnapshot,
  Droppable,
  DroppableProvided,
  DropResult,
} from "react-beautiful-dnd";
import { Translator, translationKey } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";

export interface SwitchEditorProps {
  // The step's settings as stored.
  arguments: JSONObject | undefined;
  // The settings to write, merged into the stored ones.
  onChange: (patch: JSONObject) => void;
  // Whether something must be filled in before the step can be saved.
  onValidationChange: (hasErrors: boolean) => void;
  /*
   * The steps each of the step's outputs is connected to on the canvas, by
   * output id, as the step was saved. Undefined when it is not known: the
   * rows then say nothing about where they lead.
   */
  connections?: OutputConnections | undefined;
}

export const SWITCH_TEST_IDS: {
  readonly root: string;
  readonly valueToCheck: string;
  readonly cases: string;
  readonly addCase: string;
  readonly compareAs: string;
  readonly defaultOutput: string;
  readonly removedCases: string;
  readonly noCases: string;
} = {
  root: "switch-cases-editor",
  valueToCheck: `workflow-argument-${SWITCH_ARGUMENT_IDS.valueToCheck}`,
  cases: `workflow-argument-${SWITCH_ARGUMENT_IDS.cases}`,
  addCase: "switch-add-case",
  compareAs: "switch-compare-as",
  defaultOutput: "switch-default",
  removedCases: "switch-removed-cases",
  noCases: "switch-no-cases",
};

export const NOT_CONNECTED_LABEL: string = translationKey("Not connected");

interface Touched {
  valueToCheck?: boolean | undefined;
  // By case id: the case's comparison or value was left.
  cases: Dictionary<boolean>;
}

interface ConnectionLineProps {
  steps: Array<ConnectedStep> | undefined;
  dataTestId: string;
}

/*
 * Where an output leads: the step it is connected to, by title and id, or
 * that nothing is connected to it yet.
 */
const ConnectionLine: FunctionComponent<ConnectionLineProps> = (
  props: ConnectionLineProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const steps: Array<ConnectedStep> = props.steps || [];

  if (steps.length === 0) {
    return (
      <p className="text-xs text-gray-500" data-testid={props.dataTestId}>
        {translator.translateText(NOT_CONNECTED_LABEL)}
      </p>
    );
  }

  /*
   * The arrow keeps its place on the left, and the steps wrap beside it: a
   * long id breaks rather than running past the case on a phone.
   */
  return (
    <div
      className="flex min-w-0 items-start gap-1.5 text-xs text-gray-600"
      data-testid={props.dataTestId}
    >
      <div className="mt-px shrink-0">
        <Icon
          icon={IconProp.ArrowCircleRight}
          className="h-3.5 w-3.5 text-gray-400"
        />
      </div>
      <p className="min-w-0 break-words">
        <span className="sr-only">{translator.translateText("Leads to")} </span>
        {steps.map((step: ConnectedStep, index: number) => {
          return (
            <React.Fragment key={step.componentId}>
              <span className="font-medium text-gray-800">{step.title}</span>{" "}
              <code className="break-all font-mono text-[11px] text-gray-500">
                {step.componentId}
              </code>
              {index < steps.length - 1 ? (
                <span className="text-gray-500">, </span>
              ) : (
                <></>
              )}
            </React.Fragment>
          );
        })}
      </p>
    </div>
  );
};

const SwitchEditor: FunctionComponent<SwitchEditorProps> = (
  props: SwitchEditorProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const droppableId: string = `switch-cases-${useId()}`;
  const valueLabelId: string = `switch-value-label-${useId()}`;
  const casesLabelId: string = `switch-cases-label-${useId()}`;

  const state: SwitchState = readSwitchState(props.arguments);
  const errors: SwitchErrors = validateSwitch(state);
  const hasErrors: boolean = hasSwitchErrors(errors);
  const cases: Array<SwitchCase> = state.cases;

  // The cases as they were when the settings opened.
  const [originalCases] = useState<Array<SwitchCase>>(() => {
    return state.cases;
  });

  /*
   * Every case id the step has had while the settings are open, so a new
   * case never takes the id of one just removed - whose connection is still
   * on the canvas until the settings are saved.
   */
  const usedIdsRef: React.MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(
      state.cases.map((switchCase: SwitchCase): string => {
        return switchCase.id;
      }),
    ),
  );

  // A case's value that its comparison hid (is empty), to put back.
  const hiddenValuesRef: React.MutableRefObject<Dictionary<unknown>> = useRef<
    Dictionary<unknown>
  >({});

  // The case just added, whose value takes the focus.
  const [addedCaseId, setAddedCaseId] = useState<string | null>(null);

  const [touched, setTouched] = useState<Touched>({ cases: {} });

  useEffect(() => {
    props.onValidationChange(hasErrors);
  }, [hasErrors]);

  type SetCasesFunction = (next: Array<SwitchCase>) => void;

  const setCases: SetCasesFunction = (next: Array<SwitchCase>): void => {
    props.onChange(patchForCases(next));
  };

  type TouchCaseFunction = (id: string) => void;

  // An error shows under a case once it has been left, as in every form.
  const touchCase: TouchCaseFunction = (id: string): void => {
    setTouched((current: Touched) => {
      return current.cases[id]
        ? current
        : { ...current, cases: { ...current.cases, [id]: true } };
    });
  };

  const isFull: boolean = cases.length >= MAX_SWITCH_CASES;

  type AddFunction = () => void;

  const add: AddFunction = (): void => {
    if (isFull) {
      return;
    }

    const next: Array<SwitchCase> = addCase(
      cases,
      Array.from(usedIdsRef.current),
    );
    const added: SwitchCase | undefined = next[next.length - 1];

    if (added) {
      usedIdsRef.current.add(added.id);
      setAddedCaseId(added.id);
    }

    setCases(next);
  };

  type OnDragEndFunction = (result: DropResult) => void;

  const onDragEnd: OnDragEndFunction = (result: DropResult): void => {
    if (!result.destination) {
      return;
    }

    setCases(moveCase(cases, result.source.index, result.destination.index));
  };

  type ChooseComparisonFunction = (
    switchCase: SwitchCase,
    value: DropdownValue | null,
  ) => void;

  const chooseComparison: ChooseComparisonFunction = (
    switchCase: SwitchCase,
    value: DropdownValue | null,
  ): void => {
    touchCase(switchCase.id);

    if (typeof value !== "string") {
      return;
    }

    const change: {
      cases: Array<SwitchCase>;
      hiddenValue?: unknown;
    } = changeCaseComparison({
      cases: cases,
      id: switchCase.id,
      next: value as ConditionComparisonId,
      valueToCheck: state.valueToCheck,
      hiddenValue: hiddenValuesRef.current[switchCase.id],
    });

    if (change.hiddenValue !== undefined) {
      hiddenValuesRef.current[switchCase.id] = change.hiddenValue;
    }

    setCases(change.cases);
  };

  const removedCases: Array<RemovedConnectedCase> = getRemovedConnectedCases({
    originalCases: originalCases,
    cases: cases,
    connections: props.connections,
  });

  // The cases Compare as decides something for, with their place.
  const casesWithCompareAs: Array<{ switchCase: SwitchCase; index: number }> =
    cases
      .map((switchCase: SwitchCase, index: number) => {
        return { switchCase: switchCase, index: index };
      })
      .filter((entry: { switchCase: SwitchCase; index: number }): boolean => {
        return caseShowsCompareAs(state.valueToCheck, entry.switchCase);
      });

  const compareAsTypes: Array<ConditionValueType | null> =
    casesWithCompareAs.map(
      (entry: { switchCase: SwitchCase; index: number }) => {
        return getCaseCompareAs(state.valueToCheck, entry.switchCase);
      },
    );

  const sharedCompareAs: ConditionValueType | null =
    compareAsTypes.length > 0 &&
    compareAsTypes.every((type: ConditionValueType | null): boolean => {
      return type === compareAsTypes[0];
    })
      ? compareAsTypes[0] || null
      : null;

  const sharedCompareAsOption: ConditionCompareAsOption | undefined =
    CONDITION_COMPARE_AS_OPTIONS.find((option: ConditionCompareAsOption) => {
      return option.type === sharedCompareAs;
    });

  /*
   * Compare as opens by itself when a case compares some way the settings no
   * longer offer, as If / Else's does, so the choice is seen where it is made.
   */
  const [isCompareAsOpenOnLoad] = useState<boolean>(() => {
    return compareAsTypes.some((type: ConditionValueType | null): boolean => {
      return type === null;
    });
  });

  type RenderNotesFunction = (
    notes: Array<ConditionNote>,
    index: number,
  ) => ReactElement | null;

  const renderNotes: RenderNotesFunction = (
    notes: Array<ConditionNote>,
    index: number,
  ): ReactElement | null => {
    if (notes.length === 0) {
      return null;
    }

    return (
      <ul className="space-y-1" data-testid={`switch-case-notes-${index}`}>
        {notes.map((note: ConditionNote) => {
          return (
            <li
              key={note.id}
              data-tone={note.tone}
              className={`flex items-start gap-1.5 text-xs ${
                note.tone === ConditionNoteTone.Warning
                  ? "text-amber-800"
                  : "text-gray-600"
              }`}
            >
              <div className="mt-px shrink-0">
                <Icon
                  icon={
                    note.tone === ConditionNoteTone.Warning
                      ? IconProp.Alert
                      : IconProp.Info
                  }
                  className="h-3.5 w-3.5"
                />
              </div>
              <span>{note.text}</span>
            </li>
          );
        })}
      </ul>
    );
  };

  type RenderCaseFunction = (
    switchCase: SwitchCase,
    index: number,
    provided: DraggableProvided,
    snapshot: DraggableStateSnapshot,
  ) => ReactElement;

  const renderCase: RenderCaseFunction = (
    switchCase: SwitchCase,
    index: number,
    provided: DraggableProvided,
    snapshot: DraggableStateSnapshot,
  ): ReactElement => {
    const conditionState: ConditionState = getCaseConditionState(
      state.valueToCheck,
      switchCase,
    );
    const caseErrors: SwitchCaseErrors = errors.cases[switchCase.id] || {};
    const isTouched: boolean = Boolean(touched.cases[switchCase.id]);
    const usesValue: boolean = conditionState.comparison
      ? conditionState.comparison.usesCompareWith
      : true;
    const label: string = getSwitchCaseLabel(switchCase, index);
    const number: number = index + 1;

    const selectedComparison: DropdownOption | undefined =
      conditionState.comparison
        ? {
            value: conditionState.comparison.id,
            label: conditionState.comparison.label,
          }
        : undefined;

    return (
      <li
        ref={provided.innerRef}
        {...provided.draggableProps}
        data-testid={`switch-case-${index}`}
        data-case-id={switchCase.id}
        className={`rounded-lg border bg-white px-2 py-2 sm:px-3 ${
          snapshot.isDragging
            ? "border-indigo-200 shadow-lg ring-1 ring-indigo-100"
            : "border-gray-200"
        }`}
      >
        <div className="flex items-start gap-1.5 sm:gap-2">
          <div className="pt-1">
            <DragHandle
              dragHandleProps={provided.dragHandleProps}
              itemLabel={translator.translateTemplate("Case {{number}}", {
                number: number,
              })}
            />
          </div>
          <span
            aria-hidden="true"
            className="mt-1.5 inline-flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-md bg-gray-100 px-1.5 text-xs font-semibold tabular-nums text-gray-600"
          >
            {number}
          </span>
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(10rem,13rem)_minmax(0,1fr)]">
            <Dropdown
              options={CONDITION_COMPARISON_OPTIONS}
              value={selectedComparison}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                chooseComparison(
                  switchCase,
                  Array.isArray(value) ? null : value,
                );
              }}
              placeholder="Choose a comparison"
              ariaLabel={translator.translateTemplate(
                "Comparison for case {{number}}",
                { number: number },
              )}
              isClearable={false}
              className="relative w-full"
              dataTestId={`switch-case-comparison-${index}`}
              error={
                isTouched && caseErrors.comparison
                  ? translator.translateText(caseErrors.comparison)
                  : undefined
              }
              onBlur={() => {
                touchCase(switchCase.id);
              }}
            />
            {usesValue ? (
              <div className="min-w-0">
                <ValueTextField
                  value={switchCase.value}
                  onChange={(value: string) => {
                    setCases(changeCaseValue(cases, switchCase.id, value));
                  }}
                  multiline={false}
                  placeholder={getCompareWithPlaceholder(
                    translator,
                    conditionState.compareAs.type || ConditionValueType.Text,
                  )}
                  ariaLabel={translator.translateTemplate(
                    "Value for case {{number}}",
                    { number: number },
                  )}
                  autoFocus={addedCaseId === switchCase.id}
                  dataTestId={`switch-case-value-${index}`}
                  error={
                    isTouched && caseErrors.value
                      ? translator.translateText(caseErrors.value)
                      : undefined
                  }
                  onBlur={() => {
                    touchCase(switchCase.id);
                  }}
                />
              </div>
            ) : (
              <></>
            )}
          </div>
          <div className="pt-0.5">
            <Button
              title="Remove"
              ariaLabel={translator.translateTemplate(
                "Remove case {{number}}",
                {
                  number: number,
                },
              )}
              buttonStyle={ButtonStyleType.ICON}
              icon={IconProp.Trash}
              dataTestId={`switch-case-remove-${index}`}
              onClick={() => {
                setCases(removeCase(cases, switchCase.id));
              }}
            />
          </div>
        </div>
        <div className="mt-1.5 space-y-1 pl-[3.75rem] sm:pl-16">
          {props.connections ? (
            <ConnectionLine
              steps={props.connections[switchCase.id]}
              dataTestId={`switch-case-connection-${index}`}
            />
          ) : (
            <></>
          )}
          {renderNotes(getCaseNotes(state.valueToCheck, switchCase), index)}
          <span className="sr-only" data-testid={`switch-case-label-${index}`}>
            {label}
          </span>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-5" data-testid={SWITCH_TEST_IDS.root}>
      <div className="space-y-1.5">
        <label
          id={valueLabelId}
          className="block text-sm font-medium text-gray-700"
        >
          {translator.translateText(VALUE_TO_CHECK_LABEL)}
        </label>
        <ValueTextField
          value={state.valueToCheck}
          onChange={(value: string) => {
            props.onChange({ [SWITCH_ARGUMENT_IDS.valueToCheck]: value });
          }}
          multiline={false}
          placeholder="Pick a value with { } or type one"
          ariaLabelledby={valueLabelId}
          autoFocus={true}
          dataTestId={SWITCH_TEST_IDS.valueToCheck}
          error={
            touched.valueToCheck && errors.valueToCheck
              ? translator.translateText(errors.valueToCheck)
              : undefined
          }
          onBlur={() => {
            setTouched((current: Touched) => {
              return current.valueToCheck
                ? current
                : { ...current, valueToCheck: true };
            });
          }}
        />
        <p className="text-xs text-gray-500">
          {translator.translateText(
            "Each case below is compared with this value.",
          )}
        </p>
      </div>

      <div className="space-y-2" data-testid={SWITCH_TEST_IDS.cases}>
        <div>
          <p id={casesLabelId} className="text-sm font-medium text-gray-700">
            {translator.translateText(CASES_LABEL)}
          </p>
          <p className="text-xs text-gray-500">
            {translator.translateText(
              "Checked from the top. The first case that matches is taken, and each case is an output on the canvas.",
            )}
          </p>
        </div>

        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId={droppableId}>
            {(droppableProvided: DroppableProvided) => {
              return (
                <ol
                  ref={droppableProvided.innerRef}
                  {...droppableProvided.droppableProps}
                  aria-labelledby={casesLabelId}
                  className="space-y-2"
                >
                  {cases.map((switchCase: SwitchCase, index: number) => {
                    return (
                      <Draggable
                        key={switchCase.id}
                        draggableId={`${droppableId}-${switchCase.id}`}
                        index={index}
                      >
                        {(
                          provided: DraggableProvided,
                          snapshot: DraggableStateSnapshot,
                        ) => {
                          return renderCase(
                            switchCase,
                            index,
                            provided,
                            snapshot,
                          );
                        }}
                      </Draggable>
                    );
                  })}
                  {droppableProvided.placeholder}
                </ol>
              );
            }}
          </Droppable>
        </DragDropContext>

        {cases.length === 0 ? (
          <p
            className="rounded-lg border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-600"
            data-testid={SWITCH_TEST_IDS.noCases}
          >
            {translator.translateText(
              "Add a case for each way the workflow can go.",
            )}
          </p>
        ) : (
          <></>
        )}

        {errors.unreadableCases ? (
          <p className="text-sm text-red-600">
            {translator.translateText(errors.unreadableCases)}
          </p>
        ) : (
          <></>
        )}

        {/*
          Right under the list, where the case was taken out: what saving
          disconnects, case by case, and a way to put each case back.
        */}
        {removedCases.length > 0 ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
            data-testid={SWITCH_TEST_IDS.removedCases}
            role="status"
          >
            <p className="text-sm font-medium text-amber-900">
              {translator.translateText(
                "Saving removes the connections of the cases you took out",
              )}
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {removedCases.map(
                (removed: RemovedConnectedCase, index: number) => {
                  return (
                    <li
                      key={removed.switchCase.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                      data-testid={`switch-removed-case-${index}`}
                    >
                      <p className="min-w-0 break-words text-xs text-amber-800">
                        {translator.translateTemplate(
                          "Case “{{case}}” led to {{steps}}.",
                          {
                            case: removed.label,
                            steps: removed.steps
                              .map((step: ConnectedStep): string => {
                                return `${step.title} (${step.componentId})`;
                              })
                              .join(", "),
                          },
                        )}
                      </p>
                      <Button
                        title="Put back"
                        buttonSize={ButtonSize.Small}
                        buttonStyle={ButtonStyleType.OUTLINE}
                        icon={IconProp.ArrowUturnLeft}
                        dataTestId={`switch-removed-case-undo-${index}`}
                        ariaLabel={translator.translateTemplate(
                          "Put case “{{case}}” back",
                          { case: removed.label },
                        )}
                        onClick={() => {
                          setCases(
                            putCaseBack(
                              cases,
                              removed.switchCase,
                              removed.index,
                            ),
                          );
                        }}
                      />
                    </li>
                  );
                },
              )}
            </ul>
          </div>
        ) : (
          <></>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            title={ADD_CASE_LABEL}
            icon={IconProp.Add}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.NORMAL}
            // Flush with the cases above, not a modal footer's gap in from them.
            className="md:!ml-0"
            dataTestId={SWITCH_TEST_IDS.addCase}
            disabled={isFull}
            onClick={add}
          />
          {isFull ? (
            <span className="text-xs text-gray-500">
              {translator.translateTemplate(
                "A step holds at most {{count}} cases.",
                { count: MAX_SWITCH_CASES },
              )}
            </span>
          ) : (
            <></>
          )}
        </div>
      </div>

      {casesWithCompareAs.length > 0 ? (
        <div data-testid={SWITCH_TEST_IDS.compareAs}>
          <CollapsibleSection
            title={COMPARE_AS_LABEL}
            badge={
              sharedCompareAsOption
                ? translator.translateText(sharedCompareAsOption.label)
                : translator.translateText("Mixed")
            }
            defaultCollapsed={!isCompareAsOpenOnLoad}
            headerClassName="!py-1"
          >
            <div className="space-y-2">
              <p className="text-xs text-gray-500">
                {translator.translateText(
                  "Each case compares as its comparison suggests: numbers for is greater than, text for the rest. Change it here when a case should compare another way.",
                )}
              </p>
              {casesWithCompareAs.map(
                (entry: { switchCase: SwitchCase; index: number }) => {
                  const type: ConditionValueType | null = getCaseCompareAs(
                    state.valueToCheck,
                    entry.switchCase,
                  );
                  const number: number = entry.index + 1;

                  return (
                    <div
                      key={entry.switchCase.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1"
                      data-testid={`switch-compare-as-${entry.index}`}
                    >
                      <span className="min-w-[4.5rem] text-xs font-medium text-gray-600">
                        {translator.translateTemplate("Case {{number}}", {
                          number: number,
                        })}
                      </span>
                      <div
                        role="radiogroup"
                        aria-label={translator.translateTemplate(
                          "Compare case {{number}} as",
                          { number: number },
                        )}
                        className="inline-flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1"
                      >
                        {CONDITION_COMPARE_AS_OPTIONS.map(
                          (option: ConditionCompareAsOption) => {
                            const isChecked: boolean = option.type === type;

                            return (
                              <label
                                key={option.type}
                                className={`cursor-pointer rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors focus-within:ring-2 focus-within:ring-indigo-500 ${
                                  isChecked
                                    ? "bg-white text-gray-900 shadow-sm"
                                    : "text-gray-600 hover:text-gray-900"
                                }`}
                                data-testid={`switch-compare-as-${entry.index}-${option.type}`}
                              >
                                <input
                                  type="radio"
                                  className="sr-only"
                                  name={`${droppableId}-compare-as-${entry.switchCase.id}`}
                                  value={option.type}
                                  checked={isChecked}
                                  onChange={() => {
                                    setCases(
                                      changeCaseCompareAs(
                                        cases,
                                        entry.switchCase.id,
                                        option.type,
                                      ),
                                    );
                                  }}
                                />
                                {translator.translateText(option.label)}
                              </label>
                            );
                          },
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </CollapsibleSection>
        </div>
      ) : (
        <></>
      )}

      <div
        className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5"
        data-testid={SWITCH_TEST_IDS.defaultOutput}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex shrink-0 items-center rounded-md border border-gray-200 bg-white px-1.5 py-px text-xs font-semibold text-gray-700">
            {translator.translateText("Default")}
          </span>
          <p className="min-w-0 text-sm text-gray-700">
            {translator.translateText("Runs when no case matches.")}
          </p>
        </div>
        {props.connections ? (
          <div className="mt-1.5">
            <ConnectionLine
              steps={props.connections[SWITCH_DEFAULT_PORT_ID]}
              dataTestId="switch-default-connection"
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default SwitchEditor;
