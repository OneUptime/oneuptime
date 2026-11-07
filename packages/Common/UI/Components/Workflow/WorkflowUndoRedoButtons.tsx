import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import { KeyboardKeyUtil } from "../KeyboardShortcut/KeyboardKey";
import {
  WorkflowHistoryDirection,
  WorkflowHistoryStep,
} from "./WorkflowEditHistory";
import {
  getWorkflowHistoryActionText,
  getWorkflowHistoryTooltip,
} from "./WorkflowHistoryLabels";
import { getWorkflowHistoryShortcutKeys } from "./WorkflowHistoryShortcuts";
import IconProp from "../../../Types/Icon/IconProp";
import PlatformUtil from "../../Utils/Platform";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The builder's Undo and Redo, in its toolbar. Each says under the pointer
 * what it would do - "Undo deleting "Send Email" (send-email-1) (⌘Z)" - and
 * is locked, saying there is nothing to undo, when there is nothing to undo
 * (WorkflowHistoryLabels). The page owns what they undo
 * (WorkflowEditHistory) and the shortcuts (WorkflowHistoryShortcuts).
 */

export const WorkflowUndoRedoCopy: { readonly group: string } = {
  group: translationKey("Undo and redo"),
};

export interface ComponentProps {
  // What each would do, or null when there is nothing to do.
  undoStep: WorkflowHistoryStep | null;
  redoStep: WorkflowHistoryStep | null;
  onUndo: () => void;
  onRedo: () => void;
}

const HistoryButton: FunctionComponent<{
  direction: WorkflowHistoryDirection;
  step: WorkflowHistoryStep | null;
  onPress: () => void;
  translator: Translator;
  isApplePlatform: boolean;
}> = (props: {
  direction: WorkflowHistoryDirection;
  step: WorkflowHistoryStep | null;
  onPress: () => void;
  translator: Translator;
  isApplePlatform: boolean;
}): ReactElement => {
  const isUndo: boolean = props.direction === WorkflowHistoryDirection.Undo;
  const shortcut: string = KeyboardKeyUtil.getDisplayLabel(
    getWorkflowHistoryShortcutKeys({
      direction: props.direction,
      isApplePlatform: props.isApplePlatform,
    }),
    props.isApplePlatform,
  );

  return (
    <Button
      icon={isUndo ? IconProp.ArrowUturnLeft : IconProp.ArrowUturnRight}
      buttonStyle={ButtonStyleType.OUTLINE}
      buttonSize={ButtonSize.Small}
      disabled={!props.step}
      tooltip={getWorkflowHistoryTooltip({
        direction: props.direction,
        step: props.step,
        shortcut,
        translator: props.translator,
      })}
      ariaLabel={getWorkflowHistoryActionText({
        direction: props.direction,
        step: props.step,
        translator: props.translator,
      })}
      dataTestId={isUndo ? "workflow-undo-button" : "workflow-redo-button"}
      onClick={() => {
        if (!props.step) {
          return;
        }

        props.onPress();
      }}
    />
  );
};

const WorkflowUndoRedoButtons: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isApplePlatform: boolean = PlatformUtil.isApplePlatform();

  return (
    <div
      role="group"
      aria-label={translator.translateText(WorkflowUndoRedoCopy.group)}
      className="inline-flex items-center gap-1"
      data-testid="workflow-undo-redo"
    >
      <HistoryButton
        direction={WorkflowHistoryDirection.Undo}
        step={props.undoStep}
        onPress={props.onUndo}
        translator={translator}
        isApplePlatform={isApplePlatform}
      />
      <HistoryButton
        direction={WorkflowHistoryDirection.Redo}
        step={props.redoStep}
        onPress={props.onRedo}
        translator={translator}
        isApplePlatform={isApplePlatform}
      />
    </div>
  );
};

export default WorkflowUndoRedoButtons;
