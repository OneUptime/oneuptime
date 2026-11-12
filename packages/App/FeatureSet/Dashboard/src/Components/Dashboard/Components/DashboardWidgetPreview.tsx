import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useContext,
} from "react";
import { AppLinkAsTextContext } from "../../AppLink/AppLinkAsText";

/*
 * A WIDGET DRAWN IN ITS SETTINGS' LIVE PREVIEW (issue #6859).
 *
 * The widget settings dialog draws the widget as a reader sees it - out of
 * edit mode, so it looks as it will on the board. The dialog only opens
 * while the board is edited, though, and nothing asks before leaving a
 * board with widgets not saved yet: a click in the preview that went to
 * another page - a list's row, a honeycomb tile, a map's site, Open in
 * Metric Explorer, a funnel's corner link, a link in a text widget - left
 * the dashboard, and the unsaved widgets with it.
 *
 * In the preview a widget draws the same, with nothing in it that leaves
 * the page: a link is its words (AppLink, the text widget's Markdown), a
 * tile, a site or an event marker opens nothing, and what is only there to
 * take the reader elsewhere - Open in Metric Explorer, Investigate, a
 * series' menu, an exemplar's, a funnel's corner link - is left out, as it
 * is while the board is edited. What stays on the page still works: a
 * list's sort, a chart's zoom, a tooltip.
 *
 * DashboardBaseComponentElement draws its widget in the provider below,
 * from its isPreview prop, so every part of a widget reads it however deep
 * it is, and no widget's memo comparator can hold it back.
 */
export const DashboardWidgetPreviewContext: React.Context<boolean> =
  React.createContext<boolean>(false);

export const useIsDashboardWidgetPreview: () => boolean = (): boolean => {
  return useContext(DashboardWidgetPreviewContext);
};

export interface DashboardWidgetPreviewProviderProps {
  isPreview: boolean;
  children: ReactNode;
}

/*
 * The preview, for a widget's own parts, and AppLink's words-only, for
 * every link in it - each of the list widgets' names among them.
 */
export const DashboardWidgetPreviewProvider: FunctionComponent<
  DashboardWidgetPreviewProviderProps
> = (props: DashboardWidgetPreviewProviderProps): ReactElement => {
  return (
    <DashboardWidgetPreviewContext.Provider value={props.isPreview}>
      <AppLinkAsTextContext.Provider value={props.isPreview}>
        {props.children}
      </AppLinkAsTextContext.Provider>
    </DashboardWidgetPreviewContext.Provider>
  );
};
