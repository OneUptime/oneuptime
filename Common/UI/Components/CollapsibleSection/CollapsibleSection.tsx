import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export type CollapsibleSectionVariant = "default" | "card" | "bordered";

export interface ComponentProps {
  title: string;
  description?: string | ReactElement | undefined;
  children: ReactElement;
  isCollapsed?: boolean | undefined;
  onToggle?: ((isCollapsed: boolean) => void) | undefined;
  badge?: string | ReactElement | undefined;
  rightElement?: ReactElement | undefined;
  className?: string | undefined;
  headerClassName?: string | undefined;
  variant?: CollapsibleSectionVariant | undefined;
  defaultCollapsed?: boolean | undefined;
}

const CollapsibleSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    props.defaultCollapsed ?? props.isCollapsed ?? false,
  );

  useEffect(() => {
    if (props.isCollapsed !== undefined) {
      setIsCollapsed(props.isCollapsed);
    }
  }, [props.isCollapsed]);

  const handleToggle: () => void = (): void => {
    const newCollapsedState: boolean = !isCollapsed;
    setIsCollapsed(newCollapsedState);
    if (props.onToggle) {
      props.onToggle(newCollapsedState);
    }
  };

  const variant: CollapsibleSectionVariant = props.variant || "default";

  const getContainerClassName: () => string = (): string => {
    const baseClassName: string = props.className || "";

    switch (variant) {
      case "card":
        return `bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden ${baseClassName}`;
      case "bordered":
        return `border border-gray-200 rounded-lg overflow-hidden ${baseClassName}`;
      default:
        return baseClassName;
    }
  };

  const getHeaderClassName: () => string = (): string => {
    const baseHeaderClassName: string = props.headerClassName || "";

    switch (variant) {
      case "card":
        return `px-4 py-3 bg-gray-50 ${baseHeaderClassName}`;
      case "bordered":
        return `px-4 py-3 bg-gray-50 ${baseHeaderClassName}`;
      default:
        return `py-2 ${baseHeaderClassName}`;
    }
  };

  const getContentClassName: () => string = (): string => {
    switch (variant) {
      case "card":
        return "px-4 py-3";
      case "bordered":
        return "px-4 py-3";
      default:
        return "py-2";
    }
  };

  return (
    <div className={getContainerClassName()}>
      <div
        className={`flex items-center justify-between cursor-pointer select-none ${getHeaderClassName()}`}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggle();
          }
        }}
        aria-expanded={!isCollapsed}
      >
        <div className="flex items-center flex-1 min-w-0">
          <Icon
            icon={isCollapsed ? IconProp.ChevronRight : IconProp.ChevronDown}
            className="w-4 h-4 text-gray-500 mr-2 flex-shrink-0 transition-transform duration-200"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center">
              <span className="text-sm font-medium text-gray-900 truncate">
                {props.title}
              </span>
              {isCollapsed && props.badge && (
                <span className="ml-2 flex-shrink-0">
                  {typeof props.badge === "string" ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                      {props.badge}
                    </span>
                  ) : (
                    props.badge
                  )}
                </span>
              )}
            </div>
            {props.description && !isCollapsed && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                {props.description}
              </p>
            )}
          </div>
        </div>
        {props.rightElement && (
          <div
            className="ml-2 flex-shrink-0"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
            }}
          >
            {props.rightElement}
          </div>
        )}
      </div>

      <div
        className={`transition-all duration-200 ease-in-out overflow-hidden ${
          isCollapsed ? "max-h-0 opacity-0" : "max-h-[5000px] opacity-100"
        }`}
      >
        <div className={getContentClassName()}>{props.children}</div>
      </div>
    </div>
  );
};

export default CollapsibleSection;
