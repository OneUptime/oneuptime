/*
 * Where the value picker's list appears: under the field it fills, portalled
 * out of the settings dialog (whose body scrolls and would clip it) and
 * placed `fixed` against the field, flipping above it when there is no room
 * below.
 *
 * Two ways of being open:
 * - "popover", from the { } button. The list has its own search box and
 *   takes the focus; Escape and Tab close it and put the focus back in the
 *   field.
 * - "inline", while "{{" is being typed in the field. The focus stays in the
 *   field, which routes the arrow keys to the list itself.
 *
 * In both a press anywhere else closes it - and is claimed, so the dialog
 * underneath does not read the same press as a click on its backdrop.
 */

import DROPDOWN_MENU_Z_INDEX from "../../Dropdown/DropdownMenuZIndex";
import { consumePressForAnchoredPopup } from "../../../Types/LayeredDismissal";
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
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import { createPortal } from "react-dom";

export enum ValuePickerPopupMode {
  Popover = "Popover",
  Inline = "Inline",
}

export enum ValuePickerCloseReason {
  Escape = "Escape",
  Tab = "Tab",
  Outside = "Outside",
}

// Narrower than this and a step's name and its value's name do not fit.
export const VALUE_PICKER_MIN_WIDTH_PX: number = 320;
export const VALUE_PICKER_MAX_WIDTH_PX: number = 480;
export const VALUE_PICKER_MAX_HEIGHT_PX: number = 384;

const GAP_PX: number = 4;
const VIEWPORT_PADDING_PX: number = 8;
// Below this much room under the field, it opens above when there is more there.
const MIN_USEFUL_HEIGHT_PX: number = 200;

export interface ValuePickerPosition {
  top?: number | undefined;
  bottom?: number | undefined;
  left: number;
  width: number;
  maxHeight: number;
}

export type GetValuePickerPositionFunction = (
  anchor: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
) => ValuePickerPosition;

/** Pure, so it can be tested without a layout engine. */
export const getValuePickerPosition: GetValuePickerPositionFunction = (
  anchor: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
): ValuePickerPosition => {
  const availableWidth: number = Math.max(
    0,
    viewportWidth - VIEWPORT_PADDING_PX * 2,
  );
  const width: number = Math.min(
    availableWidth,
    Math.max(
      VALUE_PICKER_MIN_WIDTH_PX,
      Math.min(anchor.width, VALUE_PICKER_MAX_WIDTH_PX),
    ),
  );
  const maximumLeft: number = Math.max(
    VIEWPORT_PADDING_PX,
    viewportWidth - VIEWPORT_PADDING_PX - width,
  );
  const left: number = Math.min(
    Math.max(anchor.left, VIEWPORT_PADDING_PX),
    maximumLeft,
  );

  const spaceBelow: number = Math.max(
    0,
    viewportHeight - anchor.bottom - GAP_PX - VIEWPORT_PADDING_PX,
  );
  const spaceAbove: number = Math.max(
    0,
    anchor.top - GAP_PX - VIEWPORT_PADDING_PX,
  );
  const opensAbove: boolean =
    spaceBelow < MIN_USEFUL_HEIGHT_PX && spaceAbove > spaceBelow;

  return {
    top: opensAbove ? undefined : anchor.bottom + GAP_PX,
    bottom: opensAbove ? viewportHeight - anchor.top + GAP_PX : undefined,
    left: left,
    width: width,
    maxHeight: Math.min(
      VALUE_PICKER_MAX_HEIGHT_PX,
      opensAbove ? spaceAbove : spaceBelow,
    ),
  };
};

export interface ValuePickerPopupProps {
  /** The field the list belongs to. */
  anchorRef: React.RefObject<HTMLElement>;
  mode: ValuePickerPopupMode;
  onClose: (reason: ValuePickerCloseReason) => void;
  id?: string | undefined;
  ariaLabel: string;
  dataTestId?: string | undefined;
  children: ReactNode;
}

const ValuePickerPopup: FunctionComponent<ValuePickerPopupProps> = (
  props: ValuePickerPopupProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const popupRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<ValuePickerPosition | null>(null);

  // The latest onClose, for listeners that are added once.
  const onCloseRef: React.MutableRefObject<
    (reason: ValuePickerCloseReason) => void
  > = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  const updatePosition: () => void = useCallback((): void => {
    const anchor: HTMLElement | null = props.anchorRef.current;

    if (!anchor || typeof window === "undefined") {
      return;
    }

    setPosition(
      getValuePickerPosition(
        anchor.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, [props.anchorRef]);

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

    updatePosition();

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
        props.anchorRef.current?.contains(event.target) ||
        popupRef.current?.contains(event.target)
      ) {
        return;
      }

      consumePressForAnchoredPopup(event);
      onCloseRef.current(ValuePickerCloseReason.Outside);
    };

    document.addEventListener("mousedown", handlePointerDown, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [props.anchorRef]);

  /*
   * Escape closes the list, not the dialog: it is claimed during capture,
   * before the dialog's own listener can see it. In inline mode the field
   * handles its keys itself.
   */
  useEffect(() => {
    if (props.mode !== ValuePickerPopupMode.Popover) {
      return;
    }

    const handleKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const isInPopup: boolean = Boolean(
        popupRef.current?.contains(document.activeElement),
      );
      const isInField: boolean = Boolean(
        props.anchorRef.current?.contains(document.activeElement),
      );

      // Wherever the focus is in the list or its field, Escape is the list's.
      if (event.key === "Escape" && (isInPopup || isInField)) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current(ValuePickerCloseReason.Escape);
        return;
      }

      if (!isInPopup) {
        return;
      }

      /*
       * The list is outside the dialog's DOM, so the dialog's focus trap would
       * otherwise pull the focus back to its first control. Tab leaves the
       * list for the field it came from, as it leaves any dropdown.
       */
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current(ValuePickerCloseReason.Tab);
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [props.mode, props.anchorRef]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={popupRef}
      id={props.id}
      role="dialog"
      aria-label={translator.translateText(props.ariaLabel)}
      data-testid={props.dataTestId || "value-picker"}
      data-mode={props.mode}
      className="fixed flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-lg"
      style={{
        top: position?.top,
        bottom: position?.bottom,
        left: position?.left ?? 0,
        width: position?.width ?? VALUE_PICKER_MIN_WIDTH_PX,
        maxHeight: position?.maxHeight ?? VALUE_PICKER_MAX_HEIGHT_PX,
        zIndex: DROPDOWN_MENU_Z_INDEX,
        // No flash in the corner before the field has been measured.
        visibility: position ? "visible" : "hidden",
      }}
      onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
        /*
         * Inline, the field keeps the focus: a press on the list must not take
         * it, or the field's caret - where the value goes - is lost.
         */
        if (
          props.mode === ValuePickerPopupMode.Inline &&
          !(event.target instanceof HTMLInputElement)
        ) {
          event.preventDefault();
        }
      }}
    >
      {/*
       * Drawn once it has been placed: until then it is hidden, and a hidden
       * element cannot take the focus the list's search box asks for.
       */}
      {position ? props.children : null}
    </div>,
    document.body,
  );
};

export default ValuePickerPopup;
