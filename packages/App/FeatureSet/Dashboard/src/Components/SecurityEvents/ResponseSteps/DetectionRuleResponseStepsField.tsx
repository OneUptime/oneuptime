import {
  DETECTION_RULE_RESPONSE_STEPS_TEST_IDS,
  RESPONSE_STEPS_EMPTY,
  RESPONSE_STEPS_FROM_LIBRARY,
  RESPONSE_STEPS_FULL,
  RESPONSE_STEP_ADD,
  RESPONSE_STEP_MOVED,
  RESPONSE_STEP_MOVE_DOWN,
  RESPONSE_STEP_MOVE_DOWN_LABEL,
  RESPONSE_STEP_MOVE_UP,
  RESPONSE_STEP_MOVE_UP_LABEL,
  RESPONSE_STEP_NAME,
  RESPONSE_STEP_PART_LABEL,
  RESPONSE_STEP_PLACEHOLDER,
  RESPONSE_STEP_REMOVE,
  RESPONSE_STEP_REMOVE_LABEL,
  RESPONSE_STEP_TEXT_LABEL,
} from "./DetectionRuleResponseStepsCopy";
import {
  ResponseStepMove,
  ResponseStepsOfPart,
  ResponseStepsShown,
  addResponseStep,
  canAddResponseStep,
  canMoveResponseStep,
  changeResponseStep,
  getResponseStepsByPart,
  getResponseStepsInPlanOrder,
  getResponseStepsShown,
  moveResponseStep,
  moveResponseStepInPart,
  removeResponseStep,
} from "./DetectionRuleResponseStepsModel";
import { RESPONSE_PHASE_TITLES } from "../../SecurityCase/Response/SecurityCaseResponseCopy";
import { ResponsePhase } from "../../SecurityCase/Response/SecurityCaseResponseTypes";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DETECTION_RULE_RESPONSE_PHASES,
  DETECTION_RULE_RESPONSE_STEPS_MAX,
  DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH,
  DetectionRuleResponsePhase,
  DetectionRuleResponseStep,
  isDetectionRuleResponsePhase,
} from "Common/Types/SecurityEvent/DetectionRuleResponseSteps";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import {
  DragAndDropLibrary,
  useDragAndDrop,
} from "Common/UI/Components/DragAndDrop/DragAndDropLoader";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import Input from "Common/UI/Components/Input/Input";
import { DRAG_HANDLE_USAGE_INSTRUCTIONS } from "Common/UI/Components/Table/Table";
import DragHandle from "Common/UI/Components/Table/DragHandle";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type {
  DraggableProvided,
  DraggableStateSnapshot,
  DropResult,
  DroppableProvided,
  ResponderProvided,
} from "react-beautiful-dnd";

/*
 * A DETECTION RULE'S RESPONSE STEPS, ON ITS FORM (#9621, #9796).
 *
 * A short list - what to do when the rule opens a case, in the author's
 * words - each step under the part of the case's Response Plan it goes
 * under, picked by the words the plan shows it under: Confirm it is real,
 * Contain it, Fix what let it happen. Add Step puts one more line in; a
 * line's bin takes it out. A rule added from the library shows the steps
 * it comes with until one is changed (DetectionRuleResponseStepsModel).
 *
 * The steps are listed as the plan reads them: under their parts, each
 * part's in the order the plan shows them. A step is moved among its
 * part's steps by its grip - dragged, or from the keyboard: Space picks it
 * up, the arrow keys move it and Space drops it - or one place at a time
 * by its Move Up and Move Down, and goes to another part by its picker. It
 * keeps its id wherever it goes, so a case that ticked it off keeps the
 * tick. After a move, the control pressed keeps the focus on the step it
 * moved, and a screen reader hears where the step went.
 *
 * On a phone each line stacks: the grip beside the part over the words,
 * its buttons beside them.
 */

// The parts of the plan a step can go under, in the plan's words.
export function getResponseStepPartOptions(): Array<DropdownOption> {
  return DETECTION_RULE_RESPONSE_PHASES.map(
    (phase: DetectionRuleResponsePhase): DropdownOption => {
      return {
        value: phase,
        label: RESPONSE_PHASE_TITLES[phase as string as ResponsePhase],
      };
    },
  );
}

export interface ComponentProps {
  // The form's value: the rule's own steps, or none written (null).
  value: unknown;
  // Whose library rule's steps show while it has none of its own.
  sigmaRuleYaml: unknown;
  onChange: (steps: Array<DetectionRuleResponseStep>) => void;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
}

// Which of a step's controls takes the focus once its list has changed.
type StepControl = "up" | "down" | "part" | "text" | "remove";

interface PendingFocus {
  // The step it goes to, or none for Add Step.
  stepId: string | null;
  control: StepControl;
  // The list's order once the change is drawn, by its steps' ids.
  order: string;
}

// The attribute a line is found by (data-step-id), its step's id: letters, digits and dashes.
const STEP_ID_ATTRIBUTE: string = "data-step-id";

/*
 * A line's picker and words, without the space a form field keeps above
 * and below it (mt-2 mb-1): the line spaces its controls itself, so its
 * grip and its buttons sit level with them.
 */
const RESPONSE_STEP_PICKER_CLASS_NAME: string =
  "relative w-full overflow-visible rounded-md";
const RESPONSE_STEP_WORDS_CLASS_NAME: string =
  "relative w-full rounded-md shadow-sm";

function getOrder(steps: ReadonlyArray<DetectionRuleResponseStep>): string {
  return steps
    .map((step: DetectionRuleResponseStep): string => {
      return step.id;
    })
    .join(",");
}

const DetectionRuleResponseStepsField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const fieldRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  // Ids of this field's own: its lists, and each step's part picker.
  const fieldId: string = useId();
  const dragAndDrop: DragAndDropLibrary | null = useDragAndDrop(true);
  const [announcement, setAnnouncement] = useState<string>("");
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);

  const shown: ResponseStepsShown = getResponseStepsShown({
    value: props.value,
    sigmaRuleYaml: props.sigmaRuleYaml,
  });
  // As the plan reads them: by part, each part's in the order written.
  const steps: Array<DetectionRuleResponseStep> = getResponseStepsInPlanOrder(
    shown.steps,
  );
  const parts: Array<ResponseStepsOfPart> = getResponseStepsByPart(steps);
  const order: string = getOrder(steps);
  const partOptions: Array<DropdownOption> = getResponseStepPartOptions();
  const canAdd: boolean = canAddResponseStep(steps);

  const getPartInputId: (stepId: string) => string = (
    stepId: string,
  ): string => {
    return `${fieldId}-part-${stepId}`;
  };

  const getDroppableId: (phase: DetectionRuleResponsePhase) => string = (
    phase: DetectionRuleResponsePhase,
  ): string => {
    return `${fieldId}-${phase}`;
  };

  /*
   * The steps as the form keeps them: in the plan's order, so the list is
   * written as it is shown. `focus` says which control takes the focus once
   * the change is drawn.
   */
  const emit: (
    next: Array<DetectionRuleResponseStep>,
    focus?: { stepId: string | null; control: StepControl } | undefined,
  ) => void = (
    next: Array<DetectionRuleResponseStep>,
    focus?: { stepId: string | null; control: StepControl } | undefined,
  ): void => {
    const ordered: Array<DetectionRuleResponseStep> =
      getResponseStepsInPlanOrder(next);

    if (focus) {
      setPendingFocus({ ...focus, order: getOrder(ordered) });
    }

    props.onChange(ordered);
  };

  /*
   * Once the change is drawn - the form hands the list back - the focus
   * goes where the person was: a moved line's own button (the other one
   * when it reached its part's end), its picker once it went to another
   * part, a new line's words, or the next line's bin after a removal.
   */
  useEffect(() => {
    if (!pendingFocus || pendingFocus.order !== order) {
      return;
    }

    setPendingFocus(null);

    const field: HTMLDivElement | null = fieldRef.current;

    if (!field) {
      return;
    }

    // A line's button, by its test id: none while it cannot be pressed.
    const find: (
      testIdPrefix: string,
      row: Element | null,
    ) => HTMLElement | null = (
      testIdPrefix: string,
      row: Element | null,
    ): HTMLElement | null => {
      const button: HTMLButtonElement | null =
        row?.querySelector<HTMLButtonElement>(
          `button[data-testid^="${testIdPrefix}-"]`,
        ) || null;

      return button && !button.disabled ? button : null;
    };

    const row: Element | null = pendingFocus.stepId
      ? field.querySelector(`[${STEP_ID_ATTRIBUTE}="${pendingFocus.stepId}"]`)
      : null;
    const ids: typeof DETECTION_RULE_RESPONSE_STEPS_TEST_IDS =
      DETECTION_RULE_RESPONSE_STEPS_TEST_IDS;
    let target: HTMLElement | null = null;

    if (pendingFocus.control === "up") {
      target = find(ids.moveUp, row) || find(ids.moveDown, row);
    } else if (pendingFocus.control === "down") {
      target = find(ids.moveDown, row) || find(ids.moveUp, row);
    } else if (pendingFocus.control === "part" && pendingFocus.stepId) {
      target = document.getElementById(getPartInputId(pendingFocus.stepId));
    } else if (pendingFocus.control === "text") {
      target =
        row?.querySelector<HTMLElement>(`input[data-testid^="${ids.text}-"]`) ||
        null;
    } else if (pendingFocus.control === "remove") {
      target = find(ids.remove, row);
    }

    // No line left to go to: Add Step, the way to put one back.
    if (!target) {
      target = field.querySelector<HTMLElement>(`[data-testid="${ids.add}"]`);
    }

    target?.focus();
  }, [pendingFocus, order]);

  // Where the step that moved went, said to a screen reader.
  const announceMove: (
    stepId: string,
    next: Array<DetectionRuleResponseStep>,
  ) => string = (
    stepId: string,
    next: Array<DetectionRuleResponseStep>,
  ): string => {
    const isStep: (step: DetectionRuleResponseStep) => boolean = (
      step: DetectionRuleResponseStep,
    ): boolean => {
      return step.id === stepId;
    };

    const message: string = translator.translateTemplate(RESPONSE_STEP_MOVED, {
      from: translator.formatNumber(steps.findIndex(isStep) + 1),
      to: translator.formatNumber(next.findIndex(isStep) + 1),
    });

    setAnnouncement(message);

    return message;
  };

  const move: (index: number, direction: ResponseStepMove) => void = (
    index: number,
    direction: ResponseStepMove,
  ): void => {
    const step: DetectionRuleResponseStep | undefined = steps[index];

    if (!step || !canMoveResponseStep(steps, index, direction)) {
      return;
    }

    const next: Array<DetectionRuleResponseStep> = moveResponseStep(
      steps,
      index,
      direction,
    );

    announceMove(step.id, next);
    emit(next, {
      stepId: step.id,
      control: direction === ResponseStepMove.Up ? "up" : "down",
    });
  };

  // A drop: among its own part's steps, where it was dropped.
  const onDragEnd: (result: DropResult, provided: ResponderProvided) => void = (
    result: DropResult,
    provided: ResponderProvided,
  ): void => {
    const phase: DetectionRuleResponsePhase | undefined =
      DETECTION_RULE_RESPONSE_PHASES.find(
        (candidate: DetectionRuleResponsePhase): boolean => {
          return getDroppableId(candidate) === result.source.droppableId;
        },
      );

    if (
      !phase ||
      !result.destination ||
      result.destination.droppableId !== result.source.droppableId ||
      result.destination.index === result.source.index
    ) {
      return;
    }

    const next: Array<DetectionRuleResponseStep> = moveResponseStepInPart(
      steps,
      phase,
      result.source.index,
      result.destination.index,
    );

    // Said in the reader's words, in place of the library's own English.
    provided.announce(announceMove(result.draggableId, next));
    emit(next);
  };

  const renderStep: (data: {
    step: DetectionRuleResponseStep;
    index: number;
    provided?: DraggableProvided | undefined;
    snapshot?: DraggableStateSnapshot | undefined;
  }) => ReactElement = (data: {
    step: DetectionRuleResponseStep;
    index: number;
    provided?: DraggableProvided | undefined;
    snapshot?: DraggableStateSnapshot | undefined;
  }): ReactElement => {
    const { step, index } = data;
    const number: string = translator.formatNumber(index + 1);
    const canMoveUp: boolean = canMoveResponseStep(
      steps,
      index,
      ResponseStepMove.Up,
    );
    const canMoveDown: boolean = canMoveResponseStep(
      steps,
      index,
      ResponseStepMove.Down,
    );

    return (
      <li
        ref={data.provided?.innerRef}
        {...(data.provided?.draggableProps || {})}
        data-step-id={step.id}
        className={`flex items-start gap-2 rounded-md ${
          data.snapshot?.isDragging
            ? "bg-white p-2 shadow-lg ring-1 ring-gray-200"
            : ""
        }`}
        data-testid={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.row}-${index}`}
      >
        <DragHandle
          dragHandleProps={data.provided?.dragHandleProps}
          itemLabel={translator.translateTemplate(RESPONSE_STEP_NAME, {
            number,
          })}
          className="mt-1.5"
        />
        {/*
         * One line from a tablet up: the part, the words, the buttons. On a
         * phone, two: the part with Move Up and Move Down, then the words
         * with the bin, so each has the room to be read.
         */}
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex">
          <div className="min-w-0 sm:w-56 sm:shrink-0">
            {/*
             * A line's controls share one line: without the gap a form
             * field's picker and words keep above and below them, the
             * grip and the buttons sit level with them.
             */}
            <Dropdown
              dataTestId={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.part}-${index}`}
              className={RESPONSE_STEP_PICKER_CLASS_NAME}
              inputId={getPartInputId(step.id)}
              isClearable={false}
              ariaLabel={translator.translateTemplate(
                RESPONSE_STEP_PART_LABEL,
                { number },
              )}
              isAriaLabelTranslated={true}
              options={partOptions}
              value={partOptions.find((option: DropdownOption): boolean => {
                return option.value === step.phase;
              })}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (
                  !isDetectionRuleResponsePhase(value) ||
                  value === step.phase
                ) {
                  return;
                }

                // Off to its new part, nearest where it was: the focus goes with it.
                emit(changeResponseStep(steps, index, { phase: value }), {
                  stepId: step.id,
                  control: "part",
                });
              }}
            />
          </div>
          <div className="row-start-2 min-w-0 sm:flex-1">
            <Input
              dataTestId={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.text}-${index}`}
              outerDivClassName={RESPONSE_STEP_WORDS_CLASS_NAME}
              ariaLabel={translator.translateTemplate(
                RESPONSE_STEP_TEXT_LABEL,
                { number },
              )}
              value={step.text}
              maxLength={DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH}
              placeholder={RESPONSE_STEP_PLACEHOLDER}
              onChange={(text: string) => {
                emit(changeResponseStep(steps, index, { text }));
              }}
            />
          </div>
          <div className="col-start-2 row-start-1 flex items-center gap-1">
            <Button
              dataTestId={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.moveUp}-${index}`}
              ariaLabel={translator.translateTemplate(
                RESPONSE_STEP_MOVE_UP_LABEL,
                { number },
              )}
              isAriaLabelTranslated={true}
              icon={IconProp.ChevronUp}
              buttonStyle={ButtonStyleType.ICON}
              buttonSize={ButtonSize.Small}
              tooltip={RESPONSE_STEP_MOVE_UP}
              disabled={!canMoveUp}
              onClick={() => {
                move(index, ResponseStepMove.Up);
              }}
            />
            <Button
              dataTestId={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.moveDown}-${index}`}
              ariaLabel={translator.translateTemplate(
                RESPONSE_STEP_MOVE_DOWN_LABEL,
                { number },
              )}
              isAriaLabelTranslated={true}
              icon={IconProp.ChevronDown}
              buttonStyle={ButtonStyleType.ICON}
              buttonSize={ButtonSize.Small}
              tooltip={RESPONSE_STEP_MOVE_DOWN}
              disabled={!canMoveDown}
              onClick={() => {
                move(index, ResponseStepMove.Down);
              }}
            />
          </div>
          <div className="col-start-2 row-start-2 flex items-center justify-end">
            <Button
              dataTestId={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.remove}-${index}`}
              ariaLabel={translator.translateTemplate(
                RESPONSE_STEP_REMOVE_LABEL,
                { number },
              )}
              isAriaLabelTranslated={true}
              icon={IconProp.Trash}
              buttonStyle={ButtonStyleType.ICON}
              buttonSize={ButtonSize.Small}
              tooltip={RESPONSE_STEP_REMOVE}
              onClick={() => {
                const next: Array<DetectionRuleResponseStep> =
                  removeResponseStep(steps, index);
                // The line that takes its place, else the one before it.
                const nextFocus: DetectionRuleResponseStep | undefined =
                  next[index] || next[index - 1];

                emit(next, {
                  stepId: nextFocus?.id || null,
                  control: "remove",
                });
              }}
            />
          </div>
        </div>
      </li>
    );
  };

  // One part's steps: its heading, and its lines, numbered across the plan.
  const renderPart: (
    part: ResponseStepsOfPart,
    first: number,
  ) => ReactElement = (
    part: ResponseStepsOfPart,
    first: number,
  ): ReactElement => {
    const headingId: string = `${getDroppableId(part.phase)}-heading`;
    const heading: ReactElement = (
      <h4
        id={headingId}
        className="text-xs font-semibold uppercase tracking-wide text-gray-500"
      >
        {translator.translateText(
          RESPONSE_PHASE_TITLES[part.phase as string as ResponsePhase],
        )}
      </h4>
    );

    const renderList: (
      provided?: DroppableProvided | undefined,
    ) => ReactElement = (
      provided?: DroppableProvided | undefined,
    ): ReactElement => {
      return (
        <ol
          ref={provided?.innerRef}
          {...(provided?.droppableProps || {})}
          className="space-y-3"
          aria-labelledby={headingId}
        >
          {part.steps.map(
            (
              step: DetectionRuleResponseStep,
              partIndex: number,
            ): ReactElement => {
              const index: number = first + partIndex;

              if (!dragAndDrop) {
                return (
                  <React.Fragment key={step.id}>
                    {renderStep({ step, index })}
                  </React.Fragment>
                );
              }

              const Draggable: DragAndDropLibrary["Draggable"] =
                dragAndDrop.Draggable;

              return (
                <Draggable
                  key={step.id}
                  draggableId={step.id}
                  index={partIndex}
                >
                  {(
                    draggable: DraggableProvided,
                    snapshot: DraggableStateSnapshot,
                  ) => {
                    return renderStep({
                      step,
                      index,
                      provided: draggable,
                      snapshot,
                    });
                  }}
                </Draggable>
              );
            },
          )}
          {provided?.placeholder}
        </ol>
      );
    };

    if (!dragAndDrop) {
      return (
        <div
          key={part.phase}
          className="space-y-2"
          data-testid={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.fieldPart}-${part.phase}`}
        >
          {heading}
          {renderList()}
        </div>
      );
    }

    const Droppable: DragAndDropLibrary["Droppable"] = dragAndDrop.Droppable;

    return (
      <div
        key={part.phase}
        className="space-y-2"
        data-testid={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.fieldPart}-${part.phase}`}
      >
        {heading}
        {/* A step is dragged among its own part's steps only: its picker moves it to another part. */}
        <Droppable droppableId={getDroppableId(part.phase)} type={part.phase}>
          {(provided: DroppableProvided) => {
            return renderList(provided);
          }}
        </Droppable>
      </div>
    );
  };

  const renderParts: () => ReactElement = (): ReactElement => {
    let first: number = 0;

    return (
      <div className="space-y-4">
        {parts.map((part: ResponseStepsOfPart): ReactElement => {
          const element: ReactElement = renderPart(part, first);

          first += part.steps.length;

          return element;
        })}
      </div>
    );
  };

  const renderSteps: () => ReactElement = (): ReactElement => {
    if (!dragAndDrop) {
      return renderParts();
    }

    const DragDropContext: DragAndDropLibrary["DragDropContext"] =
      dragAndDrop.DragDropContext;

    return (
      <DragDropContext
        onDragEnd={onDragEnd}
        dragHandleUsageInstructions={
          translator.translateText(DRAG_HANDLE_USAGE_INSTRUCTIONS) ||
          DRAG_HANDLE_USAGE_INSTRUCTIONS
        }
      >
        {renderParts()}
      </DragDropContext>
    );
  };

  return (
    <div
      ref={fieldRef}
      className="space-y-3"
      role="group"
      aria-labelledby={props.ariaLabelledby}
      aria-describedby={props.ariaDescribedby}
      data-testid={DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.field}
    >
      {shown.isFromLibrary ? (
        <p
          className="text-sm text-gray-500"
          data-testid={DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.fromLibrary}
        >
          {translator.translateText(RESPONSE_STEPS_FROM_LIBRARY)}
        </p>
      ) : (
        <></>
      )}

      {steps.length === 0 ? (
        <p
          className="rounded-md border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500"
          data-testid={DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.empty}
        >
          {translator.translateText(RESPONSE_STEPS_EMPTY)}
        </p>
      ) : (
        renderSteps()
      )}

      <div>
        <Button
          dataTestId={DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.add}
          title={RESPONSE_STEP_ADD}
          icon={IconProp.Add}
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          disabled={!canAdd}
          tooltip={
            canAdd
              ? undefined
              : translator.translatePlural(
                  RESPONSE_STEPS_FULL,
                  DETECTION_RULE_RESPONSE_STEPS_MAX,
                )
          }
          onClick={() => {
            const next: Array<DetectionRuleResponseStep> =
              addResponseStep(steps);
            const added: DetectionRuleResponseStep | undefined = next.find(
              (step: DetectionRuleResponseStep): boolean => {
                return !steps.includes(step);
              },
            );

            // Its words are what to write next.
            emit(next, { stepId: added?.id || null, control: "text" });
          }}
        />
      </div>

      {/* Where a moved step went, for a screen reader. */}
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid={DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.moved}
      >
        {announcement}
      </p>

      {props.error ? <FieldError message={props.error} /> : <></>}
    </div>
  );
};

export default DetectionRuleResponseStepsField;
