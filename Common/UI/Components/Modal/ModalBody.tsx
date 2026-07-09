import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: Array<ReactElement> | ReactElement;
  error?: string | undefined;
}

const ModalBody: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  return (
    <div className="modal-body">
      {props.error && (
        <div
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm leading-5 text-rose-700"
          role="alert"
          aria-live="polite"
          tabIndex={-1}
          data-testid="modal-error"
        >
          <Icon
            icon={IconProp.ErrorSolid}
            className="mt-0.5 h-4 w-4 shrink-0 text-rose-500"
          />
          <span>{translateString(props.error) || props.error}</span>
        </div>
      )}
      {props.children}
    </div>
  );
};

export default ModalBody;
