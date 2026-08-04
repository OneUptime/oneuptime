import React, {
  useCallback,
  useEffect,
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
 * the viewport.
 */

const POPUP_GAP_PX: number = 4;
const POPUP_VIEWPORT_PADDING_PX: number = 8;
const POPUP_MIN_USEFUL_HEIGHT_PX: number = 160;

const FOCUSABLE_SELECTOR: string =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface AnchoredFieldPopupPosition {
  bottom: number | undefined;
  left: number;
  maxHeight: number;
  top: number | undefined;
  width: number;
}

export interface AnchoredFieldPopupOptions {
  // Intrinsic width of the popup, used to clamp it inside the viewport.
  popupWidth: number;
  popupMaxHeight: number;
}

export interface AnchoredFieldPopup {
  anchorRef: React.MutableRefObject<HTMLDivElement | null>;
  popupRef: React.MutableRefObject<HTMLDivElement | null>;
  isPopupOpen: boolean;
  popupPosition: AnchoredFieldPopupPosition | null;
  portalTarget: HTMLElement | null;
  closePopup: (shouldReturnFocus?: boolean) => void;
  togglePopup: () => void;
}

type GetFocusableElementsFunction = (
  container: HTMLElement,
) => Array<HTMLElement>;

const getFocusableElements: GetFocusableElementsFunction = (
  container: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element: HTMLElement) => {
    return (
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true"
    );
  });
};

type UseAnchoredFieldPopupFunction = (
  options: AnchoredFieldPopupOptions,
) => AnchoredFieldPopup;

const useAnchoredFieldPopup: UseAnchoredFieldPopupFunction = (
  options: AnchoredFieldPopupOptions,
): AnchoredFieldPopup => {
  const { popupWidth, popupMaxHeight } = options;

  const [isPopupOpen, setIsPopupOpen] = useState<boolean>(false);
  const [popupPosition, setPopupPosition] =
    useState<AnchoredFieldPopupPosition | null>(null);

  const anchorRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const popupRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

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

  const updatePopupPosition: () => void = useCallback((): void => {
    if (!anchorRef.current || typeof window === "undefined") {
      return;
    }

    const anchorRect: DOMRect = anchorRef.current.getBoundingClientRect();
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
    const shouldOpenAbove: boolean =
      spaceBelow < POPUP_MIN_USEFUL_HEIGHT_PX && spaceAbove > spaceBelow;
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
  }, [popupWidth, popupMaxHeight]);

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
  }, [isPopupOpen, updatePopupPosition]);

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
    popupPosition,
    popupRef,
    portalTarget: typeof document === "undefined" ? null : document.body,
    togglePopup,
  };
};

export default useAnchoredFieldPopup;
