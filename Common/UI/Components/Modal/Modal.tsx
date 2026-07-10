import { ButtonStyleType } from "../Button/Button";
import ButtonType from "../Button/ButtonTypes";
import Icon, { IconType, SizeProp, ThickProp } from "../Icon/Icon";
import Loader, { LoaderType } from "../Loader/Loader";
import ModalBody from "./ModalBody";
import ModalFooter from "./ModalFooter";
import { VeryLightGray } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
} from "react";

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
  const titleId: string = useId();
  const descriptionId: string = useId();

  useEffect(() => {
    onCloseRef.current = props.onClose;
  }, [props.onClose]);

  useEffect(() => {
    const modal: HTMLDivElement | null = modalRef.current;
    if (!modal) {
      return;
    }

    const getFocusableElements: () => Array<HTMLElement> =
      (): Array<HTMLElement> => {
        return Array.from(
          modal.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element: HTMLElement) => {
          return (
            !element.hasAttribute("disabled") &&
            element.getAttribute("aria-hidden") !== "true"
          );
        });
      };

    const isTopmostDialog: () => boolean = (): boolean => {
      const openDialogs: Array<Element> = Array.from(
        document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
      );

      return openDialogs[openDialogs.length - 1] === modal;
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
  }, []);

  let iconBgColor: string = "bg-indigo-50";
  let iconColor: string = "text-indigo-600";
  let iconRingColor: string = "ring-indigo-100";

  if (props.iconType === IconType.Info) {
    iconBgColor = "bg-indigo-50";
    iconColor = "text-indigo-600";
    iconRingColor = "ring-indigo-100";
  } else if (props.iconType === IconType.Warning) {
    iconBgColor = "bg-yellow-50";
    iconColor = "text-yellow-700";
    iconRingColor = "ring-yellow-100";
  } else if (props.iconType === IconType.Success) {
    iconBgColor = "bg-green-50";
    iconColor = "text-green-600";
    iconRingColor = "ring-green-100";
  } else if (props.iconType === IconType.Danger) {
    iconBgColor = "bg-red-50";
    iconColor = "text-red-600";
    iconRingColor = "ring-red-100";
  }

  let modalWidthClassName: string = "sm:max-w-lg md:max-w-lg";

  if (props.modalWidth === ModalWidth.Medium) {
    modalWidthClassName = "sm:max-w-3xl md:max-w-3xl";
  } else if (props.modalWidth === ModalWidth.Large) {
    modalWidthClassName = "sm:max-w-7xl md:max-w-7xl";
  }

  return (
    <div className="relative z-50">
      <div
        className="fixed inset-0 bg-gray-950/45 backdrop-blur-[2px]"
        data-testid="modal-backdrop"
        aria-hidden="true"
      />

      <div className="fixed inset-0 z-50 overflow-y-auto">
        <div className="flex min-h-full items-end justify-center p-0 text-center sm:items-center sm:p-6">
          <div
            ref={modalRef}
            className={`relative flex max-h-[calc(100vh-1rem)] w-full flex-col rounded-t-2xl border border-gray-200/80 bg-white text-left shadow-2xl ring-1 ring-black/5 sm:my-8 sm:max-h-[calc(100vh-3rem)] sm:rounded-xl ${modalWidthClassName}`}
            data-testid="modal"
            aria-labelledby={titleId}
            aria-describedby={translatedDescription ? descriptionId : undefined}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
          >
            <div className="relative flex shrink-0 flex-col gap-4 rounded-t-2xl border-b border-gray-100 bg-white px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:rounded-t-xl sm:px-6">
              <div
                className={`flex min-w-0 flex-1 items-start gap-3 ${
                  props.onClose ? "pr-9 sm:pr-0" : ""
                }`}
              >
                {props.icon && (
                  <div
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${iconBgColor} ring-1 ring-inset ${iconRingColor}`}
                    data-testid="icon"
                  >
                    <Icon
                      thick={ThickProp.Thick}
                      type={
                        props.iconType === undefined
                          ? IconType.Info
                          : props.iconType
                      }
                      className={`${iconColor} h-5 w-5`}
                      icon={props.icon}
                      size={SizeProp.Five}
                    />
                  </div>
                )}
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
              </div>
              {props.rightElement && (
                <div
                  data-testid="right-element"
                  className={`flex-shrink-0 ${props.onClose ? "pr-9" : ""}`}
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
                  className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  <Icon icon={IconProp.Close} className="h-4 w-4" />
                </button>
              )}
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6"
              data-testid="modal-content"
            >
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
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Modal;
