import { WorkflowSaveConflict } from "./WorkflowAutosave";
import {
  WorkflowSaveConflictCopy,
  getWorkflowSaveConflictLines,
} from "./WorkflowSaveConflict";
import { WorkflowVersionCopy } from "./WorkflowVersionPresentation";
import { ButtonStyleType } from "../Button/Button";
import ConfirmModal from "../Modal/ConfirmModal";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import ComponentMetadata from "../../../Types/Workflow/Component";
import { WorkflowComponentLookup } from "../../../Utils/Workflow/WorkflowGraphChanges";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

/*
 * SOMEONE ELSE CHANGED THIS WORKFLOW (issue #6257): the builder's save was
 * refused because a newer graph was saved first, and nothing is saved until
 * the person chooses. The dialog says what happened and what they changed,
 * and offers the two ways on - both of which lose nothing:
 *
 *   - Show their changes: their version on the canvas, as a step Undo takes
 *     back. The safe one, so it is the dialog's primary button.
 *   - Keep mine: the canvas's version saved over theirs, which stays in the
 *     version history.
 *
 * There is no Cancel: closing it would leave a change that cannot be saved.
 * See WorkflowSaveConflict for the words.
 */

export interface ComponentProps {
  conflict: WorkflowSaveConflict;
  // The component catalog, to name their steps as the canvas names them.
  components: Array<ComponentMetadata>;
  onShowTheirChanges: () => void;
  onKeepMine: () => void;
}

const WorkflowSaveConflictModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const lookup: WorkflowComponentLookup = useMemo(() => {
    const byId: Map<string, ComponentMetadata> = new Map<
      string,
      ComponentMetadata
    >(
      props.components.map(
        (component: ComponentMetadata): [string, ComponentMetadata] => {
          return [component.id, component];
        },
      ),
    );

    return (componentId: string): ComponentMetadata | undefined => {
      return byId.get(componentId);
    };
  }, [props.components]);

  const theirChanges: { lines: Array<string>; moreCount: number } =
    useMemo(() => {
      return getWorkflowSaveConflictLines({
        conflict: props.conflict,
        lookup,
      });
    }, [props.conflict, lookup]);

  return (
    <ConfirmModal
      title={WorkflowSaveConflictCopy.title}
      description={WorkflowSaveConflictCopy.description}
      submitButtonText={WorkflowSaveConflictCopy.showTheirChanges}
      submitButtonType={ButtonStyleType.PRIMARY}
      onSubmit={props.onShowTheirChanges}
      secondaryButton={{
        title: WorkflowSaveConflictCopy.keepMine,
        onClick: props.onKeepMine,
        dataTestId: "workflow-save-conflict-keep-mine",
      }}
    >
      <div className="space-y-4" data-testid="workflow-save-conflict">
        <div>
          <h3 className="text-sm font-medium text-gray-900">
            {translator.translateText(
              WorkflowSaveConflictCopy.theirChangesTitle,
            )}
          </h3>
          <ul
            className="mt-2 list-disc space-y-1 ps-5 text-sm text-gray-700"
            data-testid="workflow-save-conflict-changes"
          >
            {theirChanges.lines.length > 0 ? (
              theirChanges.lines.map((line: string, index: number) => {
                return (
                  <li key={index} dir="auto" className="break-words">
                    {line}
                  </li>
                );
              })
            ) : (
              <li>
                {translator.translateText(
                  WorkflowVersionCopy.changedWithoutLines,
                )}
              </li>
            )}
            {theirChanges.moreCount > 0 ? (
              <li className="text-gray-500">
                {translator.translatePlural(
                  WorkflowVersionCopy.moreChanges,
                  theirChanges.moreCount,
                )}
              </li>
            ) : (
              <></>
            )}
          </ul>
        </div>
        <p
          className="text-sm text-gray-600"
          data-testid="workflow-save-conflict-note"
        >
          {translator.translateText(WorkflowSaveConflictCopy.note)}
        </p>
      </div>
    </ConfirmModal>
  );
};

export default WorkflowSaveConflictModal;
