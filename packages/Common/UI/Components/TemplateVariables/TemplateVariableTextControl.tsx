/*
 * A text field, long text field or code editor whose value is a template:
 * the field as it is, with its template variables one step away.
 *
 *   - Typing "{{" in it opens the variables under the cursor
 *     (useTemplateVariableTyping).
 *   - Under it, the collapsed Template variables list, where a click on a
 *     variable adds it where the cursor is (TemplateVariablesList).
 *
 * The control itself is the caller's, unchanged: this finds the textarea or
 * text input inside it and listens to it from around it. Its keys are
 * listened to in the capture phase, so while the list is open Enter picks a
 * variable instead of reaching a text field's own Enter (which submits the
 * form) and Escape closes the list instead of the dialog.
 */

import TemplateVariablesList from "./TemplateVariablesList";
import { TextControl, findTextControl } from "./TextControlUtil";
import useTemplateVariableTyping, {
  TemplateVariableTyping,
} from "./useTemplateVariableTyping";
import {
  TemplateVariableGroups,
  countTemplateVariables,
} from "../../../Types/Template/TemplateVariable";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useRef,
} from "react";

export interface TemplateVariableTextControlProps {
  groups: TemplateVariableGroups;
  /** What the variables are filled with, at the top of the open list. */
  description?: string | ReactElement | undefined;
  /** More for the open list, after the variables. */
  listChildren?: ReactNode | undefined;
  /** The field's control: a text input, a textarea or a code editor. */
  children: ReactNode;
  dataTestId?: string | undefined;
}

// Keys that move the cursor without changing the text.
const CARET_KEYS: Array<string> = [
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
];

const TemplateVariableTextControl: FunctionComponent<
  TemplateVariableTextControlProps
> = (props: TemplateVariableTextControlProps): ReactElement => {
  const wrapperRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  const typing: TemplateVariableTyping = useTemplateVariableTyping({
    groups: props.groups,
    getControl: (): TextControl | null => {
      return findTextControl(wrapperRef.current);
    },
    isEnabled: countTemplateVariables(props.groups) > 0,
  });

  // Only the field's own text control counts, not anything else inside.
  const isFromControl: (target: EventTarget | null) => boolean = (
    target: EventTarget | null,
  ): boolean => {
    return Boolean(target) && target === findTextControl(wrapperRef.current);
  };

  return (
    <>
      <div
        ref={wrapperRef}
        data-testid={props.dataTestId}
        onInput={(event: React.FormEvent<HTMLDivElement>) => {
          if (isFromControl(event.target)) {
            typing.handleInput();
          }
        }}
        onKeyDownCapture={(event: React.KeyboardEvent<HTMLDivElement>) => {
          if (isFromControl(event.target) && typing.handleKeyDown(event)) {
            event.stopPropagation();
          }
        }}
        onKeyUp={(event: React.KeyboardEvent<HTMLDivElement>) => {
          if (isFromControl(event.target) && CARET_KEYS.includes(event.key)) {
            typing.handleCaretMove();
          }
        }}
        onMouseUp={(event: React.MouseEvent<HTMLDivElement>) => {
          if (isFromControl(event.target)) {
            typing.handleCaretMove();
          }
        }}
        onFocus={(event: React.FocusEvent<HTMLDivElement>) => {
          if (isFromControl(event.target)) {
            typing.handleFocus();
          }
        }}
        onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
          if (isFromControl(event.target)) {
            typing.handleBlur();
          }
        }}
      >
        {props.children}
      </div>

      {typing.popup}

      <TemplateVariablesList
        groups={props.groups}
        description={props.description}
        onInsert={typing.insertAtCursor}
        supportsTyping={true}
      >
        {props.listChildren}
      </TemplateVariablesList>
    </>
  );
};

export default TemplateVariableTextControl;
