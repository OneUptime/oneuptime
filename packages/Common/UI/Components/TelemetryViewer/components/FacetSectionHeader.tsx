import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";

export interface FacetSectionHeaderProps {
  title: string;
  // Optional icon before the title (e.g. a resource brand icon).
  icon?: IconProp | undefined;
  // Selected values in this facet, shown as a badge when non-zero.
  activeCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  // Id of the section body this header shows and hides.
  controlsId?: string | undefined;
}

/*
 * The collapsible header every facet section shares, in both the Logs and the
 * Telemetry sidebars: icon, title, active-count badge and one chevron that
 * turns as the section opens.
 */
const FacetSectionHeader: FunctionComponent<FacetSectionHeaderProps> = (
  props: FacetSectionHeaderProps,
): ReactElement => {
  return (
    <div className="px-1">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-gray-50"
        aria-expanded={props.isExpanded}
        aria-controls={props.isExpanded ? props.controlsId : undefined}
        onClick={props.onToggle}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {props.icon && (
            <span
              className="flex flex-none items-center"
              data-testid="facet-section-icon"
              data-icon={props.icon}
            >
              <Icon icon={props.icon} className="h-3.5 w-3.5 text-gray-400" />
            </span>
          )}
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {props.title}
          </span>
          {props.activeCount > 0 && (
            <span className="inline-flex h-4 min-w-[1rem] flex-none items-center justify-center rounded-full bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-600">
              {props.activeCount}
            </span>
          )}
        </div>
        <span
          className={`flex flex-none items-center transition-transform duration-150 ${
            props.isExpanded ? "rotate-90" : ""
          }`}
          data-testid="facet-section-chevron"
        >
          <Icon
            icon={IconProp.ChevronRight}
            className="h-3 w-3 text-gray-400"
          />
        </span>
      </button>
    </div>
  );
};

export default FacetSectionHeader;
