import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import ButtonType from "../Button/ButtonTypes";
import Icon, { IconType, SizeProp, ThickProp } from "../Icon/Icon";
import Loader, { LoaderType } from "../Loader/Loader";
import ModalBody from "./ModalBody";
import ModalFooter from "./ModalFooter";
import {
  ModalStackContext,
  ModalStackValue,
  useModalStackDepth,
} from "./ModalStackContext";
import { VeryLightGray } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";

export enum ModalWidth {
  Normal,
  Medium,
  Large,
}

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
  icon?: IconProp | undefined;
  iconType?: IconType | undefined;
  modalWidth?: ModalWidth | undefined;
  rightElement?: ReactElement | undefined;
  closeButtonText?: string | undefined;
  leftFooterElement?: ReactElement | undefined;
  ariaDescribedBy?: string | undefined;
}

const focusableElementSelector: string = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(", ");

const getTopmostModal: () => HTMLElement | null = (): HTMLElement | null => {
  const modals: Array<HTMLElement> = Array.from(
    document.querySelectorAll<HTMLElement>("[data-modal-stack-depth]"),
  );
  let topmostModal: HTMLElement | null = null;
  let topmostDepth: number = -1;

  for (const modal of modals) {
    const depth: number = Number(modal.dataset["modalStackDepth"] || 0);
    if (depth >= topmostDepth) {
      topmostDepth = depth;
      topmostModal = modal;
    }
  }

  return topmostModal;
};

const modalOwnershipRefs: Map<
  HTMLElement,
  React.MutableRefObject<boolean>
> = new Map<HTMLElement, React.MutableRefObject<boolean>>();

const getOwnedFloatingPortals: (modal: HTMLElement) => Array<HTMLElement> = (
  modal: HTMLElement,
): Array<HTMLElement> => {
  const ownerId: string | undefined = modal.dataset["modalOwnerId"];
  if (!ownerId) {
    return [];
  }

  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-floating-modal-owner]"),
  ).filter((portal: HTMLElement): boolean => {
    return portal.dataset["floatingModalOwner"] === ownerId;
  });
};

const elementBelongsToModal: (
  modal: HTMLElement,
  element: Element | null,
) => boolean = (modal: HTMLElement, element: Element | null): boolean => {
  if (!element) {
    return false;
  }

  return (
    modal.contains(element) ||
    getOwnedFloatingPortals(modal).some((portal: HTMLElement): boolean => {
      return portal.contains(element);
    })
  );
};

const getModalFocusableElements: (modal: HTMLElement) => Array<HTMLElement> = (
  modal: HTMLElement,
): Array<HTMLElement> => {
  const modalElements: Array<HTMLElement> = Array.from(
    modal.querySelectorAll<HTMLElement>(focusableElementSelector),
  );
  const portalElements: Array<HTMLElement> = getOwnedFloatingPortals(
    modal,
  ).flatMap((portal: HTMLElement): Array<HTMLElement> => {
    return Array.from(
      portal.querySelectorAll<HTMLElement>(focusableElementSelector),
    );
  });

  return [...modalElements, ...portalElements].filter(
    (element: HTMLElement): boolean => {
      return !element.closest("[inert]");
    },
  );
};

const getPreferredModalFocus: (modal: HTMLElement) => HTMLElement = (
  modal: HTMLElement,
): HTMLElement => {
  return (
    modal.querySelector<HTMLElement>("[autofocus]") ||
    modal.querySelector<HTMLElement>(
      ".modal-body input:not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled]), .modal-body button:not([disabled])",
    ) ||
    modal.querySelector<HTMLElement>(
      '[data-testid="modal-footer-close-button"]',
    ) ||
    getModalFocusableElements(modal)[0] ||
    modal
  );
};

const syncModalAccessibility: () => void = (): void => {
  const topmostModal: HTMLElement | null = getTopmostModal();
  const modals: Array<HTMLElement> = Array.from(
    document.querySelectorAll<HTMLElement>("[data-modal-stack-depth]"),
  );

  for (const modal of modals) {
    const ownershipRef: React.MutableRefObject<boolean> | undefined =
      modalOwnershipRefs.get(modal);
    if (ownershipRef) {
      ownershipRef.current = modal === topmostModal;
    }

    if (modal === topmostModal) {
      modal.setAttribute("aria-modal", "true");
      modal.removeAttribute("aria-hidden");
      modal.removeAttribute("inert");
    } else {
      modal.setAttribute("aria-modal", "false");
      modal.setAttribute("inert", "");
      modal.setAttribute("aria-hidden", "true");
    }
  }

  const topmostOwnerId: string | undefined =
    topmostModal?.dataset["modalOwnerId"];
  const floatingPortals: Array<HTMLElement> = Array.from(
    document.querySelectorAll<HTMLElement>("[data-floating-modal-owner]"),
  );

  for (const portal of floatingPortals) {
    if (portal.dataset["floatingModalOwner"] === topmostOwnerId) {
      portal.removeAttribute("aria-hidden");
      portal.removeAttribute("inert");
    } else {
      portal.setAttribute("inert", "");
      portal.setAttribute("aria-hidden", "true");
    }
  }
};

let openModalCount: number = 0;
let bodyOverflowBeforeFirstModal: string = "";
let bodyPaddingRightBeforeFirstModal: string = "";

const lockBodyScroll: () => void = (): void => {
  if (openModalCount === 0) {
    bodyOverflowBeforeFirstModal = document.body.style.overflow;
    bodyPaddingRightBeforeFirstModal = document.body.style.paddingRight;

    const documentWidth: number = document.documentElement.clientWidth;
    const scrollbarWidth: number =
      documentWidth > 0 ? window.innerWidth - documentWidth : 0;

    if (scrollbarWidth > 0) {
      const currentPaddingRight: number =
        Number.parseFloat(
          window.getComputedStyle(document.body).paddingRight,
        ) || 0;
      document.body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
    }
  }

  openModalCount += 1;
  document.body.style.overflow = "hidden";
};

const unlockBodyScroll: () => void = (): void => {
  openModalCount = Math.max(0, openModalCount - 1);

  if (openModalCount === 0) {
    document.body.style.overflow = bodyOverflowBeforeFirstModal;
    document.body.style.paddingRight = bodyPaddingRightBeforeFirstModal;
  }
};

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
  const modalRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const modalBodyScrollRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const ownsTopmostRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const previouslyFocusedElementRef: React.MutableRefObject<HTMLElement | null> =
    useRef<HTMLElement | null>(null);
  const modalId: string = useId();
  const modalStackDepth: number = useModalStackDepth();
  const titleId: string = `modal-title-${modalId}`;
  const descriptionId: string = `modal-description-${modalId}`;
  const modalStackValue: ModalStackValue = useMemo((): ModalStackValue => {
    return {
      depth: modalStackDepth + 1,
      ownerId: modalId,
    };
  }, [modalId, modalStackDepth]);

  useEffect(() => {
    const modal: HTMLDivElement | null = modalRef.current;

    if (!modal) {
      return;
    }

    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    modalOwnershipRefs.set(modal, ownsTopmostRef);
    lockBodyScroll();

    if (getTopmostModal() === modal) {
      getPreferredModalFocus(modal).focus();
    }
    syncModalAccessibility();

    return () => {
      const wasTopmost: boolean = ownsTopmostRef.current;
      modalOwnershipRefs.delete(modal);
      unlockBodyScroll();

      window.setTimeout((): void => {
        syncModalAccessibility();
        const remainingTopmostModal: HTMLElement | null = getTopmostModal();
        const previouslyFocusedElement: HTMLElement | null =
          previouslyFocusedElementRef.current;

        if (!wasTopmost) {
          if (!remainingTopmostModal && previouslyFocusedElement?.isConnected) {
            previouslyFocusedElement.focus();
          }
          return;
        }

        if (
          previouslyFocusedElement?.isConnected &&
          (!remainingTopmostModal ||
            elementBelongsToModal(
              remainingTopmostModal,
              previouslyFocusedElement,
            ))
        ) {
          previouslyFocusedElement.focus();
          return;
        }

        if (remainingTopmostModal) {
          getPreferredModalFocus(remainingTopmostModal).focus();
        }
      }, 0);
    };
  }, []);

  useEffect((): void => {
    if (props.error && modalBodyScrollRef.current) {
      modalBodyScrollRef.current.scrollTop = 0;
    }
  }, [props.error]);

  const handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onClose?.();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    /*
     * React events continue through portal boundaries. Keep a nested dialog's
     * focus loop from being handled again by its parent dialog.
     */
    event.stopPropagation();

    const modal: HTMLDivElement | null = modalRef.current;
    if (!modal) {
      return;
    }

    const focusableElements: Array<HTMLElement> =
      getModalFocusableElements(modal);

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
        !elementBelongsToModal(modal, activeElement))
    ) {
      event.preventDefault();
      lastFocusableElement.focus();
      return;
    }

    if (
      !event.shiftKey &&
      (activeElement === lastFocusableElement ||
        !elementBelongsToModal(modal, activeElement))
    ) {
      event.preventDefault();
      firstFocusableElement.focus();
    }
  };

  let iconBackgroundClassName: string = "bg-indigo-50 ring-indigo-100";
  let iconClassName: string = "text-indigo-600";

  if (props.iconType === IconType.Warning) {
    iconBackgroundClassName = "bg-amber-50 ring-amber-100";
    iconClassName = "text-amber-600";
  } else if (props.iconType === IconType.Success) {
    iconBackgroundClassName = "bg-emerald-50 ring-emerald-100";
    iconClassName = "text-emerald-600";
  } else if (props.iconType === IconType.Danger) {
    iconBackgroundClassName = "bg-rose-50 ring-rose-100";
    iconClassName = "text-rose-600";
  }

  let modalWidthClassName: string = "sm:max-w-lg md:max-w-lg";
  if (props.modalWidth === ModalWidth.Medium) {
    modalWidthClassName = "sm:max-w-3xl md:max-w-3xl";
  } else if (props.modalWidth === ModalWidth.Large) {
    modalWidthClassName = "sm:max-w-7xl md:max-w-7xl";
  }

  const hasFooter: boolean = Boolean(
    props.onSubmit || props.onClose || props.leftFooterElement,
  );
  const modalZIndex: number = 60 + modalStackDepth * 20;

  const modalElement: ReactElement = (
    <div
      className="fixed inset-0"
      style={{ zIndex: modalZIndex }}
      onKeyDown={handleKeyDown}
      data-testid="modal-layer"
    >
      <div className="absolute inset-0 bg-slate-950/35" aria-hidden="true" />

      <div className="absolute inset-0 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full items-end justify-center pt-3 text-left sm:items-center sm:p-6">
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={
              props.ariaDescribedBy ||
              (translatedDescription ? descriptionId : undefined)
            }
            tabIndex={-1}
            className={`relative flex w-full max-h-[calc(100dvh-0.75rem)] flex-col overflow-hidden rounded-t-2xl border border-slate-200/90 bg-white text-left shadow-[0_24px_80px_-24px_rgba(15,23,42,0.38),0_8px_24px_-12px_rgba(15,23,42,0.18)] ring-1 ring-slate-950/5 sm:max-h-[calc(100dvh-3rem)] sm:rounded-xl ${modalWidthClassName}`}
            data-testid="modal"
            data-modal-stack-depth={modalStackDepth}
            data-modal-owner-id={modalId}
          >
            <div className="shrink-0 border-b border-slate-200/80 bg-white px-5 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                {props.icon && (
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${iconBackgroundClassName}`}
                    data-testid="icon"
                  >
                    <Icon
                      thick={ThickProp.Thick}
                      type={props.iconType || IconType.Info}
                      className={`h-4 w-4 stroke-2 ${iconClassName}`}
                      icon={props.icon}
                      size={SizeProp.Regular}
                    />
                  </div>
                )}

                <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <h3
                      data-testid="modal-title"
                      className="break-words text-base font-semibold leading-6 tracking-tight text-slate-950"
                      id={titleId}
                    >
                      {translatedTitle}
                    </h3>
                    {translatedDescription && (
                      <p
                        id={descriptionId}
                        data-testid="modal-description"
                        className="mt-1 break-words text-sm leading-5 text-slate-500"
                      >
                        {translatedDescription}
                      </p>
                    )}
                  </div>

                  {props.rightElement && (
                    <div
                      data-testid="right-element"
                      className="shrink-0 self-start"
                    >
                      {props.rightElement}
                    </div>
                  )}
                </div>

                {props.onClose && (
                  <Button
                    buttonStyle={ButtonStyleType.ICON}
                    buttonSize={ButtonSize.ExtraSmall}
                    icon={IconProp.Close}
                    iconSize={SizeProp.Regular}
                    title="Close"
                    dataTestId="close-button"
                    className="!m-0 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:h-8 sm:w-8"
                    onClick={props.onClose}
                  />
                )}
              </div>
            </div>

            <div
              ref={modalBodyScrollRef}
              data-testid="modal-scroll-region"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6"
            >
              <ModalBody error={props.error}>
                {!props.isBodyLoading ? (
                  props.children
                ) : (
                  <div className="flex min-h-48 items-center justify-center py-8">
                    <Loader
                      loaderType={LoaderType.Bar}
                      color={VeryLightGray}
                      size={200}
                    />
                  </div>
                )}
              </ModalBody>
            </div>

            {hasFooter && (
              <ModalFooter
                submitButtonType={props.submitButtonType || ButtonType.Button}
                submitButtonStyleType={
                  props.submitButtonStyleType || ButtonStyleType.PRIMARY
                }
                closeButtonStyleType={
                  props.closeButtonStyleType || ButtonStyleType.NORMAL
                }
                submitButtonText={
                  translatedSubmitButtonText ||
                  translateString("Save") ||
                  "Save"
                }
                closeButtonText={
                  translatedCloseButtonText ||
                  translateString("Cancel") ||
                  "Cancel"
                }
                onSubmit={props.onSubmit}
                onClose={props.onClose}
                isLoading={props.isLoading || false}
                disableSubmitButton={
                  props.isBodyLoading || props.disableSubmitButton
                }
                leftFooterElement={props.leftFooterElement}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const modalWithStackContext: ReactElement = (
    <ModalStackContext.Provider value={modalStackValue}>
      {modalElement}
    </ModalStackContext.Provider>
  );

  if (typeof document === "undefined") {
    return modalWithStackContext;
  }

  return createPortal(modalWithStackContext, document.body);
};

export default Modal;
