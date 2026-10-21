/*
 * Where a template variable list appears: under the Insert variable button,
 * or under the cursor while "{{" is being typed. Portalled out of the dialog
 * the field is in (whose body scrolls and would clip it) and placed `fixed`,
 * flipping above when there is no room below - the same placement as the
 * workflow builder's value picker (getValuePickerPosition).
 *
 * Two ways of being open:
 * - "popover", from the button: the list has its own search box, which takes
 *   the focus; Escape and Tab close it and put the focus back.
 * - "inline", while "{{" is typed: the focus stays in the field, which hands
 *   the list its arrow keys, Enter, Tab and Escape itself.
 *
 * In both, a press anywhere else closes it - and is claimed, so the dialog
 * underneath does not read the same press as a click on its backdrop - and
 * Escape closes the list, not the dialog.
 */

import DROPDOWN_MENU_Z_INDEX from "../Dropdown/DropdownMenuZIndex";
import {
  VALUE_PICKER_MAX_HEIGHT_PX,
  VALUE_PICKER_MIN_WIDTH_PX,
  ValuePickerPosition,
  getValuePickerPosition,
} from "../Workflow/ValuePicker/ValuePickerPopup";
import { consumePressForAnchoredPopup } from "../../Types/LayeredDismissal";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export enum TemplateVariablePopupMode {
  Popover = "Popover",
  Inline = "Inline",
}

export enum TemplateVariablePopupCloseReason {
  Escape = "Escape",
  Tab = "Tab",
  Outside = "Outside",
}

export interface TemplateVariablePopupProps {
  mode: TemplateVariablePopupMode;
  /** The rectangle the list opens under: the button's, or the cursor's. */
  getAnchorRect: () => DOMRect | null;
  /** Whether a press landed on what the list belongs to (the field, the button). */
  isInsideAnchor: (target: Node) => boolean;
  /** Changes whenever the anchor may have moved: the list is placed again. */
  positionKey?: string | number | undefined;
  onClose: (reason: TemplateVariablePopupCloseReason) => void;
  ariaLabel: string;
  id?: string | undefined;
  dataTestId?: string | undefined;
  children: ReactNode;
}

const TemplateVariablePopup: FunctionComponent<TemplateVariablePopupProps> = (
  props: TemplateVariablePopupProps,
): ReactElement | null => {
  const popupRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<ValuePickerPosition | null>(null);

  // The latest callbacks, for listeners that are added once.
  const onCloseRef: React.MutableRefObject<
    (reason: TemplateVariablePopupCloseReason) => void
  > = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  const getAnchorRectRef: React.MutableRefObject<() => DOMRect | null> = useRef(
    props.getAnchorRect,
  );
  getAnchorRectRef.current = props.getAnchorRect;

  const isInsideAnchorRef: React.MutableRefObject<(target: Node) => boolean> =
    useRef(props.isInsideAnchor);
  isInsideAnchorRef.current = props.isInsideAnchor;

  const updatePosition: () => void = useCallback((): void => {
    if (typeof window === "undefined") {
      return;
    }

    const rect: DOMRect | null = getAnchorRectRef.current();

    if (!rect) {
      return;
    }

    setPosition(
      getValuePickerPosition(rect, window.innerWidth, window.innerHeight),
    );
  }, []);

  useLayoutEffect(() => {
    updatePosition();
  }, [props.positionKey, updatePosition]);

  useLayoutEffect(() => {
    let frame: number | null = null;

    const schedule: () => void = (): void => {
      if (frame !== null) {
        return;
      }

      frame = window.requestAnimationFrame((): void => {
        frame = null;
        updatePosition();
      });
    };

    window.addEventListener("resize", schedule);
    // Capture: scrolling the dialog body does not bubble to window.
    document.addEventListener("scroll", schedule, true);

    return () => {
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);

      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [updatePosition]);

  // A press outside the field and the list closes the list, and only the list.
  useEffect(() => {
    const handlePointerDown: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (
        popupRef.current?.contains(event.target) ||
        isInsideAnchorRef.current(event.target)
      ) {
        return;
      }

      consumePressForAnchoredPopup(event);
      onCloseRef.current(TemplateVariablePopupCloseReason.Outside);
    };

    document.addEventListener("mousedown", handlePointerDown, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, []);

  /*
   * Escape closes the list, not the dialog: it is claimed during capture,
   * before the dialog's own listener can see it. Inline, the field handles
   * its keys itself.
   */
  useEffect(() => {
    if (props.mode !== TemplateVariablePopupMode.Popover) {
      return;
    }

    const handleKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const isInPopup: boolean = Boolean(
        popupRef.current?.contains(document.activeElement),
      );

      if (!isInPopup) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current(TemplateVariablePopupCloseReason.Escape);
        return;
      }

      /*
       * The list is outside the dialog's DOM, so the dialog's focus trap would
       * otherwise pull the focus back to its first control. Tab leaves the
       * list for where it was opened from, as it leaves any dropdown.
       */
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current(TemplateVariablePopupCloseReason.Tab);
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [props.mode]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={popupRef}
      id={props.id}
      role="dialog"
      aria-label={props.ariaLabel}
      data-testid={props.dataTestId || "template-variable-popup"}
      data-mode={props.mode}
      className="fixed flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-lg"
      style={{
        top: position?.top,
        bottom: position?.bottom,
        left: position?.left ?? 0,
        width: position?.width ?? VALUE_PICKER_MIN_WIDTH_PX,
        maxHeight: position?.maxHeight ?? VALUE_PICKER_MAX_HEIGHT_PX,
        zIndex: DROPDOWN_MENU_Z_INDEX,
        // No flash in the corner before the anchor has been measured.
        visibility: position ? "visible" : "hidden",
      }}
      onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
        /*
         * Inline, the field keeps the focus: a press on the list must not take
         * it, or the field's cursor - where the variable goes - is lost.
         */
        if (
          props.mode === TemplateVariablePopupMode.Inline &&
          !(event.target instanceof HTMLInputElement)
        ) {
          event.preventDefault();
        }
      }}
    >
      {/*
       * Drawn once it has been placed: until then it is hidden, and a hidden
       * element cannot take the focus the search box asks for.
       */}
      {position ? props.children : null}
    </div>,
    document.body,
  );
};

export default TemplateVariablePopup;
