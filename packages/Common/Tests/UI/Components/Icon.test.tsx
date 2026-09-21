import Icon from "../../../UI/Components/Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import React from "react";

type GetIconPathFunction = (icon: IconProp) => string;

const getIconPath: GetIconPathFunction = (icon: IconProp): string => {
  const { container } = render(<Icon icon={icon} />);
  return container.querySelector("path")?.getAttribute("d") || "";
};

/*
 * The chevrons are the whole vocabulary of the pagination arrows and of every
 * "back" button in the dashboard, and they are picked out of one long
 * if/else chain of hand-written path data - which is exactly how ChevronLeft
 * came to be drawing the bulleted-list glyph.
 */
describe("Icon chevrons", () => {
  it("draws a left-pointing chevron for ChevronLeft", () => {
    expect(getIconPath(IconProp.ChevronLeft)).toBe(
      "M15.75 19.5L8.25 12l7.5-7.5",
    );
  });

  it("draws a right-pointing chevron for ChevronRight", () => {
    expect(getIconPath(IconProp.ChevronRight)).toBe(
      "M8.25 4.5l7.5 7.5-7.5 7.5",
    );
  });

  it("draws a down-pointing chevron for ChevronDown", () => {
    expect(getIconPath(IconProp.ChevronDown)).toBe(
      "M19.5 8.25l-7.5 7.5-7.5-7.5",
    );
  });

  it("does not draw a list where a chevron was asked for", () => {
    const listPath: string = getIconPath(IconProp.List);

    expect(getIconPath(IconProp.ChevronLeft)).not.toBe(listPath);
    expect(getIconPath(IconProp.ChevronRight)).not.toBe(listPath);
    expect(getIconPath(IconProp.ChevronDown)).not.toBe(listPath);
  });

  it("gives each chevron its own direction", () => {
    const paths: Array<string> = [
      getIconPath(IconProp.ChevronLeft),
      getIconPath(IconProp.ChevronRight),
      getIconPath(IconProp.ChevronDown),
    ];

    expect(new Set(paths).size).toBe(paths.length);
  });
});

/*
 * The feed's Filter & Sort control shows Newest first / Oldest first with
 * these two, and the right-sizing card shows over- and under-provisioned
 * containers with them. BarsArrowUp used to be a copy of BarsArrowDown's path,
 * so both pairs read as the same thing.
 */
describe("Icon bars-and-arrow sort glyphs", () => {
  it("draws the arrow pointing down for BarsArrowDown", () => {
    expect(getIconPath(IconProp.BarsArrowDown)).toBe(
      "M3 4.5h14.25M3 9h9.75M3 13.5h9.75m4.5-4.5v12m0 0l-3.75-3.75M17.25 21L21 17.25",
    );
  });

  it("draws the arrow pointing up for BarsArrowUp", () => {
    expect(getIconPath(IconProp.BarsArrowUp)).toBe(
      "M3 4.5h14.25M3 9h9.75M3 13.5h5.25m5.25-.75L17.25 9m0 0L21 12.75M17.25 9v12",
    );
  });

  it("does not draw the same glyph for both directions", () => {
    expect(getIconPath(IconProp.BarsArrowUp)).not.toBe(
      getIconPath(IconProp.BarsArrowDown),
    );
  });
});
