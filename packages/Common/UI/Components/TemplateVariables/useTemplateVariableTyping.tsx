/*
 * Typing "{{" in a plain text control - a text field, a long text field, a
 * code editor, the Markdown editor's source view - opens the field's template
 * variables under the cursor, filtered by what is typed after the braces.
 * The arrow keys move through them, Enter or Tab puts the one picked in
 * place of the braces and what was typed, and Escape closes the list (and
 * only the list, never the dialog around the field).
 *
 * The control keeps the focus throughout: its owner hands its keys here
 * (handleKeyDown, before its own handlers - a text field submits the form on
 * Enter) and says when its text changed (handleInput) or its cursor moved.
 * The list is drawn wherever the owner puts `popup`; it is portalled anyway.
 *
 * insertAtCursor is the same insert for a pick made elsewhere: the collapsed
 * list under the field.
 */

import TemplateVariableMenu, {
  TemplateVariableMenuHandle,
} from "./TemplateVariableMenu";
import TemplateVariablePopup, {
  TemplateVariablePopupMode,
} from "./TemplateVariablePopup";
import TemplateVariablesCopy from "./TemplateVariablesCopy";
import {
  TextControl,
  getTextControlCaretRect,
  insertIntoTextControl,
} from "./TextControlUtil";
import {
  TemplateVariable,
  TemplateVariableGroups,
  TemplateVariableTrigger,
  filterTemplateVariableGroups,
  findTemplateVariableTrigger,
  formatTemplateVariable,
} from "../../../Types/Template/TemplateVariable";
import useTranslateValue from "../../Utils/Translation";
import React, { ReactElement, useEffect, useId, useRef, useState } from "react";

export interface UseTemplateVariableTypingOptions {
  groups: TemplateVariableGroups;
  /** The control being typed in, read whenever it is needed. */
  getControl: () => TextControl | null;
  /** Off when the field has no variables: nothing ever opens. */
  isEnabled: boolean;
}

export interface TemplateVariableTyping {
  /** The control's text changed: opens, filters or closes the list. */
  handleInput: () => void;
  /**
   * A key pressed in the control. True when the list used it, in which case
   * the caller stops it from reaching anything else.
   */
  handleKeyDown: (event: {
    key: string;
    preventDefault: () => void;
  }) => boolean;
  /** The cursor may have moved (a click, an arrow key): the list follows. */
  handleCaretMove: () => void;
  /** The control lost the focus: the list closes. */
  handleBlur: () => void;
  /** The control got the focus: its cursor is now somewhere to insert at. */
  handleFocus: () => void;
  close: () => void;
  isOpen: boolean;
  /** The list under the cursor while it is open, else null. */
  popup: ReactElement | null;
  /**
   * Puts the variable where the cursor is - in place of the selection - or at
   * the end of the text if the field has not been in use.
   */
  insertAtCursor: (variable: TemplateVariable) => void;
  listboxId: string;
  activeOptionId: string | undefined;
}

interface OpenTrigger {
  trigger: TemplateVariableTrigger;
  rect: DOMRect;
}

const useTemplateVariableTyping: (
  options: UseTemplateVariableTypingOptions,
) => TemplateVariableTyping = (
  options: UseTemplateVariableTypingOptions,
): TemplateVariableTyping => {
  const { translateString } = useTranslateValue();
  const listboxId: string = `template-variable-suggestions-${useId()}`;
  const menuRef: React.MutableRefObject<TemplateVariableMenuHandle | null> =
    useRef<TemplateVariableMenuHandle | null>(null);
  const [open, setOpen] = useState<OpenTrigger | null>(null);
  const [activeOptionId, setActiveOptionId] = useState<string | undefined>(
    undefined,
  );
  // Whether the control has had a cursor in it, so there is one to insert at.
  const hasBeenUsedRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const describe: (variable: TemplateVariable) => string = (
    variable: TemplateVariable,
  ): string => {
    return variable.isDescriptionVerbatim
      ? variable.description
      : translateString(variable.description) || variable.description;
  };

  const close: () => void = (): void => {
    setOpen(null);
    setActiveOptionId(undefined);
  };

  // The trigger at the control's cursor, when there is one worth opening for.
  const readTrigger: () => {
    control: TextControl;
    trigger: TemplateVariableTrigger;
  } | null = (): {
    control: TextControl;
    trigger: TemplateVariableTrigger;
  } | null => {
    const control: TextControl | null = options.getControl();

    if (
      !options.isEnabled ||
      !control ||
      control.selectionStart === null ||
      control.selectionStart !== control.selectionEnd
    ) {
      return null;
    }

    const trigger: TemplateVariableTrigger | null = findTemplateVariableTrigger(
      control.value,
      control.selectionStart,
    );

    if (
      !trigger ||
      filterTemplateVariableGroups(options.groups, trigger.query, describe)
        .length === 0
    ) {
      return null;
    }

    return { control, trigger };
  };

  const handleInput: () => void = (): void => {
    hasBeenUsedRef.current = true;

    const found: {
      control: TextControl;
      trigger: TemplateVariableTrigger;
    } | null = readTrigger();

    if (!found) {
      if (open) {
        close();
      }
      return;
    }

    setOpen({
      trigger: found.trigger,
      // Under the braces, so the list stays put while the query is typed.
      rect: getTextControlCaretRect(found.control, found.trigger.start),
    });
  };

  const handleCaretMove: () => void = (): void => {
    hasBeenUsedRef.current = true;

    if (!open) {
      return;
    }

    const found: {
      control: TextControl;
      trigger: TemplateVariableTrigger;
    } | null = readTrigger();

    if (!found || found.trigger.start !== open.trigger.start) {
      close();
      return;
    }

    if (
      found.trigger.query !== open.trigger.query ||
      found.trigger.end !== open.trigger.end
    ) {
      setOpen({ trigger: found.trigger, rect: open.rect });
    }
  };

  const pick: (variable: TemplateVariable) => void = (
    variable: TemplateVariable,
  ): void => {
    const control: TextControl | null = options.getControl();
    const current: OpenTrigger | null = open;

    close();

    if (!control || !current) {
      return;
    }

    /*
     * What is at the cursor now, if it is still a trigger at the same braces;
     * else the range the list was opened for.
     */
    const now: TemplateVariableTrigger | null =
      control.selectionStart !== null &&
      control.selectionStart === control.selectionEnd
        ? findTemplateVariableTrigger(control.value, control.selectionStart)
        : null;
    const trigger: TemplateVariableTrigger =
      now && now.start === current.trigger.start ? now : current.trigger;

    insertIntoTextControl(
      control,
      trigger.start,
      trigger.end,
      formatTemplateVariable(variable.name),
    );
  };

  const handleKeyDown: (event: {
    key: string;
    preventDefault: () => void;
  }) => boolean = (event: {
    key: string;
    preventDefault: () => void;
  }): boolean => {
    if (!open) {
      return false;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return true;
    }

    return Boolean(menuRef.current?.handleKeyDown(event));
  };

  const insertAtCursor: (variable: TemplateVariable) => void = (
    variable: TemplateVariable,
  ): void => {
    const control: TextControl | null = options.getControl();

    if (!control) {
      return;
    }

    close();

    const length: number = (control.value || "").length;
    const hasCursor: boolean =
      hasBeenUsedRef.current && control.selectionStart !== null;
    const start: number = hasCursor
      ? (control.selectionStart as number)
      : length;
    const end: number = hasCursor
      ? (control.selectionEnd as number) ?? start
      : length;

    insertIntoTextControl(
      control,
      start,
      end,
      formatTemplateVariable(variable.name),
    );
    hasBeenUsedRef.current = true;
  };

  /*
   * The control says which list it drives and which option the keys are on,
   * so a screen reader reads the option out as the arrow keys move.
   */
  useEffect(() => {
    const control: TextControl | null = options.getControl();

    if (!control || !options.isEnabled) {
      return;
    }

    control.setAttribute("aria-autocomplete", "list");

    if (open) {
      control.setAttribute("aria-controls", listboxId);
    } else {
      control.removeAttribute("aria-controls");
    }

    if (open && activeOptionId) {
      control.setAttribute("aria-activedescendant", activeOptionId);
    } else {
      control.removeAttribute("aria-activedescendant");
    }
  }, [open, activeOptionId, options.isEnabled]);

  const popup: ReactElement | null = open ? (
    <TemplateVariablePopup
      mode={TemplateVariablePopupMode.Inline}
      ariaLabel={
        translateString(TemplateVariablesCopy.listTitle) ||
        TemplateVariablesCopy.listTitle
      }
      dataTestId="template-variable-suggestions"
      positionKey={`${open.trigger.start}-${open.rect.left}-${open.rect.top}`}
      getAnchorRect={(): DOMRect | null => {
        return open.rect;
      }}
      isInsideAnchor={(target: Node): boolean => {
        return Boolean(options.getControl()?.contains(target));
      }}
      onClose={close}
    >
      <TemplateVariableMenu
        ref={menuRef}
        groups={options.groups}
        hasSearchBox={false}
        query={open.trigger.query}
        listboxId={listboxId}
        onActiveOptionChange={setActiveOptionId}
        onPick={pick}
      />
    </TemplateVariablePopup>
  ) : null;

  return {
    handleInput,
    handleKeyDown,
    handleCaretMove,
    handleBlur: close,
    handleFocus: (): void => {
      hasBeenUsedRef.current = true;
    },
    close,
    isOpen: Boolean(open),
    popup,
    insertAtCursor,
    listboxId,
    activeOptionId,
  };
};

export default useTemplateVariableTyping;
