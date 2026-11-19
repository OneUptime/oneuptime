import React, {
  MouseEvent,
  MouseEventHandler,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The shared Dropdown draws its open menu over the page, at the end of the
 * document (menuPortalTarget), not inside the component that holds it. An
 * option picked there is still a pick made inside that component - a filter
 * chip's operator, say - so it never closes it.
 */
export const DROPDOWN_MENU_PORTAL_SELECTOR: string = ".ou-select__menu-portal";

/*
 * So does every tooltip (Tooltip's TooltipLayer), so that nothing its
 * trigger is in can cut it off (#9769). A press in a tooltip whose trigger
 * is inside the component - on a link in it, or selecting its words - is a
 * press inside that component. Tippy keeps the tooltip's instance, and so
 * its trigger, on the tooltip's own element.
 */
export const TOOLTIP_ROOT_SELECTOR: string = "[data-tippy-root]";

type TooltipRootElement = Element & {
  _tippy?: { reference?: Element | undefined } | undefined;
};

export function isInsideComponent(
  component: Element | null | undefined,
  target: EventTarget | null,
): boolean {
  if (!component || !(target instanceof Node)) {
    return false;
  }

  if (component.contains(target)) {
    return true;
  }

  const element: Element | null =
    target instanceof Element ? target : target.parentElement;

  if (element?.closest(DROPDOWN_MENU_PORTAL_SELECTOR)) {
    return true;
  }

  const tooltipRoot: TooltipRootElement | null =
    element?.closest<Element>(TOOLTIP_ROOT_SELECTOR) || null;
  const tooltipTrigger: Element | undefined = tooltipRoot?._tippy?.reference;

  return Boolean(
    tooltipRoot &&
      tooltipTrigger &&
      !tooltipRoot.contains(tooltipTrigger) &&
      isInsideComponent(component, tooltipTrigger),
  );
}

type UseComponentOutsideClickFunction = (isVisible: boolean) => {
  ref: any;
  isComponentVisible: boolean;
  setIsComponentVisible: React.Dispatch<React.SetStateAction<boolean>>;
};

const useComponentOutsideClick: UseComponentOutsideClickFunction = (
  isVisible: boolean,
): {
  ref: any;
  isComponentVisible: boolean;
  setIsComponentVisible: React.Dispatch<React.SetStateAction<boolean>>;
} => {
  const [isComponentVisible, setIsComponentVisible] =
    useState<boolean>(isVisible);
  const ref: any = useRef<any>(null);

  /*
   * Whether the gesture that is about to produce a click STARTED inside the
   * component. A drag that begins inside and ends outside — selecting the text
   * in a menu's search box and overshooting the panel, most obviously — fires
   * its click on the common ancestor of the two, which is outside. Dismissing
   * on that throws away whatever the user was in the middle of doing.
   *
   * Only a primary-button press arms it. The other buttons fire mousedown and
   * then never produce a click at all — right-click goes to contextmenu, middle
   * click to auxclick — so arming on those would leave the flag set with no
   * click coming to spend it.
   */
  const didPointerDownInside: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const handlePointerDown: MouseEventHandler = (event: MouseEvent) => {
    if (event.button !== 0) {
      didPointerDownInside.current = false;
      return;
    }

    didPointerDownInside.current = isInsideComponent(ref.current, event.target);
  };

  const handleClickOutside: MouseEventHandler = (event: MouseEvent) => {
    /*
     * Spend the flag on the very next click whatever happens to it, so a press
     * whose release never became a click — dragged into a native drag, target
     * unmounted mid-gesture — cannot leave it armed for someone else's.
     */
    const didStartInside: boolean = didPointerDownInside.current;
    didPointerDownInside.current = false;

    /*
     * ...and only let it suppress a click that a pointer could actually have
     * produced. Keyboard activation and element.click() both arrive with a
     * detail of 0 and no mousedown of their own, so without this a stale flag
     * would eat a dismissal that no press was ever responsible for — which is
     * exactly the keyboard user's Enter on a control elsewhere on the page.
     */
    if (didStartInside && event.detail > 0) {
      return;
    }

    if (ref.current && !isInsideComponent(ref.current, event.target)) {
      setIsComponentVisible(false);
    }
  };

  useEffect(() => {
    document.addEventListener("mousedown", handlePointerDown as any, true);
    document.addEventListener("click", handleClickOutside as any, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown as any, true);
      document.removeEventListener("click", handleClickOutside as any, true);
    };
  }, []);

  return { ref, isComponentVisible, setIsComponentVisible };
};

export default useComponentOutsideClick;
