import { WorkflowViewOnlyContext } from "./WorkflowViewOnly";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useContext,
} from "react";

/*
 * What changes a step's setting, held still on a view (WorkflowViewOnly).
 *
 * In a view - the Builder of someone who may open a workflow but not change
 * it - the children are drawn inside a disabled fieldset: every form control
 * in it is disabled (a screen reader still reads each one, with its value),
 * and the pointer goes through the rest, the pickers that open on a press.
 * Outside a view the children are drawn as they are, and nothing more.
 *
 * Draw it around what changes a setting, never around what only reads one: a
 * disabled fieldset disables every button in it, whatever the button does.
 * A step's settings used to sit in one such fieldset, whole, and in a view a
 * code box's own Copy and the More fields fold were as dead as everything
 * else: nobody could copy a step's code, or read the settings folded under
 * More fields. So the settings are held still one by one now (ArgumentsForm):
 * a code box shows its code to be read and copied (FormField, CodeEditor's
 * readOnly), More fields opens, and only what changes a setting is in here.
 *
 * A disabled fieldset cannot hold everything still on its own: it disables
 * form controls, and the pointer cannot reach the rest, but the keyboard can
 * - an editable text box that is no form control, a grip that picks up a row
 * with Space. A control like that reads WorkflowViewOnlyContext itself.
 *
 * Every Builder control that can change a workflow honours the view - draws
 * this around what does, or reads WorkflowViewOnlyContext itself - and
 * WorkflowViewOnlyGuard holds each one to it.
 */

export interface ComponentProps {
  children: ReactNode;
  /*
   * In a view the fieldset stands in its children's place in their parent's
   * layout: the spacing the parent gave them (a space-y-1, say) goes here,
   * to keep it between them. Outside a view nothing is drawn to take it.
   */
  className?: string | undefined;
  dataTestId?: string | undefined;
}

// No frame, margin or indent of its own: a view reads as the editor's form.
export const WORKFLOW_VIEW_ONLY_FIELDSET_CLASS: string =
  "pointer-events-none m-0 min-w-0 border-0 p-0";

// Every fieldset a view holds a setting still with.
export const WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR: string =
  "fieldset[data-workflow-view-only]";

const WorkflowViewOnlyFieldset: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isViewOnly: boolean = useContext(WorkflowViewOnlyContext);

  if (!isViewOnly) {
    return <>{props.children}</>;
  }

  return (
    <fieldset
      disabled={true}
      className={[WORKFLOW_VIEW_ONLY_FIELDSET_CLASS, props.className || ""]
        .filter(Boolean)
        .join(" ")}
      data-testid={props.dataTestId || "workflow-view-only-fieldset"}
      data-workflow-view-only=""
    >
      {props.children}
    </fieldset>
  );
};

export default WorkflowViewOnlyFieldset;
