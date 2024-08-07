import React, { FunctionComponent, ReactElement } from "react";

export enum TabType {
  Error = "error",
  Warning = "warning",
  Info = "info",
  Success = "success",
}

export interface Tab {
  name: string;
  countBadge?: number | undefined;
  tabType?: TabType | undefined;
  children: ReactElement;
}

export interface ComponentProps {
  tab: Tab;
  onClick?: () => void;
  isSelected?: boolean;
}

const TabElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const backgroundColor: string = "bg-gray-100";

  return (
    <div className="mt-3 mb-3">
      <div
        data-testid={`tab-${props.tab.name}`}
        key={props.tab.name}
        onClick={props.onClick}
        className={`${
          (props.isSelected
            ? backgroundColor + " text-gray-700"
            : "text-gray-500 hover:text-gray-700") +
          " rounded-md px-3 py-2 text-sm font-medium cursor-pointer flex"
        }`}
        aria-current={props.isSelected ? "page" : undefined}
      >
        <div>{props.tab.name}</div>

        {props.tab.countBadge && props.tab.countBadge > 0 ? (
          <span
            className={`${
              props.tab.tabType === TabType.Error
                ? "bg-red-500"
                : props.tab.tabType === TabType.Warning
                  ? "bg-yellow-500"
                  : props.tab.tabType === TabType.Info
                    ? "bg-indigo-500"
                    : props.tab.tabType === TabType.Success
                      ? "bg-green-500"
                      : "bg-gray-500"
            } text-white rounded-full px-2 py-1 text-xs font-semibold ml-2 -mt-0.5`}
          >
            {props.tab.countBadge}
          </span>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default TabElement;
