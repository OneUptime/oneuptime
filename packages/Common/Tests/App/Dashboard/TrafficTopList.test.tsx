import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as React from "react";
import TrafficTopList, {
  TRAFFIC_TOP_LIST_BODY_CLASS_NAME,
  TRAFFIC_TOP_LIST_EMPTY_CLASS_NAME,
  TrafficTopRow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/TrafficTopList";
import CardGrid, {
  CARD_GRID_CELL_TEST_ID,
} from "../../../UI/Components/Card/CardGrid";
import { CARD_GRID_CENTERED_STATE_CLASS_NAME } from "../../../UI/Components/Card/CardGridLayout";
import {
  describeHeightFill,
  describeHeightFillChain,
} from "../../ResponsiveHeightFill";
import { WIDTHS_IN_PX } from "../../RenderedMarkup";

/*
 * A Traffic page's top lists - Top networks, applications, clients and
 * destinations (Meraki), sources, destinations, applications, interfaces
 * and devices (flow records) - sit two to a row (CardGrid), each card as
 * tall as its row. A list with rows keeps them at the top of its card; a
 * list with nothing in the window says so in the middle of the card's room,
 * as every empty list in a row of cards does: a Meraki organization without
 * traffic analysis has no applications beside a full list of networks.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

const NO_APPLICATIONS: string =
  "No applications in this time range. Meraki keeps them where traffic analysis is turned on.";

function rows(count: number, name: string): Array<TrafficTopRow> {
  return Array.from({ length: count }, (_unused: unknown, index: number) => {
    return {
      key: `${name}-${index}`,
      label: `${name} ${index + 1}`,
      octets: (count - index) * 1_000_000_000,
      isActive: false,
    };
  });
}

function list(
  title: string,
  count: number,
  emptyMessage: string,
  testId: string,
): React.ReactElement {
  return (
    <TrafficTopList
      title={title}
      description="Over the selected range."
      help="What the numbers are."
      rows={rows(count, title)}
      totalOctets={40_000_000_000}
      emptyMessage={emptyMessage}
      dataTestId={testId}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("a traffic top list in a row of cards", () => {
  test("a list with nothing in the window says so in the middle of its card, as tall as the full list beside it", () => {
    render(
      <CardGrid columns={2} cardWidth="narrow" dataTestId="meraki-top-lists">
        {list("Top networks", 4, "No networks in this time range.", "nets")}
        {list("Top applications", 0, NO_APPLICATIONS, "apps")}
      </CardGrid>,
    );

    const cells: Array<HTMLElement> = within(
      screen.getByTestId("meraki-top-lists"),
    ).getAllByTestId(CARD_GRID_CELL_TEST_ID);

    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      expect(within(cell).getByTestId("card")).toHaveAttribute(
        "data-fill-height",
        "true",
      );
    }

    const sentence: HTMLElement = screen.getByTestId("apps-empty");

    expect(sentence).toHaveTextContent(NO_APPLICATIONS);
    // Centred in the room, as the shared empty sentence of a row's card is.
    expect(sentence).toHaveClass(
      ...CARD_GRID_CENTERED_STATE_CLASS_NAME.split(" "),
    );
    expect(sentence.className).toBe(TRAFFIC_TOP_LIST_EMPTY_CLASS_NAME);
    // Each class once: the shared one's text-center, not a second of its own.
    expect(sentence.className.split(" ")).toEqual(
      Array.from(new Set(sentence.className.split(" "))),
    );

    /*
     * The room is the card's: every box from the sentence up to its cell
     * runs to the bottom of the one it is in, at every width - so the
     * sentence's middle is the middle of the card under its header.
     */
    for (const width of WIDTHS_IN_PX) {
      expect([width, describeHeightFillChain(sentence, cells[1]!, width)]).toEqual(
        [width, []],
      );
    }
  });

  test("a list with rows keeps them at the top of its card", () => {
    render(
      <CardGrid columns={2} cardWidth="narrow">
        {list("Top clients", 6, "No clients in this time range.", "clients")}
        {list("Top destinations", 2, "No destinations.", "destinations")}
      </CardGrid>,
    );

    for (const testId of ["clients", "destinations"]) {
      const body: HTMLElement = screen.getByTestId(testId);
      const ordered: HTMLElement = body.querySelector("ol") as HTMLElement;

      // The body takes the card's room...
      expect(body.className).toBe(TRAFFIC_TOP_LIST_BODY_CLASS_NAME);
      // ...and the rows stay at its top: nothing centres them or spreads them out.
      expect(body).not.toHaveClass("justify-center");
      expect(body).not.toHaveClass("justify-between");
      expect(ordered.parentElement).toBe(body);
      for (const width of WIDTHS_IN_PX) {
        expect(describeHeightFill(ordered, width)).not.toBeNull();
      }
      expect(screen.queryByTestId(`${testId}-empty`)).toBeNull();
    }
  });

  test("on its own, the list still fills the box it is given", () => {
    render(list("Top sources", 0, "No sources in this time range.", "src"));

    const card: HTMLElement = screen.getByTestId("card");
    const sentence: HTMLElement = screen.getByTestId("src-empty");

    // fillHeight: the card fills its box outside a row too, as it always has.
    expect(card).toHaveAttribute("data-fill-height", "true");
    for (const width of WIDTHS_IN_PX) {
      expect([width, describeHeightFillChain(sentence, card, width)]).toEqual([
        width,
        [],
      ]);
    }
  });
});
