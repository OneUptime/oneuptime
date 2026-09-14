import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  formatEmptyFacetCount,
  formatHiddenFacetCount,
} from "../FacetVisibility";

export interface HiddenFacetsFooterProps {
  // Empty resource facets the sidebar folded away.
  hiddenCount: number;
  // Their section titles, listed in the tooltip.
  hiddenTitles: ReadonlyArray<string>;
  // Whether the hidden facets are currently revealed.
  isShowingHidden: boolean;
  onToggle: () => void;
  // Id of the facet list the toggle reveals facets in.
  controlsId?: string | undefined;
}

/*
 * The last row of a facet sidebar: "3 empty filters hidden · Show". A project
 * without Podman hosts should not scroll past an empty "Podman Host" section,
 * but the filter must stay discoverable, so it is folded here rather than
 * dropped. Renders nothing when nothing is hidden.
 */
const HiddenFacetsFooter: FunctionComponent<HiddenFacetsFooterProps> = (
  props: HiddenFacetsFooterProps,
): ReactElement | null => {
  if (props.hiddenCount <= 0) {
    return null;
  }

  const hiddenTitlesText: string = props.hiddenTitles.join(", ");

  return (
    <div
      data-testid="facet-sidebar-hidden-footer"
      className="-mt-px flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-[11px] text-gray-400"
    >
      {props.isShowingHidden ? (
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded font-medium text-indigo-500 transition-colors hover:text-indigo-600"
          aria-expanded={true}
          aria-controls={props.controlsId}
          title={hiddenTitlesText}
          onClick={props.onToggle}
        >
          <span className="flex flex-none items-center">
            <Icon icon={IconProp.EyeSlash} className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">Hide empty filters</span>
        </button>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="flex flex-none items-center">
              <Icon
                icon={IconProp.EyeSlash}
                className="h-3.5 w-3.5 text-gray-400"
              />
            </span>
            <span
              className="truncate text-gray-500"
              title={hiddenTitlesText}
              data-testid="facet-sidebar-hidden-count"
            >
              {formatHiddenFacetCount(props.hiddenCount)}
            </span>
          </div>
          <button
            type="button"
            className="flex-none rounded font-medium text-indigo-500 transition-colors hover:text-indigo-600"
            aria-expanded={false}
            aria-controls={props.controlsId}
            aria-label={`Show ${formatEmptyFacetCount(props.hiddenCount)}`}
            onClick={props.onToggle}
          >
            Show
          </button>
        </>
      )}
    </div>
  );
};

export default HiddenFacetsFooter;
