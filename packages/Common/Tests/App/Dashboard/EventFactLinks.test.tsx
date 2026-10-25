import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The things a header fact names - an incident's monitors, an alert's monitor
 * and episode, a maintenance event's status pages - as links to their pages,
 * one under another, then "+N more". They used to run on one line, glued with
 * commas that broke wherever the line did ("Checkout API p95 / latency,
 * Orders DB"), and an alert's were plain text.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

import EventFactLinks, {
  EVENT_FACT_LINK_CLASS_NAME,
  EventFactLinkItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventFactLinks";
import Route from "../../../Types/API/Route";

function item(name: string, path?: string): EventFactLinkItem {
  return {
    key: name,
    name: name,
    route: path ? new Route(path) : undefined,
  };
}

afterEach(() => {
  cleanup();
});

describe("EventFactLinks", () => {
  test("names each thing as a link to its page, one under another", () => {
    render(
      <EventFactLinks
        dataTestId="event-monitor-links"
        items={[
          item("Checkout API p95 latency", "/monitors/1"),
          item("Orders DB connection pool", "/monitors/2"),
        ]}
      />,
    );

    const list: HTMLElement = screen.getByTestId("event-monitor-links");
    const links: Array<HTMLElement> = within(list).getAllByRole("link");

    expect(list).toHaveClass("flex", "flex-col", "items-start", "gap-1");
    expect(
      links.map((link: HTMLElement): [string, string | null] => {
        return [link.textContent || "", link.getAttribute("href")];
      }),
    ).toEqual([
      ["Checkout API p95 latency", "/monitors/1"],
      ["Orders DB connection pool", "/monitors/2"],
    ]);
    // No comma glued between them.
    expect(list.textContent).toBe(
      "Checkout API p95 latencyOrders DB connection pool",
    );
  });

  test("draws its links as the header's links: indigo, underlined under the pointer, wrapping a long name", () => {
    render(
      <EventFactLinks
        items={[item("checkout-api-production-eu-west-1", "/monitors/1")]}
      />,
    );

    const link: HTMLElement = screen.getByRole("link");

    expect(link).toHaveClass(
      "font-medium",
      "text-indigo-600",
      "hover:text-indigo-700",
      "hover:underline",
      "focus-visible:ring-2",
      "max-w-full",
      "break-words",
    );
    expect(EVENT_FACT_LINK_CLASS_NAME).toContain("text-indigo-600");
  });

  test("names a thing without a page of its own as plain text", () => {
    render(<EventFactLinks items={[item("Unnamed monitor")]} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Unnamed monitor")).toHaveClass("break-words");
  });

  test("names the first few, then how many more", () => {
    render(
      <EventFactLinks
        dataTestId="list"
        maxVisible={2}
        items={[
          item("A", "/a"),
          item("B", "/b"),
          item("C", "/c"),
          item("D", "/d"),
        ]}
      />,
    );

    const list: HTMLElement = screen.getByTestId("list");

    expect(
      within(list)
        .getAllByRole("link")
        .map((link: HTMLElement): string => {
          return link.textContent || "";
        }),
    ).toEqual(["A", "B"]);
    expect(list.lastElementChild).toHaveTextContent("+2 more");
    expect(list.lastElementChild).toHaveClass("font-normal", "text-gray-500");
    expect(list.lastElementChild?.tagName).toBe("SPAN");
  });

  test("makes +N more a link to the record's own list of them, when it has one", () => {
    render(
      <EventFactLinks
        maxVisible={1}
        moreRoute={new Route("/incidents/1/monitors")}
        items={[item("A", "/a"), item("B", "/b")]}
      />,
    );

    const more: HTMLElement = screen.getByRole("link", { name: "+1 more" });

    expect(more).toHaveAttribute("href", "/incidents/1/monitors");
  });

  test("names all of them when no limit is given", () => {
    render(
      <EventFactLinks
        items={[item("A", "/a"), item("B", "/b"), item("C", "/c")]}
      />,
    );

    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.queryByText(/more$/)).toBeNull();
  });
});
