import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import Page from "../../../../UI/Components/Page/Page";
import PageSkeleton, {
  PAGE_SKELETON_FIELD_COUNT,
  PAGE_SKELETON_TEST_ID,
} from "../../../../UI/Components/Page/PageSkeleton";
import PageLoader from "../../../../UI/Components/Loader/PageLoader";
import ComponentLoader from "../../../../UI/Components/ComponentLoader/ComponentLoader";
import CompactLoader from "../../../../UI/Components/ComponentLoader/CompactLoader";
import {
  LOADER_BOX_CLASS_NAME,
  LOADER_COLOR,
} from "../../../../UI/Components/Loader/LoaderLayout";
import { CARD_FRAME_CLASS_NAME } from "../../../../UI/Components/Card/Card";
import { Gray500 } from "../../../../Types/BrandColors";

/*
 * The shared loading states keep the page still (#9135): a page's content
 * area loads as a card-shaped skeleton where its first card will be, and
 * every bar left is the same grey in the same box, as tall as an empty card.
 */

afterEach(() => {
  cleanup();
});

// The bar's colour as react-spinners paints it.
function barColorOf(container: HTMLElement): string {
  const bar: HTMLElement | null = container.querySelector(
    "[data-testid='bar-loader'] span",
  );
  return bar ? bar.style.backgroundColor : "";
}

describe("PageSkeleton", () => {
  test("is a card in a card's frame, with a title, a description and its fields", () => {
    render(<PageSkeleton />);

    const skeleton: HTMLElement = screen.getByTestId(PAGE_SKELETON_TEST_ID);
    const card: HTMLElement = skeleton.firstElementChild as HTMLElement;

    for (const className of CARD_FRAME_CLASS_NAME.split(" ")) {
      expect(card).toHaveClass(className);
    }
    expect(card).toHaveClass("motion-safe:animate-pulse");
    expect(
      within(skeleton).getAllByTestId(`${PAGE_SKELETON_TEST_ID}-field`),
    ).toHaveLength(PAGE_SKELETON_FIELD_COUNT);
  });

  test("says Loading to a screen reader, and hides its bars from it", () => {
    render(<PageSkeleton />);

    const skeleton: HTMLElement = screen.getByRole("status", {
      name: "Loading",
    });
    expect(skeleton).toHaveAttribute("aria-live", "polite");
    expect(skeleton.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(within(skeleton).getByText("Loading...")).toHaveClass("sr-only");
  });

  test("draws no bar and pushes nothing 13rem down", () => {
    const { container } = render(<PageSkeleton />);

    expect(screen.queryByTestId("bar-loader")).toBe(null);
    expect(container.querySelector(".mt-52")).toBe(null);
  });
});

describe("Page while it loads", () => {
  test("draws the skeleton where its content goes, not the bar", () => {
    render(
      <Page title="Monitors" isLoading={true}>
        <p>The list</p>
      </Page>,
    );

    expect(screen.getByTestId(PAGE_SKELETON_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).toBe(null);
    expect(screen.queryByText("The list")).toBe(null);
  });

  test("draws the skeleton beside the side menu, in the content's column", () => {
    render(
      <Page
        title="Monitor"
        isLoading={true}
        sideMenu={<nav aria-label="Side menu">Menu</nav>}
      >
        <p>The overview</p>
      </Page>,
    );

    const skeleton: HTMLElement = screen.getByTestId(PAGE_SKELETON_TEST_ID);
    expect(skeleton.parentElement).toHaveClass("flex-1", "min-w-0");
    expect(screen.getByRole("navigation", { name: "Side menu" })).toBeVisible();
    expect(screen.queryByText("The overview")).toBe(null);
  });

  test("draws its content once loaded", () => {
    render(
      <Page title="Monitors" isLoading={false}>
        <p>The list</p>
      </Page>,
    );

    expect(screen.getByText("The list")).toBeInTheDocument();
    expect(screen.queryByTestId(PAGE_SKELETON_TEST_ID)).toBe(null);
  });
});

describe("the shared bars", () => {
  test("are one colour: gray-500", () => {
    expect(LOADER_COLOR.toString()).toBe(Gray500.toString());
  });

  test("PageLoader sits centred in the shared box, not 208px down", () => {
    const { container } = render(<PageLoader isVisible={true} />);

    const box: HTMLElement = container.firstElementChild as HTMLElement;
    expect(box.className).toBe(LOADER_BOX_CLASS_NAME);
    expect(box).not.toHaveClass("mt-52");
    expect(barColorOf(container)).not.toBe("");
  });

  test("PageLoader keeps a caller's reserved height", () => {
    const { container } = render(
      <PageLoader isVisible={true} className="min-h-[60vh]" />,
    );

    expect(container.firstElementChild).toHaveClass("min-h-[60vh]");
  });

  test("PageLoader draws nothing when it is not visible", () => {
    const { container } = render(<PageLoader isVisible={false} />);

    expect(container.firstElementChild).toBe(null);
  });

  test("ComponentLoader sits in the same box as PageLoader, in the same colour", () => {
    const page: HTMLElement = render(<PageLoader isVisible={true} />).container;
    const component: HTMLElement = render(<ComponentLoader />).container;

    expect(screen.getByTestId("component-loader").className).toBe(
      LOADER_BOX_CLASS_NAME,
    );
    expect(barColorOf(component)).toBe(barColorOf(page));
  });

  test("CompactLoader is the same colour, in less room", () => {
    const page: HTMLElement = render(<PageLoader isVisible={true} />).container;
    const compact: HTMLElement = render(<CompactLoader />).container;

    expect(barColorOf(compact)).toBe(barColorOf(page));
    expect(compact.firstElementChild).not.toHaveClass("min-h-52");
  });

  test("the box is as tall as an empty card, so a card that loads empty keeps its height", () => {
    expect(LOADER_BOX_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "flex",
        "min-h-52",
        "w-full",
        "items-center",
        "justify-center",
      ]),
    );
  });
});
