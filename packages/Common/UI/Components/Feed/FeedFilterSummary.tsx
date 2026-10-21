import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import AppliedFilters from "../Filters/AppliedFilters";
import Icon from "../Icon/Icon";
import {
  FEED_APPLIED_FILTERS_CHIP_LIMIT,
  FEED_OPTIONS_TEXT,
  FeedEventTypeOption,
  FeedOptions,
  isFeedFiltered,
} from "./FeedOptions";

export interface ComponentProps {
  value: FeedOptions;
  eventTypeOptions: Array<FeedEventTypeOption>;
  onEditFilters: () => void;
  onClearFilters: () => void;
}

/*
 * The box over a filtered feed - the one a filtered table shows
 * (AppliedFilters): how many of the feed's event types it is showing, a chip
 * for each one with the icon its items carry, and Edit Filters and Clear
 * Filters. With the filter behind the ⋯ menu, this is what keeps a narrowed
 * feed from reading as one with missing events. Nothing is shown while the
 * feed shows every event type.
 */
const FeedFilterSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();

  if (!isFeedFiltered(props.value)) {
    return null;
  }

  const selectedEventTypes: Set<string> = new Set<string>(
    props.value.eventTypes,
  );

  // In the reader's language and alphabetical, as the checklist lists them.
  const selectedOptions: Array<FeedEventTypeOption> = props.eventTypeOptions
    .filter((option: FeedEventTypeOption) => {
      return selectedEventTypes.has(option.value);
    })
    .map((option: FeedEventTypeOption): FeedEventTypeOption => {
      return {
        ...option,
        label: translator.translateText(option.label) ?? option.label,
      };
    })
    .sort((a: FeedEventTypeOption, b: FeedEventTypeOption): number => {
      return a.label.localeCompare(b.label);
    });

  const shownOptions: Array<FeedEventTypeOption> = selectedOptions.slice(
    0,
    FEED_APPLIED_FILTERS_CHIP_LIMIT,
  );
  const remainingCount: number = selectedOptions.length - shownOptions.length;

  const chips: Array<ReactElement> = shownOptions.map(
    (option: FeedEventTypeOption): ReactElement => {
      return (
        <div
          key={option.value}
          className="flex items-center gap-1.5 leading-5 text-gray-800"
          data-testid={`feed-filter-chip-${option.value}`}
        >
          {option.icon && (
            <Icon
              icon={option.icon}
              className="h-4 w-4 shrink-0 text-gray-400"
            />
          )}
          <span>{option.label}</span>
        </div>
      );
    },
  );

  if (remainingCount > 0) {
    chips.push(
      <span
        key="more"
        className="leading-5 text-gray-800"
        data-testid="feed-filter-chip-more"
      >
        {translator.translateTemplate(FEED_OPTIONS_TEXT.moreEventTypes, {
          remaining: remainingCount,
        })}
      </span>,
    );
  }

  return (
    <AppliedFilters
      dataTestId="feed-filter-summary"
      title={translator.translateTemplate(
        FEED_OPTIONS_TEXT.appliedFiltersTitle,
        {
          selected: selectedOptions.length,
          total: props.eventTypeOptions.length,
        },
      )}
      chips={chips}
      onEditFilters={props.onEditFilters}
      onClearFilters={props.onClearFilters}
    />
  );
};

export default FeedFilterSummary;
