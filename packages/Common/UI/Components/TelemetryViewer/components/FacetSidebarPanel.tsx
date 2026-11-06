import FacetSidebarResizeHandle from "./FacetSidebarResizeHandle";
import {
  FACET_SIDEBAR_WIDTH_CLASS_NAME,
  getFacetSidebarWidthStyle,
} from "../FacetSidebarWidth";
import useFacetSidebarWidth, {
  UseFacetSidebarWidthResult,
} from "../useFacetSidebarWidth";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
  useRef,
} from "react";

/*
 * The filters sidebar's card, as wide as the person reading it made it -
 * the one card both sidebars draw their filters in: the Logs one
 * (LogsFacetSidebar) and the Traces / Metrics / Exceptions / Security
 * Events one (TelemetryFacetSidebar).
 *
 * Below md it stacks above the list at full width, at most 20rem tall so
 * it cannot bury the list; when the explorer folds it there
 * (isCollapsedOnSmallScreens), it shows only once the explorer's Filters
 * toggle opens it. The fold is CSS only, so the sidebar stays mounted and
 * keeps its search and expand state. From md up it always shows, beside the
 * list, as wide as the person made it (FacetSidebarWidth) - and its edge,
 * drawn right after it in the row, sizes it (FacetSidebarResizeHandle).
 *
 * The edge is the card's next sibling, in the gap between the card and the
 * list: the row the card stands in is the explorer's facets + list area
 * (TelemetryViewer, LogsViewer), a flex row from md up with a 12px gap
 * (gap-3) the edge is drawn over.
 */

export interface ComponentProps {
  // Lets a disclosure toggle point at the card with aria-controls.
  id?: string | undefined;
  isCollapsedOnSmallScreens?: boolean | undefined;
  children: ReactNode;
}

export const getFacetSidebarPanelClassName: (
  isCollapsedOnSmallScreens: boolean | undefined,
) => string = (isCollapsedOnSmallScreens: boolean | undefined): string => {
  return `${
    isCollapsedOnSmallScreens ? "max-md:hidden md:flex" : "flex"
  } max-h-80 w-full flex-none flex-col overflow-y-auto rounded-lg border border-gray-200 bg-white md:h-full md:max-h-none ${FACET_SIDEBAR_WIDTH_CLASS_NAME}`;
};

const FacetSidebarPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const panelRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const ownId: string = useId();
  const panelId: string = props.id || ownId;
  const sidebarWidth: UseFacetSidebarWidthResult = useFacetSidebarWidth();

  return (
    <>
      <div
        ref={panelRef}
        id={panelId}
        className={getFacetSidebarPanelClassName(
          props.isCollapsedOnSmallScreens,
        )}
        style={
          getFacetSidebarWidthStyle(sidebarWidth.width) as
            | React.CSSProperties
            | undefined
        }
      >
        {props.children}
      </div>
      <FacetSidebarResizeHandle
        panelRef={panelRef}
        panelId={panelId}
        width={sidebarWidth.width}
        onWidthChange={sidebarWidth.setWidth}
      />
    </>
  );
};

export default FacetSidebarPanel;
