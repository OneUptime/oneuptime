import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { ReactElement, ReactNode, useId, useState } from "react";

export interface ComponentProps {
  title: string;
  description?: string | ReactElement | undefined;
  badge?: string | ReactElement | undefined;
  children: ReactNode;
  defaultCollapsed?: boolean | undefined;
  isCollapsed?: boolean | undefined;
  onToggle?: ((isCollapsed: boolean) => void) | undefined;
  variant?: "default" | "card" | "bordered" | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
  headerClassName?: string | undefined;
  rightElement?: ReactElement | undefined;
}

/*
 * Keep editors mounted so collapsing a section preserves drafts, while hidden
 * removes its controls from keyboard navigation and the accessibility tree.
 */
export default function MonitorFormSection(
  props: ComponentProps,
): ReactElement {
  const [collapsed, setCollapsed] = useState<boolean>(
    props.defaultCollapsed ?? true,
  );
  const isCollapsed: boolean = props.isCollapsed ?? collapsed;
  const contentId: string = useId();
  const isCard: boolean = props.variant === "card";

  return (
    <div
      className={`min-w-0 ${isCard ? "rounded-lg border border-gray-200 bg-gray-50/50" : props.variant === "bordered" ? "border-t border-gray-200 pt-1" : ""} ${props.className || ""}`}
    >
      <div className={`flex items-center gap-3 ${props.headerClassName || ""}`}>
        <button
          type="button"
          aria-label={props.title}
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
          onClick={() => {
            setCollapsed(!isCollapsed);
            props.onToggle?.(!isCollapsed);
          }}
          className={`flex ${props.compact ? "min-h-[28px] py-1" : "min-h-[40px] py-2"} min-w-0 flex-1 items-center gap-2 rounded-lg ${isCard ? "px-3" : ""} text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 hover:bg-gray-50`}
        >
          <Icon
            icon={isCollapsed ? IconProp.ChevronRight : IconProp.ChevronDown}
            className={`${props.compact ? "h-3.5 w-3.5" : "h-4 w-4"} shrink-0 text-gray-500`}
          />
          <span className="min-w-0 flex-1">
            <span
              className={`block ${props.compact ? "text-xs" : "text-sm"} font-medium text-gray-900`}
            >
              {props.title}
            </span>
            {props.description && (
              <span
                className={`mt-0.5 text-xs text-gray-500 ${isCollapsed ? "hidden sm:block" : "block"}`}
              >
                {props.description}
              </span>
            )}
          </span>
          {props.badge && (
            <span className="max-w-[40%] shrink-0 rounded-md bg-indigo-50 px-2 py-0.5 text-right text-xs font-medium text-indigo-700">
              {props.badge}
            </span>
          )}
        </button>
        {props.rightElement && (
          <div className={isCard ? "pr-3" : ""}>{props.rightElement}</div>
        )}
      </div>
      <div id={contentId} hidden={isCollapsed}>
        <div
          className={
            isCard ? "border-t border-gray-200 p-3 sm:p-4" : "pb-2 pt-2"
          }
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
