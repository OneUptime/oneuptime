import React, {
  MouseEvent,
  MouseEventHandler,
  useEffect,
  useRef,
  useState,
} from "react";

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

    didPointerDownInside.current = Boolean(
      ref.current && ref.current.contains(event.target),
    );
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

    if (ref.current && !ref.current.contains(event.target)) {
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
