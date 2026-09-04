import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (
          key: string,
          opts?: { defaultValue?: string } & Record<string, unknown>,
        ): string => {
          let out: string = opts?.defaultValue ?? key;

          for (const name of Object.keys(opts || {})) {
            out = out
              .split(`{{${name}}}`)
              .join(String((opts as Record<string, unknown>)[name]));
          }

          return out;
        },
      };
    },
  };
});

import ResourceSearchBox from "../../../../App/FeatureSet/StatusPage/src/Components/Search/ResourceSearchBox";

/*
 * Contract under test - the field that answers "which of these is mine?".
 *
 * A status page with a couple of hundred resources under nested groups had no
 * way to answer that except opening every group and reading. The field is a
 * small thing, so what it has to get right is the small things: it has to be
 * announced as a search, it has to say how much of the page is left after
 * filtering (out loud, for a screen reader, not only on screen), it has to be
 * clearable without reaching for the mouse, and clearing it has to leave the
 * cursor where the visitor was already typing.
 */

type OnChangeMock = ReturnType<typeof jest.fn<(value: string) => void>>;

function renderBox(
  props: Partial<React.ComponentProps<typeof ResourceSearchBox>> = {},
): { onChange: OnChangeMock } {
  const onChange: OnChangeMock = jest.fn<(value: string) => void>();

  render(
    <ResourceSearchBox
      value={props.value === undefined ? "" : props.value}
      onChange={props.onChange || onChange}
      matchedCount={props.matchedCount === undefined ? 12 : props.matchedCount}
      totalCount={props.totalCount === undefined ? 12 : props.totalCount}
    />,
  );

  return { onChange: onChange };
}

function input(): HTMLElement {
  return screen.getByTestId("status-page-resource-search-input");
}

describe("ResourceSearchBox", () => {
  test("is announced as a search landmark", () => {
    renderBox();

    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  /*
   * The field carries no visible label, so without this the only thing a
   * screen reader has to go on is the placeholder - which is not a label.
   */
  test("the field has an accessible name of its own", () => {
    renderBox();

    expect(input()).toHaveAttribute("aria-label", "Search resources");
  });

  test("typing is reported to the caller", () => {
    const { onChange } = renderBox();

    fireEvent.change(input(), { target: { value: "checkout" } });

    expect(onChange).toHaveBeenCalledWith("checkout");
  });

  test("the field shows what the caller says it holds", () => {
    renderBox({ value: "checkout" });

    expect(input()).toHaveValue("checkout");
  });
});

describe("ResourceSearchBox - the result count", () => {
  test("says how much of the page survived the query", () => {
    renderBox({ value: "checkout", matchedCount: 3, totalCount: 42 });

    expect(
      screen.getByTestId("status-page-resource-search-count"),
    ).toHaveTextContent("3 of 42 resources");
  });

  test("says nothing at all when nothing has been typed", () => {
    renderBox({ value: "", matchedCount: 42, totalCount: 42 });

    expect(
      screen.getByTestId("status-page-resource-search-count"),
    ).toHaveTextContent("");
  });

  /*
   * Polite, not assertive: this changes on every keystroke, and an assertive
   * region would interrupt the visitor's own typing.
   */
  test("the count is announced politely", () => {
    renderBox({ value: "checkout" });

    expect(
      screen.getByTestId("status-page-resource-search-count"),
    ).toHaveAttribute("aria-live", "polite");
  });

  test("the field points at the count so it is read with the field", () => {
    renderBox({ value: "checkout" });

    const describedBy: string | null = input().getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toBe(
      screen.getByTestId("status-page-resource-search-count"),
    );
  });

  test("zero matches is still a count, not a blank", () => {
    renderBox({ value: "kubernetes", matchedCount: 0, totalCount: 42 });

    expect(
      screen.getByTestId("status-page-resource-search-count"),
    ).toHaveTextContent("0 of 42 resources");
  });
});

describe("ResourceSearchBox - clearing", () => {
  test("there is nothing to clear until something is typed", () => {
    renderBox({ value: "" });

    expect(
      screen.queryByTestId("status-page-resource-search-clear"),
    ).not.toBeInTheDocument();
  });

  test("a query brings out a clear control", () => {
    renderBox({ value: "checkout" });

    expect(
      screen.getByTestId("status-page-resource-search-clear"),
    ).toHaveAttribute("aria-label", "Clear search");
  });

  test("pressing it empties the query", () => {
    const { onChange } = renderBox({ value: "checkout" });

    fireEvent.click(screen.getByTestId("status-page-resource-search-clear"));

    expect(onChange).toHaveBeenCalledWith("");
  });

  /*
   * Clearing with the mouse and then having to click back into the field to
   * carry on typing is the kind of small friction that makes a search feel
   * broken.
   */
  test("clearing leaves the cursor in the field", () => {
    renderBox({ value: "checkout" });

    fireEvent.click(screen.getByTestId("status-page-resource-search-clear"));

    expect(document.activeElement).toBe(input());
  });

  /*
   * Escape clears rather than blurs: getting the whole page back is what a
   * visitor wants, and a blurred field with text still in it looks like the
   * page is stuck.
   */
  test("Escape clears the query", () => {
    const { onChange } = renderBox({ value: "checkout" });

    fireEvent.keyDown(input(), { key: "Escape" });

    expect(onChange).toHaveBeenCalledWith("");
  });

  test("Escape on an empty field is left to the browser", () => {
    const { onChange } = renderBox({ value: "" });

    const notPrevented: boolean = fireEvent.keyDown(input(), {
      key: "Escape",
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  test("a query of only spaces is not treated as a query", () => {
    renderBox({ value: "   " });

    expect(
      screen.queryByTestId("status-page-resource-search-clear"),
    ).not.toBeInTheDocument();
  });

  test("other keys are left alone so typing still works", () => {
    const { onChange } = renderBox({ value: "check" });

    fireEvent.keyDown(input(), { key: "o" });

    expect(onChange).not.toHaveBeenCalled();
  });
});
