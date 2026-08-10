import { ButtonStyleType } from "../Button/Button";
import ButtonType from "../Button/ButtonTypes";
import Icon from "../Icon/Icon";
import Loader, { LoaderType } from "../Loader/Loader";
import ModalBody from "./ModalBody";
import ModalFooter from "./ModalFooter";
import { VeryLightGray } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export enum ModalWidth {
  Normal,
  Medium,
  Large,
}

/*
 * The page behind a modal must not scroll, and nested modals share a single
 * lock: a counter, rather than a boolean, is what stops the inner modal from
 * handing scrolling back while its parent is still open.
 */
let openModalCount: number = 0;
let bodyOverflowBeforeLock: string = "";
let bodyPaddingRightBeforeLock: string = "";

type PageScrollLockFunction = () => void;

const lockPageScroll: PageScrollLockFunction = (): void => {
  openModalCount++;

  if (openModalCount > 1 || typeof document === "undefined") {
    return;
  }

  bodyOverflowBeforeLock = document.body.style.overflow;
  bodyPaddingRightBeforeLock = document.body.style.paddingRight;

  /*
   * Hiding the scrollbar reclaims its width, so the page underneath would
   * jump sideways by exactly that much. Pad it back to hold everything still.
   */
  const scrollbarWidth: number =
    window.innerWidth - document.documentElement.clientWidth;

  if (scrollbarWidth > 0) {
    document.body.style.paddingRight = `${scrollbarWidth}px`;
  }

  document.body.style.overflow = "hidden";
};

const unlockPageScroll: PageScrollLockFunction = (): void => {
  openModalCount = Math.max(0, openModalCount - 1);

  if (openModalCount > 0 || typeof document === "undefined") {
    return;
  }

  document.body.style.overflow = bodyOverflowBeforeLock;
  document.body.style.paddingRight = bodyPaddingRightBeforeLock;
};

export interface ComponentProps {
  title: string;
  description?: string | undefined;
  children: Array<ReactElement> | ReactElement;
  onClose?: undefined | (() => void);
  submitButtonText?: undefined | string;
  onSubmit?: (() => void) | undefined;
  submitButtonStyleType?: undefined | ButtonStyleType;
  submitButtonType?: undefined | ButtonType;
  closeButtonStyleType?: undefined | ButtonStyleType;
  isLoading?: undefined | boolean;
  disableSubmitButton?: undefined | boolean;
  error?: string | undefined;
  isBodyLoading?: boolean | undefined;
  modalWidth?: ModalWidth | undefined;
  rightElement?: ReactElement | undefined;
  closeButtonText?: string | undefined;
  leftFooterElement?: ReactElement | undefined;
  disableCloseOnBackdropClick?: boolean | undefined;
}

const Modal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedTitle: string = translateString(props.title) || props.title;
  const translatedDescription: string | undefined = translateString(
    props.description,
  );
  const translatedSubmitButtonText: string | undefined = translateString(
    props.submitButtonText,
  );
  const translatedCloseButtonText: string | undefined = translateString(
    props.closeButtonText,
  );
  const translatedCloseLabel: string = translateString("Close") || "Close";
  const modalRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const contentRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const contentInnerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const previouslyFocusedElementRef: React.MutableRefObject<HTMLElement | null> =
    useRef<HTMLElement | null>(
      typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
    );
  const onCloseRef: React.MutableRefObject<(() => void) | undefined> = useRef<
    (() => void) | undefined
  >(props.onClose);
  const backdropPressStartedOutsideRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const titleId: string = useId();
  const descriptionId: string = useId();

  /*
   * The modal is mounted in its closed state and flipped open one frame later
   * so the browser has something to transition from. Without that first paint
   * the panel would simply appear.
   */
  const [hasEntered, setHasEntered] = useState<boolean>(false);

  /*
   * A body taller than the modal hides content above and below the fold. The
   * header and footer grow a shadow in whichever direction that is true, which
   * is the only cue that the body scrolls at all.
   */
  const [isContentHiddenAbove, setIsContentHiddenAbove] =
    useState<boolean>(false);
  const [isContentHiddenBelow, setIsContentHiddenBelow] =
    useState<boolean>(false);

  useEffect(() => {
    onCloseRef.current = props.onClose;
  }, [props.onClose]);

  useEffect(() => {
    const open: () => void = (): void => {
      setHasEntered(true);
    };

    const frame: number = requestAnimationFrame(open);

    /*
     * A hidden or throttled tab never runs an animation frame, and a modal that
     * opened there would sit at zero opacity. The timer is the safety net: it
     * skips the transition rather than the modal.
     */
    const fallbackTimer: ReturnType<typeof setTimeout> = setTimeout(open, 80);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallbackTimer);
    };
  }, []);

  useEffect(() => {
    lockPageScroll();

    return () => {
      unlockPageScroll();
    };
  }, []);

  useEffect(() => {
    const content: HTMLDivElement | null = contentRef.current;

    if (!content) {
      return undefined;
    }

    const measure: () => void = (): void => {
      /*
       * A pixel of tolerance: fractional layout heights otherwise leave the
       * bottom shadow up forever on a body that is already fully scrolled.
       */
      setIsContentHiddenAbove(content.scrollTop > 1);
      setIsContentHiddenBelow(
        content.scrollHeight - content.scrollTop - content.clientHeight > 1,
      );
    };

    measure();
    content.addEventListener("scroll", measure, { passive: true });

    /*
     * ResizeObserver is missing in jsdom and in older browsers. Falling back to
     * resize events keeps the shadows roughly right there; what it cannot catch
     * is the body growing on its own, which only matters once the modal is up.
     */
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);

      return () => {
        content.removeEventListener("scroll", measure);
        window.removeEventListener("resize", measure);
      };
    }

    const observer: ResizeObserver = new ResizeObserver(measure);
    observer.observe(content);

    if (contentInnerRef.current) {
      observer.observe(contentInnerRef.current);
    }

    return () => {
      content.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  const isTopmostDialog: () => boolean = useCallback((): boolean => {
    const modal: HTMLDivElement | null = modalRef.current;

    if (!modal) {
      return false;
    }

    const openDialogs: Array<Element> = Array.from(
      document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
    );

    return openDialogs[openDialogs.length - 1] === modal;
  }, []);

  useEffect(() => {
    const modal: HTMLDivElement | null = modalRef.current;
    if (!modal) {
      return undefined;
    }

    const getFocusableElements: () => Array<HTMLElement> =
      (): Array<HTMLElement> => {
        return Array.from(
          modal.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element: HTMLElement) => {
          /*
           * Collapsed sections and closed dropdowns leave focusable elements in
           * the DOM with no box at all, and tabbing onto one of those looks
           * exactly like focus escaping the modal. checkVisibility does not
           * exist in jsdom, where nothing has a box to begin with, so the
           * fallback keeps every element in the cycle there.
           */
          const isRendered: boolean =
            typeof element.checkVisibility !== "function" ||
            element.checkVisibility();

          return (
            !element.hasAttribute("disabled") &&
            element.getAttribute("aria-hidden") !== "true" &&
            isRendered
          );
        });
      };

    const initialFocusElement: HTMLElement | undefined =
      getFocusableElements().find((element: HTMLElement) => {
        return element.getAttribute("data-testid") !== "close-button";
      });

    if (isTopmostDialog()) {
      (initialFocusElement || modal).focus();
    }

    const handleKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.defaultPrevented || !isTopmostDialog()) {
        return;
      }

      if (event.key === "Escape" && onCloseRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements: Array<HTMLElement> = getFocusableElements();

      if (focusableElements.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }

      const firstFocusableElement: HTMLElement = focusableElements[0]!;
      const lastFocusableElement: HTMLElement =
        focusableElements[focusableElements.length - 1]!;
      const activeElement: Element | null = document.activeElement;

      if (
        event.shiftKey &&
        (activeElement === firstFocusableElement ||
          !modal.contains(activeElement))
      ) {
        event.preventDefault();
        lastFocusableElement.focus();
      } else if (
        !event.shiftKey &&
        (activeElement === lastFocusableElement ||
          !modal.contains(activeElement))
      ) {
        event.preventDefault();
        firstFocusableElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);

      if (previouslyFocusedElementRef.current?.isConnected) {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, [isTopmostDialog]);

  type BackdropPressHandler = (event: React.MouseEvent<HTMLDivElement>) => void;
  type IsEventOutsideModalFunction = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => boolean;

  const isEventOutsideModal: IsEventOutsideModalFunction = (
    event: React.MouseEvent<HTMLDivElement>,
  ): boolean => {
    const modal: HTMLDivElement | null = modalRef.current;

    return modal !== null && !modal.contains(event.target as Node);
  };

  const onBackdropMouseDown: BackdropPressHandler = (
    event: React.MouseEvent<HTMLDivElement>,
  ): void => {
    backdropPressStartedOutsideRef.current = isEventOutsideModal(event);
  };

  const onBackdropClick: BackdropPressHandler = (
    event: React.MouseEvent<HTMLDivElement>,
  ): void => {
    /*
     * Both ends of the click have to land on the backdrop. Selecting text in
     * the body and releasing the mouse past the edge of the panel is a drag,
     * not a dismissal, and it used to be the fastest way to lose a filled-in
     * form.
     */
    const pressStartedOutside: boolean = backdropPressStartedOutsideRef.current;
    backdropPressStartedOutsideRef.current = false;

    if (
      props.disableCloseOnBackdropClick ||
      !props.onClose ||
      !pressStartedOutside ||
      !isEventOutsideModal(event) ||
      !isTopmostDialog()
    ) {
      return;
    }

    props.onClose();
  };

  let modalWidthClassName: string = "sm:max-w-lg md:max-w-lg";

  if (props.modalWidth === ModalWidth.Medium) {
    modalWidthClassName = "sm:max-w-3xl md:max-w-3xl";
  } else if (props.modalWidth === ModalWidth.Large) {
    modalWidthClassName = "sm:max-w-7xl md:max-w-7xl";
  }

  /*
   * Once the panel has settled it carries no transform at all. A lingering
   * `scale-100` would make it the containing block for `position: fixed`, and
   * a modal opened from inside this one would be laid out against the panel
   * instead of the viewport.
   */
  const panelTransitionClassName: string = hasEntered
    ? "opacity-100"
    : "translate-y-6 opacity-0 sm:translate-y-0 sm:scale-95";

  return (
    <div className="relative z-50">
      <div
        className={`fixed inset-0 bg-gray-950/45 backdrop-blur-[2px] transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          hasEntered ? "opacity-100" : "opacity-0"
        }`}
        data-testid="modal-backdrop"
        aria-hidden="true"
      />

      <div
        className="fixed inset-0 z-50 overflow-y-auto"
        onMouseDown={onBackdropMouseDown}
        onClick={onBackdropClick}
      >
        <div className="flex min-h-full items-end justify-center p-0 text-center sm:items-center sm:p-6">
          <div
            ref={modalRef}
            className={`relative flex max-h-[calc(100dvh-1rem)] w-full flex-col rounded-t-2xl border border-gray-200/80 bg-white text-left shadow-2xl ring-1 ring-black/5 transition duration-200 ease-out focus:outline-none motion-reduce:transition-none sm:my-8 sm:max-h-[calc(100dvh-4rem)] sm:rounded-xl ${modalWidthClassName} ${panelTransitionClassName}`}
            data-testid="modal"
            aria-labelledby={titleId}
            aria-describedby={translatedDescription ? descriptionId : undefined}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
          >
            <div
              className={`relative z-10 flex shrink-0 items-start gap-3 rounded-t-2xl border-b border-gray-100 bg-white px-5 py-4 transition-shadow duration-200 sm:gap-4 sm:rounded-t-xl sm:px-6 ${
                isContentHiddenAbove
                  ? "shadow-[0_6px_10px_-10px_var(--ou-modal-scroll-shadow,rgb(15_23_42_/_0.35))]"
                  : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <h3
                  data-testid="modal-title"
                  className="text-base font-semibold leading-6 tracking-tight text-gray-900"
                  id={titleId}
                >
                  {translatedTitle}
                </h3>
                {translatedDescription && (
                  <p
                    id={descriptionId}
                    data-testid="modal-description"
                    className="mt-0.5 text-sm leading-5 text-gray-500"
                  >
                    {translatedDescription}
                  </p>
                )}
              </div>
              {props.rightElement && (
                <div
                  data-testid="right-element"
                  className="flex shrink-0 items-center"
                >
                  {props.rightElement}
                </div>
              )}
              {props.onClose && (
                <button
                  type="button"
                  title={translatedCloseLabel}
                  aria-label={translatedCloseLabel}
                  data-testid="close-button"
                  onClick={props.onClose}
                  className="-mr-1.5 -mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  <Icon icon={IconProp.Close} className="h-4 w-4" />
                </button>
              )}
            </div>

            <div
              ref={contentRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6"
              data-testid="modal-content"
            >
              <div ref={contentInnerRef}>
                <ModalBody error={props.error}>
                  {!props.isBodyLoading ? (
                    props.children
                  ) : (
                    <div className="modal-body flex justify-center py-16">
                      <Loader
                        loaderType={LoaderType.Bar}
                        color={VeryLightGray}
                        size={200}
                      />
                    </div>
                  )}
                </ModalBody>
              </div>
            </div>
            <ModalFooter
              submitButtonType={
                props.submitButtonType
                  ? props.submitButtonType
                  : ButtonType.Button
              }
              submitButtonStyleType={
                props.submitButtonStyleType
                  ? props.submitButtonStyleType
                  : ButtonStyleType.PRIMARY
              }
              closeButtonStyleType={
                props.closeButtonStyleType
                  ? props.closeButtonStyleType
                  : ButtonStyleType.NORMAL
              }
              submitButtonText={
                translatedSubmitButtonText
                  ? translatedSubmitButtonText
                  : translateString("Save") || "Save"
              }
              closeButtonText={
                translatedCloseButtonText
                  ? translatedCloseButtonText
                  : translateString("Cancel") || "Cancel"
              }
              onSubmit={props.onSubmit}
              onClose={props.onClose ? props.onClose : undefined}
              isLoading={props.isLoading || false}
              disableSubmitButton={
                props.isBodyLoading || props.disableSubmitButton
              }
              leftFooterElement={props.leftFooterElement}
              hasContentHiddenBelow={isContentHiddenBelow}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Modal;
