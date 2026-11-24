import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import EventItemRelatedEventsList, {
  EventItemRelatedEvents,
  RELATED_EVENT_ROW_CLASS_NAME,
  RELATED_EVENTS_TOGGLE_CLASS_NAME,
} from "../../../UI/Components/EventItem/EventItemRelatedEvents";
import EventItem from "../../../UI/Components/EventItem/EventItem";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";

/*
 * The incidents an episode's card holds on a status page that groups
 * incidents by episode (#10767): "3 related incidents", folded until opened
 * on a list and open on the episode's own page, each a row - one link - with
 * its state, opening the incident's page. And the line an incident's card
 * draws when it is part of one.
 */

const RELATED: EventItemRelatedEvents = {
  title: "3 related incidents",
  items: [
    {
      id: "database",
      title: "Database Monitor Outage",
      detail: "Declared at Nov 24, 2026, 7:42 AM",
      statusName: "Investigating",
      statusColor: new Color("#f59e0b"),
      route: new Route("/incidents/database"),
    },
    {
      id: "api",
      title: "API Monitor Outage",
      detail: "Declared at Nov 24, 2026, 7:36 AM",
      statusName: "Resolved",
      statusColor: new Color("#16a34a"),
      route: new Route("/incidents/api"),
    },
    {
      id: "website",
      title: "Website Monitor Outage",
    },
  ],
};

afterEach(() => {
  cleanup();
});

function toggle(): HTMLElement {
  return screen.getByTestId("event-item-related-events-toggle");
}

describe("an episode card's related incidents", () => {
  test("are folded until opened, under a button that says which way it is", async () => {
    render(<EventItemRelatedEventsList relatedEvents={RELATED} />);

    expect(toggle().tagName).toBe("BUTTON");
    expect(toggle()).toHaveAttribute("type", "button");
    expect(toggle()).toHaveTextContent("3 related incidents");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).not.toHaveAttribute("aria-controls");
    expect(screen.queryByTestId("event-item-related-events-list")).toBeNull();

    await act(async () => {
      fireEvent.click(toggle());
    });

    const list: HTMLElement = screen.getByTestId(
      "event-item-related-events-list",
    );

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(toggle()).toHaveAttribute("aria-controls", list.id);
    expect(list.tagName).toBe("UL");
    expect(screen.getAllByTestId("event-item-related-event")).toHaveLength(3);
  });

  test("open from the start where the card is the episode's own page", () => {
    render(
      <EventItemRelatedEventsList
        relatedEvents={{ ...RELATED, isOpenByDefault: true }}
      />,
    );

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("event-item-related-event")).toHaveLength(3);
  });

  test("each row is one link to the incident's page, with its title, when, and its state", () => {
    render(
      <EventItemRelatedEventsList
        relatedEvents={{ ...RELATED, isOpenByDefault: true }}
      />,
    );

    const links: Array<HTMLElement> = screen.getAllByTestId(
      "event-item-related-event-link",
    );

    expect(
      links.map((link: HTMLElement): string | null => {
        return link.getAttribute("href");
      }),
    ).toEqual(["/incidents/database", "/incidents/api"]);
    expect(links[0]).toHaveTextContent("Database Monitor Outage");
    expect(links[0]).toHaveTextContent("Declared at Nov 24, 2026, 7:42 AM");
    expect(links[0]).toHaveTextContent("Investigating");
    expect(links[0]!.className).toContain("hover:bg-gray-50");
  });

  test("a row with nowhere to go is text, not a link", () => {
    render(
      <EventItemRelatedEventsList
        relatedEvents={{ ...RELATED, isOpenByDefault: true }}
      />,
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "event-item-related-event",
    );

    expect(rows[2]!.querySelector("a")).toBeNull();
    expect(rows[2]).toHaveTextContent("Website Monitor Outage");
    expect(
      rows[2]!.querySelector('[data-testid="event-item-related-event-status"]'),
    ).toBeNull();
  });

  test("a state's name is drawn as the page worded it, never looked up again", () => {
    render(
      <EventItemRelatedEventsList
        relatedEvents={{
          title: "1 related incident",
          isOpenByDefault: true,
          items: [
            {
              id: "a",
              title: "A",
              statusName: "Untersuchung läuft",
              statusColor: new Color("#f59e0b"),
              route: new Route("/incidents/a"),
            },
          ],
        }}
      />,
    );

    expect(
      screen.getByTestId("event-item-related-event-status"),
    ).toHaveTextContent("Untersuchung läuft");
  });

  test("holding nothing, it draws nothing", () => {
    const { container } = render(
      <EventItemRelatedEventsList
        relatedEvents={{ title: "0 related incidents", items: [] }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("a finger can hit the toggle and each row, and the keyboard sees the product's ring", () => {
    for (const className of [
      RELATED_EVENTS_TOGGLE_CLASS_NAME,
      RELATED_EVENT_ROW_CLASS_NAME,
    ]) {
      expect(className).toContain("[@media(pointer:coarse)]:min-h-11");
      expect(className).toContain("focus-visible:ring-2");
    }
  });
});

describe("an event card with related incidents and parents", () => {
  test("draws the fold after what the event affects, and its resources as written", () => {
    render(
      <EventItem
        eventTitle="Infrastructure Outage"
        eventType="Incident"
        eventTypeColor={new Color("#ef4444")}
        eventTimeline={[]}
        eventSecondDescription=""
        isDetailItem={false}
        eventResourcesAffected={["Website", "Public API"]}
        relatedEvents={RELATED}
      />,
    );

    expect(screen.getByText("Website")).toBeInTheDocument();
    expect(screen.getByText("Public API")).toBeInTheDocument();
    expect(toggle()).toHaveTextContent("3 related incidents");

    // The fold comes after the resources.
    const resources: HTMLElement = screen.getByText("Public API");
    expect(
      resources.compareDocumentPosition(toggle()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("an incident part of an episode says so, the episode's name a link to it", () => {
    render(
      <EventItem
        eventTitle="API Monitor Outage"
        eventType="Incident"
        eventTypeColor={new Color("#ef4444")}
        eventTimeline={[]}
        eventSecondDescription="Declared at Nov 24, 2026, 7:36 AM"
        isDetailItem={true}
        partOf={[
          {
            title: "Infrastructure Outage",
            route: new Route("/incidents/outage"),
          },
        ]}
      />,
    );

    expect(screen.getByTestId("event-item-part-of")).toHaveTextContent(
      "Part of Infrastructure Outage",
    );
    expect(screen.getByTestId("event-item-part-of-link")).toHaveAttribute(
      "href",
      "/incidents/outage",
    );
  });

  test("an event that holds nothing and is part of nothing draws neither", () => {
    render(
      <EventItem
        eventTitle="Search is slow"
        eventType="Incident"
        eventTypeColor={new Color("#ef4444")}
        eventTimeline={[]}
        eventSecondDescription=""
        isDetailItem={false}
      />,
    );

    expect(screen.queryByTestId("event-item-related-events")).toBeNull();
    expect(screen.queryByTestId("event-item-part-of")).toBeNull();
  });
});
