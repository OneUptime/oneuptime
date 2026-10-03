import React, { FunctionComponent, ReactElement } from "react";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import CardMoreMenu from "../Card/CardMoreMenu";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import MoreMenuSection from "../MoreMenu/MoreMenuSection";
import {
  FEED_OPTIONS_TEXT,
  FEED_SORT_ORDER_OPTIONS,
  FeedOptions,
  FeedSortOrderOption,
} from "./FeedOptions";

export interface ComponentProps {
  value: FeedOptions;
  onChange: (options: FeedOptions) => void;
  // "Filter by event type": opens the feed's filter dialog.
  onFilterClick: () => void;
  onRefresh: () => void;
}

/*
 * "The filter, sort, and refresh should be combined into a More button in the
 * feeds component, just like we have in the modal table ... The idea is to
 * have as few buttons as possible visible to the user."
 *
 * A feed's header keeps its main action in sight (an incident feed's Actions)
 * and everything else behind the same ⋯ a table's card header has
 * (CardMoreMenu):
 *
 *   SORT BY TIME
 *   ✓ Newest first        the order in use carries the tick
 *     Oldest first
 *   ⧩ Filter by event type   opens the filter dialog
 *   ⟳ Refresh
 *
 * A sort order applies as soon as it is picked; the filter opens a dialog,
 * like a table's Filter. A filtered feed also says so above its items
 * (FeedFilterSummary), so a narrowed feed is never mistaken for the whole one.
 */
const FeedMoreMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const setSortOrder: (sortOrder: SortOrder) => void = (
    sortOrder: SortOrder,
  ): void => {
    if (sortOrder === props.value.sortOrder) {
      return;
    }

    props.onChange({
      ...props.value,
      sortOrder,
    });
  };

  return (
    <CardMoreMenu>
      {[
        <MoreMenuSection key="sort" title={FEED_OPTIONS_TEXT.sortHeading}>
          {FEED_SORT_ORDER_OPTIONS.map((option: FeedSortOrderOption) => {
            const isSelected: boolean = option.value === props.value.sortOrder;

            return (
              <MoreMenuItem
                key={option.value}
                text={option.label}
                icon={isSelected ? IconProp.Check : undefined}
                isIconSpaceReserved={true}
                isChecked={isSelected}
                onClick={() => {
                  setSortOrder(option.value);
                }}
              />
            );
          })}
        </MoreMenuSection>,
        /*
         * No count beside it: the box over a filtered feed already says what
         * the feed is narrowed to, in words, and a badge wrapped the label
         * onto two lines.
         */
        <MoreMenuItem
          key="filter"
          text={FEED_OPTIONS_TEXT.filter}
          icon={IconProp.Filter}
          onClick={props.onFilterClick}
        />,
        <MoreMenuItem
          key="refresh"
          text={FEED_OPTIONS_TEXT.refresh}
          icon={IconProp.Refresh}
          onClick={props.onRefresh}
        />,
      ]}
    </CardMoreMenu>
  );
};

export default FeedMoreMenu;
