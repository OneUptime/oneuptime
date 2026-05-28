import Icon, { ThickProp } from "../Icon/Icon";
import MarkdownViewer from "../Markdown.tsx/LazyMarkdownViewer";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  title?: string | ReactElement | undefined;
  description?: string | undefined;
  onClose?: undefined | (() => void);
  onClick?: (() => void) | undefined;
  onOpen?: undefined | (() => void);
  children: ReactElement | Array<ReactElement>;
  rightElement?: ReactElement | undefined;
  isLastElement?: boolean | undefined;
  isInitiallyExpanded?: boolean | undefined;
  titleClassName?: string | undefined;
}

const Accordion: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  useEffect(() => {
    if (props.isInitiallyExpanded) {
      setIsOpen(true);
    }
  }, [props.isInitiallyExpanded]);

  useEffect(() => {
    if (!props.title) {
      setIsOpen(true);
    } else if (!props.isInitiallyExpanded) {
      setIsOpen(false);
    }
  }, [props.title]);

  useEffect(() => {
    if (props.onClick) {
      props.onClick();
    }

    if (isOpen && props.onOpen) {
      props.onOpen();
    }

    if (!isOpen && props.onClose) {
      props.onClose();
    }
  }, [isOpen]);

  let className: string = "border-gray-100 border-b-2 -ml-5 -mr-5 p-5 mt-1";

  if (props.isLastElement) {
    className = "-ml-5 -mr-5 p-5 mt-1";
  }

  const accordionId: string = `accordion-content-${React.useId()}`;

  const handleKeyDown: (event: React.KeyboardEvent) => void = (
    event: React.KeyboardEvent,
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setIsOpen(!isOpen);
    }
  };

  return (
    <div className={className}>
      <div>
        <div
          className={`flex justify-between items-start gap-3 cursor-pointer group/accordion-header rounded-md -mx-2 px-2 py-1 hover:bg-gray-50 transition-colors`}
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
          aria-controls={accordionId}
          onClick={() => {
            setIsOpen(!isOpen);
          }}
          onKeyDown={handleKeyDown}
        >
          <div className="flex items-start min-w-0 flex-1">
            {props.title && (
              <div className="flex-shrink-0 pt-1.5">
                {isOpen && (
                  <Icon
                    className="h-4 w-4 text-gray-400 group-hover/accordion-header:text-gray-600 transition-colors"
                    icon={IconProp.ChevronDown}
                    thick={ThickProp.Thick}
                  />
                )}
                {!isOpen && (
                  <Icon
                    className="h-4 w-4 text-gray-400 group-hover/accordion-header:text-gray-600 transition-colors"
                    icon={IconProp.ChevronRight}
                    thick={ThickProp.Thick}
                  />
                )}
              </div>
            )}
            {props.title && (
              <div
                className={`ml-2 min-w-0 flex-1 ${
                  props.onClick ? "cursor-pointer" : ""
                }`}
              >
                <div
                  className={`text-gray-900 leading-snug ${props.titleClassName || ""}`}
                >
                  {props.title}
                </div>
                {props.description && (
                  <div className="mt-1 text-sm text-gray-500 leading-relaxed">
                    <MarkdownViewer text={props.description} />
                  </div>
                )}
              </div>
            )}
          </div>
          {!isOpen && props.rightElement && (
            <div className="flex-shrink-0 pt-1">{props.rightElement}</div>
          )}
        </div>
        {isOpen && (
          <div
            id={accordionId}
            className={`space-y-5 ${props.title ? "mt-4" : ""}`}
          >
            {props.children}
          </div>
        )}
      </div>
    </div>
  );
};

export default Accordion;
