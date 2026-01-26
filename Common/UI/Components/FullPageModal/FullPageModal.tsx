import Icon, { SizeProp, ThickProp } from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onClose: () => void;
  children: ReactElement | Array<ReactElement>;
}

const FullPageModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const handleClose = (): void => {
    props.onClose?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " " || event.key === "Escape") {
      event.preventDefault();
      handleClose();
    }
  };

  return (
    <div className="full-page-modal" role="dialog" aria-modal="true">
      <div
        className="margin-50 align-right"
        onClick={handleClose}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-label="Close modal"
      >
        <Icon
          icon={IconProp.Close}
          size={SizeProp.ExtraLarge}
          thick={ThickProp.Thick}
        />
      </div>
      <div className="margin-50">{props.children}</div>
    </div>
  );
};

export default FullPageModal;
