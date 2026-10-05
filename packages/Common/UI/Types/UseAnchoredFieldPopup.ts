import { consumePressForAnchoredPopup } from "./LayeredDismissal";
import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/*
 * Form field popups (colour pickers, icon grids, ...) are rendered inside
 * Modal's scrolling body, which clips absolutely positioned children. This hook
 * drives a popup that is portalled into document.body and positioned `fixed`
 * against its anchor, so it escapes the clipping container entirely.
 *
 * It mirrors the menu placement rules used by EntityDropdown: prefer below the
 * anchor, flip above when there is not enough room, and clamp horizontally to
 * the viewport. A popup whose anchor sits at the foot of what it works on can
 * prefer above instead (preferredPlacement), with the same flip the other way.
 */

const POPUP_GAP_PX: number = 4;
const POPUP_VIEWPORT_PADDING_PX: number = 8;
const POPUP_MIN_USEFUL_HEIGHT_PX: number = 160;

/*
 * Marks the element a popup that asks to stay inside its surroundings
 * (stayInsideBoundary) is kept within: a dialog's or a side panel's scrolling
 * body, so the popup covers the fields around its own and never the dialog's
 * header, its Cancel and Save buttons, or the page behind it.
 */
export const ANCHORED_POPUP_BOUNDARY_ATTRIBUTE: string =
  "data-anchored-popup-boundary";

const FOCUSABLE_SELECTOR: string =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface AnchoredFieldPopupPosition {
  bottom: number | undefined;
  left: number;
  maxHeight: number;
  top: number | undefined;
  width: number;
}

export type AnchoredFieldPopupPlacement = "below" | "above";

/*
 * Whether the popup goes above its anchor. It goes on its preferred side
 * unless that side leaves it less than a useful height and the other side has
 * more room.
 */
export const shouldAnchoredPopupOpenAbove: (data: {
  preferredPlacement: AnchoredFieldPopupPlacement;
  spaceAbove: number;
  spaceBelow: number;
}) => boolean = (data: {
  preferredPlacement: AnchoredFieldPopupPlacement;
  spaceAbove: number;
  spaceBelow: number;
}): boolean => {
  if (data.preferredPlacement === "above") {
    return !(
      data.spaceAbove < POPUP_MIN_USEFUL_HEIGHT_PX &&
      data.spaceBelow > data.spaceAbove
    );
  }

  return (
    data.spaceBelow < POPUP_MIN_USEFUL_HEIGHT_PX &&
    data.spaceAbove > data.spaceBelow
  );
};

export interface AnchoredPopupBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface AnchoredPopupPlacementResult
  extends AnchoredFieldPopupPosition {
  placement: AnchoredFieldPopupPlacement;
  // False when the boundary was too small to be useful and the window was used.
  isInsideBoundary: boolean;
}

/*
 * Whether the anchor has been scrolled out of the boundary it sits in - the
 * dialog body moved on and took the field out of sight. A popup that stays
 * inside its surroundings closes then, as a browser's own select menu does,
 * instead of floating over the dialog with nothing it belongs to. A boundary
 * with no size (not laid out) never hides anything.
 */
export const isAnchorOutsideBoundary: (data: {
  anchor: AnchoredPopupBox;
  boundary: AnchoredPopupBox;
}) => boolean = (data: {
  anchor: AnchoredPopupBox;
  boundary: AnchoredPopupBox;
}): boolean => {
  if (
    data.boundary.right <= data.boundary.left ||
    data.boundary.bottom <= data.boundary.top
  ) {
    return false;
  }

  return (
    data.anchor.bottom < data.boundary.top ||
    data.anchor.top > data.boundary.bottom
  );
};

/*
 * Where a popup that stays inside its surroundings goes, worked out from
 * boxes alone so every rule can be tested (Tests/UI/Components/Forms/
 * AnchoredFieldPopupBoundary.test.ts).
 *
 *   - The room it has is the window, less a margin, cut down to the
 *     boundary - the dialog body the field sits in - when there is one.
 *   - It opens on its preferred side when its whole content fits there, on
 *     the other side when it fits there instead, and otherwise on the side
 *     with more room, scrolling inside its own box. The old rule flipped only
 *     when the preferred side had less than 160px, so a color picker at the
 *     foot of the Create Label dialog, with the window's room below it, opened
 *     downwards across the dialog's buttons and out of the dialog.
 *   - A boundary with less than a useful height on either side (a short
 *     dialog) would leave a sliver, so the window is used instead, and so is
 *     a boundary with no size at all (one not laid out).
 *   - Across, it starts at the anchor's left edge and is moved left or
 *     narrowed until it fits.
 */
export const placeAnchoredPopupInBounds: (data: {
  anchor: AnchoredPopupBox;
  viewportWidth: number;
  viewportHeight: number;
  boundary?: AnchoredPopupBox | null | undefined;
  popupWidth: number;
  // The height of the popup's content, all of it.
  popupHeight: number;
  popupMaxHeight: number;
  preferredPlacement: AnchoredFieldPopupPlacement;
}) => AnchoredPopupPlacementResult = (data: {
  anchor: AnchoredPopupBox;
  viewportWidth: number;
  viewportHeight: number;
  boundary?: AnchoredPopupBox | null | undefined;
  popupWidth: number;
  popupHeight: number;
  popupMaxHeight: number;
  preferredPlacement: AnchoredFieldPopupPlacement;
}): AnchoredPopupPlacementResult => {
  const viewportBounds: AnchoredPopupBox = {
    top: POPUP_VIEWPORT_PADDING_PX,
    left: POPUP_VIEWPORT_PADDING_PX,
    right: Math.max(
      POPUP_VIEWPORT_PADDING_PX,
      data.viewportWidth - POPUP_VIEWPORT_PADDING_PX,
    ),
    bottom: Math.max(
      POPUP_VIEWPORT_PADDING_PX,
      data.viewportHeight - POPUP_VIEWPORT_PADDING_PX,
    ),
  };

  const neededHeight: number = Math.max(
    0,
    Math.min(data.popupHeight, data.popupMaxHeight),
  );

  type SpacesFunction = (bounds: AnchoredPopupBox) => {
    above: number;
    below: number;
  };

  const spacesIn: SpacesFunction = (
    bounds: AnchoredPopupBox,
  ): { above: number; below: number } => {
    return {
      above: Math.max(0, data.anchor.top - POPUP_GAP_PX - bounds.top),
      below: Math.max(0, bounds.bottom - data.anchor.bottom - POPUP_GAP_PX),
    };
  };

  let bounds: AnchoredPopupBox = viewportBounds;
  let isInsideBoundary: boolean = false;

  if (
    data.boundary &&
    data.boundary.right > data.boundary.left &&
    data.boundary.bottom > data.boundary.top
  ) {
    const inside: AnchoredPopupBox = {
      top: Math.max(viewportBounds.top, data.boundary.top + POPUP_GAP_PX),
      left: Math.max(viewportBounds.left, data.boundary.left + POPUP_GAP_PX),
      right: Math.min(viewportBounds.right, data.boundary.right - POPUP_GAP_PX),
      bottom: Math.min(
        viewportBounds.bottom,
        data.boundary.bottom - POPUP_GAP_PX,
      ),
    };
    const insideSpaces: { above: number; below: number } = spacesIn(inside);
    const usefulHeight: number = Math.min(
      neededHeight,
      POPUP_MIN_USEFUL_HEIGHT_PX,
    );

    if (
      inside.right > inside.left &&
      inside.bottom > inside.top &&
      Math.max(insideSpaces.above, insideSpaces.below) >= usefulHeight
    ) {
      bounds = inside;
      isInsideBoundary = true;
    }
  }

  const spaces: { above: number; below: number } = spacesIn(bounds);
  const preferred: AnchoredFieldPopupPlacement = data.preferredPlacement;
  const other: AnchoredFieldPopupPlacement =
    preferred === "below" ? "above" : "below";

  type SpaceOnFunction = (placement: AnchoredFieldPopupPlacement) => number;

  const spaceOn: SpaceOnFunction = (
    placement: AnchoredFieldPopupPlacement,
  ): number => {
    return placement === "below" ? spaces.below : spaces.above;
  };

  let placement: AnchoredFieldPopupPlacement = preferred;

  if (
    spaceOn(preferred) < neededHeight &&
    (spaceOn(other) >= neededHeight || spaceOn(other) > spaceOn(preferred))
  ) {
    placement = other;
  }

  const width: number = Math.max(
    0,
    Math.min(data.popupWidth, bounds.right - bounds.left),
  );
  const left: number = Math.min(
    Math.max(data.anchor.left, bounds.left),
    Math.max(bounds.left, bounds.right - width),
  );

  return {
    placement,
    isInsideBoundary,
    top: placement === "below" ? data.anchor.bottom + POPUP_GAP_PX : undefined,
    bottom:
      placement === "above"
        ? data.viewportHeight - data.anchor.top + POPUP_GAP_PX
        : undefined,
    left,
    width,
    maxHeight: Math.min(data.popupMaxHeight, spaceOn(placement)),
  };
};

export interface AnchoredFieldPopupOptions {
  // Intrinsic width of the popup, used to clamp it inside the viewport.
  popupWidth: number;
  popupMaxHeight: number;
  /*
   * The side the popup opens on when it fits there: below the anchor unless
   * said otherwise. "above" is for an anchor at the foot of what it works on -
   * the template menu at the bottom of a note composer - so the popup covers
   * the note rather than what comes after it.
   */
  preferredPlacement?: AnchoredFieldPopupPlacement | undefined;
  /*
   * Changes when the anchor may have moved while the popup stays open - the
   * Owners page's add button moves along as owners are added in front of it -
   * so the popup is placed against it again. Also when the popup's own
   * content grows, for a popup that stays inside its boundary.
   */
  repositionKey?: string | number | undefined;
  /*
   * Keep the popup inside the dialog or side panel body around its anchor
   * (ANCHORED_POPUP_BOUNDARY_ATTRIBUTE) as well as inside the window, and
   * choose its side by the height of its content (placeAnchoredPopupInBounds).
   */
  stayInsideBoundary?: boolean | undefined;
  /*
   * The control that takes focus when the popup is opened from the keyboard,
   * instead of its first one - the picked color of a swatch grid.
   */
  getInitialFocusElement?:
    | ((popup: HTMLElement) => HTMLElement | null)
    | undefined;
}

export interface AnchoredFieldPopup {
  anchorRef: React.MutableRefObject<HTMLDivElement | null>;
  popupRef: React.MutableRefObject<HTMLDivElement | null>;
  isPopupOpen: boolean;
  popupPosition: AnchoredFieldPopupPosition | null;
  portalTarget: HTMLElement | null;
  popupId: string;
  closePopup: (shouldReturnFocus?: boolean) => void;
  togglePopup: () => void;
  // Opens the popup from a trigger's keyboard, and moves focus into it.
  onTriggerKeyDown: (event: React.KeyboardEvent) => void;
}

/*
 * The keys that open a popup from its trigger. ArrowDown/ArrowUp match the
 * listbox convention every other menu in this codebase follows; Enter and Space
 * are what a button-shaped control is expected to answer to.
 */
const POPUP_OPENING_KEYS: Array<string> = [
  "Enter",
  " ",
  "Spacebar",
  "ArrowDown",
  "ArrowUp",
];

type GetFocusableElementsFunction = (
  container: HTMLElement,
) => Array<HTMLElement>;

const getFocusableElements: GetFocusableElementsFunction = (
  container: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element: HTMLElement) => {
    /*
     * tabindex="-1" takes a control out of the Tab order - the unpicked
     * swatches of a radio group, which the arrow keys reach - so it is
     * neither where focus lands on open nor an end of the Tab cycle.
     */
    return (
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getAttribute("tabindex") !== "-1"
    );
  });
};

type UseAnchoredFieldPopupFunction = (
  options: AnchoredFieldPopupOptions,
) => AnchoredFieldPopup;

const useAnchoredFieldPopup: UseAnchoredFieldPopupFunction = (
  options: AnchoredFieldPopupOptions,
): AnchoredFieldPopup => {
  const { popupWidth, popupMaxHeight, repositionKey, stayInsideBoundary } =
    options;
  const getInitialFocusElementRef: React.MutableRefObject<
    AnchoredFieldPopupOptions["getInitialFocusElement"]
  > = useRef<AnchoredFieldPopupOptions["getInitialFocusElement"]>(
    options.getInitialFocusElement,
  );
  getInitialFocusElementRef.current = options.getInitialFocusElement;
  const preferredPlacement: AnchoredFieldPopupPlacement =
    options.preferredPlacement || "below";

  const [isPopupOpen, setIsPopupOpen] = useState<boolean>(false);
  const [popupPosition, setPopupPosition] =
    useState<AnchoredFieldPopupPosition | null>(null);

  const anchorRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const popupRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  const popupId: string = useId();

  /*
   * A pointer user wants the popup to appear under the field and their pointer
   * to stay where it is. A keyboard user has no other way in, so opening from
   * the keyboard hands focus to the popup's first control - the hex box for a
   * colour, the search box for an icon.
   */
  const shouldMoveFocusIntoPopupRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const focusPopup: () => void = useCallback((): void => {
    const popup: HTMLDivElement | null = popupRef.current;

    if (!popup) {
      return;
    }

    (
      getInitialFocusElementRef.current?.(popup) ||
      getFocusableElements(popup)[0] ||
      popup
    ).focus();
  }, []);

  const closePopup: (shouldReturnFocus?: boolean) => void = useCallback(
    (shouldReturnFocus?: boolean): void => {
      setIsPopupOpen(false);

      if (!shouldReturnFocus) {
        return;
      }

      /*
       * The popup lives outside the modal, so on close we hand focus back to the
       * field that opened it rather than letting it fall through to the body.
       */
      const anchor: HTMLDivElement | null = anchorRef.current;

      if (!anchor) {
        return;
      }

      const focusTarget: HTMLElement =
        anchor.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) || anchor;

      focusTarget.focus();
    },
    [],
  );

  const togglePopup: () => void = useCallback((): void => {
    setIsPopupOpen((isOpen: boolean) => {
      return !isOpen;
    });
  }, []);

  const openPopup: (shouldMoveFocusIntoPopup?: boolean) => void = useCallback(
    (shouldMoveFocusIntoPopup?: boolean): void => {
      shouldMoveFocusIntoPopupRef.current = Boolean(shouldMoveFocusIntoPopup);
      setIsPopupOpen(true);
    },
    [],
  );

  const onTriggerKeyDown: (event: React.KeyboardEvent) => void = useCallback(
    (event: React.KeyboardEvent): void => {
      if (event.defaultPrevented || !POPUP_OPENING_KEYS.includes(event.key)) {
        return;
      }

      /*
       * The key opened the popup and means nothing else after that: Input's
       * own onEnterPress stands down on a defaultPrevented event, and a
       * trigger placed inside a real <form> - which nothing about Input
       * prevents, even though this codebase's forms are not form elements -
       * would otherwise submit it on the way past.
       */
      event.preventDefault();

      if (isPopupOpen) {
        focusPopup();
        return;
      }

      openPopup(true);
    },
    [isPopupOpen, focusPopup, openPopup],
  );

  /*
   * Waits for a measured position, not just for the open flag: until then the
   * popup is `visibility: hidden` so it cannot flash at the top left corner,
   * and a hidden element refuses focus. jsdom has no such scruples, so this
   * ordering only shows itself in a browser.
   */
  useEffect(() => {
    if (
      !isPopupOpen ||
      !popupPosition ||
      !shouldMoveFocusIntoPopupRef.current
    ) {
      return;
    }

    shouldMoveFocusIntoPopupRef.current = false;
    focusPopup();
  }, [isPopupOpen, popupPosition, focusPopup]);

  const updatePopupPosition: () => void = useCallback((): void => {
    if (!anchorRef.current || typeof window === "undefined") {
      return;
    }

    const anchorRect: DOMRect = anchorRef.current.getBoundingClientRect();

    if (stayInsideBoundary) {
      const boundaryElement: Element | null = anchorRef.current.closest(
        `[${ANCHORED_POPUP_BOUNDARY_ATTRIBUTE}]`,
      );
      const boundaryRect: DOMRect | null = boundaryElement
        ? boundaryElement.getBoundingClientRect()
        : null;

      if (
        boundaryRect &&
        isAnchorOutsideBoundary({ anchor: anchorRect, boundary: boundaryRect })
      ) {
        closePopup(false);
        return;
      }

      const popup: HTMLDivElement | null = popupRef.current;
      /*
       * All of the content, even while a maxHeight is cutting it short, and
       * the popup's own border round it.
       */
      const contentHeight: number = popup
        ? popup.scrollHeight + (popup.offsetHeight - popup.clientHeight)
        : 0;
      const placed: AnchoredPopupPlacementResult = placeAnchoredPopupInBounds({
        anchor: anchorRect,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        boundary: boundaryRect,
        popupWidth,
        popupHeight: contentHeight > 0 ? contentHeight : popupMaxHeight,
        popupMaxHeight,
        preferredPlacement,
      });

      setPopupPosition({
        bottom: placed.bottom,
        left: placed.left,
        maxHeight: placed.maxHeight,
        top: placed.top,
        width: placed.width,
      });
      return;
    }

    const availableWidth: number = Math.max(
      0,
      window.innerWidth - POPUP_VIEWPORT_PADDING_PX * 2,
    );
    const width: number = Math.min(popupWidth, availableWidth);
    const maximumLeft: number = Math.max(
      POPUP_VIEWPORT_PADDING_PX,
      window.innerWidth - POPUP_VIEWPORT_PADDING_PX - width,
    );
    const left: number = Math.min(
      Math.max(anchorRect.left, POPUP_VIEWPORT_PADDING_PX),
      maximumLeft,
    );
    const spaceBelow: number = Math.max(
      0,
      window.innerHeight -
        anchorRect.bottom -
        POPUP_GAP_PX -
        POPUP_VIEWPORT_PADDING_PX,
    );
    const spaceAbove: number = Math.max(
      0,
      anchorRect.top - POPUP_GAP_PX - POPUP_VIEWPORT_PADDING_PX,
    );
    const shouldOpenAbove: boolean = shouldAnchoredPopupOpenAbove({
      preferredPlacement,
      spaceAbove,
      spaceBelow,
    });
    const availableHeight: number = shouldOpenAbove ? spaceAbove : spaceBelow;

    setPopupPosition({
      bottom: shouldOpenAbove
        ? window.innerHeight - anchorRect.top + POPUP_GAP_PX
        : undefined,
      left,
      maxHeight: Math.min(popupMaxHeight, availableHeight),
      top: shouldOpenAbove ? undefined : anchorRect.bottom + POPUP_GAP_PX,
      width,
    });
  }, [
    popupWidth,
    popupMaxHeight,
    preferredPlacement,
    stayInsideBoundary,
    closePopup,
  ]);

  useLayoutEffect(() => {
    if (!isPopupOpen) {
      setPopupPosition(null);
      return;
    }

    let animationFrame: number | null = null;

    const schedulePositionUpdate: () => void = (): void => {
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame((): void => {
        animationFrame = null;
        updatePopupPosition();
      });
    };

    updatePopupPosition();

    /*
     * Capture phase so scrolling the modal body - which does not bubble a scroll
     * event to window - still repositions the popup against its anchor.
     */
    window.addEventListener("resize", schedulePositionUpdate);
    document.addEventListener("scroll", schedulePositionUpdate, true);

    return () => {
      window.removeEventListener("resize", schedulePositionUpdate);
      document.removeEventListener("scroll", schedulePositionUpdate, true);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [isPopupOpen, updatePopupPosition, repositionKey]);

  // Outside click. Portal aware: the popup is not a DOM child of the anchor.
  useEffect(() => {
    if (!isPopupOpen) {
      return;
    }

    type HandlePointerDownFunction = (event: MouseEvent) => void;

    const handlePointerDown: HandlePointerDownFunction = (
      event: MouseEvent,
    ): void => {
      if (!(event.target instanceof Node)) {
        return;
      }

      const target: Node = event.target;

      if (anchorRef.current?.contains(target)) {
        // The trigger toggles itself, so leave the state change to its handler.
        return;
      }

      if (popupRef.current?.contains(target)) {
        return;
      }

      /*
       * This press is spent on closing the popup. Claiming it stops the modal
       * underneath from reading the same press as a backdrop dismissal and
       * throwing the form away along with the picker.
       */
      consumePressForAnchoredPopup(event);
      closePopup(false);
    };

    document.addEventListener("mousedown", handlePointerDown, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [isPopupOpen, closePopup]);

  useEffect(() => {
    if (!isPopupOpen) {
      return;
    }

    type HandleKeyDownFunction = (event: KeyboardEvent) => void;

    const handleKeyDown: HandleKeyDownFunction = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        /*
         * Swallow Escape during the capture phase so Modal's document level
         * handler never sees it. Escape dismisses this popup, not the modal.
         */
        event.preventDefault();
        event.stopPropagation();
        closePopup(true);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const popup: HTMLDivElement | null = popupRef.current;

      if (!popup) {
        return;
      }

      const focusableElements: Array<HTMLElement> = getFocusableElements(popup);

      if (focusableElements.length === 0) {
        return;
      }

      /*
       * Modal builds its focus trap from its own subtree, so once focus is in
       * the portalled popup it would drag focus back into the modal on every
       * Tab. Keep Tab cycling within the popup until Escape or a selection
       * closes it.
       */
      event.stopPropagation();

      const firstElement: HTMLElement = focusableElements[0]!;
      const lastElement: HTMLElement =
        focusableElements[focusableElements.length - 1]!;
      const activeElement: Element | null = document.activeElement;

      if (!popup.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
        return;
      }

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isPopupOpen, closePopup]);

  return {
    anchorRef,
    closePopup,
    isPopupOpen,
    onTriggerKeyDown,
    popupId,
    popupPosition,
    popupRef,
    portalTarget: typeof document === "undefined" ? null : document.body,
    togglePopup,
  };
};

export default useAnchoredFieldPopup;
