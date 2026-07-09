import { ButtonStyleType } from "../Button/Button";
import ButtonType from "../Button/ButtonTypes";
import BasicForm, {
  BaseComponentProps as BasicFormComponentProps,
} from "../Forms/BasicForm";
import Modal from "../Modal/Modal";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement, useEffect, useRef, useState } from "react";

export interface ComponentProps<T extends GenericObject> {
  title: string;
  isLoading?: boolean | undefined;
  error?: string | undefined;
  onClose?: undefined | (() => void);
  submitButtonText?: undefined | string;
  onSubmit?: undefined | ((data: T) => void);
  submitButtonStyleType?: undefined | ButtonStyleType;
  formProps: BasicFormComponentProps<T>;
  description?: string | undefined;
}

const BasicFormModal: <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(props.isLoading));
  const formRef: any = useRef<any>(null);

  useEffect(() => {
    setIsLoading(Boolean(props.isLoading));
  }, [props.isLoading]);

  return (
    <Modal
      {...props}
      submitButtonType={ButtonType.Submit}
      isLoading={isLoading}
      isBodyLoading={Boolean(props.isLoading)}
      onSubmit={() => {
        formRef.current?.submitForm();
      }}
    >
      <BasicForm
        {...props.formProps}
        hideSubmitButton={true}
        ref={formRef}
        onLoadingChange={(isFormLoading: boolean) => {
          setIsLoading(isFormLoading);
        }}
        onSubmit={(data: T) => {
          props.onSubmit?.(data);
        }}
      />
    </Modal>
  );
};

export default BasicFormModal;
