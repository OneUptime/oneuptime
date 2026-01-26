import Button, { ButtonStyleType } from "../Button/Button";
import ButtonType from "../Button/ButtonTypes";
import Icon, { IconType, SizeProp, ThickProp } from "../Icon/Icon";
import Loader, { LoaderType } from "../Loader/Loader";
import ModalBody from "./ModalBody";
import ModalFooter from "./ModalFooter";
import { VeryLightGray } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
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
}

const Modal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const modalRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleEscapeKey: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape" && props.onClose) {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleEscapeKey);
    return () => {
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [props.onClose]);

  // Focus trap and initial focus
  useEffect(() => {
    const modal: HTMLDivElement | null = modalRef.current;
    if (modal) {
      // Focus the first focusable element in the modal, excluding the close button
      const focusableElements: NodeListOf<Element> = modal.querySelectorAll(
        'button:not([data-testid="close-button"]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const firstFocusable: HTMLElement | undefined = focusableElements[0] as
        | HTMLElement
        | undefined;
      if (firstFocusable) {
        firstFocusable.focus();
      }
    }
  }, []);

  let iconBgColor: string = "bg-indigo-100";
  let iconColor: string = "text-indigo-600";

  if (props.iconType === IconType.Info) {
    iconBgColor = "bg-indigo-100";
    iconColor = "text-indigo-600";
  } else if (props.iconType === IconType.Warning) {
    iconBgColor = "bg-yellow-100";
    iconColor = "text-yellow-600";
  } else if (props.iconType === IconType.Success) {
    iconBgColor = "bg-green-100";
    iconColor = "text-green-600";
  } else if (props.iconType === IconType.Danger) {
    iconBgColor = "bg-red-100";
    iconColor = "text-red-600";
  }

  return (
    <div
      ref={modalRef}
      className="relative z-20"
      aria-labelledby="modal-title"
      aria-describedby={props.description ? "modal-description" : undefined}
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

      <div className="fixed inset-0 z-20 overflow-y-auto">
        <div className="flex min-h-screen items-end justify-center p-0 text-center md:items-center md:p-4">
          <div
            className={`relative transform bg-white text-left shadow-xl transition-all w-full h-full md:rounded-lg md:my-8 ${
              props.modalWidth && props.modalWidth === ModalWidth.Large
                ? "md:max-w-7xl"
                : ""
            } ${
              props.modalWidth && props.modalWidth === ModalWidth.Medium
                ? "md:max-w-3xl"
                : ""
            } ${!props.modalWidth ? "md:max-w-lg" : ""} `}
            data-testid="modal"
          >
            {props.onClose && (
              <div className="absolute top-0 right-0 z-10 pt-4 pr-4 md:hidden lg:block">
                <Button
                  buttonStyle={ButtonStyleType.ICON}
                  icon={IconProp.Close}
                  iconSize={SizeProp.Large}
                  title="Close"
                  dataTestId="close-button"
                  onClick={props.onClose}
                />
              </div>
            )}
            <div className="p-4 md:p-6">
              {props.icon && (
                <div
                  className={`mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${iconBgColor} md:mx-0 md:h-10 md:w-10`}
                  data-testid="icon"
                >
                  <Icon
                    thick={ThickProp.Thick}
                    type={
                      props.iconType === undefined
                        ? IconType.Info
                        : props.iconType
                    }
                    className={`${iconColor} h-6 w-6 stroke-2`}
                    icon={props.icon}
                    size={SizeProp.Large}
                  />
                </div>
              )}
              <div className="text-left md:mt-0 md:ml-4 md:mr-4">
                <div className="flex flex-col md:flex-row md:justify-between">
                  <div className="flex-1">
                    <h3
                      data-testid="modal-title"
                      className={`text-lg font-medium leading-6 text-gray-900 ${
                        props.icon ? "mt-4 md:ml-10 md:-mt-8 md:mb-5" : ""
                      }`}
                      id="modal-title"
                    >
                      {props.title}
                    </h3>
                    {props.description && (
                      <p
                        id="modal-description"
                        data-testid="modal-description"
                        className="text-sm leading-6 text-gray-500 mt-2"
                      >
                        {props.description}
                      </p>
                    )}
                  </div>
                  {props.rightElement && (
                    <div data-testid="right-element" className="mt-4 md:mt-0">
                      {props.rightElement}
                    </div>
                  )}
                </div>
                <div className="mt-2">
                  <ModalBody error={props.error}>
                    {!props.isBodyLoading ? (
                      props.children
                    ) : (
                      <div className="modal-body mt-20 mb-20 flex justify-center">
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
                props.submitButtonText ? props.submitButtonText : "Save"
              }
              closeButtonText={
                props.closeButtonText ? props.closeButtonText : "Cancel"
              }
              onSubmit={props.onSubmit}
              onClose={props.onClose ? props.onClose : undefined}
              isLoading={props.isLoading || false}
              disableSubmitButton={
                props.isBodyLoading || props.disableSubmitButton
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Modal;
