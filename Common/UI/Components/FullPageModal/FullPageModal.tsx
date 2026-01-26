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
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleClose();
    }
  };

  // Handle Escape key at the modal level
  React.useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("keydown", handleEscapeKey);
    return () => {
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, []);

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
