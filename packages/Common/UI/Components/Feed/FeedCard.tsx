import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import Card from "../Card/Card";
import FeedFilterModal from "./FeedFilterModal";
import FeedFilterSummary from "./FeedFilterSummary";
import FeedMoreMenu from "./FeedMoreMenu";
import { FeedOptions } from "./FeedOptions";
import { UseFeedOptionsResult } from "./useFeedOptions";

export interface ComponentProps {
  title: string;
  description?: string | undefined;
  // What the feed shows: its sort order and event type filter.
  feedOptions: UseFeedOptionsResult;
  // Re-reads the feed: the ⋯ menu's Refresh.
  onRefresh: () => Promise<void> | void;
  /*
   * The feed's main action, shown as a button beside the ⋯ - an incident
   * feed's Actions menu (notes, runbooks, on-call policies). A feed with
   * nothing to do but read shows the ⋯ alone.
   */
  actions?: ReactElement | undefined;
  // The feed itself: its loader, error, items and More button.
  children: React.ReactNode;
}

/*
 * The card every dashboard activity feed is drawn in - incidents, alerts,
 * episodes, scheduled maintenance, monitors, on-call policies, and every
 * infrastructure, catalog and SLO feed - so all of them put their controls
 * in the same places:
 *
 *   header   [main action]  [⋯]      the ⋯ holds sort, filter and Refresh
 *   body     the filter box, while the feed is filtered
 *            the feed itself
 *
 * The filter dialog opens from the ⋯ menu and from the box's Edit Filters.
 */
const FeedCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isFilterModalOpen, setIsFilterModalOpen] = useState<boolean>(false);
  const [shouldFocusMoreMenu, setShouldFocusMoreMenu] =
    useState<boolean>(false);
  const moreMenuRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  const options: FeedOptions = props.feedOptions.options;

  /*
   * Clearing the filter removes the box that held the button just pressed
   * (Clear Filters, or Edit Filters for a dialog applied with nothing
   * ticked), and focus on a removed button falls to the page. It goes to
   * the ⋯ instead, where the filter now lives. In an effect, so it runs
   * after the dialog has handed focus back to whatever opened it.
   */
  useEffect(() => {
    if (!shouldFocusMoreMenu) {
      return;
    }

    setShouldFocusMoreMenu(false);
    moreMenuRef.current
      ?.querySelector<HTMLElement>('[aria-haspopup="menu"]')
      ?.focus();
  }, [shouldFocusMoreMenu]);

  const setEventTypes: (eventTypes: Array<string>) => void = (
    eventTypes: Array<string>,
  ): void => {
    const isUnchanged: boolean =
      eventTypes.length === options.eventTypes.length &&
      eventTypes.every((eventType: string) => {
        return options.eventTypes.includes(eventType);
      });

    if (isUnchanged) {
      return;
    }

    props.feedOptions.setOptions({
      ...options,
      eventTypes,
    });

    if (eventTypes.length === 0) {
      setShouldFocusMoreMenu(true);
    }
  };

  const buttons: Array<ReactElement> = [];

  if (props.actions) {
    buttons.push(props.actions);
  }

  buttons.push(
    <div
      key="feed-more-menu"
      ref={moreMenuRef}
      className="flex items-center"
      data-testid="feed-more-menu"
    >
      <FeedMoreMenu
        value={options}
        onChange={props.feedOptions.setOptions}
        onFilterClick={() => {
          setIsFilterModalOpen(true);
        }}
        onRefresh={() => {
          Promise.resolve(props.onRefresh()).catch(() => {
            // The feed shows its own error when a read fails.
          });
        }}
      />
    </div>,
  );

  return (
    <Card title={props.title} description={props.description} buttons={buttons}>
      <div>
        <FeedFilterSummary
          value={options}
          eventTypeOptions={props.feedOptions.eventTypeOptions}
          onEditFilters={() => {
            setIsFilterModalOpen(true);
          }}
          onClearFilters={() => {
            setEventTypes([]);
          }}
        />
        {props.children}
        {isFilterModalOpen && (
          <FeedFilterModal
            value={options}
            eventTypeOptions={props.feedOptions.eventTypeOptions}
            onClose={() => {
              setIsFilterModalOpen(false);
            }}
            onApply={(eventTypes: Array<string>) => {
              setIsFilterModalOpen(false);
              setEventTypes(eventTypes);
            }}
          />
        )}
      </div>
    </Card>
  );
};

export default FeedCard;
