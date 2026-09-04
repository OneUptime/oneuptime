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

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white ${props.variant === "card" ? "shadow-sm" : ""} ${props.className || ""}`}
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
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 hover:bg-gray-50"
        >
          <Icon
            icon={isCollapsed ? IconProp.ChevronRight : IconProp.ChevronDown}
            className="h-4 w-4 shrink-0 text-gray-400"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-gray-900">
              {props.title}
            </span>
            {props.description && (
              <span className="mt-0.5 block text-xs text-gray-500">
                {props.description}
              </span>
            )}
          </span>
          {props.badge && (
            <span className="max-w-[45%] shrink-0 rounded-lg bg-indigo-50 px-2 py-1 text-right text-xs font-medium text-indigo-700">
              {props.badge}
            </span>
          )}
        </button>
        {props.rightElement && <div className="pr-4">{props.rightElement}</div>}
      </div>
      <div id={contentId} hidden={isCollapsed}>
        <div className="border-t border-gray-100 p-4 sm:p-5">
          {props.children}
        </div>
      </div>
    </div>
  );
}
