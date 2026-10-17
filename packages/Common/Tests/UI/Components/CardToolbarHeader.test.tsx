import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Card, {
  CARD_HEADER_LAYOUTS,
  CARD_HEADER_STACKED_TITLE_BLOCK_CLASS_NAME,
  CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME,
  ComponentProps,
} from "../../../UI/Components/Card/Card";
import { resolveFlex } from "../../ResponsiveFlexLayout";

/*
 * Card's toolbar header (model-table-ui): the stacked header for a card as
 * wide as the page whose actions are a row of controls - a table's search,
 * saved views, main button and ⋯. The title and the controls share the
 * first line and the description runs under both, as in the stacked header;
 * but the title keeps only what a title needs (12rem) beside them, not half
 * the line, so a table's controls stay beside its title until they really
 * do not fit - rather than dropping to a line of their own the moment a
 * filter brings the Saved Views button in.
 */

const baseProps: ComponentProps = {
  title: "Incidents",
  description:
    "An incident is a problem that affects your users, like an outage or a slowdown.",
  buttons: [
    <a key="search" href="#search">
      Search
    </a>,
    <a key="views" href="#views">
      Saved Views
    </a>,
    <a key="declare" href="#declare">
      Declare Incident
    </a>,
  ],
  children: <div>rows</div>,
};

afterEach(() => {
  cleanup();
});

describe("the toolbar header", () => {
  test("is one of Card's layouts", () => {
    expect([...CARD_HEADER_LAYOUTS]).toEqual(["default", "stacked", "toolbar"]);
  });

  test("says which it is", () => {
    render(<Card {...baseProps} headerLayout="toolbar" />);

    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "toolbar",
    );
  });

  test("the title and the controls share the first row; the description follows it, across the card", () => {
    render(<Card {...baseProps} headerLayout="toolbar" />);

    const header: HTMLElement = screen.getByTestId("card-header");
    const row: HTMLElement = screen.getByTestId("card-header-title-row");
    const description: HTMLElement = screen.getByTestId("card-description");

    expect(Array.from(row.children)).toEqual([
      screen.getByTestId("card-header-title-block"),
      screen.getByTestId("card-header-actions"),
    ]);
    expect(Array.from(header.children)).toEqual([row, description]);
    expect(description).toHaveClass("w-full");
  });

  test("the title keeps 12rem beside the controls, not the stacked header's half of the line", () => {
    render(<Card {...baseProps} headerLayout="toolbar" />);

    const titleBlock: HTMLElement = screen.getByTestId(
      "card-header-title-block",
    );

    expect(titleBlock.className).toBe(
      CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME,
    );
    expect(CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME.split(" ")).toEqual([
      "min-w-0",
      "md:grow",
      "md:basis-48",
    ]);
    expect(CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME).not.toBe(
      CARD_HEADER_STACKED_TITLE_BLOCK_CLASS_NAME,
    );
  });

  test("a title with no controls beside it takes the whole width", () => {
    render(
      <Card
        title="Incidents"
        description="All of them."
        headerLayout="toolbar"
      />,
    );

    expect(screen.getByTestId("card-header-title-block")).toHaveClass(
      "w-full",
      "min-w-0",
    );
    expect(screen.queryByTestId("card-header-actions")).toBeNull();
  });

  test("the controls may shrink and wrap at the right edge, never pushing the title off its line", () => {
    render(<Card {...baseProps} headerLayout="toolbar" />);

    const actions: HTMLElement = screen.getByTestId("card-header-actions");

    // The default header's md:flex-shrink-0 is what squeezed its title.
    expect(actions).not.toHaveClass("md:flex-shrink-0");
    expect(actions).toHaveClass("ml-auto", "flex-wrap", "justify-end");

    for (const width of [390, 768, 1024, 1280]) {
      expect(
        resolveFlex(
          screen.getByTestId("card-header-title-row").className,
          width,
          "flex-wrap",
        ),
      ).toBe("wrap");
    }
  });

  test("its markup is the stacked header's but for its name and the title's share", () => {
    const toolbar: string = renderToStaticMarkup(
      <Card {...baseProps} headerLayout="toolbar" />,
    );
    const stacked: string = renderToStaticMarkup(
      <Card {...baseProps} headerLayout="stacked" />,
    );

    expect(
      toolbar
        .replace('data-header-layout="toolbar"', 'data-header-layout="stacked"')
        .replace(
          CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME,
          CARD_HEADER_STACKED_TITLE_BLOCK_CLASS_NAME,
        ),
    ).toBe(stacked);
  });
});
