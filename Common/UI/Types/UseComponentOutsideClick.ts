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
   * Deliberately narrowing only: a click with no preceding mousedown inside
   * still dismisses exactly as before, so nothing that used to close stops
   * closing.
   */
  const didPointerDownInside: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const handlePointerDown: MouseEventHandler = (event: MouseEvent) => {
    didPointerDownInside.current = Boolean(
      ref.current && ref.current.contains(event.target),
    );
  };

  const handleClickOutside: MouseEventHandler = (event: MouseEvent) => {
    if (didPointerDownInside.current) {
      didPointerDownInside.current = false;
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
