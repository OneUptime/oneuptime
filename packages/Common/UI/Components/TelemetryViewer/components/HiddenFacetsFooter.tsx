import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import { formatHiddenFacetCount } from "../FacetVisibility";

export interface HiddenFacetsFooterProps {
  // Empty resource facets the sidebar folded away.
  hiddenCount: number;
  /*
   * Their section titles in English, as the facet configs write them; the
   * tooltip lists them in the reader's language, as the headers draw them.
   */
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
  const translator: Translator = useTranslator();
  if (props.hiddenCount <= 0) {
    return null;
  }

  const hiddenTitlesText: string = props.hiddenTitles
    .map((title: string): string => {
      return translator.translateText(title) || title;
    })
    .join(", ");

  /*
   * One button, folded or open: the count goes before it while the filters
   * are folded away, so the button keeps its place among the row's children
   * and React keeps the same element - focus stays on it after a press. Two
   * buttons, one per state, dropped focus to the page on every press.
   */
  return (
    <div
      data-testid="facet-sidebar-hidden-footer"
      className="-mt-px flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-[11px] text-gray-400"
    >
      {!props.isShowingHidden && (
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
      )}
      <button
        type="button"
        className={
          props.isShowingHidden
            ? "flex min-w-0 items-center gap-1.5 rounded font-medium text-indigo-500 transition-colors hover:text-indigo-600"
            : "flex-none rounded font-medium text-indigo-500 transition-colors hover:text-indigo-600"
        }
        aria-expanded={props.isShowingHidden}
        aria-controls={props.controlsId}
        aria-label={
          props.isShowingHidden
            ? undefined
            : translator.translatePlural(
                {
                  one: "Show {{count}} empty filter",
                  other: "Show {{count}} empty filters",
                },
                props.hiddenCount,
              )
        }
        title={props.isShowingHidden ? hiddenTitlesText : undefined}
        data-testid="facet-sidebar-hidden-toggle"
        onClick={props.onToggle}
      >
        {props.isShowingHidden ? (
          <>
            <span className="flex flex-none items-center">
              <Icon icon={IconProp.EyeSlash} className="h-3.5 w-3.5" />
            </span>
            <span className="truncate">
              {translator.translateText("Hide empty filters")}
            </span>
          </>
        ) : (
          translator.translateText("Show")
        )}
      </button>
    </div>
  );
};

export default HiddenFacetsFooter;
