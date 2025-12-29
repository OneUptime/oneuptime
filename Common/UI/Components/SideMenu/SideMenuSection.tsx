import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  title: string;
  children: ReactElement | Array<ReactElement>;
  defaultCollapsed?: boolean;
  collapsible?: boolean;
  icon?: IconProp;
}

const SideMenuSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    props.defaultCollapsed || false,
  );

  const isCollapsible: boolean = props.collapsible ?? true;

  const handleToggle: () => void = (): void => {
    if (isCollapsible) {
      setIsCollapsed(!isCollapsed);
    }
  };

  return (
    <div className="mb-2">
      {/* Section Header */}
      <button
        type="button"
        onClick={handleToggle}
        className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg transition-colors duration-150 ${
          isCollapsible ? "hover:bg-gray-50 cursor-pointer" : "cursor-default"
        }`}
        aria-expanded={!isCollapsed}
      >
        <div className="flex items-center gap-2">
          {props.icon && (
            <Icon icon={props.icon} className="h-4 w-4 text-gray-400" />
          )}
          <h6 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            {props.title}
          </h6>
        </div>
        {isCollapsible && (
          <Icon
            icon={IconProp.ChevronDown}
            className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${
              isCollapsed ? "-rotate-90" : "rotate-0"
            }`}
          />
        )}
      </button>

      {/* Section Content with Animation */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          isCollapsed ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100"
        }`}
      >
        <div className="mt-0.5 space-y-0">{props.children}</div>
      </div>
    </div>
  );
};

export default SideMenuSection;
