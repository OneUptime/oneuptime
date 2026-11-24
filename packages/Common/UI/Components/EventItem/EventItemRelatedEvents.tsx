import Icon, { ThickProp } from "../Icon/Icon";
import Link from "../Link/Link";
import Pill from "../Pill/Pill";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";

/*
 * THE INCIDENTS AN INCIDENT CARD HOLDS (issue #10767).
 *
 * A status page that groups incidents by episode draws an episode as one
 * card: what happened and what it affects, read at a glance, and then its
 * incidents - "3 related incidents" - folded until opened, each a row that
 * opens the incident's own page with its state beside it. Its words come
 * from the page, already in the reader's language.
 *
 * The fold is a button that says which way it is (aria-expanded), its
 * chevron turned down when open; a row is one link, so a press anywhere on
 * it opens the incident, and a keyboard reaches each in turn.
 */

export interface EventItemRelatedEvent {
  id: string;
  title: string;
  // The line under its title: when it was declared, in the reader's words.
  detail?: string | undefined;
  // Its state now, in the page's own words, and the state's colour.
  statusName?: string | undefined;
  statusColor?: Color | undefined;
  // Its own page.
  route?: Route | URL | undefined;
}

export interface EventItemRelatedEvents {
  // The fold's name, which says how many it holds: "3 related incidents".
  title: string;
  items: Array<EventItemRelatedEvent>;
  // Open from the start: an incident's own page shows them, a list folds them.
  isOpenByDefault?: boolean | undefined;
}

export interface ComponentProps {
  relatedEvents: EventItemRelatedEvents;
}

// The toggle: as tall as a finger needs, its focus ring the product's.
export const RELATED_EVENTS_TOGGLE_CLASS_NAME: string =
  "group -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-md px-1 py-1 text-start text-sm font-medium text-gray-700 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [@media(pointer:coarse)]:min-h-11";

// A row: the whole of it opens the incident.
export const RELATED_EVENT_ROW_CLASS_NAME: string =
  "flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [@media(pointer:coarse)]:min-h-11";

/*
 * A row's words, and its state beside them - under them on a phone, so the
 * title and when it was declared keep the row's width rather than wrapping
 * word by word beside the state.
 */
const RelatedEventRowContent: FunctionComponent<{
  item: EventItemRelatedEvent;
}> = (props: { item: EventItemRelatedEvent }): ReactElement => {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <span className="block w-full min-w-0 sm:w-auto sm:flex-1">
          <span
            className="block break-words text-sm font-medium text-gray-900"
            data-testid="event-item-related-event-title"
          >
            {props.item.title}
          </span>
          {props.item.detail ? (
            <span
              className="mt-0.5 block text-sm text-gray-500"
              data-testid="event-item-related-event-detail"
            >
              {props.item.detail}
            </span>
          ) : (
            <></>
          )}
        </span>
        {props.item.statusName && props.item.statusColor ? (
          <span
            className="flex-shrink-0"
            data-testid="event-item-related-event-status"
          >
            <Pill
              text={props.item.statusName}
              // The page's own words for the state, drawn as given.
              isUserContent={true}
              color={props.item.statusColor}
              isMinimal={true}
            />
          </span>
        ) : (
          <></>
        )}
      </span>
      {props.item.route ? (
        <Icon
          icon={IconProp.ChevronRight}
          className="h-4 w-4 flex-shrink-0 text-gray-400"
        />
      ) : (
        <></>
      )}
    </>
  );
};

const EventItemRelatedEventsList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(
    Boolean(props.relatedEvents.isOpenByDefault),
  );
  const listId: string = `event-item-related-events-${useId()}`;

  if (props.relatedEvents.items.length === 0) {
    return <></>;
  }

  return (
    <div data-testid="event-item-related-events">
      <button
        type="button"
        className={RELATED_EVENTS_TOGGLE_CLASS_NAME}
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        data-testid="event-item-related-events-toggle"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <span
          className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-colors ${
            isOpen ? "bg-gray-900/5 text-gray-700" : "text-gray-400"
          }`}
          aria-hidden="true"
        >
          <Icon
            className={`h-3.5 w-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none ${
              isOpen ? "rotate-90" : ""
            }`}
            icon={IconProp.ChevronRight}
            thick={ThickProp.Thick}
          />
        </span>
        <span className="min-w-0 flex-1">{props.relatedEvents.title}</span>
      </button>

      {isOpen ? (
        <ul
          id={listId}
          role="list"
          className="mt-2 ms-[1.625rem] divide-y divide-gray-100"
          data-testid="event-item-related-events-list"
        >
          {props.relatedEvents.items.map(
            (item: EventItemRelatedEvent): ReactElement => {
              return (
                <li key={item.id} data-testid="event-item-related-event">
                  {item.route ? (
                    <Link
                      to={item.route}
                      className={RELATED_EVENT_ROW_CLASS_NAME}
                      dataTestId="event-item-related-event-link"
                    >
                      <RelatedEventRowContent item={item} />
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 px-2 py-2.5">
                      <RelatedEventRowContent item={item} />
                    </div>
                  )}
                </li>
              );
            },
          )}
        </ul>
      ) : (
        <></>
      )}
    </div>
  );
};

export default EventItemRelatedEventsList;
